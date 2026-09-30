import { BraveManager } from '../src/browser.js';
import { BrowserObserver } from '../src/observer.js';

async function test() {
  console.log("🔍 Checking connection to Brave Browser on CDP port 9222...");

  const brave = new BraveManager('http://127.0.0.1:9222');
  const observer = new BrowserObserver();

  try {
    const tabs = await brave.listTabs();
    console.log(`✅ Connected to Brave successfully! Found ${tabs.length} open tab(s):`);
    tabs.forEach(t => {
      console.log(`  [${t.index}] ${t.isActive ? '⭐ ' : '   '}${t.title} (${t.url})`);
    });

    const activePage = await brave.getActivePage();
    console.log(`\n🔍 Performing tri-source observation on active tab...`);
    const observation = await observer.observe(activePage, { includeScreenshot: false });

    console.log(`✅ Observation successful!`);
    console.log(`   Obs ID: ${observation.obs_id}`);
    console.log(`   Title: ${observation.tab.title}`);
    console.log(`   URL: ${observation.tab.url}`);
    console.log(`   Interactive Elements Discovered: ${observation.elements.length}`);
    
    if (observation.elements.length > 0) {
      console.log(`\nSample Interactive Elements:`);
      observation.elements.slice(0, 10).forEach(e => {
        console.log(`   [${e.ref}] <${e.role}> ${e.name ? `"${e.name}"` : ''} ${e.value ? `value="${e.value}"` : ''}`);
      });
    }

    console.log(`\n🎉 brave-mcp is fully operational and ready for Antigravity!`);
    process.exit(0);
  } catch (err) {
    console.error(`\n❌ Could not connect to Brave:\n${err.message}`);
    console.log(`\n👉 Solution: Run 'brave-launcher\\launch-brave.cmd' to launch Brave with remote debugging.`);
    process.exit(1);
  }
}

test();

