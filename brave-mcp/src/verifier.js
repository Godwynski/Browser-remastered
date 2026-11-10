import { pageAgent } from './page-agent.js';
import { attachPage, inflight, downloadsLog } from './page-hooks.js';

const QUIET_MS = 150;

function withTimeout(promise, ms, fallback) {
  let t;
  return Promise.race([promise, new Promise(r => { t = setTimeout(() => r(fallback), ms); })]).finally(() => clearTimeout(t));
}

export class UserActiveError extends Error {}

/**
 * Brackets every action: marks the page busy (so dialogs/popups are attributed to the agent),
 * records DOM text added by the action, and waits deterministically for the page to settle
 * (no mutations for 150ms and no new XHR/fetch in flight), polling from Node so it works in
 * background tabs where timers and rAF are throttled.
 */
export class StateVerifier {
  constructor(observer) {
    this.observer = observer;
  }

  async captureBeforeState(page, { respectUser = true } = {}) {
    const bm = attachPage(page);
    const status = () => withTimeout(page.mainFrame().evaluate(pageAgent, { op: 'status' }).catch(() => null), 2500, null);
    let st = await status();
    if (!st) {
      const d = bm.pendingDialog;
      throw new Error(d
        ? `Page is blocked by a dialog (${d.type()}: "${d.message().slice(0, 100)}"). Ask the user, or use action:"dialog" with accept:true/false.`
        : 'Page is not responding (frozen, discarded, or blocked by a dialog).');
    }
    // Co-browsing guard: don't type over the user. Wait briefly for them to pause.
    if (respectUser && st.userIdle < 1200) {
      const until = Date.now() + 2500;
      while (Date.now() < until && st.userIdle < 1200) {
        await new Promise(r => setTimeout(r, 250));
        st = (await status()) || st;
      }
      if (st.userIdle < 1200) {
        throw new UserActiveError('The user is actively using this tab. Wait a moment and retry, or work in another tab.');
      }
    }
    const s = await page.mainFrame().evaluate(pageAgent, { op: 'begin' });
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

  async captureAfterState(page, before, { includeScreenshot = false, maxWait = 1500, expectChange = false } = {}) {
    const bm = attachPage(page);
    const start = Date.now();
    let navigated = false, newDoc = false;
    await new Promise(r => setTimeout(r, 40));
    while (!page.isClosed()) {
      if (page.url() !== before.url) navigated = true;
      const st = await withTimeout(page.mainFrame().evaluate(pageAgent, { op: 'status' }).catch(() => null), 1500, null);
      if (!st || st.doc !== before.doc) navigated = newDoc = true;
      if (newDoc && !bm.loaded) {
        await page.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
        bm.loaded = true;
        continue;
      }
      const limit = navigated ? Math.max(maxWait, 4000) : maxWait;
      if (newDoc) {
        // New page: DOMContentLoaded already passed; wait for rendering to calm down, not for every request.
        if (st && st.quiet >= 250) break;
      } else {
        // Clicks usually cause a change; give delayed handlers (debounce, animations) a short window to start.
        const waitingFirst = expectChange && st && st.mutAt < before.t && Date.now() - start < 450;
        if (st && st.quiet >= QUIET_MS && inflight(bm, before.t) === 0 && !waitingFirst) break;
      }
      if (Date.now() - start > limit) break;
      await new Promise(r => setTimeout(r, 60));
    }
    bm.loaded = false;

    let end = null;
    if (!page.isClosed()) {
      end = await withTimeout(page.mainFrame().evaluate(pageAgent, { op: 'end' }).catch(() => null), 1500, null);
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
