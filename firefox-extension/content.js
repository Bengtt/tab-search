/**
 * Tab Search — Firefox Content Script
 *
 * Nearly identical to the Chrome version; the only difference is using
 * the Promise-based `browser.runtime` API instead of the callback-based
 * `chrome.runtime`. Firefox supports both, but `browser.*` is idiomatic
 * and avoids `chrome.runtime.lastError` handling.
 *
 * Activated by:
 *  1. Pressing Ctrl+P on the page (keydown captured in the capture phase
 *     so `preventDefault()` suppresses the browser's Print dialog).
 *  2. A message from the background script when the user has manually
 *     assigned the "open-tab-search" command via
 *     about:addons → Manage Extension Shortcuts.
 */

'use strict';

if (!window.__tabSearchInjected) {
  window.__tabSearchInjected = true;

  // =========================================================================
  // Fuzzy Search Engine (inlined from /shared/search.js)
  // =========================================================================

  function fuzzyMatch(query, text) {
    if (!query) return { score: 0, indices: [] };
    if (!text)  return null;

    const q = query.toLowerCase();
    const t = text.toLowerCase();

    let score = 0;
    const indices = [];
    let ti = 0, qi = 0, consecutive = 0;

    while (qi < q.length && ti < t.length) {
      if (q[qi] === t[ti]) {
        indices.push(ti);
        score += 1 + consecutive;
        consecutive++;
        qi++;
      } else {
        consecutive = 0;
      }
      ti++;
    }
    if (qi < q.length) return null;

    for (const idx of indices) {
      if (idx === 0 || /[\s\-_./:]/.test(t[idx - 1])) score += 3;
    }
    if (t.includes(q)) score += 10;

    return { score, indices };
  }

  function searchTabs(query, tabs) {
    if (!query.trim()) {
      return tabs.map(tab => ({ tab, score: 0, titleIndices: [], urlIndices: [] }));
    }
    const results = [];
    for (const tab of tabs) {
      const tm = fuzzyMatch(query, tab.title || '');
      const um = fuzzyMatch(query, tab.url   || '');
      if (tm || um) {
        results.push({
          tab,
          score:        Math.max(tm ? tm.score * 2 : 0, um ? um.score : 0),
          titleIndices: tm ? tm.indices : [],
          urlIndices:   um ? um.indices : [],
        });
      }
    }
    return results.sort((a, b) => b.score - a.score);
  }

  // =========================================================================
  // Helpers
  // =========================================================================

  function highlightText(text, indices) {
    const frag = document.createDocumentFragment();
    if (!indices || indices.length === 0) {
      frag.appendChild(document.createTextNode(text));
      return frag;
    }
    const set = new Set(indices);
    let i = 0;
    while (i < text.length) {
      if (set.has(i)) {
        const mark = document.createElement('mark');
        mark.textContent = text[i];
        frag.appendChild(mark);
        i++;
      } else {
        let j = i;
        while (j < text.length && !set.has(j)) j++;
        frag.appendChild(document.createTextNode(text.slice(i, j)));
        i = j;
      }
    }
    return frag;
  }

  function truncate(str, max) {
    return str.length > max ? str.slice(0, max - 1) + '…' : str;
  }

  function faviconEl(tab) {
    const url = tab.favIconUrl;
    if (url && !url.startsWith('moz-extension://') && !url.startsWith('chrome://')) {
      const img = document.createElement('img');
      img.className = 'ts-favicon';
      img.src = url;
      img.alt = '';
      img.addEventListener('error', () => { img.style.display = 'none'; });
      return img;
    }
    const span = document.createElement('span');
    span.className = 'ts-favicon ts-favicon--fallback';
    span.setAttribute('aria-hidden', 'true');
    span.textContent = '🌐';
    return span;
  }

  // =========================================================================
  // Overlay state
  // =========================================================================

  let overlayState = null;
  let allTabs      = [];
  let results      = [];
  let selectedIdx  = 0;

  const MAX_RESULTS = 15;

  // =========================================================================
  // Build overlay DOM
  // =========================================================================

  function buildOverlay() {
    if (overlayState) return overlayState.shadow;

    const host = document.createElement('div');
    host.id    = '__tab-search-root__';
    host.style.cssText = 'position:fixed;inset:0;z-index:2147483647;pointer-events:none;width:0;height:0;';

    const shadow = host.attachShadow({ mode: 'open' });

    const styleEl = document.createElement('style');
    styleEl.textContent = OVERLAY_CSS;
    shadow.appendChild(styleEl);

    const root = document.createElement('div');
    root.className = 'ts-root';
    root.innerHTML = `
      <div class="ts-backdrop" aria-hidden="true"></div>
      <div class="ts-dialog" role="dialog" aria-modal="true" aria-label="Tab Search">
        <div class="ts-header">
          <svg class="ts-search-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <circle cx="9" cy="9" r="6" stroke="currentColor" stroke-width="1.8"/>
            <path d="M14 14L18 18" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
          </svg>
          <input
            class="ts-input"
            type="text"
            placeholder="Search open tabs…"
            autocomplete="off"
            spellcheck="false"
            aria-autocomplete="list"
            aria-controls="ts-list"
            role="combobox"
            aria-expanded="true"
          >
        </div>
        <ul class="ts-list" id="ts-list" role="listbox" aria-label="Open tabs"></ul>
        <div class="ts-footer" aria-hidden="true">
          <span class="ts-hint"><kbd>↑</kbd> <kbd>↓</kbd> navigate</span>
          <span class="ts-hint"><kbd>↵</kbd> switch</span>
          <span class="ts-hint"><kbd>Esc</kbd> close</span>
        </div>
      </div>
    `;
    shadow.appendChild(root);
    document.documentElement.appendChild(host);

    overlayState = { host, shadow };

    const input    = shadow.querySelector('.ts-input');
    const backdrop = shadow.querySelector('.ts-backdrop');

    input.addEventListener('input', () => { selectedIdx = 0; renderList(); });
    input.addEventListener('keydown', onInputKeydown);
    backdrop.addEventListener('click', closeOverlay);

    requestAnimationFrame(() => input.focus());

    return shadow;
  }

  // =========================================================================
  // Render list
  // =========================================================================

  function renderList() {
    const shadow = overlayState && overlayState.shadow;
    if (!shadow) return;

    const query = shadow.querySelector('.ts-input').value;
    const list  = shadow.querySelector('.ts-list');

    results = searchTabs(query, allTabs);
    const visible = results.slice(0, MAX_RESULTS);

    while (list.firstChild) list.removeChild(list.firstChild);

    if (visible.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'ts-empty';
      empty.textContent = 'No tabs found';
      list.appendChild(empty);
      return;
    }

    visible.forEach((res, i) => {
      const { tab, titleIndices, urlIndices } = res;
      const selected = i === selectedIdx;

      const li = document.createElement('li');
      li.className = 'ts-item' + (selected ? ' ts-item--active' : '');
      li.setAttribute('role', 'option');
      li.setAttribute('aria-selected', String(selected));
      li.dataset.idx = String(i);

      li.appendChild(faviconEl(tab));

      const itemText = document.createElement('div');
      itemText.className = 'ts-item-text';

      const titleDiv = document.createElement('div');
      titleDiv.className = 'ts-item-title';
      titleDiv.appendChild(highlightText(truncate(tab.title || '(no title)', 80), titleIndices));

      const urlDiv = document.createElement('div');
      urlDiv.className = 'ts-item-url';
      urlDiv.appendChild(highlightText(truncate(tab.url || '', 90), urlIndices));

      itemText.appendChild(titleDiv);
      itemText.appendChild(urlDiv);
      li.appendChild(itemText);

      if (tab.active) {
        const badge = document.createElement('span');
        badge.className = 'ts-badge';
        badge.textContent = 'current';
        li.appendChild(badge);
      }

      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        selectedIdx = parseInt(li.dataset.idx, 10);
        activateSelected();
      });

      list.appendChild(li);
    });

    scrollActiveIntoView(list);
  }

  function scrollActiveIntoView(list) {
    const active = list.querySelector('.ts-item--active');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function updateSelection(delta) {
    const shadow = overlayState && overlayState.shadow;
    if (!shadow) return;
    const count = Math.min(results.length, MAX_RESULTS);
    selectedIdx = Math.max(0, Math.min(selectedIdx + delta, count - 1));
    const list  = shadow.querySelector('.ts-list');
    list.querySelectorAll('.ts-item').forEach((el, i) => {
      const sel = i === selectedIdx;
      el.classList.toggle('ts-item--active', sel);
      el.setAttribute('aria-selected', sel);
    });
    scrollActiveIntoView(list);
  }

  // =========================================================================
  // Actions
  // =========================================================================

  function activateSelected() {
    const res = results[selectedIdx];
    if (!res) return;
    browser.runtime.sendMessage({
      action:   'SWITCH_TAB',
      tabId:    res.tab.id,
      windowId: res.tab.windowId,
    });
    closeOverlay();
  }

  function closeOverlay() {
    if (overlayState) {
      overlayState.host.remove();
      overlayState = null;
    }
  }

  async function openOverlay() {
    if (overlayState) { closeOverlay(); return; }

    let response;
    try {
      response = await browser.runtime.sendMessage({ action: 'GET_TABS' });
    } catch (err) {
      console.warn('[Tab Search] Could not reach background:', err.message);
      return;
    }

    allTabs     = (response && response.tabs) || [];
    selectedIdx = 0;

    buildOverlay();
    renderList();
  }

  // =========================================================================
  // Keyboard handlers
  // =========================================================================

  function onInputKeydown(e) {
    switch (e.key) {
      case 'ArrowDown':  e.preventDefault(); updateSelection(+1); break;
      case 'ArrowUp':    e.preventDefault(); updateSelection(-1); break;
      case 'Enter':      e.preventDefault(); activateSelected();  break;
      case 'Escape':     e.preventDefault(); closeOverlay();      break;
    }
  }

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'p') {
      e.preventDefault();
      e.stopImmediatePropagation();
      openOverlay();
      return;
    }
    if (e.key === 'Escape' && overlayState) {
      e.preventDefault();
      closeOverlay();
    }
  }, true);

  browser.runtime.onMessage.addListener((msg) => {
    if (msg && msg.action === 'OPEN_TAB_SEARCH') openOverlay();
  });

  // =========================================================================
  // Styles
  // =========================================================================

  const OVERLAY_CSS = /* css */`
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    .ts-root {
      position: fixed;
      inset: 0;
      display: flex;
      align-items: flex-start;
      justify-content: center;
      padding-top: clamp(48px, 8vh, 120px);
      pointer-events: auto;
      z-index: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      color-scheme: light dark;
    }

    .ts-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.45);
      backdrop-filter: blur(3px);
      -webkit-backdrop-filter: blur(3px);
    }

    .ts-dialog {
      position: relative;
      z-index: 1;
      width: min(600px, calc(100vw - 32px));
      max-height: min(520px, calc(100vh - 80px));
      background: #ffffff;
      border-radius: 14px;
      box-shadow:
        0 0 0 1px rgba(0,0,0,.06),
        0 8px 24px rgba(0,0,0,.12),
        0 24px 56px rgba(0,0,0,.14);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .ts-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 13px 16px;
      border-bottom: 1px solid #e5e7eb;
      flex-shrink: 0;
    }
    .ts-search-icon { width: 18px; height: 18px; color: #9ca3af; flex-shrink: 0; }

    .ts-input {
      flex: 1;
      border: none;
      outline: none;
      font-size: 15px;
      font-family: inherit;
      color: #111827;
      background: transparent;
    }
    .ts-input::placeholder { color: #9ca3af; }

    .ts-list {
      flex: 1;
      overflow-y: auto;
      list-style: none;
      padding: 4px 0;
      overscroll-behavior: contain;
    }
    .ts-list::-webkit-scrollbar       { width: 5px; }
    .ts-list::-webkit-scrollbar-track { background: transparent; }
    .ts-list::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 3px; }

    .ts-empty {
      padding: 28px 16px;
      text-align: center;
      color: #9ca3af;
      font-size: 13px;
    }

    .ts-item {
      display: flex;
      align-items: center;
      gap: 11px;
      padding: 8px 16px;
      cursor: pointer;
      user-select: none;
      transition: background 80ms;
    }
    .ts-item:hover         { background: #f3f4f6; }
    .ts-item--active       { background: #eff6ff; }
    .ts-item--active:hover { background: #dbeafe; }

    .ts-favicon {
      width: 16px; height: 16px;
      border-radius: 3px;
      flex-shrink: 0;
      object-fit: contain;
    }
    .ts-favicon--fallback {
      font-size: 13px; line-height: 16px;
      display: inline-block; text-align: center;
    }

    .ts-item-text  { flex: 1; min-width: 0; }
    .ts-item-title {
      font-weight: 500;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      color: #111827; font-size: 13.5px;
    }
    .ts-item-url {
      font-size: 11.5px; color: #6b7280;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      margin-top: 1px;
    }

    .ts-badge {
      font-size: 10px; font-weight: 600;
      text-transform: uppercase; letter-spacing: .06em;
      color: #3b82f6; background: #eff6ff;
      border: 1px solid #bfdbfe; border-radius: 4px;
      padding: 1px 6px; flex-shrink: 0;
    }

    mark { background: transparent; color: #2563eb; font-weight: 700; }

    .ts-footer {
      display: flex; align-items: center; gap: 18px;
      padding: 7px 16px;
      border-top: 1px solid #e5e7eb;
      background: #f9fafb; flex-shrink: 0;
    }
    .ts-hint { display: flex; align-items: center; gap: 3px; font-size: 11px; color: #9ca3af; }
    kbd {
      display: inline-block; padding: 1px 5px;
      font-family: inherit; font-size: 10px;
      color: #4b5563; background: #fff;
      border: 1px solid #d1d5db; border-radius: 4px;
      box-shadow: 0 1px 0 #c8cdd5;
    }

    /* Dark mode */
    @media (prefers-color-scheme: dark) {
      .ts-backdrop { background: rgba(0,0,0,.65); }
      .ts-dialog {
        background: #1c1c2e;
        box-shadow: 0 0 0 1px rgba(255,255,255,.08), 0 8px 24px rgba(0,0,0,.4), 0 24px 56px rgba(0,0,0,.5);
        color: #e2e8f0;
      }
      .ts-header         { border-bottom-color: #2d2d44; }
      .ts-search-icon    { color: #4b5563; }
      .ts-input          { color: #e2e8f0; }
      .ts-input::placeholder { color: #4b5563; }
      .ts-list::-webkit-scrollbar-thumb { background: #3d3d5c; }
      .ts-item:hover         { background: #2d2d44; }
      .ts-item--active       { background: #1e3a5f; }
      .ts-item--active:hover { background: #254f82; }
      .ts-item-title { color: #e2e8f0; }
      .ts-item-url   { color: #6b7280; }
      .ts-badge      { background: #1e3a5f; border-color: #254f82; color: #93c5fd; }
      mark           { color: #93c5fd; }
      .ts-footer     { border-top-color: #2d2d44; background: #16162a; }
      .ts-hint       { color: #4b5563; }
      kbd            { background: #2d2d44; border-color: #3d3d5c; color: #9ca3af; box-shadow: 0 1px 0 #3d3d5c; }
    }
  `;

} // end guard
