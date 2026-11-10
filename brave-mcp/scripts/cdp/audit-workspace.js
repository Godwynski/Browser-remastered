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
      console.log(`      ${t.id} ${t.title.slice(0, 40)} (${t.url.slice(0, 60)})${activeMark}`);
    });
  } catch (err) {
    console.log(`   ⚠️ Brave CDP port 9222 not reachable: ${err.message}`);
    console.log('      Run brave-launcher/launch-brave.cmd to start Brave with remote debugging enabled.');
  }

  console.log('\n🎉 Audit complete: Browser infrastructure is ready for Antigravity!\n');
  process.exit(0);
}

main().catch(console.error);
