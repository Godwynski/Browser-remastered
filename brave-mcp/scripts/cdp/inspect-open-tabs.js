import { BraveManager } from '../../src/browser.js';

async function main() {
  const brave = new BraveManager();
  const tabs = await brave.listTabs();
  console.log(`Found ${tabs.length} open tabs in Brave:`);
  tabs.forEach((t, i) => {
    console.log(`[${i}] Title: "${t.title}" | URL: ${t.url}`);
  });
}

main().catch(console.error);
