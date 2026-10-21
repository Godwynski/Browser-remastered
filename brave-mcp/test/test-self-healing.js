import { chromium } from 'playwright-core';
import { BrowserObserver } from '../src/observer.js';
import { StateVerifier } from '../src/verifier.js';
import { ActionEngine } from '../src/actions.js';
import { getTestBrowserExe } from './test-helper.js';

async function testSelfHealing() {
  console.log("==========================================================");
  console.log("🧪 TESTING 5-TIER SELF-HEALING ACTION ENGINE");
  console.log("==========================================================\n");

  const edgeExe = getTestBrowserExe();
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

  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Self-Healing Test Bench</title>
        <style>
          body { font-family: sans-serif; padding-top: 100px; height: 2000px; }
          #fixed-header {
            position: fixed; top: 0; left: 0; right: 0; height: 80px;
            background: rgba(255, 0, 0, 0.7); z-index: 999;
          }
          #cookie-overlay {
            position: fixed; bottom: 0; left: 0; right: 0; height: 100px;
            background: #333; color: white; padding: 20px; z-index: 1000;
          }
          .pointer-none { pointer-events: none; }
        </style>
      </head>
      <body>
        <div id="fixed-header">Fixed Header (Obscures top elements)</div>

        <div id="cookie-overlay">
          <span>We use cookies</span>
          <button class="plain-cookie-banner" onclick="this.parentElement.remove()">Accept all</button>
        </div>

        <main>
          <!-- 1. Element obscured by sticky header when at top -->
          <div style="margin-top: 0px;">
            <button id="obscured-btn" onclick="document.getElementById('res1').innerText = 'Obscured Clicked!'">Obscured Button</button>
            <div id="res1">Pending</div>
          </div>

          <!-- 2. Element with pointer-events: none child icon wrapper -->
          <div style="margin-top: 50px;">
            <button id="complex-svg-btn" onclick="document.getElementById('res2').innerText = 'SVG Button Clicked!'">
              <span class="pointer-none" id="inner-span">Inner SVG Text</span>
            </button>
            <div id="res2">Pending</div>
          </div>

          <!-- 3. Contenteditable rich input -->
          <div style="margin-top: 50px;">
            <div id="rich-editor" contenteditable="true" style="border:1px solid #ccc; min-height:40px; padding:5px;"></div>
            <div id="res3">Pending</div>
          </div>

          <!-- 4. Element with ID starting with digits -->
          <div style="margin-top: 20px;">
            <button id="123-digit-btn" onclick="document.getElementById('res4').innerText = 'Digit ID Clicked!'">Digit Button</button>
            <div id="res4">Pending</div>
          </div>

          <!-- 5. Canvas with direct coordinates -->
          <div style="margin-top: 20px;">
            <canvas id="test-canvas" width="200" height="80" style="background:#eee;"></canvas>
            <div id="res5">Pending</div>
          </div>

          <!-- 6. Draggable target -->
          <div style="margin-top: 20px;">
            <div id="drag-box" style="width: 100px; height: 30px; background: #ddd; position: relative;">
              <div id="drag-handle" style="width: 20px; height: 30px; background: #666; position: absolute; left: 0;"></div>
            </div>
            <div id="res6">Pending</div>
          </div>
        </main>

        <script>
          document.getElementById('rich-editor').addEventListener('input', function() {
            document.getElementById('res3').innerText = 'Typed: ' + this.innerText;
          });

          const canvas = document.getElementById('test-canvas');
          canvas.addEventListener('click', (e) => {
            const rect = canvas.getBoundingClientRect();
            document.getElementById('res5').innerText = 'Canvas Clicked at [' + Math.round(e.clientX - rect.left) + ', ' + Math.round(e.clientY - rect.top) + ']';
          });

          let dragging = false;
          window.addEventListener('mousedown', (e) => {
            if (e.target.id === 'drag-handle') dragging = true;
          });
          window.addEventListener('mousemove', (e) => {
            if (dragging) {
              const box = document.getElementById('drag-box').getBoundingClientRect();
              const offset = Math.max(0, Math.min(80, e.clientX - box.left));
              document.getElementById('drag-handle').style.left = offset + 'px';
              document.getElementById('res6').innerText = 'Dragged to ' + Math.round(offset) + 'px';
            }
          });
          window.addEventListener('mouseup', () => { dragging = false; });
        </script>
      </body>
    </html>
  `);

  // Step 1: Observe page
  const obs = await observer.observe(page);
  console.log(`Discovered ${obs.elements.length} elements (obsId: ${obs.obs_id})`);

  // Test 1: Self-healing click on SVG button with pointer-events:none inner span
  console.log("\n🧪 Test 1: Clicking complex button with pointer-events: none child...");
  const svgBtnRef = obs.elements.find(e => e.domMeta?.id === 'complex-svg-btn');
  if (!svgBtnRef) throw new Error("Could not find complex-svg-btn");
  const r1 = await actionEngine.execute(page, {
    action: 'click',
    ref: svgBtnRef.ref,
    obs_id: obs.obs_id
  });
  const res2Text = await page.$eval('#res2', el => el.innerText);
  console.log(`   Receipt: ${r1.changes[0]} | Result: "${res2Text}"`);
  if (res2Text !== 'SVG Button Clicked!') throw new Error("Complex SVG button click failed");
  console.log("   ✅ PASS: Complex SVG button click succeeded!");

  // Test 2: Typing into contenteditable rich editor
  console.log("\n🧪 Test 2: Typing into contenteditable rich text container...");
  const editorRef = obs.elements.find(e => e.domMeta?.id === 'rich-editor');
  if (!editorRef) throw new Error("Could not find rich-editor");
  const r2 = await actionEngine.execute(page, {
    action: 'type',
    ref: editorRef.ref,
    obs_id: obs.obs_id,
    text: 'Automated System Note'
  });
  const res3Text = await page.$eval('#res3', el => el.innerText);
  console.log(`   Receipt: ${r2.changes[0]} | Result: "${res3Text}"`);
  if (!res3Text.includes('Automated System Note')) throw new Error("Contenteditable type failed");
  console.log("   ✅ PASS: Contenteditable typing succeeded!");

  // Test 3: Overlay auto-dismissal via text matching
  console.log("\n🧪 Test 3: Auto-dismissing cookie banner overlay via text matching...");
  const dismissed = await actionEngine.dismissOverlays(page);
  console.log(`   Overlay dismissed: ${dismissed}`);
  const overlayExists = await page.$('#cookie-overlay');
  if (overlayExists) throw new Error("Cookie overlay was not dismissed");
  console.log("   ✅ PASS: Overlay auto-dismissal succeeded!");

  // Test 4: Element with numeric ID
  console.log("\n🧪 Test 4: Clicking element with ID starting with digits...");
  const digitBtnRef = obs.elements.find(e => e.domMeta?.id === '123-digit-btn');
  if (!digitBtnRef) throw new Error("Could not find 123-digit-btn");
  const r4 = await actionEngine.execute(page, {
    action: 'click',
    ref: digitBtnRef.ref,
    obs_id: obs.obs_id
  });
  const res4Text = await page.$eval('#res4', el => el.innerText);
  console.log(`   Receipt: ${r4.changes[0]} | Result: "${res4Text}"`);
  if (res4Text !== 'Digit ID Clicked!') throw new Error("Numeric ID button click failed");
  console.log("   ✅ PASS: Element with numeric ID clicked successfully!");

  // Test 5: Direct coordinate click on Canvas element (DOM-less visual interaction)
  console.log("\n🧪 Test 5: Direct coordinate click on canvas...");
  const canvasBox = await page.locator('#test-canvas').boundingBox();
  if (!canvasBox) throw new Error("Could not get canvas bounding box");
  const targetX = Math.round(canvasBox.x + 40);
  const targetY = Math.round(canvasBox.y + 25);
  const r5 = await actionEngine.execute(page, {
    action: 'click',
    coordinate: [targetX, targetY]
  });
  const res5Text = await page.$eval('#res5', el => el.innerText);
  console.log(`   Receipt: ${r5.changes[0]} | Result: "${res5Text}"`);
  if (!res5Text.includes('Canvas Clicked at [40, 25]')) throw new Error("Canvas coordinate click failed");
  console.log("   ✅ PASS: Canvas direct coordinate click succeeded!");

  // Test 6: Drag action via coordinates
  console.log("\n🧪 Test 6: Drag action via coordinates...");
  const handleBox = await page.locator('#drag-handle').boundingBox();
  if (!handleBox) throw new Error("Could not get handle bounding box");
  const startX = Math.round(handleBox.x + handleBox.width / 2);
  const startY = Math.round(handleBox.y + handleBox.height / 2);
  const endX = startX + 45;
  const endY = startY;
  const r6 = await actionEngine.execute(page, {
    action: 'drag',
    startCoordinate: [startX, startY],
    endCoordinate: [endX, endY],
    steps: 10
  });
  const res6Text = await page.$eval('#res6', el => el.innerText);
  console.log(`   Receipt: ${r6.changes[0]} | Result: "${res6Text}"`);
  if (!res6Text.includes('Dragged to')) throw new Error("Drag action failed");
  console.log("   ✅ PASS: Drag action via coordinates succeeded!");

  // Test 7: Scoped screenshot visual token reduction
  console.log("\n🧪 Test 7: Scoped screenshot visual token reduction...");
  const fullObs = await observer.observe(page, { includeScreenshot: true });
  const scopedObs = await observer.observe(page, { includeScreenshot: true, screenshotScope: '#test-canvas' });
  const fullBytes = fullObs.screenshot ? Buffer.byteLength(fullObs.screenshot) : 0;
  const scopedBytes = scopedObs.screenshot ? Buffer.byteLength(scopedObs.screenshot) : 0;
  const savingsPercent = Math.round((1 - scopedBytes / fullBytes) * 100);
  console.log(`   Full Viewport Screenshot: ${fullBytes} bytes`);
  console.log(`   Scoped Element Screenshot: ${scopedBytes} bytes (${savingsPercent}% token savings)`);
  if (scopedBytes >= fullBytes || scopedBytes === 0) throw new Error("Scoped screenshot token reduction failed");
  console.log("   ✅ PASS: Scoped screenshot achieved " + savingsPercent + "% token savings!");

  console.log("\n🎉 ALL UNIVERSAL INTERACTION & SELF-HEALING ENGINE GUARANTEES VERIFIED SUCCESSFULLY!\n");
  await browser.close();
}

testSelfHealing().catch(err => {
  console.error("❌ Test failed:", err);
  process.exit(1);
});
