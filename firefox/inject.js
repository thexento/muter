/* Muter — class.nims.com.np only */
(() => {
  if (window.__muter) return;

  const CFG_KEY = '__muter_cfg_v1';
  const STATS_KEY = '__muter_stats_v1';
  const LOG_KEY = '__muter_log_v1';

  const DEFAULTS = {
    enabled: true,
    typePaste: true,
    typeDelayMs: 28,
    jitter: 0.6,
    gateWarnings: true,
    tabHidden: 'drop',
    otherWarnings: 'ask',
    blockSync: false,
    fakeVisible: false,
    muteModal: true,
    muteBanner: true,
  };

  const ZERO = { copy: 0, cut: 0, paste: 0, charsTyped: 0, drop: 0,
                 warnSeen: 0, warnDropped: 0, warnSent: 0, warnAsked: 0 };

  const read = (k, fb) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : fb; } catch { return fb; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  let cfg = Object.assign({}, DEFAULTS, read(CFG_KEY, {}));
  let stats = Object.assign({}, ZERO, read(STATS_KEY, {}));
  let logs = read(LOG_KEY, []);

  const persistStats = () => write(STATS_KEY, stats);

  function addLog(msg) {
    logs.unshift({ t: Date.now(), msg });
    if (logs.length > 80) logs.length = 80;
    write(LOG_KEY, logs);
  }

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const fakeBody = JSON.stringify({ ok: true, status: 'ok', warnings: [], fields: [] });
  const fakeResponse = () => new Response(fakeBody, {
    status: 200, statusText: 'OK', headers: { 'Content-Type': 'application/json' },
  });

  const pathOf = (input) => {
    try {
      if (input instanceof Request) return new URL(input.url).pathname;
      return new URL(String(input), location.href).pathname;
    } catch { return ''; }
  };

  /* ═════ warning gate ═════ */
  const pending = [];
  let gateBox = null;
  const realFetch = window.fetch;
  const runtime = globalThis.browser ?? globalThis.chrome;

  function bridgeGenerate(question, timeoutMs = 12000) {
    return new Promise((resolve) => {
      const id = `muter-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const onMsg = (e) => {
        const m = e.data;
        if (!m || m.__muter !== 1 || m.cmd !== 'generated' || m.id !== id) return;
        window.removeEventListener('message', onMsg);
        console.log('[Muter] bridge: got reply from background (reply)', m.reply);
        resolve(m.reply || { ok: false, code: 'runtime', error: 'Background script unavailable.' });
      };
      window.addEventListener('message', onMsg);
      console.log('[Muter] bridge: generate request posted (question)', question.number, question.title);
      window.postMessage({ __muter: 1, cmd: 'generate', id, question }, '*');
      setTimeout(() => {
        window.removeEventListener('message', onMsg);
        console.warn('[Muter] bridge: generate timed out');
        resolve({ ok: false, code: 'timeout', error: 'Groq request timed out — background did not respond. Check the console for [Muter] logs.' });
      }, timeoutMs);
    });
  }

  function generateVia(question) {
    console.log('[Muter] generate via', runtime?.runtime?.sendMessage ? 'runtime' : 'bridge');
    if (runtime?.runtime?.sendMessage) return runtime.runtime.sendMessage({ type: 'generate', question });
    return bridgeGenerate(question);
  }

function gate(input, init) {
    let body = {};
    try { body = JSON.parse((init?.body) ?? '{}'); } catch {}
    const type = body.type ?? 'unknown';

    stats.warnSeen++;

    let policy = cfg.otherWarnings;
    if (type === 'tab_hidden') policy = cfg.tabHidden;
    if (!cfg.enabled) policy = 'send';

    if (policy === 'send') {
      stats.warnSent++;
      addLog('warning API: ' + type + ' → sent');
      persistStats();
      return realFetch(input, init);
    }
    if (policy === 'drop') {
      stats.warnDropped++;
      addLog('warning API: ' + type + ' → dropped');
      persistStats();
      return Promise.resolve(fakeResponse());
    }

    stats.warnAsked++;
    addLog('warning API: ' + type + ' → asking');
    persistStats();
    return new Promise((resolve) => {
      pending.push({ type, message: body.message ?? '', input, init, resolve });
      renderGate();
    });
  }

  function mkBtn(label, fg, bg, border, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = `flex:1;padding:7px 8px;border-radius:8px;border:1px solid ${border};background:${bg};color:${fg};font:600 11.5px system-ui,sans-serif;cursor:pointer;transition:filter .12s;`;
    b.addEventListener('mouseenter', () => { b.style.filter = 'brightness(1.18)'; });
    b.addEventListener('mouseleave', () => { b.style.filter = ''; });
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  }

  function renderGate() {
    if (!pending.length) { gateBox?.remove(); gateBox = null; return; }
    if (!gateBox) {
      gateBox = document.createElement('div');
      gateBox.id = 'muter-gate';
      gateBox.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:2147483647;display:flex;flex-direction:column;gap:10px;width:330px;max-height:calc(100vh - 24px);overflow-y:auto;padding:4px;font:12.5px/1.45 system-ui,sans-serif;';
      (document.body || document.documentElement).appendChild(gateBox);
    }
    gateBox.textContent = '';
    for (const p of pending) {
      const card = document.createElement('div');
      card.style.cssText = 'background:linear-gradient(165deg,#121c2e,#0b1322);color:#e9eef8;border:1px solid #293a55;border-radius:12px;padding:11px 12px 12px;box-shadow:0 14px 34px rgba(0,0,0,.55);';

      const top = document.createElement('div');
      top.style.cssText = 'display:flex;align-items:center;gap:7px;margin-bottom:5px;';
      const dot = document.createElement('span');
      dot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:#e05252;box-shadow:0 0 0 3px rgba(224,82,82,.15);flex:none;';
      const title = document.createElement('span');
      title.style.cssText = 'flex:1;min-width:0;font:700 10.5px system-ui;letter-spacing:.07em;text-transform:uppercase;color:#f0a0a0;';
      title.textContent = 'Report held';
      const badge = document.createElement('span');
      badge.style.cssText = 'flex:none;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:2px 6px;border-radius:5px;border:1px solid rgba(233,196,106,.28);background:rgba(233,196,106,.12);color:#f2d68a;font:600 10px ui-monospace,monospace;';
      badge.textContent = p.type;
      top.append(dot, title, badge);

      const msg = document.createElement('div');
      msg.style.cssText = 'margin-bottom:10px;color:#a6b6cc;font-size:12px;line-height:1.45;word-break:break-word;';
      msg.textContent = p.message || 'No message attached.';

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:7px;';
      row.append(
        mkBtn('Send', '#9ff0c9', 'rgba(62,207,142,.12)', 'rgba(62,207,142,.4)', () => settle(p, true)),
        mkBtn('Drop', '#ffe4e4', 'rgba(224,82,82,.85)', 'rgba(224,82,82,.85)', () => settle(p, false)),
      );

      const foot = document.createElement('div');
      foot.style.cssText = 'margin-top:8px;font:10px system-ui;color:#5f728c;';
      foot.textContent = 'Muter is holding this request';

      card.append(top, msg, row, foot);
      gateBox.appendChild(card);
    }
  }

  function settle(p, send) {
    const i = pending.indexOf(p);
    if (i < 0) return;
    pending.splice(i, 1);
    if (send) {
      stats.warnSent++;
      addLog(`warning API: ${p.type} → sent manually`);
      realFetch(p.input, p.init).then(r => p.resolve(r)).catch(() => p.resolve(fakeResponse()));
    } else {
      stats.warnDropped++;
      addLog(`warning API: ${p.type} → dropped manually`);
      p.resolve(fakeResponse());
    }
    persistStats();
    renderGate();
  }

  window.fetch = function (input, init) {
    if (!cfg.enabled) return realFetch.apply(this, arguments);
    const p = pathOf(input);
    if (cfg.gateWarnings && p.endsWith('/metrics/warning')) return gate(input, init);
    if (cfg.blockSync && p.endsWith('/metrics/sync')) return Promise.resolve(fakeResponse());
    return realFetch.apply(this, arguments);
  };

  /* ═════ editor insertion ═════ */
  let typing = null;

  let hud = null, hudCount = null, hudFill = null;

  function ensureHud() {
    hud = document.createElement('div');
    hud.id = 'muter-hud';
    hud.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;min-width:212px;background:linear-gradient(165deg,#121c2e,#0b1322);border:1px solid #293a55;border-radius:11px;padding:9px 11px 10px;color:#e9eef8;font:11.5px/1.4 system-ui,sans-serif;box-shadow:0 14px 34px rgba(0,0,0,.55);';

    const top = document.createElement('div');
    top.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:7px;';
    const label = document.createElement('span');
    label.textContent = typing?.label || 'Typing';
    label.style.cssText = 'font-weight:650;color:#c8d4e6;';
    hudCount = document.createElement('span');
    hudCount.style.cssText = 'font:600 10px ui-monospace,monospace;color:#f2d68a;font-variant-numeric:tabular-nums;';
    top.append(label, hudCount);

    const bar = document.createElement('div');
    bar.style.cssText = 'height:4px;border-radius:99px;background:#1b273c;overflow:hidden;';
    hudFill = document.createElement('div');
    hudFill.style.cssText = 'height:100%;width:0;border-radius:99px;background:linear-gradient(90deg,#d9ad4b,#f4d98f);transition:width .1s linear;';
    bar.appendChild(hudFill);

    const hint = document.createElement('div');
    hint.style.cssText = 'margin-top:6px;font-size:10px;color:#5f728c;display:flex;align-items:center;gap:5px;';
    const kbd = document.createElement('kbd');
    kbd.textContent = 'Esc';
    kbd.style.cssText = 'font:600 9px ui-monospace,monospace;padding:1px 4px;border-radius:4px;border:1px solid #2a3a54;background:#0f1828;color:#a6b6cc;';
    hint.append(kbd, document.createTextNode('to stop'));

    hud.append(top, bar, hint);
    (document.body || document.documentElement).appendChild(hud);
  }

  function renderHud() {
    if (!typing) {
      hud?.remove();
      hud = hudCount = hudFill = null;
      return;
    }
    if (!hud) ensureHud();
    hudCount.textContent = `${typing.done} / ${typing.total}`;
    hudFill.style.width = `${typing.total ? (typing.done / typing.total) * 100 : 0}%`;
  }

  function findCM(host) {
    const wrap = host?.matches?.('.CodeMirror') ? host : host?.querySelector?.('.CodeMirror');
    const cm = wrap?.CodeMirror;
    return cm && typeof cm.replaceSelection === 'function' ? cm : null;
  }

  const SKIP_TYPES = ['hidden', 'file', 'checkbox', 'radio', 'button', 'submit', 'range', 'color'];

  function targetOf(host) {
    const cm = findCM(host);
    if (cm) return { cm };
    const el = Array.from(host.querySelectorAll('textarea,input,[contenteditable]')).find(e =>
      !e.disabled && !e.readOnly &&
      !(e.tagName === 'INPUT' && SKIP_TYPES.includes((e.type || '').toLowerCase()))
    );
    return el ? { el } : null;
  }

  function findCM5Editor(host) {
    const cm = host?.cm && typeof host.cm.replaceSelection === 'function' ? host.cm : null;
    if (cm) return cm;
    const holder = host?.matches?.('.cm-editor') ? host : host?.querySelector?.('.cm-editor');
    const view = holder?.cmView?.view || holder?.CodeMirror?.cmView?.view;
    return view && typeof view.dispatch === 'function' ? view : null;
  }

  function insertChar(t, ch) {
    if (t.cm) { t.cm.replaceSelection(ch, 'end'); return; }
    if (t.cm6) {
      t.cm6.focus();
      t.cm6.dispatch({
        changes: { from: t.cm6.state.selection.main.from, to: t.cm6.state.selection.main.to, insert: ch },
        selection: { anchor: t.cm6.state.selection.main.from + ch.length },
        userEvent: 'input.type',
      });
      return;
    }
    const el = t.el;
    if (!el) return;
    el.focus();
    const doc = el.ownerDocument || document;

    // Rich editors (TinyMCE / contenteditable) need a real paragraph break,
    // not a literal "\n" character.
    if (ch === '\n' && (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true')) {
      try {
        if (doc.execCommand('insertParagraph', false, null)) return;
        if (doc.execCommand('insertLineBreak', false, null)) return;
      } catch { /* fall through */ }
    }

    try { if (doc.execCommand('insertText', false, ch)) return; } catch { /* fall through */ }

    const s = el.selectionStart ?? el.value?.length ?? 0;
    const e = el.selectionEnd ?? s;
    if ('value' in el) {
      el.value = el.value.slice(0, s) + ch + el.value.slice(e);
      el.selectionStart = el.selectionEnd = s + ch.length;
    }
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
  }

  async function typeInto(target, text, opts = {}) {
    const job = {
      done: 0,
      total: text.length,
      cancel: false,
      label: opts.label || 'Typing',
      baseMs: Number(opts.baseMs) || cfg.typeDelayMs,
      jitter: opts.jitter ?? cfg.jitter,
    };
    if (typing) typing.cancel = true;
    typing = job;
    renderHud();
    opts.onStart?.(job);

    const base = text.length > 1200
      ? Math.min(job.baseMs, 6)
      : text.length > 400
        ? Math.min(job.baseMs, 12)
        : job.baseMs;

    for (let i = 0; i < text.length; i++) {
      if (job.cancel) break;
      const ch = text[i];
      insertChar(target, ch);
      stats.charsTyped++;
      job.done = i + 1;
      renderHud();
      let d = base + (ch === '\n' ? 40 : 0);
      d += (Math.random() - 0.5) * base * job.jitter;
      await sleep(Math.max(4, d));
    }
    persistStats();
    if (typing === job) { typing = null; renderHud(); }
    addLog(`${job.label.toLowerCase()} ${job.done}/${job.total} chars${job.cancel ? ' (stopped)' : ''}`);
    opts.onDone?.(job);
    return job;
  }

  /** Type a multi-line answer into a description editor, replacing its content. */
  async function typeIntoHost(host, text, opts) {
    const t = targetOf(host);
    if (!t) return null;
    return typeInto(t, text, opts);
  }

  /* ═════ lab flow (extract → Groq → review → fill) ═════ */

  const SETTINGS_KEY = 'muter.settings.v1';
  const settingsStore = MuterFormat.store;
  const pendingAnswers = new Map();
  let flow = null;
  let flash = null;
  let lastQuestion = null;

  const ANSWER_KEYS = ['title', 'theory', 'algorithm', 'source_code', 'output', 'result_conclusion'];
  const fieldKey = (url, q) => MuterFormat.entryKey(url, q);
  const answerUrl = () => location.origin + location.pathname;

  async function answerFor(url, number) {
    const key = fieldKey(url, number);
    if (pendingAnswers.has(key)) return pendingAnswers.get(key);
    return MuterFormat.store.get(key);
  }

  async function saveAnswer(url, number, question, answers) {
    const entry = MuterFormat.entryFromAnswers(question, answers);
    await MuterFormat.store.set(fieldKey(url, number), entry);
  }

  function editorFor(block) {
    const type = MuterExtractor.probeBlock(block);
    if (type === 'tinymce') {
      // The TinyMCE host must be the iframe itself — a .answer-block div has
      // no contentDocument, which silently skipped Algorithm/Theory fields.
      const frame = block.matches?.('iframe.tox-edit-area__iframe')
        ? block
        : block.querySelector('iframe.tox-edit-area__iframe, .tox-tinymce iframe, iframe');
      if (frame?.contentDocument?.body) return { editor: 'tinymce', host: frame };
      return { editor: 'unknown', host: block };
    }
    if (type === 'codemirror') {
      const host = block.matches?.('.cm-editor, .CodeMirror')
        ? block
        : (block.querySelector('.cm-editor, .CodeMirror') || block);
      if (findCM(host)) return { editor: 'codemirror', host };
      const cm = findCM5Editor(host);
      if (cm) return { editor: 'codemirror', host, cm5: cm };
      const content = host.matches?.('.cm-content') ? host : host.querySelector('.cm-content');
      if (content) return { editor: 'codemirror', host, content };
      const ta = block.querySelector('textarea');
      return ta && !ta.readOnly ? { editor: 'input', host: ta } : { editor: 'unknown', host: block };
    }
    if (type === 'input.fb-input' || type === 'textarea.fb-textarea' || type === 'textarea') {
      const ta = block.matches?.('input, textarea, [contenteditable]')
        ? block
        : block.querySelector('input.fb-input, textarea.fb-textarea, textarea, input, [contenteditable]');
      return ta ? { editor: 'input', host: ta } : { editor: 'unknown', host: block };
    }
    if (type === 'contenteditable') {
      return { editor: 'input', host: block };
    }
    return { editor: 'unknown', host: block };
  }

  function waitForEditor(host, attempts = 40) {
    return new Promise((resolve) => {
      let n = 0;
      const tick = () => {
        if (host.isConnected) return resolve(true);
        if (n++ >= attempts) return resolve(false);
        setTimeout(tick, 100);
      };
      tick();
    });
  }

  function humanDelay(overrideMs = 0) {
    const base = overrideMs > 0 ? overrideMs : 55 + Math.random() * 35;
    return { baseMs: base, jitter: 1.1 };
  }

  async function fillAnswers(answers, question, onStage) {
    const currentUrl = answerUrl();
    const blocks = Array.from(document.querySelectorAll('.answer-block'));
    const filled = [];
    const skipped = [];
    const used = new Set();

    for (const key of ANSWER_KEYS) {
      const text = String(answers[key] || '');
      if (!text.trim() || key === 'output') continue;

      let field = question.fields.find((f) => f.role === key && f.fillable);
      let block = field ? MuterExtractor.findBlock(field) : null;
      if (!block || used.has(block)) {
        const live = MuterExtractor.liveBlockForRole(key, used);
        if (live) block = live;
      }
      if (!block) {
        // The rich editor may still be booting (TinyMCE is lazy); give the
        // page a moment before declaring the field missing.
        for (let i = 0; i < 20 && !block; i += 1) {
          await sleep(150);
          block = MuterExtractor.liveBlockForRole(key, used);
        }
      }
      if (!block) {
        skipped.push(key);
        console.warn(`[Muter] fill: no field for "${key}" — extracted roles:`,
          question.fields.map((f) => `${f.role}(${f.label})`));
        continue;
      }
      used.add(block);

      await waitForEditor(block);
      let resolved = editorFor(block);
      for (let i = 0; i < 30 && resolved.editor === 'unknown'; i += 1) {
        await sleep(100);
        resolved = editorFor(block);
      }
      const { editor, host, cm5, content } = resolved;
      if (editor === 'unknown') {
        skipped.push(key);
        console.warn(`[Muter] fill: "${key}" field type is unsupported`, block.className || block.tagName);
        continue;
      }

      onStage?.(key);
      const timing = humanDelay(Number(flow?.settings?.typeDelayMs) || 0);
      console.log(`[Muter] fill: typing "${key}" → ${editor}`);

      if (editor === 'input') {
        const el = host;
        el.focus();
        if ('value' in el) el.value = '';
        else el.textContent = '';
        await typeInto({ el }, text, timing);
        try {
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.blur?.();
        } catch { /* ignore */ }
      } else if (editor === 'tinymce') {
        const doc = host.contentDocument;
        const win = host.contentWindow;
        if (!doc?.body) {
          skipped.push(key);
          console.warn(`[Muter] fill: "${key}" TinyMCE iframe not ready`);
          continue;
        }
        doc.body.focus();
        try {
          const range = doc.createRange();
          range.selectNodeContents(doc.body);
          const sel = doc.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          doc.execCommand('delete', false, null);
        } catch { /* ignore */ }
        doc.body.textContent = '';
        await typeInto({ el: doc.body }, text, timing);
        try {
          doc.body.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: null }));
          doc.body.dispatchEvent(new Event('change', { bubbles: true }));
          win?.dispatchEvent(new Event('blur'));
          win?.tinymce?.triggerSave?.();
          window.tinymce?.triggerSave?.();
        } catch { /* ignore */ }
      } else {
        const cmContent = content || (block.matches?.('.cm-content') ? block : block.querySelector('.cm-content'));
        await typeInto(cm5 ? { cm6: cm5 } : { el: cmContent || host }, text, timing);
      }

      filled.push(key);
      await sleep(180);
    }

    const entry = MuterFormat.entryFromAnswers(question, answers);
    await saveAnswer(currentUrl, question.number, question, answers);
    console.log('[Muter] fill: finished', { filled, skipped });
    return { filled, skipped, blocks: blocks.length, formatted: MuterFormat.formatQuestionBlock(entry) };
  }

  /* ═════ overlay UI ═════ */

  let flowRoot = null;

  const ROLE_LABEL = {
    title: 'Title / Aim',
    theory: 'Theory',
    algorithm: 'Algorithm',
    source_code: 'Source code',
    output: 'Output',
    result_conclusion: 'Result / Conclusion',
  };

  const UI = {
    ink: '#111111',
    sub: '#5f5f5f',
    muted: '#8e8e8e',
    line: '#ececec',
    soft: '#fafafa',
    ok: '#0a8a5f',
    bad: '#b42318',
  };

  function uiRoot() {
    if (flowRoot?.isConnected) return flowRoot;
    if (!document.body) return null;
    const root = document.createElement('div');
    root.id = 'muter-flow';
    root.style.cssText = 'box-sizing:border-box;position:fixed;right:16px;top:16px;width:370px;max-width:calc(100vw - 32px);max-height:calc(100vh - 32px);z-index:2147483647;display:flex;flex-direction:column;overflow:hidden;border-radius:14px;border:1px solid #e6e6e6;background:#ffffff;color:#111111;box-shadow:0 18px 50px rgba(0,0,0,.16),0 2px 8px rgba(0,0,0,.06);font:12.5px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;';
    document.body.appendChild(root);
    flowRoot = root;
    return root;
  }

  function setFlowState(state) {
    if (flow) flow.state = state;
    const badge = flowRoot?.querySelector('[data-role="badge"]');
    if (badge) badge.textContent = state;
  }

  function el(tag, css) {
    const node = document.createElement(tag);
    node.style.cssText = css;
    return node;
  }

  function chip(text) {
    const c = el('span', 'padding:3px 8px;border-radius:999px;border:1px solid #ececec;background:#fafafa;color:#5f5f5f;font:600 9.5px system-ui;');
    c.textContent = text;
    return c;
  }

  function paragraph(text, size = '12px') {
    const p = el('div', `color:${UI.sub};font-size:${size};line-height:1.5;`);
    p.textContent = text;
    return p;
  }

  function hint(text) {
    const p = el('div', `margin-top:7px;color:${UI.muted};font-size:10.5px;line-height:1.45;`);
    p.textContent = text;
    return p;
  }

  function button(label, onClick, opts = {}) {
    const primary = !!opts.primary;
    const b = el('button', primary
      ? 'flex:1;padding:9px 12px;border-radius:9px;border:1px solid #111111;background:#111111;color:#ffffff;font:600 12px system-ui;cursor:pointer;'
      : 'flex:1;padding:9px 12px;border-radius:9px;border:1px solid #e2e2e2;background:#ffffff;color:#333333;font:600 12px system-ui;cursor:pointer;');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
    return b;
  }

  function linkButton(label, onClick) {
    const b = el('button', 'flex:none;padding:6px 2px;border:0;background:transparent;color:#8e8e8e;font:600 11px system-ui;cursor:pointer;text-decoration:underline;text-underline-offset:2px;');
    b.type = 'button';
    b.textContent = label;
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
    return b;
  }

  function shorten(text, n) {
    return text.length > n ? `${text.slice(0, n - 1)}…` : text;
  }

  function fillableFields(state) {
    return state.question ? state.question.fields.filter((f) => f.fillable) : [];
  }

  function statusLine(state) {
    if (state.error) return 'Needs attention';
    if (state.state === 'extracting') return 'Reading the question…';
    if (state.state === 'generating') return 'Asking Groq…';
    if (state.state === 'review') return state.saved ? 'Saved · review' : 'Review answers';
    if (state.state === 'typing') return 'Typing…';
    if (state.state === 'done') return 'Done';
    return 'Ready';
  }

  function renderFlow() {
    const state = flow;
    const root = uiRoot();
    if (!state || !root) return;
    root.textContent = '';

    /* header */
    const head = el('div', `display:flex;align-items:center;gap:10px;padding:13px 15px;border-bottom:1px solid ${UI.line};`);
    const mark = el('div', 'flex:none;width:27px;height:27px;border-radius:8px;background:#111111;color:#ffffff;display:flex;align-items:center;justify-content:center;font:700 13px system-ui;');
    mark.textContent = 'M';
    const titles = el('div', 'flex:1;min-width:0;');
    const h = el('div', 'font:600 13.5px system-ui;color:#111111;line-height:1.2;');
    h.textContent = 'Muter';
    const sub = el('div', `margin-top:2px;font:11px system-ui;color:${UI.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;`);
    sub.textContent = state.question
      ? `Q${state.question.number} of ${state.question.total} · ${shorten(state.question.title || '', 42)}`
      : 'AI lab assistant';
    titles.append(h, sub);
    const badge = el('span', `flex:none;padding:3px 8px;border-radius:999px;border:1px solid ${UI.line};background:${UI.soft};color:${UI.sub};font:600 9.5px system-ui;`);
    badge.dataset.role = 'badge';
    badge.textContent = statusLine(state);
    const close = el('button', `flex:none;width:24px;height:24px;border:0;border-radius:7px;background:transparent;color:${UI.muted};font:400 17px system-ui;cursor:pointer;line-height:1;`);
    close.type = 'button';
    close.textContent = '×';
    close.title = 'Hide';
    close.addEventListener('click', () => { flowRoot?.remove(); flowRoot = null; flow = null; });
    head.append(mark, titles, badge, close);

    const body = el('div', 'padding:14px 15px 15px;overflow-y:auto;');
    root.append(head, body);

    /* question card */
    if (state.question) {
      const card = el('div', `padding:10px 12px;border:1px solid ${UI.line};border-radius:10px;background:${UI.soft};margin-bottom:12px;`);
      const lbl = el('div', `font:600 9px system-ui;letter-spacing:.09em;text-transform:uppercase;color:${UI.muted};`);
      lbl.textContent = 'Current question';
      const q = el('div', 'margin-top:4px;font:600 12px/1.45 system-ui;color:#111111;');
      q.textContent = state.question.title || '(untitled)';
      card.append(lbl, q);
      body.appendChild(card);
    }

    if (state.state === 'idle' || state.state === 'extracting') {
      if (state.state === 'extracting') {
        body.append(paragraph('Reading the question and its answer fields…'));
        body.appendChild(progressBar(0.2));
      } else {
        body.append(paragraph('Get the answers for this question, review them, then type them into the page.'));
        const row = el('div', 'display:flex;gap:8px;margin-top:12px;');
        row.append(button('Autofill this question', () => startFlow(), { primary: true }));
        body.appendChild(row);
      }
    }

    if (state.state === 'generating') {
      body.append(paragraph('Asking Groq for the answers…'));
      body.appendChild(progressBar(0.55));
      body.appendChild(hint('This usually takes a few seconds.'));
    }

    if (state.state === 'review' && state.answers) {
      const headRow = el('div', 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;');
      const reviewTitle = el('div', 'font:600 12.5px system-ui;color:#111111;');
      reviewTitle.textContent = 'Review answers';
      headRow.append(reviewTitle, chip(`${fillableFields(state).length} fields`));
      body.appendChild(headRow);
      body.appendChild(hint('Edit anything you like, then type it into the page.'));

      for (const field of fillableFields(state)) {
        const wrap = el('div', 'display:block;margin:10px 0 0;');
        const labelRow = el('div', 'display:flex;justify-content:space-between;gap:8px;margin-bottom:4px;');
        const name = el('span', `font:600 11px system-ui;color:#333333;`);
        name.textContent = ROLE_LABEL[field.role] || field.label || field.role;
        const role = el('span', `color:${UI.muted};font:500 9.5px ui-monospace,monospace;`);
        role.textContent = field.role;
        labelRow.append(name, role);
        const isCode = field.role === 'source_code';
        const minH = isCode ? 110 : field.role === 'algorithm' ? 78 : 54;
        const ta = el('textarea', `width:100%;box-sizing:border-box;min-height:${minH}px;resize:vertical;padding:8px 9px;border-radius:9px;border:1px solid #e2e2e2;background:#ffffff;color:#222222;font:11.5px/1.5 ${isCode ? 'ui-monospace,SFMono-Regular,Menlo,monospace' : 'system-ui'};outline:none;`);
        ta.value = state.answers[field.role] || '';
        ta.spellcheck = false;
        ta.addEventListener('input', () => { state.answers[field.role] = ta.value; });
        wrap.append(labelRow, ta);
        body.appendChild(wrap);
      }
      if (!fillableFields(state).length) {
        body.append(paragraph('No fillable answer fields were found for this question.'));
      }

      const row = el('div', 'display:flex;gap:8px;margin-top:14px;');
      row.append(
        button('Type all answers', () => typeFlow(), { primary: true }),
        button('Save', () => saveReviewAnswers()),
      );
      body.appendChild(row);
      const row2 = el('div', 'display:flex;align-items:center;gap:10px;margin-top:9px;');
      row2.append(
        button('Try again', () => startFlow(true)),
        linkButton('Close', () => cancelFlow()),
      );
      body.appendChild(row2);
    }

    if (state.state === 'typing') {
      body.append(paragraph(state.stage ? `Typing ${ROLE_LABEL[state.stage] || state.stage}…` : 'Filling the answer fields…'));
      body.appendChild(progressBar(0.75));
      body.appendChild(hint('Press Esc to stop typing.'));
    }

    if (state.state === 'done' && state.result) {
      const r = state.result;
      const ok = el('div', 'display:flex;align-items:center;gap:9px;margin-bottom:8px;');
      const check = el('div', `flex:none;width:26px;height:26px;border-radius:999px;background:${UI.ok};color:#ffffff;display:flex;align-items:center;justify-content:center;font:700 14px system-ui;`);
      check.textContent = '✓';
      const doneTitle = el('div', 'font:600 12.5px system-ui;color:#111111;');
      doneTitle.textContent = `Typed ${r.filled.length} field${r.filled.length === 1 ? '' : 's'}`;
      ok.append(check, doneTitle);
      body.appendChild(ok);
      body.append(paragraph(r.skipped.length
        ? `Skipped: ${r.skipped.join(', ')}. You can type those yourself.`
        : 'Everything the page asked for is filled in.'));
      if (r.skipped.length) body.appendChild(hint('If a field was missed, use “Try again” on the page or type it manually.'));

      const row = el('div', 'display:flex;gap:8px;margin-top:12px;');
      row.append(button('Next question', () => startQuestionNext(), { primary: true }), button('Copy block', () => {
        navigator.clipboard?.writeText(r.formatted || '').then(
          () => showToast('Copied the answers'),
          () => showToast('Clipboard unavailable'),
        );
      }));
      body.appendChild(row);
      const row2 = el('div', 'display:flex;align-items:center;gap:10px;margin-top:9px;');
      row2.append(button('Choose question', () => { state.showPicker = !state.showPicker; renderFlow(); }));
      if (r.skipped.length) row2.append(button('Try filling again', () => typeFlow()));
      row2.append(linkButton('Close', () => cancelFlow()));
      body.appendChild(row2);
      if (state.showPicker) body.appendChild(renderQuestionPicker(state));
    }

    if (state.error) {
      const err = el('div', `margin-top:10px;padding:9px 11px;border-radius:9px;border:1px solid rgba(180,35,24,.18);background:rgba(180,35,24,.05);color:${UI.bad};font-size:11.5px;line-height:1.5;`);
      err.textContent = state.error;
      body.appendChild(err);
    }
  }

  function progressBar(pct) {
    const bar = el('div', 'height:5px;border-radius:999px;background:#f0f0f0;overflow:hidden;margin-top:11px;');
    bar.appendChild(el('div', `height:100%;width:${Math.round(pct * 100)}%;border-radius:999px;background:#111111;transition:width .3s ease;`));
    return bar;
  }

  /* ═════ flow driver ═════ */

  function showToast(text) {
    if (!document.body) return;
    flash?.remove();
    flash = el('div', 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483647;padding:9px 14px;border-radius:10px;border:1px solid #e6e6e6;background:#ffffff;color:#111111;font:600 11.5px system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.16);');
    flash.textContent = text;
    document.body.appendChild(flash);
    setTimeout(() => { flash?.remove(); flash = null; }, 2600);
  }

  function answersOf(entry) {
    return {
      title: entry.title || '',
      theory: entry.theory || '',
      algorithm: entry.algorithm || '',
      source_code: entry.source_code || '',
      output: entry.output || '',
      result_conclusion: entry.result_conclusion || '',
    };
  }

  async function runAutoQueue() {
    const settings = (await settingsStore.get(SETTINGS_KEY).catch(() => null)) || {};
    if (!settings.autoQueue || flow?.autoRunning) return;
    flow = flow || {};
    const state = flow;
    state.autoRunning = true;
    const visited = new Set();
    try {
      for (let guard = 0; guard < 40 && settings.autoQueue; guard++) {
        const question = pickQuestion(MuterExtractor.extractQuestions());
        if (!question?.title || visited.has(question.number)) break;
        visited.add(question.number);
        let saved = await answerFor(answerUrl(), question.number);
        if (!saved && settings.autoQueueGenerate) {
          showToast(`Muter auto: generating Q${question.number}…`);
          const reply = await generateVia(question).catch(() => null);
          if (!reply?.ok) {
            showToast(`Muter auto stopped: ${reply?.code === 'config' ? 'set a Groq API key' : 'generation failed'}`);
            break;
          }
          await saveAnswer(answerUrl(), question.number, question, reply.answers);
          saved = reply.answers;
        }
        if (!saved) {
          showToast(`Muter auto stopped at Q${question.number}: no saved answer.`);
          break;
        }
        showToast(`Muter auto: Q${question.number}`);
        try {
          await fillAnswers(answersOf(saved), question);
        } catch (e) {
          showToast(`Muter auto stopped: ${e.message}`);
          break;
        }
        if (question.number >= question.total) break;
        const next = question.index + 1;
        location.hash = `q${next}`;
        await sleep(900);
      }
    } finally {
      state.autoRunning = false;
    }
  }

  /* ═════ wiring ═════ */

  window.addEventListener('message', (e) => {
    if (e.source !== window) return;
    const data = e.data;
    if (!data || data.__muter !== 1) return;
    if (data.cmd === 'fill') startFlow();
    else if (data.cmd === 'autofill') autoFill();
  });

  window.addEventListener('hashchange', () => { runAutoQueue(); });
  setTimeout(() => { runAutoQueue(); }, 1500);

  async function generateInto(state) {
    state.answers = null;
    state.state = 'generating';
    renderFlow();
    console.log('[Muter] generateInto: calling groq api (question)', state.question.number, state.question.title);
    const reply = await Promise.race([
      generateVia(state.question).catch((e) => ({
        ok: false, code: 'runtime', error: e.message || 'Background script unavailable.',
      })),
      new Promise((resolve) => setTimeout(() => resolve({
        ok: false, code: 'timeout', error: 'Groq did not respond in time — check the page console for [Muter] logs.',
      }), 15000)),
    ]);
    console.log('[Muter] response got from groq (reply)', reply);
    if (!reply?.ok) {
      state.state = 'review';
      state.error = reply?.error || 'Generation failed.';
      if (reply?.code === 'config') state.error = 'No Groq API key yet — open Muter → AI settings.';
      showToast('Muter: ' + state.error);
      console.warn('[Muter] generation failed (reply)', reply);
      renderFlow();
      return;
    }
    state.answers = reply.answers;
    state.state = 'review';
    state.error = '';
    renderFlow();
  }

  async function startFlow(force = false) {
    const root = uiRoot();
    if (!root) return;
    if (!flow) flow = {};
    const state = flow;
    state.state = 'extracting';
    state.error = '';
    state.saved = false;
    state.result = null;
    state.stage = '';
    renderFlow();

    let questions;
    try {
      questions = MuterExtractor.extractQuestions();
    } catch (e) {
      state.state = 'idle';
      state.error = `Extraction failed: ${e.message}`;
      renderFlow();
      return;
    }
    const settings = await settingsStore.get(SETTINGS_KEY).catch(() => null);
    state.settings = settings || {};
    state.question = pickQuestion(questions) || null;
    if (state.question) lastQuestion = state.question;
    state.cfgLabel = state.question ? `${state.question.number}/${state.question.total}` : '';
    if (!state.question || !state.question.title) {
      state.state = 'idle';
      state.error = 'No question found on this page. Open a lab question first.';
      renderFlow();
      return;
    }
    console.log('[Muter] question fetched — Q' + state.question.number, state.question.title);
    console.log('[Muter] fields detected', state.question.fields.map((f) => `${f.role}(${f.fieldType}${f.fillable ? '' : ', not fillable'})`));
    const saved = !force && await answerFor(answerUrl(), state.question.number);
    if (saved) {
      state.answers = {
        title: saved.title, theory: saved.theory, algorithm: saved.algorithm,
        source_code: saved.source_code, output: saved.output, result_conclusion: saved.result_conclusion,
      };
      state.state = 'review';
      state.saved = true;
      renderFlow();
      showToast('Muter: loaded saved answers');
      return;
    }
    renderFlow();
    await generateInto(state);
  }

  function pickQuestion(questions) {
    const hash = (location.hash || '').match(/#q(\d+)/);
    if (hash && questions[Number(hash[1])]) return questions[Number(hash[1])];
    const visibleIndex = questions.findIndex((q) => {
      const body = document.querySelectorAll('.question-body')[q.index];
      return body && MuterExtractor.visible(body);
    });
    return questions[visibleIndex >= 0 ? visibleIndex : 0] || questions[0];
  }

  async function typeFlow() {
    const state = flow;
    if (!state?.question || !state.answers) return;
    state.state = 'typing';
    state.error = '';
    renderFlow();
    setFlowState('typing');
    try {
      const result = await fillAnswers(state.answers, state.question, (stage) => {
        state.stage = stage;
        const p = flowRoot?.querySelector('[data-role="badge"]');
        if (p) p.textContent = `typing ${stage}`;
      });
      state.result = result;
      state.state = 'done';
      state.stage = '';
    } catch (e) {
      state.state = 'review';
      state.error = `Typing failed: ${e.message}`;
    }
    renderFlow();
  }

  async function saveReviewAnswers() {
    const state = flow;
    if (!state?.question || !state.answers) return;
    await saveAnswer(answerUrl(), state.question.number, state.question, state.answers);
    state.saved = true;
    addLog(`saved answers for Q${state.question.number}`);
    renderFlow();
  }

  function cancelFlow() {
    flowRoot?.remove();
    flowRoot = null;
    flow = null;
    addLog('flow cancelled');
  }

  function startQuestionNext() {
    const state = flow;
    if (!state?.question) return;
    const total = state.question.total || 1;
    const next = state.question.number + 1;
    if (next > total) {
      showToast('Muter: last question.');
      return;
    }
    location.hash = `q${next - 1}`;
    setTimeout(() => startFlow(), 600);
  }

  function renderQuestionPicker(state) {
    const total = state.question?.total || 10;
    const wrap = el('div', 'display:flex;gap:6px;flex-wrap:wrap;margin-top:10px;');
    for (let n = 1; n <= total; n++) {
      const b = el('button', `flex:none;min-width:34px;padding:6px 8px;border-radius:8px;border:1px solid #e2e2e2;background:#ffffff;color:#333333;font:600 11px system-ui;cursor:pointer;${n === state.question?.number ? 'border-color:#111111;background:#111111;color:#ffffff;' : ''}`);
      b.type = 'button';
      b.textContent = `Q${n}`;
      b.addEventListener('click', () => {
        flowRoot?.remove();
        flowRoot = null;
        flow = null;
        location.hash = `q${n - 1}`;
        setTimeout(() => startFlow(), 600);
      });
      wrap.appendChild(b);
    }
    return wrap;
  }

  async function autoFill() {
    const questions = MuterExtractor.extractQuestions();
    const question = pickQuestion(questions);
    if (!question?.title) return;
    const saved = await answerFor(answerUrl(), question.number);
    if (!saved) {
      showToast(`Muter: no saved answer for Q${question.number} — open the Muter panel.`);
      return;
    }
    const answers = {
      title: saved.title, theory: saved.theory, algorithm: saved.algorithm,
      source_code: saved.source_code, output: saved.output, result_conclusion: saved.result_conclusion,
    };
    showToast(`Muter: auto-filling Q${question.number}…`);
    await fillAnswers(answers, question);
    showToast(`Muter: Q${question.number} filled.`);
  }

  /* ═════ interception ═════ */
  const hostOf = (e) => e.target?.closest?.('[data-field]') || null;

  window.addEventListener('paste', (e) => {
    if (!cfg.enabled) return;
    const host = hostOf(e);
    if (!host) return;
    e.stopPropagation();
    const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    stats.paste++;
    persistStats();
    if (!cfg.typePaste) { addLog(`paste ${text.length} chars → passthrough`); return; }
    e.preventDefault();
    addLog(`paste ${text.length} chars → typing`);
    if (text) typeIntoHost(host, text);
  }, true);

  window.addEventListener('copy', (e) => {
    if (!cfg.enabled || !hostOf(e)) return;
    e.stopPropagation();
    stats.copy++; persistStats(); addLog('copy blocked');
  }, true);

  window.addEventListener('cut', (e) => {
    if (!cfg.enabled || !hostOf(e)) return;
    e.stopPropagation();
    stats.cut++; persistStats(); addLog('cut blocked');
  }, true);

  window.addEventListener('drop', (e) => {
    if (!cfg.enabled) return;
    const host = hostOf(e);
    const text = e.dataTransfer?.getData('text');
    if (!host || !text) return;
    e.preventDefault();
    e.stopPropagation();
    stats.drop++; persistStats();
    addLog(`drop ${text.length} chars → typing`);
    typeIntoHost(host, text);
  }, true);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && typing) typing.cancel = true;
  }, true);

  /* ═════ side effects ═════ */
  let cssEl = null, bannerOrig = null, bannerOn = false, hiddenOn = false, bannerPoll = null;

  function applySideEffects() {
    const on = cfg.enabled;

    if (on && cfg.muteModal) {
      if (!cssEl) {
        cssEl = document.createElement('style');
        cssEl.textContent = '#metrics-warning-modal{display:none!important}';
        (document.head || document.documentElement).appendChild(cssEl);
      }
    } else if (cssEl) { cssEl.remove(); cssEl = null; }

    if (on && cfg.muteBanner) {
      if (!bannerPoll) {
        bannerPoll = setInterval(() => {
          if (typeof window.LabMetrics?.getState !== 'function') return;
          clearInterval(bannerPoll);
          bannerPoll = null;
          if (!bannerOn) {
            bannerOrig = window.LabMetrics.getState;
            window.LabMetrics.getState = () => Object.assign({}, bannerOrig(), { warnings: [] });
            bannerOn = true;
          }
        }, 50);
      }
    } else if (bannerOn && bannerOrig) {
      if (bannerPoll) { clearInterval(bannerPoll); bannerPoll = null; }
      window.LabMetrics.getState = bannerOrig;
      bannerOrig = null;
      bannerOn = false;
    } else if (bannerPoll) {
      clearInterval(bannerPoll);
      bannerPoll = null;
    }

    if (on && cfg.fakeVisible) {
      if (!hiddenOn) {
        try {
          Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
          Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
          hiddenOn = true;
        } catch {}
      }
    } else if (hiddenOn) {
      try { delete document.hidden; delete document.visibilityState; } catch {}
      hiddenOn = false;
    }
  }

  /* ═════ public API for the popup ═════ */
  window.__muter = {
    getState: () => ({
      cfg,
      stats,
      logs,
      flow: flow ? {
        state: flow.state || 'idle',
        number: flow.question?.number ?? null,
        total: flow.question?.total ?? null,
        title: flow.question?.title || '',
        error: flow.error || '',
        fields: flow.question?.fillable?.length || 0,
        filled: flow.result?.filled?.length || 0,
        skipped: flow.result?.skipped || [],
      } : (lastQuestion ? {
        state: 'idle',
        number: lastQuestion.number,
        total: lastQuestion.total,
        title: lastQuestion.title || '',
        error: '',
        fields: lastQuestion.fillable?.length || 0,
        filled: 0,
        skipped: [],
      } : null),
    }),
    setConfig(patch) {
      Object.assign(cfg, patch);
      write(CFG_KEY, cfg);
      applySideEffects();
      addLog('config updated');
    },
    reset() {
      stats = Object.assign({}, ZERO);
      logs = [];
      persistStats();
      write(LOG_KEY, logs);
    },
    startFlow,
    autoFill,
    isFlowOpen: () => Boolean(flowRoot?.isConnected),
  };

  applySideEffects();
  addLog('muter armed');
})();