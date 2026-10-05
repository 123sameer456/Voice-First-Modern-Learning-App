"""One-time script: generate the two demo journeys (English + Urdu) with real
Gemini calls and persist them as committed fixtures under
api/app/seed_data/journeys/. Production cold starts reload these fixtures
instead of calling Gemini (cost + latency control).

Run:  $env:PYTHONPATH = '<repo>/api';  venv/Scripts/python.exe scripts/generate_seed_fixtures.py
"""
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

from app.db.session import SessionLocal
from app.models import ContentSource, Journey, Setting
from app.seed import SEED_DATA_DIR, init_db
from app.services import journey_generator

ENGLISH_TOPIC = (
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

URDU_TOPIC = (
    "دفتری وقت کا انتطار اور ذمہ داریاں۔ وقت کا انتظام (ٹائم مینجمنٹ) کا مطلب ہے اپنے کاموں کو ترجیح کے "
    "مطابق ترتیب دینا تاکہ ہر کام وقت پر مکمل ہو۔ آئزن ہاور کے میٹرکس کے مطابق کاموں کو چار اقسام میں "
    "تقسیم کیا جاتا ہے: اہم اور فوری، اہم مگر غیر فوری، غیر اہم مگر فوری، اور غیر اہم و غیر فوری۔ "
    "پوموڈورو تکنیک میں پچیس منٹ کام کر کے پانچ منٹ کا وقفہ لیا جاتا ہے۔ ملٹی ٹسکنگ سے بچنا چاہیے "
    "کیونکہ اس سے غلطیوں کا خطرہ بڑھ جاتا ہے۔ ای میلز کے لیے مخصوص اوقات مقرر کرنے سے توجہ میں مدد "
    "ملتی ہے۔ ہر دن کے آخر میں اگلے دن کی ٹو ڈو لسٹ تیار کرنی چاہیے۔"
)


def dump_journey(db, journey: Journey, source: ContentSource, out_path: Path) -> None:
    fixture = {
        "source": {"type": source.type, "title": source.title, "raw_text": source.raw_text},
        "journey": {
            "title": journey.title,
            "description": journey.description,
            "config_snapshot": journey.config_snapshot,
            "published_at": datetime.now(timezone.utc).isoformat(),
        },
        "concepts": [
            {"title": c.title, "description": c.description, "order": c.order}
            for c in journey.concepts
        ],
        "activities": [
            {
                "concept_index": next(
                    (i for i, c in enumerate(journey.concepts) if c.id == a.concept_id), None
                ),
                "type": a.type,
                "difficulty": a.difficulty,
                "payload": a.payload,
                "order": a.order,
                "xp": a.xp,
            }
            for a in journey.activities
        ],
    }
    out_path.write_text(json.dumps(fixture, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"wrote fixture: {out_path.name}")


def main() -> None:
    init_db()
    out_dir = Path(SEED_DATA_DIR)
    out_dir.mkdir(parents=True, exist_ok=True)

    plans = [
        ("en", "Fire Safety (English demo)", ENGLISH_TOPIC, "fire-safety-en.json"),
        ("ur", "وقت کا انتظام (اردو ڈیمو)", URDU_TOPIC, "time-management-ur.json"),
    ]
    failed = False
    for lang, title, topic_text, filename in plans:
        db = SessionLocal()
        try:
            # Point content generation at this language for the fixture run
            setting = db.get(Setting, "content")
            original = dict(setting.value)
            setting.value = {**original, "default_language": lang}
            db.commit()

            source = ContentSource(
                type="topic",
                title=title,
                raw_text=topic_text,
                status="processed",
                created_by=1,
            )
            db.add(source)
            db.commit()
            db.refresh(source)

            print(f"generating {lang.upper()} journey (2 Gemini calls)...")
            journey = journey_generator.generate_journey(db, source)
            journey.status = "published"
            db.commit()
            db.refresh(journey)

            dump_journey(db, journey, source, out_dir / filename)

            # restore the admin-configured default language
            setting.value = original
            db.commit()
        except Exception as exc:  # noqa: BLE001
            failed = True
            print(f"FAILED for {lang}: {exc}", file=sys.stderr)
        finally:
            db.close()

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
