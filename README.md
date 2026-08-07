# TherapyNote AI Scribe

A local, private AI-powered Chrome Extension for home health therapists. Converts raw shorthand notes into Medicare-compliant SOAP documentation using **Ollama — 100% local, nothing ever leaves the machine** — then **auto-fills it into your EMR**.

Works with **TherapyBoss, WellSky/Kinnser, Axxess, IntakeQ, or any other web-based EMR** — because home health companies often work with more than one system, the fill engine is site-agnostic.

## What It Does

1. You type or paste messy shorthand notes into the extension
2. The AI transforms them into a professional, legally defensible Daily Treatment Note
3. Click **Fill in EMR** — it finds the note field on the open EMR page and fills it in (React/MUI-safe, works with rich-text editors)
4. Review on the page, then save — or just **Copy** and paste manually

**No cloud APIs. No data sent anywhere. Everything runs on your machine.**

## Example

**Raw input:**
> Pt had R shoulder pain 5/10. couldn't put on shirt. did active ROM for 10 mins. practiced upper body dressing with reacher, mod assist because he couldn't reach behind back.

**Generated output:**
> **Subjective:** Patient reports right shoulder pain at 5/10, noting difficulty with upper body dressing.
> **Objective:** - Therapeutic Exercise: Facilitated active range of motion (AROM) of the right upper extremity for 10 minutes to improve joint mobility and decrease pain prior to ADL participation.
> - ADL Training: Instructed patient in upper body dressing utilizing adaptive equipment (reacher). Patient required Mod A for task completion due to decreased shoulder internal rotation and safety awareness. Therapist provided verbal cues for sequencing and joint protection techniques.
> **Assessment:** Patient demonstrates impaired right upper extremity AROM and decreased independence with upper body dressing. Skilled intervention required to train in adaptive equipment use to maximize safety and independence with ADLs.
> **Plan:** Continue OT per plan of care to address upper extremity ROM and ADL retraining. Will progress to Min A for upper body dressing utilizing the reacher.

---

## Features (v2.0)

| Feature | How it works |
|---|---|
| **Multi-platform auto-fill** | Site profiles in `configs.js` for TherapyBoss, WellSky/Kinnser, Axxess, IntakeQ + a generic profile that works on any site. Pick the EMR in the popup or let it auto-detect from the URL. |
| **Deep Auto-Drive** | If the normal page scan misses the note field, the extension attaches Chrome's debugger (CDP) and reads the page's HTML layering, CSS, JS console, and network — then fills the field directly. No second extension needed. |
| **React/MUI-safe filling** | Uses the native value-setter hack + `input`/`change`/`blur` events, so controlled inputs (React, Angular) accept the text. Rich-text editors (Quill/CKEditor/contenteditable) are handled too. |
| **SOAP section splitting** | If your EMR splits the note into Subjective/Objective/Assessment/Plan fields, the extension detects it and fills each section into its own field. |
| **Browser MCP (optional upgrade)** | The popup checks if the Browser MCP extension is installed and offers a one-click install link. If data entry misbehaves, it nudges you toward it — MCP reads pages through the accessibility tree, the most reliable path for tricky forms. |
| **Overwrite protection** | Never clobbers existing text without asking. |
| **100% local generation** | Ollama runs on your machine. HIPAA-friendly: patient data never leaves the device. |

## Setup Instructions

### 1. Install Ollama

```bash
brew install ollama
```

If Homebrew isn't installed, download Ollama from https://ollama.com/download instead.

### 2. Download the model

```bash
ollama pull phi3
```

(This project uses `phi3` — fast on 8GB machines. `ollama pull llama3` also works; switch `MODEL` in `background.js`.)

### 3. Load the extension in Chrome

1. Open Google Chrome
2. Type `chrome://extensions`, press Enter
3. Toggle **Developer mode** ON (top-right)
4. Click **Load unpacked** (top-left)
5. Select this project folder
6. Pin the extension

> ⚠️ **Permissions notice:** the extension asks for `debugger`, `tabs`, `management`, and access to all sites. That's what powers Deep Auto-Drive (reading any EMR's page) and Browser MCP detection. It only reads the page when you click **Fill in EMR**; it never sends data anywhere.

### 4. (Optional) Desktop app on macOS

```bash
bash create_app.sh
```

Creates **TherapyNote AI Scribe.app** on your Desktop.

## Daily Usage

1. Open your EMR in Chrome (e.g. TherapyBoss, on the Daily Note / Progress Note screen)
2. Open the extension, type or paste your raw notes
3. Click **Generate Compliant Note**
4. Click **Fill in EMR** (EMR is auto-detected from the URL, or pick it in Auto-Fill Settings)
5. Review on the page, then save

**Keyboard shortcut:** `Cmd + Enter` (Mac) or `Ctrl + Enter` (Windows) in the notes field triggers generation.

## Adding a New EMR Platform

Add a profile to `configs.js` — no other code changes:

```js
mycompany: {
  label: 'My Company EMR',
  domains: ['myemr.com'],
  noteField: {
    labelKeywords: ['clinical note', 'note', 'documentation'],
    selectors: ['textarea[id*="note" i]', '[role="textbox"][aria-label*="note" i]']
  },
  sections: []
}
```

Then add `<option value="mycompany">My Company EMR</option>` to the `#platformSelect` dropdown in `popup.html`.

## Architecture

```
popup (configs.js + popup.js)  →  background.js  →  content.js (configs.js)
      │                             │                   └─ scrape / fill the EMR page
      │                             └─ chrome.debugger deep drive (HTML/CSS/console/network)
      └─ Ollama (localhost:11434)  ← background.js routes GENERATE_NOTE
```

- **popup.js** — orchestration: generate → detect platform → scrape → pick target → fill → verify
- **content.js** — generic page engine: field discovery (labels/ARIA/placeholders), React-safe fill, rich-editor fill, legacy single-field fill
- **configs.js** — per-platform note-field profiles + target-picking heuristics (shared by popup and content script)
- **background.js** — Ollama calls, Deep Auto-Drive (chrome.debugger), Browser MCP detection

## Troubleshooting

| Problem | Fix |
|---|---|
| "Cannot connect to Ollama" | Make sure Ollama is installed. Run `ollama serve`, then try again. |
| "Model not found" | Run `ollama pull phi3` |
| "Could not find the note field" | Make sure you're on the correct EMR screen (a new Daily Note), then click Fill again. Enable **Deep Auto-Drive** in Auto-Fill Settings. |
| Fill fails on a tricky form | Install **Browser MCP** (one-click button in the popup) — it reads pages through the accessibility tree. |
| Extension doesn't appear in Chrome | Go to `chrome://extensions` and click the refresh button |
| App icon is missing (Mac) | Run `python3 generate_icons.py` in the project folder |

## Privacy & Security

- **Zero cloud calls** — Ollama runs entirely on your local machine
- **No data collection** — no analytics, telemetry, or tracking
- **No external APIs** — communication is only between the extension and `localhost:11434`
- **HIPAA friendly** — patient data never leaves the device
- **Reads the EMR page only on demand** — page scanning happens only when you click **Fill in EMR**

## Requirements

- macOS 11.0+ or Windows
- Google Chrome
- Ollama (free, open-source)
- ~5 GB of free disk space (Ollama + model)

## License

MIT — do whatever you want with it.
