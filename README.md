# Note Scribe AI

Note Scribe AI turns therapists' shorthand into SOAP notes. Every measurement, grade, count, date and assist level in a generated note is checked against what the clinician actually wrote. If the AI adds something that isn't in the clinician's notes, the note is rewritten, and if that still fails, it is marked for the clinician to review.

> **Status: pilot. Not HIPAA compliant yet.** Do not enter real patient-identifying information (names, dates of birth, record numbers, addresses) until the steps in [Path to HIPAA compliance](#path-to-hipaa-compliance) are complete.

## Ways to use it

| Who | How |
|-----|-----|
| Therapists | **Web app** at https://note-scribe-ai-api.thomelfin529.workers.dev. Sign in with an access key, paste your notes, copy the result. Nothing to install. |
| EHR companies | **REST API** at the same address. See [API.md](API.md). |
| Chrome extension | Same service, in a browser popup. See [EXTENSION.md](EXTENSION.md). |

## Using the web app (clinicians)

1. Open https://note-scribe-ai-api.thomelfin529.workers.dev
2. Enter the access key your administrator gave you. Tick **Remember me** only on your own computer.
3. Choose **Treatment** or **Initial evaluation**, and the EHR you use if it is listed.
4. Type your notes the way you normally would, then click **Write SOAP note**.
5. Read the note:
   - **Green, "Ready to review"**: every measurement in the note was found in your notes. Still read it before using it.
   - **Amber, "Needs your review"**: the note contains details you did not write. They are listed so you can correct or delete them.
   - Below the note, "Not in your notes" lists things the note does not cover (for example skin integrity). Add them yourself only if you assessed them.
6. Edit if needed, click **Copy note**, and paste it into your EHR.

The web app does not save your notes. Closing the tab clears them.

## Giving someone access (administrators)

Each person gets their own access key, so one person's access can be turned off without affecting anyone else. Until there is an admin page (see the roadmap below), keys are created from this project folder in a terminal:

```bash
# Create a key (prints it once; send it to the person privately)
node -e "console.log('nscrb_' + require('crypto').randomBytes(16).toString('hex'))"
npx wrangler kv key put <the-key> '{"active":true,"tier":"standard","label":"Jane Smith, OT"}' --binding API_KEYS --remote

# Turn a key off (reversible: set active back to true)
npx wrangler kv key put <the-key> '{"active":false,"tier":"standard","label":"Jane Smith, OT"}' --binding API_KEYS --remote
```

Never put a key in source code, documentation or a chat message.

## What it checks, and what it doesn't

The safeguards below catch values the AI adds: numbers, grades, scores, dates, assist levels, billing codes, and ROM or strength values attached to the wrong body part. They do **not** catch invented statements without a value, such as a diagnosis, a precaution, or "patient tolerated treatment well." That is why every note must still be read by the clinician before it is used.

## Data handling today

This describes what actually happens now, not a compliance claim.

- **Where notes go:** the clinician's browser (or an EHR system) sends the notes to the Note Scribe API on Cloudflare Workers, which sends them to the AI model on Groq (`openai/gpt-oss-120b`) and returns the note. All connections use HTTPS.
- **Storage:** the API does not store note text. The web app does not save note text in the browser. The optional audit log (`AUDIT_LOG_URL`) records metadata only: time, model, note type, number of issues.
- **Not yet confirmed:** Groq's and Cloudflare's retention and logging of request data have not been confirmed in writing, and neither has signed a BAA. Cloudflare Workers observability is enabled in `wrangler.toml`; it records request metadata and error messages, not request bodies.
- **OpenRouter** is not used unless `OPENROUTER_FALLBACK=enabled`, because it forwards requests to many upstream providers that a single BAA can't cover.

## Path to HIPAA compliance

There is no official HIPAA certification. Compliance means meeting the HIPAA Privacy, Security and Breach Notification Rules, and having a signed Business Associate Agreement (BAA) with every company that handles patient data on our behalf. Enterprise customers will ask for evidence: the BAAs, a security risk assessment, written policies, and often a SOC 2 report.

**Current status**

| Requirement | Status |
|-------------|--------|
| Encryption in transit (HTTPS) | Done |
| API does not store note text | Done |
| Notes not sent to OpenRouter | Done |
| Each user has their own access key that can be turned off | Done |
| BAA with the AI provider | Not started |
| BAA with the hosting provider | Not started |
| Individual user accounts with multi-factor sign-in and automatic sign-out | Not started (access keys only) |
| Audit trail of who generated which note, and when | Partial (metadata only, when `AUDIT_LOG_URL` is set; no user identity yet) |
| Security risk assessment, written policies, named security officer, staff training | Not started |
| BAAs signed with our own customers | Not started |
| SOC 2 Type II (or HITRUST) report | Not started |

**Phase 1: before any real patient data**

1. **AI provider under a BAA.** Move model calls to a HIPAA-eligible service with a signed BAA (AWS Bedrock, Azure AI Foundry, or Google Vertex AI), using only services and models that its BAA covers. Re-run `npm run eval` on the new model before switching. Groq can stay only if Groq signs a BAA.
2. **Hosting under a BAA.** Cloudflare signs BAAs only on its Enterprise plan. The alternative is to host the API with the same cloud provider as the AI model, so one BAA covers both.
3. **Real user accounts.** Replace shared access keys with individual sign-in, multi-factor authentication, automatic sign-out after inactivity, and immediate deactivation.
4. **Audit trail.** Record which user generated a note and when (never the note content), and keep those records under a written retention policy.
5. **Policies and risk assessment.** Complete a HIPAA security risk assessment, write the required policies (access control, incident response, breach notification), name a security and privacy officer, and train anyone with access.
6. **Customer BAAs.** Note Scribe AI becomes each clinic's or EHR company's business associate, so we sign a BAA with each of them.

**Phase 2: enterprise readiness**

7. A SOC 2 Type II audit (or HITRUST), which EHR companies commonly require of vendors.
8. Independent penetration testing and a vulnerability management process.
9. A second AI provider, also under a BAA, so an outage at one provider doesn't stop note writing.
10. An admin page for creating and turning off access keys and, later, user accounts.

## Enterprise API

Base URL: `https://note-scribe-ai-api.thomelfin529.workers.dev`. Full documentation is in [API.md](API.md).

- Automatic retry with validation feedback (up to 3 attempts) and a 20-second timeout per model call; waits on provider rate limits instead of failing
- Structured data extraction: Section GG, CPT codes, ROM (side, joint, AROM/PROM, degrees), MMT (0-5 with +/-), assistance levels
- EHR-specific formatters for TherapyBOSS and Kinnser
- Webhook delivery after generation, signed with HMAC-SHA256

**Endpoints:**
- `POST /api/v1/notes/generate`: generate a validated SOAP note
- `POST /api/v1/notes/extract`: extract discrete EHR fields
- `POST /api/v1/notes/format`: format for TherapyBOSS or Kinnser
- `POST /api/v1/notes/validate`: validate a note against raw notes
- `POST /api/v1/webhooks/deliver`: deliver to an EHR webhook
- `GET /api/v1/auth/check`: check that an access key is valid

### Reliability safeguards

AI models sometimes add details that sound clinical but were never documented. Every generated note is checked before it is returned:

| Check | What happens |
|-------|--------------|
| **Every value must come from the raw notes, for the same measure.** Each number is read with what it measures (MMT grade, ROM degrees, sets, reps, distance, time, frequency, pain score, age, date, stage/grade) and must match a value the clinician wrote for that same measure, so "3/5" in the raw notes does not allow "3 sets". ROM and MMT values must also match the documented side, joint, motion and AROM/PROM, so a grade or angle moved to another muscle is rejected. Equivalent wording is accepted (1 hour = 60 minutes, ft = feet, "three" = 3, BID = twice daily). Assist levels and Section GG codes must match a documented assist level. | The note is regenerated with the invented values named. If they persist after 3 attempts, the response has `review_required: true`. |
| **No invented billing codes.** CPT, HCPCS and G-codes not present in `raw_notes` | Same as above. (Medicare functional limitation G-codes were discontinued on 1/1/2019 and are never requested.) |
| **All four SOAP sections present.** Full (`Subjective:`) or abbreviated (`S:`) headers | Same as above. Empty sections read "Not documented this session." |
| **Structured fields are grounded.** ROM degrees and MMT grades not documented as ROM / MMT in `raw_notes` | Dropped from `structured` / `formatted`, so they never reach an EHR field. |
| **Gaps are warnings, not retries.** Missing assistance level, skin integrity, goals | Reported in `validation.warnings`. The model is never asked to "add" missing data, because that is how fabrication happens. |

**Integration rule for EHR clients:** if `review_required` is `true`, show the note to the clinician for review instead of filing it automatically. `validation.issues` lists exactly what needs attention.

### Configuration

Set these on the Cloudflare Worker (Dashboard → Workers & Pages → `note-scribe-ai-api` → Settings → Variables and Secrets, or `npx wrangler secret put NAME`):

| Name | Required | Purpose |
|------|----------|---------|
| `MASTER_KEY` | No | Unlimited-tier API key, set only as a secret (`npx wrangler secret put MASTER_KEY`). With no secret set, there is no master key. Never commit it. |
| `GROQ_API_KEY` | Yes | Model provider |
| `OPENROUTER_API_KEY` | No | Fallback model provider, only used when `OPENROUTER_FALLBACK` is `enabled` |
| `OPENROUTER_FALLBACK` | No | Set to `enabled` to send notes to OpenRouter when Groq fails. Off by default because OpenRouter forwards to many upstream providers, so a HIPAA BAA can't cover them all. |
| `GROQ_MODEL` | No | Override the Groq model (default `openai/gpt-oss-120b`) |
| `OPENROUTER_MODEL` | No | Override the OpenRouter model (default `meta-llama/llama-3.1-70b-instruct`) |
| `AUDIT_LOG_URL` | No | Endpoint that receives metadata-only audit events |

`API_KEYS` and `RATE_LIMITS` are KV namespaces already bound in `wrangler.toml`.

Model providers retire models regularly (Groq retired `llama3-70b-8192` in 2025 and `llama-3.3-70b-versatile` in 2026). When that happens, set `GROQ_MODEL` to the replacement. No code change or redeploy is needed. Then run the live evaluation below to confirm quality.

### Deploying

```bash
npm test               # must pass
npx wrangler deploy
```

### Testing

- **Unit tests** (`npm test`): parsing, extraction and every safeguard above, with no network or API keys needed. Runs automatically on every push via GitHub Actions.
- **Live evaluation** (`npm run eval`): sends every sample note in `tests/fixtures.js` through the real `/generate` pipeline and fails if any output has invented values, invented codes, missing sections, or `review_required`.
  - Against the models directly: `GROQ_API_KEY=... OPENROUTER_API_KEY=... npm run eval`
  - Against the deployed API: `EVAL_BASE_URL=https://note-scribe-ai-api.thomelfin529.workers.dev EVAL_API_KEY=nscrb_... npm run eval` (or `EVAL_API_KEY_FILE=<path>` to read the key from a file)
  - `EVAL_RUNS=3` repeats each note to measure consistency. `EVAL_VERBOSE=1` prints failing notes.
  - In GitHub Actions it runs when `GROQ_API_KEY` / `OPENROUTER_API_KEY` are added under the repo's Settings → Secrets and variables → Actions.

Add a fixture to `tests/fixtures.js` whenever a customer reports a bad note, so the same failure can't return unnoticed.

## License

MIT — do whatever you want with it.
