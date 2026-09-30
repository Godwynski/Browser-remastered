import fs from 'fs';
import path from 'path';
import { BraveManager } from '../../../../brave-mcp/src/browser.js';

async function main() {
  const args = process.argv.slice(2);
  let url = null;
  let active = false;
  let selector = 'body';
  let scrolls = 1;
  let outputPath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) url = args[++i];
    else if (args[i] === '--active') active = true;
    else if (args[i] === '--selector' && args[i + 1]) selector = args[++i];
    else if (args[i] === '--scrolls' && args[i + 1]) scrolls = parseInt(args[++i], 10);
    else if (args[i] === '--output' && args[i + 1]) outputPath = args[++i];
  }

  const brave = new BraveManager();
  let page = null;

  if (active || !url) {
    page = await brave.getActivePage();
    console.log(`[Capture] Attached to active tab: "${await page.title()}" (${page.url()})`);
  } else {
    page = await brave.newTab(url);
    console.log(`[Capture] Opened tab for: ${url}`);
  }

  // Trigger incremental scrolls to load dynamic / virtualized content
  for (let s = 1; s <= scrolls; s++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.85));
    await page.waitForTimeout(600);
  }

  // Extract structured dynamic content
  const data = await page.evaluate((targetSelector) => {
    const root = document.querySelector(targetSelector) || document.body;
    const items = [];

    // Identify repeating components (articles, cards, list rows, grid items)
    const candidates = root.querySelectorAll('article, li, tr, [class*="card"], [class*="item"], [class*="post"], [class*="row"]');
    if (candidates.length > 3) {
      candidates.forEach(el => {
        const text = (el.innerText || '').trim();
        if (text.length > 5) {
          const links = Array.from(el.querySelectorAll('a')).map(a => ({ text: a.innerText.trim(), href: a.href })).filter(l => l.text);
          items.push({ text: text.replace(/\s+/g, ' ').slice(0, 300), links });
        }
      });
    }

    return {
      title: document.title,
      url: window.location.href,
      scrollDimensions: { height: document.documentElement.scrollHeight, viewportHeight: window.innerHeight },
      repeatingItemsCount: items.length,
      sampleItems: items.slice(0, 25),
      fullTextSnippet: (root.innerText || '').replace(/\s+/g, ' ').slice(0, 2000)
    };
  }, selector);

  const resultJson = JSON.stringify(data, null, 2);

  if (outputPath) {
    const resolvedPath = path.resolve(process.cwd(), outputPath);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, resultJson, 'utf8');
    console.log(`[Capture] Saved structured content to: ${resolvedPath}`);
  } else {
    console.log(resultJson);
  }
}

main().catch(err => {
  console.error('[Capture Error]', err.message);
  process.exit(1);
});
