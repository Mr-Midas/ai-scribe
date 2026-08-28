# TherapyNote AI Scribe

A local, private AI-powered Chrome Extension for home health occupational therapists. Converts raw shorthand notes into Medicare-compliant SOAP documentation using Ollama — **100% HIPAA compliant, nothing ever leaves the machine.**

## What It Does

1. You type or paste messy shorthand notes into the extension
2. The AI transforms them into a professional, legally defensible Daily Treatment Note
3. You copy the output and paste it into TherapyBoss

**No cloud APIs. No data sent anywhere. Everything runs on your machine.**

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
6. Pin the extension: click the puzzle-piece icon → pin "TherapyNote AI Scribe"

### 6. Create a Desktop Shortcut (macOS Only)

```bash
cd ~/therapy-note-ai-scribe
bash create_app.sh
```

This creates **TherapyNote AI Scribe.app** on your Desktop. Drag it to your Dock for easy access.

On Windows, you can pin the Chrome extension to your taskbar, or create a shortcut by right-clicking the Chrome icon on your taskbar after loading the extension.

---

## How to Use

1. Click **TherapyNote AI Scribe** in your Dock/taskbar
2. Chrome opens with the extension
3. Select your note type: **Initial Evaluation** or **Treatment / Re-eval**
4. Type or paste your raw notes
5. Click **Generate Compliant Note**
6. Watch the progress bar as the AI generates your note
7. Review the output, click **Copy**, paste into TherapyBoss

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
- **HIPAA compliant** — patient data never leaves the device

---

## Requirements

- macOS 11.0+ or Windows 10+
- Google Chrome
- Ollama (free, open-source)
- ~5 GB of free disk space (for Ollama + AI model)

## License

MIT — do whatever you want with it.
