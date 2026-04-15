# Tab Search

A production-ready browser extension for **Google Chrome** and **Mozilla Firefox** that turns **Ctrl+P** into a lightning-fast tab switcher inspired by the Visual Studio Code command palette.

---

## Features

| Feature | Details |
|---|---|
| **Instant activation** | Press **Ctrl+P** (or **Cmd+P** on macOS) from any tab |
| **Fuzzy search** | Searches tab titles _and_ URLs; consecutive-character bonus + word-boundary bonus + exact-substring bonus |
| **Real-time filtering** | Results update on every keystroke |
| **Keyboard navigation** | ↑ / ↓ to move, **Enter** to switch, **Esc** to close |
| **Mouse support** | Click any result to switch |
| **Cross-window** | Lists and switches tabs across all open windows |
| **Dark mode** | Automatically follows the OS `prefers-color-scheme` preference |
| **Shadow DOM isolation** | Extension styles never clash with the host page |
| **Favicon display** | Each result shows the tab's favicon |
| **"current" badge** | Active tab is clearly labelled |

---

## Repository Structure

```
tab-search/
├── chrome-extension/       Chrome Manifest V3 extension
│   ├── manifest.json
│   ├── background.js       Service worker — tab API + message hub
│   ├── content.js          UI injection + keyboard hook
│   └── icons/              16 × 48 × 128 px PNG icons
├── firefox-extension/      Firefox Manifest V2 extension
│   ├── manifest.json
│   ├── background.js       Event page — tab API + message hub
│   ├── content.js          UI injection + keyboard hook
│   └── icons/
└── shared/
    └── search.js           Canonical fuzzy-search source (inlined into each extension)
```

No build step is required — load either directory directly as an unpacked extension.

---

## Installation

### Google Chrome

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** and select the `chrome-extension/` folder

> **Shortcut note:** Chrome does not allow extensions to automatically override
> Ctrl+P (Print). The content script intercepts the `keydown` event with
> `preventDefault()`, which suppresses the Print dialog on regular web pages.
> See [Limitations](#limitations) for edge cases.
>
> Optionally, assign the shortcut officially:
> 1. Go to `chrome://extensions/shortcuts`
> 2. Find **Tab Search → Open Tab Search**
> 3. Set it to **Ctrl+P**

### Mozilla Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on…**
3. Navigate to `firefox-extension/` and select `manifest.json`

For a permanent install (developer edition or Nightly):
1. Open `about:config` and set `xpinstall.signatures.required` to `false`
2. Package the extension as a `.xpi` file (see [Packaging as .xpi](#packaging-as-xpi) below)
3. Open `about:addons` → **Extensions** → gear icon → **Install Add-on From File…**
4. Select the generated `tab-search-<version>.xpi`

> **Shortcut note:** Firefox allows the Ctrl+P override but may need manual
> assignment in `about:addons` → **Manage Extension Shortcuts**.

---

## Usage

| Action | Key |
|---|---|
| Open Tab Search | **Ctrl+P** / **Cmd+P** |
| Navigate results | **↑** / **↓** |
| Switch to selected tab | **Enter** or **click** |
| Close overlay | **Esc** or click backdrop |

Start typing immediately after the overlay opens — the list filters in real time across all open tabs.

---

## Limitations

| Limitation | Explanation |
|---|---|
| **chrome:// / about: pages** | Browsers block content scripts on internal pages (e.g. `chrome://newtab`, `about:blank`). Ctrl+P cannot be intercepted there. |
| **PDF viewer tabs** | The built-in PDF viewer may intercept keyboard events before the content script sees them. |
| **Chrome Ctrl+P override** | Chrome gives its Print shortcut higher priority than extension `commands`. The content-script `keydown` handler with `preventDefault()` works on standard pages but cannot suppress the Print dialog on browser-internal pages. |
| **Firefox temporary installs** | Temporary add-ons loaded via `about:debugging` are removed when Firefox restarts. Use a signed `.xpi` or Developer Edition for persistence. |
| **Iframe content** | The overlay is injected into the top-level frame only (`all_frames: false`). If focus is inside a cross-origin iframe, the keydown may not reach the content script. |

---

## Architecture

```
  User presses Ctrl+P
         │
  content.js — keydown listener (capture phase)
         │
         │── preventDefault()  → blocks browser Print dialog
         │
         ├── sendMessage({ action: 'GET_TABS' })
         │         │
         │   background.js (service worker / event page)
         │         │── chrome/browser.tabs.query({})
         │         └── returns serialised tab list
         │
         ├── buildOverlay()  — Shadow DOM card injected into <html>
         ├── renderList()    — fuzzy-filter + highlight + display
         │
  User types → renderList() (< 5 ms for ~200 tabs)
  User presses Enter
         │
         ├── sendMessage({ action: 'SWITCH_TAB', tabId, windowId })
         │         │
         │   background.js
         │         ├── windows.update(windowId, { focused: true })
         │         └── tabs.update(tabId, { active: true })
         └── closeOverlay()
```

### Fuzzy-search scoring

Each tab is scored against the query independently for title (weight ×2) and URL (weight ×1).  
For a given `(query, text)` pair, the algorithm:

1. Walks through the text finding query characters in order (subsequence match).
2. Awards **consecutive bonus** — consecutive character matches score higher.
3. Awards **word-boundary bonus** — matches at the start of words / path segments score higher.
4. Awards **exact substring bonus** — if the full query appears as a literal substring.

Results are sorted descending by score; the top 15 are shown.

---

## Packaging as .xpi

A `.xpi` file is simply a ZIP archive of the `firefox-extension/` directory.
The helper script `scripts/package-firefox.sh` automates this for you.

**Requirements:** `zip` (pre-installed on Linux and macOS).

```bash
bash scripts/package-firefox.sh
```

This produces `tab-search-<version>.xpi` in the repository root, ready to be
installed via **about:addons → Install Add-on From File…**.

---

## Development

### Reload after editing

**Chrome:** Go to `chrome://extensions/` and click the ↺ reload button for Tab Search.  
**Firefox:** Go to `about:debugging` and click **Reload** next to the extension.

### Updating shared search logic

Edit `shared/search.js` (the canonical source), then copy the `fuzzyMatch` and `searchTabs`
functions into both `chrome-extension/content.js` and `firefox-extension/content.js`
(they are inlined to avoid a build step).

---

## Contributing

Pull requests welcome. Please keep the "no build-step" constraint: plain JS, HTML, and CSS only.
