"""RiffMaster chat audio input tests.

Covers the new POST /api/chat/message audio_base64 / audio_mime fields:
- WAV upload → Gemini audio understanding
- WebM upload (actually Ogg Opus bytes, backend normalizes mime) → not 500
- Invalid base64 payload → graceful text-only reply
- Combined image + audio in one message
- /tmp/riff_audio_* cleanup
- Chat history still clean (no _id / user_id leak)
"""
import base64
import glob
import io
import math
import os
import struct
import subprocess
import wave
from pathlib import Path

import pytest
import requests

BASE_URL = "https://riff-mentor.preview.emergentagent.com"
API = f"{BASE_URL}/api"
OFFLINE_SNIPPETS = ("briefly offline", "hit a snag")


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _assert_no_mongo_id(obj):
    if isinstance(obj, dict):
        assert "_id" not in obj, f"MongoDB _id leaked: keys={list(obj.keys())}"
        for v in obj.values():
            _assert_no_mongo_id(v)
    elif isinstance(obj, list):
        for v in obj:
            _assert_no_mongo_id(v)


def _make_sine_wav_b64(freq_hz: int = 440, duration_s: float = 2.0,
                       sr: int = 16000) -> str:
    """Return base64 of a mono 16-bit PCM WAV (sine wave)."""
    n = int(duration_s * sr)
    amp = 16000  # ~ -6 dBFS
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        frames = bytearray()
        for i in range(n):
            s = int(amp * math.sin(2 * math.pi * freq_hz * (i / sr)))
            frames += struct.pack("<h", s)
        w.writeframes(bytes(frames))
    return base64.b64encode(buf.getvalue()).decode("ascii")


def _ffmpeg_bin() -> str:
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def _make_ogg_opus_b64(freq_hz: int = 440, duration_s: float = 2.0) -> str:
    """Encode a short sine wave to Ogg/Opus via ffmpeg → base64.

    Returned bytes are a valid Ogg Opus container. We tag the request with
    mime 'audio/webm' to exercise the backend normalization path.
    """
    ff = _ffmpeg_bin()
    cmd = [
        ff, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", f"sine=frequency={freq_hz}:duration={duration_s}",
        "-ac", "1", "-ar", "48000",
        "-c:a", "libopus", "-b:a", "32k",
        "-f", "ogg", "pipe:1",
    ]
    proc = subprocess.run(cmd, capture_output=True, check=True)
    return base64.b64encode(proc.stdout).decode("ascii")


def _tmp_audio_files():
    return sorted(glob.glob("/tmp/riff_audio_*"))


def _load_image_b64() -> str:
    p = Path(__file__).parent / "_guitar_b64.txt"
    assert p.exists(), "guitar jpeg fixture missing"
    return p.read_text().strip()


# ---------------------------------------------------------------------------
# Smoke: previously-tested flows still pass
# ---------------------------------------------------------------------------
class TestSmokeAfterAudioChange:
    def test_lessons_still_8(self, api_client):
        r = api_client.get(f"{API}/lessons", timeout=30)
        assert r.status_code == 200, r.text
        lessons = r.json().get("lessons", [])
        assert len(lessons) == 8

    def test_chat_text_only(self, api_client, auth_headers):
        r = api_client.post(
            f"{API}/chat/message", headers=auth_headers,
            json={"text": "Hi Riff, in one short sentence: what should I warm up with?"},
            timeout=60,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        _assert_no_mongo_id(d)
        assert d["role"] == "assistant"
        assert isinstance(d["text"], str) and d["text"].strip()
        low = d["text"].lower()
        assert not any(s in low for s in OFFLINE_SNIPPETS), f"offline fallback: {d['text']}"

    def test_chat_image_only(self, api_client, auth_headers):
        img_b64 = _load_image_b64()
        r = api_client.post(
            f"{API}/chat/message", headers=auth_headers,
            json={"text": "Quick look at this photo of me playing.", "image_base64": img_b64},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        _assert_no_mongo_id(d)
        assert d["role"] == "assistant"
        assert d["text"].strip()
        low = d["text"].lower()
        assert not any(s in low for s in OFFLINE_SNIPPETS), f"offline fallback: {d['text']}"


# ---------------------------------------------------------------------------
# NEW: audio input to Gemini
# ---------------------------------------------------------------------------
class TestChatAudio:
    def test_wav_audio_round_trip(self, api_client, auth_headers):
        before = _tmp_audio_files()
        wav_b64 = _make_sine_wav_b64()
        payload = {
            "text": "I just recorded myself playing. Please listen and give feedback.",
            "audio_base64": wav_b64,
            "audio_mime": "audio/wav",
            "context": "Student recorded ~2s of audio.",
        }
        r = api_client.post(f"{API}/chat/message", headers=auth_headers,
                            json=payload, timeout=120)
        assert r.status_code == 200, f"status={r.status_code} body={r.text}"
        d = r.json()
        _assert_no_mongo_id(d)
        assert d["role"] == "assistant"
        text = (d.get("text") or "").strip()
        assert text, "assistant text was empty"
        low = text.lower()
        assert not any(s in low for s in OFFLINE_SNIPPETS), (
            f"got offline fallback for WAV audio: {text!r}"
        )
        # Fuzzy: expect listening/playing/feedback-ish language
        keywords = ("listen", "hear", "play", "sound", "tone", "note", "feedback",
                    "practice", "clip", "record")
        assert any(k in low for k in keywords), (
            f"assistant reply doesn't look like audio feedback: {text!r}"
        )

        # tmp cleanup: no net growth of /tmp/riff_audio_* files
        after = _tmp_audio_files()
        assert len(after) <= len(before), (
            f"/tmp audio files leaked. before={before}, after={after}"
        )

    def test_webm_normalized_to_ogg(self, api_client, auth_headers):
        """Send Ogg/Opus bytes tagged as audio/webm; backend should normalize."""
        try:
            ogg_b64 = _make_ogg_opus_b64()
        except Exception as e:
            pytest.skip(f"ffmpeg opus encoding unavailable: {e}")

        before = _tmp_audio_files()
        payload = {
            "text": "Here's a short clip from my phone — any thoughts?",
            "audio_base64": ogg_b64,
            "audio_mime": "audio/webm",
        }
        r = api_client.post(f"{API}/chat/message", headers=auth_headers,
                            json=payload, timeout=120)
        assert r.status_code == 200, f"status={r.status_code} body={r.text}"
        d = r.json()
        _assert_no_mongo_id(d)
        assert d["role"] == "assistant"
        text = (d.get("text") or "").strip()
        assert text, "assistant text was empty for webm/ogg clip"
        # Even if LLM says 'I could not make it out', that's acceptable.
        # The *only* unacceptable case is a 500 (already asserted) or
        # the generic 'briefly offline' fallback which indicates upstream
        # key/model failure, not an audio-content issue.
        low = text.lower()
        assert "briefly offline" not in low, (
            f"got 'briefly offline' fallback — upstream LLM failure: {text!r}"
        )
        after = _tmp_audio_files()
        assert len(after) <= len(before), (
            f"/tmp audio files leaked. before={before}, after={after}"
        )

    def test_invalid_base64_is_tolerated(self, api_client, auth_headers):
        before = _tmp_audio_files()
        payload = {
            "text": "Just checking in — if my audio didn't go through, still reply please.",
            "audio_base64": "not_base64_$$$$",
            "audio_mime": "audio/wav",
        }
        r = api_client.post(f"{API}/chat/message", headers=auth_headers,
                            json=payload, timeout=60)
        assert r.status_code == 200, (
            f"invalid base64 should NOT 500. status={r.status_code} body={r.text}"
        )
        d = r.json()
        _assert_no_mongo_id(d)
        assert d["role"] == "assistant"
        assert (d.get("text") or "").strip(), "empty assistant text on bad audio"
        low = d["text"].lower()
        assert "briefly offline" not in low, f"upstream LLM failure: {d['text']!r}"

        after = _tmp_audio_files()
        assert len(after) <= len(before), (
            f"/tmp audio files leaked on bad base64. before={before}, after={after}"
        )

    def test_image_plus_audio_in_same_message(self, api_client, auth_headers):
        img_b64 = _load_image_b64()
        wav_b64 = _make_sine_wav_b64(duration_s=1.5)
        before = _tmp_audio_files()
        payload = {
            "text": "Here's a photo AND a short clip of me playing. Any thoughts?",
            "image_base64": img_b64,
            "audio_base64": wav_b64,
            "audio_mime": "audio/wav",
        }
        r = api_client.post(f"{API}/chat/message", headers=auth_headers,
                            json=payload, timeout=120)
        assert r.status_code == 200, f"status={r.status_code} body={r.text}"
        d = r.json()
        _assert_no_mongo_id(d)
        assert d["role"] == "assistant"
        text = (d.get("text") or "").strip()
        assert text, "assistant text empty for image+audio"
        low = text.lower()
        assert "briefly offline" not in low, f"upstream LLM failure: {text!r}"

        after = _tmp_audio_files()
        assert len(after) <= len(before), (
            f"/tmp audio files leaked on image+audio. before={before}, after={after}"
        )

    def test_chat_history_clean_after_audio(self, api_client, auth_headers):
        r = api_client.get(f"{API}/chat/history", headers=auth_headers, timeout=30)
        assert r.status_code == 200
        d = r.json()
        _assert_no_mongo_id(d)
        msgs = d.get("messages", [])
        assert isinstance(msgs, list) and len(msgs) >= 4
        roles = {m["role"] for m in msgs}
        assert {"user", "assistant"}.issubset(roles)
        for m in msgs:
            assert "_id" not in m
            assert "user_id" not in m
            for key in ("id", "role", "text", "created_at"):
                assert key in m, f"missing {key} in history message: {m}"
