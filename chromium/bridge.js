/* Muter — isolated-world bridge.
 *
 * MAIN-world content scripts (where `browser`/`chrome` are not defined) get
 * this script in the isolated world, where the extension APIs exist. It
 * forwards generate requests from the page to the background script and
 * posts the replies back to the page via window.postMessage.
 *
 * IMPORTANT: it must run in the ISOLATED world — it is listed as its own
 * content_scripts entry in manifest.json without a `world` key (omitting it
 * uses the isolated world).
 */
(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  console.log('[Muter] bridge: loaded (extension API present)', !!api);
  if (!api?.runtime?.sendMessage) {
    console.warn('[Muter] bridge: no extension API in this world');
    return;
  }

  window.addEventListener('message', (e) => {
    const m = e.data;
    if (!m || m.__muter !== 1 || m.cmd !== 'generate') return;
    console.log('[Muter] bridge: generate request received (id, question)', m.id, m.question?.number, m.question?.title);
    api.runtime.sendMessage({ type: 'generate', question: m.question })
      .then((reply) => {
        console.log('[Muter] bridge: reply from background (reply)', reply);
        window.postMessage({ __muter: 1, cmd: 'generated', id: m.id, reply }, '*');
      })
      .catch((err) => {
        console.log('[Muter] bridge: sendMessage failed (error)', err?.message || String(err));
        window.postMessage({ __muter: 1, cmd: 'generated', id: m.id, reply: { ok: false, code: 'runtime', error: err?.message || String(err) } }, '*');
      });
  });
})();
