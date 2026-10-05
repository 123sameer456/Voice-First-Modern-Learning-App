"""Phase 2 E2E: admin creates a topic, generates a journey (real Gemini calls),
publishes it, creates a learner, and the learner fetches it with answers stripped.

Uses a small amount of Gemini quota (2 flash-tier calls)."""
from fastapi.testclient import TestClient

from app.main import app

ADMIN_EMAIL = "admin@ubl-demo.com"
ADMIN_PASSWORD = "ubl-demo-2026"
LEARNER_EMAIL = "learner1@ubl-demo.com"
LEARNER_PASSWORD = "learner-demo-2026"

TOPIC_TEXT = (
    "Workplace Fire Safety Essentials. Fire safety in the office protects lives and property. "
    "Every employee should know the three elements a fire needs: heat, fuel and oxygen; removing "
    "any one of them extinguishes a fire. Office fires are commonly caused by overloaded power "
    "sockets, faulty electrical equipment, and unattended cooking in the kitchen. The PASS "
    "technique governs fire extinguisher use: Pull the pin, Aim at the base of the fire, Squeeze "
    "the handle, and Sweep side to side. Employees should learn the location of the nearest fire "
    "exits and assembly points. In an evacuation, do not use lifts; use stairs only. Fire wardens "
    "sweep their assigned zones and close doors behind them to slow fire spread. Employers must "
    "conduct fire drills at least twice a year and record the results. Reporting near-misses such "
    "as overheating equipment helps prevent future fires."
)


def main() -> None:
    with TestClient(app) as client:  # no timeout: generation calls can be slow
        # --- admin login ---
        r = client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200, r.text
        admin_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}
        print("admin login ok")

        # --- create topic source ---
        r = client.post(
            "/api/admin/content",
            data={"type": "topic", "title": "Fire Safety", "text": TOPIC_TEXT},
            headers=admin_headers,
        )
        assert r.status_code == 201, r.text
        source = r.json()
        print(f"content created: id={source['id']} type={source['type']}")

        # --- generate journey (2 real Gemini calls) ---
        print("generating journey with Gemini (may take up to a minute)...")
        r = client.post(
            f"/api/admin/content/{source['id']}/generate", headers=admin_headers
        )
        assert r.status_code == 200, r.text
        journey = r.json()
        types = [a["type"] for a in journey["activities"]]
        review = sum(
            1 for a in journey["activities"] if a["payload"].get("meta", {}).get("needs_review")
        )
        print(
            f"journey id={journey['id']} '{journey['title']}' concepts={len(journey['concepts'])} "
            f"activities={len(journey['activities'])} types={types} needs_review={review}"
        )
        assert len(journey["concepts"]) >= 3, "expected at least 3 concepts"
        assert len(journey["activities"]) >= 4, "expected at least 4 activities"

        # --- publish ---
        r = client.post(f"/api/admin/journeys/{journey['id']}/publish", headers=admin_headers)
        assert r.status_code == 200, r.text
        print("journey published")

        # --- create learner via admin API ---
        r = client.post(
            "/api/admin/users",
            json={
                "email": LEARNER_EMAIL,
                "password": LEARNER_PASSWORD,
                "role": "learner",
                "language_pref": "en",
            },
            headers=admin_headers,
        )
        assert r.status_code in (201, 409), r.text  # 409 if test re-run
        print("learner account ready")

        # --- learner login + fetch published journey ---
        r = client.post(
            "/api/auth/login", json={"email": LEARNER_EMAIL, "password": LEARNER_PASSWORD}
        )
        assert r.status_code == 200, r.text
        learner_headers = {"Authorization": f"Bearer {r.json()['access_token']}"}

        r = client.get("/api/learner/journeys", headers=learner_headers)
        assert r.status_code == 200, r.text
        published = r.json()
        print(f"learner sees {len(published)} published journey(s)")
        assert any(j["id"] == journey["id"] for j in published)

        r = client.get(f"/api/learner/journeys/{journey['id']}", headers=learner_headers)
        assert r.status_code == 200, r.text
        learner_journey = r.json()
        assert learner_journey["objectives"], "objectives should be present"
        for activity in learner_journey["activities"]:
            assert "answer" not in activity, "answers must not leak to learners!"
            assert "meta" not in activity, "meta must not leak to learners!"
            assert activity["data"], "learner activities must include data"
        print("answers correctly stripped from learner payload")

        # --- learner must NOT access admin endpoints ---
        r = client.get("/api/admin/users", headers=learner_headers)
        assert r.status_code == 403, r.text
        print("learner blocked from admin routes")

        # --- journey detail keeps answers visible for admin review ---
        r = client.get(f"/api/admin/journeys/{journey['id']}", headers=admin_headers)
        assert r.status_code == 200, r.text
        assert all("answer" in a["payload"] for a in r.json()["activities"])
        print("admin review view retains answer keys")

    print("PHASE 2 E2E PASSED")


if __name__ == "__main__":
    main()
