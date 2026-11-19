import { chromium } from 'playwright-core';
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ensureArtifactDirs } from './paths.js';
import { attachPage, logDownload } from './page-hooks.js';

function race(promise, ms, fallback) {
  let t;
  return Promise.race([promise, new Promise(r => { t = setTimeout(() => r(fallback), ms); })]).finally(() => clearTimeout(t));
}

function findBrowser() {
  const local = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
  const pf = process.env.ProgramFiles || 'C:\\Program Files';
  const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const candidates = [
    { exe: path.join(local, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), data: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'), proc: 'brave.exe' },
    { exe: path.join(pf, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), data: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'), proc: 'brave.exe' },
    { exe: path.join(pf86, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe'), data: path.join(local, 'BraveSoftware', 'Brave-Browser', 'User Data'), proc: 'brave.exe' },
    { exe: path.join(pf, 'Google', 'Chrome', 'Application', 'chrome.exe'), data: path.join(local, 'Google', 'Chrome', 'User Data'), proc: 'chrome.exe' },
    { exe: path.join(pf86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'), data: path.join(local, 'Microsoft', 'Edge', 'User Data'), proc: 'msedge.exe' }
  ];
  return candidates.find(c => fs.existsSync(c.exe)) || null;
}

/**
 * Attaches to the user's already-running browser over CDP and shares it with them:
 * - never launches a browser or opens windows
 * - noDefaults: leaves the user's downloads, viewport and dialogs alone
 * - the agent keeps its own tab ("sticky"), so the user switching tabs never redirects the agent
 * - tabs get stable ids (t1, t2, ...) that survive the user opening/closing/reordering tabs
 */
export class BraveManager {
  constructor(cdpUrl = process.env.CDP_URL || 'http://127.0.0.1:9222') {
    this.cdpUrl = cdpUrl;
    this.browser = null;
    this.context = null;
    this.cdp = null;
    this.agentPage = null;
    this.tabIds = new WeakMap();
    this.tabSeq = 0;
    ensureArtifactDirs();
  }

  async ensureConnected() {
    if (this.browser && this.browser.isConnected()) return this.browser;
    this.browser = this.context = this.cdp = this.agentPage = null;

    let lastErr;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        this.browser = await chromium.connectOverCDP(this.cdpUrl, { timeout: 2500, noDefaults: true });
        break;
      } catch (err) {
        lastErr = err;
        if (attempt === 1 && /^http:\/\/(127\.0\.0\.1|localhost):9222\/?$/i.test(this.cdpUrl) && process.env.BRAVE_MCP_NO_AUTOLAUNCH !== '1') {
          await this._autoLaunch();
        } else if (attempt < 2) {
          await new Promise(r => setTimeout(r, 300));
        }
      }
    }
    if (!this.browser) {
      throw new Error(
        `Could not connect to the browser at ${this.cdpUrl} (${lastErr?.message?.split('\n')[0]}). ` +
        `Start Brave with --remote-debugging-port=9222 (brave-launcher/launch-brave.cmd).`
      );
    }
    this.browser.on('disconnected', () => { this.browser = null; });
    this.context = this.browser.contexts()[0] || null;

    // Keep the user's own dialogs open for them. Without any listener Playwright would
    // auto-dismiss every alert/confirm (and auto-accept "Leave site?") in every tab.
    for (const ctx of this.browser.contexts()) ctx.on('dialog', () => {});

    try {
      this.cdp = await this.browser.newBrowserCDPSession();
      // Report downloads without redirecting them: they keep going to the user's normal folder.
      await this.cdp.send('Browser.setDownloadBehavior', { behavior: 'default', eventsEnabled: true });
      this.cdp.on('Browser.downloadWillBegin', (e) => logDownload({ guid: e.guid, filename: e.suggestedFilename, url: e.url, t: Date.now(), state: 'started' }));
      this.cdp.on('Browser.downloadProgress', (e) => {
        if (e.state === 'completed') logDownload({ guid: e.guid, filename: e.filePath ? e.filePath.split(/[\\/]/).pop() : undefined, path: e.filePath, t: Date.now(), state: 'completed' });
      });
    } catch (_) {
      this.cdp = null;
    }
    return this.browser;
  }

  async _autoLaunch() {
    const b = findBrowser();
    if (!b) return;
    try {
      const running = execSync(`tasklist /FI "IMAGENAME eq ${b.proc}" /NH`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      if (running && running.toLowerCase().includes(b.proc)) return; // Don't kill a running non-debug browser without consent
    } catch (_) {}
    try {
      const child = spawn(b.exe, [
        '--remote-debugging-port=9222',
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        `--user-data-dir=${b.data}`,
        '--restore-last-session'
      ], { detached: true, stdio: 'ignore' });
      child.unref();
      for (let i = 0; i < 15; i++) {
        await new Promise(r => setTimeout(r, 400));
        try {
          const res = await fetch('http://127.0.0.1:9222/json/version');
          if (res.ok) return;
        } catch (_) {}
      }
    } catch (_) {}
  }

  tabId(page) {
    let id = this.tabIds.get(page);
    if (!id) { id = `t${++this.tabSeq}`; this.tabIds.set(page, id); }
    return id;
  }

  async getPages() {
    await this.ensureConnected();
    const pages = [];
    for (const ctx of this.browser.contexts()) {
      for (const p of ctx.pages()) if (!p.isClosed()) pages.push(p);
    }
    for (const p of pages) this.tabId(p);
    if (!pages.length && this.context) pages.push(await this.context.newPage());
    return pages;
  }

  _prepare(page) {
    attachPage(page, { onPopup: (popup) => { this.tabId(popup); this.agentPage = popup; } });
    if (!page._bmLifecycle) {
      page._bmLifecycle = true;
      // Wake tabs the browser froze in the background (Memory Saver etc.).
      page.context().newCDPSession(page)
        .then(s => s.send('Page.setWebLifecycleState', { state: 'active' }).finally(() => s.detach().catch(() => {})))
        .catch(() => {});
    }
    return page;
  }

  async _visibility(page) {
    const u = page.url();
    if (!u || u.startsWith('chrome-extension:') || u.startsWith('devtools:')) return null;
    return race(page.evaluate(() => ({ v: document.visibilityState === 'visible', f: document.hasFocus() })).catch(() => null), 180, null);
  }

  /** The tab the user is currently looking at. */
  async getActivePage() {
    const pages = await this.getPages();
    const vis = await Promise.all(pages.map(p => this._visibility(p)));
    let idx = vis.findIndex(v => v && v.v && v.f);
    if (idx === -1) idx = vis.findIndex(v => v && v.v);
    const page = idx !== -1 ? pages[idx] : (this.agentPage && !this.agentPage.isClosed() ? this.agentPage : pages[pages.length - 1]);
    return this._prepare(page);
  }

  async getAgentPage() {
    return this.getTargetPage();
  }

  _resolve(pages, tab) {
    const s = String(tab).trim();
    if (/^t\d+$/i.test(s)) {
      const p = pages.find(x => this.tabIds.get(x) === s.toLowerCase());
      if (!p) throw new Error(`Tab ${s} is not open. Use brave_tabs to list tabs.`);
      return p;
    }
    if (typeof tab === 'number' || /^\d+$/.test(s)) {
      const i = Number(s);
      if (i < 0 || i >= pages.length) throw new Error(`Tab index ${i} out of range (0-${pages.length - 1}).`);
      return pages[i];
    }
    const q = s.toLowerCase();
    return pages.find(p => p.url().toLowerCase().includes(q)) || null;
  }

  /**
   * Resolves the page the agent should act on. An explicit tab (id, index, or URL/title text)
   * becomes the agent's tab; otherwise the agent stays on its tab, starting from the user's active one.
   */
  async getTargetPage(_target = null, tab = null) {
    const pages = await this.getPages();
    if (tab !== null && tab !== undefined && tab !== '') {
      let page = this._resolve(pages, tab);
      if (!page) {
        const q = String(tab).toLowerCase();
        const titles = await Promise.all(pages.map(p => race(p.title().catch(() => ''), 400, '')));
        page = pages[titles.findIndex(t => t.toLowerCase().includes(q))];
      }
      if (!page) throw new Error(`No open tab matches "${tab}". Use brave_tabs to list tabs.`);
      this.agentPage = page;
      return this._prepare(page);
    }
    if (this.agentPage && !this.agentPage.isClosed() && pages.includes(this.agentPage)) return this._prepare(this.agentPage);
    this.agentPage = await this.getActivePage();
    return this.agentPage;
  }

  async setActivePage(tab, { bringToFront = false } = {}) {
    const page = await this.getTargetPage(null, tab);
    if (bringToFront) await page.bringToFront().catch(() => {});
    return page;
  }

  /** Opens a tab in the background so the user's view is not disturbed. */
  async newTab(url = 'about:blank') {
    await this.ensureConnected();
    const ctx = this.context || this.browser.contexts()[0];
    if (!ctx) throw new Error('No browser context available.');
    let page = null;
    if (this.cdp) {
      const known = new Set(ctx.pages());
      const waiter = ctx.waitForEvent('page', { predicate: p => !known.has(p), timeout: 5000 }).catch(() => null);
      await this.cdp.send('Target.createTarget', { url: 'about:blank', background: true }).catch(() => null);
      page = await waiter;
    }
    if (!page) page = await ctx.newPage();
    this.tabId(page);
    this.agentPage = this._prepare(page);
    if (url && url !== 'about:blank') {
      const full = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
      await page.goto(full, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    }
    return page;
  }

  async closeTab(tab) {
    const pages = await this.getPages();
    const page = this._resolve(pages, tab);
    if (!page) throw new Error(`No open tab matches "${tab}".`);
    if (pages.length <= 1) await this.newTab('about:blank');
    if (page === this.agentPage) this.agentPage = null;
    await page.close();
  }

  async listTabs() {
    const pages = await this.getPages();
    return Promise.all(pages.map(async (p, i) => {
      const [title, vis] = await Promise.all([race(p.title().catch(() => ''), 400, ''), this._visibility(p)]);
      return {
        index: i,
        id: this.tabId(p),
        title: title || 'Untitled',
        url: p.url(),
        isActive: Boolean(vis && vis.v),
        isAgent: p === this.agentPage
      };
    }));
  }
}
