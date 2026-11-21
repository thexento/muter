# Muter

Muter is a Firefox / Zen Browser extension that autocompletes C-lab reports on
`class.nims.com.np`. It reads the current question from the page, asks Groq to write the
full lab report, lets you review and edit every answer, then types the answers into the
lab form — including TinyMCE editors and CodeMirror code blocks.

There is no Selenium, no Tkinter, no `.env` file, and no server. The API key is stored in
the browser's extension storage and never touches page code.

The extension opens as a **persistent sidebar panel**, so it stays visible while you click
around the page. The review / fill card itself is rendered on the page and also stays put
until you close it.

---

## Features

- **Reads the live question** — title, question number, total questions, and every answer
  field currently rendered on the lab page.
- **Groq-powered answers** — generates `title`, `theory`, `algorithm`, `source_code`,
  `output`, and `result_conclusion` with a strict JSON schema and a retry/correction pass.
- **Review before typing** — every answer appears in an editable text box. Edit anything,
  save it, regenerate it, or type it as-is.
- **Types like a human** — per-character input events with configurable delay, plus special
  handling for TinyMCE, CodeMirror 5/6, plain inputs, and textareas.
- **Persistent answers** — generated answers are kept in `storage.local` per page + question,
  so they survive reloads and can be reused.
- **Question navigation** — move to the next question or jump to any question (Q1..QN).
- **Fills every field it can find** — falls back to scanning the question container for
  editors that are not wrapped in the usual `.answer-block`.
- **Protection extras** — optional paste-as-keystrokes, warning-API gating, hiding the
  warning modal/panel, and reporting the tab as visible.
- **Clean sidebar UI** — one primary action, collapsible settings, compact stats, activity
  log, and diagnostics.

---

## Requirements

- **Zen Browser or Firefox 128+** (designed for Firefox / Gecko; not Chrome).
- A **Groq API key** (`gsk_...`) from <https://console.groq.com/keys>.
- Access to `class.nims.com.np`.

> **Why Firefox/Zen only?** The extension uses Firefox's `sidebar_action` and the MAIN-world
> content-script model. A Chrome prototype lives in `chromium/` but is not maintained.

---

## Install

### Load as a temporary add-on (development)

1. Open `about:debugging#/runtime/this-firefox` in Zen/Firefox.
2. Click **Load Temporary Add-on…**.
3. Select `firefox/manifest.json`.
4. The Muter sidebar opens automatically (`open_at_install: true`). If it does not, click
   the Muter toolbar icon, press `Alt+Shift+M`, or open **View → Sidebar → Muter**.

### Install from a packaged file

Zip the contents of `firefox/` (with `manifest.json` at the zip root), then open
`about:addons` → gear icon → **Install Add-on From File…** and choose the zip.

### After changing the code

Manifest changes need a full extension reload:

- `about:addons` → Muter → **Reload**, or
- `about:debugging` → Muter → **Reload**, or
- remove and re-add the temporary add-on.

Content-script changes also need the **lab page** to be reloaded.

---

## Set up the Groq key

1. Open the Muter sidebar.
2. Click **Set key**.
3. Paste a `gsk_...` key and press Enter (or click **Set key** again).
4. The key is saved with `browser.storage.sync` as `groqKey`; the default model is
   `openai/gpt-oss-120b` (`groqModel`).

The key is only used by the background script. Page scripts never see it.

---

## Usage

1. Open a lab question on `class.nims.com.np`.
2. Open the Muter sidebar.
3. Click **Autofill this question**.
4. Wait for the “Asking Groq…” step to finish. The review card appears on the page.
5. Edit any answer you want.
6. Click **Type all answers**.
7. When typing finishes, use **Next question** or **Choose question** to continue.

Other actions:

| Action | What it does |
| --- | --- |
| **Save** | Stores the current answers for this page + question without typing. |
| **Try again** | Ignores the saved answers and asks Groq for a fresh set. |
| **Close** | Hides the on-page card; the sidebar stays open. |
| **Copy block** | Copies the answers in `fill.txt` format. |
| **Try filling again** | Re-runs the typing pass if a field was skipped. |
| **Choose question** | Shows Q1..QN chips to jump to another question. |

Saved answers are reused automatically. Click **Try again** whenever you want new content.

---

## Settings

The sidebar has three collapsible sections.

### AI options

| Setting | Description |
| --- | --- |
| **Auto-type after generating** | Types the answers immediately after Groq responds (still shows the card). |
| **Auto-fill next on #qN** | Automatically fills the next question on hash navigation when saved answers exist. |

### Protection

| Setting | Description |
| --- | --- |
| **Type pastes as keystrokes** | Intercepts pasted text and retypes it one character at a time. |
| **Typing delay** | Base delay per character (5–120 ms). Long answers speed up automatically. |
| **Block metrics sync** | Blocks the page's metrics-sync requests. |
| **Gate warning API** | Intercepts the page's warning API so warnings can be dropped. |
| **Tab switch / Other warnings** | `drop`, `send`, or `ask` for those warning types. |
| **Report tab as always visible** | Overrides `document.hidden` / `visibilityState`. |
| **Hide warning popup / panel** | Hides the site's metrics warning UI. |

### Activity / Diagnostics

The activity log shows recent Muter actions. **Diagnostics** shows the active tab, host
permission state, and whether the page API is present.

---

## How it works

```
┌───────────────────────────────┐
│ class.nims.com.np (MAIN world)│
│  extractor.js   formatter.js  │
│  inject.js  ── UI + typing    │
└───────────────┬───────────────┘
                │ window.postMessage({ __muter: 1, cmd: 'generate' })
                ▼
┌───────────────────────────────┐
│ isolated world                │
│  bridge.js                    │
│  browser.runtime.sendMessage  │
└───────────────┬───────────────┘
                ▼
┌───────────────────────────────┐
│ background.js (classic page)  │
│  MuterAI → Groq REST API      │
│  storage.sync (key)           │
└───────────────────────────────┘
```

Why the bridge is needed: Firefox MAIN-world content scripts run in the page's JavaScript
context and **do not expose `browser` or `chrome`**. `bridge.js` runs in the isolated world,
where the extension APIs exist, and forwards generate requests/replies with
`window.postMessage`.

The background is a **classic background page** (`background.scripts`), not an MV3 service
worker. The Zen build used for testing rejects `background.service_worker` with
`Protocol error: background.service_worker is currently disabled. Add background.scripts.`

### Answer flow

1. `startFlow()` extracts the current question and fields.
2. If saved answers exist, they are shown immediately; otherwise Groq is called.
3. `generateInto()` → `generateVia()` → bridge → `MuterAI.generate()` → Groq.
4. The response is validated against the strict JSON schema; invalid responses get one
   correction pass.
5. The review card shows editable answers.
6. `typeFlow()` → `fillAnswers()` types each answer into the matching live field.

### Field detection and typing

- `.answer-block` is the primary container.
- A fallback scan finds `.tox-tinymce`, `.CodeMirror`, `.cm-editor`, `input.fb-input`,
  `textarea.fb-textarea`, etc. that are not inside an `.answer-block` — the Algorithm box
  is sometimes rendered without one.
- TinyMCE's hidden `textarea.tinymce-field` is used as an early signal while the editor
  boots.
- Each field is tagged with `data-muter-field` so it can be found again after DOM changes.
- Roles are inferred from the label, `data-field`, and editor type.
- Typing handles:
  - **TinyMCE** — targets `iframe.tox-edit-area__iframe`, clears the iframe body, types
    into it, and fires `input`/`change` + `tinymce.triggerSave()`.
  - **CodeMirror 5** — `CodeMirror.replaceSelection`.
  - **CodeMirror 6** — dispatches into the editor view when available, otherwise types into
    `.cm-content`.
  - **Inputs / textareas** — clears the value and types character by character.
  - Newlines become real paragraph breaks in contenteditable editors.

> **Historical bug fixed in 1.2.0:** the TinyMCE host used to be the `.answer-block`
> `<div>`, which has no `contentDocument`, so the Algorithm field was silently skipped.
> The host is now the editor iframe.

---

## Project structure

```
muter/
├─ README.md
├─ .gitignore
├─ firefox/                 ← maintained extension (load this manifest)
│  ├─ manifest.json
│  ├─ background.js         message API + inlined Groq client
│  ├─ ai.js                 standalone Groq client source (same logic)
│  ├─ bridge.js             isolated-world message bridge
│  ├─ extractor.js          question + field extraction
│  ├─ formatter.js          answer storage + fill.txt formatting
│  ├─ inject.js             page UI, extraction wiring, typing engine
│  ├─ popup.html            sidebar panel (also the old popup document)
│  ├─ popup.js              sidebar logic
│  └─ icon*.png
└─ chromium/                early Chrome MV3 prototype (not maintained)
```

### `firefox/` files

| File | Responsibility |
| --- | --- |
| `manifest.json` | MV3 manifest: sidebar, background scripts, content scripts, permissions. |
| `background.js` | Handles `generate` / `keyStatus` / `setKey` / `clearKey`; calls Groq. |
| `ai.js` | Original Groq client; logic is inlined into `background.js`. |
| `bridge.js` | Forwards page `window.postMessage` generate requests to the background. |
| `extractor.js` | Finds `.question-body`, `.answer-block`, TinyMCE/CodeMirror/controls, roles. |
| `formatter.js` | `fill.txt`-style formatting and answer persistence. |
| `inject.js` | Page flow, review card, typing engine, warning interception, stats. |
| `popup.html` | Persistent sidebar panel markup/styles. |
| `popup.js` | Sidebar state polling, AI settings, key entry, diagnostics. |

---

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

---

## Permissions

| Permission | Why |
| --- | --- |
| `scripting` | Inject the flow script into the active lab tab from the sidebar. |
| `tabs` | Find the active tab and send commands to it. |
| `storage` | Store the Groq key and saved answers. |
| `*://class.nims.com.np/*` | Run content scripts on the lab page. |
| `*://api.groq.com/*` | Let the background call the Groq API. |

---

## Debugging

Open the page DevTools console, filter by `[Muter]`, then click **Autofill this question**.
The expected trail is:

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
[Muter] bridge: got reply from background (reply) …
[Muter] response got from groq (reply) …
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

Where it stops:

| Last log | Meaning |
| --- | --- |
| `bridge: loaded` + “no extension API” | `bridge.js` is not in the isolated world. Check the manifest split. |
| No `question fetched` | Extraction failed — inspect `.question-body` / `.answer-block`. |
| `calling groq api` but no `generate request received` | The bridge was not loaded/reloaded. Reload the add-on and the page. |
| `generate request received` but no `groq api POST` | The background is not responding. Check `about:debugging` → background errors. |
| `groq api POST` but no `groq response` | Network/auth/model problem. Check the key and `api.groq.com`. |
| `response got` but no card | UI error — check the page console for a stack trace. |
| `fill: no field for "algorithm"` | Extraction missed the editor; the done card lists it as skipped. |

Sidebar → **Diagnostics** shows the active tab, host permission, and page API state.

Common non-issues in the page console:

- `MouseEvent.mozInputSource is deprecated` — from the site's TinyMCE.
- `Security Error: … may not load or link to file:///` — from the site/page.

---

## Development

- No build step. Edit the files and reload the add-on.
- All JavaScript is classic scripts (no bundler, no modules).
- Content-script worlds matter:
  - `bridge.js` → isolated world (no `world` key in its entry).
  - `extractor.js`, `formatter.js`, `inject.js` → `world: "MAIN"`.
- Keep `background.scripts`; do not switch to `background.service_worker` on Zen.
- After editing, run:

```bash
for f in firefox/*.js; do node --check "$f"; done
node -e "JSON.parse(require('fs').readFileSync('firefox/manifest.json','utf8'))"
```

- Do not commit API keys. The key belongs in the browser's `storage.sync`, not in source.

---

## Limitations

- Only runs on `*://class.nims.com.np/*`.
- Firefox / Zen only.
- **Output** is always generated as an empty string; attach the output file manually if the
  form requires one.
- Groq rate limits apply; a 429 shows an error in the card.
- The `chromium/` folder is an early prototype and is not kept in sync.

---

## Credits

- Groq API for generation.
- The extraction, typing, and formatting behavior is modeled on an earlier Python/Selenium
  autocompleter.
