"""Voice proxy: browser-first STT, server-side ElevenLabs TTS with caching.

ElevenLabs endpoints used (verified against the v1 API docs):
- TTS:  POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128
        header `xi-api-key`, JSON body {text, model_id, voice_settings, language_code}
        -> audio/mpeg bytes
- STT:  POST https://api.elevenlabs.io/v1/speech-to-text
        header `xi-api-key`, multipart: file, model_id=scribe_v1, language_code
        -> {"text": ..., "language_code": ...}
"""

from __future__ import annotations

import threading
from collections import OrderedDict

import httpx
from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from fastapi.responses import Response
from pydantic import BaseModel, Field

from app.core.config import settings
from app.core.deps import get_current_user, get_db
from app.models import User
from app.services.settings_store import get_group
from sqlalchemy.orm import Session

router = APIRouter(prefix="/voice", tags=["voice"])

ELEVEN_BASE = "https://api.elevenlabs.io"
# Premade "George" voice from the official ElevenLabs docs; used as a demo
# fallback so TTS works out of the box. Override via the `voice` settings group
# or the ELEVENLABS_VOICE_ID env var.
DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"
TTS_OUTPUT_FORMAT = "mp3_44100_128"
STT_MODEL = "scribe_v1"
TTS_TIMEOUT_S = 30.0
CACHE_MAX_ENTRIES = 128
MAX_TTS_CHARS = 2000  # cost guard

_tts_cache: "OrderedDict[tuple, bytes]" = OrderedDict()
_cache_lock = threading.Lock()


class TTSRequest(BaseModel):
    text: str = Field(min_length=1, max_length=MAX_TTS_CHARS)
    language: str | None = Field(default=None, pattern="^(en|ur)$")


def _voice_group(db: Session) -> dict:
    return get_group(db, "voice")


def _voice_id(db: Session) -> str:
    group = _voice_group(db)
    return str(group.get("voice_id") or settings.ELEVENLABS_VOICE_ID or DEFAULT_VOICE_ID).strip()


def _require_ready(db: Session) -> tuple[dict, str, str]:
    group = _voice_group(db)
    if not group.get("enabled", False):
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Voice is disabled in settings")
    api_key = settings.ELEVENLABS_API_KEY
    if not api_key:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "ELEVENLABS_API_KEY is not configured")
    return group, api_key, _voice_id(db)


@router.get("/config", response_model=dict)
def voice_config(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
) -> dict:
    group = _voice_group(db)
    return {
        "enabled": bool(group.get("enabled", False)),
        "stt_provider": str(group.get("stt_provider", "browser_first")),
        "language": str(group.get("language", "en")),
    }


@router.post("/tts")
async def text_to_speech(
    body: TTSRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    group, api_key, voice_id = _require_ready(db)
    language = body.language or str(group.get("language", "en"))
    model = str(group.get("tts_model", "eleven_flash_v2_5"))

    cache_key = (body.text, voice_id, model, language)
    if group.get("cache_tts", True):
        with _cache_lock:
            cached = _tts_cache.get(cache_key)
            if cached is not None:
                _tts_cache.move_to_end(cache_key)
                return Response(content=cached, media_type="audio/mpeg")

    payload: dict = {
        "text": body.text,
        "model_id": model,
        "voice_settings": {
            "stability": float(group.get("stability", 0.5)),
            "similarity_boost": float(group.get("similarity_boost", 0.75)),
            "style": float(group.get("style", 0.0)),
        },
    }
    # Flash v2.5 supports ISO-639-1 language enforcement
    if language:
        payload["language_code"] = language

    url = f"{ELEVEN_BASE}/v1/text-to-speech/{voice_id}"
    try:
        async with httpx.AsyncClient(timeout=TTS_TIMEOUT_S) as client:
            response = await client.post(
                url,
                params={"output_format": TTS_OUTPUT_FORMAT},
                headers={"xi-api-key": api_key, "Content-Type": "application/json"},
                json=payload,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"TTS provider unreachable: {exc}")

    if response.status_code != 200:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"TTS provider error {response.status_code}: {response.text[:200]}",
        )

    audio = response.content
    if group.get("cache_tts", True):
        with _cache_lock:
            _tts_cache[cache_key] = audio
            _tts_cache.move_to_end(cache_key)
            while len(_tts_cache) > CACHE_MAX_ENTRIES:
                _tts_cache.popitem(last=False)

    return Response(content=audio, media_type="audio/mpeg")


@router.post("/stt")
async def speech_to_text(
    audio: UploadFile,
    language: str | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> dict:
    group, api_key, _ = _require_ready(db)
    data = await audio.read()
    if not data:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Empty audio upload")

    files = {"file": (audio.filename or "audio.webm", data, audio.content_type or "application/octet-stream")}
    form: dict = {"model_id": STT_MODEL}
    lang = language or str(group.get("language", "")) or None
    if lang:
        form["language_code"] = lang

    try:
        async with httpx.AsyncClient(timeout=TTS_TIMEOUT_S) as client:
            response = await client.post(
                f"{ELEVEN_BASE}/v1/speech-to-text",
                headers={"xi-api-key": api_key},
                files=files,
                data=form,
            )
    except httpx.HTTPError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"STT provider unreachable: {exc}")

    if response.status_code != 200:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"STT provider error {response.status_code}: {response.text[:200]}",
        )

    result = response.json()
    return {
        "transcript": result.get("text", ""),
        "language_code": result.get("language_code"),
    }
