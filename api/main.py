"""Vercel Serverless entrypoint — exposes the FastAPI ASGI app on /api/*."""

from app.main import app  # noqa: F401


# nothing here