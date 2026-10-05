"""Phase 3 validation: adaptive engine, grading, gamification, nudges, voice proxy.

Seeds a minimal published journey directly via SQLAlchemy (no Gemini calls),
then exercises the learner submit/progress/nudge endpoints and the voice proxy.
"""

from __future__ import annotations

import io
import struct
import sys
import wave

from fastapi.testclient import TestClient

from app.db.session import SessionLocal
from app.main import app
from app.seed import init_db
from app.models import (
    Activity,
    Concept,
    ContentSource,
    Interaction,
    Journey,
    LearnerProfile,
    Mastery,
    Nudge,
    User,
    UserBadge,
    utcnow,
)

ADMIN_EMAIL = "admin@ubl-demo.com"
ADMIN_PASSWORD = "ubl-demo-2026"
LEARNER_EMAIL = "phase3-learner@test.example"
LEARNER_PASSWORD = "phase3-pass-123"
SEED_TITLE = "Phase 3 test source (delete-me)"

JOURNEY_ID: int | None = None
ACT = {}  # type -> activity id
CONCEPT = {}  # key -> concept id


def _cleanup() -> None:
    """Idempotently remove data from previous runs."""
    db = SessionLocal()
    try:
        learner = db.query(User).filter(User.email == LEARNER_EMAIL).first()
        if learner:
            db.query(Interaction).filter(Interaction.user_id == learner.id).delete()
            db.query(Mastery).filter(Mastery.user_id == learner.id).delete()
            db.query(UserBadge).filter(UserBadge.user_id == learner.id).delete()
            db.query(Nudge).filter(Nudge.user_id == learner.id).delete()
            db.query(LearnerProfile).filter(LearnerProfile.user_id == learner.id).delete()
            db.delete(learner)
        for src in db.query(ContentSource).filter(ContentSource.title == SEED_TITLE).all():
            for journey in list(src.journeys):
                activity_ids = [a.id for a in journey.activities]
                if activity_ids:
                    db.query(Interaction).filter(
                        Interaction.activity_id.in_(activity_ids)
                    ).delete(synchronize_session=False)
                db.query(Activity).filter(Activity.journey_id == journey.id).delete(
                    synchronize_session=False
                )
                db.query(Concept).filter(Concept.journey_id == journey.id).delete(
                    synchronize_session=False
                )
                db.delete(journey)
            db.delete(src)
        db.commit()
    finally:
        db.close()


def _seed() -> None:
    """Seed a published journey with one activity per type."""
    global JOURNEY_ID
    db = SessionLocal()
    try:
        admin = db.query(User).filter(User.role == "admin").first()
        assert admin, "admin user must exist"
        meta = {"needs_review": False, "issues": [], "source_refs": [], "model_confidence": 0.95}

        source = ContentSource(
            type="topic",
            title=SEED_TITLE,
            raw_text="Phishing awareness training material." * 2,
            status="processed",
            created_by=admin.id,
        )
        db.add(source)
        db.flush()

        journey = Journey(
            content_source_id=source.id,
            title="Spot the Phish (phase3)",
            description="Seeded journey for phase 3 validation",
            config_snapshot={"objectives": ["Identify phishing emails"], "glossary": []},
            status="published",
            published_at=utcnow(),
        )
        db.add(journey)
        db.flush()

        c_redflags = Concept(journey_id=journey.id, title="Phishing red flags", order=0)
        c_response = Concept(journey_id=journey.id, title="Incident response", order=1)
        db.add_all([c_redflags, c_response])
        db.flush()

        scenario = Activity(
            journey_id=journey.id,
            concept_id=c_redflags.id,
            type="scenario",
            difficulty=2,
            order=0,
            xp=20,
            payload={
                "data": {
                    "prompt": "A colleague shares a suspicious email asking for payroll data.",
                    "options": [
                        {"id": "a", "text": "Reply and ask if it's really HR"},
                        {"id": "b", "text": "Report it to IT security and delete it"},
                        {"id": "c", "text": "Forward it to the team group"},
                    ],
                },
                "answer": {"correct_option_id": "b", "rationale": "Report phishing to IT security."},
                "meta": meta,
            },
        )
        puzzle = Activity(
            journey_id=journey.id,
            concept_id=c_redflags.id,
            type="puzzle",
            difficulty=2,
            order=1,
            xp=20,
            payload={
                "data": {
                    "instruction": "Sort each action into the right bucket",
                    "mode": "match",
                    "buckets": ["Safe", "Risky"],
                    "items": [
                        {"id": "i1", "text": "Use the company password manager"},
                        {"id": "i2", "text": "Share your password with a colleague"},
                    ],
                },
                "answer": {"solutions": {"i1": "Safe", "i2": "Risky"}},
                "meta": meta,
            },
        )
        simulation = Activity(
            journey_id=journey.id,
            concept_id=c_response.id,
            type="simulation",
            difficulty=3,
            order=2,
            xp=30,
            payload={
                "data": {
                    "scenario": "You are the HR on-call officer during a data-breach alert.",
                    "steps": [
                        {"prompt": "First move?", "options": [{"id": "a", "text": "Contain"}, {"id": "b", "text": "Panic"}]},
                        {"prompt": "Then?", "options": [{"id": "c", "text": "Escalate"}, {"id": "d", "text": "Hide"}]},
                    ],
                },
                "answer": {"correct_option_ids": ["a", "c"]},
                "meta": meta,
            },
        )
        mission = Activity(
            journey_id=journey.id,
            concept_id=c_response.id,
            type="mission",
            difficulty=2,
            order=3,
            xp=25,
            payload={
                "data": {
                    "briefing": "Audit your own inbox for phishing indicators.",
                    "tasks": ["Check sender addresses on 3 recent emails", "Enable 2FA on your account"],
                    "success_criteria": "Learner reports completing at least 2 tasks",
                },
                "answer": {"min_tasks": 2},
                "meta": meta,
            },
        )
        db.add_all([scenario, puzzle, simulation, mission])
        db.commit()
        JOURNEY_ID = journey.id
        ACT.update({"scenario": scenario.id, "puzzle": puzzle.id, "simulation": simulation.id, "mission": mission.id})
        CONCEPT.update({"redflags": c_redflags.id, "response": c_response.id})
    finally:
        db.close()


def _submit(client: TestClient, headers: dict, activity_id: int, **body) -> dict:
    r = client.post(f"/api/learner/activities/{activity_id}/submit", headers=headers, json=body)
    assert r.status_code == 200, f"submit {activity_id}: {r.status_code} {r.text}"
    return r.json()


def main() -> None:
    init_db()  # create tables + seed admin/settings/badges before direct-DB seeding
    _cleanup()
    _seed()
    assert JOURNEY_ID is not None

    with TestClient(app) as client:
        # Setup: login admin, create learner, login learner
        r = client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200, r.text
        admin_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

        r = client.post(
            "/api/admin/users",
            headers=admin_headers,
            json={"email": LEARNER_EMAIL, "password": LEARNER_PASSWORD, "role": "learner"},
        )
        assert r.status_code in (200, 201), r.text

        r = client.post("/api/auth/login", json={"email": LEARNER_EMAIL, "password": LEARNER_PASSWORD})
        assert r.status_code == 200, r.text
        headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

        # Journey detail strips answers
        r = client.get(f"/api/learner/journeys/{JOURNEY_ID}", headers=headers)
        assert r.status_code == 200, r.text
        detail = r.json()
        assert all("answer" not in a["data"] for a in detail["activities"]), "answer leaked!"
        print("journey detail ok (answers stripped)")

        # Scenario: correct first attempt
        result = _submit(
            client, headers, ACT["scenario"],
            answers={"option_id": "b"}, duration_s=12.5, hints_used=0,
            self_corrections=0, confidence=4,
        )
        assert result["passed"] is True
        assert result["xp_earned"] == 20, result
        assert result["mastery"] and result["mastery"]["concept_id"] == CONCEPT["redflags"]
        print(f"scenario pass ok (xp=20, mastery={result['mastery']['score']})")

        # Puzzle: correct
        result = _submit(
            client, headers, ACT["puzzle"],
            answers={"solutions": {"i1": "Safe", "i2": "Risky"}},
            hints_used=1, self_corrections=1, confidence=3,
        )
        assert result["passed"] is True
        assert result["xp_earned"] == 17, result  # 20 * (1 - 0.15)
        print("puzzle pass ok (xp=17 with one hint)")

        # Simulation: correct
        result = _submit(
            client, headers, ACT["simulation"],
            answers={"option_ids": ["a", "c"]}, confidence=4,
        )
        assert result["passed"] is True
        assert result["xp_earned"] == 30, result
        print("simulation pass ok (xp=30)")

        # Mission: correct
        result = _submit(
            client, headers, ACT["mission"],
            answers={}, tasks_completed=2, confidence=4,
        )
        assert result["passed"] is True
        assert result["xp_earned"] == 25, result
        print("mission ok (tasks_completed gating works)")

        # Profile stats
        r = client.get("/api/auth/me", headers=headers)
        profile = r.json()["profile"]
        assert profile["xp"] == 92, profile  # 20 + 17 + 30 + 25
        assert profile["level"] >= 1
        assert profile["streak_count"] >= 1
        print(f"profile stats ok (xp={profile['xp']}, level={profile['level']}, streak={profile['streak_count']})")

        # Progress
        r = client.get("/api/learner/progress", headers=headers)
        assert r.status_code == 200, r.text
        progress = r.json()
        assert len(progress["mastery"]) >= 2
        print(f"progress ok ({len(progress['mastery'])} concepts)")

        # Nudges
        r = client.get("/api/learner/nudges", headers=headers)
        assert r.status_code == 200, r.text
        print(f"nudges ok ({len(r.json())} nudges)")

        # Voice config
        r = client.get("/api/voice/config", headers=headers)
        assert r.status_code == 200, r.text
        config = r.json()
        assert set(config) == {"enabled", "stt_provider", "language"}, config
        print(f"voice config ok")

        # Voice TTS (graceful skip if disabled)
        r = client.post("/api/voice/tts", headers=headers, json={"text": "Welcome back, learner!"})
        if r.status_code == 200:
            assert r.headers["content-type"].startswith("audio/mpeg"), r.headers
            print(f"tts ok ({len(r.content)} bytes)")
        elif r.status_code == 502:
            print(f"tts skipped (502)")
        else:
            raise AssertionError(f"unexpected tts status {r.status_code}: {r.text}")

        # Voice STT (graceful skip if disabled)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(16000)
            w.writeframes(struct.pack("<h", 0) * 16000)  # 1s of silence
        wav = buf.getvalue()

        r = client.post(
            "/api/voice/stt",
            headers=headers,
            files={"audio": ("clip.wav", wav, "audio/wav")},
        )
        if r.status_code == 200:
            assert "transcript" in r.json(), r.text
            print("stt ok")
        elif r.status_code == 502:
            print(f"stt skipped (502)")
        else:
            raise AssertionError(f"unexpected stt status {r.status_code}: {r.text}")

        # Auth guards
        assert client.get("/api/learner/progress").status_code == 401
        assert client.get("/api/voice/config").status_code == 401
        print("auth guards ok")

    print("ALL PHASE 3 TESTS PASSED")
    sys.exit(0)


if __name__ == "__main__":
    main()
