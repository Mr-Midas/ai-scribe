# Setup Instructions for Note Scribe AI

> **Outdated.** This page describes an earlier version that ran an AI model locally with Ollama. The current product is described in [README.md](README.md). Note Scribe AI is **not HIPAA compliant yet**; see [Path to HIPAA compliance](README.md#path-to-hipaa-compliance).

## Prerequisites

- Google Chrome browser
- Ollama installed locally (https://ollama.com)
- ~5 GB of free disk space

## Quick Setup

### 1. Install Ollama

**macOS:**
```bash
brew install ollama
ollama serve
```

**Windows:**
1. Download installer from https://ollama.com/download
2. Run the `.exe` installer
3. Ollama starts automatically

### 2. Download the AI Model

```bash
ollama pull phi3
```

This downloads the AI model (~2-5 GB). Only needs to be done once.

### 3. Download This Repository

Click the green **Code** button above → **Download ZIP** → unzip it to your Desktop.

Or if you're comfortable with the terminal:

**macOS:**
```bash
git clone https://github.com/Mr-Midas/ai-scribe.git
```

**Windows:**
```powershell
git clone https://github.com/Mr-Midas/ai-scribe.git
```

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

### 5. Load the Extension in Chrome

These steps are the same for macOS and Windows:

1. Open Google Chrome
2. Type `chrome://extensions` in the address bar, press Enter
3. Toggle **Developer mode** ON (top-right corner)
4. Click **Load unpacked** (top-left)
5. Select the project folder: `ai-scribe`
6. Pin the extension: click the puzzle-piece icon → pin "Note Scribe AI"

### 6. Configure Cloud Backup (Optional)

If you want to enable the cloud backup feature as a safety net:

1. **Deploy the Cloudflare Worker:**
   - Visit https://workers.cloudflare.com
   - Create a new worker named `note-scribe-ai-proxy`
   - Copy the worker URL (e.g., `https://note-scribe-ai.yourname.workers.dev`)

2. **Update the extension:**
   - Edit `background.js` line 3 and replace the placeholder URL with your actual worker URL

3. **Configure Cloudflare:**
   - Add environment variables `GROQ_API_KEY` and `GROQ_API_URL` in your Cloudflare dashboard
   - Ensure your worker allows requests from `chrome-extension://*/*`

### 7. Testing the Extension

After loading the extension:

1. Click **Note Scribe AI** in your toolbar
2. Select your note type: **Initial Evaluation** or **Treatment / Re-eval**
3. Type your shorthand notes (see examples below)
4. Click **⚡ Generate Compliant Note**
5. Review the generated SOAP note
6. Click **Copy** and paste into your EMR

## Example Usage

### Raw Input Examples:

**For Initial Evaluation (Observation-based):**
> Pt had R shoulder pain 5/10. couldn't put on shirt. did active ROM for 10 mins. practiced upper body dressing with reacher, mod assist because he couldn't reach behind back.

**For Treatment / Re-eval (Progress-based):**
> Pt improved from Mod A to Standby Assist with upper body dressing. Active ROM increased from 90° to 120°. Pain reduced from 5/10 to 2/10.

## Troubleshooting

### Common Issues

#### "Cannot connect to Ollama" error
**Fix:** Ensure Ollama is running. On macOS, try `ollama serve` in Terminal. On Windows, check the system tray for the Ollama icon.

#### "403 Forbidden" error
**Fix:** Ollama needs CORS access. Run `setx OLLAMA_ORIGINS "*"` then restart Ollama. On macOS: `launchctl setenv OLLAMA_ORIGINS "*"` then restart.

#### "Model not found" error
**Fix:** Run `ollama pull phi3` in your terminal

#### Extension doesn't appear in Chrome
**Fix:** Go to `chrome://extensions` and click the refresh button

#### App icon is missing
**Fix:** Run `python generate_icons.py` from the terminal in the project folder

#### Windows: `cd ~/ai-scribe` fails
**Fix:** Don't use `~` on Windows. Use `cd ai-scribe` after cloning into your current directory

#### Windows: `python3` not found
**Fix:** Try `python` instead of `python3`

## Privacy & Security

### What This Extension Does

- **Zero cloud calls** during normal operation (100% local)
- **No data collection** - no analytics, telemetry, or tracking
- **No external APIs** - communication is only between the extension and Ollama
- **100% local** - patient data never leaves the device

### Cloud Backup (Optional)

When enabled, the cloud backup:
- Only activates when local Ollama fails (500 error, timeout, or connection refused)
- Sends only the current note being generated (never stored)
- Uses Cloudflare Workers with Groq's Llama 3 70B
- Is encrypted in transit (HTTPS). It is not HIPAA compliant yet.
- Is completely optional and opt-in

## Technical Details

### How It Works

1. You type or paste messy shorthand notes into the extension
2. The extension sends your raw notes to Ollama (local AI) along with a detailed system prompt
3. The system prompt teaches the model how to write clinical documentation:
   - **Clinical compliance rules** — forces skilled language and requires objective measurements
   - **Proper OT terminology** — defines all assistance levels and adaptive equipment names
   - **Note type awareness** — selects different prompts for Initial Evaluation vs Treatment
   - **Safety observations** — documents hand placements, time to complete tasks, number of attempts
   - **Context-aware goals** — considers diagnosis when setting goals
   - **Format enforcement** — outputs plain text SOAP notes with no markdown

4. The AI transforms them into a professional, legally defensible Daily Treatment Note

5. You copy the output and paste it into your EMR

**No cloud APIs. No data sent anywhere. Everything runs on your machine.**

### System Prompt Optimization

The system prompt is optimized for the `phi3` model (~8GB) to ensure:
- Fast generation speeds on average hardware
- Minimal context window usage
- High clinical accuracy and compliance
- Proper OT terminology and safety documentation

### Error Recovery

The extension includes sophisticated error handling:
- **Automatic retry** when Ollama returns a 500 error (waits 1.5s)
- **Cloud fallback** when local AI is unavailable
- **Clear user messaging** about what's happening
- **Recovery prompts** when switching from cloud to local

## Requirements

- macOS 11.0+ or Windows 10+
- Google Chrome (latest version)
- Ollama (free, open-source)
- ~5 GB of free disk space (for Ollama + AI model)
- **Optional:** Cloudflare account for cloud backup

## License

MIT — do whatever you want with it.

## Getting Help

If you encounter issues:
1. Check the Troubleshooting section above
2. Ensure Ollama is running and the `phi3` model is downloaded
3. Verify the extension is loaded in Chrome developer mode
4. Review browser console for error details

For bug reports or feature requests, please refer to the repository issues.
