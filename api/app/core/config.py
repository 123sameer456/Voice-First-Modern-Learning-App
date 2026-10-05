from pathlib import Path

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

    # Database (plain SQLite3 file for the demo; switch URL later if needed)
    DATABASE_URL: str = f"sqlite:///{(API_DIR / 'app.db').as_posix()}"

    # Auth / JWT
    JWT_SECRET: str = "dev-only-secret-change-me"
    JWT_ALG: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Bootstrap admin (created on first run only)
    INITIAL_ADMIN_EMAIL: str = "admin@ubl-demo.com"
    INITIAL_ADMIN_PASSWORD: str = "ubl-demo-2026"

    # CORS / uploads
    FRONTEND_ORIGIN: str = "http://localhost:5173"
    MAX_UPLOAD_SIZE_MB: int = 10

    # AI providers (cost-optimized defaults)
    GEMINI_API_KEY: str = ""
    GEMINI_MODEL: str = "gemini-2.5-flash"
    GEMINI_LITE_MODEL: str = "gemini-2.5-flash-lite"
    ELEVENLABS_API_KEY: str = ""
    ELEVENLABS_VOICE_ID: str = ""


settings = Settings()
