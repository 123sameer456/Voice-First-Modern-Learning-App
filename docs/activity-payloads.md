# Activity Payload Contract

Every `Activity.payload` is a JSON object with three keys:

- `data` — learner-visible content the frontend renders
- `answer` — grading key, SERVER-ONLY. Never sent to learners (stripped by `GET /learner/journeys/{id}`)
- `meta` — server metadata: `needs_review` (bool), `issues` (list), `source_refs` (quotes from the source document), `model_confidence` (0-1)

Activity `type` selects the renderer in the journey player.

## scenario — decision-making with a best choice

```json path=null start=null
{
  "data": {
    "prompt": "A colleague shares a screenshot of a suspicious email asking for payroll data.",
    "options": [
      {"id": "a", "text": "Reply and ask if it's really HR"},
      {"id": "b", "text": "Report it to IT security and delete it"},
      {"id": "c", "text": "Forward it to the team group"},
      {"id": "d", "text": "Ignore it"}
    ]
  },
  "answer": {"correct_option_id": "b", "rationale": "The source says report phishing to IT security."}
}
```

## puzzle — classification or ordering

```json path=null start=null
{
  "data": {
    "instruction": "Sort each action into the right bucket",
    "mode": "match",                      // "match" uses "buckets"; "order" ranks items
    "buckets": ["Safe", "Risky"],
    "items": [
      {"id": "i1", "text": "Use the company password manager"},
      {"id": "i2", "text": "Share your password with a colleague"}
    ]
  },
  "answer": {"solutions": {"i1": "Safe", "i2": "Risky"}}   // match: bucket name; order: 1-based position
}
```

## simulation — multi-step role play (2-4 sequential decisions)

```json path=null start=null
{
  "data": {
    "scenario": "You are the HR on-call officer during a data-breach alert.",
    "steps": [
      {"prompt": "First move?", "options": [{"id": "a", "text": "..."}, {"id": "b", "text": "..."}]},
      {"prompt": "The alert escalates. What now?", "options": [{"id": "a", "text": "..."}, {"id": "b", "text": "..."}]}
    ]
  },
  "answer": {"correct_option_ids": ["a", "b"]}
}
```

## mission — apply knowledge to a real task (self-reported completion)

```json path=null start=null
{
  "data": {
    "briefing": "Audit your own inbox for phishing indicators.",
    "tasks": ["Check sender addresses on 3 recent emails", "Enable 2FA on your account"],
    "success_criteria": "Learner reports completing at least 2 tasks"
  },
  "answer": {"min_tasks": 2}
}
```

## Learner-visible shape

`GET /learner/journeys/{id}` returns activities as:

```json path=null start=null
{"id": 12, "concept_id": 4, "type": "scenario", "difficulty": 2, "xp": 20, "order": 0, "data": { ... }}
```

Grading happens server-side via the submit endpoint (Phase 3); the frontend never
sees `answer` or `meta`.
