const SYSTEM_PROMPT = `You are an expert Home Health Therapist Scribe specializing in Medicare-compliant clinical documentation for home health EMRs (TherapyBoss, WellSky/Kinnser, Axxess, IntakeQ).

Your job is to transform raw shorthand notes into a professional, objective, and legally defensible Daily Treatment Note.

CRITICAL FORMATTING RULES:
1. NO MARKDOWN: Do not use asterisks (**), hashtags (#), or any bolding/italics. Use plain text only.
2. NO PLACEHOLDERS: Do not use brackets like [insert...], ellipses (...), or blanks. If a piece of information is not provided in the raw notes, simply omit that part of the note. Do not invent data.
3. DYNAMIC SOAP: Use headers (Subjective, Objective, Assessment, Plan) ONLY for sections where you have actual data. If there is no "Subjective" info, skip the Subjective header entirely.

CLINICAL COMPLIANCE RULES:
1. PROVE SKILLED NEED: Use active, skilled terminology (e.g., "Therapist facilitated...", "Gait training provided with...", "Tactile cues required for...", "Instructed patient in..."). Avoid passive language like "patient walked" or "tolerated well".
2. OBJECTIVE MEASUREMENT: Include exact sets, reps, distances, and levels of assistance (Standby Assist, Min A, Mod A, Max A) provided. Format them clinically.
3. CONNECT TO FUNCTION: Always tie the intervention back to a functional goal (e.g., "to improve balance for safe tub transfers").

EXAMPLE OUTPUT:
Subjective: Patient reports right shoulder pain at 5/10 and difficulty with upper body dressing.
Objective:
- Therapeutic Exercise: Facilitated active range of motion (AROM) of the right upper extremity for 10 minutes to improve joint mobility.
- ADL Training: Instructed patient in upper body dressing utilizing adaptive equipment (reacher). Patient required Mod A for task completion.
Assessment: Patient demonstrates impaired right upper extremity AROM and decreased independence with upper body dressing. Skilled intervention required to maximize safety.
Plan: Continue OT per plan of care. Will progress to Min A for upper body dressing.

INSTRUCTIONS:
Transform the following raw notes into a compliant home health note following the rules above. Use plain text only.`;

const OLLAMA_ENDPOINT = "http://localhost:11434/api/generate";
const MODEL = "phi3"; // Switched to phi3 for significantly faster performance on 8GB Macs

// ── Elements ────────────────────────────────────────────────────────────────

const rawNotes = document.getElementById("rawNotes");
const outputNotes = document.getElementById("outputNotes");
const generateBtn = document.getElementById("generateBtn");
const copyBtn = document.getElementById("copyBtn");
const clearBtn = document.getElementById("clearBtn");
const fillBtn = document.getElementById("fillBtn");
const fillButtonRow = document.getElementById("fillButtonRow");
const outputSection = document.getElementById("outputSection");
const statusBar = document.getElementById("statusBar");
const statusStep = document.getElementById("statusStep");
const statusText = document.getElementById("statusText");
const themeToggle = document.getElementById("themeToggle");
const themeIcon = document.getElementById("themeIcon");
const platformSelect = document.getElementById("platformSelect");
const deepDriveToggle = document.getElementById("deepDriveToggle");
const mcpBadge = document.getElementById("mcpBadge");
const mcpHint = document.getElementById("mcpHint");
const mcpInstallBtn = document.getElementById("mcpInstallBtn");

// ── Status helpers ──────────────────────────────────────────────────────────

function showStatus(message, type, step) {
  statusBar.className = `status-bar visible ${type || "info"}`;
  if (step) { statusStep.textContent = step; statusText.textContent = "  " + message; }
  else { statusStep.textContent = ""; statusText.textContent = message; }
}

function hideStatus() {
  statusBar.className = "status-bar";
}

function sendMessage(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(msg, (res) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}

function sendToTab(tabId, msg) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, msg, (res) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}

// ── State Persistence (Auto-Save/Restore) ──────────────────────────────────

async function saveState() {
  await chrome.storage.local.set({
    savedRawNotes: rawNotes.value,
    savedOutputNotes: outputNotes.value,
    scribePlatform: platformSelect.value,
    scribeDeepDrive: deepDriveToggle.checked
  });
}

async function loadState() {
  const data = await chrome.storage.local.get([
    "savedRawNotes", "savedOutputNotes", "scribePlatform", "scribeDeepDrive"
  ]);
  if (data.savedRawNotes) rawNotes.value = data.savedRawNotes;
  if (data.savedOutputNotes) {
    outputNotes.value = data.savedOutputNotes;
    if (data.savedOutputNotes.trim() !== "") {
      outputSection.classList.add("visible");
      fillButtonRow.style.display = "flex";
    }
  }
  if (data.scribePlatform) platformSelect.value = data.scribePlatform;
  if (data.scribeDeepDrive !== undefined) deepDriveToggle.checked = data.scribeDeepDrive;
}

rawNotes.addEventListener("input", saveState);
platformSelect.addEventListener("change", saveState);
deepDriveToggle.addEventListener("change", saveState);

// ── Theme Toggle ────────────────────────────────────────────────────────────

function loadTheme() {
  const saved = localStorage.getItem("therapyNoteTheme");
  const theme = saved || "light";
  document.documentElement.setAttribute("data-theme", theme);
  themeIcon.textContent = theme === "dark" ? "☀️" : "🌙";
}

themeToggle.addEventListener("click", () => {
  const current = document.documentElement.getAttribute("data-theme");
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("therapyNoteTheme", next);
  themeIcon.textContent = next === "dark" ? "☀️" : "🌙";
});

loadTheme();

// ── Browser MCP status ──────────────────────────────────────────────────────

async function refreshMcpStatus() {
  try {
    const info = await sendMessage({ action: "checkBrowserMcp" });
    if (info && info.installed) {
      mcpBadge.textContent = "✓ Installed";
      mcpBadge.className = "mcp-badge ok";
      mcpInstallBtn.classList.remove("visible");
      mcpHint.classList.remove("visible");
    } else {
      mcpBadge.textContent = "Not installed";
      mcpBadge.className = "mcp-badge missing";
      mcpInstallBtn.classList.add("visible");
    }
  } catch (e) {
    mcpBadge.textContent = "Unknown";
  }
}

/** Reveal the "install Browser MCP" hint when data entry misbehaves. */
function suggestMcp(reason) {
  if (!mcpBadge.className.includes("ok")) {
    mcpHint.classList.add("visible");
  }
  console.log("💡 Browser MCP hint: " + reason);
}

mcpInstallBtn.addEventListener("click", () => {
  sendMessage({ action: "openMcpStore" }).catch(() => {});
});

// ── Generate Note ───────────────────────────────────────────────────────────

generateBtn.addEventListener("click", async () => {
  const notes = rawNotes.value.trim();

  if (!notes) {
    showStatus("Please enter your raw notes first.", "error");
    return;
  }

  hideStatus();
  outputSection.classList.remove("visible");
  fillButtonRow.style.display = "none";
  generateBtn.classList.add("loading");
  generateBtn.disabled = true;
  copyBtn.textContent = "📋 Copy";
  copyBtn.classList.remove("copied");

  try {
    const data = await sendMessage({
      type: "GENERATE_NOTE",
      systemPrompt: SYSTEM_PROMPT,
      prompt: notes
    });

    if (!data.success) {
      let msg = data.error || "Unknown error";
      if (msg.includes("fetch") || msg.includes("Failed to fetch")) {
        msg = "Cannot connect to Ollama. Make sure Ollama is running (open Terminal, type: ollama serve).";
      }
      throw new Error(msg);
    }

    if (!data.response || data.response.trim() === "") {
      throw new Error("Ollama returned an empty response.");
    }

    outputNotes.value = data.response.trim();
    outputSection.classList.add("visible");
    fillButtonRow.style.display = "flex";
    showStatus("Note generated successfully. Review, then click Fill in EMR.", "success");
    saveState();
  } catch (err) {
    showStatus(`Error: ${err.message}`, "error");
  } finally {
    generateBtn.classList.remove("loading");
    generateBtn.disabled = false;
  }
});

// ── Fill in EMR (multi-platform auto-fill) ─────────────────────────────────

fillBtn.addEventListener("click", async () => {
  const text = outputNotes.value.trim();
  if (!text) {
    showStatus("Nothing to fill. Generate a note first.", "error");
    return;
  }

  fillBtn.classList.add("loading");
  fillBtn.disabled = true;
  hideStatus();

  try {
    // Step 1 — find the active tab and its URL
    showStatus("Reading the page…", "info", "Step 1/4");
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) {
      showStatus("No active tab found. Open your EMR page first.", "error");
      return;
    }

    const platformKey = platformSelect.value === "auto"
      ? detectPlatform(tab.url)
      : platformSelect.value;
    const config = window.SITE_CONFIGS[platformKey] || window.SITE_CONFIGS.generic;
    const platformLabel = window.SITE_CONFIGS[platformKey] ? window.SITE_CONFIGS[platformKey].label : "Generic";

    // Step 2 — scrape the page (content script first, deep drive fallback)
    showStatus(`Scanning for the note field on ${platformLabel}…`, "info", "Step 2/4");
    let fields = [];
    let domTargets = [];
    let contentAvailable = true;

    try {
      const scrape = await sendToTab(tab.id, { action: "scrape", config });
      fields = scrape.fields || [];
      domTargets = scrape.domTargets || [];
    } catch (e) {
      contentAvailable = false;
      if (deepDriveToggle.checked) {
        showStatus("Normal scan missed — using Deep Auto-Drive (debugger)…", "info", "Step 2/4");
        try {
          const report = await sendMessage({ action: "deepScrape", tabId: tab.id });
          if (report && report.ok) {
            fields = report.fields || [];
          } else {
            throw new Error((report && report.error) || "Deep drive failed");
          }
        } catch (err2) {
          showStatus(`Could not read the page: ${err2.message}. Open the EMR tab and try again.`, "error");
          return;
        }
      } else {
        showStatus("Could not connect to the page. Open the EMR tab, then try again.", "error");
        return;
      }
    }

    // Step 3 — pick the note target(s)
    let plan;
    if (domTargets.length > 0) {
      // Live DOM selector hits are the most precise
      const first = domTargets[0];
      plan = { mode: "single", targets: [{ uid: first.uid, label: first.label, text, hasText: first.hasText }] };
    } else {
      plan = buildFillPlan(fields, config, text);
    }

    if (!plan || plan.targets.length === 0) {
      suggestMcp("No note field found on the page after scanning.");
      showStatus(
        "Could not find the note field on this page. Make sure you're on the correct EMR screen (e.g. a new Daily Note). If it keeps failing, install Browser MCP for a more reliable page read.",
        "error"
      );
      return;
    }

    // Overwrite protection
    const existing = plan.targets.filter(t => t.hasText);
    if (existing.length > 0) {
      const ok = confirm(`The ${existing.map(t => t.label).join(", ")} field already has text. Overwrite it?`);
      if (!ok) {
        showStatus("Overwrite cancelled — nothing was changed.", "warning");
        return;
      }
    }

    // Step 4 — fill
    showStatus(`Filling ${plan.mode === "sections" ? plan.targets.length + " note sections" : "note field"}…`, "info", "Step 3/4");

    let fillResult;
    if (contentAvailable) {
      fillResult = await sendToTab(tab.id, {
        action: "fill",
        targets: plan.targets.map(t => ({ uid: t.uid, text: t.text, label: t.label }))
      });
    } else {
      // Deep-drive fill: convert cdp_ uids to indexes
      const indexed = plan.targets
        .map(t => ({ index: cdpIndex(t.uid), text: t.text }))
        .filter(t => t.index !== null);
      if (indexed.length === 0) {
        showStatus("Note field found but could not be addressed for deep fill.", "error");
        return;
      }
      const report = await sendMessage({ action: "deepFill", tabId: tab.id, targets: indexed });
      if (!report || !report.ok) {
        throw new Error((report && report.error) || "Deep fill failed");
      }
      fillResult = { success: report.results.every(r => r.success), results: report.results.map(r => ({ success: r.success, error: r.error })) };
    }

    showStatus("Verifying the fill…", "info", "Step 4/4");

    const ok = fillResult.success;
    const failed = (fillResult.results || []).filter(r => !r.success);
    if (ok) {
      showStatus(
        plan.mode === "sections"
          ? `✓ Note split into ${plan.targets.length} sections and filled. Review the page, then save.`
          : "✓ Note filled into the EMR. Review the page, then save it.",
        "success"
      );
    } else {
      suggestMcp("Fill partially failed: " + (failed.map(f => f.error).join("; ") || "unknown"));
      showStatus(
        `Note field was found, but filling partially failed (${failed.length} of ${plan.targets.length}). Install Browser MCP or fill manually.`,
        "error"
      );
    }
  } catch (err) {
    suggestMcp("Fill threw an error: " + err.message);
    showStatus(`Error: ${err.message}`, "error");
  } finally {
    fillBtn.classList.remove("loading");
    fillBtn.disabled = false;
  }
});

function cdpIndex(uid) {
  if (typeof uid !== "string") return null;
  if (uid.startsWith("cdp_")) return parseInt(uid.slice(4), 10);
  return null;
}

// ── Copy to Clipboard ───────────────────────────────────────────────────────

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

// ── Clear ───────────────────────────────────────────────────────────────────

clearBtn.addEventListener("click", async () => {
  rawNotes.value = "";
  outputNotes.value = "";
  outputSection.classList.remove("visible");
  fillButtonRow.style.display = "none";
  hideStatus();
  rawNotes.focus();
  await saveState();
});

// ── Keyboard Shortcut ───────────────────────────────────────────────────────

rawNotes.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
    e.preventDefault();
    generateBtn.click();
  }
});

// ── Init ────────────────────────────────────────────────────────────────────

loadState();
refreshMcpStatus();
