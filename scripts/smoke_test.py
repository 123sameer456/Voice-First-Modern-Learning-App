"""Phase 1 smoke test: exercises health + full auth flow against the real app + SQLite DB."""
import sys

from fastapi.testclient import TestClient

from app.main import app

ADMIN_EMAIL = "admin@ubl-demo.com"
ADMIN_PASSWORD = "ubl-demo-2026"


def main() -> None:
    with TestClient(app) as client:
        r = client.get("/api/health")
        assert r.status_code == 200, r.text
        print("health:", r.json())

        r = client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD})
        assert r.status_code == 200, r.text
        tokens = r.json()
        assert tokens["user"]["role"] == "admin", tokens
        print("login ok, role:", tokens["user"]["role"])

        headers = {"Authorization": f"Bearer {tokens['access_token']}"}
        r = client.get("/api/auth/me", headers=headers)
        assert r.status_code == 200, r.text
        print("me ok:", r.json()["email"])

        r = client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
        assert r.status_code == 200, r.text
        new_tokens = r.json()
        print("refresh ok")

        # Rotated (single-use) refresh token must now be rejected
        r = client.post("/api/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
        assert r.status_code == 401, r.text
        print("refresh rotation enforced (401 on reuse)")

        r = client.post(
            "/api/auth/logout",
            json={"refresh_token": new_tokens["refresh_token"]},
            headers=headers,
        )
        assert r.status_code == 200, r.text
        print("logout ok")

        r = client.post("/api/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong-password"})
        assert r.status_code == 401, r.text
        print("bad login rejected")

        # Learner route must be protected
        r = client.get("/api/auth/me")
        assert r.status_code == 401, r.text
        print("unauthenticated /me rejected")

    print("ALL SMOKE TESTS PASSED")
    sys.exit(0)


if __name__ == "__main__":
    main()
