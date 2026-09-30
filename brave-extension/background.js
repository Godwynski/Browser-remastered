// Antigravity Hot-Reload Service Worker for Brave Extension
const WS_URL = 'ws://localhost:8765';
let socket = null;

function connectReloader() {
  try {
    socket = new WebSocket(WS_URL);

    socket.onopen = () => {
      console.log('⚡ [Antigravity] Background hot-reloader connected.');
    };

    socket.onmessage = (event) => {
      try {
        const { type, data } = JSON.parse(event.data);
        if (type === 'HOT_RELOAD_EXTENSION') {
          console.log('⚡ [Antigravity] File change detected! Auto-reloading extension...', data);
          chrome.runtime.reload();
        }
      } catch (_) {}
    };

    socket.onclose = () => {
      setTimeout(connectReloader, 3000);
    };

    socket.onerror = () => {
      socket.close();
    };
  } catch (_) {
    setTimeout(connectReloader, 3000);
  }
}

connectReloader();

// Universal HUD Toggle on any page via keyboard shortcut (Alt+Shift+A)
if (typeof chrome !== 'undefined' && chrome.commands) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'toggle-hud') {
      try {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (tab && tab.id && tab.url && !tab.url.startsWith('chrome://') && !tab.url.startsWith('brave://')) {
          await chrome.scripting.insertCSS({
            target: { tabId: tab.id },
            files: ['content/hud.css']
          }).catch(() => {});
          await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ['content/hud.js']
          }).catch(() => {});
        }
      } catch (err) {
        console.warn('[Antigravity] Toggle HUD error:', err);
      }
    }
  });
}
