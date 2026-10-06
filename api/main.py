"""Vercel Serverless entrypoint — exposes the FastAPI ASGI app on /api/*.

Vercel imports this file with the repo root on sys.path (not api/), so the
`app` package next to this file must be added to the path explicitly.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.main import app  # noqa: F401, E402


# nothing here