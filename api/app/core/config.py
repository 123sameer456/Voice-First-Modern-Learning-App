from pathlib import Path

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

# config.py is at api/app/core/config.py
API_DIR = Path(__file__).resolve().parents[2]
ROOT_DIR = Path(__file__).resolve().parents[3]


class Settings(BaseSettings):
    """App settings. Reads the repo-root .env; falls back to safe dev defaults."""

    model_config = SettingsConfigDict(
        env_file=str(ROOT_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Environment
    ENVIRONMENT: str = "dev"

    # Database (plain SQLite3 file for the demo). On Vercel the repo filesystem
    # is read-only, so in production the DB defaults to /tmp (resets on cold
    # start; seed fixtures rebuild demo content automatically).
    DATABASE_URL: str = ""

    # Turso (libSQL) persistent database. When both are set in a prod
    # environment, DATABASE_URL is derived from these and all data persists.
    # Accepts libsql://... or sqlite+libsql://... — the auth token is appended.
    TURSO_DATABASE_URL: str = ""
    TURSO_AUTH_TOKEN: str = ""

    # Auth / JWT
    JWT_SECRET: str = "dev-only-secret-change-me"
    JWT_ALG: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Bootstrap admin (created on first run only)
    INITIAL_ADMIN_EMAIL: str = "admin@ubl-demo.com"
    INITIAL_ADMIN_PASSWORD: str = "ubl-demo-2026"
    # Demo learner created alongside seed fixtures for the panel demo
    DEMO_LEARNER_EMAIL: str = "learner@ubl-demo.com"
    DEMO_LEARNER_PASSWORD: str = "learner-demo-2026"

    @model_validator(mode="after")
    def _finalize_and_guard(self):
        # Resolve the DB URL only after env vars are loaded (class-body defaults
        # cannot see the configured ENVIRONMENT).
        if not self.DATABASE_URL:
            if self.ENVIRONMENT == "prod":
                self.DATABASE_URL = "sqlite:////tmp/app.db"
            else:
                self.DATABASE_URL = f"sqlite:///{(API_DIR / 'app.db').as_posix()}"
        # Turso persistence (prod only — local dev keeps the file DB; the
        # libsql dialect also cannot build on Windows/3.13 locally).
        if self.ENVIRONMENT == "prod" and self.TURSO_DATABASE_URL.strip():
            url = self.TURSO_DATABASE_URL.strip()
            if url.startswith("libsql://"):
                url = "sqlite+libsql://" + url[len("libsql://") :]
            sep = "&" if "?" in url else "?"
            self.DATABASE_URL = f"{url}{sep}authToken={self.TURSO_AUTH_TOKEN}&ssl=true"
        if self.ENVIRONMENT == "prod":
            if self.JWT_SECRET == "dev-only-secret-change-me":
                raise ValueError("JWT_SECRET must be set in production")
            if self.JWT_ALG.lower() == "none":
                raise ValueError("JWT_ALG=none is not allowed")
        return self

    # CORS / uploads
    FRONTEND_ORIGIN: str = "http://localhost:5173"
    MAX_UPLOAD_SIZE_MB: int = 10

    # AI providers (cost-optimized defaults; override in .env / Vercel env)
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-3.5-flash"
    GEMINI_LITE_MODEL: str = "gemini-3.5-flash-lite"
    ELEVENLABS_API_KEY: str = ""
    ELEVENLABS_VOICE_ID: str = ""


settings = Settings()
