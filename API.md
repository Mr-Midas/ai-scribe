# Note Scribe AI API

## Overview

Enterprise-grade REST API for clinical documentation. Generates structured SOAP notes from raw shorthand notes, with EHR-specific formatting for TherapyBOSS and Kinnser.

**Base URL:** `https://note-scribe-ai-api.thomelfin529.workers.dev`

## Authentication

All endpoints (except `/health` and `/usage`) require an API key:

```
X-API-Key: your-api-key-here
```

Each client gets its own key from the Note Scribe administrator. Keep it secret: never put it in source code, browser extensions you distribute, or documentation. Check a key with `GET /api/v1/auth/check`.

**Tiers:**
| Tier | Rate Limit | Use Case |
|------|-----------|----------|
| demo | 10 req/min (shared) | Public testing key `nscrb_demo_a1d59ec7e179b6b9`. Made-up data only. |
| standard | 100 req/min | Trial / evaluation |
| premium | 1000 req/min | Production |
| unlimited | No limit | Enterprise OEM |

## Features

- Model: Groq `openai/gpt-oss-120b` (OpenRouter fallback only when explicitly enabled; see Model Chain)
- Every value in the note is checked against the raw notes; unresolved notes return `review_required: true`
- Automatic retry with clinical validation feedback (up to 3 attempts)
- Deep structured data extraction (Section GG, CPT codes, ROM, MMT)
- EHR-specific formatters (TherapyBOSS, Kinnser)
- Webhook auto-delivery after generation
- The API does not store note text (model provider retention: see HIPAA status)
- Audit logging (metadata only, no PHI)

## Endpoints

### Health Check

```
GET /api/v1/health
```

### Generate Note

```
POST /api/v1/notes/generate
```

**Headers:**
```
Content-Type: application/json
X-API-Key: nscrb_your_key
```

**Body:**
```json
{
  "raw_notes": "Pt had R shoulder pain 5/10...",
  "note_type": "initial-eval",
  "target_ehr": "therapyboss",
  "system_prompt": "optional custom prompt",
  "webhook_url": "https://your-ehr.com/webhook",
  "webhook_secret": "optional signing secret"
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| raw_notes | string | Yes | Raw shorthand notes |
| note_type | string | Yes | `initial-eval` or `treatment` |
| target_ehr | string | No | `therapyboss`, `kinnser`, or omit |
| payer | string | No | `medicare-home-health` adds a `reimbursement` documentation checklist to the response. Omit to skip. |
| system_prompt | string | No | Replaces the built-in prompt. Not recommended: the built-in prompt is what the evaluation suite tests. Grounding checks still run. |
| webhook_url | string | No | Auto-deliver formatted note to this URL |
| webhook_secret | string | No | Secret for the `X-Signature` HMAC-SHA256 header (see Webhook Delivery) |

**Response:**
```json
{
  "success": true,
  "review_required": false,
  "note": "Subjective: ...\nObjective: ...",
  "structured": {
    "subjective": "...",
    "objective": "...",
    "assessment": "...",
    "plan": "...",
    "functional_abilities": {
      "goals": [],
      "activities": [],
      "current_level": "Mod A",
      "target_level": "SBA",
      "rom_measurements": [{"side": "R", "joint": "shoulder", "movement": "flexion", "type": "AROM", "start_degrees": 0, "degrees": 120}],
      "strength_grades": [{"side": "R", "muscle_group": "shoulder flexion", "grade": 3, "modifier": "+", "label": "3+/5"}]
    },
    "skin_integrity": {"intact": null, "areas_of_concern": []},
    "codes": {"g_codes": [], "cpt_codes": [], "modifiers": []},
    "safety_observations": {
      "hand_placements": [],
      "time_to_complete": 8,
      "attempts": 2,
      "cues": ["verbal"],
      "fall_risk": false
    },
    "equipment_used": ["reacher"]
  },
  "validation": {
    "valid": true,
    "issues": [],
    "warnings": []
  },
  "formatted": {},
  "metadata": {
    "note_type": "initial-eval",
    "target_ehr": "therapyboss",
    "model_used": "groq:openai/gpt-oss-120b",
    "attempts": 1,
    "duration_ms": 3200,
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

**Reliability fields:**

- `review_required`: `true` when the note still failed validation after 3 attempts, for example because it contains a measurement, score, grade or billing code that is not in `raw_notes`. **Do not file these automatically.** Show the note to the clinician, with `validation.issues`, for review.
- `validation.issues`: problems that block automatic filing (invented values or codes, missing SOAP sections).
- `validation.warnings`: documentation gaps worth surfacing (no assistance level, skin integrity not documented). They never trigger a retry, because the model is never asked to add data the clinician didn't record.
- `structured` ROM and MMT values that don't appear in `raw_notes` are dropped, so they never reach discrete EHR fields.
- `skin_integrity.intact` is `null` when the note doesn't document skin.

### Extract Structured Data

```
POST /api/v1/notes/extract
```

**Body:**
```json
{
  "note_text": "Subjective: ...",
  "note_type": "initial-eval",
  "raw_notes": "optional; when given, ROM/MMT values not found in it are dropped"
}
```

### Format for EHR

```
POST /api/v1/notes/format
```

**Body:**
```json
{
  "structured_data": {},
  "target_ehr": "therapyboss"
}
```

### Reimbursement Documentation Check

```
POST /api/v1/notes/reimbursement-check
```

Checks raw notes against a payer's documentation requirements, without generating a note. The same result is returned as `reimbursement` by `/notes/generate` when `payer` is set.

```json
{ "raw_notes": "Visit 45 min. Instructed in LB dressing w/ reacher, mod A...", "note_type": "treatment", "payer": "medicare-home-health" }
```

Response:
```json
{
  "success": true,
  "reimbursement": {
    "payer": "medicare-home-health",
    "payer_name": "Medicare home health",
    "last_reviewed": "2026-10-02",
    "verified_by_expert": false,
    "disclaimer": "Documentation reminders only, not a coverage or billing determination. ...",
    "items": [
      { "id": "homebound", "requirement": "Homebound status", "status": "missing", "hint": "Say why leaving home takes a considerable and taxing effort ...", "source": "Medicare Benefit Policy Manual (Pub. 100-02), Ch. 7, §30.1.1; 42 CFR 409.42(a)" },
      { "id": "visit_length", "requirement": "Visit length", "status": "found", "hint": "...", "source": "Medicare Claims Processing Manual (Pub. 100-04), Ch. 10" }
    ]
  }
}
```

- `status` is `found`, `missing`, or `reminder` (a requirement one note can't show, such as the 30-day functional reassessment).
- Items are checked against `raw_notes`, never the generated note, and are never sent back to the model, so the AI is not asked to add documentation the clinician didn't write.
- Treatment notes check: homebound status, skilled service, objective measurement, patient response, functional goals, visit length, and the 30-day reassessment reminder. Initial evaluations also check plan-of-care frequency and duration.
- The rules have not yet been verified by a billing professional (`verified_by_expert: false`).

### Validate Note

```
POST /api/v1/notes/validate
```

**Body:**
```json
{
  "note_text": "Subjective: ...",
  "note_type": "treatment",
  "target_ehr": "kinnser",
  "raw_notes": "optional; when given, values and codes not found in it are reported as issues"
}
```

### Webhook Delivery

```
POST /api/v1/webhooks/deliver
```

**Body:**
```json
{
  "webhook_url": "https://your-ehr.com/webhook",
  "payload": {},
  "secret": "signing-secret"
}
```

**Verifying webhook signatures:** when a secret is set, each delivery carries `X-Signature: sha256=<hex>`, the HMAC-SHA256 of the raw request body using your secret. Compute the same HMAC over the body bytes exactly as received, before parsing the JSON, and compare it in constant time.

## EHR Formatters

### TherapyBOSS

```json
{
  "note_type": "progress_note",
  "current_status": "...",
  "treatments": "...",
  "assessments": "...",
  "outcomes": "...",
  "functional_abilities": {},
  "safety_observations": {},
  "skin_integrity": {},
  "codes": {},
  "equipment_used": []
}
```

### Kinnser

```json
{
  "document_type": "progress_note",
  "clinical_note": {},
  "functional_status": {},
  "skin_integrity": {},
  "safety_data": {},
  "billing_codes": {},
  "equipment_used": []
}
```

## Retry Logic

The API automatically retries generation with validation feedback:

1. Generate note with LLM
2. Validate clinical content (SOAP structure, assistance levels, terminology)
3. If validation fails, send feedback to LLM and retry
4. Up to 3 attempts total
5. Returns best effort + validation warnings if all attempts fail

## Model Chain

1. Groq, `openai/gpt-oss-120b` (override with `GROQ_MODEL`). On a rate limit the API waits (up to 10 s) and retries.
2. OpenRouter, only when `OPENROUTER_FALLBACK=enabled`. Off by default: OpenRouter forwards to many upstream providers that a single BAA cannot cover.

## HIPAA status

**Not HIPAA compliant yet. Do not send real patient-identifying information during the pilot.** What is in place today:

- Encrypted in transit (HTTPS)
- The API does not store raw notes or generated notes
- Audit logging records metadata only (no note content), when `AUDIT_LOG_URL` is set
- No OpenRouter routing unless explicitly enabled

Not yet in place: BAAs with the AI provider (Groq) and the host (Cloudflare), confirmed provider data retention, individual user accounts, and a security risk assessment. The plan and current status are in the README under [Path to HIPAA compliance](README.md#path-to-hipaa-compliance).

## Error Responses

```json
{
  "error": "Missing required fields: raw_notes, note_type"
}
```

| Status | Description |
|--------|-------------|
| 400 | Bad request |
| 500 | Server error (all models failed) |

## SDK Examples

### JavaScript
```javascript
const response = await fetch('https://note-scribe-ai-api.thomelfin529.workers.dev/api/v1/notes/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    raw_notes: 'Pt had R shoulder pain 5/10...',
    note_type: 'initial-eval',
    target_ehr: 'therapyboss',
    webhook_url: 'https://your-ehr.com/webhook'
  })
});
const data = await response.json();
```

### Python
```python
import requests

response = requests.post(
    'https://note-scribe-ai-api.thomelfin529.workers.dev/api/v1/notes/generate',
    json={
        'raw_notes': 'Pt had R shoulder pain 5/10...',
        'note_type': 'initial-eval',
        'target_ehr': 'therapyboss',
        'webhook_url': 'https://your-ehr.com/webhook'
    }
)
data = response.json()
```

### cURL
```bash
curl -X POST https://note-scribe-ai-api.thomelfin529.workers.dev/api/v1/notes/generate \
  -H "Content-Type: application/json" \
  -d '{
    "raw_notes": "Pt had R shoulder pain 5/10...",
    "note_type": "initial-eval",
    "target_ehr": "therapyboss"
  }'
```
