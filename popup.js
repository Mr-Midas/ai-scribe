// The API writes notes with its own reviewed prompt and checks every value
// against the raw notes. The extension sends no prompt of its own.
const API_BASE = "https://note-scribe-ai-api.thomelfin529.workers.dev";

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
const apiKeyInput = document.getElementById("apiKeyInput");

let currentNoteType = "initial-eval";
let currentEHR = "";

// Only preferences and the access key are saved. Note text may contain patient
// information, so it is never written to disk; earlier versions did, and
// loadState() removes anything they left behind.
async function saveState() {
  await chrome.storage.local.set({
    savedNoteType: currentNoteType,
    savedEHR: currentEHR
  });
}

async function loadState() {
  await chrome.storage.local.remove(["savedRawNotes", "savedOutputNotes"]);
  const data = await chrome.storage.local.get(["savedNoteType", "savedEHR", "apiKey"]);
  if (data.savedNoteType) setNoteType(data.savedNoteType);
  if (data.savedEHR) setEHR(data.savedEHR);
  if (data.apiKey) apiKeyInput.value = data.apiKey;
}

apiKeyInput.addEventListener("change", () => chrome.storage.local.set({ apiKey: apiKeyInput.value.trim() }));

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
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    showStatus("Enter your access key first. Your administrator can give you one.", "error");
    apiKeyInput.focus();
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

  try {
    showProgress(20, "Generating note...");

    const response = await fetch(`${API_BASE}/api/v1/notes/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-API-Key": apiKey },
      body: JSON.stringify({
        raw_notes: notes,
        note_type: currentNoteType,
        target_ehr: currentEHR || undefined
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

    if (data.review_required) {
      showStatus(`Needs your review: the note contains details not in your notes. ${data.validation.issues.join(" ")}`, "error");
    } else if (data.validation?.warnings?.length > 0) {
      showStatus(`Note generated with ${data.validation.warnings.length} warnings.`, "error");
    } else {
      showStatus("Note generated successfully.", "success");
    }
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
