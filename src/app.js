// The clinician-facing web app, served at "/" by worker.js. A single page with
// no external scripts or fonts. Note text is never written to browser storage;
// only the access key (if "remember" is ticked) and the last note type are.
// Kept as a plain string (no ${...}) so worker.js can import it in Node tests.
export const APP_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Note Scribe</title>
<style>
  :root {
    --bg: #f6f7f9; --surface: #ffffff; --text: #1b2430; --muted: #5b6676; --line: #dde2e8;
    --accent: #1f6feb; --accent-text: #ffffff; --ok-bg: #e7f6ec; --ok-text: #17633a;
    --warn-bg: #fff4dc; --warn-text: #7a4b00; --err-bg: #fde8e8; --err-text: #9b1c1c;
    --focus: #1f6feb55;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #11151b; --surface: #1a2029; --text: #e6eaf0; --muted: #9aa5b4; --line: #2c3540;
      --accent: #4c8dff; --accent-text: #0b1220; --ok-bg: #12301f; --ok-text: #8fe0ad;
      --warn-bg: #3a2c0d; --warn-text: #ffd27a; --err-bg: #3b1515; --err-text: #ffb4b4;
      --focus: #4c8dff66;
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  header { display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 14px 20px; background: var(--surface); border-bottom: 1px solid var(--line); }
  .brand { font-weight: 700; font-size: 1.15rem; }
  .badge { font-size: .75rem; font-weight: 600; padding: 2px 8px; border-radius: 999px;
    background: var(--warn-bg); color: var(--warn-text); margin-left: 8px; vertical-align: middle; }
  main { max-width: 1200px; margin: 0 auto; padding: 20px; }
  .notice { background: var(--warn-bg); color: var(--warn-text); border-radius: 10px;
    padding: 12px 16px; margin-bottom: 20px; font-size: .95rem; }
  .card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 20px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start; }
  @media (max-width: 860px) { .grid { grid-template-columns: 1fr; } }
  h2 { font-size: 1.05rem; margin: 0 0 14px; }
  label { display: block; font-weight: 600; margin: 0 0 6px; }
  .hint { color: var(--muted); font-size: .9rem; margin: 4px 0 0; }
  textarea, input[type=password], input[type=text], select {
    width: 100%; font: inherit; color: var(--text); background: var(--bg);
    border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
  textarea { min-height: 260px; resize: vertical; }
  textarea:focus, input:focus, select:focus, button:focus-visible { outline: 3px solid var(--focus); outline-offset: 1px; }
  .row { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 14px; }
  .row > div { flex: 1 1 200px; }
  .segmented { display: flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
  .segmented button { flex: 1; border: 0; background: var(--bg); color: var(--text); padding: 10px; font: inherit; cursor: pointer; }
  .segmented button[aria-pressed=true] { background: var(--accent); color: var(--accent-text); font-weight: 600; }
  .btn { border: 0; border-radius: 8px; padding: 12px 18px; font: inherit; font-weight: 600; cursor: pointer; }
  .btn-primary { background: var(--accent); color: var(--accent-text); }
  .btn-secondary { background: var(--bg); color: var(--text); border: 1px solid var(--line); }
  .btn:disabled { opacity: .6; cursor: wait; }
  .actions { display: flex; gap: 10px; align-items: center; margin-top: 14px; flex-wrap: wrap; }
  .status { border-radius: 10px; padding: 12px 16px; margin-bottom: 14px; }
  .status.ok { background: var(--ok-bg); color: var(--ok-text); }
  .status.warn { background: var(--warn-bg); color: var(--warn-text); }
  .status.err { background: var(--err-bg); color: var(--err-text); }
  .status strong { display: block; margin-bottom: 2px; }
  .status ul { margin: 6px 0 0; padding-left: 20px; }
  .empty { color: var(--muted); text-align: center; padding: 60px 10px; }
  .muted-list { color: var(--muted); font-size: .9rem; margin-top: 14px; }
  .muted-list ul { margin: 4px 0 0; padding-left: 20px; }
  .signin { max-width: 440px; margin: 40px auto; }
  .check { display: flex; gap: 8px; align-items: center; font-weight: 400; margin: 12px 0 16px; }
  .link { background: none; border: 0; color: var(--accent); font: inherit; cursor: pointer; padding: 0; }
  [hidden] { display: none !important; }
</style>
</head>
<body>
<header>
  <div><span class="brand">Note Scribe</span><span class="badge">Pilot</span></div>
  <button class="link" id="signOut" hidden>Sign out</button>
</header>
<main>
  <div class="notice" role="note">
    <strong>Pilot version, not yet HIPAA compliant.</strong>
    Do not enter patient names, dates of birth, record numbers, addresses or other identifiers.
    Always review the note before using it.
  </div>

  <section id="signInView" class="card signin" hidden>
    <h2>Sign in</h2>
    <form id="signInForm">
      <label for="key">Access key</label>
      <input type="password" id="key" autocomplete="current-password" required>
      <p class="hint">Your access key was given to you by your administrator. It starts with nscrb_.</p>
      <label class="check"><input type="checkbox" id="remember"> Remember me on this computer</label>
      <div id="signInError" class="status err" hidden></div>
      <button class="btn btn-primary" type="submit" id="signInBtn">Sign in</button>
    </form>
  </section>

  <section id="appView" class="grid" hidden>
    <div class="card">
      <h2>1. Your shorthand notes</h2>
      <div class="row">
        <div>
          <label id="typeLabel">Note type</label>
          <div class="segmented" role="group" aria-labelledby="typeLabel">
            <button type="button" data-type="treatment" aria-pressed="true">Treatment</button>
            <button type="button" data-type="initial-eval" aria-pressed="false">Initial evaluation</button>
          </div>
        </div>
        <div>
          <label for="ehr">Format for</label>
          <select id="ehr">
            <option value="">General</option>
            <option value="therapyboss">TherapyBOSS</option>
            <option value="kinnser">Kinnser</option>
          </select>
        </div>
      </div>
      <label for="raw">Notes</label>
      <textarea id="raw" placeholder="e.g. pt reports less R hip pain. UB dressing min A. amb 10 ft RW CGA."></textarea>
      <p class="hint">Write the way you normally would. Only what you write here can appear in the note.</p>
      <div class="actions">
        <button class="btn btn-primary" id="generate">Write SOAP note</button>
        <button class="btn btn-secondary" id="clear">Clear</button>
        <span class="hint">or press Ctrl + Enter</span>
      </div>
    </div>

    <div class="card" aria-live="polite">
      <h2>2. Review and copy</h2>
      <div id="empty" class="empty">Your SOAP note will appear here.</div>
      <div id="working" class="empty" hidden>Writing your note. This usually takes under 10 seconds.</div>
      <div id="result" hidden>
        <div id="status" class="status"></div>
        <label for="note">SOAP note (you can edit it)</label>
        <textarea id="note"></textarea>
        <div class="actions">
          <button class="btn btn-primary" id="copy">Copy note</button>
        </div>
        <div id="gaps" class="muted-list" hidden>
          Not in your notes (add these yourself only if you assessed them):
          <ul id="gapList"></ul>
        </div>
      </div>
    </div>
  </section>
</main>
<script>
(function () {
  var KEY_STORE = 'noteScribeKey';
  var TYPE_STORE = 'noteScribeType';
  var apiKey = null;
  var noteType = 'treatment';

  function $(id) { return document.getElementById(id); }
  function store(kind) { try { return window[kind]; } catch (e) { return null; } }
  function read(name) {
    var stores = [store('sessionStorage'), store('localStorage')];
    for (var i = 0; i < stores.length; i++) {
      try { var v = stores[i] && stores[i].getItem(name); if (v) return v; } catch (e) {}
    }
    return null;
  }
  function write(kind, name, value) { try { var s = store(kind); if (s) s.setItem(name, value); } catch (e) {} }
  function forget(name) {
    ['sessionStorage', 'localStorage'].forEach(function (k) { try { var s = store(k); if (s) s.removeItem(name); } catch (e) {} });
  }

  function show(view) {
    $('signInView').hidden = view !== 'signin';
    $('appView').hidden = view !== 'app';
    $('signOut').hidden = view !== 'app';
  }

  function api(path, options) {
    options = options || {};
    options.headers = Object.assign({ 'X-API-Key': apiKey, 'Content-Type': 'application/json' }, options.headers || {});
    return fetch(path, options).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) { return { status: res.status, body: body }; });
    });
  }

  function signIn(key, remember) {
    apiKey = key;
    return api('/api/v1/auth/check').then(function (r) {
      if (r.status !== 200) {
        apiKey = null;
        throw new Error(r.status === 401 ? (r.body.error === 'API key deactivated'
          ? 'This access key has been turned off. Ask your administrator for a new one.'
          : 'That access key was not recognized. Check it and try again.')
          : 'Could not sign in right now. Please try again in a minute.');
      }
      forget(KEY_STORE);
      write(remember ? 'localStorage' : 'sessionStorage', KEY_STORE, key);
      show('app');
    });
  }

  $('signInForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var err = $('signInError');
    err.hidden = true;
    $('signInBtn').disabled = true;
    signIn($('key').value.trim(), $('remember').checked).catch(function (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    }).then(function () { $('signInBtn').disabled = false; });
  });

  $('signOut').addEventListener('click', function () {
    forget(KEY_STORE);
    apiKey = null;
    $('raw').value = '';
    resetOutput();
    $('key').value = '';
    show('signin');
  });

  function setType(type) {
    noteType = type;
    document.querySelectorAll('.segmented button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-type') === type));
    });
    write('localStorage', TYPE_STORE, type);
  }
  document.querySelectorAll('.segmented button').forEach(function (b) {
    b.addEventListener('click', function () { setType(b.getAttribute('data-type')); });
  });

  function resetOutput() {
    $('empty').hidden = false;
    $('working').hidden = true;
    $('result').hidden = true;
  }

  // Turn the API's correction messages into plain language for clinicians.
  function plainIssue(issue) {
    var m = issue.match(/^Remove values not present in the raw notes[^:]*:\\s*(.*)$/);
    if (m) return 'These details are not in your notes. Check them, or delete them: ' + m[1];
    m = issue.match(/^Remove billing codes not present in the raw notes:\\s*(.*)$/);
    if (m) return 'These billing codes are not in your notes. Delete them: ' + m[1];
    return issue;
  }

  function list(el, items) {
    el.textContent = '';
    items.forEach(function (text) { var li = document.createElement('li'); li.textContent = text; el.appendChild(li); });
  }

  function showResult(kind, title, detail, items) {
    var box = $('status');
    box.className = 'status ' + kind;
    box.textContent = '';
    var strong = document.createElement('strong');
    strong.textContent = title;
    box.appendChild(strong);
    if (detail) box.appendChild(document.createTextNode(detail));
    if (items && items.length) { var ul = document.createElement('ul'); list(ul, items); box.appendChild(ul); }
  }

  function generate() {
    var raw = $('raw').value.trim();
    if (!raw || $('generate').disabled) return;
    $('generate').disabled = true;
    $('empty').hidden = true;
    $('result').hidden = true;
    $('working').hidden = false;
    var body = { raw_notes: raw, note_type: noteType };
    if ($('ehr').value) body.target_ehr = $('ehr').value;
    api('/api/v1/notes/generate', { method: 'POST', body: JSON.stringify(body) }).then(function (r) {
      $('working').hidden = true;
      $('result').hidden = false;
      $('gaps').hidden = true;
      if (r.status === 401) { $('signOut').click(); return; }
      if (r.status !== 200 || !r.body.note) {
        $('note').value = '';
        showResult('err', 'The note could not be written.',
          r.status === 429 ? ' Too many requests. Please wait a minute and try again.' : ' Please try again in a minute.');
        return;
      }
      $('note').value = r.body.note;
      var v = r.body.validation || { issues: [], warnings: [] };
      if (r.body.review_required) {
        showResult('warn', 'Needs your review before use.', ' The AI added things you did not write and could not remove them:', v.issues.map(plainIssue));
      } else {
        showResult('ok', 'Ready to review.', ' Every measurement in this note was found in your notes. Read it before using it.');
      }
      var gaps = (v.warnings || []).filter(function (w) { return !/skilled language/i.test(w); });
      if (gaps.length) { list($('gapList'), gaps); $('gaps').hidden = false; }
    }).catch(function () {
      $('working').hidden = true;
      $('result').hidden = false;
      $('note').value = '';
      showResult('err', 'No connection.', ' Check your internet connection and try again.');
    }).then(function () { $('generate').disabled = false; });
  }

  $('generate').addEventListener('click', generate);
  $('raw').addEventListener('keydown', function (e) { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') generate(); });
  $('clear').addEventListener('click', function () { $('raw').value = ''; resetOutput(); $('raw').focus(); });
  $('copy').addEventListener('click', function () {
    var btn = $('copy');
    navigator.clipboard.writeText($('note').value).then(function () {
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = 'Copy note'; }, 2000);
    });
  });

  setType(read(TYPE_STORE) || 'treatment');
  var saved = read(KEY_STORE);
  if (saved) {
    signIn(saved, !!(store('localStorage') && store('localStorage').getItem(KEY_STORE))).catch(function () { forget(KEY_STORE); show('signin'); });
  } else {
    show('signin');
  }
})();
</script>
</body>
</html>
`;
