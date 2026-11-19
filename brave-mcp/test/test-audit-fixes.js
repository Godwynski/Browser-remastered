import assert from 'assert';
import { ContentReader } from '../src/reader.js';
import { ActionEngine } from '../src/actions.js';
import { BrowserObserver } from '../src/observer.js';
import { StateVerifier } from '../src/verifier.js';
import { chromium } from 'playwright-core';
import { getTestBrowserExe } from './test-helper.js';

async function runAuditFixesTests() {
  console.log("🧪 Running Verification Tests for Audit Fixes...\n");

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
  assert(pageA._bm.refs.has(obsA.elements[0].ref), "pageA must own its refs");
  assert(!pageB._bm.refs.has(obsA.elements[0].ref) || pageB._bm.refs.get(obsA.elements[0].ref).frame !== pageA._bm.refs.get(obsA.elements[0].ref).frame, "pageB must not resolve pageA refs");

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

  // --- Test 8: Fast In-Page Agent Caching & Intermediate Step Bypass ---
  console.log("\n8. Testing In-Page Agent Caching & Fast Intermediate Steps...");
  await pageA.setContent(`
    <html>
      <body>
        <input id="f1" placeholder="Field 1" />
        <input id="f2" placeholder="Field 2" />
        <button id="go" onclick="document.getElementById('out').innerText = document.getElementById('f1').value + ':' + document.getElementById('f2').value">Go</button>
        <div id="out"></div>
        <iframe src="https://googlesyndication.com/ad" style="width:1px;height:1px"></iframe>
      </body>
    </html>
  `);
  const obsFast = await observer.observe(pageA);
  const installed = await pageA.evaluate(() => Boolean(window[Symbol.for('brave-mcp')]?.call));
  assert(installed, "pageAgent must install A.call on window for zero-retransmission CDP calls");
  assert(obsFast.elements.every(e => e.frameIndex === null), "Ad iframes must be filtered out of observation");

  const tBatch = Date.now();
  await actions.execute(pageA, { action: 'type', ref: 'Field 1', text: 'Alpha' }, { fast: true });
  await actions.execute(pageA, { action: 'type', ref: 'Field 2', text: 'Beta' }, { fast: true });
  const rFinal = await actions.execute(pageA, { action: 'click', ref: 'button:Go' }, { observe: 'delta' });
  const batchMs = Date.now() - tBatch;
  const outText = await pageA.textContent('#out');
  assert.strictEqual(outText, 'Alpha:Beta', "Fast intermediate steps must populate fields and click button");
  assert(batchMs < 600, `Fast 3-step sequence took ${batchMs}ms, expected <600ms`);
  console.log(`   ✅ In-page agent cached, ad frames skipped, and 3-step sequence finished in ${batchMs}ms`);

  await pageA.close();
  await pageB.close();
  await browser.close();
  console.log("\n🎉 ALL AUDIT FIXES VERIFIED SUCCESSFULLY!");
}

runAuditFixesTests().catch(err => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
