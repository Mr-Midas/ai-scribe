# Note Scribe AI

A local, private AI-powered Chrome Extension for clinical documentation. Converts raw shorthand notes into professional SOAP notes using Ollama — **100% local, nothing ever leaves the machine.**

## What It Does

1. You type or paste messy shorthand notes into the extension
2. The AI transforms them into a professional, legally defensible Daily Treatment Note
3. You copy the output and paste it into your EMR

**No cloud APIs. No data sent anywhere. Everything runs on your machine.**

## How It Works

The extension sends your raw notes to a local AI model (phi3 via Ollama) along with a detailed system prompt that teaches the model how to write clinical documentation. The prompt handles the heavy lifting:

- **Clinical compliance rules** — forces active, skilled language ("Therapist facilitated..." instead of "patient walked") and requires objective measurements (sets, reps, distances, assistance levels)
- **Proper OT terminology** — defines all 8 assistance levels (Independent through Total Assist) and adaptive equipment names (reacher, dressing stick, sock aide, etc.) so the AI uses exact clinical terms
- **Note type awareness** — you select Initial Evaluation or Treatment/Re-eval before generating, and the prompt changes what the AI documents (observations only for initial evals, progress comparisons for re-evals)
- **Safety observations** — the prompt instructs the AI to document hand placements, time to complete tasks, number of attempts, and verbal/visual cues provided
- **Context-aware goals** — the AI considers the patient's diagnosis when setting goals (e.g., a frontal lobe stroke patient won't have "independent" as a realistic goal)
- **Format enforcement** — outputs plain text SOAP notes with no markdown, no placeholders, and only the sections that have data

The result is a note that looks like a skilled therapist wrote it, not an AI.

## Example

**Raw input:**
> Pt had R shoulder pain 5/10. couldn't put on shirt. did active ROM for 10 mins. practiced upper body dressing with reacher, mod assist because he couldn't reach behind back.

**Generated output (Initial Evaluation):**
> Subjective: Patient reports right shoulder pain at 5/10, noting difficulty with upper body dressing.
> Objective:
> - Therapeutic Exercise: Facilitated active range of motion (AROM) of the right upper extremity for 10 minutes to improve joint mobility and decrease pain prior to ADL participation. Patient demonstrated forward flexion to 120 degrees, abduction to 90 degrees.
> - ADL Training: Instructed patient in upper body dressing utilizing adaptive equipment (reacher). Patient required Mod A for task completion. Safety: Therapist placed hands at bilateral hips for stability during standing dressing tasks. Patient required 2 attempts to don shirt. Time to complete upper body dressing: 8 minutes. Verbal cues provided for sequencing and joint protection techniques.
> Assessment: Patient demonstrates impaired right upper extremity AROM and decreased independence with upper body dressing. Skilled intervention required to maximize safety and improve functional independence.
> Plan: Continue OT per plan of care. Will progress to Min A for upper body dressing. Goal: Patient will perform upper body dressing with Standby Assist within 4 weeks.

---

## Setup Instructions

### Quick Setup (Recommended)

**macOS / Linux:**
```bash
git clone https://github.com/Mr-Midas/therapy-note-ai-scribe.git
cd therapy-note-ai-scribe
bash setup.sh
```

**Windows:**
```powershell
git clone https://github.com/Mr-Midas/therapy-note-ai-scribe.git
cd therapy-note-ai-scribe
.\setup.bat
```

The setup script will automatically check for Ollama, download the AI model, and generate extension icons — skipping anything that's already installed.

### Manual Setup

### 1. Install Ollama

#### macOS

Open Terminal and run:

```bash
brew install ollama
```

If Homebrew isn't installed, download Ollama from https://ollama.com/download instead.

#### Windows

1. Download the installer from https://ollama.com/download
2. Run the `.exe` installer and follow the prompts
3. Ollama will start automatically and run in the system tray

### 2. Download the AI Model

#### macOS

```bash
ollama pull llama3
```

#### Windows

Open **Command Prompt** or **PowerShell** and run:

```powershell
ollama pull phi3
```

This downloads the AI model (~2-5 GB). Only needs to be done once.

### 3. Download This Repository

Click the green **Code** button above → **Download ZIP** → unzip it to your Desktop.

Or if you're comfortable with the terminal:

**macOS:**
```bash
git clone https://github.com/Mr-Midas/therapy-note-ai-scribe.git ~/therapy-note-ai-scribe
cd ~/therapy-note-ai-scribe
```

**Windows:**
```powershell
git clone https://github.com/Mr-Midas/therapy-note-ai-scribe.git
cd therapy-note-ai-scribe
```

> **Windows note:** Do NOT clone to `~/therapy-note-ai-scribe` — the `~` shortcut behaves differently in PowerShell and will create a literal folder named `~`. Clone into your current directory instead.

### 4. Generate the Extension Icons

**macOS:**
```bash
pip3 install Pillow
python3 generate_icons.py
```

**Windows:**
```powershell
pip install Pillow
python generate_icons.py
```

> If you get a "python3 not found" error on Windows, try `python` instead of `python3`.

### 5. Load the Extension in Chrome

These steps are the same for macOS and Windows:

1. Open Google Chrome
2. Type `chrome://extensions` in the address bar, press Enter
3. Toggle **Developer mode** ON (top-right corner)
4. Click **Load unpacked** (top-left)
5. Select the project folder:
   - **macOS:** `~/therapy-note-ai-scribe`
   - **Windows:** `C:\Users\<your-username>\Desktop\therapy-note-ai-scribe` (or wherever you cloned it)
6. Pin the extension: click the puzzle-piece icon → pin "Note Scribe AI"

### 6. Create a Desktop Shortcut (macOS Only)

```bash
cd ~/therapy-note-ai-scribe
bash create_app.sh
```

This creates **Note Scribe AI.app** on your Desktop. Drag it to your Dock for easy access.

On Windows, you can pin the Chrome extension to your taskbar, or create a shortcut by right-clicking the Chrome icon on your taskbar after loading the extension.

---

## How to Use

1. Click **Note Scribe AI** in your Dock/taskbar
2. Chrome opens with the extension
3. Select your note type: **Initial Evaluation** or **Treatment / Re-eval**
4. Type or paste your raw notes
5. Click **Generate Compliant Note**
6. Watch the progress bar as the AI generates your note
7. Review the output, click **Copy**, paste into your EMR

**Keyboard shortcut:** `Ctrl+Enter` (Windows) or `Cmd+Enter` (Mac) in the notes field triggers generation.

> **Note:** The first time you use it each day, it may take 5-10 seconds for Ollama to start. After that, generation takes 2-5 seconds.

---

## OT Terminology Reference

The AI uses clinically accurate OT terminology:

### Assistance Levels
- **Independent** — Patient performs safely without assistance
- **Supervision** — Verbal/visual cues only, no physical contact
- **Standby Assist (SBA)** — Therapist ready but provides no physical contact
- **Contact Guard Assist (CGA)** — Light touch for safety; patient does majority of task
- **Minimum Assist (Min A)** — Patient performs 75%+ of task
- **Moderate Assist (Mod A)** — Patient performs 50-74% of task
- **Maximum Assist (Max A)** — Patient performs 25-49% of task
- **Total Assist** — Patient performs <25% of task

### Adaptive Equipment
- **Reacher** (not "reacher wand" or "grabber")
- Dressing Stick, Sock Aide, Leg Lifter, Long-handled Shoe Horn
- Built-up Handles, Universal Cuff, Dycem Mat, Button Hook

---

## Troubleshooting

| Problem | Fix |
|---|---|
| "Cannot connect to Ollama" error | Make sure Ollama is running. On macOS, try `ollama serve` in Terminal. On Windows, check the system tray for the Ollama icon. |
| "403 Forbidden" error | Ollama needs CORS access. Run `setx OLLAMA_ORIGINS "*"` then restart Ollama. On macOS: `launchctl setenv OLLAMA_ORIGINS "*"` then restart. |
| "Model not found" error | Run `ollama pull phi3` in your terminal |
| Extension doesn't appear in Chrome | Go to `chrome://extensions` and click the refresh button |
| App icon is missing | Run `python generate_icons.py` from the terminal in the project folder |
| Windows: `cd ~/therapy-note-ai-scribe` fails | Don't use `~` on Windows. Use `cd therapy-note-ai-scribe` after cloning into your current directory |
| Windows: `python3` not found | Try `python` instead of `python3` |

---

## Privacy & Security

- **Zero cloud calls** — Ollama runs entirely on your local machine
- **No data collection** — the extension has no analytics, telemetry, or tracking
- **No external APIs** — communication is only between the extension and `localhost:11434`
- **100% local** — patient data never leaves the device

---

## Technical Design Considerations

Building a local-first extension that talks to a local LLM is a solid approach for privacy, but it introduces some unique technical hurdles. Here are the main things you need to plan for in your system design:
- **Ollama connectivity & CORS**: Chrome extensions have strict security policies, so you'll need to configure Ollama to accept requests from your extension's origin (usually by setting OLLAMA_ORIGINS to your extension ID or chrome-extension://*).
- **Service Worker lifecycle**: Extension background scripts are ephemeral and will shut down during long LLM generations, meaning you'll need to handle model streaming via an offscreen document or keep-alive pings to prevent the connection from dropping mid-note.
- **Error state UX**: You have to design for the inevitable moments when Ollama isn't running, the phi3 model isn't pulled yet, or the user's machine is heavily thermal throttling.
- **Local storage limits**: Since you aren't using a cloud database, you'll need to rely on chrome.storage.local to cache raw notes, prompt templates, and draft history without hitting the default storage quotas.
- **Model context window**: Shorthand notes are short, but highly detailed system prompts with examples (few-shot prompting) can eat up context quickly, so you'll need to optimize your clinical rules to keep generation speeds usable on average hardware

---

## Enterprise API

Note Scribe AI includes a REST API for EHR integration (TherapyBOSS, Kinnser). See [API.md](API.md) for full documentation.

**Base URL:** `https://note-scribe-ai-api.thomelfin529.workers.dev`

**Key Features:**
- Multi-model fallback (Groq → OpenRouter) with automatic retry (up to 3 attempts) and a 20-second timeout per model call
- Deep structured data extraction: Section GG, CPT codes, ROM (side, joint, AROM/PROM, degrees), MMT (0-5 with +/-), assistance levels
- EHR-specific formatters for TherapyBOSS and Kinnser
- Webhook auto-delivery after generation
- No note content is stored by the API itself
- Audit logging (metadata only, no PHI)

**Key Endpoints:**
- `POST /api/v1/notes/generate` - Generate structured SOAP note with validation + retry
- `POST /api/v1/notes/extract` - Extract discrete EHR fields
- `POST /api/v1/notes/format` - Format for specific EHR (TherapyBOSS/Kinnser)
- `POST /api/v1/notes/validate` - Validate clinical content
- `POST /api/v1/webhooks/deliver` - Deliver to EHR webhooks

### Reliability safeguards

AI models sometimes add details that sound clinical but were never documented. Every generated note is checked before it is returned:

| Check | What happens |
|-------|--------------|
| **Every number must come from the raw notes.** Measurements, reps, sets, durations, pain scores, MMT grades, ROM degrees, dates, and sprain/wound grades or stages that are not in `raw_notes` | The note is regenerated with the invented values named. If they persist after 3 attempts, the response has `review_required: true`. |
| **No invented billing codes.** CPT, HCPCS and G-codes not present in `raw_notes` | Same as above. (Medicare functional limitation G-codes were discontinued on 1/1/2019 and are never requested.) |
| **All four SOAP sections present.** Full (`Subjective:`) or abbreviated (`S:`) headers | Same as above. Empty sections read "Not documented this session." |
| **Structured fields are grounded.** ROM and MMT values not in `raw_notes` | Dropped from `structured` / `formatted`, so they never reach an EHR field. |
| **Gaps are warnings, not retries.** Missing assistance level, skin integrity, goals | Reported in `validation.warnings`. The model is never asked to "add" missing data, because that is how fabrication happens. |

**Integration rule for EHR clients:** if `review_required` is `true`, show the note to the clinician for review instead of filing it automatically. `validation.issues` lists exactly what needs attention.

### Configuration

Set these on the Cloudflare Worker (Dashboard → Workers & Pages → `note-scribe-ai-api` → Settings → Variables and Secrets, or `npx wrangler secret put NAME`):

| Name | Required | Purpose |
|------|----------|---------|
| `GROQ_API_KEY` | One of these two | Primary model provider |
| `OPENROUTER_API_KEY` | One of these two | Fallback model provider |
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
  - Against the deployed API: `EVAL_BASE_URL=https://note-scribe-ai-api.thomelfin529.workers.dev EVAL_API_KEY=nscrb_... npm run eval`
  - `EVAL_RUNS=3` repeats each note to measure consistency. `EVAL_VERBOSE=1` prints failing notes.
  - In GitHub Actions it runs when `GROQ_API_KEY` / `OPENROUTER_API_KEY` are added under the repo's Settings → Secrets and variables → Actions.

Add a fixture to `tests/fixtures.js` whenever a customer reports a bad note, so the same failure can't return unnoticed.

### Compliance note

Raw notes sent to this API are forwarded to the configured model provider. Before processing real patient data (PHI), each provider in the chain must be covered by a signed HIPAA Business Associate Agreement (BAA), and its data-retention terms must be confirmed. EHR customers will ask for this. OpenRouter forwards requests to many different underlying providers, which makes BAA coverage hard to guarantee. HIPAA-eligible options include the major cloud AI platforms (AWS Bedrock, Azure, Google Vertex AI) and model vendors' enterprise APIs that offer a BAA.

## Requirements

- macOS 11.0+ or Windows 10+
- Google Chrome
- Ollama (free, open-source)
- ~5 GB of free disk space (for Ollama + AI model)

## License

MIT — do whatever you want with it.
