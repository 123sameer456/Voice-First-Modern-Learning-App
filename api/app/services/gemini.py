import json

from google import genai
from google.genai import types as genai_types
from pydantic import BaseModel

from app.core.config import settings


class GeminiError(Exception):
    """Raised when a Gemini call fails or returns an unusable response."""


def _client() -> genai.Client:
    if not settings.GEMINI_API_KEY:
        raise GeminiError("GEMINI_API_KEY is not configured")
    return genai.Client(api_key=settings.GEMINI_API_KEY)


def generate_json(
    model_cls: type[BaseModel],
    prompt: str,
    *,
    model: str | None = None,
    temperature: float = 0.6,
) -> BaseModel:
    """Generate a structured JSON response validated against `model_cls`.

    Cost controls: thinking is disabled (thinking_budget=0) and the default
    model is gemini-2.5-flash (cheap tier). Both are configurable.
    """
    client = _client()
    try:
        response = client.models.generate_content(
            model=model or settings.GEMINI_MODEL,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=model_cls,
                temperature=temperature,
                thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
            ),
        )
    except Exception as exc:
        raise GeminiError(f"Gemini request failed: {exc}") from exc

    if not response.text:
        raise GeminiError("Gemini returned an empty response")
    try:
        return model_cls.model_validate_json(response.text)
    except Exception as exc:
        raise GeminiError(f"Gemini response did not match the expected schema: {exc}") from exc


def generate_json_raw(
    prompt: str,
    *,
    model: str | None = None,
    temperature: float = 0.6,
) -> dict | list:
    """JSON-mode generation without a response schema.

    Used for heterogeneous payloads (e.g. activity shapes per type) where the
    Developer API rejects `additionalProperties` in generated schemas. The
    caller validates the returned dict in Python.
    """
    client = _client()
    try:
        response = client.models.generate_content(
            model=model or settings.GEMINI_MODEL,
            contents=prompt,
            config=genai_types.GenerateContentConfig(
                response_mime_type="application/json",
                temperature=temperature,
                thinking_config=genai_types.ThinkingConfig(thinking_budget=0),
            ),
        )
    except Exception as exc:
        raise GeminiError(f"Gemini request failed: {exc}") from exc

    if not response.text:
        raise GeminiError("Gemini returned an empty response")
    try:
        data = json.loads(response.text)
    except json.JSONDecodeError as exc:
        raise GeminiError(f"Gemini returned invalid JSON: {exc}") from exc
    if not isinstance(data, (dict, list)):
        raise GeminiError("Gemini returned unexpected JSON root")
    return data
