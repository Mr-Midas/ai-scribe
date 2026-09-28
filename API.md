# Note Scribe AI API

## Overview

Enterprise-grade REST API for clinical documentation. Generates structured SOAP notes from raw shorthand notes, with EHR-specific formatting for TherapyBOSS and Kinnser.

**Base URL:** `https://note-scribe-ai-api.thomelfin529.workers.dev`

## Endpoints

### Health Check

```
GET /api/v1/health
```

**Response:**
```json
{
  "status": "healthy",
  "version": "2.0.0",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Generate Note

```
POST /api/v1/notes/generate
```

**Headers:**
```
Content-Type: application/json
X-API-Key: your-api-key-here
```

**Body:**
```json
{
  "raw_notes": "Pt had R shoulder pain 5/10...",
  "note_type": "initial-eval",
  "target_ehr": "therapyboss",
  "system_prompt": "optional custom prompt"
}
```

**Parameters:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| raw_notes | string | Yes | Raw shorthand notes |
| note_type | string | Yes | `initial-eval` or `treatment` |
| target_ehr | string | No | `therapyboss`, `kinnser`, or omit |
| system_prompt | string | No | Custom system prompt |

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
    "functional_abilities": {...},
    "skin_integrity": {...},
    "codes": {...}
  },
  "validation": {
    "valid": true,
    "issues": [],
    "warnings": []
  },
  "formatted": {
    "note_type": "progress_note",
    "current_status": "...",
    ...
  },
  "metadata": {
    "note_type": "initial-eval",
    "target_ehr": "therapyboss",
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
  "structured_data": {...},
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
  "note_type": "treatment"
}
```

**Response:**
```json
{
  "success": true,
  "validation": {
    "valid": true,
    "issues": [],
    "warnings": ["Treatment note should document progress"]
  }
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
  "payload": {...},
  "secret": "optional-signing-secret"
}
```

## EHR Formatters

### TherapyBOSS

Returns structured progress note format:
```json
{
  "note_type": "progress_note",
  "current_status": "...",
  "treatments": "...",
  "assessments": "...",
  "outcomes": "...",
  "functional_abilities": {...},
  "safety_observations": {...}
}
```

### Kinnser

Returns Kinnser-specific format:
```json
{
  "document_type": "progress_note",
  "clinical_note": {...},
  "functional_status": {...},
  "skin_integrity": {...},
  "safety_data": {...},
  "billing_codes": {...}
}
```

## Model Chain

The API uses a fallback chain for reliability:
1. Groq (Llama 3 70B) - primary
2. OpenRouter (Llama 3.1 70B) - fallback

## Rate Limiting

- 100 requests/minute per API key
- 1000 requests/day per API key

## Error Responses

```json
{
  "error": "Missing required fields: raw_notes, note_type"
}
```

Common status codes:
- `400` - Bad request
- `401` - Missing/invalid API key
- `500` - Server error (all models failed)

## HIPAA Compliance

- Zero-retention policy: no data stored
- Encrypted in transit (TLS 1.3)
- No PHI in logs
- Audit logging available

## SDK Examples

### JavaScript
```javascript
const response = await fetch('https://note-scribe-ai-api.thomelfin529.workers.dev/api/v1/notes/generate', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    raw_notes: 'Pt had R shoulder pain 5/10...',
    note_type: 'initial-eval',
    target_ehr: 'therapyboss'
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
        'target_ehr': 'therapyboss'
    }
)
data = response.json()
```

## Chrome Extension

The Chrome extension uses the same API. Load it from the `ai-scribe` folder for individual therapist use.
