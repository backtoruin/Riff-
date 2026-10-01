"""Chat retry + specific error-copy tests for /api/chat/message.

- Tests 1-2 hit the LIVE Gemini via the public BASE_URL (no mocks).
- Tests 3-9 run the FastAPI app in-process via httpx.AsyncClient and
  monkeypatch `LlmChat.stream_message` + `asyncio.sleep` to exercise
  retry logic without real network / sleep delays.
"""
import asyncio
import base64
import glob
import io
import logging
import math
import os
import struct
import sys
import uuid
import wave
from datetime import datetime, timezone, timedelta
from pathlib import Path
from unittest.mock import patch

import httpx
import pytest
import pytest_asyncio
import requests

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import server as backend_server  # noqa: E402
from emergentintegrations.llm.chat import TextDelta, StreamDone  # noqa: E402


BASE_URL = os.environ.get(
    "EXPO_BACKEND_URL", "https://riff-mentor.preview.emergentagent.com"
).rstrip("/")


ERROR_STRINGS = (
    "Gemini is slammed with traffic right now",
    "Hit a short rate limit",
    "That one got blocked by a safety filter",
    "That clip took too long to analyze",
    "Riff couldn't analyze that one",
    "Riff couldn't process that upload",
)


def _make_wav_440hz(duration_s: float = 2.0, rate: int = 16000) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        n = int(duration_s * rate)
        samples = bytearray()
        for i in range(n):
            v = int(32767 * 0.3 * math.sin(2 * math.pi * 440 * i / rate))
            samples += struct.pack("<h", v)
        w.writeframes(bytes(samples))
    return buf.getvalue()


class FakeStream:
    def __init__(self, events):
        self.events = events

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for e in self.events:
            yield e


def make_failing_then_ok(fail_times: int, fail_msg: str, final_text: str = "You sound great"):
    state = {"calls": 0}

    def _stream(self, msg):
        state["calls"] += 1
        if state["calls"] <= fail_times:
            raise RuntimeError(fail_msg)
        # Just yield text; generator exhaustion ends the async-for naturally.
        return FakeStream([TextDelta(content=final_text)])

    _stream._state = state
    return _stream


def make_always_fail(fail_msg: str):
    state = {"calls": 0}

    def _stream(self, msg):
        state["calls"] += 1
        raise RuntimeError(fail_msg)

    _stream._state = state
    return _stream


# ---------------------------------------------------------------------------
# Tests 1-2 : LIVE Gemini via public BASE_URL
# ---------------------------------------------------------------------------
class TestLiveHappyPath:
    def test_01_text_only_message(self, auth_headers):
        r = requests.post(
            f"{BASE_URL}/api/chat/message",
            json={"text": "What's a good warm-up for beginners?"},
            headers=auth_headers,
            timeout=120,
        )
        assert r.status_code == 200, r.text
        text = r.json().get("text", "")
        assert text and isinstance(text, str) and len(text) > 20
        for bad in ERROR_STRINGS:
            assert not text.startswith(bad), f"Got error copy: {text!r}"

    def test_02_audio_wav_accepted(self, auth_headers):
        wav = _make_wav_440hz()
        b64 = base64.b64encode(wav).decode()
        r = requests.post(
            f"{BASE_URL}/api/chat/message",
            json={
                "text": "Does this tone sound in tune?",
                "audio_base64": b64,
                "audio_mime": "audio/wav",
            },
            headers=auth_headers,
            timeout=180,
        )
        assert r.status_code == 200, r.text
        text = r.json().get("text", "")
        assert text and len(text) > 20
        for bad in ERROR_STRINGS:
            assert not text.startswith(bad), f"Got error copy: {text!r}"


# ---------------------------------------------------------------------------
# In-process async client with Motor rebind so Mongo is bound to current loop.
# ---------------------------------------------------------------------------
@pytest_asyncio.fixture
async def async_client_and_user():
    """Create a fresh Motor client bound to the current event loop + async
    httpx client that talks to the FastAPI app via ASGITransport. Also seeds
    a dedicated test user + session token into Mongo and cleans up."""
    from motor.motor_asyncio import AsyncIOMotorClient
    mongo = AsyncIOMotorClient(os.environ["MONGO_URL"])
    db = mongo[os.environ["DB_NAME"]]

    user_id = f"user_{uuid.uuid4().hex[:12]}"
    token = "test_token_" + uuid.uuid4().hex
    await db.users.insert_one({
        "user_id": user_id,
        "email": f"TEST_retry_{uuid.uuid4().hex[:6]}@riff.local",
        "name": "Retry Tester",
        "picture": None,
        "created_at": datetime.now(timezone.utc),
        "last_login": datetime.now(timezone.utc),
    })
    await db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
    })

    # Rebind backend's Motor client to one owned by the current loop
    orig_client = backend_server.client
    orig_db = backend_server.db
    backend_server.client = mongo
    backend_server.db = db

    transport = httpx.ASGITransport(app=backend_server.app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac, {"user_id": user_id, "token": token, "db": db}

    # Cleanup
    await db.user_sessions.delete_many({"user_id": user_id})
    await db.users.delete_one({"user_id": user_id})
    await db.chat_messages.delete_many({"user_id": user_id})
    mongo.close()
    backend_server.client = orig_client
    backend_server.db = orig_db


async def _noop_sleep(_d):
    return None


# ---------------------------------------------------------------------------
# Tests 3-9 : in-process retry / error-copy
# ---------------------------------------------------------------------------
UNAVAILABLE_MSG = "UNAVAILABLE - This model is currently experiencing high demand"


class TestRetryLogic:
    @pytest.mark.asyncio
    async def test_03_retry_succeeds_on_third_attempt(self, async_client_and_user, caplog):
        ac, u = async_client_and_user
        headers = {"Authorization": f"Bearer {u['token']}"}
        stream_fn = make_failing_then_ok(2, UNAVAILABLE_MSG, "You sound great")

        slept = []

        async def tracking_sleep(d):
            slept.append(d)

        with patch.object(backend_server.LlmChat, "stream_message", stream_fn), \
             patch.object(backend_server.asyncio, "sleep", tracking_sleep), \
             caplog.at_level(logging.WARNING):
            r = await ac.post("/api/chat/message", json={"text": "Hey Riff"}, headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["text"] == "You sound great"
        assert stream_fn._state["calls"] == 3
        assert slept == [1.0, 2.0], f"Expected [1.0, 2.0] got {slept}"
        warn_msgs = [rec.message for rec in caplog.records if rec.levelno == logging.WARNING]
        failed_warns = [m for m in warn_msgs if "LLM attempt" in m and "failed" in m]
        assert len(failed_warns) >= 2, f"expected >=2 warn logs, got {warn_msgs}"

    @pytest.mark.asyncio
    async def test_04_all_fail_unavailable_copy(self, async_client_and_user):
        ac, u = async_client_and_user
        headers = {"Authorization": f"Bearer {u['token']}"}
        stream_fn = make_always_fail(UNAVAILABLE_MSG)
        with patch.object(backend_server.LlmChat, "stream_message", stream_fn), \
             patch.object(backend_server.asyncio, "sleep", _noop_sleep):
            r = await ac.post("/api/chat/message", json={"text": "Hey"}, headers=headers)
        assert r.status_code == 200, r.text
        expected = ("Gemini is slammed with traffic right now — "
                    "give it 10 seconds and tap send again.")
        assert r.json()["text"] == expected
        assert stream_fn._state["calls"] == 3

    @pytest.mark.asyncio
    async def test_05_all_fail_safety_copy(self, async_client_and_user):
        ac, u = async_client_and_user
        headers = {"Authorization": f"Bearer {u['token']}"}
        stream_fn = make_always_fail("content was blocked by safety filter")
        with patch.object(backend_server.LlmChat, "stream_message", stream_fn), \
             patch.object(backend_server.asyncio, "sleep", _noop_sleep):
            r = await ac.post("/api/chat/message", json={"text": "yo"}, headers=headers)
        assert r.status_code == 200, r.text
        expected = ("That one got blocked by a safety filter. "
                    "Try renaming the file or uploading a different clip.")
        assert r.json()["text"] == expected

    @pytest.mark.asyncio
    async def test_06_all_fail_rate_limit_copy(self, async_client_and_user):
        ac, u = async_client_and_user
        headers = {"Authorization": f"Bearer {u['token']}"}
        stream_fn = make_always_fail("rate limit exceeded 429")
        with patch.object(backend_server.LlmChat, "stream_message", stream_fn), \
             patch.object(backend_server.asyncio, "sleep", _noop_sleep):
            r = await ac.post("/api/chat/message", json={"text": "yo"}, headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["text"] == "Hit a short rate limit. Try again in a few seconds."

    @pytest.mark.asyncio
    async def test_07_all_fail_timeout_copy(self, async_client_and_user):
        ac, u = async_client_and_user
        headers = {"Authorization": f"Bearer {u['token']}"}
        stream_fn = make_always_fail("Operation timed out: timeout")
        with patch.object(backend_server.LlmChat, "stream_message", stream_fn), \
             patch.object(backend_server.asyncio, "sleep", _noop_sleep):
            r = await ac.post("/api/chat/message", json={"text": "yo"}, headers=headers)
        assert r.status_code == 200, r.text
        assert r.json()["text"] == (
            "That clip took too long to analyze — try a shorter one (under 60s)."
        )

    @pytest.mark.asyncio
    async def test_08_all_fail_fallback_copy(self, async_client_and_user):
        ac, u = async_client_and_user
        headers = {"Authorization": f"Bearer {u['token']}"}
        stream_fn = make_always_fail("blah blah something weird")
        with patch.object(backend_server.LlmChat, "stream_message", stream_fn), \
             patch.object(backend_server.asyncio, "sleep", _noop_sleep):
            r = await ac.post("/api/chat/message", json={"text": "yo"}, headers=headers)
        assert r.status_code == 200, r.text
        text = r.json()["text"]
        assert text.startswith("Riff couldn't analyze that one"), text


class TestCleanup:
    @pytest.mark.asyncio
    async def test_09_no_tmp_leak_and_no_id_leak(self, async_client_and_user):
        ac, u = async_client_and_user
        headers = {"Authorization": f"Bearer {u['token']}"}

        before_audio = set(glob.glob("/tmp/riff_audio_*"))
        before_video = set(glob.glob("/tmp/riff_video_*"))

        wav_b64 = base64.b64encode(_make_wav_440hz(0.5)).decode()
        video_bytes = b"\x00\x00\x00\x18ftypmp42" + os.urandom(256)
        video_b64 = base64.b64encode(video_bytes).decode()

        stream_fn = make_always_fail(UNAVAILABLE_MSG)
        with patch.object(backend_server.LlmChat, "stream_message", stream_fn), \
             patch.object(backend_server.asyncio, "sleep", _noop_sleep):
            r = await ac.post(
                "/api/chat/message",
                json={
                    "text": "look",
                    "audio_base64": wav_b64,
                    "audio_mime": "audio/wav",
                    "video_base64": video_b64,
                    "video_mime": "video/mp4",
                },
                headers=headers,
            )
        assert r.status_code == 200

        await asyncio.sleep(0.1)
        new_audio = set(glob.glob("/tmp/riff_audio_*")) - before_audio
        new_video = set(glob.glob("/tmp/riff_video_*")) - before_video
        assert not new_audio, f"Leftover audio tmp files: {new_audio}"
        assert not new_video, f"Leftover video tmp files: {new_video}"

        hist = await ac.get("/api/chat/history", headers=headers)
        assert hist.status_code == 200
        data = hist.json()
        assert "messages" in data
        for m in data["messages"]:
            assert "_id" not in m, f"Message leaks _id: {m}"
