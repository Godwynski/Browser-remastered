import assert from 'assert';
import http from 'http';
import { WebSocket } from 'ws';
import { TelemetryServer } from '../src/telemetry-server.js';
import { ContentReader } from '../src/reader.js';
import { ActionEngine } from '../src/actions.js';
import { BrowserObserver } from '../src/observer.js';
import { StateVerifier } from '../src/verifier.js';
import { chromium } from 'playwright-core';
import { getTestBrowserExe } from './test-helper.js';

async function runAuditFixesTests() {
  console.log("🧪 Running Verification Tests for Audit Fixes...\n");

  // --- Test 1: Telemetry Server CSWSH & Payload Protection ---
  console.log("1. Testing Telemetry Server WebSocket Origin Check & Payload Limit...");
  const testPort = 8788;
  const server = new TelemetryServer(testPort);
  await server.start();

  // 1a. Evil origin WebSocket connection must be rejected
  const evilWsRejected = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}`, {
      headers: { origin: 'http://malicious-site.com' }
    });
    ws.on('unexpected-response', (req, res) => {
      resolve(res.statusCode === 403);
    });
    ws.on('open', () => {
      ws.close();
      resolve(false);
    });
    ws.on('error', () => resolve(true));
  });
  assert(evilWsRejected, "Untrusted origin WebSocket connection must be rejected with 403");
  console.log("   ✅ CSWSH Protection: Blocked untrusted Origin (403)");

  // 1b. Localhost origin WebSocket must succeed
  const localWsAccepted = await new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}`, {
      headers: { origin: 'http://localhost' }
    });
    ws.on('open', () => {
      ws.close();
      resolve(true);
    });
    ws.on('error', () => resolve(false));
  });
  assert(localWsAccepted, "Localhost origin WebSocket must be accepted");
  console.log("   ✅ Localhost Origin: Accepted successfully");

  // 1c. Payload size limit on POST
  const largeBody = 'a'.repeat(1.2 * 1024 * 1024);
  const largePayloadRejected = await new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: testPort,
      path: '/api/directives/submit',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, (res) => {
      resolve(res.statusCode === 413);
    });
    req.on('error', () => resolve(true));
    req.write(largeBody);
    req.end();
  });
  assert(largePayloadRejected, "Oversized POST payload (>1MB) must be rejected with 413");
  console.log("   ✅ Payload Guard: Rejected >1MB payload with 413");
  server.stop();

  // --- Test 2: ContentReader Article Header Preservation ---
  console.log("\n2. Testing ContentReader Article Header Preservation...");
  const browserExe = getTestBrowserExe();
  const browser = await chromium.launch({
    executablePath: browserExe,
    headless: true,
    args: ['--no-sandbox']
  });
  const page = await browser.newPage();
  await page.setContent(`
    <html>
      <body>
        <header><nav>Site Navigation Masthead</nav></header>
        <article>
          <header>
            <h1>Critical Research Report</h1>
            <p>Published October 2026</p>
          </header>
          <p>This is the core content of the article.</p>
        </article>
      </body>
    </html>
  `);

  const reader = new ContentReader();
  const article = await reader.extract(page);
  assert(article.markdown.includes("Critical Research Report"), "Article <header> <h1> must NOT be stripped");
  assert(!article.markdown.includes("Site Navigation Masthead"), "Body top-level <header> must be stripped");
  console.log("   ✅ Article <header> headline preserved, site masthead stripped");

  // --- Test 3: ActionEngine Option Value Check ---
  console.log("\n3. Testing ActionEngine select_option with empty string...");
  const observer = new BrowserObserver();
  const verifier = new StateVerifier(observer);
  const actions = new ActionEngine(observer, verifier);

  await page.setContent(`
    <html>
      <body>
        <select id="country">
          <option value="">-- Choose Country --</option>
          <option value="us">United States</option>
        </select>
      </body>
    </html>
  `);

  const obs = await observer.observe(page);
  const selectRef = obs.elements.find(e => e.domMeta && e.domMeta.id === 'country');

  // Should succeed without throwing "Parameter 'value' is required"
  const receipt = await actions.execute(page, {
    action: 'select_option',
    ref: selectRef.ref,
    obs_id: obs.obs_id,
    value: ""
  });
  assert(receipt.executed, "Selecting empty string value must succeed");
  console.log("   ✅ select_option with empty string value succeeded");

  // --- Test 4: Cross-Tab Observation Isolation ---
  console.log("\n4. Testing Cross-Tab Observation Isolation...");
  const pageA = await browser.newPage();
  const pageB = await browser.newPage();

  await pageA.setContent(`<html><body><input id="input-a" value="initialA" /></body></html>`);
  await pageB.setContent(`<html><body><button id="btn-b">Button B</button></body></html>`);

  const obsA = await observer.observe(pageA);
  const obsB = await observer.observe(pageB);

  // Both should have their own obsId and own element maps preserved on the page
  assert.notStrictEqual(obsA.obs_id, obsB.obs_id, "Distinct observations must have distinct obs_ids");
  assert.strictEqual(pageA._currentObservation.obsId, obsA.obs_id, "pageA must cache obsA");
  assert.strictEqual(pageB._currentObservation.obsId, obsB.obs_id, "pageB must cache obsB");

  // Acting on pageA should resolve pageA's ref without interference from pageB
  const refA = obsA.elements[0].ref;
  const receiptA = await actions.execute(pageA, {
    action: 'type',
    ref: refA,
    obs_id: obsA.obs_id,
    text: 'updatedA'
  });
  assert(receiptA.executed, "Action on tab A must execute successfully using tab A's cached observation");
  const valA = await pageA.inputValue('#input-a');
  assert.strictEqual(valA, 'updatedA', "Value in tab A input must be updated");
  console.log("   ✅ Cross-tab observation isolation verified: Tab A and Tab B keep independent refs");

  // --- Test 5: Typing with clear: false (Append Mode) ---
  console.log("\n5. Testing typing with clear: false (Append Mode)...");
  await pageA.setContent(`<html><body><input id="append-input" value="Hello" /></body></html>`);
  const obsAppend = await observer.observe(pageA);
  const appendRef = obsAppend.elements[0].ref;
  await actions.execute(pageA, {
    action: 'type',
    ref: appendRef,
    obs_id: obsAppend.obs_id,
    text: ' World',
    clear: false
  });
  const appendedVal = await pageA.inputValue('#append-input');
  assert.strictEqual(appendedVal, 'Hello World', "Typing with clear: false must append text");
  console.log("   ✅ Typing with clear: false successfully appended text without clearing");

  // --- Test 6: Background Tab Fast Stabilization ---
  console.log("\n6. Testing Background Tab Fast Stabilization...");
  await pageA.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  });
  const tStart = Date.now();
  const before = await verifier.captureBeforeState(pageA);
  const after = await verifier.captureAfterState(pageA, before);
  const duration = Date.now() - tStart;
  assert(duration < 500, `Background tab stabilization took ${duration}ms, must be <500ms`);
  console.log(`   ✅ Background tab stabilization completed in ${duration}ms without hanging on rAF`);

  // --- Test 7: Download and Dialog Tracking in Receipt ---
  console.log("\n7. Testing Download & Dialog Receipt Tracking...");
  pageA._lastDownload = { filename: 'report.pdf', path: 'C:/fake/report.pdf', timestamp: Date.now() };
  pageA._lastDialog = { message: 'Are you sure?', type: 'confirm', timestamp: Date.now() };
  const beforeDl = { lastDownloadTime: pageA._lastDownload.timestamp - 10, lastDialogTime: pageA._lastDialog.timestamp - 10 };
  const dlReceipt = actions.verifier.createReceipt({ type: 'click' }, beforeDl, {}, {
    download: pageA._lastDownload,
    dialogMessage: pageA._lastDialog.message
  });
  assert(dlReceipt.changes.some(c => c.includes('report.pdf')), "Download must be reported in changes");
  assert(dlReceipt.changes.some(c => c.includes('Are you sure?')), "Dialog must be reported in changes");
  console.log("   ✅ Download and dialog events correctly captured in Action Receipts");

  await pageA.close();
  await pageB.close();
  await browser.close();
  console.log("\n🎉 ALL AUDIT FIXES VERIFIED SUCCESSFULLY!");
}

runAuditFixesTests().catch(err => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
