"""Dump the OpenAPI schema to docs/openapi.json (shared API contract)."""
import json
from pathlib import Path

from app.main import app

out = Path(__file__).resolve().parents[1] / "docs" / "openapi.json"
out.write_text(json.dumps(app.openapi(), indent=2, default=str))
print(f"Wrote {out}")
