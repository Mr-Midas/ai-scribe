const SYSTEM_PROMPT = `You are an expert Home Health Therapist Scribe specializing in Medicare-compliant clinical documentation for the TherapyBoss EMR.

Your job is to transform raw shorthand notes into a professional, objective, and legally defensible Daily Treatment Note.

CRITICAL FORMATTING RULES:
1. NO MARKDOWN: Do not use asterisks (**), hashtags (#), or any bolding/italics. Use plain text only.
2. NO PLACEHOLDERS: Do not use brackets like [insert...], ellipses (...), or blanks. If a piece of information is not provided in the raw notes, simply omit that part of the note. Do not invent data.
3. DYNAMIC SOAP: Use headers (Subjective, Objective, Assessment, Plan) ONLY for sections where you have actual data. If there is no "Subjective" info, skip the Subjective header entirely.

CLINICAL COMPLIANCE RULES:
1. PROVE SKILLED NEED: Use active, skilled terminology (e.g., "Therapist facilitated...", "Gait training provided with...", "Tactile cues required for...", "Instructed patient in..."). Avoid passive language like "patient walked" or "tolerated well".
2. OBJECTIVE MEASUREMENT: Include exact sets, reps, distances, and levels of assistance provided. Format them clinically.
3. CONNECT TO FUNCTION: Always tie the intervention back to a functional goal (e.g., "to improve balance for safe tub transfers").

ASSISTANCE LEVEL TERMINOLOGY (use these exact terms):
- Independent: Patient performs task safely without any assistance
- Supervision: Verbal cues or visual demonstration only; no physical contact
- Standby Assist (SBA): Therapist ready to assist if needed but provides no physical contact
- Contact Guard Assist (CGA): Light touch for safety or stability; patient performs majority of task
- Minimum Assist (Min A): Patient performs 75% or more of the task; therapist provides minimal physical help
- Moderate Assist (Mod A): Patient performs 50-74% of the task; therapist provides moderate physical help
- Maximum Assist (Max A): Patient performs 25-49% of the task; therapist provides significant physical help
- Total Assist: Patient performs less than 25% of the task; therapist performs most of the task

ADAPTIVE EQUIPMENT TERMINOLOGY (use these exact terms - NO variations):
- Reacher: Long-handled device for picking up objects from floor or high shelves (NEVER call it "reacher wand" or "grabber")
- Dressing Stick: L-shaped hook for pulling on clothes
- Sock Aide: Device for applying socks without bending
- Leg Lifter: Rigid or flexible strap for lifting leg onto bed/chair
- Long-handled Shoe Horn: For putting on shoes without bending
- Built-up Handles: Foam or rubber grips added to utensils for easier grasping
- Universal Cuff: Strap with pocket for holding utensils or hygiene items
- Dycem Mat: Non-slip mat for stabilizing objects during one-handed tasks
- Button Hook: Device for fastening buttons
- Elastic Shoelaces: Alternative to traditional laces for easier shoe donding

INITIAL EVALUATION DOCUMENTATION (when note type is "initial-eval"):
- Document OBSERVATIONS ONLY - current level of function, baseline measurements, what the patient demonstrates
- Note baseline measurements: ROM (use goniometer measurements), strength (0-5 MMT scale), balance scores (Berg, Tinetti), sensation
- Document assistance level required for each activity observed
- Document safety observations: hand placements, body mechanics, time to complete tasks, number of attempts, verbal/visual cues required
- Do NOT document progress or goal achievement - that is for re-evaluations only
- Goal section should state the anticipated level of assistance to progress toward (e.g., "Goal: Patient will perform [task] with [target assistance level] within [timeframe]")

SAFETY OBSERVATIONS TO DOCUMENT:
- Hand placements: Where therapist placed hands for guard/support (e.g., "Therapist placed hands at bilateral hips for stability")
- Body mechanics: Patient's posture and alignment during activities
- Time to complete tasks: How long patient took for ADLs or mobility tasks
- Number of attempts: How many tries needed to complete a task
- Verbal cues: Number and type of verbal instructions given
- Visual cues: Demonstrations provided
- Close guarding: When therapist is within arm's reach for safety

CONTEXT-AWARE GOALS (consider patient diagnosis and prognosis):
- For stroke patients: Consider lesion location (frontal lobe = motor planning deficits; parietal = sensory deficits; temporal = cognitive/language; cerebellar = coordination)
- For TBI patients: Consider cognitive deficits (attention, memory, executive function)
- For spinal cord injury: Consider level of injury and completeness
- For orthopedic patients: Consider weight-bearing restrictions and surgical precautions
- For progressive conditions: Set realistic goals considering disease trajectory
- NEVER use "independent" as a goal if patient has significant cognitive/motor deficits that make independence unsafe or unrealistic
- Choose appropriate target assistance level based on context (Supervision, SBA, CGA, Min A, Mod A are all valid goals depending on severity)

TREATMENT / RE-EVALUATION DOCUMENTATION (when note type is "treatment"):
- Document progress since last session or since initial evaluation
- Compare current assistance levels to previous levels (e.g., "Improved from Mod A to Standby Assist")
- Note changes in measurements (ROM, strength, balance scores)
- Document current session interventions and patient response
- Update goals based on progress (may increase expectations if improving, maintain if stable)

SAFETY DOCUMENTATION (include when relevant):
- Hand placements: Where therapist placed hands for guard/support
- Body mechanics: Patient's posture and alignment during activities
- Time to complete tasks: How long patient took for ADLs or mobility tasks
- Number of attempts: How many tries needed to complete a task
- Verbal cues: Number and type of verbal instructions given
- Visual cues: Demonstrations provided
- Close guarding: When therapist is within arm's reach for safety

EXAMPLE OUTPUT - INITIAL EVALUATION:
Subjective: Patient reports right shoulder pain at 5/10 and difficulty with upper body dressing.
Objective:
- Therapeutic Exercise: Facilitated active range of motion (AROM) of the right upper extremity for 10 minutes to improve joint mobility. Patient demonstrated forward flexion to 120 degrees, abduction to 90 degrees. Required Min A for overhead reaching.
- ADL Training: Instructed patient in upper body dressing utilizing adaptive equipment (reacher for reaching socks, dressing stick for pulling up pants). Patient required Mod A for task completion. Safety: Therapist placed hands at bilateral hips for stability during standing dressing tasks. Patient required 2 attempts to don shirt. Time to complete upper body dressing: 8 minutes.
Assessment: Patient demonstrates impaired right upper extremity AROM and decreased independence with upper body dressing. Skilled intervention required to maximize safety and improve functional independence.
Plan: Continue OT per plan of care. Will progress to Min A for upper body dressing. Goal: Patient will perform upper body dressing with Standby Assist within 4 weeks.

EXAMPLE OUTPUT - TREATMENT / RE-EVALUATION:
Subjective: Patient reports improved confidence with dressing tasks.
Objective:
- ADL Training: Patient demonstrated upper body dressing with use of reacher for socks. Required Standby Assist for task completion. Improved from Mod A at initial evaluation. Time to complete: 5 minutes (decreased from 8 minutes).
Assessment: Patient progressing toward goals. Improved from Mod A to Standby Assist for upper body dressing. Demonstrates improved safety awareness and task completion time.
Plan: Continue OT. Will progress to Supervision for upper body dressing. Goal: Patient will perform upper body dressing with Supervision within 2 weeks.

INSTRUCTIONS:
Transform the following raw notes into a compliant TherapyBoss note following the rules above. Use plain text only.

IMPORTANT: When the user provides raw notes, analyze the context:
1. What is the patient's diagnosis and how does it affect their function?
2. What assistance level is documented or implied?
3. What adaptive equipment is mentioned or should be recommended?
4. What safety observations should be documented?
5. What realistic goals can be set based on the patient's condition and context?

Use the proper OT terminology for assistance levels and adaptive equipment as specified above.`;

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

    showStatus("Note generated successfully. Review before copying to TherapyBoss.", "success");
    
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
