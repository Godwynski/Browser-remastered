import { evalAgent } from './page-agent.js';
import { attachPage, inflight, downloadsLog } from './page-hooks.js';

const QUIET_MS = 100;

function withTimeout(promise, ms, fallback) {
  let t;
  return Promise.race([promise, new Promise(r => { t = setTimeout(() => r(fallback), ms); })]).finally(() => clearTimeout(t));
}

export class UserActiveError extends Error {}

/**
 * Brackets every action: marks the page busy (so dialogs/popups are attributed to the agent),
 * records DOM text added by the action, and waits deterministically for the page to settle
 * (no mutations for 100ms and no new XHR/fetch in flight), polling from Node so it works in
 * background tabs where timers and rAF are throttled.
 */
export class StateVerifier {
  constructor(observer) {
    this.observer = observer;
  }

  async captureBeforeState(page, { respectUser = true, fast = false } = {}) {
    const bm = attachPage(page);
    if (fast) {
      if (bm.pendingDialog) {
        const d = bm.pendingDialog;
        throw new Error(`Page is blocked by a dialog (${d.type()}: "${d.message().slice(0, 100)}"). Ask the user, or use action:"dialog" with accept:true/false.`);
      }
      bm.busy = true;
      bm.popup = null;
      const t = Date.now();
      return { url: page.url(), title: '', doc: bm.mainDoc, t, lastDialogTime: bm.lastDialog?.t || 0, timestamp: t, fast: true };
    }
    const begin = () => withTimeout(evalAgent(page.mainFrame(), { op: 'begin' }).catch(() => null), 2000, null);
    let s = await begin();
    if (!s) {
      const d = bm.pendingDialog;
      throw new Error(d
        ? `Page is blocked by a dialog (${d.type()}: "${d.message().slice(0, 100)}"). Ask the user, or use action:"dialog" with accept:true/false.`
        : 'Page is not responding (frozen, discarded, or blocked by a dialog).');
    }
    // Co-browsing guard: don't type over the user. Wait briefly for them to pause.
    if (respectUser && s.userIdle < 1200) {
      const until = Date.now() + 2500;
      while (Date.now() < until && s.userIdle < 1200) {
        await new Promise(r => setTimeout(r, 250));
        const st = await withTimeout(evalAgent(page.mainFrame(), { op: 'status' }).catch(() => null), 1500, null);
        if (st) s.userIdle = st.userIdle;
      }
      if (s.userIdle < 1200) {
        await evalAgent(page.mainFrame(), { op: 'end' }).catch(() => {});
        throw new UserActiveError('The user is actively using this tab. Wait a moment and retry, or work in another tab.');
      }
    }
    bm.busy = true;
    bm.popup = null;
    const t = Date.now();
    return {
      url: page.url(),
      title: s.title,
      doc: s.doc,
      readyState: s.ready,
      t,
      lastDialogTime: bm.lastDialog?.t || 0,
      timestamp: t
    };
  }

  async captureAfterState(page, before, { includeScreenshot = false, maxWait = 1200, expectChange = false, fast = false } = {}) {
    const bm = attachPage(page);
    const start = Date.now();
    if (fast) {
      bm.busy = false;
      return {
        url: page.isClosed() ? before.url : page.url(),
        title: before.title,
        doc: before.doc,
        navigated: !page.isClosed() && page.url() !== before.url,
        texts: [],
        settleMs: Date.now() - start,
        closed: page.isClosed(),
        screenshot: null,
        timestamp: Date.now()
      };
    }
    let navigated = false, newDoc = false;
    await new Promise(r => setTimeout(r, 25));
    while (!page.isClosed()) {
      if (page.url() !== before.url) navigated = true;
      const st = await withTimeout(evalAgent(page.mainFrame(), { op: 'status' }).catch(() => null), 1200, null);
      if (!st || st.doc !== before.doc) navigated = newDoc = true;
      if (newDoc && !bm.loaded) {
        await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
        bm.loaded = true;
        continue;
      }
      const limit = navigated ? Math.max(maxWait, 3500) : maxWait;
      if (newDoc) {
        if (st && st.quiet >= 180) break;
      } else {
        const waitingFirst = expectChange && st && st.mutAt < before.t && Date.now() - start < 240;
        if (st && st.quiet >= QUIET_MS && inflight(bm, before.t) === 0 && !waitingFirst) break;
      }
      if (Date.now() - start > limit) break;
      await new Promise(r => setTimeout(r, 40));
    }
    bm.loaded = false;

    let end = null;
    if (!page.isClosed()) {
      end = await withTimeout(evalAgent(page.mainFrame(), { op: 'end' }).catch(() => null), 1200, null);
    }
    bm.busy = false;

    let screenshot = null;
    if (includeScreenshot && !page.isClosed()) {
      screenshot = await page.screenshot({ type: 'jpeg', quality: 60, scale: 'css', timeout: 5000 })
        .then(b => b.toString('base64')).catch(() => null);
    }

    return {
      url: page.isClosed() ? before.url : page.url(),
      title: end?.title ?? before.title,
      doc: end?.doc,
      navigated: navigated || (end && end.doc !== before.doc),
      texts: newDoc ? [] : (end?.texts || []),
      settleMs: Date.now() - start,
      closed: page.isClosed(),
      screenshot,
      timestamp: Date.now()
    };
  }

  createReceipt(actionSummary, beforeState, afterState, extra = {}) {
    const changes = [];
    if (extra.elementChange) changes.push(extra.elementChange);
    if (afterState.url && beforeState.url && beforeState.url !== afterState.url) changes.push(`navigated to ${afterState.url}`);
    else if (afterState.title !== undefined && beforeState.title !== undefined && beforeState.title !== afterState.title) changes.push(`title: "${afterState.title}"`);
    if (afterState.closed) changes.push('tab closed');
    for (const t of afterState.texts || []) changes.push(`text: "${t}"`);
    if (extra.download) changes.push(`download: ${extra.download.filename}${extra.download.path ? ' → ' + extra.download.path : ''}`);
    if (extra.dialogMessage) changes.push(`dialog ${extra.dialogAccepted === false ? 'dismissed' : 'accepted'}: "${extra.dialogMessage}"`);
    if (extra.popup) changes.push(extra.popup);

    return {
      action: actionSummary,
      executed: true,
      before: { url: beforeState.url, title: beforeState.title },
      after: { url: afterState.url, title: afterState.title },
      changes,
      screenshot: afterState.screenshot ? `data:image/jpeg;base64,${afterState.screenshot}` : null
    };
  }

  /** Downloads and dialogs that happened during the action window. */
  sideEffects(page, before) {
    const bm = page._bm || {};
    const download = downloadsLog.filter(d => d.t >= before.t).pop();
    const dialog = bm.lastDialog && bm.lastDialog.t > (before.lastDialogTime || 0) ? bm.lastDialog : null;
    return { download, dialog };
  }
}
