import { chromium } from 'playwright-core';
import path from 'path';
import { PATHS, ensureArtifactDirs } from './paths.js';

export class BraveManager {
  constructor(cdpUrl = process.env.CDP_URL || 'http://127.0.0.1:9222') {
    this.cdpUrl = cdpUrl;
    this.browser = null;
    this.context = null;
    this.browserCdpSession = null;
    this.activePageIndex = null;
    ensureArtifactDirs();
  }

  /**
   * Enforces browser-level CDP download routing directly to the dedicated artifacts directory.
   */
  async _enforceBrowserDownloadBehavior(browserInstance) {
    if (!browserInstance || this.browserCdpSession) return;
    try {
      ensureArtifactDirs();
      this.browserCdpSession = await browserInstance.newBrowserCDPSession();
      await this.browserCdpSession.send('Browser.setDownloadBehavior', {
        behavior: 'allowAndName',
        downloadPath: PATHS.downloadsRaw,
        eventsEnabled: true
      });
    } catch (err) {
      // Graceful fallback if unsupported
    }
  }

  /**
   * Attaches page-level download routing to save into artifacts/downloads.
   */
  async _setupPageDownloads(page, downloadDir = PATHS.downloadsRaw) {
    if (!page || page.isClosed() || page._downloadsConfigured) return;
    page._downloadsConfigured = true;
    try {
      ensureArtifactDirs();
      const client = await page.context().newCDPSession(page);
      await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: downloadDir
      }).catch(() => {});
    } catch (e) {}

    page.on('download', async (download) => {
      try {
        ensureArtifactDirs();
        const filename = download.suggestedFilename() || `download-${Date.now()}`;
        const targetPath = path.join(PATHS.downloads, filename);
        await download.saveAs(targetPath);
        page._lastDownload = { filename, path: targetPath, timestamp: Date.now() };
      } catch (err) {
        console.warn(`[BraveManager] Page download capture error: ${err.message}`);
      }
    });

    page.on('dialog', async (dialog) => {
      page._lastDialog = { message: dialog.message(), type: dialog.type(), timestamp: Date.now() };
      await dialog.accept().catch(() => {});
    });
  }

  /**
   * Attaches strictly to the user's existing, running Brave browser via CDP.
   * NEVER launches secondary browser instances, separate profiles, or isolated windows.
   */
  async ensureConnected() {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }
    this.browser = null;
    this.context = null;
    this.browserCdpSession = null;

    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        this.browser = await chromium.connectOverCDP(this.cdpUrl, { timeout: 3500 });
        const contexts = this.browser.contexts();
        this.context = contexts[0] || null;
        await this._enforceBrowserDownloadBehavior(this.browser);
        return this.browser;
      } catch (err) {
        lastErr = err;
        if (attempt < 3) {
          await new Promise(r => setTimeout(r, 600));
        }
      }
    }

    throw new Error(
      `Could not connect to existing Brave browser on ${this.cdpUrl} (${lastErr?.message}).\n` +
      `Ensure your connected Brave browser is running with '--remote-debugging-port=9222'.\n` +
      `Antigravity strictly attaches to your logged-in browser and will NEVER spawn duplicate instances or separate profile windows.`
    );
  }

  /**
   * Returns all open pages in the user's connected browser.
   */
  async getPages() {
    await this.ensureConnected();

    const contexts = this.browser ? this.browser.contexts() : [];
    const pages = [];
    for (const ctx of contexts) {
      for (const page of ctx.pages()) {
        if (!page.isClosed()) {
          pages.push(page);
        }
      }
    }

    if (pages.length === 0 && this.context) {
      const p = await this.context.newPage();
      pages.push(p);
    }

    return pages;
  }

  /**
   * Gets the user's active/focused page in their existing browser window.
   */
  async getActivePage() {
    const pages = await this.getPages();
    if (pages.length === 0) {
      throw new Error("No open tabs found in Brave.");
    }

    // Check visible tab concurrently across all pages with 400ms timeout race to prevent hanging
    const checkVisibility = p => Promise.race([
      p.evaluate(() => document.visibilityState === 'visible'),
      new Promise(r => setTimeout(() => r(false), 400))
    ]).catch(() => false);

    const visibilities = await Promise.all(pages.map(checkVisibility));
    const activeIndex = visibilities.findIndex(v => v === true);
    let targetPage = null;
    if (activeIndex !== -1) {
      this.activePageIndex = activeIndex;
      targetPage = pages[activeIndex];
    } else if (this.activePageIndex !== null && this.activePageIndex < pages.length && !pages[this.activePageIndex].isClosed()) {
      targetPage = pages[this.activePageIndex];
    } else {
      targetPage = pages[pages.length - 1] || pages[0];
    }
    await this._setupPageDownloads(targetPage);
    return targetPage;
  }

  /**
   * Alias for backward compatibility: returns the active user page.
   * NEVER opens a separate window.
   */
  async getAgentPage() {
    return await this.getActivePage();
  }

  /**
   * Resolves target page:
   * - number: 0-based tab index
   * - string: search by URL substring or title substring
   * - otherwise: user's current active tab
   */
  async getTargetPage(target = 'active', index = null) {
    const pages = await this.getPages();
    if (pages.length === 0) {
      throw new Error("No open tabs found in Brave.");
    }

    if (index !== null && index !== undefined) {
      if (typeof index === 'number' || (typeof index === 'string' && /^\d+$/.test(index.trim()))) {
        const numIdx = typeof index === 'number' ? index : parseInt(index.trim(), 10);
        if (numIdx < 0 || numIdx >= pages.length) {
          throw new Error(`Tab index ${numIdx} out of range (0 to ${pages.length - 1}).`);
        }
        const page = pages[numIdx];
        await this._setupPageDownloads(page);
        return page;
      }

      if (typeof index === 'string' && index.trim().length > 0) {
        const q = index.trim().toLowerCase();
        for (const p of pages) {
          if (p.url().toLowerCase().includes(q)) {
            await this._setupPageDownloads(p);
            return p;
          }
        }
        for (const p of pages) {
          const title = (await p.title().catch(() => '')).toLowerCase();
          if (title.includes(q)) {
            await this._setupPageDownloads(p);
            return p;
          }
        }
        throw new Error(`No open tab found matching "${index}". Run brave_tabs(action: 'list') to view available tabs.`);
      }
    }

    return await this.getActivePage();
  }

  /**
   * Sets the active tab by index or title/URL query.
   */
  async setActivePage(index, { bringToFront = true } = {}) {
    const page = await this.getTargetPage('active', index);
    const pages = await this.getPages();
    this.activePageIndex = pages.indexOf(page);
    if (bringToFront) {
      await page.bringToFront().catch(() => {});
    }
    return page;
  }

  /**
   * Opens a new tab in the user's existing browser window.
   * NEVER opens a separate OS window.
   */
  async newTab(url = 'about:blank') {
    await this.ensureConnected();
    const ctx = this.context || this.browser.contexts()[0];
    if (!ctx) throw new Error("No browser context available.");
    const page = await ctx.newPage();
    await this._setupPageDownloads(page);
    if (url && url !== 'about:blank') {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }
    return page;
  }

  /**
   * Closes a tab by index or title/URL query.
   */
  async closeTab(index) {
    const page = await this.getTargetPage('active', index);
    const pages = await this.getPages();
    // Prevent closing the browser window when only 1 tab exists
    if (pages.length <= 1) {
      await this.newTab('about:blank');
    }
    await page.close();
  }

  /**
   * Returns list of open tabs with title, url, and active state.
   */
  async listTabs() {
    const pages = await this.getPages();
    return await Promise.all(
      pages.map(async (p, i) => {
        let title = 'Untitled';
        let url = 'about:blank';
        let isVisible = false;
        try {
          title = await Promise.race([p.title(), new Promise(r => setTimeout(() => r('Untitled'), 400))]);
          url = p.url();
          isVisible = await Promise.race([
            p.evaluate(() => document.visibilityState === 'visible'),
            new Promise(r => setTimeout(() => r(false), 400))
          ]).catch(() => false);
        } catch (e) {}

        return {
          index: i,
          title,
          url,
          isActive: isVisible
        };
      })
    );
  }
}
