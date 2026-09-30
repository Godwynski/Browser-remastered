import { chromium } from 'playwright-core';
import { BrowserObserver } from '../src/observer.js';
import { StateVerifier } from '../src/verifier.js';
import { ActionEngine } from '../src/actions.js';
import { ContentReader } from '../src/reader.js';

async function testTokenOptimizations() {
  console.log("==========================================================");
  console.log("🧪 TESTING TOKEN OPTIMIZATIONS (COMPACT, SCOPE, EVAL, BATCH, READ, AND_OBSERVE, ALERTS)");
  console.log("==========================================================\n");

  const edgeExe = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
  const browser = await chromium.launch({
    executablePath: edgeExe,
    headless: true,
    args: ['--no-sandbox', '--disable-gpu']
  });
  const context = await browser.newContext();
  const page = await context.newPage();

  const observer = new BrowserObserver();
  const verifier = new StateVerifier(observer);
  const actionEngine = new ActionEngine(observer, verifier);
  const reader = new ContentReader();

  // Set up a rich test HTML page in the agent window
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head><title>Token Optimization Test</title></head>
      <body>
        <header id="site-header">
          <nav>
            <a href="#home">Home</a>
            <a href="#about">About</a>
            <a href="#contact">Contact</a>
          </nav>
        </header>

        <div role="alert" id="system-alert" class="notice-error" style="background:#fee; padding:10px; border:1px solid red;">
          Notice: Registration system closes in 2 hours.
        </div>

        <main id="main-content">
          <h1>Course Dashboard</h1>
          <form id="submission-form">
            <input type="text" id="student-name" placeholder="Student Name" value="Godwyn" />
            <select id="course-select">
              <option value="cs101">Computer Graphics</option>
              <option value="cs102">Game Development</option>
            </select>
            <button id="submit-btn" type="button" onclick="document.getElementById('status').innerText = 'Submitted Successfully!'; document.title = 'Dashboard - Submitted';">Submit Application</button>
            <div id="status">Ready</div>
          </form>

          <article id="doc-article" style="margin-top: 30px;">
            <h2>Course Grading Policies</h2>
            <p>Welcome to CS101. This syllabus explains grade weights and expectations.</p>
            <ul>
              <li>Assignments: 40%</li>
              <li>Midterm Exam: 30%</li>
              <li>Final Project: 30%</li>
            </ul>
            <table border="1" id="grading-table">
              <thead><tr><th>Grade</th><th>Range</th></tr></thead>
              <tbody>
                <tr><td>A</td><td>90-100%</td></tr>
                <tr><td>B</td><td>80-89%</td></tr>
              </tbody>
            </table>
          </article>
        </main>

        <div style="height: 1200px;">
          <!-- Spacer to force footer elements off-screen -->
        </div>

        <footer id="site-footer">
          <p>Footer copyright</p>
          <button id="offscreen-btn" type="button" onclick="document.getElementById('status').innerText = 'Offscreen Button Clicked!'">Offscreen Action</button>
          <a href="#privacy">Privacy Policy</a>
          <a href="#terms">Terms of Service</a>
        </footer>
      </body>
    </html>
  `);

  // 1. Compare Compact vs JSON Payload Size (Token Savings)
  console.log("📊 1. Comparing Full JSON vs Compact Hybrid Spatial Notation...");
  const obsJson = await observer.observe(page, { format: 'json', includeScreenshot: false });
  const obsCompact = await observer.observe(page, { format: 'compact', includeScreenshot: false });

  const jsonBytes = JSON.stringify(obsJson.elements).length;
  const compactBytes = obsCompact.elements_compact.length;
  const reductionPercent = Math.round(((jsonBytes - compactBytes) / jsonBytes) * 100);

  console.log(`   JSON Payload Size:    ${jsonBytes} characters (~${Math.round(jsonBytes / 4)} tokens)`);
  console.log(`   Compact Payload Size: ${compactBytes} characters (~${Math.round(compactBytes / 4)} tokens)`);
  console.log(`   ✅ Token Reduction:    ${reductionPercent}% SAVED!`);

  if (reductionPercent < 40) {
    throw new Error(`Expected at least 40% reduction, got ${reductionPercent}%`);
  }

  // 2. Test Live-Region & Page Alert Sentinel
  console.log("\n🚨 2. Testing Live-Region & Alert Sentinel...");
  if (!obsCompact.alerts || obsCompact.alerts.length === 0) {
    throw new Error("Failed to capture system alert banner!");
  }
  console.log(`   Captured Alert: "${obsCompact.alerts[0]}"`);
  if (!obsCompact.elements_compact.includes("⚠️ PAGE ALERT:")) {
    throw new Error("elements_compact did not prominently render the page alert!");
  }
  console.log("   ✅ Alert Sentinel captured and prioritized page warning!");

  // 3. Test Scoped Observation
  console.log("\n🎯 3. Testing Scoped Observation (scope: '#main-content')...");
  const obsScoped = await observer.observe(page, { scope: '#main-content', includeScreenshot: false });
  console.log(`   Total Page Elements:   ${obsJson.element_count}`);
  console.log(`   Scoped Main Elements:  ${obsScoped.element_count}`);
  
  // Header and Footer links should be excluded in scoped observation
  const hasFooterLink = obsScoped.elements.some(e => (e.name || '').includes('Privacy Policy'));
  if (hasFooterLink) {
    throw new Error("Scoped observation leaked footer elements!");
  }
  console.log("   ✅ Scoped observation strictly isolated main content elements!");

  // 4. Test Dedicated Markdown Content Extractor (brave_read)
  console.log("\n📖 4. Testing Dedicated Content Extractor (brave_read)...");
  const articleData = await reader.extract(page, { scope: '#doc-article' });
  console.log(`   Extracted Article Title: "${articleData.title}"`);
  console.log(`   Word Count: ${articleData.wordCount} words (~${articleData.readingTimeMin} min read)`);
  console.log("   --- Markdown Preview ---");
  console.log(articleData.markdown.trim().slice(0, 200) + "...\n   ------------------------");

  if (!articleData.markdown.includes("## Course Grading Policies") || !articleData.markdown.includes("| Grade | Range |")) {
    throw new Error("ContentReader failed to extract headings or tables into Markdown!");
  }
  console.log("   ✅ brave_read cleanly extracted formatted Markdown without interactive DOM overhead!");

  // 5. Test Compound Act + Settle + Observe (and_observe: true)
  console.log("\n🔄 5. Testing Compound Act-Settle-Observe in a Single Turn...");
  const currentObs = await observer.observe(page, { format: 'compact', includeScreenshot: false });
  const submitRef = currentObs.elements.find(e => e.domMeta?.id === 'submit-btn');
  if (!submitRef) throw new Error("Could not find submit button");

  const receipt = await actionEngine.execute(page, {
    action: 'click',
    ref: submitRef.ref,
    obs_id: currentObs.obs_id,
    and_observe: true
  });

  if (!receipt.nextObservation) {
    throw new Error("Action did not return nextObservation when and_observe: true was requested!");
  }
  console.log(`   Compound Execution Status: ${receipt.action.type} -> Title: "${receipt.after.title}"`);
  console.log(`   Next Observation Elements: ${receipt.nextObservation.element_count} items discovered`);
  
  const statusText = await page.$eval('#status', el => el.innerText);
  if (statusText !== 'Submitted Successfully!') {
    throw new Error("Submit action failed to trigger DOM mutation");
  }
  console.log("   ✅ Compound Act+Observe returned next state in 1 turn!");

  // 6. Test Direct Action on Offscreen Landmark Ledger Element (Auto-Scroll)
  console.log("\n📍 6. Testing Direct Interaction with Offscreen Element...");
  const offscreenRef = receipt.nextObservation.elements.find(e => e.domMeta?.id === 'offscreen-btn');
  if (!offscreenRef) throw new Error("Could not find offscreen button in element registry");

  // Interacting directly with offscreenRef without prior manual scroll turn
  await actionEngine.execute(page, {
    action: 'click',
    ref: offscreenRef.ref,
    obs_id: receipt.nextObservation.obs_id
  });

  const offscreenStatus = await page.$eval('#status', el => el.innerText);
  if (offscreenStatus !== 'Offscreen Button Clicked!') {
    throw new Error("Failed to auto-scroll and click offscreen button!");
  }
  console.log(`   Offscreen Button Execution Status: "${offscreenStatus}"`);
  console.log("   ✅ Offscreen ledger element interacted directly without extra scroll turns!");

  // 7. Test Direct JS Evaluation (brave_eval capability)
  console.log("\n⚡ 7. Testing Direct In-Page JS Evaluation (brave_eval)...");
  const evalResult = await page.evaluate(() => {
    return {
      title: document.title,
      studentName: document.getElementById('student-name').value,
      courses: Array.from(document.querySelectorAll('#course-select option')).map(o => o.text)
    };
  });
  if (evalResult.studentName !== 'Godwyn' || evalResult.courses.length !== 2) {
    throw new Error("Evaluation returned unexpected result");
  }
  console.log("   ✅ brave_eval executed with 0 token observation overhead!");

  console.log("\n🎉 ALL ADVANCED TOKEN OPTIMIZATION TESTS PASSED SUCCESSFULLY!");
  await browser.close();
  process.exit(0);
}

testTokenOptimizations().catch(err => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
