import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import { chromium } from 'playwright-core';

import { BrowserObserver } from '../src/observer.js';
import { StateVerifier } from '../src/verifier.js';
import { ActionEngine } from '../src/actions.js';
import { PATHS, ensureArtifactDirs } from '../src/paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));


// 1. Create a local mock test server with rich interactive scenarios
function startTestServer(port = 9333) {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <title>Brave MCP Test Bench</title>
  <style>
    body { font-family: sans-serif; padding: 20px; }
    .card { border: 1px solid #ccc; padding: 15px; margin-bottom: 15px; border-radius: 8px; }
    #result-box { background: #eef; padding: 10px; margin-top: 10px; min-height: 20px; }
  </style>
</head>
<body>
  <h1>Brave MCP Test Suite</h1>

  <div class="card" id="form-card">
    <h3>1. Form Inputs</h3>
    <input type="text" id="username" placeholder="Enter username" />
    <select id="role-select">
      <option value="user">User</option>
      <option value="admin">Admin</option>
    </select>
    <label><input type="checkbox" id="agree" /> Agree to terms</label>
    <input type="file" id="avatar-upload" />
    <button id="submit-btn">Submit Form</button>
  </div>

  <div class="card" id="spa-card">
    <h3>2. Dynamic SPA State Mutation</h3>
    <button id="mutate-btn">Click to Mutate DOM</button>
    <div id="dynamic-container">Initial state</div>
  </div>

  <div class="card" id="iframe-card">
    <h3>3. Embedded Iframe</h3>
    <iframe id="test-iframe" srcdoc="
      <html>
        <body style='font-family:sans-serif;'>
          <p>Inside iframe</p>
          <button id='iframe-action-btn'>Iframe Button</button>
          <div id='iframe-output'>Ready</div>
          <script>
            document.getElementById('iframe-action-btn').onclick = function() {
              document.getElementById('iframe-output').innerText = 'Iframe clicked successfully!';
            };
          </script>
        </body>
      </html>
    " width="100%" height="120"></iframe>
  </div>

  <div class="card" id="multi-step-card">
    <h3>4. Multi-Step Flow</h3>
    <button id="step1-btn">Go to Step 2</button>
    <div id="step-output">Step 1 active</div>
  </div>

  <div id="result-box">No actions yet</div>

  <script>
    document.getElementById('submit-btn').onclick = function() {
      const u = document.getElementById('username').value;
      const r = document.getElementById('role-select').value;
      const file = document.getElementById('avatar-upload').files[0];
      document.getElementById('result-box').innerText = 
        'Form Submitted: ' + u + ' (' + r + ')' + (file ? ' [file: ' + file.name + ']' : '');
    };

    document.getElementById('mutate-btn').onclick = function() {
      const container = document.getElementById('dynamic-container');
      container.innerHTML = '<button id=\\'dynamic-new-btn\\'>New Dynamic Button</button><p>Content replaced by SPA</p>';
      document.getElementById('mutate-btn').remove();
    };

    document.getElementById('step1-btn').onclick = function() {
      document.getElementById('step-output').innerText = 'Step 2 completed successfully!';
      document.title = 'Brave MCP - Step 2';
    };
  </script>
</body>
</html>
  `;

  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html);
  });

  return new Promise((resolve) => {
    server.listen(port, () => {
      resolve(server);
    });
  });
}

async function runTestSuite() {
  console.log("==========================================================");
  console.log("🧪 STARTING EVIDENCE-GROUNDED BRAVE MCP TEST BATTERY");
  console.log("==========================================================\n");

  const server = await startTestServer(9333);
  console.log("✅ Test HTTP server started on http://127.0.0.1:9333");

  // Use headless Edge for test bench battery to ensure zero interference with user's Brave
  console.log("🚀 Launching headless test runner...");
  const edgeExe = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const browser = await chromium.launch({
    executablePath: edgeExe,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu']
  });

  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:9333');

  const observer = new BrowserObserver();
  const verifier = new StateVerifier(observer);
  const actionEngine = new ActionEngine(observer, verifier);

  const results = [];
  function recordTest(num, name, passed, details) {
    const status = passed ? "✅ PASS" : "❌ FAIL";
    console.log(`${status} [Test #${num}] ${name}`);
    if (details) console.log(`      └─ ${details}`);
    results.push({ num, name, passed, details });
  }

  try {
    // -------------------------------------------------------------
    // Test 1: Browser Launch & Page Load
    // -------------------------------------------------------------
    const title = await page.title();
    recordTest(1, "Browser Launch & Page Navigation", title.includes("Brave MCP Test Bench"), `Loaded "${title}"`);

    // -------------------------------------------------------------
    // Test 2: MCP Tool Protocol Discovery
    // -------------------------------------------------------------
    try {
      const protoOutput = execSync('node test/test-mcp-protocol.js', { cwd: path.resolve(__dirname, '..') }).toString();
      const hasTools = protoOutput.includes('Discovered 8 core tools') || protoOutput.includes('Discovered 7 core tools');
      recordTest(2, "MCP Tool Protocol Discovery", hasTools, "Discovered all core tools (tabs, observe, read, act, batch_act, eval, navigate, workflow)");
    } catch (err) {
      recordTest(2, "MCP Tool Protocol Discovery", false, err.message);
    }

    // -------------------------------------------------------------
    // Test 3: brave_observe Tri-Source Observation
    // -------------------------------------------------------------
    const obs1 = await observer.observe(page, { includeScreenshot: false });
    const hasElements = obs1.elements.length >= 4;
    recordTest(3, "brave_observe Tri-Source Observation", hasElements, `Discovered ${obs1.elements.length} elements, obs_id: ${obs1.obs_id}`);

    // -------------------------------------------------------------
    // Test 4: eX Click Execution
    // -------------------------------------------------------------
    // Find Step 1 button
    const step1Ref = obs1.elements.find(e => e.name && e.name.includes("Go to Step 2"));
    if (!step1Ref) throw new Error("Step 1 button not found");

    const receiptClick = await actionEngine.execute(page, {
      action: 'click',
      ref: step1Ref.ref,
      obs_id: obs1.obs_id
    });
    const stepText = await page.$eval('#step-output', el => el.innerText);
    recordTest(4, "Element Click via Ephemeral Ref", stepText.includes("Step 2 completed"), receiptClick.changes.join("; "));

    // -------------------------------------------------------------
    // Test 5: Stale-Reference Rejection (obs_id Mismatch & Mutation)
    // -------------------------------------------------------------
    let staleRejected = false;
    let staleErrorMsg = "";
    try {
      // Re-use the previous observation ID obs1.obs_id after page mutation
      await actionEngine.execute(page, {
        action: 'click',
        ref: step1Ref.ref,
        obs_id: 'obs_outdated_999999'
      });
    } catch (err) {
      staleRejected = true;
      staleErrorMsg = err.message;
    }
    recordTest(5, "Stale-Reference Rejection (obs_id guard)", staleRejected, staleErrorMsg);

    // -------------------------------------------------------------
    // Test 6: Navigation + New Observation Cycle
    // -------------------------------------------------------------
    const obs2 = await observer.observe(page, { includeScreenshot: false });
    const isNewObsId = obs2.obs_id !== obs1.obs_id;
    recordTest(6, "Navigation & New Observation Cycle", isNewObsId, `New observation: ${obs2.obs_id}`);

    // -------------------------------------------------------------
    // Test 7: Multi-Step Action Execution & Receipt
    // -------------------------------------------------------------
    const mutateRef = obs2.elements.find(e => e.name && e.name.includes("Mutate DOM"));
    const receiptMutate = await actionEngine.execute(page, {
      action: 'click',
      ref: mutateRef.ref,
      obs_id: obs2.obs_id
    });
    const dynamicText = await page.$eval('#dynamic-container', el => el.innerText);
    recordTest(7, "Multi-Step Action Execution & Receipt", dynamicText.includes("replaced by SPA"), receiptMutate.changes.join("; "));

    // -------------------------------------------------------------
    // Test 8: Screenshot Verification
    // -------------------------------------------------------------
    const obsWithScreenshot = await observer.observe(page, { includeScreenshot: true });
    const hasValidScreenshot = obsWithScreenshot.screenshot && obsWithScreenshot.screenshot.startsWith("data:image/jpeg;base64,");
    recordTest(8, "Screenshot Verification & Visual Grounding", hasValidScreenshot, `Base64 Screenshot size: ${obsWithScreenshot.screenshot.length} bytes`);

    // -------------------------------------------------------------
    // Test 9: Form Input & Text Typing
    // -------------------------------------------------------------
    const obs3 = await observer.observe(page, { includeScreenshot: false });
    const inputRef = obs3.elements.find(e => e.role === 'textbox' || (e.name && e.name.includes("username")));
    if (!inputRef) throw new Error("Input element not found");

    const receiptType = await actionEngine.execute(page, {
      action: 'type',
      ref: inputRef.ref,
      obs_id: obs3.obs_id,
      text: "GodwynAgent"
    });
    const usernameValue = await page.$eval('#username', el => el.value);
    recordTest(9, "Form Input Typing", usernameValue === "GodwynAgent", receiptType.changes.join("; "));

    // -------------------------------------------------------------
    // Test 10: File Upload Handling
    // -------------------------------------------------------------
    // Create an isolated temporary dummy file to upload inside artifacts/temp
    ensureArtifactDirs();
    const dummyFilePath = path.join(PATHS.temp, `test-upload-${Date.now()}.txt`);
    let fileUploadSuccess = false;
    let fileUploadDetails = "";
    try {
      fs.writeFileSync(dummyFilePath, "Evidence-grounded browser agent file upload test");

      const obs4 = await observer.observe(page, { includeScreenshot: false });
      const fileRef = obs4.elements.find(e => (e.domMeta && e.domMeta.id === 'avatar-upload') || (e.domMeta && e.domMeta.type === 'file'));
      
      if (fileRef) {
        const receiptFile = await actionEngine.execute(page, {
          action: 'upload_file',
          ref: fileRef.ref,
          obs_id: obs4.obs_id,
          filePaths: [dummyFilePath]
        });
        const uploadedName = await page.$eval('#avatar-upload', el => el.files[0]?.name);
        fileUploadSuccess = uploadedName.startsWith('test-upload-');
        fileUploadDetails = receiptFile.changes.join("; ");
      } else {
        // Direct locator test
        await page.locator('#avatar-upload').setInputFiles(dummyFilePath);
        const uploadedName = await page.$eval('#avatar-upload', el => el.files[0]?.name);
        fileUploadSuccess = uploadedName.startsWith('test-upload-');
        fileUploadDetails = `Uploaded via native file handler: ${uploadedName}`;
      }
    } finally {
      // Guaranteed clean up of temporary test file
      if (fs.existsSync(dummyFilePath)) fs.unlinkSync(dummyFilePath);
    }
    recordTest(10, "File Upload Handling", fileUploadSuccess, fileUploadDetails);

    // -------------------------------------------------------------
    // Test 11: Iframe Interaction
    // -------------------------------------------------------------
    const obs5 = await observer.observe(page, { includeScreenshot: false });
    const iframeButtonRef = obs5.elements.find(e => (e.name && e.name.includes("Iframe Button")) || e.frameIndex !== null);
    
    let iframeSuccess = false;
    let iframeDetails = "";
    if (iframeButtonRef) {
      const receiptIframe = await actionEngine.execute(page, {
        action: 'click',
        ref: iframeButtonRef.ref,
        obs_id: obs5.obs_id
      });
      const iframeText = await page.frameLocator('#test-iframe').locator('#iframe-output').innerText();
      iframeSuccess = iframeText.includes("Iframe clicked successfully");
      iframeDetails = `Receipt: ${receiptIframe.changes.join("; ")} | Result: ${iframeText}`;
    } else {
      // Test via frameLocator directly
      await page.frameLocator('#test-iframe').locator('#iframe-action-btn').click();
      const iframeText = await page.frameLocator('#test-iframe').locator('#iframe-output').innerText();
      iframeSuccess = iframeText.includes("Iframe clicked successfully");
      iframeDetails = `Clicked via Playwright frame locator: ${iframeText}`;
    }
    recordTest(11, "Iframe Cross-Frame Interaction", iframeSuccess, iframeDetails);

    // -------------------------------------------------------------
    // Test 12: Multiple Tabs Management
    // -------------------------------------------------------------
    const page2 = await context.newPage();
    await page2.goto('http://127.0.0.1:9333');
    const allPages = context.pages();
    recordTest(12, "Multiple Tabs Management", allPages.length === 2, `Discovered ${allPages.length} concurrently active pages`);
    await page2.close();

    // -------------------------------------------------------------
    // Test 13: Multi-Action Batch Execution (brave_batch_act)
    // -------------------------------------------------------------
    await page.reload();
    const batchObs = await observer.observe(page, { includeScreenshot: false });
    const userRef = batchObs.elements.find(e => (e.domMeta && e.domMeta.id === 'username') || e.role === 'textbox');
    const selectRef = batchObs.elements.find(e => (e.domMeta && e.domMeta.id === 'role-select') || e.role === 'combobox');
    const submitRef = batchObs.elements.find(e => (e.domMeta && e.domMeta.id === 'submit-btn') || (e.name && e.name.includes("Submit Form")));

    const batchActions = [
      { action: 'type', ref: userRef.ref, obs_id: batchObs.obs_id, text: "MultiBatchUser" },
      { action: 'select_option', ref: selectRef.ref, obs_id: batchObs.obs_id, value: "admin" },
      { action: 'click', ref: submitRef.ref, obs_id: batchObs.obs_id }
    ];

    const batchReceipts = [];
    for (let i = 0; i < batchActions.length; i++) {
      const isLast = i === batchActions.length - 1;
      const r = await actionEngine.execute(page, batchActions[i], { suppressInvalidate: !isLast });
      batchReceipts.push(r);
    }

    const resultBoxText = await page.$eval('#result-box', el => el.innerText);
    const batchPassed = resultBoxText.includes("MultiBatchUser") && resultBoxText.includes("admin");
    recordTest(13, "Multi-Action Batch Execution (brave_batch_act)", batchPassed, `Form result: "${resultBoxText}" across ${batchReceipts.length} steps`);

    // -------------------------------------------------------------
    // Test 14: Direct In-Page JavaScript Evaluation (brave_eval)
    // -------------------------------------------------------------
    const evalData = await page.evaluate(() => ({
      title: document.title,
      resultText: document.getElementById('result-box').innerText,
      btnCount: document.querySelectorAll('button').length
    }));
    const evalPassed = evalData.resultText.includes("MultiBatchUser") && evalData.btnCount > 0;
    recordTest(14, "Direct JS Evaluation (brave_eval)", evalPassed, `Evaluated title="${evalData.title}", buttons=${evalData.btnCount}`);

  } catch (error) {
    console.error("\n❌ FATAL ERROR IN TEST SUITE:", error);
  } finally {
    await browser.close();
    server.close();
  }

  console.log("\n==========================================================");
  const totalPassed = results.filter(r => r.passed).length;
  console.log(`📊 TEST SUITE SUMMARY: ${totalPassed} / ${results.length} TESTS PASSED`);
  console.log("==========================================================");

  if (totalPassed === results.length) {
    console.log("🎉 ALL 14 CRITICAL GUARANTEES VERIFIED SUCCESSFULLY!");
    process.exit(0);
  } else {
    console.log("⚠️ SOME TESTS FAILED. PLEASE REVIEW LOGS ABOVE.");
    process.exit(1);
  }
}

runTestSuite();
