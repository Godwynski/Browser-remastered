import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKFLOWS_DIR = path.resolve(__dirname, '../scripts/workflows');

/**
 * Universal WorkflowEngine: Executes high-speed, multi-step repetitive operations
 * (pagination, bulk clicks, data scraping, scripted routines) natively inside CDP
 * in a single turn without intermediate LLM token-consuming roundtrips.
 */
export class WorkflowEngine {
  constructor(browserManager) {
    this.brave = browserManager;
    if (!fs.existsSync(WORKFLOWS_DIR)) {
      fs.mkdirSync(WORKFLOWS_DIR, { recursive: true });
    }
  }

  /**
   * Automatically paginates through a site (via "Next" button or infinite scroll)
   * and extracts structured records in a single tool call.
   */
  async paginateExtract(page, options = {}) {
    const {
      itemSelector = 'article, tr, li, [class*="item"], [class*="card"], [class*="row"]',
      nextSelector = 'a[rel="next"], [aria-label*="next" i], button:has-text("Next"), a:has-text("Next"), .next a, .pagination-next',
      scrollMode = false,
      maxPages = 5,
      maxItems = 100,
      pageDelay = 800
    } = options;

    const allItems = [];
    const seenKeys = new Set();
    let currentPage = 1;

    while (currentPage <= maxPages && allItems.length < maxItems) {
      // Wait for network/DOM stabilization
      await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(300);

      // Extract current page items
      const pageItems = await page.evaluate(({ selector, limit }) => {
        const elements = Array.from(document.querySelectorAll(selector));
        const extracted = [];

        for (const el of elements) {
          if (extracted.length >= limit) break;
          // Filter invisible or header elements
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;
          if (el.tagName.toLowerCase() === 'tr' && el.querySelector('th') && !el.querySelector('td')) continue;

          const titleEl = el.querySelector('h1, h2, h3, h4, h5, .title, [class*="title"], strong, a');
          const linkEl = el.querySelector('a[href]') || (el.tagName.toLowerCase() === 'a' ? el : null);
          const priceEl = el.querySelector('.price, [class*="price"], .amount, .badge');

          const rawText = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          if (rawText.length < 2) continue;

          extracted.push({
            title: titleEl ? titleEl.innerText.trim().slice(0, 150) : undefined,
            text: rawText.slice(0, 300),
            link: linkEl ? linkEl.href : undefined,
            price: priceEl ? priceEl.innerText.trim() : undefined
          });
        }
        return extracted;
      }, { selector: itemSelector, limit: maxItems - allItems.length });

      let newItemsAdded = 0;
      for (const item of pageItems) {
        if (allItems.length >= maxItems) break;
        const key = item.link || (item.title ? `${item.title}:${item.text}` : item.text);
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          allItems.push(item);
          newItemsAdded++;
        }
      }

      if (currentPage >= maxPages || allItems.length >= maxItems || (scrollMode && newItemsAdded === 0 && currentPage > 1)) break;

      // Navigate to next page
      if (scrollMode) {
        // Infinite scroll mode
        const prevHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
        await page.waitForTimeout(pageDelay);
        const newHeight = await page.evaluate(() => document.documentElement.scrollHeight);
        if (newHeight === prevHeight) {
          // Reached end of scroll
          break;
        }
      } else {
        // Next button pagination mode
        let nextBtn = null;
        try {
          nextBtn = page.locator(nextSelector).first();
          const count = await nextBtn.count();
          if (count === 0 || !await nextBtn.isVisible().catch(() => false)) {
            break; // No more pages
          }
          await nextBtn.click({ timeout: 4000 });
          await page.waitForTimeout(pageDelay);
        } catch (e) {
          break; // Next button unavailable or disabled
        }
      }

      currentPage++;
    }

    return {
      status: 'PaginationCompleted',
      pagesTraversed: currentPage,
      totalItemsCollected: allItems.length,
      itemSelector,
      items: allItems
    };
  }

  /**
   * Executes a bulk operation across all elements matching a selector on the page
   * (e.g. click all buttons, check all checkboxes, scrape attributes) in 1 turn.
   */
  async bulkAction(page, options = {}) {
    const {
      selector,
      action = 'click', // 'click' | 'check' | 'extract_attribute'
      attribute = 'href',
      maxElements = 50,
      delayMs = 150
    } = options;

    if (!selector) throw new Error("Parameter 'selector' is required for bulk_action.");

    if (action === 'extract_attribute') {
      const attributes = await page.evaluate(({ sel, attr, limit }) => {
        const els = Array.from(document.querySelectorAll(sel)).slice(0, limit);
        return els.map(el => ({
          tag: el.tagName.toLowerCase(),
          text: (el.innerText || '').trim().slice(0, 80),
          value: el.getAttribute(attr)
        })).filter(item => item.value !== null);
      }, { sel: selector, attr: attribute, limit: maxElements });

      return {
        status: 'BulkExtracted',
        selector,
        attribute,
        count: attributes.length,
        items: attributes
      };
    }

    const locators = page.locator(selector);
    const count = Math.min(await locators.count(), maxElements);
    let executedCount = 0;
    const errors = [];

    for (let i = 0; i < count; i++) {
      try {
        const item = locators.nth(i);
        if (await item.isVisible().catch(() => false)) {
          if (action === 'click') {
            await item.click({ timeout: 3000 });
          } else if (action === 'check') {
            await item.check({ timeout: 3000 });
          }
          executedCount++;
          if (delayMs > 0) await page.waitForTimeout(delayMs);
        }
      } catch (err) {
        errors.push(`Item ${i}: ${err.message}`);
      }
    }

    return {
      status: 'BulkActionCompleted',
      selector,
      action,
      matched: count,
      executed: executedCount,
      errors: errors.length > 0 ? errors.slice(0, 5) : undefined
    };
  }

  /**
   * Executes a dedicated, reusable workflow script from scripts/workflows/.
   */
  async runScript(page, scriptName, params = {}) {
    if (!scriptName) throw new Error("Parameter 'scriptName' is required.");
    const cleanName = scriptName.endsWith('.js') ? scriptName : `${scriptName}.js`;
    const targetScript = path.resolve(WORKFLOWS_DIR, cleanName);

    if (!targetScript.startsWith(WORKFLOWS_DIR + path.sep) || !fs.existsSync(targetScript)) {
      throw new Error(`Workflow script '${cleanName}' not found in scripts/workflows/.`);
    }

    const mod = await import(`file://${targetScript}`);
    if (typeof mod.run !== 'function' && typeof mod.default !== 'function') {
      throw new Error(`Workflow script '${cleanName}' must export a 'run' or default async function.`);
    }

    const runner = mod.run || mod.default;
    const result = await runner(page, params, this.brave);

    return {
      status: 'ScriptExecuted',
      script: cleanName,
      result: result || { success: true }
    };
  }
}
