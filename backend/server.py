from fastapi import FastAPI, APIRouter, Header, HTTPException, Response
from fastapi.responses import FileResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import hashlib
import re
import httpx
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional
import uuid
from datetime import datetime, timezone, timedelta, date

from emergentintegrations.llm.chat import LlmChat, UserMessage, ImageContent, FileContentWithMimeType, TextDelta, StreamDone
from emergentintegrations.llm.openai import OpenAITextToSpeech
import base64 as b64lib

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

# TTS cache dir
TTS_DIR = Path("/tmp/riff_tts")
TTS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI()
api_router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO)


# =============================================================================
# TEACHER PERSONA
# =============================================================================
TEACHER_SYSTEM_PROMPT = """You are Riff, a virtual AI guitar teacher — warm, encouraging, patient, with 20+ years of real teaching experience across rock, blues, jazz, classical, folk, and metal.

PERSONALITY:
- Warm, friendly, and occasionally funny. You celebrate progress and frame mistakes as learning opportunities.
- You speak in a natural, conversational tone — like a trusted mentor, not a textbook.
- Keep responses SHORT and punchy (2–4 sentences typical). Only go longer when teaching a specific concept.

TEACHING STYLE:
- Be specific and actionable. Reference concrete details.
- When analyzing a camera photo of the student, call out posture, fretting hand position, wrist angle, thumb placement, pick grip, strumming arm — pick ONE or TWO things to focus on, not everything at once.
- When analyzing audio/MIDI data, reference tempo accuracy, pitch, rhythm, dynamics, and tone.
- Always end with ONE concrete next step or exercise.
- Use musical terminology naturally but briefly explain if the student seems new.

GAMIFICATION:
- You know the student is on a gamified journey (XP, streaks, levels, badges). Celebrate milestones. Use phrases like "nice — that'll bump your streak" or "you're close to leveling up".
- Never be preachy or robotic. Sound like a real human guitar teacher who's rooting for them.
"""


# =============================================================================
# MODELS
# =============================================================================
class SessionIn(BaseModel):
    session_id: str


class User(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None


class ChatMessageIn(BaseModel):
    text: str
    image_base64: Optional[str] = None  # Camera frame for vision analysis
    audio_base64: Optional[str] = None  # Audio clip for hearing analysis
    audio_mime: Optional[str] = None    # e.g., "audio/webm", "audio/m4a", "audio/wav"
    context: Optional[str] = None  # e.g. "live-audio-data" or "midi-notes"


class ChatMessageOut(BaseModel):
    id: str
    role: str  # 'user' or 'assistant'
    text: str
    created_at: str


class TTSRequest(BaseModel):
    text: str


class CompleteLessonIn(BaseModel):
    lesson_id: str
    score: int = 100  # 0..100


# =============================================================================
# AUTH HELPERS
# =============================================================================
async def get_current_user(authorization: Optional[str] = Header(None)) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing token")
    token = authorization.split(" ", 1)[1].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = session["expires_at"]
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return User(**{k: user.get(k) for k in ("user_id", "email", "name", "picture")})


# =============================================================================
# STARTUP: indexes + seed lessons
# =============================================================================
LESSONS_SEED = [
    {
        "lesson_id": "l_posture",
        "order": 1,
        "title": "Hold It Like You Mean It",
        "subtitle": "Posture & grip fundamentals",
        "difficulty": "Beginner",
        "xp": 50,
        "duration_min": 5,
        "category": "Fundamentals",
        "image_key": "lesson_acoustic",
        "content": (
            "Great tone starts before you play a note. Sit tall, both feet flat on the floor, "
            "guitar snug against your body. Fretting-hand thumb rides the back of the neck — "
            "not wrapped over the top. Pick grip: pinch between the pad of your thumb and the "
            "side of your index finger. Loose but connected.\n\n"
            "DRILL: Hold the guitar for 60 seconds without touching the strings. "
            "Feel the balance. If your shoulder tenses, reset."
        ),
    },
    {
        "lesson_id": "l_first_chords",
        "order": 2,
        "title": "Your First Four Chords",
        "subtitle": "Em, G, C, D — unlock a thousand songs",
        "difficulty": "Beginner",
        "xp": 80,
        "duration_min": 10,
        "category": "Chords",
        "image_key": "lesson_electric",
        "content": (
            "Em is the easiest chord on earth: two fingers, strum all six strings. "
            "G adds the pinky and reaches to the high E. C is cozy on the first three "
            "strings. D is a tight little triangle on strings 1–3.\n\n"
            "DRILL: Em → G → C → D, four strums each. Slow is smooth, smooth is fast."
        ),
    },
    {
        "lesson_id": "l_strum",
        "order": 3,
        "title": "The Universal Strum",
        "subtitle": "Down, down-up, up-down-up",
        "difficulty": "Beginner",
        "xp": 100,
        "duration_min": 8,
        "category": "Rhythm",
        "image_key": "lesson_acoustic",
        "content": (
            "Think of your strumming hand as a pendulum — it never stops moving. "
            "Downbeats hit on the way down, upbeats on the way up. If you miss a string, "
            "that's fine. Keep the motion.\n\n"
            "DRILL: Set a metronome at 70 BPM. D-DU-UDU on an Em chord. Breathe."
        ),
    },
    {
        "lesson_id": "l_pentatonic",
        "order": 4,
        "title": "The Minor Pentatonic Box",
        "subtitle": "Five notes, every solo you love",
        "difficulty": "Intermediate",
        "xp": 150,
        "duration_min": 12,
        "category": "Scales",
        "image_key": "lesson_electric",
        "content": (
            "Position 1 of the A minor pentatonic lives at the 5th fret. "
            "Index on 5, ring on 7 — repeat the shape on each string. Say the notes out loud "
            "as you play: A C D E G.\n\n"
            "DRILL: Ascending and descending, four times through, with a metronome at 80 BPM."
        ),
    },
    {
        "lesson_id": "l_barre",
        "order": 5,
        "title": "Barre Chords Without the Pain",
        "subtitle": "F major, the gateway",
        "difficulty": "Intermediate",
        "xp": 180,
        "duration_min": 15,
        "category": "Chords",
        "image_key": "lesson_acoustic",
        "content": (
            "The secret to a barre is leverage, not strength. Roll your index finger slightly "
            "toward the headstock so the bony side presses the strings. Thumb straight down the "
            "back of the neck.\n\n"
            "DRILL: 10 seconds F, 10 seconds rest, 10x. Build the muscle gradually."
        ),
    },
    {
        "lesson_id": "l_fingerpicking",
        "order": 6,
        "title": "Fingerpicking: Travis Picking",
        "subtitle": "Thumb + fingers independence",
        "difficulty": "Intermediate",
        "xp": 200,
        "duration_min": 15,
        "category": "Technique",
        "image_key": "lesson_acoustic",
        "content": (
            "Thumb plays bass notes on beats 1 & 3; index plucks beats 2 & 4. "
            "Keep the thumb steady — it's a metronome inside your hand.\n\n"
            "DRILL: On C major, thumb alternates between A and D strings. Slow."
        ),
    },
    {
        "lesson_id": "l_modes",
        "order": 7,
        "title": "Modes of the Major Scale",
        "subtitle": "Ionian to Locrian, demystified",
        "difficulty": "Advanced",
        "xp": 300,
        "duration_min": 20,
        "category": "Theory",
        "image_key": "lesson_electric",
        "content": (
            "Modes are just the major scale starting on a different note. "
            "C Ionian = C D E F G A B. D Dorian = D E F G A B C — same notes, different gravity. "
            "Each mode has a signature sound: Dorian = jazzy minor, Mixolydian = bluesy major, "
            "Phrygian = Spanish/metal.\n\n"
            "DRILL: Play C Ionian up, then D Dorian up — notice the shift in feel."
        ),
    },
    {
        "lesson_id": "l_sweep",
        "order": 8,
        "title": "Sweep Picking Basics",
        "subtitle": "One motion, five strings",
        "difficulty": "Advanced",
        "xp": 400,
        "duration_min": 25,
        "category": "Technique",
        "image_key": "lesson_electric",
        "content": (
            "Sweep picking is a controlled brush of the pick across adjacent strings, "
            "combined with synchronized fretting-hand rolls so only one note rings at a time. "
            "Start SLOW. Mute aggressively with the fretting hand.\n\n"
            "DRILL: 5-string A minor arpeggio sweep, 60 BPM. Metronome is your friend."
        ),
    },
]


IMAGE_URLS = {
    "lesson_electric": "https://images.unsplash.com/photo-1535587566541-97121a128dc5?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NTYxODd8MHwxfHNlYXJjaHwxfHxjbG9zZSUyMHVwJTIwZWxlY3RyaWMlMjBndWl0YXIlMjBmcmV0Ym9hcmQlMjBwbGF5aW5nJTIwZGFyayUyMG1vb2R5fGVufDB8fHx8MTc5MDg3MzI2OXww&ixlib=rb-4.1.0&q=85",
    "lesson_acoustic": "https://images.unsplash.com/photo-1631926039342-9defea7955ed?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2NzF8MHwxfHNlYXJjaHwxfHxhY291c3RpYyUyMGd1aXRhciUyMHNpdHRpbmclMjBvbiUyMGElMjBzdGFuZCUyMGVtcHR5JTIwZGFyayUyMHN0YWdlfGVufDB8fHx8MTc5MDg3MzI2OXww&ixlib=rb-4.1.0&q=85",
    "ai_avatar_badge": "https://images.unsplash.com/photo-1780145705677-b875d0f9209e?crop=entropy&cs=srgb&fm=jpg&ixid=M3w3NTY2Nzd8MHwxfHNlYXJjaHwxfHxnbG93aW5nJTIwb3JhbmdlJTIwZ3VpdGFyJTIwcGljayUyMGNsb3NlJTIwdXAlMjBtYWNyb3xlbnwwfHx8fDE3OTA4NzMyODR8MA&ixlib=rb-4.1.0&q=85",
}


@app.on_event("startup")
async def startup():
    # Indexes
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.lessons.create_index("lesson_id", unique=True)
    await db.lessons.create_index("order")
    await db.progress.create_index("user_id", unique=True)
    await db.chat_messages.create_index([("user_id", 1), ("created_at", 1)])

    # Seed lessons (idempotent)
    for lesson in LESSONS_SEED:
        lesson["image_url"] = IMAGE_URLS.get(lesson.get("image_key"), "")
        await db.lessons.update_one(
            {"lesson_id": lesson["lesson_id"]},
            {"$set": lesson},
            upsert=True,
        )
    logger.info("Startup complete. Seeded %d lessons.", len(LESSONS_SEED))


@app.on_event("shutdown")
async def shutdown():
    client.close()


# =============================================================================
# ROUTES — basic
# =============================================================================
@api_router.get("/")
async def root():
    return {"message": "RiffMaster API online", "teacher": "Riff"}


# =============================================================================
# AUTH
# =============================================================================
@api_router.post("/auth/session")
async def auth_session(body: SessionIn):
    """Exchange a one-time session_id (from Emergent OAuth redirect) for a session_token."""
    async with httpx.AsyncClient(timeout=20.0) as http:
        try:
            r = await http.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": body.session_id},
            )
        except Exception as e:
            logger.exception("auth exchange failed")
            raise HTTPException(status_code=401, detail="auth_failed") from e
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="invalid_session_id")
    data = r.json()
    email = data.get("email")
    name = data.get("name") or email
    picture = data.get("picture")
    session_token = data.get("session_token")
    if not email or not session_token:
        raise HTTPException(status_code=401, detail="malformed_response")

    # Upsert user
    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name, "picture": picture, "last_login": datetime.now(timezone.utc)}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "created_at": datetime.now(timezone.utc),
            "last_login": datetime.now(timezone.utc),
        })

    # Session row
    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
    })

    # Ensure progress record
    await db.progress.update_one(
        {"user_id": user_id},
        {"$setOnInsert": {
            "user_id": user_id,
            "xp": 0,
            "streak_days": 0,
            "last_practice_date": None,
            "completed_lessons": [],
            "sessions_count": 0,
            "badges": [],
            "created_at": datetime.now(timezone.utc),
        }},
        upsert=True,
    )

    return {
        "session_token": session_token,
        "user": {"user_id": user_id, "email": email, "name": name, "picture": picture},
    }


@api_router.get("/auth/me")
async def auth_me(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    return {"user": user.dict()}


@api_router.post("/auth/logout")
async def auth_logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
    return {"ok": True}


# =============================================================================
# LESSONS
# =============================================================================
@api_router.get("/lessons")
async def list_lessons():
    lessons = await db.lessons.find({}, {"_id": 0}).sort("order", 1).to_list(100)
    return {"lessons": lessons}


@api_router.get("/lessons/{lesson_id}")
async def get_lesson(lesson_id: str):
    lesson = await db.lessons.find_one({"lesson_id": lesson_id}, {"_id": 0})
    if not lesson:
        raise HTTPException(status_code=404, detail="not_found")
    return lesson


# =============================================================================
# PROGRESS + GAMIFICATION
# =============================================================================
def compute_level(xp: int) -> dict:
    # Level up every 300 XP; each level needs more.
    level = 1
    needed = 300
    remaining = xp
    while remaining >= needed:
        remaining -= needed
        level += 1
        needed = 300 + (level - 1) * 150
    return {"level": level, "xp_into_level": remaining, "xp_to_next": needed}


BADGE_RULES = [
    {"id": "first_lesson", "name": "First Note", "description": "Complete your first lesson", "cond": lambda p: len(p.get("completed_lessons", [])) >= 1},
    {"id": "five_lessons", "name": "Chord Warrior", "description": "Complete 5 lessons", "cond": lambda p: len(p.get("completed_lessons", [])) >= 5},
    {"id": "streak_3", "name": "Three Day Fire", "description": "Hit a 3-day streak", "cond": lambda p: p.get("streak_days", 0) >= 3},
    {"id": "streak_7", "name": "Week Rockstar", "description": "Hit a 7-day streak", "cond": lambda p: p.get("streak_days", 0) >= 7},
    {"id": "xp_500", "name": "Riff Rookie", "description": "Earn 500 XP", "cond": lambda p: p.get("xp", 0) >= 500},
    {"id": "xp_1500", "name": "Shredder", "description": "Earn 1,500 XP", "cond": lambda p: p.get("xp", 0) >= 1500},
    {"id": "studio_10", "name": "Studio Rat", "description": "10 practice sessions", "cond": lambda p: p.get("sessions_count", 0) >= 10},
]


async def recompute_badges(progress: dict) -> list:
    earned_ids = set(progress.get("badges", []))
    now_earned = []
    for rule in BADGE_RULES:
        if rule["id"] in earned_ids:
            continue
        if rule["cond"](progress):
            earned_ids.add(rule["id"])
            now_earned.append(rule["id"])
    if now_earned:
        await db.progress.update_one(
            {"user_id": progress["user_id"]},
            {"$set": {"badges": list(earned_ids)}},
        )
        progress["badges"] = list(earned_ids)
    return now_earned


def _update_streak(prev_last: Optional[datetime], prev_streak: int) -> tuple[int, bool]:
    today = datetime.now(timezone.utc).date()
    if prev_last is None:
        return 1, True
    if prev_last.tzinfo is None:
        prev_last = prev_last.replace(tzinfo=timezone.utc)
    last_d = prev_last.date()
    if last_d == today:
        return prev_streak, False
    if (today - last_d).days == 1:
        return prev_streak + 1, True
    return 1, True


@api_router.get("/me/progress")
async def get_progress(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    p = await db.progress.find_one({"user_id": user.user_id}, {"_id": 0})
    if not p:
        p = {
            "user_id": user.user_id, "xp": 0, "streak_days": 0,
            "last_practice_date": None, "completed_lessons": [],
            "sessions_count": 0, "badges": [],
        }
        await db.progress.insert_one({**p, "created_at": datetime.now(timezone.utc)})
    lv = compute_level(p.get("xp", 0))
    all_badges = [{**b, "earned": b["id"] in set(p.get("badges", []))} for b in [
        {"id": r["id"], "name": r["name"], "description": r["description"]} for r in BADGE_RULES
    ]]
    return {
        "xp": p.get("xp", 0),
        "streak_days": p.get("streak_days", 0),
        "last_practice_date": p.get("last_practice_date").isoformat() if p.get("last_practice_date") else None,
        "completed_lessons": p.get("completed_lessons", []),
        "sessions_count": p.get("sessions_count", 0),
        "earned_badges": list(p.get("badges", [])),
        "badges": all_badges,
        **lv,
    }


@api_router.post("/me/complete-lesson")
async def complete_lesson(body: CompleteLessonIn, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    lesson = await db.lessons.find_one({"lesson_id": body.lesson_id}, {"_id": 0})
    if not lesson:
        raise HTTPException(status_code=404, detail="lesson_not_found")
    p = await db.progress.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    completed = set(p.get("completed_lessons", []))
    first_time = body.lesson_id not in completed
    completed.add(body.lesson_id)

    xp_gained = int(lesson.get("xp", 50) * max(0, min(100, body.score)) / 100)
    if not first_time:
        xp_gained = max(10, xp_gained // 3)  # replay bonus

    new_xp = p.get("xp", 0) + xp_gained
    new_streak, streak_bumped = _update_streak(p.get("last_practice_date"), p.get("streak_days", 0))

    update = {
        "xp": new_xp,
        "streak_days": new_streak,
        "last_practice_date": datetime.now(timezone.utc),
        "completed_lessons": list(completed),
    }
    await db.progress.update_one({"user_id": user.user_id}, {"$set": update}, upsert=True)

    merged = {**p, **update, "user_id": user.user_id,
              "sessions_count": p.get("sessions_count", 0),
              "badges": p.get("badges", [])}
    new_badges = await recompute_badges(merged)

    return {
        "xp_gained": xp_gained,
        "total_xp": new_xp,
        "streak_days": new_streak,
        "streak_bumped": streak_bumped,
        "new_badges": new_badges,
        **compute_level(new_xp),
    }


@api_router.post("/me/log-session")
async def log_session(authorization: Optional[str] = Header(None)):
    """Log a practice session (used by Studio screen on exit / completion)."""
    user = await get_current_user(authorization)
    p = await db.progress.find_one({"user_id": user.user_id}, {"_id": 0}) or {}
    new_streak, _ = _update_streak(p.get("last_practice_date"), p.get("streak_days", 0))
    xp_gained = 25
    new_xp = p.get("xp", 0) + xp_gained
    update = {
        "xp": new_xp,
        "streak_days": new_streak,
        "last_practice_date": datetime.now(timezone.utc),
        "sessions_count": p.get("sessions_count", 0) + 1,
    }
    await db.progress.update_one({"user_id": user.user_id}, {"$set": update}, upsert=True)
    merged = {**p, **update, "user_id": user.user_id,
              "completed_lessons": p.get("completed_lessons", []),
              "badges": p.get("badges", [])}
    new_badges = await recompute_badges(merged)
    return {"xp_gained": xp_gained, "total_xp": new_xp, "streak_days": new_streak,
            "new_badges": new_badges, **compute_level(new_xp)}


# =============================================================================
# CHAT WITH RIFF (vision-capable)
# =============================================================================
@api_router.get("/chat/history")
async def chat_history(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    msgs = await db.chat_messages.find(
        {"user_id": user.user_id}, {"_id": 0, "user_id": 0}
    ).sort("created_at", 1).to_list(200)
    for m in msgs:
        if isinstance(m.get("created_at"), datetime):
            m["created_at"] = m["created_at"].isoformat()
    return {"messages": msgs}


@api_router.post("/chat/message", response_model=ChatMessageOut)
async def chat_message(body: ChatMessageIn, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    now = datetime.now(timezone.utc)

    user_msg = {
        "id": str(uuid.uuid4()),
        "user_id": user.user_id,
        "role": "user",
        "text": body.text,
        "has_image": bool(body.image_base64),
        "context": body.context,
        "created_at": now,
    }
    await db.chat_messages.insert_one(user_msg)

    # Build chat with history
    chat = LlmChat(
        api_key=EMERGENT_LLM_KEY,
        session_id=f"riff-{user.user_id}",
        system_message=TEACHER_SYSTEM_PROMPT,
    ).with_model("gemini", "gemini-3-flash-preview")

    # Compose user message
    prompt = body.text or ""
    if body.context:
        prompt = f"[Context: {body.context}]\n{prompt}"

    file_contents = []
    tmp_files: list[Path] = []
    try:
        if body.image_base64:
            file_contents.append(ImageContent(image_base64=body.image_base64))
            if not prompt.strip():
                prompt = "Here's a photo of me playing. What should I work on?"
        if body.audio_base64:
            mime = (body.audio_mime or "audio/mp4").split(";")[0].strip().lower()
            ext_map = {
                "audio/mpeg": "mp3", "audio/mp3": "mp3",
                "audio/mp4": "m4a", "audio/m4a": "m4a", "audio/x-m4a": "m4a",
                "audio/wav": "wav", "audio/x-wav": "wav",
                "audio/ogg": "ogg", "audio/webm": "webm",
                "audio/aac": "aac", "audio/flac": "flac", "audio/aiff": "aiff",
            }
            ext = ext_map.get(mime, "bin")
            # Normalize webm/opus → ogg for Gemini compatibility (both are Opus containers)
            send_mime = mime
            if mime == "audio/webm":
                send_mime = "audio/ogg"
            try:
                audio_bytes = b64lib.b64decode(body.audio_base64)
                tmp = Path(f"/tmp/riff_audio_{uuid.uuid4().hex}.{ext}")
                tmp.write_bytes(audio_bytes)
                tmp_files.append(tmp)
                file_contents.append(
                    FileContentWithMimeType(file_path=str(tmp), mime_type=send_mime)
                )
                if not prompt.strip():
                    prompt = "Listen to this clip of me playing and tell me what to work on."
            except Exception:
                logger.exception("audio decode failed")

        um = (
            UserMessage(text=prompt, file_contents=file_contents)
            if file_contents
            else UserMessage(text=prompt)
        )

        chunks = []
        async for ev in chat.stream_message(um):
            if isinstance(ev, TextDelta):
                chunks.append(ev.content)
            elif isinstance(ev, StreamDone):
                break
        reply_text = "".join(chunks).strip() or "Hmm, I didn't catch that — try again?"
    except Exception:
        logger.exception("LLM failed")
        reply_text = "(Riff hit a snag analyzing that clip. Try one more time?)"
    finally:
        for t in tmp_files:
            try:
                t.unlink()
            except Exception:
                pass

    assistant_msg = {
        "id": str(uuid.uuid4()),
        "user_id": user.user_id,
        "role": "assistant",
        "text": reply_text,
        "created_at": datetime.now(timezone.utc),
    }
    await db.chat_messages.insert_one(assistant_msg)

    return ChatMessageOut(
        id=assistant_msg["id"],
        role="assistant",
        text=reply_text,
        created_at=assistant_msg["created_at"].isoformat(),
    )


# =============================================================================
# TTS
# =============================================================================
def _clean_for_tts(text: str) -> str:
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"`{1,3}[^`]*`{1,3}", "", text)
    text = re.sub(r"[*_#>~|]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:3800]


@api_router.post("/tts")
async def tts_generate(body: TTSRequest, authorization: Optional[str] = Header(None)):
    await get_current_user(authorization)
    cleaned = _clean_for_tts(body.text)
    if not cleaned:
        raise HTTPException(status_code=400, detail="empty_text")
    voice = "onyx"
    model = "tts-1"
    key = hashlib.sha256(f"{cleaned}|{voice}|{model}|mp3".encode()).hexdigest()
    out = TTS_DIR / f"{key}.mp3"
    if not out.exists():
        try:
            tts = OpenAITextToSpeech(api_key=EMERGENT_LLM_KEY)
            audio = await tts.generate_speech(text=cleaned, model=model, voice=voice,
                                              response_format="mp3")
            out.write_bytes(audio)
        except Exception as e:
            logger.exception("tts failed")
            raise HTTPException(status_code=502, detail="tts_failed") from e
    return {"key": key, "ext": "mp3", "url": f"/api/tts/{key}.mp3"}


@api_router.get("/tts/{key}.mp3")
async def tts_fetch(key: str):
    out = TTS_DIR / f"{key}.mp3"
    if not out.exists():
        raise HTTPException(status_code=404, detail="not_found")
    return FileResponse(out, media_type="audio/mpeg",
                        headers={"Cache-Control": "public, max-age=31536000"})


# =============================================================================
# REGISTER
# =============================================================================
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)
