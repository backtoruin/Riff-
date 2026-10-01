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
import wave
import io as _io
import asyncio
import numpy as np

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY", "")

# TTS cache dir
TTS_DIR = Path("/tmp/riff_tts")
TTS_DIR.mkdir(parents=True, exist_ok=True)

# Rhythm Coach dirs
SYLLABLE_DIR = Path("/tmp/riff_syllables")
SYLLABLE_DIR.mkdir(parents=True, exist_ok=True)
METRONOME_DIR = Path("/tmp/riff_metronome")
METRONOME_DIR.mkdir(parents=True, exist_ok=True)

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
    video_base64: Optional[str] = None  # Uploaded video clip for Gemini video analysis
    video_mime: Optional[str] = None    # e.g., "video/mp4", "video/quicktime"
    context: Optional[str] = None  # e.g. "live-audio-data" or "midi-notes"


class ChatMessageOut(BaseModel):
    id: str
    role: str  # 'user' or 'assistant'
    text: str
    created_at: str


class TTSRequest(BaseModel):
    text: str
    voice: Optional[str] = None
    model: Optional[str] = None
    instructions: Optional[str] = None  # Only used with gpt-4o-mini-tts


class VoicePrefIn(BaseModel):
    voice: Optional[str] = None
    model: Optional[str] = None
    instructions: Optional[str] = None


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
    reply_text = ""  # ensure defined even if assembly throws
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
        if body.video_base64:
            vmime = (body.video_mime or "video/mp4").split(";")[0].strip().lower()
            vext_map = {
                "video/mp4": "mp4", "video/quicktime": "mov", "video/mov": "mov",
                "video/x-m4v": "m4v", "video/webm": "webm", "video/3gpp": "3gp",
                "video/x-matroska": "mkv",
            }
            vext = vext_map.get(vmime, "mp4")
            try:
                video_bytes = b64lib.b64decode(body.video_base64)
                tmp = Path(f"/tmp/riff_video_{uuid.uuid4().hex}.{vext}")
                tmp.write_bytes(video_bytes)
                tmp_files.append(tmp)
                file_contents.append(
                    FileContentWithMimeType(file_path=str(tmp), mime_type=vmime)
                )
                if not prompt.strip():
                    prompt = "Please watch this video of me playing and critique my technique and timing."
            except Exception:
                logger.exception("video decode failed")

        um = (
            UserMessage(text=prompt, file_contents=file_contents)
            if file_contents
            else UserMessage(text=prompt)
        )

        # Gemini via Vertex occasionally returns UNAVAILABLE / APIConnectionError
        # under load. Retry with exponential backoff before falling back.
        last_err: Optional[Exception] = None
        reply_text = ""
        for attempt in range(3):
            try:
                chunks = []
                async for ev in chat.stream_message(um):
                    if isinstance(ev, TextDelta):
                        chunks.append(ev.content)
                    elif isinstance(ev, StreamDone):
                        break
                reply_text = "".join(chunks).strip()
                if reply_text:
                    last_err = None
                    break
                last_err = RuntimeError("empty_reply")
            except Exception as e:  # noqa: BLE001
                last_err = e
                logger.warning(
                    "LLM attempt %d failed: %s", attempt + 1, repr(e)[:200],
                )
            if attempt < 2:
                await asyncio.sleep(1.0 * (2 ** attempt))  # 1s, then 2s

        if not reply_text:
            # Give the user a precise reason so they know whether to retry.
            msg = repr(last_err) if last_err else ""
            lower = msg.lower()
            if "unavailable" in lower or "high demand" in lower or "503" in msg:
                reply_text = (
                    "Gemini is slammed with traffic right now — give it 10 seconds and tap send again."
                )
            elif ("rate" in lower and "limit" in lower) or "429" in msg:
                reply_text = (
                    "Hit a short rate limit. Try again in a few seconds."
                )
            elif "safety" in lower or "blocked" in lower:
                reply_text = (
                    "That one got blocked by a safety filter. Try renaming the file or uploading a different clip."
                )
            elif "timeout" in lower:
                reply_text = (
                    "That clip took too long to analyze — try a shorter one (under 60s)."
                )
            else:
                reply_text = (
                    "Riff couldn't analyze that one. Try again — if it keeps failing, upload a shorter clip."
                )
            logger.exception("LLM failed after retries")
    except Exception:
        logger.exception("chat_message assembly failed")
        if not reply_text:
            reply_text = "Riff couldn't process that upload — try again?"
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
# =============================================================================
# TTS — Emergent-managed OpenAI (user picks model + voice)
# =============================================================================
TTS_MODELS = [
    {"id": "tts-1", "label": "Fast", "steerable": False,
     "description": "Fastest + cheapest — great for live chat."},
    {"id": "tts-1-hd", "label": "High Quality", "steerable": False,
     "description": "Higher audio fidelity, slower generation."},
    {"id": "gpt-4o-mini-tts", "label": "Steerable", "steerable": True,
     "description": "Describe the delivery (tone, pace, mood) in words."},
]
TTS_VOICES_SHARED = [
    {"id": "alloy", "label": "Alloy — neutral & balanced"},
    {"id": "ash", "label": "Ash — clear & articulate"},
    {"id": "coral", "label": "Coral — warm & friendly"},
    {"id": "echo", "label": "Echo — smooth & calm"},
    {"id": "fable", "label": "Fable — expressive, storytelling"},
    {"id": "nova", "label": "Nova — energetic & upbeat"},
    {"id": "onyx", "label": "Onyx — deep & authoritative"},
    {"id": "sage", "label": "Sage — wise & measured"},
    {"id": "shimmer", "label": "Shimmer — bright & cheerful"},
]
TTS_VOICES_EXTRA = [  # gpt-4o-mini-tts only
    {"id": "ballad", "label": "Ballad — soft & lyrical"},
    {"id": "verse", "label": "Verse — narrative, versatile"},
]
_VOICE_IDS = {v["id"] for v in TTS_VOICES_SHARED + TTS_VOICES_EXTRA}
_EXTRA_VOICE_IDS = {v["id"] for v in TTS_VOICES_EXTRA}
_MODEL_IDS = {m["id"] for m in TTS_MODELS}


def _coerce_voice_model(voice: Optional[str], model: Optional[str],
                        instructions: Optional[str]) -> tuple[str, str, Optional[str]]:
    voice = voice if (voice and voice in _VOICE_IDS) else "onyx"
    model = model if (model and model in _MODEL_IDS) else "tts-1"
    if model != "gpt-4o-mini-tts":
        if voice in _EXTRA_VOICE_IDS:
            voice = "onyx"
        instructions = None
    return voice, model, (instructions or None)


async def _resolve_user_voice(user_id: str) -> tuple[str, str, Optional[str]]:
    u = await db.users.find_one(
        {"user_id": user_id},
        {"_id": 0, "tts_voice": 1, "tts_model": 1, "tts_instructions": 1},
    )
    return _coerce_voice_model(
        (u or {}).get("tts_voice"),
        (u or {}).get("tts_model"),
        (u or {}).get("tts_instructions"),
    )


@api_router.get("/tts/voices")
async def tts_voices(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    voice, model, instructions = await _resolve_user_voice(user.user_id)
    return {
        "models": TTS_MODELS,
        "voices": TTS_VOICES_SHARED,
        "extra_voices": TTS_VOICES_EXTRA,
        "current": {"voice": voice, "model": model, "instructions": instructions},
    }


@api_router.get("/me/tts-voice")
async def get_tts_voice(authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    voice, model, instructions = await _resolve_user_voice(user.user_id)
    return {"voice": voice, "model": model, "instructions": instructions}


@api_router.post("/me/tts-voice")
async def set_tts_voice(body: VoicePrefIn,
                        authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    cur_v, cur_m, cur_i = await _resolve_user_voice(user.user_id)
    voice, model, instructions = _coerce_voice_model(
        body.voice if body.voice is not None else cur_v,
        body.model if body.model is not None else cur_m,
        body.instructions if body.instructions is not None else cur_i,
    )
    await db.users.update_one(
        {"user_id": user.user_id},
        {"$set": {
            "tts_voice": voice,
            "tts_model": model,
            "tts_instructions": instructions,
        }},
    )
    return {"voice": voice, "model": model, "instructions": instructions}


def _clean_for_tts(text: str) -> str:
    text = re.sub(r"https?://\S+", "", text)
    text = re.sub(r"`{1,3}[^`]*`{1,3}", "", text)
    text = re.sub(r"[*_#>~|]", "", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:3800]


@api_router.post("/tts")
async def tts_generate(body: TTSRequest, authorization: Optional[str] = Header(None)):
    user = await get_current_user(authorization)
    cleaned = _clean_for_tts(body.text)
    if not cleaned:
        raise HTTPException(status_code=400, detail="empty_text")
    stored_v, stored_m, stored_i = await _resolve_user_voice(user.user_id)
    voice, model, instructions = _coerce_voice_model(
        body.voice if body.voice is not None else stored_v,
        body.model if body.model is not None else stored_m,
        body.instructions if body.instructions is not None else stored_i,
    )
    key = hashlib.sha256(
        f"{cleaned}|{voice}|{model}|mp3|{instructions or ''}".encode()
    ).hexdigest()
    out = TTS_DIR / f"{key}.mp3"
    if not out.exists():
        try:
            tts = OpenAITextToSpeech(api_key=EMERGENT_LLM_KEY)
            kwargs = {
                "text": cleaned, "model": model, "voice": voice,
                "response_format": "mp3",
            }
            if instructions and model == "gpt-4o-mini-tts":
                kwargs["instructions"] = instructions
            audio = await tts.generate_speech(**kwargs)
            out.write_bytes(audio)
        except Exception as e:
            logger.exception("tts failed")
            raise HTTPException(status_code=502, detail="tts_failed") from e
    return {
        "key": key, "ext": "mp3", "url": f"/api/tts/{key}.mp3",
        "voice": voice, "model": model,
    }


@api_router.get("/tts/{key}.mp3")
async def tts_fetch(key: str):
    out = TTS_DIR / f"{key}.mp3"
    if not out.exists():
        raise HTTPException(status_code=404, detail="not_found")
    return FileResponse(out, media_type="audio/mpeg",
                        headers={"Cache-Control": "public, max-age=31536000"})


# =============================================================================
# RHYTHM COACH — vocal counting at a target BPM, sample-accurate
# =============================================================================
RHYTHM_PATTERNS = {
    "quarters": {
        "label": "1 · 2 · 3 · 4",
        "beats_per_bar": 4,
        "syllables_per_bar": [("one", 0.0), ("two", 1.0), ("three", 2.0), ("four", 3.0)],
    },
    "eighths": {
        "label": "1 and 2 and 3 and 4 and",
        "beats_per_bar": 4,
        "syllables_per_bar": [
            ("one", 0.0), ("and", 0.5), ("two", 1.0), ("and", 1.5),
            ("three", 2.0), ("and", 2.5), ("four", 3.0), ("and", 3.5),
        ],
    },
    "sixteenths": {
        "label": "1 e and a (16ths)",
        "beats_per_bar": 4,
        "syllables_per_bar": [
            ("one", 0.0), ("e", 0.25), ("and", 0.5), ("a", 0.75),
            ("two", 1.0), ("e", 1.25), ("and", 1.5), ("a", 1.75),
            ("three", 2.0), ("e", 2.25), ("and", 2.5), ("a", 2.75),
            ("four", 3.0), ("e", 3.25), ("and", 3.5), ("a", 3.75),
        ],
    },
    "ta_pulse": {
        "label": "Ta (steady pulse)",
        "beats_per_bar": 4,
        "syllables_per_bar": [("ta", 0.0), ("ta", 1.0), ("ta", 2.0), ("ta", 3.0)],
    },
    "takita": {
        "label": "Ta ki ta (triplets)",
        "beats_per_bar": 4,
        "syllables_per_bar": [
            (s, beat + i / 3.0)
            for beat in range(4)
            for i, s in enumerate(["ta", "ki", "ta"])
        ],
    },
    "takadimi": {
        "label": "Ta ka di mi (16ths)",
        "beats_per_bar": 4,
        "syllables_per_bar": [
            (s, beat + i / 4.0)
            for beat in range(4)
            for i, s in enumerate(["ta", "ka", "di", "mi"])
        ],
    },
}


ALLOWED_METRONOME_VOICES = {"alloy", "echo", "fable", "onyx", "nova", "shimmer"}

# What we actually send to TTS (the pattern keeps the display syllable).
TTS_SPELLING = {
    "e": "ee",
    "a": "ah",
    "ki": "kee",
    "di": "dee",
    "mi": "mee",
    "ka": "kah",
    "ta": "tah",
}


async def _get_syllable_wav(syl: str, voice: str = "onyx") -> bytes:
    """Fetch (or cache) a WAV of a single syllable from OpenAI TTS."""
    spoken = TTS_SPELLING.get(syl, syl)
    key = hashlib.sha256(f"{spoken}|{voice}|tts-1|wav".encode()).hexdigest()
    p = SYLLABLE_DIR / f"{key}.wav"
    if p.exists():
        return p.read_bytes()
    tts = OpenAITextToSpeech(api_key=EMERGENT_LLM_KEY)
    audio = await tts.generate_speech(
        text=spoken, model="tts-1", voice=voice, response_format="wav"
    )
    p.write_bytes(audio)
    return audio


def _wav_to_mono_pcm(wav_bytes: bytes) -> tuple[np.ndarray, int]:
    with wave.open(_io.BytesIO(wav_bytes), "rb") as w:
        n = w.getnframes()
        pcm = w.readframes(n)
        rate = w.getframerate()
        channels = w.getnchannels()
        width = w.getsampwidth()
    dtype = np.int16 if width == 2 else np.int8
    arr = np.frombuffer(pcm, dtype=dtype)
    if channels == 2:
        arr = arr.reshape(-1, 2).mean(axis=1).astype(np.int16)
    return arr.astype(np.int16), rate


def _write_mono_wav(samples: np.ndarray, sample_rate: int) -> bytes:
    buf = _io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sample_rate)
        w.writeframes(samples.astype(np.int16).tobytes())
    return buf.getvalue()


def _resample(arr: np.ndarray, src_rate: int, dst_rate: int) -> np.ndarray:
    if src_rate == dst_rate:
        return arr
    x_src = np.arange(len(arr))
    ratio = dst_rate / src_rate
    x_dst = np.arange(0, len(arr), 1.0 / ratio)
    return np.interp(x_dst, x_src, arr).astype(np.int16)


def _trim_onset(arr: np.ndarray, rate: int, thresh_ratio: float = 0.04,
                pre_roll_ms: float = 4.0) -> np.ndarray:
    """Drop leading silence so sample 0 is (almost exactly) the syllable onset."""
    if len(arr) == 0:
        return arr
    mag = np.abs(arr.astype(np.int32))
    peak = int(mag.max())
    if peak == 0:
        return arr
    idx = int(np.argmax(mag > peak * thresh_ratio))
    pre = int(rate * pre_roll_ms / 1000.0)
    return arr[max(0, idx - pre):]


def _prep_clip(arr: np.ndarray, rate: int, target_rate: int) -> np.ndarray:
    """Resample, trim onset, peak-normalize. Returns float32 in [-1, 1]."""
    arr = _resample(arr, rate, target_rate)
    arr = _trim_onset(arr, target_rate)
    f = arr.astype(np.float32)
    peak = float(np.abs(f).max()) or 1.0
    return (f / peak) * 0.8


def _render_metronome(clips: dict, syllables: list, bpm: int, bars: int,
                      beats_per_bar: int, sample_rate: int,
                      duration_s: float) -> bytes:
    """CPU-bound mixing. Run via asyncio.to_thread."""
    seconds_per_beat = 60.0 / bpm
    n_samples = int((duration_s + 0.6) * sample_rate)
    out = np.zeros(n_samples, dtype=np.float32)

    events = []
    for bar in range(bars):
        for syl, beat_offset in syllables:
            t = (bar * beats_per_bar + beat_offset) * seconds_per_beat
            events.append((syl, int(round(t * sample_rate))))
    events.sort(key=lambda e: e[1])

    fade = int(0.008 * sample_rate)  # 8 ms fade-out when a clip is cut short
    for i, (syl, start) in enumerate(events):
        if start >= n_samples:
            continue
        next_start = events[i + 1][1] if i + 1 < len(events) else n_samples
        max_len = max(0, min(next_start, n_samples) - start)
        clip = clips[syl]
        if len(clip) > max_len:
            clip = clip[:max_len].copy()
            f = min(fade, len(clip))
            if f > 0:
                clip[-f:] *= np.linspace(1.0, 0.0, f, dtype=np.float32)
        out[start:start + len(clip)] += clip

    out = np.clip(out, -1.0, 1.0)
    return _write_mono_wav((out * 32767).astype(np.int16), sample_rate)


class MetronomeRequest(BaseModel):
    bpm: int = 90
    pattern: str = "eighths"
    bars: int = 2
    voice: str = "onyx"


@api_router.get("/metronome/patterns")
async def metronome_patterns():
    return {
        "patterns": [
            {"id": k, "label": v["label"], "beats_per_bar": v["beats_per_bar"]}
            for k, v in RHYTHM_PATTERNS.items()
        ]
    }


@api_router.post("/metronome")
async def metronome_generate(
    body: MetronomeRequest, authorization: Optional[str] = Header(None)
):
    user = await get_current_user(authorization)
    bpm = max(40, min(220, int(body.bpm)))
    bars = max(1, min(8, int(body.bars)))
    pattern = RHYTHM_PATTERNS.get(body.pattern)
    if not pattern:
        raise HTTPException(status_code=400, detail="unknown_pattern")
    # Respect user preference, but constrain to syllable-friendly voices.
    stored_v, _, _ = await _resolve_user_voice(user.user_id)
    requested = body.voice or stored_v
    voice = requested if requested in ALLOWED_METRONOME_VOICES else "onyx"

    cache_key = hashlib.sha256(
        f"{bpm}|{body.pattern}|{bars}|{voice}|v3".encode()
    ).hexdigest()
    out_path = METRONOME_DIR / f"{cache_key}.wav"

    beats_per_bar = pattern["beats_per_bar"]
    total_beats = bars * beats_per_bar
    duration_s = total_beats * (60.0 / bpm)

    if not out_path.exists():
        sample_rate = 24000  # OpenAI TTS native

        # Network I/O stays async; fetch unique syllables concurrently.
        unique_syls = sorted({s for s, _ in pattern["syllables_per_bar"]})
        wavs = await asyncio.gather(
            *[_get_syllable_wav(s, voice=voice) for s in unique_syls]
        )

        def _build() -> bytes:
            clips: dict[str, np.ndarray] = {}
            for s, wav in zip(unique_syls, wavs):
                arr, rate = _wav_to_mono_pcm(wav)
                clips[s] = _prep_clip(arr, rate, sample_rate)
            return _render_metronome(
                clips, pattern["syllables_per_bar"], bpm, bars,
                beats_per_bar, sample_rate, duration_s,
            )

        data = await asyncio.to_thread(_build)
        await asyncio.to_thread(out_path.write_bytes, data)

    return {
        "key": cache_key,
        "ext": "wav",
        "url": f"/api/metronome/{cache_key}.wav",
        "bpm": bpm,
        "bars": bars,
        "pattern": body.pattern,
        "beats_per_bar": beats_per_bar,
        "total_beats": total_beats,
        "duration_s": duration_s,
    }


@api_router.get("/metronome/{key}.wav")
async def metronome_fetch(key: str):
    p = METRONOME_DIR / f"{key}.wav"
    if not p.exists():
        raise HTTPException(status_code=404, detail="not_found")
    return FileResponse(
        p,
        media_type="audio/wav",
        headers={"Cache-Control": "public, max-age=86400"},
    )


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
