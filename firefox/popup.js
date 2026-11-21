const api = globalThis.browser ?? globalThis.chrome;
const HOST = { origins: ['*://class.nims.com.np/*'] };

const $ = (id) => document.getElementById(id);

const TOGGLES = {
  sw: 'enabled',
  's-typePaste': 'typePaste',
  's-gate': 'gateWarnings',
  's-sync': 'blockSync',
  's-visible': 'fakeVisible',
  's-modal': 'muteModal',
  's-banner': 'muteBanner',
};

/* AI settings live in storage.local (page-world features read them directly). */
const AI_KEY = 'muter.settings.v1';
const AI_DEFAULTS = { autoType: false, autoQueue: false, typeDelayMs: 62 };
const AI_TOGGLES = { 's-autoType': 'autoType', 's-autoQueue': 'autoQueue' };

let ai = { ...AI_DEFAULTS };
let hasKey = false;

let needsGrant = false;
let lastErr = '';
let lastHost = '';
let busy = false;
let logSig = '';
let resetArmed = false;
let resetTimer = null;
let delayTimer = null;

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

function friendlyErr() {
  if (!lastErr) return 'Open a page to use Muter.';
  if (lastErr.startsWith('cannot script')) return 'Browser and add-on pages cannot be scripted. Open a normal website.';
  return lastErr;
}

function setStatus(text) {
  $('status').textContent = text;
}

const FLOW_LABEL = {
  idle: 'Ready',
  extracting: 'Reading question…',
  generating: 'Asking Groq…',
  review: 'Answers ready',
  typing: 'Typing into page…',
  done: 'Filled',
};

function setFlowCard(flow) {
  const line = $('q-line');
  const state = $('q-state');
  if (!line || !state) return;
  if (!flow || !flow.number) {
    line.textContent = 'Open a lab question, then press Autofill.';
    state.textContent = 'No question detected';
    state.className = 'q-state';
    return;
  }
  line.textContent = `Q${flow.number}${flow.total ? ` of ${flow.total}` : ''} · ${flow.title || ''}`;
  state.textContent = flow.error || FLOW_LABEL[flow.state] || 'Ready';
  state.className = 'q-state'
    + (flow.error ? ' bad' : '')
    + (!flow.error && flow.state === 'done' ? ' ok' : '');
}

function diag(obj) {
  $('diag-out').textContent = Object.entries(obj)
    .map(([k, v]) => `${k}: ${v === undefined ? 'undefined' : JSON.stringify(v)}`)
    .join('\n');
}

async function tab() {
  try {
    const [t] = await api.tabs.query({ active: true, currentWindow: true });
    return t || null;
  } catch { return null; }
}

const scriptable = (t) => /^(https?|file):/.test(t.url || '');

async function call(fn, args) {
  const t = await tab();
  if (!t) { lastErr = 'no active tab'; return null; }
  try { lastHost = new URL(t.url).hostname; } catch { lastHost = ''; }
  if (!scriptable(t)) { lastErr = 'cannot script: ' + (t.url || 'unknown'); return null; }
  try {
    let granted = null;
    try { granted = await api.permissions.contains(HOST); } catch (e) { lastErr = 'permissions API: ' + e.message; }
    if (granted === false) { needsGrant = true; lastErr = 'host permission not granted'; return null; }

    const pre = await api.scripting.executeScript({
      target: { tabId: t.id }, world: 'MAIN', func: () => !!window.__muter,
    });
    if (!pre?.[0]?.result) {
      await api.scripting.executeScript({
        target: { tabId: t.id }, world: 'MAIN', files: ['inject.js'],
      });
      const post = await api.scripting.executeScript({
        target: { tabId: t.id }, world: 'MAIN', func: () => !!window.__muter,
      });
      if (!post?.[0]?.result) { lastErr = 'inject.js ran but __muter missing — check page console'; return null; }
    }

    const r = await api.scripting.executeScript({
      target: { tabId: t.id }, world: 'MAIN', func: fn, args: args || [],
    });
    needsGrant = false; lastErr = '';
    diag({ api: globalThis.browser ? 'browser' : 'chrome', tabId: t.id, url: t.url, granted, engine: true, err: null });
    return r?.[0]?.result;
  } catch (e) {
    lastErr = 'inject failed: ' + (e?.message || e);
    diag({ api: globalThis.browser ? 'browser' : 'chrome', tabId: t.id, url: t.url, err: lastErr });
    return null;
  }
}

/* ── rendering ─────────────────────────────────────────── */

function kindOf(m) {
  if (m.startsWith('warning')) return 'warn';
  if (m.startsWith('copy') || m.startsWith('cut')) return 'block';
  if (m.startsWith('drop')) return 'drop';
  if (m.startsWith('paste')) return 'paste';
  if (m.startsWith('typed')) return 'type';
  return 'cfg';
}

function renderLog(logs) {
  const log = $('log');
  const prev = log.scrollTop;
  log.textContent = '';

  if (!logs.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No activity on this page yet.';
    log.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const entry of logs) {
    const row = document.createElement('div');
    row.className = 'lrow';

    const kind = document.createElement('i');
    kind.className = 'k ' + kindOf(entry.msg);

    const date = new Date(entry.t);
    const pad = (n) => String(n).padStart(2, '0');
    const time = document.createElement('time');
    time.textContent = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
    time.title = date.toLocaleString();

    const msg = document.createElement('span');
    msg.className = 'm';
    msg.textContent = entry.msg;

    row.append(kind, time, msg);
    frag.appendChild(row);
  }
  log.appendChild(frag);
  log.scrollTop = prev;
}

function render(st) {
  const banner = $('banner');

  if (!st) {
    document.body.classList.add('unavailable');
    document.body.classList.remove('paused');
    $('settings').disabled = true;
    $('sw').disabled = true;
    $('ai-fill').disabled = true;
    $('mix').classList.remove('on');
    if (logSig !== 'unavailable') { logSig = 'unavailable'; renderLog([]); }
    setStatus(needsGrant ? 'Access needed' : 'Not available here');
    setFlowCard(null);
    banner.classList.toggle('grant', needsGrant);
    banner.style.display = 'block';
    $('banner-title').textContent = needsGrant ? 'Host access needed' : 'Muter isn’t running here';
    $('banner-msg').textContent = needsGrant
      ? 'The browser is blocking Muter on this tab. Grant access to load it.'
      : friendlyErr();
    $('grant').hidden = !needsGrant;
    return;
  }

  const { cfg, stats, logs } = st;

  document.body.classList.remove('unavailable');
  document.body.classList.toggle('paused', !cfg.enabled);
  $('settings').disabled = false;
  $('sw').disabled = false;
  $('ai-fill').disabled = false;
  $('grant').hidden = true;
  banner.style.display = 'none';

  setStatus(lastHost ? `${lastHost} · ${cfg.enabled ? 'active' : 'paused'}` : (cfg.enabled ? 'Active' : 'Paused'));
  setFlowCard(st.flow);

  $('c-copy').textContent = fmt(stats.copy);
  $('c-cut').textContent = fmt(stats.cut);
  $('c-paste').textContent = fmt(stats.paste);
  $('c-chars').textContent = fmt(stats.charsTyped);
  $('c-warn').textContent = fmt(stats.warnSeen);
  $('c-drop').textContent = fmt(stats.warnDropped);

  const seen = stats.warnSeen || 0;
  if (seen > 0) {
    const pct = (n) => `${((n || 0) / seen) * 100}%`;
    $('mix-sent').style.width = pct(stats.warnSent);
    $('mix-asked').style.width = pct(stats.warnAsked);
    $('mix-dropped').style.width = pct(stats.warnDropped);
    $('mix-text').textContent = `${stats.warnDropped} of ${seen} dropped`;
    $('mix').classList.add('on');
  } else {
    $('mix').classList.remove('on');
  }

  for (const [id, key] of Object.entries(TOGGLES)) {
    $(id).checked = !!cfg[key];
  }

  if (document.activeElement !== $('s-tab')) $('s-tab').value = cfg.tabHidden;
  if (document.activeElement !== $('s-other')) $('s-other').value = cfg.otherWarnings;
  if (!delayTimer && document.activeElement !== $('s-delay')) {
    $('s-delay').value = cfg.typeDelayMs;
    $('delay-out').textContent = `${cfg.typeDelayMs} ms`;
  }

  const sig = `${logs.length}|${logs[0]?.t ?? 0}`;
  if (sig !== logSig) { logSig = sig; renderLog(logs); }
}

async function tick() {
  if (busy) return;
  busy = true;
  try { render(await call(() => window.__muter?.getState() ?? null)); }
  finally { busy = false; }
}

/* ── AI controls ───────────────────────────────────────── */

async function loadAi() {
  try {
    ai = { ...AI_DEFAULTS, ...((await api.storage.local.get(AI_KEY))?.[AI_KEY] || {}) };
  } catch { ai = { ...AI_DEFAULTS }; }
  for (const [id, key] of Object.entries(AI_TOGGLES)) $(id).checked = !!ai[key];
  try {
    const reply = await api.runtime.sendMessage({ type: 'keyStatus' });
    hasKey = !!reply?.hasKey;
    $('ai-note').textContent = hasKey
      ? `Groq key saved${reply.model ? ` · ${reply.model}` : ''}`
      : 'No Groq key yet — stored in Firefox sync storage, never in page code.';
    $('ai-note').classList.toggle('warn', !hasKey);
    $('ai-key-btn').textContent = hasKey ? 'Change key' : 'Set key';
  } catch (e) {
    $('ai-note').textContent = 'Background script not running.';
    $('ai-note').classList.add('warn');
  }
}

async function saveAi(patch) {
  ai = { ...ai, ...patch };
  for (const key of Object.keys(patch)) {
    if (key === 'typeDelayMs') ai.typeDelayMs = Math.max(8, Math.min(240, Number(patch.typeDelayMs) || AI_DEFAULTS.typeDelayMs));
  }
  try { await api.storage.local.set({ [AI_KEY]: ai }); } catch { /* ignore */ }
}

async function command(cmd) {
  const t = await tab();
  if (!t) { lastErr = 'no active tab'; render(null); return; }
  try {
    await api.scripting.executeScript({
      target: { tabId: t.id }, world: 'MAIN', func: (c) => window.postMessage({ __muter: 1, cmd: c }, '*'), args: [cmd],
    });
    lastErr = '';
    setStatus('Opened on the page');
  } catch (e) {
    lastErr = 'Could not reach the page: ' + (e?.message || e);
    render(null);
  }
}

/* ── bindings ──────────────────────────────────────────── */

for (const [id, key] of Object.entries(TOGGLES)) {
  $(id).addEventListener('change', async (e) => {
    const value = e.target.checked;
    await call((k, v) => window.__muter.setConfig({ [k]: v }), [key, value]);
    tick();
  });
}

for (const [id, key] of Object.entries(AI_TOGGLES)) {
  $(id).addEventListener('change', async (e) => { await saveAi({ [key]: e.target.checked }); });
}

$('ai-key-btn').addEventListener('click', async () => {
  const row = $('ai-key-row');
  if (row.hidden) {
    row.hidden = false;
    $('ai-key').focus();
    return;
  }
  const key = $('ai-key').value.trim();
  if (!key) { row.hidden = true; return; }
  try {
    const reply = await api.runtime.sendMessage({ type: 'setKey', key });
    if (!reply?.ok) throw new Error(reply?.error || 'rejected');
    $('ai-key').value = '';
    row.hidden = true;
    await loadAi();
  } catch (e) {
    $('ai-note').textContent = 'Key not saved: ' + (e?.message || e);
    $('ai-note').classList.add('warn');
  }
});

$('ai-fill').addEventListener('click', () => command('fill'));

$('s-tab').addEventListener('change', async (e) => {
  await call((v) => window.__muter.setConfig({ tabHidden: v }), [e.target.value]);
  tick();
});

$('s-other').addEventListener('change', async (e) => {
  await call((v) => window.__muter.setConfig({ otherWarnings: v }), [e.target.value]);
  tick();
});

$('s-delay').addEventListener('input', (e) => {
  const value = Number(e.target.value);
  $('delay-out').textContent = `${value} ms`;
  clearTimeout(delayTimer);
  delayTimer = setTimeout(async () => {
    delayTimer = null;
    await call((v) => window.__muter.setConfig({ typeDelayMs: v }), [value]);
  }, 160);
});

function disarmReset() {
  resetArmed = false;
  clearTimeout(resetTimer);
  const btn = $('reset');
  btn.classList.remove('armed');
  btn.textContent = 'Reset counters';
}

$('reset').addEventListener('click', async () => {
  if (!resetArmed) {
    resetArmed = true;
    const btn = $('reset');
    btn.classList.add('armed');
    btn.textContent = 'Click again to confirm';
    resetTimer = setTimeout(disarmReset, 2600);
    return;
  }
  disarmReset();
  await call(() => window.__muter.reset());
  tick();
});

$('grant').addEventListener('click', async () => {
  try { await api.permissions.request(HOST); } catch (e) { lastErr = 'grant failed: ' + (e?.message || e); }
  needsGrant = false;
  tick();
});

$('diag-btn').addEventListener('click', () => {
  const pre = $('diag-out');
  pre.hidden = !pre.hidden;
  $('diag-btn').textContent = pre.hidden ? 'Diagnostics' : 'Hide diagnostics';
  if (!pre.hidden) tick();
});

try { $('ver').textContent = 'v' + api.runtime.getManifest().version; } catch { $('ver').textContent = ''; }

diag({
  api: globalThis.browser ? 'browser' : (globalThis.chrome ? 'chrome' : 'NONE'),
  pageApi: `browser=${typeof globalThis.browser}, chrome=${typeof globalThis.chrome}`,
  state: 'starting',
});
loadAi();
tick();
setInterval(tick, 900);
