"""Shared fixtures for RiffMaster backend tests."""
import os
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta
from pathlib import Path
from dotenv import load_dotenv
from pymongo import MongoClient

# Load backend .env for Mongo config
load_dotenv(Path(__file__).resolve().parents[1] / ".env")

BASE_URL = "https://riff-mentor.preview.emergentagent.com"
MONGO_URL = os.environ["MONGO_URL"]
DB_NAME = os.environ["DB_NAME"]


@pytest.fixture(scope="session")
def base_url():
    return BASE_URL


@pytest.fixture(scope="session")
def mongo_db():
    client = MongoClient(MONGO_URL)
    yield client[DB_NAME]
    client.close()


@pytest.fixture(scope="session")
def api_client():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="session")
def test_user(mongo_db):
    """Insert a fresh test user + session row and return (user_id, token).

    Cleans up on teardown.
    """
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    email = f"TEST_{uuid.uuid4().hex[:8]}@riff.local"
    token = "test_token_" + uuid.uuid4().hex

    mongo_db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "name": "Test Player",
        "picture": None,
        "created_at": datetime.now(timezone.utc),
        "last_login": datetime.now(timezone.utc),
    })
    mongo_db.user_sessions.insert_one({
        "session_token": token,
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
    })

    yield {"user_id": user_id, "email": email, "token": token}

    # Cleanup
    mongo_db.user_sessions.delete_many({"user_id": user_id})
    mongo_db.users.delete_one({"user_id": user_id})
    mongo_db.progress.delete_one({"user_id": user_id})
    mongo_db.chat_messages.delete_many({"user_id": user_id})


@pytest.fixture
def auth_headers(test_user):
    return {
        "Authorization": f"Bearer {test_user['token']}",
        "Content-Type": "application/json",
    }
