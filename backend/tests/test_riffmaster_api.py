"""RiffMaster backend API tests.

Covers: health, lessons, auth guards, auth exchange error path, authenticated
flows (progress, complete-lesson, log-session, chat, chat history, TTS),
MongoDB _id leakage, and badge recomputation (studio_10).
"""
import os
from pathlib import Path
import pytest
import requests

BASE_URL = "https://riff-mentor.preview.emergentagent.com"
API = f"{BASE_URL}/api"

AUTHED_ENDPOINTS_GET = [
    "/auth/me",
    "/me/progress",
    "/chat/history",
]
AUTHED_ENDPOINTS_POST = [
    ("/me/complete-lesson", {"lesson_id": "l_posture", "score": 100}),
    ("/me/log-session", {}),
    ("/chat/message", {"text": "hi"}),
    ("/tts", {"text": "hi"}),
]


def _assert_no_mongo_id(obj):
    if isinstance(obj, dict):
        assert "_id" not in obj, f"MongoDB _id leaked: {list(obj.keys())}"
        for v in obj.values():
            _assert_no_mongo_id(v)
    elif isinstance(obj, list):
        for v in obj:
            _assert_no_mongo_id(v)


# ----------------------------------------------------------------------------
# Health
# ----------------------------------------------------------------------------
class TestHealth:
    def test_root(self, api_client):
        r = api_client.get(f"{API}/")
        assert r.status_code == 200
        data = r.json()
        assert "message" in data
        assert data.get("teacher") == "Riff"


# ----------------------------------------------------------------------------
# Lessons (public)
# ----------------------------------------------------------------------------
class TestLessons:
    def test_list_lessons_seeded_and_sorted(self, api_client):
        r = api_client.get(f"{API}/lessons")
        assert r.status_code == 200
        data = r.json()
        _assert_no_mongo_id(data)
        lessons = data.get("lessons")
        assert isinstance(lessons, list) and len(lessons) == 8
        # Sorted by order ascending
        orders = [l["order"] for l in lessons]
        assert orders == sorted(orders), f"Lessons not sorted: {orders}"
        # Required fields on each
        required = {"lesson_id", "title", "difficulty", "xp", "image_url"}
        for l in lessons:
            missing = required - set(l.keys())
            assert not missing, f"Lesson {l.get('lesson_id')} missing: {missing}"
            assert isinstance(l["image_url"], str) and l["image_url"].startswith("http")

    def test_get_lesson_posture(self, api_client):
        r = api_client.get(f"{API}/lessons/l_posture")
        assert r.status_code == 200
        data = r.json()
        _assert_no_mongo_id(data)
        assert data["lesson_id"] == "l_posture"

    def test_get_lesson_nonexistent_404(self, api_client):
        r = api_client.get(f"{API}/lessons/l_nope_xyz")
        assert r.status_code == 404


# ----------------------------------------------------------------------------
# Auth error paths & guards
# ----------------------------------------------------------------------------
class TestAuthGuards:
    def test_invalid_session_exchange_returns_401(self, api_client):
        r = api_client.post(f"{API}/auth/session",
                            json={"session_id": "obviously-bogus-xxx"})
        assert r.status_code == 401

    @pytest.mark.parametrize("path", AUTHED_ENDPOINTS_GET)
    def test_get_requires_bearer(self, api_client, path):
        r = api_client.get(f"{API}{path}")
        assert r.status_code == 401, f"{path} returned {r.status_code}"

    @pytest.mark.parametrize("path,payload", AUTHED_ENDPOINTS_POST)
    def test_post_requires_bearer(self, api_client, path, payload):
        r = api_client.post(f"{API}{path}", json=payload)
        assert r.status_code == 401, f"{path} returned {r.status_code}"

    def test_bad_token_rejected(self, api_client):
        r = api_client.get(f"{API}/auth/me",
                           headers={"Authorization": "Bearer not-a-real-token"})
        assert r.status_code == 401


# ----------------------------------------------------------------------------
# Authenticated flows — order matters, use class
# ----------------------------------------------------------------------------
class TestProgressFlow:
    def test_auth_me(self, api_client, auth_headers, test_user):
        r = api_client.get(f"{API}/auth/me", headers=auth_headers)
        assert r.status_code == 200
        data = r.json()
        _assert_no_mongo_id(data)
        assert data["user"]["user_id"] == test_user["user_id"]
        assert data["user"]["email"] == test_user["email"]

    def test_initial_progress(self, api_client, auth_headers):
        r = api_client.get(f"{API}/me/progress", headers=auth_headers)
        assert r.status_code == 200
        d = r.json()
        _assert_no_mongo_id(d)
        assert d["xp"] == 0
        assert d["streak_days"] == 0
        assert d["level"] == 1
        assert d["earned_badges"] == []
        # badges list has all 7 rule badges with earned flag
        assert isinstance(d["badges"], list)
        assert len(d["badges"]) == 7
        for b in d["badges"]:
            assert "id" in b and "name" in b and "description" in b and "earned" in b
            assert b["earned"] is False

    def test_complete_lesson_first_time(self, api_client, auth_headers):
        r = api_client.post(f"{API}/me/complete-lesson", headers=auth_headers,
                            json={"lesson_id": "l_posture", "score": 100})
        assert r.status_code == 200
        d = r.json()
        _assert_no_mongo_id(d)
        assert d["xp_gained"] > 0, d
        assert d["total_xp"] > 0
        assert d["streak_days"] == 1
        assert d["streak_bumped"] is True
        assert "first_lesson" in d["new_badges"], d["new_badges"]

        # Verify persistence
        r2 = api_client.get(f"{API}/me/progress", headers=auth_headers)
        p = r2.json()
        assert p["xp"] == d["total_xp"]
        assert "l_posture" in p["completed_lessons"]
        assert "first_lesson" in p["earned_badges"]

    def test_complete_lesson_replay_less_xp(self, api_client, auth_headers):
        # Capture xp before
        before = api_client.get(f"{API}/me/progress", headers=auth_headers).json()
        xp_before = before["xp"]
        streak_before = before["streak_days"]

        r = api_client.post(f"{API}/me/complete-lesson", headers=auth_headers,
                            json={"lesson_id": "l_posture", "score": 100})
        assert r.status_code == 200
        d = r.json()
        # Replay gives XP = max(10, full//3). l_posture xp=50 → full=50, replay=max(10, 16)=16
        assert d["xp_gained"] <= 20, f"Replay xp too high: {d['xp_gained']}"
        # Streak stays same (same day)
        assert d["streak_days"] == streak_before
        assert d["total_xp"] == xp_before + d["xp_gained"]

    def test_complete_lesson_unknown_404(self, api_client, auth_headers):
        r = api_client.post(f"{API}/me/complete-lesson", headers=auth_headers,
                            json={"lesson_id": "nope_xyz", "score": 100})
        assert r.status_code == 404

    def test_log_session_once(self, api_client, auth_headers):
        r = api_client.post(f"{API}/me/log-session", headers=auth_headers, json={})
        assert r.status_code == 200
        d = r.json()
        _assert_no_mongo_id(d)
        assert d["xp_gained"] == 25
        p = api_client.get(f"{API}/me/progress", headers=auth_headers).json()
        assert p["sessions_count"] == 1

    def test_log_session_badge_studio_10(self, api_client, auth_headers):
        # We've already logged 1 session in previous test; do 9 more → total 10
        for _ in range(9):
            r = api_client.post(f"{API}/me/log-session", headers=auth_headers, json={})
            assert r.status_code == 200
        p = api_client.get(f"{API}/me/progress", headers=auth_headers).json()
        assert p["sessions_count"] == 10
        assert "studio_10" in p["earned_badges"], p["earned_badges"]
        # Verify its earned flag in badges list
        studio = next(b for b in p["badges"] if b["id"] == "studio_10")
        assert studio["earned"] is True


# ----------------------------------------------------------------------------
# Chat (real Gemini via EMERGENT_LLM_KEY) + TTS
# ----------------------------------------------------------------------------
class TestChatAndTTS:
    def test_chat_text(self, api_client, auth_headers):
        r = api_client.post(
            f"{API}/chat/message", headers=auth_headers,
            json={"text": "Hi Riff, what should a beginner work on first?"},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        _assert_no_mongo_id(d)
        assert d["role"] == "assistant"
        assert isinstance(d["text"], str) and len(d["text"].strip()) > 0
        # Not the offline fallback
        assert "briefly offline" not in d["text"].lower(), (
            f"LLM returned offline fallback — EMERGENT_LLM_KEY/model issue? Text: {d['text']}"
        )

    def test_chat_vision(self, api_client, auth_headers):
        b64_path = Path(__file__).parent / "_guitar_b64.txt"
        b64 = b64_path.read_text().strip()
        assert len(b64) > 500, "Guitar JPEG base64 missing/too small"
        r = api_client.post(
            f"{API}/chat/message", headers=auth_headers,
            json={"text": "Analyze this photo", "image_base64": b64},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        _assert_no_mongo_id(d)
        assert d["role"] == "assistant"
        assert isinstance(d["text"], str) and len(d["text"].strip()) > 0
        assert "briefly offline" not in d["text"].lower(), (
            f"Vision LLM returned offline fallback. Text: {d['text']}"
        )

    def test_chat_history(self, api_client, auth_headers):
        r = api_client.get(f"{API}/chat/history", headers=auth_headers)
        assert r.status_code == 200
        d = r.json()
        _assert_no_mongo_id(d)
        msgs = d["messages"]
        assert len(msgs) >= 4  # 2 user + 2 assistant
        roles = [m["role"] for m in msgs]
        assert "user" in roles and "assistant" in roles
        # Internal fields excluded
        for m in msgs:
            assert "user_id" not in m
            assert "_id" not in m
            assert "id" in m and "role" in m and "text" in m and "created_at" in m

    def test_tts_generate_and_fetch(self, api_client, auth_headers):
        r = api_client.post(f"{API}/tts", headers=auth_headers,
                            json={"text": "Welcome to RiffMaster"}, timeout=60)
        assert r.status_code == 200, r.text
        d = r.json()
        _assert_no_mongo_id(d)
        assert d["ext"] == "mp3"
        assert "key" in d and d["url"].startswith("/api/tts/") and d["url"].endswith(".mp3")

        # Fetch audio file
        r2 = requests.get(f"{BASE_URL}{d['url']}", timeout=30)
        assert r2.status_code == 200
        assert r2.headers.get("Content-Type", "").startswith("audio/mpeg")
        assert len(r2.content) > 1000, f"Audio body too small: {len(r2.content)} bytes"
