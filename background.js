/**
 * background.js — Service worker
 *
 * 1. GENERATE_NOTE — Ollama (local, HIPAA-safe) note generation
 * 2. Deep Auto-Drive — chrome.debugger (CDP) reads the page's layering
 *    (distilled HTML, CSS, JS console, network failures) and can fill
 *    fields even when the content script isn't injected
 * 3. Browser MCP detection — optional upgrade; Chrome forbids auto-install,
 *    so we detect it and offer a one-click store link when entry misbehaves
 */

const OLLAMA_ENDPOINT = 'http://localhost:11434/api/generate';
const MODEL = 'phi3'; // fast on 8GB Macs

// Browser MCP Chrome extension (web store ID)
const BROWSER_MCP_EXT_ID = 'bjfgambnhccakkhmkepdoekmckoijdlc';
const BROWSER_MCP_STORE_URL =
  'https://chromewebstore.google.com/detail/browser-mcp-automate-your/bjfgambnhccakkhmkepdoekmckoijdlc';

// The distilled-snapshot selector MUST stay in sync between
// collectSnapshotExpression and deepFillExpression so cdp_ indexes line up.
// [contenteditable="true"] covers role-less rich-text editors (Quill, etc.).
const CDP_SELECTOR =
  'input, select, textarea, button, [role="textbox"], [role="combobox"], ' +
  '[role="button"], [role="radio"], [role="checkbox"], [role="spinbutton"], ' +
  '[contenteditable="true"], a[href]';

// ============================================================================
// OLLAMA GENERATION
// ============================================================================

function generateNote(systemPrompt, prompt) {
  return fetch(OLLAMA_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      system: systemPrompt,
      prompt,
      options: { temperature: 0.3, top_p: 0.9, num_predict: 1024 }
    })
  })
    .then(response => {
      if (!response.ok) throw new Error(`Ollama responded with status ${response.status}`);
      return response.json();
    })
    .then(data => ({ success: true, response: data.response }))
    .catch(error => ({ success: false, error: error.message }));
}

// ============================================================================
// BROWSER MCP DETECTION
// ============================================================================

function checkBrowserMcpInstalled() {
  return new Promise((resolve) => {
    try {
      chrome.management.get(BROWSER_MCP_EXT_ID, (info) => {
        if (chrome.runtime.lastError || !info) resolve({ installed: false });
        else resolve({ installed: true, enabled: info.enabled, name: info.name, version: info.version });
      });
    } catch (err) {
      resolve({ installed: false, error: String(err) });
    }
  });
}

// ============================================================================
// DEEP AUTO-DRIVE (chrome.debugger / CDP)
// ============================================================================

const activeDrives = new Map();
const driveBuffers = new Map();

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (tabId === undefined) return;
  const buf = driveBuffers.get(tabId);
  if (!buf) return;

  switch (method) {
    case 'Runtime.consoleAPICalled':
      buf.console.push({
        type: params.type || 'log',
        text: String((params.args || []).map(a => a.value !== undefined ? a.value : a.description || '').join(' ')).substring(0, 500)
      });
      break;
    case 'Runtime.exceptionThrown':
      buf.console.push({
        type: 'error',
        text: String(params.exceptionDetails?.exception?.description || params.exceptionDetails?.text || 'Uncaught exception').substring(0, 500)
      });
      break;
    case 'Log.entryAdded': {
      const entry = params.entry || {};
      if (entry.level === 'error' || entry.level === 'warning') {
        buf.console.push({ type: entry.level, text: String(entry.text || '').substring(0, 500) });
      }
      break;
    }
    case 'Network.loadingFailed': {
      const err = params.errorText || 'failed';
      if (!err.includes('ERR_ABORTED')) {
        buf.network.push({ url: String(params.requestId || ''), error: err, canceled: !!params.canceled });
      }
      break;
    }
    case 'Network.responseReceived': {
      const resp = params.response;
      if (resp && (resp.status >= 400 || resp.status === 0)) {
        buf.network.push({ url: String(resp.url || '').substring(0, 300), status: resp.status, mimeType: resp.mimeType || '' });
      }
      break;
    }
  }
});

chrome.debugger.onDetach.addListener((source) => {
  const tabId = source.tabId;
  if (tabId !== undefined) {
    activeDrives.delete(tabId);
    driveBuffers.delete(tabId);
  }
});

/** Attach CDP to a tab, collect console/network, snapshot page, detach. */
function drivePage(tabId, options = {}) {
  return new Promise(async (resolve) => {
    if (activeDrives.has(tabId)) {
      try { await chrome.debugger.detach({ tabId }); } catch (e) { /* already detached */ }
      activeDrives.delete(tabId);
      driveBuffers.delete(tabId);
    }

    try {
      await chrome.debugger.attach({ tabId }, '1.3');
    } catch (err) {
      resolve({ ok: false, error: `Could not attach debugger: ${err.message || err}`, hint: 'Deep drive is blocked on chrome:// and Web Store pages, or when DevTools is open on that tab.' });
      return;
    }

    activeDrives.set(tabId, true);
    driveBuffers.set(tabId, { console: [], network: [] });
    const buf = driveBuffers.get(tabId);

    try {
      await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
      await chrome.debugger.sendCommand({ tabId }, 'Log.enable');
      await chrome.debugger.sendCommand({ tabId }, 'Network.enable');
      await chrome.debugger.sendCommand({ tabId }, 'Page.enable');

      const collectMs = options.collectMs || 2000;
      await new Promise(r => setTimeout(r, collectMs));

      // Distilled interactive snapshot (the "HTML layering" the AI needs)
      let distilled = [];
      try {
        const res = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
          expression: collectSnapshotExpression(),
          returnByValue: true
        });
        distilled = (res.result && res.result.value) ? res.result.value : [];
      } catch (e) { distilled = []; }

      // Screenshot
      let screenshot = null;
      if (options.screenshot !== false) {
        try {
          const shot = await chrome.debugger.sendCommand({ tabId }, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
          screenshot = shot.data;
        } catch (e) { screenshot = null; }
      }

      // Visible page text
      let pageText = '';
      try {
        const res = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
          expression: 'document.body ? document.body.innerText.substring(0, 4000) : ""',
          returnByValue: true
        });
        pageText = res.result && res.result.value ? String(res.result.value) : '';
      } catch (e) { /* ignore */ }

      resolve({
        ok: true,
        fields: distilled,
        pageText,
        console: buf.console.slice(0, 100),
        network: buf.network.slice(0, 100),
        screenshot,
        url: options.url || '',
        title: options.title || ''
      });
    } catch (err) {
      resolve({ ok: false, error: String(err.message || err), console: buf.console, network: buf.network });
    } finally {
      try { await chrome.debugger.detach({ tabId }); } catch (e) { /* already detached */ }
      activeDrives.delete(tabId);
      driveBuffers.delete(tabId);
    }
  });
}

/**
 * The distilled-snapshot expression. uid = kept-counter position (elements
 * that PASS the visibility filters), which matches deepFillExpression's
 * kept[] indexing. Same skip logic + selector as deepFill.
 */
function collectSnapshotExpression() {
  return `(() => {
    const sel = ${JSON.stringify(CDP_SELECTOR)};
    const out = [];
    let k = 0;
    document.querySelectorAll(sel).forEach((el) => {
      try {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (el.getAttribute('aria-hidden') === 'true') return;
        let label = '';
        if (el.id) { try { const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]'); if (l) label = l.innerText.trim(); } catch (e) {} }
        if (!label && el.closest('label')) { const c = el.closest('label').cloneNode(true); c.querySelectorAll('input, select, textarea').forEach(x => x.remove()); label = c.innerText.trim(); }
        if (!label && el.getAttribute('aria-label')) label = el.getAttribute('aria-label');
        const o = [];
        if (el.tagName === 'SELECT') { for (const opt of el.options) o.push({ value: opt.value, label: opt.text.trim(), selected: opt.selected }); }
        const value = (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT')
          ? (el.value || '')
          : (el.innerText || '');
        out.push({
          uid: 'cdp_' + (k++),
          tag: el.tagName.toLowerCase(),
          type: el.type || el.getAttribute('role') || '',
          name: el.name || '',
          id: el.id || '',
          placeholder: el.placeholder || '',
          label,
          value,
          role: el.getAttribute('role') || '',
          contentEditable: el.contentEditable || '',
          required: !!el.required,
          disabled: !!el.disabled,
          options: o,
          classes: typeof el.className === 'string' ? el.className.substring(0, 200) : '',
          rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) }
        });
      } catch (e) {}
    });
    return out;
  })()`;
}

/** Fill fields in the page by cdp_ index, using the same selector + skip logic. */
function deepFillExpression(targets) {
  return `(() => {
    const sel = ${JSON.stringify(CDP_SELECTOR)};
    const wanted = ${JSON.stringify(targets)}; // [{ index, text }]
    const els = document.querySelectorAll(sel);
    const kept = [];
    els.forEach((el) => {
      try {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return;
        if (el.getAttribute('aria-hidden') === 'true') return;
        kept.push(el);
      } catch (e) {}
    });
    const results = [];
    for (const w of wanted) {
      const el = kept[w.index];
      if (!el) { results.push({ index: w.index, success: false, error: 'not found' }); continue; }
      try {
        el.focus();
        if (el.isContentEditable || el.getAttribute('contenteditable') === 'true') {
          el.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, w.text);
        } else {
          const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
          if (setter) setter.call(el, w.text); else el.value = w.text;
        }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('blur', { bubbles: true }));
        results.push({ index: w.index, success: true });
      } catch (e) {
        results.push({ index: w.index, success: false, error: String(e.message || e) });
      }
    }
    return results;
  })()`;
}

// ============================================================================
// MESSAGE ROUTING
// ============================================================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type || request.action) {
    case 'GENERATE_NOTE':
    case 'generateNote':
      generateNote(request.systemPrompt, request.prompt).then(sendResponse);
      return true; // async

    case 'FILL_NOTE':
    case 'fillLegacy':
      // Route to content script (legacy single-field fill)
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]) { sendResponse({ success: false, error: 'No active tab found.' }); return; }
        chrome.tabs.sendMessage(tabs[0].id, { action: 'fillLegacy', text: request.text, force: request.force }, (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({ success: false, error: 'Could not connect to page. Please refresh the EMR tab and try again.' });
          } else {
            sendResponse(response);
          }
        });
      });
      return true;

    case 'checkBrowserMcp':
      checkBrowserMcpInstalled().then(sendResponse);
      return true;

    case 'openMcpStore':
      chrome.tabs.create({ url: BROWSER_MCP_STORE_URL });
      sendResponse({ ok: true });
      break;

    case 'deepScrape': {
      const tabId = request.tabId || (sender.tab && sender.tab.id);
      if (!tabId) { sendResponse({ ok: false, error: 'No tab id' }); break; }
      chrome.tabs.get(tabId, (tab) => {
        drivePage(tabId, { url: tab && tab.url, title: tab && tab.title }).then(sendResponse);
      });
      return true;
    }

    case 'deepFill': {
      const tabId = request.tabId || (sender.tab && sender.tab.id);
      if (!tabId) { sendResponse({ ok: false, error: 'No tab id' }); break; }
      (async () => {
        try {
          await chrome.debugger.attach({ tabId }, '1.3');
          await chrome.debugger.sendCommand({ tabId }, 'Runtime.enable');
          const res = await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
            expression: deepFillExpression(request.targets || []),
            returnByValue: true
          });
          const results = (res.result && res.result.value) ? res.result.value : [];
          sendResponse({ ok: true, results });
        } catch (e) {
          sendResponse({ ok: false, error: String(e.message || e) });
        } finally {
          try { await chrome.debugger.detach({ tabId }); } catch (e) {}
          activeDrives.delete(tabId);
          driveBuffers.delete(tabId);
        }
      })();
      return true;
    }

    default:
      sendResponse({ error: 'Unknown message type: ' + (request.type || request.action) });
  }
  return undefined;
});
