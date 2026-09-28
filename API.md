# Note Scribe AI API

## Overview

Enterprise-grade REST API for clinical documentation. Generates structured SOAP notes from raw shorthand notes, with EHR-specific formatting for TherapyBOSS and Kinnser.

**Base URL:** `https://note-scribe-ai-api.thomelfin529.workers.dev`

## Authentication

All endpoints (except `/health` and `/usage`) require an API key:

```
X-API-Key: your-api-key-here
```

**Your API key:** `nscrb_72889ea78923476fb19d0338` (premium tier — 1000 req/min)

**Tiers:**
| Tier | Rate Limit | Use Case |
|------|-----------|----------|
| standard | 100 req/min | Trial / evaluation |
| premium | 1000 req/min | Production |
| unlimited | No limit | Enterprise OEM |

## Features

- Multi-model fallback chain (Groq → OpenRouter)
- Automatic retry with clinical validation feedback (up to 3 attempts)
- Deep structured data extraction (Section GG, G-codes, CPT codes, ROM, MMT)
- EHR-specific formatters (TherapyBOSS, Kinnser)
- Webhook auto-delivery after generation
- Zero-retention policy (no data stored)
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
| system_prompt | string | No | Custom system prompt |
| webhook_url | string | No | Auto-deliver formatted note to this URL |
| webhook_secret | string | No | HMAC signature secret |

**Response:**
```json
{
  "success": true,
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
      "rom_measurements": [{"movement": "flexion", "degrees": 120}],
      "strength_grades": []
    },
    "skin_integrity": {"intact": true, "areas_of_concern": []},
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
    "model_used": "groq",
    "attempts": 1,
    "duration_ms": 3200,
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

### Extract Structured Data

```
POST /api/v1/notes/extract
```

**Body:**
```json
{
  "note_text": "Subjective: ...",
  "note_type": "initial-eval"
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

### Validate Note

```
POST /api/v1/notes/validate
```

**Body:**
```json
{
  "note_text": "Subjective: ...",
  "note_type": "treatment",
  "target_ehr": "kinnser"
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

1. Groq (Llama 3 70B) - primary, fastest
2. OpenRouter (Llama 3.1 70B) - fallback

## HIPAA Compliance

- Zero-retention: no raw notes or generated notes stored
- Audit logging: metadata only (no PHI)
- Encrypted in transit (TLS 1.3)
- User IDs hashed in logs
- No model training on API inputs

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
