"""RiffMaster backend tests for:
  B. Rhythm Coach (/api/metronome/*)
  C. Media upload / video chat (/api/chat/message video_base64)
  D. TTS voice picker (/api/tts/voices, /api/me/tts-voice, /api/tts)

Also includes:
  1. Audio chat regression (/api/chat/message with audio_base64).
"""
import base64
import glob
import io
import math
import os
import struct
import subprocess
import time
import wave

import pytest
import requests


BASE_URL = "https://riff-mentor.preview.emergentagent.com"
API = f"{BASE_URL}/api"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _no_mongo_id(obj):
    if isinstance(obj, dict):
        assert "_id" not in obj, f"MongoDB _id leaked: {list(obj.keys())}"
        for v in obj.values():
            _no_mongo_id(v)
    elif isinstance(obj, list):
        for v in obj:
            _no_mongo_id(v)


def _make_wav_bytes(freq_hz: int = 440, duration_s: float = 2.0,
                    sr: int = 16000) -> bytes:
    n = int(duration_s * sr)
    amp = 16000
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
    return buf.getvalue()


def _ffmpeg_bin():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def _make_mp4_b64(duration_s: float = 1.0) -> str:
    """Produce a tiny valid mp4 (black frame + silent audio) via ffmpeg."""
    ff = _ffmpeg_bin()
    tmp_path = f"/tmp/riff_test_vid_{os.getpid()}.mp4"
    cmd = [
        ff, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", f"color=c=black:s=160x120:r=15:d={duration_s}",
        "-f", "lavfi", "-i", f"anullsrc=channel_layout=mono:sample_rate=16000",
        "-t", str(duration_s),
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "ultrafast",
        "-c:a", "aac", "-b:a", "32k",
        "-movflags", "+faststart",
        tmp_path,
    ]
    subprocess.run(cmd, check=True, capture_output=True)
    try:
        with open(tmp_path, "rb") as f:
            data = f.read()
        return base64.b64encode(data).decode("ascii")
    finally:
        try:
            os.unlink(tmp_path)
        except Exception:
            pass


def _parse_wav(wav_bytes: bytes):
    buf = io.BytesIO(wav_bytes)
    with wave.open(buf, "rb") as w:
        nchannels = w.getnchannels()
        sampwidth = w.getsampwidth()
        framerate = w.getframerate()
        nframes = w.getnframes()
        pcm = w.readframes(nframes)
    import numpy as np
    arr = np.frombuffer(pcm, dtype=np.int16)
    if nchannels == 2:
        arr = arr.reshape(-1, 2).mean(axis=1).astype(np.int16)
    return {
        "nchannels": nchannels,
        "sampwidth": sampwidth,
        "framerate": framerate,
        "nframes": nframes,
        "samples": arr,
    }


# ---------------------------------------------------------------------------
# 1. Audio chat regression
# ---------------------------------------------------------------------------
class TestAudioChatRegression:
    def test_wav_audio_still_works(self, api_client, auth_headers):
        wav_b64 = base64.b64encode(_make_wav_bytes()).decode("ascii")
        r = api_client.post(
            f"{API}/chat/message", headers=auth_headers,
            json={
                "text": "please analyze",
                "audio_base64": wav_b64,
                "audio_mime": "audio/wav",
            },
            timeout=120,
        )
        assert r.status_code == 200, f"status={r.status_code} body={r.text}"
        d = r.json()
        _no_mongo_id(d)
        assert d["role"] == "assistant"
        assert (d.get("text") or "").strip(), "empty assistant text"


# ---------------------------------------------------------------------------
# 2. Rhythm Coach
# ---------------------------------------------------------------------------
class TestMetronomePatterns:
    def test_patterns_endpoint(self, api_client):
        r = api_client.get(f"{API}/metronome/patterns", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        patterns = data.get("patterns", [])
        expected_ids = {"quarters", "eighths", "sixteenths",
                        "ta_pulse", "takita", "takadimi"}
        got_ids = {p["id"] for p in patterns}
        assert got_ids == expected_ids, f"got {got_ids}"
        assert len(patterns) == 6
        for p in patterns:
            assert "label" in p and isinstance(p["label"], str)
            assert p["beats_per_bar"] == 4


class TestMetronomeGenerate:
    def test_generate_and_fetch_wav(self, api_client, auth_headers):
        import numpy as np
        payload = {"bpm": 90, "pattern": "eighths", "bars": 2}
        r = api_client.post(f"{API}/metronome", headers=auth_headers,
                            json=payload, timeout=180)
        assert r.status_code == 200, f"body={r.text}"
        d = r.json()
        assert d["ext"] == "wav"
        assert d["bpm"] == 90
        assert d["bars"] == 2
        assert d["pattern"] == "eighths"
        assert d["beats_per_bar"] == 4
        assert d["total_beats"] == 8
        expected_dur = 60.0 / 90 * 8
        assert d["duration_s"] == pytest.approx(expected_dur, rel=1e-3)
        assert d["url"] == f"/api/metronome/{d['key']}.wav"

        # Fetch WAV
        r2 = api_client.get(f"{BASE_URL}{d['url']}", timeout=60)
        assert r2.status_code == 200, r2.text
        ctype = r2.headers.get("Content-Type", "")
        assert "audio/wav" in ctype or "audio/x-wav" in ctype, f"ctype={ctype}"
        wav = _parse_wav(r2.content)
        assert wav["nchannels"] == 1
        assert wav["sampwidth"] == 2
        assert wav["framerate"] == 24000
        total_dur = wav["nframes"] / wav["framerate"]
        assert d["duration_s"] <= total_dur <= d["duration_s"] + 0.9, (
            f"total_dur={total_dur}, duration_s={d['duration_s']}"
        )
        # Non-silent RMS over duration_s
        active = wav["samples"][: int(d["duration_s"] * wav["framerate"])]
        rms = float(np.sqrt(np.mean(active.astype(np.float64) ** 2)))
        assert rms > 100, f"audio too quiet, rms={rms}"

    def test_timing_accuracy_quarters(self, api_client, auth_headers):
        import numpy as np
        payload = {"bpm": 90, "pattern": "quarters", "bars": 2}
        r = api_client.post(f"{API}/metronome", headers=auth_headers,
                            json=payload, timeout=180)
        assert r.status_code == 200, r.text
        d = r.json()
        r2 = api_client.get(f"{BASE_URL}{d['url']}", timeout=60)
        assert r2.status_code == 200
        wav = _parse_wav(r2.content)
        sr = wav["framerate"]
        samples = wav["samples"]
        spb = 60.0 / 90  # seconds per beat
        window = int(0.025 * sr)  # ±25ms
        beat_rmss = []
        quiet_rmss = []
        n_beats = 8
        for b in range(n_beats):
            center = int(b * spb * sr)
            lo = max(0, center - window)
            hi = min(len(samples), center + window)
            seg = samples[lo:hi]
            peak = int(np.max(np.abs(seg.astype(np.int32)))) if len(seg) else 0
            assert peak > 1000, (
                f"beat {b} peak too low: {peak} at t={b*spb:.3f}s"
            )
            beat_rms = float(np.sqrt(np.mean(seg.astype(np.float64) ** 2)))
            beat_rmss.append(beat_rms)
            # Quiet section between this beat and the next
            if b < n_beats - 1:
                mid = int((b + 0.5) * spb * sr)
                qlo = max(0, mid - window)
                qhi = min(len(samples), mid + window)
                qseg = samples[qlo:qhi]
                qrms = float(np.sqrt(np.mean(qseg.astype(np.float64) ** 2)))
                quiet_rmss.append(qrms)
        mean_beat = sum(beat_rmss) / len(beat_rmss)
        mean_quiet = (sum(quiet_rmss) / len(quiet_rmss)) if quiet_rmss else 1.0
        assert mean_beat > 3 * max(mean_quiet, 1.0), (
            f"beat RMS {mean_beat:.1f} not >3x quiet {mean_quiet:.1f}"
        )

    def test_caching_speedup_same_key(self, api_client, auth_headers):
        payload = {"bpm": 100, "pattern": "ta_pulse", "bars": 1}
        t0 = time.perf_counter()
        r1 = api_client.post(f"{API}/metronome", headers=auth_headers,
                             json=payload, timeout=180)
        dt1 = time.perf_counter() - t0
        assert r1.status_code == 200
        key1 = r1.json()["key"]

        t0 = time.perf_counter()
        r2 = api_client.post(f"{API}/metronome", headers=auth_headers,
                             json=payload, timeout=60)
        dt2 = time.perf_counter() - t0
        assert r2.status_code == 200
        key2 = r2.json()["key"]
        assert key1 == key2
        # If first call was already cached from a prior run, dt1 may be fast too.
        # Only enforce speedup when dt1 is meaningfully large.
        if dt1 > 1.0:
            assert dt2 * 3 <= dt1, f"no cache speedup: dt1={dt1:.2f} dt2={dt2:.2f}"

    def test_voice_coercion_ballad(self, api_client, auth_headers):
        import numpy as np
        payload = {"bpm": 100, "pattern": "quarters", "bars": 1,
                   "voice": "ballad"}
        r = api_client.post(f"{API}/metronome", headers=auth_headers,
                            json=payload, timeout=180)
        assert r.status_code == 200, r.text
        d = r.json()
        r2 = api_client.get(f"{BASE_URL}{d['url']}", timeout=60)
        assert r2.status_code == 200
        wav = _parse_wav(r2.content)
        assert wav["framerate"] == 24000
        active = wav["samples"][: int(d["duration_s"] * wav["framerate"])]
        rms = float(np.sqrt(np.mean(active.astype(np.float64) ** 2)))
        assert rms > 100, f"ballad-coerced output too quiet, rms={rms}"

    def test_bpm_clamp_high(self, api_client, auth_headers):
        r = api_client.post(
            f"{API}/metronome", headers=auth_headers,
            json={"bpm": 9999, "pattern": "quarters", "bars": 1},
            timeout=180,
        )
        assert r.status_code == 200, r.text
        assert r.json()["bpm"] == 220

    def test_bpm_clamp_low(self, api_client, auth_headers):
        r = api_client.post(
            f"{API}/metronome", headers=auth_headers,
            json={"bpm": 1, "pattern": "quarters", "bars": 1},
            timeout=180,
        )
        assert r.status_code == 200, r.text
        assert r.json()["bpm"] == 40

    def test_unknown_pattern_400(self, api_client, auth_headers):
        r = api_client.post(
            f"{API}/metronome", headers=auth_headers,
            json={"bpm": 90, "pattern": "nope", "bars": 1},
            timeout=30,
        )
        assert r.status_code == 400, r.text

    def test_unauthorized_401(self, api_client):
        r = api_client.post(
            f"{API}/metronome",
            json={"bpm": 90, "pattern": "quarters", "bars": 1},
            timeout=30,
        )
        assert r.status_code == 401, f"status={r.status_code} body={r.text}"

    @pytest.mark.parametrize("pattern", [
        "quarters", "eighths", "sixteenths", "ta_pulse", "takita", "takadimi"
    ])
    def test_all_patterns_render(self, api_client, auth_headers, pattern):
        import numpy as np
        r = api_client.post(
            f"{API}/metronome", headers=auth_headers,
            json={"bpm": 100, "pattern": pattern, "bars": 1},
            timeout=180,
        )
        assert r.status_code == 200, f"[{pattern}] {r.text}"
        d = r.json()
        r2 = api_client.get(f"{BASE_URL}{d['url']}", timeout=60)
        assert r2.status_code == 200, f"[{pattern}] fetch failed"
        wav = _parse_wav(r2.content)
        assert wav["framerate"] == 24000
        active = wav["samples"][: int(d["duration_s"] * wav["framerate"])]
        rms = float(np.sqrt(np.mean(active.astype(np.float64) ** 2)))
        assert rms > 100, f"[{pattern}] silent output, rms={rms}"


# ---------------------------------------------------------------------------
# 3. Upload / video chat
# ---------------------------------------------------------------------------
class TestVideoUpload:
    def test_video_round_trip(self, api_client, auth_headers):
        try:
            vid_b64 = _make_mp4_b64(duration_s=1.0)
        except Exception as e:
            pytest.skip(f"ffmpeg unavailable: {e}")
        before = sorted(glob.glob("/tmp/riff_video_*"))
        payload = {
            "text": "please analyze",
            "video_base64": vid_b64,
            "video_mime": "video/mp4",
        }
        r = api_client.post(f"{API}/chat/message", headers=auth_headers,
                            json=payload, timeout=180)
        assert r.status_code == 200, f"status={r.status_code} body={r.text}"
        d = r.json()
        _no_mongo_id(d)
        assert d["role"] == "assistant"
        assert (d.get("text") or "").strip(), "empty assistant text"
        after = sorted(glob.glob("/tmp/riff_video_*"))
        assert len(after) <= len(before), (
            f"video tmp files leaked. before={before}, after={after}"
        )


# ---------------------------------------------------------------------------
# 4. TTS voice picker
# ---------------------------------------------------------------------------
class TestTTSVoicePicker:
    def test_voices_list_defaults(self, api_client, auth_headers):
        r = api_client.get(f"{API}/tts/voices", headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        model_ids = [m["id"] for m in d["models"]]
        assert len(d["models"]) == 3
        assert set(model_ids) == {"tts-1", "tts-1-hd", "gpt-4o-mini-tts"}
        voice_ids = [v["id"] for v in d["voices"]]
        assert len(d["voices"]) == 9
        assert "onyx" in voice_ids
        extra_ids = [v["id"] for v in d["extra_voices"]]
        assert len(d["extra_voices"]) == 2
        assert set(extra_ids) == {"ballad", "verse"}
        cur = d["current"]
        assert cur["voice"] == "onyx"
        assert cur["model"] == "tts-1"
        assert cur["instructions"] is None

    def test_get_me_tts_voice_defaults(self, api_client, auth_headers):
        r = api_client.get(f"{API}/me/tts-voice", headers=auth_headers, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d == {"voice": "onyx", "model": "tts-1", "instructions": None}

    def test_set_voice_nova(self, api_client, auth_headers):
        r = api_client.post(f"{API}/me/tts-voice", headers=auth_headers,
                            json={"voice": "nova"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d == {"voice": "nova", "model": "tts-1", "instructions": None}
        # Persistence
        r2 = api_client.get(f"{API}/me/tts-voice", headers=auth_headers,
                            timeout=30)
        assert r2.json() == d

    def test_ballad_on_tts1_coerces_to_onyx(self, api_client, auth_headers):
        # Prior state may be {nova, tts-1} from above; set ballad while tts-1.
        r = api_client.post(f"{API}/me/tts-voice", headers=auth_headers,
                            json={"voice": "ballad"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["voice"] == "onyx"
        assert d["model"] == "tts-1"
        assert d["instructions"] is None

    def test_set_steerable_model_with_ballad_and_instructions(
        self, api_client, auth_headers
    ):
        r = api_client.post(
            f"{API}/me/tts-voice", headers=auth_headers,
            json={"model": "gpt-4o-mini-tts", "voice": "ballad",
                  "instructions": "Speak slowly and warmly."},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        d = r.json()
        assert d == {"voice": "ballad", "model": "gpt-4o-mini-tts",
                     "instructions": "Speak slowly and warmly."}
        r2 = api_client.get(f"{API}/me/tts-voice", headers=auth_headers, timeout=30)
        assert r2.json() == d

    def test_switch_to_tts1_resets_extra_voice_and_instructions(
        self, api_client, auth_headers
    ):
        # Prerequisite: previous test left state at ballad/gpt-4o-mini-tts.
        r = api_client.post(f"{API}/me/tts-voice", headers=auth_headers,
                            json={"model": "tts-1"}, timeout=30)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["model"] == "tts-1"
        assert d["voice"] == "onyx"
        assert d["instructions"] is None

    def test_tts_uses_stored_prefs(self, api_client, auth_headers):
        # Set to shimmer first
        api_client.post(f"{API}/me/tts-voice", headers=auth_headers,
                        json={"voice": "shimmer", "model": "tts-1"}, timeout=30)
        r = api_client.post(f"{API}/tts", headers=auth_headers,
                            json={"text": "Testing stored voice preference."},
                            timeout=120)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["voice"] == "shimmer"
        assert d["model"] == "tts-1"
        assert "url" in d and d["url"].startswith("/api/tts/")

    def test_tts_explicit_voice_model(self, api_client, auth_headers):
        r = api_client.post(f"{API}/tts", headers=auth_headers,
                            json={"text": "Hello riff",
                                  "voice": "shimmer", "model": "tts-1"},
                            timeout=120)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["voice"] == "shimmer"
        assert d["model"] == "tts-1"

    def test_tts_invalid_voice_falls_back(self, api_client, auth_headers):
        r = api_client.post(f"{API}/tts", headers=auth_headers,
                            json={"text": "Fallback voice test",
                                  "voice": "bogus"},
                            timeout=120)
        assert r.status_code == 200, r.text
        d = r.json()
        # Should coerce to onyx (default) since 'bogus' not in voice ids
        assert d["voice"] in {"onyx", "shimmer", "nova"}  # safe fallback set
        assert d["model"] == "tts-1"

    def test_tts_fetch_audio(self, api_client, auth_headers):
        r = api_client.post(f"{API}/tts", headers=auth_headers,
                            json={"text": "Fetching audio bytes.",
                                  "voice": "onyx", "model": "tts-1"},
                            timeout=120)
        assert r.status_code == 200, r.text
        d = r.json()
        r2 = api_client.get(f"{BASE_URL}{d['url']}", timeout=60)
        assert r2.status_code == 200
        ctype = r2.headers.get("Content-Type", "")
        assert "audio/mpeg" in ctype, f"ctype={ctype}"
        assert len(r2.content) > 1024, f"body too small: {len(r2.content)}B"
