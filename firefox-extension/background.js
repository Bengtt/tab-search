/**
 * Tab Search — Firefox Background Script (Manifest V2)
 *
 * Uses the Promise-based `browser.*` WebExtensions API natively available in
 * Firefox. Falls back to the callback-based `chrome.*` alias where needed.
 *
 * Responsibilities:
 *  - Respond to GET_TABS messages with all open tabs (across all windows).
 *  - Respond to SWITCH_TAB messages by focusing the target window + tab.
 *  - Forward the "open-tab-search" keyboard command to the active tab's
 *    content script (used when the user assigns Ctrl+P via
 *    about:addons → Manage Extension Shortcuts).
 */

'use strict';

// ---------------------------------------------------------------------------
// Message handler — called by content.js
// ---------------------------------------------------------------------------
browser.runtime.onMessage.addListener((message) => {

  if (message.action === 'GET_TABS') {
    return browser.tabs.query({}).then((tabs) => ({
      tabs: tabs.map(tab => ({
        id:         tab.id,
        windowId:   tab.windowId,
        title:      tab.title      || '',
        url:        tab.url        || '',
        favIconUrl: tab.favIconUrl || '',
        active:     tab.active,
        index:      tab.index,
      })),
    }));
  }

  if (message.action === 'SWITCH_TAB') {
    const { tabId, windowId } = message;
    return browser.windows.update(windowId, { focused: true })
      .then(() => browser.tabs.update(tabId, { active: true }))
      .then(() => ({ success: true }));
  }
});

// ---------------------------------------------------------------------------
// Keyboard command forwarding (commands API path)
// ---------------------------------------------------------------------------
browser.commands.onCommand.addListener((command) => {
  if (command === 'open-tab-search') {
    browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
      if (tabs[0]) {
        browser.tabs.sendMessage(tabs[0].id, { action: 'OPEN_TAB_SEARCH' })
          .catch(() => { /* tab may not have content script — silently ignore */ });
      }
    });
  }
});
