/**
 * content.js — Generic page engine for the auto-fill pipeline.
 *
 * Runs on ANY website (see manifest). Three jobs:
 *   1. SCRAPE_PAGE  — read the page: fields (with labels/options), note
 *                     targets (using the platform config + live DOM selectors)
 *   2. FILL         — write text into targets with the React/MUI-safe native
 *                     setter hack (also handles contenteditable rich editors)
 *   3. FILL_NOTE    — legacy single-textarea fill (kept for compatibility)
 *
 * The popup orchestrates; if this script is not injected (e.g. page opened
 * before the extension loaded), the popup falls back to the chrome.debugger
 * deep drive in background.js.
 */

// ============================================================================
// FIELD DISCOVERY
// ============================================================================

const SCRAPE_SELECTOR =
  'input:not([type="hidden"]), select, textarea, [role="textbox"], ' +
  '[role="combobox"], [role="spinbutton"], [contenteditable="true"]';

function findLabel(el) {
  if (el.id) {
    try {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent.trim();
    } catch (e) { /* selector-safe fallthrough */ }
  }
  const parentLabel = el.closest('label');
  if (parentLabel) {
    const clone = parentLabel.cloneNode(true);
    clone.querySelectorAll('input, select, textarea').forEach(e => e.remove());
    const text = clone.textContent.trim();
    if (text) return text;
  }
  if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const labelEl = document.getElementById(labelledBy);
    if (labelEl) return labelEl.textContent.trim();
  }
  return '';
}

function extractOptions(el) {
  if (el.tagName === 'SELECT') {
    return Array.from(el.options).map(opt => ({
      value: opt.value, label: opt.textContent.trim(), selected: opt.selected
    }));
  }
  if ((el.type === 'radio' || el.type === 'checkbox') && el.name) {
    const group = document.querySelectorAll(`input[name="${CSS.escape(el.name)}"]`);
    return Array.from(group).map(opt => ({
      value: opt.value, label: findLabel(opt) || opt.value, selected: opt.checked
    }));
  }
  return [];
}

function fieldValue(el) {
  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
    return el.innerText || '';
  }
  return el.value || '';
}

/** Full page scrape — the same shape the deep-drive path produces. */
function scrapePage(config) {
  const fields = [];

  // Kept-counter uid: index among elements that PASSED the visibility filters.
  // findElementByUid re-applies the same filters, so the positions line up.
  let keptIndex = 0;
  document.querySelectorAll(SCRAPE_SELECTOR).forEach((el) => {
    if (el.offsetParent === null) return;
    if (el.getAttribute('aria-hidden') === 'true') return;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return;

    fields.push({
      uid: `el_${keptIndex++}`,
      tag: el.tagName.toLowerCase(),
      type: el.type || el.getAttribute('role') || '',
      name: el.name || '',
      id: el.id || '',
      placeholder: el.placeholder || '',
      label: findLabel(el),
      value: fieldValue(el),
      role: el.getAttribute('role') || '',
      contentEditable: el.contentEditable || '',
      required: el.required || el.getAttribute('aria-required') === 'true',
      disabled: el.disabled || el.getAttribute('aria-disabled') === 'true',
      options: extractOptions(el),
      rect: {
        x: Math.round(rect.x), y: Math.round(rect.y),
        width: Math.round(rect.width), height: Math.round(rect.height)
      },
      classes: typeof el.className === 'string' ? el.className.substring(0, 200) : ''
    });
  });

  // Live-DOM selector hits from the platform config (more precise than
  // attribute keyword matching). These become the top note candidates.
  const domTargets = [];
  if (config && config.noteField && config.noteField.selectors) {
    for (const selector of config.noteField.selectors) {
      try {
        document.querySelectorAll(selector).forEach((el) => {
          if (el.offsetParent === null) return;
          domTargets.push({
            uid: tagElement(el),
            label: findLabel(el) || el.placeholder || el.name || selector,
            hasText: !!(fieldValue(el) && fieldValue(el).trim())
          });
        });
      } catch (e) { /* invalid selector — skip */ }
    }
  }

  return {
    url: window.location.href,
    title: document.title,
    fields,
    domTargets: dedupeTargets(domTargets)
  };
}

function dedupeTargets(targets) {
  const seen = new Set();
  return targets.filter(t => {
    const k = t.uid;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ============================================================================
// FILLING (React/MUI-safe native setter + rich editor support)
// ============================================================================

function setNativeValue(el, value) {
  const proto = el.tagName === 'TEXTAREA'
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

function fillElement(el, text) {
  el.focus();

  if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
    // Rich text editors (Quill, CKEditor, contenteditable divs)
    el.focus();
    document.execCommand('selectAll', false, null);
    document.execCommand('insertText', false, text);
  } else {
    setNativeValue(el, text);
  }

  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('blur', { bubbles: true }));
}

/** The visibility filters used when assigning el_ / cdp_ indexes. */
function isVisibleInteractive(el) {
  if (el.offsetParent === null) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  const r = el.getBoundingClientRect();
  return !(r.width === 0 && r.height === 0);
}

function findElementByUid(uid) {
  if (!uid) return null;
  if (uid.startsWith('el_')) {
    const index = parseInt(uid.slice(3), 10);
    const kept = [];
    document.querySelectorAll(SCRAPE_SELECTOR).forEach((el) => {
      if (isVisibleInteractive(el)) kept.push(el);
    });
    return kept[index] || null;
  }
  if (uid.startsWith('cdp_')) {
    // Deep-drive uid — index into the CDP distilled selector list
    const index = parseInt(uid.slice(4), 10);
    const sel = 'input, select, textarea, button, [role="textbox"], [role="combobox"], [role="button"], [role="radio"], [role="checkbox"], [role="spinbutton"], [contenteditable="true"], a[href]';
    const kept = [];
    document.querySelectorAll(sel).forEach((el) => {
      try {
        if (isVisibleInteractive(el)) kept.push(el);
      } catch (e) { /* skip */ }
    });
    return kept[index] || null;
  }
  return document.querySelector(`[data-scribe-uid="${CSS.escape(uid)}"]`) || null;
}

function tagElement(el) {
  if (!el.dataset) return '';
  if (!el.dataset.scribeUid) {
    el.dataset.scribeUid = `t_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
  return el.dataset.scribeUid;
}

// ============================================================================
// LEGACY SINGLE-TEXTAREA FILL (compat with the original TherapyBoss autofill)
// ============================================================================

function findNoteTextarea() {
  const selectors = [
    'textarea[id*="note" i]', 'textarea[name*="note" i]',
    'textarea[class*="note" i]', 'textarea[id*="soap" i]',
    'textarea[id*="treatment" i]', 'textarea[name*="treatment" i]',
    'textarea[id*="daily" i]', '.note-editor', '#note-content',
    '.ql-editor[contenteditable="true"]'
  ];
  for (const selector of selectors) {
    try {
      const el = document.querySelector(selector);
      if (el) return el;
    } catch (e) { /* skip */ }
  }
  const all = Array.from(document.querySelectorAll('textarea, [contenteditable="true"][role="textbox"], .ql-editor'));
  if (all.length === 0) return null;
  return all.reduce((prev, cur) => {
    return (prev.clientHeight * prev.clientWidth > cur.clientHeight * cur.clientWidth) ? prev : cur;
  });
}

// ============================================================================
// MESSAGE HANDLING
// ============================================================================

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  switch (msg.action) {
    case 'ping':
      sendResponse({ status: 'ok', ts: Date.now() });
      return true;

    case 'scrape': {
      sendResponse(scrapePage(msg.config));
      return true;
    }

    case 'fill': {
      const results = [];
      for (const target of msg.targets || []) {
        if (!target.text) { results.push({ uid: target.uid, skipped: true }); continue; }
        const el = findElementByUid(target.uid);
        if (!el) { results.push({ uid: target.uid, success: false, error: 'Element not found' }); continue; }
        try {
          fillElement(el, target.text);
          results.push({ uid: target.uid, success: true, label: target.label });
        } catch (err) {
          results.push({ uid: target.uid, success: false, error: String(err.message || err) });
        }
      }
      sendResponse({ success: results.every(r => r.success !== false && r.skipped !== true), results });
      return true;
    }

    case 'fillLegacy': {
      const textarea = findNoteTextarea();
      if (!textarea) {
        sendResponse({ success: false, error: 'Could not find the note text box on this page. Please ensure you are on the correct EMR screen.' });
        return true;
      }
      if (textarea.value && textarea.value.trim() !== '' && !msg.force) {
        const ok = confirm('The note box already contains text. Do you want to overwrite it?');
        if (!ok) { sendResponse({ success: false, error: 'Overwrite cancelled by user.' }); return true; }
      }
      fillElement(textarea, msg.text);
      sendResponse({ success: true, uid: tagElement(textarea) });
      return true;
    }

    case 'checkTargetText': {
      // Returns whether a target uid currently holds text (for overwrite prompt)
      const out = [];
      for (const uid of msg.uids || []) {
        const el = findElementByUid(uid);
        out.push({ uid, hasText: !!(el && fieldValue(el) && fieldValue(el).trim() !== '') });
      }
      sendResponse({ results: out });
      return true;
    }

    default:
      sendResponse({ error: 'Unknown action' });
  }
  return true;
});

console.log('[TherapyNote] content script loaded on', window.location.href);
