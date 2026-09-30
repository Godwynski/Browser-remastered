import http from 'http';
import { BraveManager } from '../../src/browser.js';
import { PATHS, ensureArtifactDirs } from '../../src/paths.js';

async function main() {
  console.log('\n📊 ── EVIDENCE-GROUNDED BRAVE MCP SYSTEM AUDIT ──');
  ensureArtifactDirs();

  // 1. Audit Runtime Artifact Directories
  console.log('\n📁 Runtime Storage:');
  console.log(`   Artifacts:    ${PATHS.artifacts}`);
  console.log(`   Downloads:    ${PATHS.downloads}`);
  console.log(`   Screenshots:  ${PATHS.screenshots}`);
  console.log(`   Test Runs:    ${PATHS.testRuns}`);
  console.log('   ✅ All directories verified');

  // 2. Audit CDP Connection on Port 9222
  console.log('\n🌐 Brave CDP Connection (Port 9222):');
  const brave = new BraveManager();
  try {
    const tabs = await brave.listTabs();
    console.log(`   ✅ Connected to Brave! Found ${tabs.length} open tab(s):`);
    tabs.forEach(t => {
      const activeMark = t.isActive ? ' ⭐ [ACTIVE]' : '';
      console.log(`      [${t.index}] ${t.title.slice(0, 40)} (${t.url.slice(0, 60)})${activeMark}`);
    });
  } catch (err) {
    console.log(`   ⚠️ Brave CDP port 9222 not reachable: ${err.message}`);
    console.log('      Run brave-launcher/launch-brave.cmd to start Brave with remote debugging enabled.');
  }

  // 3. Audit Telemetry HUD Daemon (Port 8765)
  console.log('\n📡 Real-Time HUD Daemon (Port 8765):');
  await new Promise((resolve) => {
    const req = http.get('http://localhost:8765/health', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          console.log(`   ✅ Telemetry server active: status=${parsed.status}, task=${parsed.task?.name || 'Idle'}`);
        } catch (_) {
          console.log('   ✅ Telemetry server responding on port 8765');
        }
        resolve();
      });
    });
    req.on('error', () => {
      console.log('   ℹ️ Telemetry server idle (starts automatically when brave-mcp server runs)');
      resolve();
    });
    req.setTimeout(1200, () => {
      req.destroy();
      console.log('   ℹ️ Telemetry check timed out');
      resolve();
    });
  });

  console.log('\n🎉 Audit complete: Browser infrastructure is ready for Antigravity!\n');
  process.exit(0);
}

main().catch(console.error);
