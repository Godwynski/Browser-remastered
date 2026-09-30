import fs from 'fs';
import path from 'path';
import { BraveManager } from '../../../../brave-mcp/src/browser.js';

async function main() {
  const args = process.argv.slice(2);
  let url = null;
  let active = true;
  let type = 'auto'; // 'auto' | 'table' | 'cards' | 'links'
  let format = 'json'; // 'json' | 'csv'
  let pattern = null;
  let limit = 100;
  let outputPath = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && args[i + 1]) { url = args[++i]; active = false; }
    else if (args[i] === '--type' && args[i + 1]) type = args[++i];
    else if (args[i] === '--format' && args[i + 1]) format = args[++i];
    else if (args[i] === '--pattern' && args[i + 1]) pattern = args[++i];
    else if (args[i] === '--limit' && args[i + 1]) limit = parseInt(args[++i], 10);
    else if (args[i] === '--output' && args[i + 1]) outputPath = args[++i];
  }

  const brave = new BraveManager();
  const page = (active || !url) ? await brave.getActivePage() : await brave.newTab(url);

  console.log(`[Scraper] Extracting [${type.toUpperCase()}] from: "${await page.title()}"`);

  const result = await page.evaluate(({ extractType, extractLimit, filterPattern }) => {
    // 1. Tables Extraction
    if (extractType === 'table' || (extractType === 'auto' && document.querySelector('table'))) {
      const table = document.querySelector('table');
      if (table) {
        const rows = Array.from(table.querySelectorAll('tr'));
        const headers = Array.from(rows[0]?.querySelectorAll('th, td') || []).map(c => c.innerText.trim());
        const dataRows = [];

        for (let i = 1; i < Math.min(rows.length, extractLimit + 1); i++) {
          const cells = Array.from(rows[i].querySelectorAll('td, th')).map(c => c.innerText.trim());
          if (cells.length > 0) {
            const rowObj = {};
            cells.forEach((cell, idx) => {
              const colName = headers[idx] || `col_${idx + 1}`;
              rowObj[colName] = cell;
            });
            dataRows.push(rowObj);
          }
        }

        return { mode: 'table', headers, records: dataRows };
      }
    }

    // 2. Links Extraction
    if (extractType === 'links') {
      const links = Array.from(document.querySelectorAll('a[href]'))
        .map(a => ({ text: a.innerText.trim(), href: a.href }))
        .filter(l => l.text && (!filterPattern || l.href.includes(filterPattern)))
        .slice(0, extractLimit);
      return { mode: 'links', records: links };
    }

    // 3. Repeating Cards / Items Extraction (Auto / Cards)
    const cardSelectors = ['.card', '.item', '.product', '.result', 'article', '[role="article"]', 'li'];
    let matchedCards = [];
    for (const sel of cardSelectors) {
      const matches = Array.from(document.querySelectorAll(sel));
      if (matches.length >= 3) {
        matchedCards = matches;
        break;
      }
    }

    const records = matchedCards.slice(0, extractLimit).map(c => {
      const titleEl = c.querySelector('h1, h2, h3, h4, .title, strong, a');
      const linkEl = c.querySelector('a[href]');
      const priceEl = c.querySelector('.price, [class*="price"], .amount');
      return {
        title: (titleEl ? titleEl.innerText : c.innerText).trim().slice(0, 120),
        link: linkEl ? linkEl.href : undefined,
        price: priceEl ? priceEl.innerText.trim() : undefined,
        summary: (c.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 200)
      };
    });

    return { mode: 'cards', records };
  }, { extractType: type, extractLimit: limit, filterPattern: pattern });

  // Format to JSON or CSV
  let outputData = '';
  if (format === 'csv' && result.records.length > 0) {
    const keys = Object.keys(result.records[0]);
    const headerLine = keys.map(k => `"${k}"`).join(',');
    const rows = result.records.map(r => keys.map(k => `"${String(r[k] || '').replace(/"/g, '""')}"`).join(','));
    outputData = [headerLine, ...rows].join('\n');
  } else {
    outputData = JSON.stringify(result, null, 2);
  }

  if (outputPath) {
    const resolvedPath = path.resolve(process.cwd(), outputPath);
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, outputData, 'utf8');
    console.log(`[Scraper] Successfully exported ${result.records.length} records to: ${resolvedPath}`);
  } else {
    console.log(outputData);
  }
}

main().catch(err => {
  console.error('[Scraper Error]', err.message);
  process.exit(1);
});
