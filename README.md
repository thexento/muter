# Muter

## Requirements

- **Firefox 128+ or Chromium (Chrome 114+ / Edge)** — both supported.
- A **Groq API key** (`gsk_...`) from <https://console.groq.com/keys>.
- Access to the lab site the extension is scoped to.

## Install

### Firefox / Zen

**Temporary add-on (development)**

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `firefox/manifest.json`.
4. The sidebar opens automatically (`open_at_install: true`). If it does not, click the
   Muter toolbar icon, press `Alt+Shift+M`, or use **View → Sidebar → Muter**.

**Packaged file** — zip the contents of `firefox/` with `manifest.json` at the zip
root, then open `about:addons` → gear icon → **Install Add-on From File…**.

**After changing code** — manifest changes need a full add-on reload
(`about:addons` → Muter → **Reload**, or `about:debugging` → **Reload**). Content-script
changes also need the page reloaded.

### Chromium (Chrome / Edge / Chrome-based browsers)

**Load unpacked (development)**

1. Open `chrome://extensions` (or `edge://extensions`).
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** → select the `chromium/` folder.

**After changing code** — click **Reload** on the extension card; the panel opens on
the toolbar icon automatically via `chrome.sidePanel.setPanelBehavior`.

Both builds: after changing page-script code (`inject.js` etc.), reload the lab page.

## Setup

1. Open the Muter sidebar.
2. Click **Set key**.
3. Paste a `gsk_...` key and press Enter.
4. The key is saved in `browser.storage.sync` as `groqKey`; the model is `groqModel`
   (default `openai/gpt-oss-120b`).

The key is only read by the background script. Page scripts never see it.

## Usage

1. Open a question on the lab page.
2. Open the Muter panel — the Firefox sidebar, or the Chrome/Edge side panel
   (the toolbar icon toggles it; Firefox lets you pin it with View → Sidebar).
3. Click **Autofill this question**.
4. Wait for the Groq step; a review card appears on the page with editable answers.
5. Edit anything you want.
6. Click **Type all answers**.
7. Use **Next question** or **Choose question** to continue.

| Action | Effect |
| --- | --- |
| **Save** | Stores answers for this page + question without typing. |
| **Try again** | Ignores saved answers and requests a fresh set from Groq. |
| **Close** | Hides the on-page card; the panel/sidebar stays open. |
| **Copy block** | Copies the answers in `fill.txt` format. |
| **Try filling again** | Re-runs the typing pass if a field was skipped. |
| **Choose question** | Shows Q1..QN chips to jump to another question. |
| **Next question** (on the done card) | Moves to the next question and generates fresh answers via Groq — saved answers for it are ignored. |

Saved answers are reused automatically; **Try again** forces regeneration.

## Settings

### AI options

| Setting | Description |
| --- | --- |
| **Auto-type after generating** | Types answers immediately after Groq responds (card still shown). |
| **Auto-fill next on #qN** | Fills the next question on hash navigation when saved answers exist. |

### Protection

| Setting | Description |
| --- | --- |
| **Type pastes as keystrokes** | Intercepts pasted text and retypes it character by character. |
| **Typing delay** | Base delay per character (5–120 ms). Long answers speed up automatically. |
| **Block metrics sync** | Blocks the page's metrics-sync requests. |
| **Gate warning API** | Intercepts the page's warning API so warnings can be dropped. |
| **Tab switch / Other warnings** | `drop`, `send`, or `ask` for those warning types. |
| **Report tab as always visible** | Overrides `document.hidden` / `visibilityState`. |
| **Hide warning popup / panel** | Hides the site's metrics warning UI. |

### Activity / Diagnostics

The activity log lists recent actions. **Diagnostics** shows the active tab, host
permission state, and whether the page API is present.

## How it works

```
┌──────────────────────────────┐
│ lab page (MAIN world)        │
│  extractor.js  formatter.js  │
│  inject.js ── UI + typing    │
└──────────────┬───────────────┘
               │ window.postMessage({ __muter: 1, cmd: 'generate' })
               ▼
┌──────────────────────────────┐
│ isolated world               │
│  bridge.js                   │
│  browser.runtime.sendMessage │
└──────────────┬───────────────┘
               ▼
┌──────────────────────────────┐
│ background.js                │
│  MuterAI → Groq REST API     │
│  storage.sync (key)          │
└──────────────────────────────┘
```

MAIN-world content scripts run in the page's JavaScript context and do not expose
`browser`/`chrome`. `bridge.js` runs in the isolated world, where the extension APIs
exist, and forwards requests/replies over `window.postMessage`.

The background runs in different engine shapes: Firefox uses a classic background page
(`background.scripts`) — the Zen build used for development rejects
`background.service_worker` — and Chrome/Edge uses the standard MV3 service worker
(`background.service_worker`). The same `background.js` code works in both because it
calls the engine's API through `globalThis.browser ?? globalThis.chrome`.

The toolbar icon opens the panel: `sidebar_action.toggle()` on Firefox,
`chrome.sidePanel.open()` (or `setPanelBehavior({ openPanelOnActionClick: true })`) on
Chrome/Edge. Both panels are the same `popup.html` document.

### Answer flow

1. `startFlow()` extracts the current question and its fields.
2. Saved answers are shown immediately; otherwise Groq is called.
3. `generateInto()` → `generateVia()` → bridge → `MuterAI.generate()` → Groq.
4. The response is validated against a strict JSON schema; invalid responses get one
   correction pass.
5. The review card shows editable answers.
6. `typeFlow()` → `fillAnswers()` types each answer into its live field.

### Field detection and typing

- `.answer-block` is the primary container.
- A fallback scan finds `.tox-tinymce`, `.CodeMirror`, `.cm-editor`, `input.fb-input`,
  `textarea.fb-textarea`, etc. that are not inside an `.answer-block`.
- TinyMCE's hidden `textarea.tinymce-field` marks a block as a rich editor while the
  editor is still booting.
- Each field is tagged with `data-muter-field` so it can be found again after DOM changes.
- Roles are inferred from the label, `data-field`, and editor type.
- Typing handles:
  - **TinyMCE** — targets `iframe.tox-edit-area__iframe`, clears the iframe body, types into
    it, fires `input`/`change`, and calls `tinymce.triggerSave()`.
  - **CodeMirror 5** — the wrapper's instance (`wrap.CodeMirror`) is used:
    clears the doc (`setValue('')`) and types via `replaceSelection(ch)` per
    character.
  - **CodeMirror 6** — dispatches into the editor view when available, otherwise types into
    `.cm-content`.
  - **Inputs / textareas** — clears the value and types character by character.
  - Newlines become real paragraph breaks in contenteditable editors.

## Project structure

```
muter/
├─ README.md
├─ .gitignore
├─ firefox/                 ← Firefox/Gecko build
│  ├─ manifest.json           sidebar_action, background.scripts
│  ├─ background.js           Groq client + toolbar-icon sidebar toggle
│  ├─ inject.js, extractor.js, formatter.js, bridge.js, ai.js, popup.html, popup.js
│  └─ icon*.png
└─ chromium/                ← Chrome/Edge MV3 build (same page files, adapted)
   ├─ manifest.json           side_panel.default_path: popup.html,
   │                          permission "sidePanel", background.service_worker
   ├─ background.js           toolbar-icon opens the side panel
   │                          (chrome.sidePanel.setPanelBehavior, open fallback)
   └─ inject.js, extractor.js, formatter.js, bridge.js, ai.js, popup.html, popup.js
```

| File | Responsibility |
| --- | --- |
| `manifest.json` | MV3 manifest: sidebar, background scripts, content scripts, permissions. |
| `background.js` | Handles `generate` / `keyStatus` / `setKey` / `clearKey`; calls Groq. |
| `ai.js` | Original Groq client; logic is inlined into `background.js`. |
| `bridge.js` | Forwards page `window.postMessage` requests to the background. |
| `extractor.js` | Finds `.question-body`, `.answer-block`, editors, controls, roles. |
| `formatter.js` | `fill.txt`-style formatting and answer persistence. |
| `inject.js` | Page flow, review card, typing engine, warning interception, stats. |
| `popup.html` | Sidebar panel markup/styles. |
| `popup.js` | Sidebar state polling, AI settings, key entry, diagnostics. |

## Storage keys

| Key | Area | Purpose |
| --- | --- | --- |
| `groqKey` | `storage.sync` | Groq API key. |
| `groqModel` | `storage.sync` | Selected Groq model. |
| `muter.answers.<origin+pathname>#q<N>` | `storage.local` | Saved answers for a question. |
| `muter.settings.v1` | `storage.local` | AI options: `autoType`, `autoQueue`, `typeDelayMs`. |
| `__muter_cfg_v1` | page `localStorage` | Protection/typing config. |
| `__muter_stats_v1` | page `localStorage` | Counters. |
| `__muter_log_v1` | page `localStorage` | Activity log. |

## Permissions

| Permission | Why |
| --- | --- |
| `scripting` | Inject the flow script into the active tab from the sidebar. |
| `tabs` | Find the active tab and send commands to it. |
| `storage` | Store the Groq key and saved answers. |
| lab-site origin | Run content scripts on the lab page. |
| `*://api.groq.com/*` | Let the background call the Groq API. |

## Debugging

Open the page DevTools console, filter `[Muter]`, then click **Autofill this question**:

```
[Muter] bridge: loaded browser undefined
[Muter] question fetched — Q1 <title>
[Muter] fields detected ["title(input.fb-input)", "theory(textarea.fb-textarea)", …]
[Muter] generateInto: calling groq api (question) 1 <title>
[Muter] generate via bridge
[Muter] bridge: generate request posted (question) 1 <title>
[Muter] bridge: generate request received (id, question) …
[Muter] groq generate (question) 1 <title>
[Muter] groq api POST (model, endpoint) openai/gpt-oss-120b https://api.groq.com/…
[Muter] groq response (status) 200
[Muter] parsing response ...
[Muter] bridge: reply from background (reply) {ok: true, answers: {…}}
```

When typing:

```
[Muter] fill: typing "title" → input
[Muter] fill: typing "theory" → input
[Muter] fill: typing "algorithm" → tinymce
[Muter] fill: typing "source_code" → codemirror
[Muter] fill: typing "result_conclusion" → input
[Muter] fill: finished { filled: [ … ], skipped: [] }
```

| Last log | Meaning |
| --- | --- |
| `bridge: loaded` + "no extension API" | `bridge.js` is not in the isolated world; check the manifest content-script split. |
| No `question fetched` | Extraction failed — inspect `.question-body` / `.answer-block`. |
| `calling groq api` but no `generate request received` | Bridge not loaded — reload the add-on and the page. |
| `generate request received` but no `groq api POST` | Background not responding — check `about:debugging` background errors. |
| `groq api POST` but no `groq response` | Network/auth/model problem — check key and `api.groq.com`. |
| `response got` but no card | UI error — check the page console for a stack trace. |
| `fill: no field for "algorithm"` | Extraction missed the editor; the done card lists it as skipped. |

Sidebar → **Diagnostics** shows the active tab, host permission, and page API state.

## Development

- No build step. All JavaScript is classic scripts (no bundler, no modules).
- Content-script worlds:
  - `bridge.js` → isolated world (no `world` key in its entry).
  - `extractor.js`, `formatter.js`, `inject.js` → `world: "MAIN"`.
- Keep `background.scripts`; do not switch to `background.service_worker` on Zen.
- Syntax checks:

```bash
for f in firefox/*.js; do node --check "$f"; done
node -e "JSON.parse(require('fs').readFileSync('firefox/manifest.json','utf8'))"
```

- Do not commit API keys. The key belongs in `storage.sync`, not in source.
