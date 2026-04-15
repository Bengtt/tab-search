/**
 * Tab Search — Chrome Background Service Worker (Manifest V3)
 *
 * Responsibilities:
 *  - Respond to GET_TABS messages with all open tabs (across all windows).
 *  - Respond to SWITCH_TAB messages by focusing the target window + tab.
 *  - Forward the "open-tab-search" keyboard command to the active tab's
 *    content script (used when the user assigns Ctrl+P via the extensions
 *    shortcuts page).
 */

'use strict';

// ---------------------------------------------------------------------------
// Message handler — called by content.js
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

  if (message.action === 'GET_TABS') {
    chrome.tabs.query({}, (tabs) => {
      sendResponse({
        tabs: tabs.map(tab => ({
          id:         tab.id,
          windowId:   tab.windowId,
          title:      tab.title      || '',
          url:        tab.url        || '',
          favIconUrl: tab.favIconUrl || '',
          active:     tab.active,
          index:      tab.index,
        })),
      });
    });
    return true; // keep message channel open for async sendResponse
  }

  if (message.action === 'SWITCH_TAB') {
    const { tabId, windowId } = message;
    chrome.windows.update(windowId, { focused: true }, () => {
      chrome.tabs.update(tabId, { active: true }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }
});

// ---------------------------------------------------------------------------
// Keyboard command forwarding
//
// Chrome does not allow a command shortcut to be Ctrl+P by default (it
// conflicts with the built-in Print command). However, users can reassign
// it via chrome://extensions/shortcuts. When that is done, this listener
// forwards the command to the content script of the currently active tab.
// The content script also listens for keydown directly so the extension
// works even without the manual shortcut reassignment.
// ---------------------------------------------------------------------------
chrome.commands.onCommand.addListener((command) => {
  if (command === 'open-tab-search') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { action: 'OPEN_TAB_SEARCH' })
          .catch(() => { /* tab may not have content script — silently ignore */ });
      }
    });
  }
});
