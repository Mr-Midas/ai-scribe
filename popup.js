const SYSTEM_PROMPT = `You are an expert clinical documentation assistant. Transform raw shorthand notes into professional SOAP notes.

FORMAT RULES:
- Plain text only. No markdown, bold, or placeholders.
- Use SOAP headers only for sections with data.
- If info is missing, omit it. Do not invent data.

CLINICAL RULES:
- Use skilled language: "Therapist facilitated...", "Instructed patient in...", "Tactile cues required for..."
- Include exact sets, reps, distances, and assistance levels.
- Tie every intervention to a functional goal.

ASSISTANCE LEVELS (use exact terms): Independent, Supervision (verbal/visual only), Standby Assist/SBA (ready, no contact), Contact Guard Assist/CGA (light touch), Min A (patient 75%+), Mod A (patient 50-74%), Max A (patient 25-49%), Total Assist (patient <25%).

ADAPTIVE EQUIPMENT: Reacher (NEVER "reacher wand" or "grabber"), Dressing Stick, Sock Aide, Leg Lifter, Long-handled Shoe Horn, Built-up Handles, Universal Cuff, Dycem Mat, Button Hook, Elastic Shoelaces.

INITIAL EVAL (note type "initial-eval"): Document OBSERVATIONS ONLY. Include baseline ROM, strength (0-5 MMT), balance scores, assistance levels for each activity. Document safety: hand placements, time to complete tasks, number of attempts, verbal/visual cues. Do NOT document progress. Set goal as target assistance level (e.g., "Goal: Patient will [task] with [target level] within [timeframe]").

TREATMENT/RE-EVAL (note type "treatment"): Document progress since last session. Compare assistance levels (e.g., "Improved from Mod A to Standby Assist"). Note measurement changes. Update goals.

CONTEXT-AWARE GOALS: Consider diagnosis (stroke lesion location, TBI cognition, SCI level, ortho weight-bearing). Never use "independent" if deficits make it unsafe.

EXAMPLE - INITIAL EVAL:
Subjective: Patient reports right shoulder pain at 5/10 and difficulty with upper body dressing.
Objective:
- Therapeutic Exercise: Facilitated AROM of right upper extremity for 10 minutes. Forward flexion to 120 degrees, abduction to 90 degrees.
- ADL Training: Instructed patient in upper body dressing with reacher. Patient required Mod A. Safety: Therapist placed hands at bilateral hips. 2 attempts to don shirt. Time: 8 minutes.
Assessment: Patient demonstrates impaired right upper extremity AROM and decreased independence with upper body dressing.
Plan: Continue OT. Goal: Patient will perform upper body dressing with Standby Assist within 4 weeks.

Transform the raw notes into a compliant clinical note.`;

const OLLAMA_ENDPOINT = "http://localhost:11434/api/generate";
const MODEL = "phi3"; // Switched to phi3 for significantly faster performance on 8GB Macs

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

// ── State Persistence (Auto-Save/Restore) ───────────────────

async function saveState() {
  await chrome.storage.local.set({
    savedRawNotes: rawNotes.value,
    savedOutputNotes: outputNotes.value,
    savedNoteType: currentNoteType
  });
}

async function loadState() {
  const data = await chrome.storage.local.get(["savedRawNotes", "savedOutputNotes", "savedNoteType"]);
  if (data.savedRawNotes) {
    rawNotes.value = data.savedRawNotes;
  }
  if (data.savedOutputNotes) {
    outputNotes.value = data.savedOutputNotes;
    if (data.savedOutputNotes.trim() !== "") {
      outputSection.classList.add("visible");
    }
  }
  if (data.savedNoteType) {
    setNoteType(data.savedNoteType);
  }
}

// Auto-save raw notes on every keystroke
rawNotes.addEventListener("input", saveState);

// ── Note Type Selector ──────────────────────────────────────

let currentNoteType = "initial-eval";

function setNoteType(type) {
  currentNoteType = type;
  noteTypeSelector.querySelectorAll(".note-type-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.type === type);
  });
}

noteTypeSelector.addEventListener("click", (e) => {
  const btn = e.target.closest(".note-type-btn");
  if (!btn) return;
  setNoteType(btn.dataset.type);
  saveState();
});

// ── Progress Bar ────────────────────────────────────────────

function showProgress(percent, statusText) {
  progressContainer.classList.add("visible");
  progressBarFill.style.width = percent + "%";
  progressBarFill.classList.add("active");
  progressStatus.textContent = statusText;
}

function hideProgress() {
  progressContainer.classList.remove("visible");
  progressBarFill.style.width = "0%";
  progressBarFill.classList.remove("active");
  progressStatus.textContent = "";
}

// ── Theme Toggle ──────────────────────────────────────────────

function loadTheme() {
  const saved = localStorage.getItem("noteScribeTheme");
  const theme = saved || "light";
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

loadTheme();

// ── Status Bar ────────────────────────────────────────────────

function showStatus(message, type) {
  statusBar.textContent = message;
  statusBar.className = `status-bar visible ${type}`;
}

function hideStatus() {
  statusBar.className = "status-bar";
}

// ── Generate Note ─────────────────────────────────────────────

generateBtn.addEventListener("click", async () => {
  const notes = rawNotes.value.trim();

  if (!notes) {
    showStatus("Please enter your raw notes first.", "error");
    return;
  }

  hideStatus();
  outputSection.classList.remove("visible");
  generateBtn.classList.add("loading");
  generateBtn.disabled = true;
  copyBtn.textContent = "📋 Copy";
  copyBtn.classList.remove("copied");

  // Build the user prompt with note type context
  const noteTypeLabel = currentNoteType === "initial-eval"
    ? "INITIAL EVALUATION"
    : "TREATMENT / RE-EVALUATION";

  const userPrompt = `Note Type: ${noteTypeLabel}\n\nRaw Notes:\n${notes}`;

  try {
    // Show progress stages
    showProgress(10, "Connecting to Ollama...");

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // 2 min timeout

    // Simulate progress while waiting for Ollama
    const progressInterval = setInterval(() => {
      const current = parseInt(progressBarFill.style.width) || 10;
      if (current < 90) {
        const newWidth = Math.min(current + Math.random() * 8, 90);
        progressBarFill.style.width = newWidth + "%";
        if (newWidth < 25) {
          progressStatus.textContent = "Sending notes to AI...";
        } else if (newWidth < 50) {
          progressStatus.textContent = "AI is analyzing your notes...";
        } else if (newWidth < 75) {
          progressStatus.textContent = "Generating compliant SOAP note...";
        } else {
          progressStatus.textContent = "Finalizing documentation...";
        }
      }
    }, 2000);

    showProgress(20, "Sending notes to AI...");

    const response = await fetch(OLLAMA_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        system: SYSTEM_PROMPT,
        prompt: userPrompt,
        options: {
          temperature: 0.3,
          top_p: 0.9,
          num_predict: 1024 // Reduced for faster generation on 8GB RAM
        }
      }),
      signal: controller.signal
    });

    clearInterval(progressInterval);
    clearTimeout(timeoutId);

    showProgress(95, "Finalizing note...");

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error("Ollama blocked the request (403). Make sure Ollama is running with OLLAMA_ORIGINS=* (run: setx OLLAMA_ORIGINS \"*\" then restart Ollama).");
      }
      throw new Error(`Ollama responded with status ${response.status}`);
    }

    const data = await response.json();

    if (!data.response || data.response.trim() === "") {
      throw new Error("Ollama returned an empty response.");
    }

    outputNotes.value = data.response.trim();
    outputSection.classList.add("visible");

    showProgress(100, "Done!");
    setTimeout(() => hideProgress(), 800);

    showStatus("Note generated successfully. Review before copying to your EMR.", "success");
    
    // Save result to storage
    saveState();
  } catch (err) {
    hideProgress();
    let msg = err.message;
    if (err.name === "AbortError") {
      msg = "Request timed out. Ollama may be overloaded or the model is too slow. Try shorter notes or a faster model.";
    } else if (err.name === "TypeError" && msg.includes("fetch")) {
      msg = "Cannot connect to Ollama. Make sure Ollama is running (open Terminal, type: ollama serve).";
    }
    showStatus(`Error: ${msg}`, "error");
  } finally {
    generateBtn.classList.remove("loading");
    generateBtn.disabled = false;
  }
});

// ── Copy to Clipboard ────────────────────────────────────────

copyBtn.addEventListener("click", async () => {
  const text = outputNotes.value;
  if (!text) return;

  try {
    await navigator.clipboard.writeText(text);
    copyBtn.textContent = "✓ Copied!";
    copyBtn.classList.add("copied");
    setTimeout(() => {
      copyBtn.textContent = "📋 Copy";
      copyBtn.classList.remove("copied");
    }, 2000);
  } catch {
    outputNotes.select();
    document.execCommand("copy");
    copyBtn.textContent = "✓ Copied!";
    copyBtn.classList.add("copied");
    setTimeout(() => {
      copyBtn.textContent = "📋 Copy";
      copyBtn.classList.remove("copied");
    }, 2000);
  }
});

// ── Clear ─────────────────────────────────────────────────────

clearBtn.addEventListener("click", async () => {
  rawNotes.value = "";
  outputNotes.value = "";
  outputSection.classList.remove("visible");
  hideStatus();
  hideProgress();
  rawNotes.focus();
  await saveState();
});

// ── Keyboard Shortcut ────────────────────────────────────────

rawNotes.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    generateBtn.click();
  }
});

// Init persistence
loadState();
