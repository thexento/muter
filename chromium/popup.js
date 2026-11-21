const SITE = /^https?:\/\/class\.nims\.com\.np\//;
const $ = (s) => document.getElementById(s);

async function tab() {
  const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
  return t && SITE.test(t.url || '') ? t : null;
}

async function call(fn, args) {
  const t = await tab();
  if (!t) return null;
  try {
    const [r] = await chrome.scripting.executeScript({ target: { tabId: t.id }, world: 'MAIN', func: fn, args: args || [] });
    return r?.result;
  } catch { return null; }
}

function setSw(el, on) { el.classList.toggle('on', !!on); }

function render(st) {
  if (!st) {
    $('banner').style.display = 'block';
    $('settings').classList.add('off');
    $('sw').classList.add('off');
    return;
  }
  const { cfg, stats, logs } = st;
  $('banner').style.display = 'none';
  $('settings').classList.remove('off');
  $('sw').classList.toggle('off', !cfg.enabled);
  setSw($('sw'), cfg.enabled);

  $('c-copy').textContent = stats.copy;
  $('c-cut').textContent = stats.cut;
  $('c-paste').textContent = stats.paste;
  $('c-chars').textContent = stats.charsTyped;
  $('c-warn').textContent = stats.warnSeen;
  $('c-drop').textContent = stats.warnDropped;

  setSw($('s-typePaste'), cfg.typePaste);
  setSw($('s-gate'), cfg.gateWarnings);
  setSw($('s-sync'), cfg.blockSync);
  setSw($('s-visible'), cfg.fakeVisible);
  setSw($('s-modal'), cfg.muteModal);
  setSw($('s-banner'), cfg.muteBanner);
  $('s-tab').value = cfg.tabHidden;
  $('s-other').value = cfg.otherWarnings;
  $('s-delay').value = cfg.typeDelayMs;

  $('log').textContent = '';
  for (const e of logs) {
    const row = document.createElement('div');
    const t = document.createElement('time');
    t.textContent = new Date(e.t).toLocaleTimeString();
    const m = document.createElement('span');
    m.textContent = e.msg;
    row.append(t, m);
    $('log').appendChild(row);
  }
}

async function tick() { render(await call(() => window.__muter?.getState() ?? null)); }

function bindToggle(id, key) {
  $(id).addEventListener('click', async () => {
    const st = await call(() => window.__muter?.getState() ?? null);
    if (!st) return;
    await call((k, v) => window.__muter.setConfig({ [k]: v }), [key, !st.cfg[key]]);
    tick();
  });
}

['sw:enabled', 's-typePaste:typePaste', 's-gate:gateWarnings', 's-sync:blockSync',
 's-visible:fakeVisible', 's-modal:muteModal', 's-banner:muteBanner']
  .forEach(p => { const [id, key] = p.split(':'); bindToggle(id, key); });

$('s-tab').addEventListener('change', async (e) => {
  await call((v) => window.__muter.setConfig({ tabHidden: v }), [e.target.value]); tick();
});
$('s-other').addEventListener('change', async (e) => {
  await call((v) => window.__muter.setConfig({ otherWarnings: v }), [e.target.value]); tick();
});
$('s-delay').addEventListener('input', (e) => {
  call((v) => window.__muter.setConfig({ typeDelayMs: Number(v) }), [e.target.value]);
});
$('reset').addEventListener('click', async () => {
  await call(() => window.__muter.reset()); tick();
});

tick();
setInterval(tick, 700);