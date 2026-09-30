import { chromium } from 'playwright-core';
import path from 'path';
import { PATHS, ensureArtifactDirs } from './paths.js';

export class BraveManager {
  constructor(cdpUrl = process.env.CDP_URL || 'http://127.0.0.1:9222') {
    this.cdpUrl = cdpUrl;
    this.browser = null;
    this.context = null;
    ensureArtifactDirs();
  }

  /**
   * Enforces browser-level CDP download routing directly to the dedicated artifacts directory.
   */
  async _enforceBrowserDownloadBehavior(browserInstance) {
    if (!browserInstance) return;
    try {
      ensureArtifactDirs();
      const session = await browserInstance.newBrowserCDPSession();
      await session.send('Browser.setDownloadBehavior', {
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
    if (!page || page.isClosed()) return;
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
        const targetPath = path.join(downloadDir, filename);
        await download.saveAs(targetPath);
      } catch (err) {
        console.warn(`[BraveManager] Page download capture error: ${err.message}`);
      }
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

    // Return the tab currently visible to the user
    for (const p of pages) {
      try {
        const isVisible = await p.evaluate(() => document.visibilityState === 'visible').catch(() => false);
        if (isVisible) {
          await this._setupPageDownloads(p);
          return p;
        }
      } catch (e) {}
    }

    const fallbackPage = pages[pages.length - 1] || pages[0];
    await this._setupPageDownloads(fallbackPage);
    return fallbackPage;
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
   * - index (number): specific tab index
   * - otherwise: user's current active tab
   */
  async getTargetPage(target = 'active', index = null) {
    const pages = await this.getPages();
    if (pages.length === 0) {
      throw new Error("No open tabs found in Brave.");
    }

    if (index !== null && index !== undefined) {
      if (index < 0 || index >= pages.length) {
        throw new Error(`Tab index ${index} out of range (0 to ${pages.length - 1}).`);
      }
      const page = pages[index];
      await this._setupPageDownloads(page);
      return page;
    }

    return await this.getActivePage();
  }

  /**
   * Sets the active tab by index.
   */
  async setActivePage(index, { bringToFront = false } = {}) {
    const pages = await this.getPages();
    if (index < 0 || index >= pages.length) {
      throw new Error(`Tab index ${index} out of range (0 to ${pages.length - 1}).`);
    }
    const page = pages[index];
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
   * Closes a tab by index.
   */
  async closeTab(index) {
    const pages = await this.getPages();
    if (index < 0 || index >= pages.length) {
      throw new Error(`Tab index ${index} out of range.`);
    }
    await pages[index].close();
  }

  /**
   * Returns list of open tabs with title, url, and active state.
   */
  async listTabs() {
    const pages = await this.getPages();
    const tabs = [];
    for (let i = 0; i < pages.length; i++) {
      const p = pages[i];
      let title = 'Untitled';
      let url = 'about:blank';
      let isVisible = false;
      try {
        title = await p.title();
        url = p.url();
        isVisible = await p.evaluate(() => document.visibilityState === 'visible').catch(() => false);
      } catch (e) {}

      tabs.push({
        index: i,
        title,
        url,
        isActive: isVisible
      });
    }
    return tabs;
  }
}
