const API_BASE = "https://note-scribe-ai-api.thomelfin529.workers.dev";
const DEFAULT_API_KEY = "nscrb_72889ea78923476fb19d0338";

const SYSTEM_PROMPT = `You are a clinical documentation assistant. Convert shorthand notes into SOAP format.

RULES:
- Plain text. No markdown/placeholders.
- Use headers ONLY if section has data. Omit missing info.
- Language: Skilled ("Therapist facilitated", "Tactile cues for").
- Include sets, reps, distances, assistance levels.
- Tie interventions to functional goals.

ASSIST LEVELS: Independent, Supervision (verbal/visual), Standby Assist/SBA (ready, no contact), Contact Guard Assist/CGA (light touch), Min A (75%+), Mod A (50-74%), Max A (25-49%), Total Assist (<25%).

EQUIPMENT: Reacher (NEVER "grabber"), Dressing Stick, Sock Aide, Leg Lifter, Shoe Horn, Built-up Handles, Universal Cuff, Dycem, Button Hook.

EVAL (type "initial-eval"): OBSERVATIONS ONLY. Baseline ROM, MMT (0-5), balance, assist levels. Document safety: hand placements, time, attempts, cues. No progress.
TREATMENT (type "treatment"): Document progress. Compare assist levels (e.g., "Improved from Mod A to SBA"). Update goals.

CONTEXT: Adjust for diagnosis (Stroke, TBI, SCI, Ortho). Never use "independent" if unsafe.

EXAMPLE EVAL:
Subjective: R shoulder pain 5/10, difficulty dressing.
Objective:
- Exercise: Facilitated RUE AROM 10 mins. Flexion 120, Abd 90.
- ADL: Instructed UB dressing with reacher. Mod A. Safety: Hands at hips. 2 attempts. Time: 8 min.
Assessment: Impaired RUE AROM, decreased UB dressing independence.
Plan: Continue OT. Goal: UB dressing with SBA in 4 weeks.`;

const rawNotes = document.getElementById("rawNotes");
const outputNotes = document.getElementById("outputNotes");
const generateBtn = document.getElementById("generateBtn");
const copyBtn = document.getElementById("copyBtn");
const clearBtn = document.getElementById("clearBtn");
const outputSection = document.getElementById("outputSection");
const statusBar = document.getElementById("statusBar");
const themeToggle = document.getElementById("themeToggle");
const themeIcon = document.getElementById("themeIcon");
const progressContainer = document.getElementById("progressContainer");
const progressBarFill = document.getElementById("progressBarFill");
const progressStatus = document.getElementById("progressStatus");
const noteTypeSelector = document.getElementById("noteTypeSelector");
const ehrSelector = document.getElementById("ehrSelector");

let currentNoteType = "initial-eval";
let currentEHR = "";

async function saveState() {
  await chrome.storage.local.set({
    savedRawNotes: rawNotes.value,
    savedOutputNotes: outputNotes.value,
    savedNoteType: currentNoteType,
    savedEHR: currentEHR
  });
}

async function loadState() {
  const data = await chrome.storage.local.get(["savedRawNotes", "savedOutputNotes", "savedNoteType", "savedEHR"]);
  if (data.savedRawNotes) rawNotes.value = data.savedRawNotes;
  if (data.savedOutputNotes) {
    outputNotes.value = data.savedOutputNotes;
    if (data.savedOutputNotes.trim() !== "") outputSection.classList.add("visible");
  }
  if (data.savedNoteType) setNoteType(data.savedNoteType);
  if (data.savedEHR) setEHR(data.savedEHR);
}

rawNotes.addEventListener("input", saveState);

function showProgress(percent, statusText) {
  progressContainer.classList.add("visible");
  progressBarFill.style.width = percent + "%";
  progressStatus.textContent = statusText;
}

function hideProgress() {
  progressContainer.classList.remove("visible");
  progressBarFill.style.width = "0%";
  progressStatus.textContent = "";
}

function showStatus(message, type) {
  statusBar.textContent = message;
  statusBar.className = `status-bar visible ${type}`;
}

function hideStatus() {
  statusBar.className = "status-bar";
}

function loadTheme() {
  const theme = localStorage.getItem("noteScribeTheme") || "light";
  document.documentElement.setAttribute("data-theme", theme);
  themeIcon.textContent = theme === "dark" ? "☀️" : "🌙";
}

themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("noteScribeTheme", next);
  themeIcon.textContent = next === "dark" ? "☀️" : "🌙";
});

function setNoteType(type) {
  currentNoteType = type;
  noteTypeSelector.querySelectorAll(".note-type-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.type === type);
  });
}

function setEHR(ehr) {
  currentEHR = ehr;
  if (ehrSelector) {
    ehrSelector.value = ehr;
  }
}

noteTypeSelector.addEventListener("click", (e) => {
  const btn = e.target.closest(".note-type-btn");
  if (!btn) return;
  setNoteType(btn.dataset.type);
  saveState();
});

if (ehrSelector) {
  ehrSelector.addEventListener("change", (e) => {
    setEHR(e.target.value);
    saveState();
  });
}

async function generateNote() {
  const notes = rawNotes.value.trim();
  if (!notes) {
    showStatus("Please enter raw notes first.", "error");
    return;
  }

  hideStatus();
  outputNotes.value = "";
  outputSection.classList.add("visible");
  generateBtn.classList.add("loading");
  generateBtn.disabled = true;
  copyBtn.textContent = "📋 Copy";
  copyBtn.classList.remove("copied");

  showProgress(10, "Connecting...");

  const noteTypeLabel = currentNoteType === "initial-eval" ? "INITIAL EVALUATION" : "TREATMENT / RE-EVALUATION";

  try {
    showProgress(20, "Generating note...");

    const apiKey = await chrome.storage.local.get("apiKey").then(r => r.apiKey || DEFAULT_API_KEY);
    const response = await fetch(`${API_BASE}/api/v1/notes/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({
        raw_notes: notes,
        note_type: currentNoteType,
        target_ehr: currentEHR || undefined,
        system_prompt: SYSTEM_PROMPT
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `API error: ${response.status}`);
    }

    showProgress(60, "Processing response...");

    const data = await response.json();

    if (data.note) {
      outputNotes.value = data.note;
      outputNotes.scrollTop = outputNotes.scrollHeight;
    }

    showProgress(100, "Done!");
    setTimeout(() => hideProgress(), 800);

    if (data.validation?.issues?.length > 0) {
      showStatus(`Note generated with ${data.validation.issues.length} issues after ${data.metadata?.attempts || 1} attempts.`, "error");
    } else if (data.validation?.warnings?.length > 0) {
      showStatus(`Note generated with ${data.validation.warnings.length} warnings.`, "error");
    } else {
      showStatus("Note generated successfully.", "success");
    }

    saveState();
  } catch (err) {
    hideProgress();
    showStatus(`Error: ${err.message}`, "error");
  } finally {
    generateBtn.classList.remove("loading");
    generateBtn.disabled = false;
  }
}

generateBtn.addEventListener("click", generateNote);

copyBtn.addEventListener("click", async () => {
  const text = outputNotes.value;
  if (!text) return;
  await navigator.clipboard.writeText(text);
  copyBtn.textContent = "✓ Copied!";
  copyBtn.classList.add("copied");
  setTimeout(() => {
    copyBtn.textContent = "📋 Copy";
    copyBtn.classList.remove("copied");
  }, 2000);
});

clearBtn.addEventListener("click", async () => {
  rawNotes.value = "";
  outputNotes.value = "";
  outputSection.classList.remove("visible");
  hideStatus();
  hideProgress();
  await saveState();
});

rawNotes.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") generateNote();
});

loadTheme();
loadState();
