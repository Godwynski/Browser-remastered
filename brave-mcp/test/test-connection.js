// Live check against the user's running browser on port 9222. Read-only: lists tabs and
// observes the tab the user is looking at. Does not click, type, focus or navigate.
import { BraveManager } from '../src/browser.js';
import { BrowserObserver } from '../src/observer.js';

const brave = new BraveManager(process.env.CDP_URL || 'http://127.0.0.1:9222');
const observer = new BrowserObserver();

try {
  let t = Date.now();
  const tabs = await brave.listTabs();
  console.log(`✅ Connected in ${Date.now() - t}ms. ${tabs.length} tab(s):`);
  for (const tab of tabs) console.log(`   ${tab.id}${tab.isActive ? '*' : ' '} ${tab.title.slice(0, 60)}`);

  const page = await brave.getActivePage();
  t = Date.now();
  const obs = await observer.observe(page, { tabId: brave.tabId(page) });
  console.log(`\n✅ Observed active tab in ${Date.now() - t}ms (${obs.element_count} elements, ~${Math.round(obs.elements_compact.length / 3.8)} tokens):`);
  console.log(obs.elements_compact.split('\n').slice(0, 12).map(l => '   ' + l).join('\n'));
  process.exit(0);
} catch (err) {
  console.error(`❌ ${err.message}`);
  console.log(`👉 Start the browser with brave-launcher\\launch-brave.cmd (remote debugging on port 9222).`);
  process.exit(1);
}
