// Universality benchmark: observe + read on a spread of real public sites in a throwaway
// headless browser (no user profile). Reports speed, output size (~tokens) and failures.
// Usage: node test/bench-sites.js [url ...]
import { chromium } from 'playwright-core';
import { BrowserObserver } from '../src/observer.js';
import { ContentReader } from '../src/reader.js';
import { getTestBrowserExe } from './test-helper.js';

const SITES = process.argv.slice(2).length ? process.argv.slice(2) : [
  'https://en.wikipedia.org/wiki/Web_browser',
  'https://news.ycombinator.com/',
  'https://github.com/microsoft/playwright',
  'https://developer.mozilla.org/en-US/docs/Web/HTML/Element/dialog',
  'https://www.bbc.com/news',
  'https://duckduckgo.com/',
  'https://www.reddit.com/r/programming/',
  'https://www.youtube.com/',
  'https://www.amazon.com/',
  'https://stackoverflow.com/questions',
  'https://www.w3schools.com/html/html_forms.asp',
  'https://www.gov.uk/'
];

const tok = (s) => Math.round(s.length / 3.8);

const browser = await chromium.launch({ executablePath: getTestBrowserExe(), headless: true });
const ctx = await browser.newContext({ viewport: { width: 1366, height: 800 }, userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36' });
const observer = new BrowserObserver();
const reader = new ContentReader();
const rows = [];

for (const url of SITES) {
  const page = await ctx.newPage();
  const row = { site: new URL(url).host };
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(1500);
    let t = Date.now();
    const obs = await observer.observe(page);
    row.observeMs = Date.now() - t;
    row.elements = obs.element_count;
    row.obsTok = tok(obs.elements_compact);
    t = Date.now();
    const r = await reader.extract(page, { maxLength: 6000 });
    row.readMs = Date.now() - t;
    row.words = r.wordCount;
    row.readTok = tok(r.markdown);
    row.sample = obs.elements_compact.split('\n').slice(1, 4).join(' / ').slice(0, 110);
  } catch (err) {
    row.error = err.message.split('\n')[0].slice(0, 90);
  }
  rows.push(row);
  console.log(row.error ? `✗ ${row.site}: ${row.error}` : `✓ ${row.site.padEnd(28)} observe ${String(row.observeMs).padStart(4)}ms ${String(row.elements).padStart(3)} els ~${String(row.obsTok).padStart(4)} tok | read ${String(row.readMs).padStart(4)}ms ~${String(row.readTok).padStart(4)} tok (${row.words} words)\n    ${row.sample}`);
  await page.close();
}
await browser.close();
const ok = rows.filter(r => !r.error);
if (ok.length) {
  const avg = (k) => Math.round(ok.reduce((s, r) => s + r[k], 0) / ok.length);
  console.log(`\n${ok.length}/${rows.length} sites OK | avg observe ${avg('observeMs')}ms ~${avg('obsTok')} tok | avg read ${avg('readMs')}ms ~${avg('readTok')} tok`);
}
