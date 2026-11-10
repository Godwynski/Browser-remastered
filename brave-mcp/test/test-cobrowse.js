// End-to-end: drives the real MCP server over CDP against a throwaway headless browser
// (never the user's Brave) and checks co-browsing, token and universality guarantees.
import http from 'http';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { chromium } from 'playwright-core';
import { getTestBrowserExe } from './test-helper.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CDP_PORT = 9555, WEB_PORT = 9666;
const BASE = `http://127.0.0.1:${WEB_PORT}`;

const LONG = Array.from({ length: 40 }, (_, i) => `<p>Paragraph ${i + 1}: ${'lorem ipsum dolor sit amet '.repeat(6)}</p>`).join('');
const MAIN = `<!doctype html><title>Cobrowse Bench</title>
<label>Name <input id="name"></label>
<select id="role"><option value="u">User</option><option value="a">Admin</option></select>
<button id="save" onclick="setTimeout(()=>{const $=id=>document.getElementById(id); $('out').textContent='Saved '+$('name').value+' as '+$('role').value; const u=document.createElement('button'); u.textContent='Undo'; document.body.append(u)},200)">Save</button>
<button onclick="if(confirm('Delete it?')) out.textContent='Deleted'">Delete</button>
<button onclick="setTimeout(()=>alert('Late alert'),1500)">Later</button>
<button onclick="fetch('/api/items').then(r=>r.json()).then(d=>out.textContent='Loaded '+d.items.length)">Load</button>
<button onclick="dlg.showModal()">Open modal</button>
<dialog id="dlg"><h2>Confirm</h2><button onclick="dlg.close()">Close modal</button></dialog>
<a href="/other" target="_blank">Open other</a>
<p id="out"></p><article>${LONG}</article>`;

function startServer() {
  const server = http.createServer((req, res) => {
    if (req.url === '/api/items') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ items: [1, 2, 3], total: 3 })); return; }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(req.url === '/other' ? '<title>Other Page</title><button>Other button</button>' : MAIN);
  });
  return new Promise(r => server.listen(WEB_PORT, () => r(server)));
}

function mcpClient() {
  const proc = spawn('node', [path.resolve(__dirname, '../src/index.js')], { env: { ...process.env, CDP_URL: `http://127.0.0.1:${CDP_PORT}` }, stdio: ['pipe', 'pipe', 'inherit'] });
  let buf = '', id = 0;
  const waiting = new Map();
  proc.stdout.on('data', (d) => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const lineStr = buf.slice(0, i); buf = buf.slice(i + 1);
      try { const m = JSON.parse(lineStr); waiting.get(m.id)?.(m); } catch (_) {}
    }
  });
  const request = (method, params) => new Promise((resolve) => {
    const myId = ++id;
    waiting.set(myId, resolve);
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: myId, method, params }) + '\n');
  });
  const call = async (name, args = {}) => {
    const m = await request('tools/call', { name, arguments: args });
    const content = m.result.content;
    return { text: content.filter(c => c.type === 'text').map(c => c.text).join('\n'), content, isError: m.result.isError };
  };
  return { proc, request, call };
}

const results = [];
function check(name, ok, detail = '') {
  results.push(ok);
  console.log(`${ok ? '✅ PASS' : '❌ FAIL'} ${name}${detail ? `\n      └─ ${detail.replace(/\n/g, '\n         ')}` : ''}`);
}

async function main() {
  console.log('🧪 CO-BROWSING END-TO-END (MCP server ↔ CDP ↔ throwaway headless browser)\n');
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: getTestBrowserExe(), headless: true, args: [`--remote-debugging-port=${CDP_PORT}`] });
  const userPage = await (await browser.newContext()).newPage(); // separate context = a stand-in "user" handle
  await userPage.goto('about:blank');
  const mcp = mcpClient();
  let r;

  try {
    const init = await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 't', version: '1' } });
    check('Server ships usage instructions to any MCP client', (init.result.instructions || '').includes('brave_act'));

    r = await mcp.call('brave_tabs', { action: 'new', url: BASE });
    const agentTab = (r.text.match(/opened (t\d+)/) || [])[1];
    check('New tab opens in background and returns its observation', Boolean(agentTab) && r.text.includes('button "Save"'), r.text.split('\n').slice(0, 3).join('\n'));

    r = await mcp.call('brave_observe');
    const saveRef = (r.text.match(/(e\d+) button "Save"/) || [])[1];
    check('Observe lists elements compactly', Boolean(saveRef) && r.text.length < 900, `${r.text.length} chars`);

    r = await mcp.call('brave_observe');
    check('Refs are stable across observations', r.text.includes(`${saveRef} button "Save"`));

    r = await mcp.call('brave_act', { steps: [
      { action: 'type', ref: 'Name', text: 'Ada' },
      { action: 'select', ref: 'combobox:', value: 'Admin' },
      { action: 'click', ref: 'button:Save' }
    ] });
    check('Batch by label (no refs needed) + delta reply', /text: "Saved Ada as a"/.test(r.text) && /\+ e\d+ button "Undo"/.test(r.text) && !r.text.includes('button "Delete"'), r.text);

    r = await mcp.call('brave_act', { action: 'click', ref: 'Delete' });
    check('Agent-triggered confirm is answered and reported', r.text.includes('dialog accepted: "Delete it?"') && r.text.includes('text: "Deleted"'), r.text);

    r = await mcp.call('brave_act', { action: 'click', ref: 'Load' });
    check('Settle waits for XHR/fetch and reports new text', r.text.includes('text: "Loaded 3"'), r.text);

    r = await mcp.call('brave_read', { network: true });
    const n = (r.text.match(/^n(\d+) GET 200 json/m) || [])[1];
    check('Network mode lists the site JSON calls', Boolean(n), r.text);
    r = await mcp.call('brave_read', { response: Number(n) });
    check('Network response body is returned compactly', r.text.includes('{"items":[1,2,3],"total":3}'), r.text);

    r = await mcp.call('brave_read', { max: 1500 });
    const next = (r.text.match(/\[more: offset=(\d+)\]/) || [])[1];
    const r2 = next ? await mcp.call('brave_read', { max: 1500, offset: Number(next) }) : { text: '' };
    check('Reader pages long content with offset', Boolean(next) && r2.text.includes('chars ' + next), r.text.split('\n').slice(0, 2).join(' / '));

    r = await mcp.call('brave_act', { action: 'click', ref: 'Open modal' });
    check('Observation auto-limits to an open modal', /modal "Confirm"/.test(r.text) || /modal/.test((await mcp.call('brave_observe')).text), r.text);
    r = await mcp.call('brave_observe');
    check('Modal view hides background elements', r.text.includes('Close modal') && !r.text.includes('button "Load"'), r.text);
    await mcp.call('brave_act', { action: 'click', ref: 'Close modal' });

    // A dialog that opens AFTER the agent's action belongs to the user: never auto-answered.
    await mcp.call('brave_act', { action: 'click', ref: 'Later' });
    await new Promise(res => setTimeout(res, 1900));
    r = await mcp.call('brave_act', { action: 'click', ref: 'button:Save' });
    check("User's dialog is left open (not auto-dismissed)", r.text.includes('blocked by a dialog (alert: "Late alert")'), r.text);
    r = await mcp.call('brave_act', { action: 'dialog', accept: true });
    check('Agent can answer a dialog explicitly when asked', r.text.includes('accepted alert "Late alert"'), r.text.split('\n')[0]);

    r = await mcp.call('brave_act', { action: 'click', ref: 'link:Open other' });
    check('Popup from agent click becomes the agent tab', /opened new tab t\d+ \(now your tab\)/.test(r.text) && r.text.includes('Other button'), r.text);
    r = await mcp.call('brave_observe');
    check('Agent stays on the popup tab', r.text.includes('Other Page'));
    await mcp.call('brave_tabs', { action: 'switch', tab: agentTab });

    // The "user" brings another tab to the front; the agent must stay on its own tab.
    const otherUserTab = await userPage.context().newPage();
    await otherUserTab.goto(`${BASE}/other`);
    await otherUserTab.bringToFront();
    r = await mcp.call('brave_observe');
    check('Agent tab is sticky when the user switches tabs', r.text.includes('Cobrowse Bench'), r.text.split('\n')[0]);

    r = await mcp.call('brave_tabs');
    check('Tab list marks agent (@) and stable ids', new RegExp(`${agentTab}@`).test(r.text), r.text);

    // Stale ref: remove an element the agent has seen, then try to use it.
    r = await mcp.call('brave_observe');
    const undoRef = (r.text.match(/(e\d+) button "Undo"/) || [])[1];
    await mcp.call('brave_eval', { script: "document.querySelectorAll('button').forEach(b => { if (b.textContent === 'Undo') b.remove(); })" });
    r = await mcp.call('brave_act', { action: 'click', ref: undoRef });
    check('Stale ref fails safely and returns the current state', r.text.includes('no longer exists') && r.text.includes(`- ${undoRef}`), r.text);

    r = await mcp.call('brave_eval', { script: "const b = [...document.querySelectorAll('button')].map(x => x.textContent); return b.length;" });
    check('Eval accepts bodies with return', /^\d+$/.test(r.text.trim()), r.text);

    r = await mcp.call('brave_act', { steps: [{ action: 'wait', text: 'Loaded 3' }, { action: 'scroll', dir: 'down' }], observe: 'none' });
    check('Wait + scroll in one call', r.text.includes('waited for text "Loaded 3"') && r.text.includes('scroll down'), r.text);

    r = await mcp.call('brave_observe', { screenshot: true, labels: true });
    check('Screenshots are real MCP image blocks', r.content.some(c => c.type === 'image' && c.data.length > 1000));

    r = await mcp.call('brave_batch_act', { actions: [{ action: 'click', ref: 'button:Save' }] });
    const r3 = await mcp.call('brave_navigate', { url: `${BASE}/other` });
    check('Legacy tool names still work', r.text.startsWith('ok click') && r3.text.includes('Other button'), r3.text.split('\n')[0]);

    // Co-browsing guard: the user is typing in the agent's tab right now.
    await mcp.call('brave_navigate', { url: BASE });
    // A second CDP client plays the user, typing into the agent's own tab.
    const userView = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`, { noDefaults: true });
    userView.contexts().forEach(c => c.on('dialog', () => {}));
    const live = userView.contexts().flatMap(c => c.pages()).find(p => p.url() === `${BASE}/`);
    const typing = (async () => { for (let i = 0; i < 4; i++) { await live.keyboard.press('Shift'); await new Promise(res => setTimeout(res, 300)); } })();
    await new Promise(res => setTimeout(res, 100));
    const t0 = Date.now();
    r = await mcp.call('brave_act', { action: 'type', ref: 'Name', text: 'Bob', observe: 'none' });
    await typing;
    check('Agent waits while the user is typing in its tab', Date.now() - t0 >= 900 && r.text.startsWith('ok type'), `${Date.now() - t0}ms: ${r.text.split('\n')[0]}`);
  } catch (err) {
    check('No unexpected exception', false, err.stack);
  } finally {
    mcp.proc.kill();
    await browser.close();
    server.close();
  }

  const passed = results.filter(Boolean).length;
  console.log(`\n📊 ${passed}/${results.length} co-browsing checks passed`);
  process.exit(passed === results.length ? 0 : 1);
}

main();
