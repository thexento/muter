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

  function gate(input, init) {
    let body = {};
    try { body = JSON.parse((init && init.body) || '{}'); } catch {}
    const type = body.type || 'unknown';

    stats.warnSeen++;
    const policy = !cfg.enabled ? 'send' : (type === 'tab_hidden' ? cfg.tabHidden : cfg.otherW<｜begin▁of▁sentence｜>World);

    if (policy === 'send') { stats.warnSent++; addLog(`warning API: ${type} → sent`); persistStats(); return realFetch(input, init); }
    if (policy === 'drop') { stats.warnDropped++; addLog(`warning API: ${type} → dropped`); persistStats(); return Promise.resolve(fakeResponse()); }

    stats.warnAsked++;
    addLog(`warning API: ${type} → asking`);
    persistStats();
    return new Promise((resolve) => {
      pending.push({ type, message: body.message || '', input, init, resolve });
      renderGate();
    });
  }

  function mkBtn(label, bg, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = `flex:1;padding:7px;border:0;border-radius:7px;background:${bg};color:#fff;font:600 12px system-ui;cursor:pointer;`;
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    return b;
  }

  function renderGate() {
    if (!pending.length) { gateBox?.remove(); gateBox = null; return; }
    if (!gateBox) {
      gateBox = document.createElement('div');
      gateBox.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;display:flex;flex-direction:column;gap:8px;width:320px;font:13px/1.45 system-ui,sans-serif;';
      (document.body || document.documentElement).appendChild(gateBox);
    }
    gateBox.textContent = '';
    for (const p of pending) {
      const card = document.createElement('div');
      card.style.cssText = 'background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:10px;padding:12px;box-shadow:0 8px 24px rgba(0,0,0,.45);';
      const h = document.createElement('div');
      h.style.cssText = 'font-weight:700;color:#fca5a5;margin-bottom:4px;';
      h.textContent = 'wants to report: ' + p.type;
      const m = document.createElement('div');
      m.style.cssText = 'color:#94a3b8;margin-bottom:10px;word-break:break-word;';
      m.textContent = p.message || '(no message)';
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:8px;';
      row.append(
        mkBtn('Send', '#16a34a', () => settle(p, true)),
        mkBtn('Drop', '#b91c1c', () => settle(p, false)),
      );
      card.append(h, m, row);
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

  function findCM(host) {
    const cm = host?.querySelector('.CodeMirror')?.CodeMirror;
    return cm && typeof cm.replaceSelection === 'function' ? cm : null;
  }

  function targetOf(host) {
    const cm = findCM(host);
    if (cm) return { cm };
    const el = Array.from(host.querySelectorAll('textarea,input,[contenteditable]')).find(e =>
      !e.disabled && !e.readOnly &&
      !(e.tagName === 'INPUT' && /hidden|file|checkbox|radio|button|submit|range|color/.test((e.type || '').toLowerCase()))
    );
    return el ? { el } : null;
  }

  function insertChar(t, ch) {
    if (t.cm) { t.cm.replaceSelection(ch, 'end'); return; }
    const el = t.el;
    el.focus();
    if (document.execCommand('insertText', false, ch)) return;
    const s = el.selectionStart ?? el.value.length;
    const e = el.selectionEnd ?? s;
    el.value = el.value.slice(0, s) + ch + el.value.slice(e);
    el.selectionStart = el.selectionEnd = s + ch.length;
    el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ch }));
  }

  let hud = null;
  function renderHud() {
    if (!typing) { hud?.remove(); hud = null; return; }
    if (!hud) {
      hud = document.createElement('div');
      hud.style.cssText = 'position:fixed;left:16px;bottom:16px;z-index:2147483647;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:8px 12px;font:12px system-ui;';
      (document.body || document.documentElement).appendChild(hud);
    }
    hud.textContent = `typing ${typing.done}/${typing.total} — Esc to stop`;
  }

  async function typeInto(host, text) {
    if (typing) typing.cancel = true;
    const t = targetOf(host);
    if (!t) return;
    t.cm ? t.cm.focus() : t.el.focus();

    const job = typing = { done: 0, total: text.length, cancel: false };
    renderHud();

    const base = text.length > 2000 ? Math.min(cfg.typeDelayMs, 12) : cfg.typeDelayMs;

    for (let i = 0; i < text.length; i++) {
      if (job.cancel) break;
      const ch = text[i];
      insertChar(t, ch);
      stats.charsTyped++;
      job.done = i + 1;
      renderHud();
      let d = base + (ch === '\n' ? 40 : 0);
      d += (Math.random() - 0.5) * base * cfg.jitter;
      await sleep(Math.max(4, d));
    }
    persistStats();
    if (typing === job) { typing = null; renderHud(); }
    addLog(`typed ${text.length} chars`);
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
    if (text) typeInto(host, text);
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
    typeInto(host, text);
  }, true);

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && typing) typing.cancel = true;
  }, true);

  /* ═════ side effects ═════ */
  let cssEl = null, bannerOrig = null, bannerOn = false, hiddenOn = false;

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
      if (!bannerOn) {
        const poll = setInterval(() => {
          if (typeof window.LabMetrics?.getState !== 'function') return;
          clearInterval(poll);
          bannerOrig = window.LabMetrics.getState;
          window.LabMetrics.getState = () => Object.assign({}, bannerOrig(), { warnings: [] });
          bannerOn = true;
        }, 50);
      }
    } else if (bannerOn && bannerOrig) {
      window.LabMetrics.getState = bannerOrig;
      bannerOn = false;
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
    getState: () => ({ cfg, stats, logs }),
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
  };

  applySideEffects();
  addLog('muter armed');
})();