import { pageState } from './observer.js';

/** Downloads seen across the browser (from Playwright events or CDP Browser.download*). */
export const downloadsLog = [];

export function logDownload(entry) {
  const dup = downloadsLog.find(d => d.filename === entry.filename && Math.abs(d.t - entry.t) < 2000);
  if (dup) { Object.assign(dup, entry, { t: dup.t }); return; }
  downloadsLog.push(entry);
  if (downloadsLog.length > 50) downloadsLog.shift();
}

const TRACKED = new Set(['xhr', 'fetch', 'document']);

/** Rough registrable domain: last two host labels (three for e.g. co.uk). */
function site(url) {
  try {
    const parts = new URL(url).hostname.split('.');
    const n = parts.length > 2 && parts[parts.length - 2].length <= 3 && parts[parts.length - 1].length === 2 ? 3 : 2;
    return parts.slice(-n).join('.');
  } catch (_) { return ''; }
}

/**
 * Idempotently wires a page for agent use:
 * - in-flight request tracking (for deterministic settle)
 * - recent XHR/fetch response log (brave_read network mode)
 * - dialog policy: auto-answer ONLY while an agent action runs; otherwise leave it for the user
 * - popups opened by agent actions
 */
export function attachPage(page, { onPopup } = {}) {
  const bm = pageState(page);
  if (bm.hooked) return bm;
  bm.hooked = true;
  bm.pending = new Map();
  bm.net = [];
  bm.netSeq = 0;
  bm.busy = false;

  // Only same-site requests gate "settled": ads, analytics and trackers never finish meaningfully.
  page.on('request', (req) => {
    if (!TRACKED.has(req.resourceType())) return;
    if (req.resourceType() !== 'document' && site(req.url()) !== site(page.url())) return;
    bm.pending.set(req, Date.now());
  });
  const done = (req) => bm.pending.delete(req);
  page.on('requestfinished', done);
  page.on('requestfailed', done);

  page.on('response', (resp) => {
    const type = resp.request().resourceType();
    if (type !== 'xhr' && type !== 'fetch') return;
    const h = resp.headers();
    bm.net.push({
      n: ++bm.netSeq,
      method: resp.request().method(),
      status: resp.status(),
      url: resp.url(),
      ctype: (h['content-type'] || '').split(';')[0].replace(/^application\//, ''),
      size: Number(h['content-length']) || undefined,
      resp,
      t: Date.now()
    });
    if (bm.net.length > 40) bm.net.shift();
  });

  page.on('dialog', async (dialog) => {
    if (!bm.busy) {
      bm.pendingDialog = dialog; // the user's dialog: never auto-answer it
      return;
    }
    const policy = bm.dialogPolicy || {};
    const accept = policy.accept !== false;
    bm.lastDialog = { type: dialog.type(), message: dialog.message().slice(0, 150), accepted: accept, t: Date.now() };
    try {
      if (accept) await dialog.accept(policy.text ?? dialog.defaultValue());
      else await dialog.dismiss();
    } catch (_) {}
  });

  page.on('popup', (popup) => {
    if (!bm.busy) return;
    bm.popup = popup;
    if (onPopup) onPopup(popup);
  });

  page.on('download', (dl) => {
    logDownload({ filename: dl.suggestedFilename(), url: dl.url(), t: Date.now(), state: 'started' });
  });

  return bm;
}

/** Requests started after `since` that are still running (ignores long-polls older than 3s). */
export function inflight(bm, since) {
  const now = Date.now();
  let n = 0;
  for (const t of bm.pending?.values() || []) if (t >= since && now - t < 3000) n++;
  return n;
}
