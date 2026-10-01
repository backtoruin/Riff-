"""Tests for the streamed multipart upload route (/api/chat/upload).

Runs the FastAPI app in-process with the DB, auth and LLM stubbed out, so it
needs no network. The size cap is shrunk so the 'too large' case stays fast.
"""
import sys
import types
import glob
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

import server  # noqa: E402

H = {"Authorization": "Bearer test"}


class _Coll:
    async def insert_one(self, doc):
        pass


class _DB:
    chat_messages = _Coll()


@pytest.fixture
def client(monkeypatch):
    seen = []

    async def fake_user(_auth):
        return types.SimpleNamespace(user_id="u1")

    async def fake_stream(_chat, um):
        for f in um.file_contents:
            seen.append((Path(f.file_path).stat().st_size, f.mime_type))
        return "Nice playing!"

    monkeypatch.setattr(server, "db", _DB())
    monkeypatch.setattr(server, "get_current_user", fake_user)
    monkeypatch.setattr(server, "_stream_with_retry", fake_stream)
    monkeypatch.setattr(server, "MAX_UPLOAD_BYTES", 5 * 1024 * 1024)
    c = TestClient(server.app)
    c.seen = seen
    return c


def _leftovers():
    return glob.glob("/tmp/riff_audio_*") + glob.glob("/tmp/riff_video_*")


def test_video_upload_streams_to_llm_and_cleans_up(client):
    r = client.post(
        "/api/chat/upload", headers=H,
        files={"file": ("a.mp4", b"x" * 3_000_000, "video/mp4")},
        data={"text": "hi", "context": "ctx"},
    )
    assert r.status_code == 200
    assert r.json()["text"] == "Nice playing!"
    assert client.seen[-1] == (3_000_000, "video/mp4")
    assert _leftovers() == []


def test_mime_inferred_from_extension(client):
    r = client.post(
        "/api/chat/upload", headers=H,
        files={"file": ("song.MP3", b"x" * 1000, "application/octet-stream")},
    )
    assert r.status_code == 200
    assert client.seen[-1] == (1000, "audio/mpeg")


def test_webm_audio_sent_as_ogg(client):
    client.post(
        "/api/chat/upload", headers=H,
        files={"file": ("a.webm", b"x" * 10, "audio/webm")},
    )
    assert client.seen[-1][1] == "audio/ogg"


def test_too_large_is_413_and_cleans_up(client):
    r = client.post(
        "/api/chat/upload", headers=H,
        files={"file": ("a.mp4", b"x" * 6_000_000, "video/mp4")},
    )
    assert r.status_code == 413
    assert _leftovers() == []


def test_unsupported_type_is_415(client):
    r = client.post(
        "/api/chat/upload", headers=H,
        files={"file": ("a.txt", b"hello", "text/plain")},
    )
    assert r.status_code == 415


def test_empty_file_is_400(client):
    r = client.post(
        "/api/chat/upload", headers=H,
        files={"file": ("a.wav", b"", "audio/wav")},
    )
    assert r.status_code == 400
