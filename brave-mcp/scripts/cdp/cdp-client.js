import WebSocket from 'ws';

export async function sendCdpCommand(webSocketUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketUrl);
    let id = 1;
    ws.on('open', () => {
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.id === id) {
        ws.close();
        if (msg.error) reject(msg.error);
        else resolve(msg.result);
      }
    });
    ws.on('error', reject);
    setTimeout(() => {
      ws.close();
      reject(new Error("Timeout sending CDP command: " + method));
    }, 10000);
  });
}

export async function evalInTab(targetId, expression) {
  const tabs = await fetch('http://127.0.0.1:9222/json').then(r => r.json());
  const tab = tabs.find(t => t.id === targetId || (t.title && t.title.includes(targetId)) || (t.url && t.url.includes(targetId)));
  if (!tab || !tab.webSocketDebuggerUrl) throw new Error("Target not found: " + targetId);
  const res = await sendCdpCommand(tab.webSocketDebuggerUrl, 'Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true
  });
  return res.result ? res.result.value : res;
}
