/**
 * configs.js — Site profiles for the auto-fill engine.
 *
 * Loaded by BOTH the popup (for the platform dropdown + target picking) and
 * the content script (for DOM-selector based note-field discovery).
 *
 * The point of this file: home health companies work across multiple EMRs,
 * so the fill engine is site-agnostic. Each profile describes how to find
 * the note field(s) on that platform. `generic` works on any website.
 *
 * To add a new platform: copy any profile, set `domains` and the field
 * hints, then list the platform in the popup dropdown (popup.html).
 */

// Keywords used to recognize SOAP-style separate note fields on platforms
// that split the note into sections (rare, but exists). If a page has
// multiple textareas matching these, the note is split by header.
const SOAP_SECTION_KEYWORDS = [
  'subjective', 'objective', 'assessment', 'plan',
  'interventions', 'progress', 'treatment', 'narrative'
];

window.SITE_CONFIGS = {
  auto: {
    label: 'Auto-detect',
    domains: [],
    noteField: {
      // Matched against field id/name/class/label (case-insensitive substring)
      labelKeywords: [
        'note', 'clinical', 'progress', 'soap', 'documentation',
        'treatment', 'daily', 'visit', 'narrative', 'comment'
      ],
      // DOM selectors tried first (content-script path only)
      selectors: [
        'textarea[id*="note" i]',
        'textarea[name*="note" i]',
        'textarea[class*="note" i]',
        'textarea[placeholder*="note" i]',
        'textarea[id*="soap" i]',
        'textarea[id*="treatment" i]',
        'textarea[name*="treatment" i]',
        'textarea[id*="daily" i]',
        'textarea[id*="narrative" i]',
        '[role="textbox"][aria-label*="note" i]',
        '[contenteditable="true"][aria-label*="note" i]'
      ]
    },
    sections: [] // empty = single combined note field
  },

  therapyboss: {
    label: 'TherapyBoss',
    domains: ['therapyboss.com'],
    noteField: {
      labelKeywords: [
        'clinical note', 'progress note', 'treatment note', 'note',
        'soap', 'documentation', 'daily note', 'visit note', 'narrative'
      ],
      selectors: [
        'textarea[id*="note" i]',
        'textarea[name*="note" i]',
        'textarea[class*="note" i]',
        'textarea[id*="soap" i]',
        'textarea[id*="treatment" i]',
        'textarea[name*="treatment" i]',
        '.note-editor textarea',
        '#note-content',
        '#noteContent',
        '.ql-editor[contenteditable="true"]',
        '[role="textbox"][aria-label*="note" i]'
      ]
    },
    sections: []
  },

  wellsky: {
    label: 'WellSky / Kinnser',
    domains: ['kinnser.net', 'wellsky.com', 'kinnser.com'],
    noteField: {
      labelKeywords: [
        'narrative', 'clinical note', 'progress note', 'visit note',
        'note', 'documentation', 'comment', 'session'
      ],
      selectors: [
        'textarea[id*="note" i]',
        'textarea[name*="note" i]',
        'textarea[class*="note" i]',
        'textarea[id*="narrative" i]',
        'textarea[name*="narrative" i]',
        'textarea[id*="documentation" i]',
        'textarea[id*="comment" i]',
        '[role="textbox"][aria-label*="note" i]'
      ]
    },
    sections: []
  },

  axxess: {
    label: 'Axxess',
    domains: ['axxess.com'],
    noteField: {
      labelKeywords: [
        'note', 'clinical', 'progress', 'documentation', 'treatment',
        'narrative', 'visit summary'
      ],
      selectors: [
        'textarea[id*="note" i]',
        'textarea[name*="note" i]',
        'textarea[class*="note" i]',
        'textarea[id*="documentation" i]',
        'textarea[id*="narrative" i]',
        '[role="textbox"][aria-label*="note" i]',
        '[contenteditable="true"][aria-label*="note" i]'
      ]
    },
    sections: []
  },

  intakeq: {
    label: 'IntakeQ',
    domains: ['intakeq.com'],
    noteField: {
      labelKeywords: [
        'note', 'notes', 'comment', 'remarks', 'description'
      ],
      selectors: [
        'textarea[id*="note" i]',
        'textarea[name*="note" i]',
        'textarea[class*="note" i]',
        'textarea[placeholder*="note" i]',
        'textarea[id*="comment" i]',
        '[role="textbox"][aria-label*="note" i]'
      ]
    },
    sections: []
  },

  generic: {
    label: 'Generic (any site)',
    domains: [],
    noteField: {
      labelKeywords: [
        'note', 'notes', 'documentation', 'clinical', 'progress',
        'treatment', 'soap', 'daily', 'visit', 'comment', 'narrative'
      ],
      selectors: [
        'textarea[placeholder*="note" i]',
        'textarea[id*="note" i]',
        'textarea[name*="note" i]',
        'textarea[class*="note" i]',
        'textarea[id*="documentation" i]',
        'textarea[id*="clinical" i]',
        'textarea[id*="progress" i]',
        '[role="textbox"][aria-label*="note" i]',
        '[contenteditable="true"][aria-label*="note" i]'
      ]
    },
    sections: []
  }
};

// ────────────────────────────────────────────────────────────────────────────
// Target-picking helpers (shared by popup for deep-drive results and used by
// the content script for live DOM matching)
// ────────────────────────────────────────────────────────────────────────────

/** Detect which platform a URL belongs to; falls back to the given explicit pick. */
function detectPlatform(url) {
  if (!url) return 'auto';
  const host = url.toLowerCase();
  for (const key of Object.keys(window.SITE_CONFIGS)) {
    if (key === 'auto' || key === 'generic') continue;
    const cfg = window.SITE_CONFIGS[key];
    if (cfg.domains.some(d => host.includes(d))) return key;
  }
  return 'auto';
}

/**
 * Rank candidate note fields from a scraped field list (used when we only
 * have attribute data, e.g. the chrome.debugger deep-drive path).
 * Returns [{ uid, label, score, hasText }] sorted best-first.
 */
function pickNoteTargetsFromFields(fields, config) {
  const kw = (config.noteField.labelKeywords || []);
  const haystack = (f) => [
    f.id, f.name, f.classes || '', f.label, f.placeholder
  ].filter(Boolean).join(' ').toLowerCase();

  const candidates = (fields || [])
    .filter(f => f.tag === 'textarea' || f.tag === 'input' || f.role === 'textbox' || f.contentEditable === 'true')
    .map(f => {
      const h = haystack(f);
      let score = 0;
      for (const k of kw) {
        if (h.includes(k)) {
          // More specific keyword = stronger signal
          score += k.split(' ').length > 1 ? 4 : 2;
        }
      }
      // Prefer large fields (the note box is usually the biggest)
      const area = (f.rect ? f.rect.width * f.rect.height : 0) || 0;
      return { f, score, area };
    })
    .filter(c => c.score > 0 || c.area > 10000) // real note fields only
    .sort((a, b) => (b.score - a.score) || (b.area - a.area))
    .map((c, i) => ({
      uid: c.f.uid,
      label: c.f.label || c.f.placeholder || c.f.name || c.f.id || 'note field',
      score: c.score,
      hasText: !!(c.f.value && c.f.value.trim()),
      area: c.area
    }));

  return candidates;
}

/**
 * Pick the final fill plan: either a single combined note target, or a set
 * of SOAP section targets when the page clearly splits them.
 * Returns { mode: 'single'|'sections', targets: [{uid,label,text}] } with
 * `noteText` already split per section when mode === 'sections'.
 */
function buildFillPlan(fields, config, noteText) {
  const ranked = pickNoteTargetsFromFields(fields, config);

  // Section-split mode: page has several fields matching SOAP keywords.
  const soapKws = SOAP_SECTION_KEYWORDS;
  const sectionTargets = ranked.filter(t => {
    const l = (t.label || '').toLowerCase();
    return soapKws.some(k => l.includes(k));
  });

  if (sectionTargets.length >= 2 && sectionTargets.length <= 6) {
    const targets = splitNoteBySections(noteText, sectionTargets);
    return { mode: 'sections', targets };
  }

  // Single mode: best candidate only.
  if (ranked.length === 0) return { mode: 'single', targets: [] };
  return {
    mode: 'single',
    targets: [{ uid: ranked[0].uid, label: ranked[0].label, text: noteText, hasText: ranked[0].hasText }]
  };
}

/** Split a SOAP note into sections for platforms with separate fields. */
function splitNoteBySections(noteText, sectionTargets) {
  // Parse the note's "Header: body" blocks
  const lines = noteText.split(/\r?\n/);
  const blocks = [];           // {header, body}
  let current = null;
  const headerRe = /^([A-Z][A-Za-z ]{2,40}?)[:]\s*(.*)$/;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(headerRe);
    if (m && m[1].length <= 40 && !/^(http|www)/i.test(line)) {
      if (current) blocks.push(current);
      current = { header: m[1].toLowerCase(), body: m[2] };
    } else if (current) {
      current.body += '\n' + line;
    }
  }
  if (current) blocks.push(current);

  // Map blocks to targets by keyword; leftover text goes to the best target.
  const assigned = new Set();
  const targets = sectionTargets.map(t => {
    const label = (t.label || '').toLowerCase();
    const hit = blocks.find((b, bi) => {
      if (assigned.has(bi)) return false;
      // header keyword must appear in the label, or vice versa
      const bkw = b.header.split(/\s+/)[0];
      return label.includes(bkw) || bkw.includes(label.split(/\s+/)[0]);
    });
    if (hit) {
      assigned.add(blocks.indexOf(hit));
      // Skip header-only blocks ("Plan: " with nothing) — don't fill an empty section
      const body = hit.body.trim();
      return { uid: t.uid, label: t.label, text: body ? `${cap(hit.header)}: ${body}` : '' };
    }
    return { uid: t.uid, label: t.label, text: '' };
  });

  // Unassigned blocks go into the first empty target
  const remaining = blocks.filter((b, bi) => !assigned.has(bi) && b.body.trim());
  for (const t of targets) {
    if (remaining.length === 0) break;
    if (!t.text.trim()) {
      const r = remaining.shift();
      t.text = `${cap(r.header)}: ${r.body.trim()}`;
    }
  }

  // Final safety: if nothing was mapped (odd note formatting), dump the whole
  // note into the first target and blank the rest.
  if (targets.every(t => !t.text.trim())) {
    targets[0].text = noteText;
    for (let i = 1; i < targets.length; i++) targets[i].text = '';
  }
  return targets.filter(t => t.text.trim());
}

function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

// Explicitly expose the helpers on window so they are shareable by the popup
// (and content script) in classic-script scope — including Node-based tests.
window.detectPlatform = detectPlatform;
window.pickNoteTargetsFromFields = pickNoteTargetsFromFields;
window.buildFillPlan = buildFillPlan;
window.splitNoteBySections = splitNoteBySections;
