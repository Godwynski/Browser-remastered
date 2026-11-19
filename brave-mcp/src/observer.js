import { evalAgent, handleAgent } from './page-agent.js';

export class StaleRefError extends Error {}

const FRAME_TIMEOUT = 1200;
const AD_FRAME = /doubleclick|googlesyndication|googletagmanager|google-analytics|adsystem|adnxs|taboola|outbrain|criteo|pubmatic|rubiconproject|facebook\.com\/tr/i;

function withTimeout(promise, ms, fallback) {
  let t;
  return Promise.race([promise, new Promise(r => { t = setTimeout(() => r(fallback), ms); })]).finally(() => clearTimeout(t));
}

function usableFrames(page) {
  const main = page.mainFrame();
  const out = [main];
  for (const f of page.frames()) {
    if (f === main || f.isDetached()) continue;
    const u = f.url();
    if (!u || u === 'about:blank' || u.startsWith('javascript:') || AD_FRAME.test(u)) continue;
    out.push(f);
    if (out.length >= 6) break;
  }
  return out;
}

/** Per-page ref registry: maps stable page-level refs (e12) to {frame, lid, doc}. */
export function pageState(page) {
  if (!page._bm) page._bm = {};
  const bm = page._bm;
  if (!bm.refs) {
    bm.next = 1;
    bm.refs = new Map();     // ref -> { frame, lid, doc, sig }
    bm.byKey = new Map();    // frameKey:doc:lid -> ref
    bm.seen = new Map();     // ref -> signature string the model has seen
    bm.frameIds = new WeakMap();
    bm.frameSeq = 0;
    bm.mainDoc = null;
  }
  return bm;
}

function frameKey(bm, frame) {
  let k = bm.frameIds.get(frame);
  if (!k) { k = ++bm.frameSeq; bm.frameIds.set(frame, k); }
  return k;
}

function shortUrl(u) {
  try {
    const x = new URL(u);
    if (x.protocol === 'about:' || x.protocol === 'data:') return u.slice(0, 40);
    const s = x.host + x.pathname.replace(/\/$/, '') + (x.search.length > 1 ? x.search.slice(0, 30) + (x.search.length > 30 ? '…' : '') : '');
    return s.length > 80 ? s.slice(0, 79) + '…' : s;
  } catch (_) {
    return String(u).slice(0, 80);
  }
}

function line(e) {
  let s = `${e.ref} ${e.role}${e.sub ? ':' + e.sub : ''}`;
  if (e.name) s += ` "${e.name}"`;
  if (e.value !== undefined && e.value !== '') s += ` ="${e.value}"`;
  if (e.flags) s += ` [${e.flags.join(',')}]`;
  return s;
}

const sigOf = (e) => `${e.role}|${e.name}|${e.value ?? ''}|${(e.flags || []).join(',')}`;

export class BrowserObserver {
  /**
   * Observes a page across all frames in parallel (one evaluate per frame).
   * Refs are stable for an element's lifetime, so deltas can be computed.
   */
  async observe(page, options = {}) {
    const {
      includeScreenshot = false,
      screenshotScope = null,
      labels = false,
      clip = null,
      maxElements = 40,
      scope = null,
      filter = null,
      visibleOnly = false,
      delta = false,
      tabId = null
    } = options;

    const bm = pageState(page);
    const mainFrame = page.mainFrame();
    const frames = usableFrames(page);

    // Which already-seen refs belong to which frame (to detect removals).
    const seenByFrame = new Map();
    for (const ref of bm.seen.keys()) {
      const r = bm.refs.get(ref);
      if (!r) continue;
      if (!seenByFrame.has(r.frame)) seenByFrame.set(r.frame, []);
      seenByFrame.get(r.frame).push(r.lid);
    }

    const results = await Promise.all(frames.map((frame) => {
      const isMain = frame === mainFrame;
      const req = {
        op: 'observe',
        scope: isMain ? scope : null,
        filter: filter === 'all' || filter === 'interactive' ? null : (filter === 'buttons_links' ? 'clickable' : filter),
        max: isMain ? maxElements : Math.min(12, maxElements),
        visibleOnly,
        seen: seenByFrame.get(frame) || []
      };
      const run = evalAgent(frame, req).catch(err => ({ error: err.message }));
      return withTimeout(run, FRAME_TIMEOUT, { error: 'frame timed out' });
    }));

    const main = results[frames.indexOf(mainFrame)];
    if (!main || main.error) {
      if (main?.error && /scope/.test(main.error)) throw new Error(main.error);
      throw new Error(`Could not read page (${main?.error || 'no main frame'}). The tab may be frozen, discarded, or blocked by a dialog.`);
    }

    // Navigation (new main document) resets what the model has seen; refs keep counting up so old refs can't alias.
    const navigated = bm.mainDoc !== null && bm.mainDoc !== main.doc;
    if (navigated || bm.mainDoc === null) {
      bm.seen.clear();
      for (const [ref, r] of bm.refs) if (r.frame === mainFrame) bm.refs.delete(ref);
    }
    bm.mainDoc = main.doc;

    const elements = [];
    const gone = [];
    frames.forEach((frame, i) => {
      const res = results[i];
      if (!res || res.error || !res.items) return;
      const fk = frameKey(bm, frame);
      for (const lid of res.gone || []) {
        const ref = bm.byKey.get(`${fk}:${res.doc}:${lid}`);
        if (ref) gone.push(ref);
      }
      for (const it of res.items) {
        const key = `${fk}:${res.doc}:${it.lid}`;
        let ref = bm.byKey.get(key);
        if (!ref) {
          ref = `e${bm.next++}`;
          bm.byKey.set(key, ref);
        }
        bm.refs.set(ref, { frame, lid: it.lid, doc: res.doc, sig: { role: it.role, name: it.name } });
        elements.push({
          ref,
          role: it.role,
          name: it.name || undefined,
          value: it.value,
          sub: it.sub,
          flags: it.flags,
          checked: it.flags?.includes('checked') || undefined,
          disabled: it.flags?.includes('disabled') || undefined,
          inViewport: it.pos === 0,
          pos: it.pos,
          frameIndex: frame === mainFrame ? null : i,
          domMeta: { id: it.id, type: it.type, tag: it.tag, centerX: it.x, centerY: it.y }
        });
      }
    });

    // ---- delta vs what the model has already seen ----
    const added = [], changed = [];
    for (const e of elements) {
      const prev = bm.seen.get(e.ref);
      if (prev === undefined) added.push(e);
      else if (prev !== sigOf(e)) changed.push(e);
    }
    const goneRefs = gone.filter(r => bm.seen.has(r));
    const tooBig = elements.length > 10 && added.length + changed.length > elements.length * 0.6;
    const useDelta = delta && !navigated && bm.seen.size > 0 && !tooBig;

    if (useDelta) {
      for (const e of [...added, ...changed]) bm.seen.set(e.ref, sigOf(e));
      for (const r of goneRefs) bm.seen.delete(r);
    } else {
      bm.seen.clear();
      for (const e of elements) bm.seen.set(e.ref, sigOf(e));
    }

    const header = `# ${main.title || 'Untitled'} | ${shortUrl(main.url)}${tabId ? ' | ' + tabId : ''} | y${main.y}/${main.h}${main.modal ? ` | modal "${main.modal}"` : ''}`;
    // In delta mode the header is only repeated when it changed.
    const out = useDelta && bm.lastHeader === header ? [] : [header];
    bm.lastHeader = header;
    for (const a of main.alerts || []) {
      if (useDelta && bm.lastAlerts?.includes(a)) continue;
      out.push(`! ${a}`);
    }
    bm.lastAlerts = main.alerts || [];

    if (useDelta) {
      for (const e of added) out.push('+ ' + line(e));
      for (const e of changed) out.push('~ ' + line(e));
      if (goneRefs.length) out.push('- ' + goneRefs.join(' '));
      if (!added.length && !changed.length && !goneRefs.length) out.push('(no element changes)');
    } else {
      const inView = elements.filter(e => e.pos === 0);
      const below = elements.filter(e => e.pos === 1);
      const above = elements.filter(e => e.pos === -1);
      if (!elements.length) out.push('(no interactive elements)');
      for (const e of inView) out.push(line(e));
      if (above.length) { out.push('above:'); for (const e of above) out.push(line(e)); }
      if (below.length) { out.push('below:'); for (const e of below) out.push(line(e)); }
      const m = main.more || {};
      const extra = (m.inView || 0) + (m.below || 0) + (m.above || 0);
      if (extra) out.push(`(+${extra} more not listed; scroll, raise max, or use scope)`);
    }

    // ---- screenshot ----
    let screenshot = null;
    if (includeScreenshot || screenshotScope || clip) {
      screenshot = await this._screenshot(page, { screenshotScope, clip, labels, elements, bm });
    }

    const obsId = `obs_${Date.now()}`;
    bm.obsId = obsId;
    return {
      obs_id: obsId,
      navigated,
      delta: useDelta,
      tab: { title: main.title, url: main.url },
      page: { scroll: { y: main.y, documentHeight: main.h }, viewportHeight: main.vh, modal: main.modal },
      alerts: main.alerts || [],
      element_count: elements.length,
      elements,
      elements_compact: out.join('\n'),
      screenshot
    };
  }

  async _screenshot(page, { screenshotScope, clip, labels, elements, bm }) {
    const opts = { type: 'jpeg', quality: 60, scale: 'css', timeout: 5000 };
    let labeled = false;
    try {
      if (labels) {
        const items = elements.filter(e => e.frameIndex === null && e.pos === 0).map(e => ({ lid: bm.refs.get(e.ref).lid, ref: e.ref }));
        labeled = await evalAgent(page.mainFrame(), { op: 'labels', items }).catch(() => false);
      }
      let buf;
      if (screenshotScope) {
        buf = await page.locator(screenshotScope).first().screenshot(opts);
      } else if (clip) {
        const c = Array.isArray(clip) ? { x: clip[0], y: clip[1], width: clip[2], height: clip[3] } : clip;
        buf = await page.screenshot({ ...opts, clip: { x: Math.round(c.x), y: Math.round(c.y), width: Math.round(c.width || c.w || 200), height: Math.round(c.height || c.h || 200) } });
      } else {
        buf = await page.screenshot(opts);
      }
      return `data:image/jpeg;base64,${buf.toString('base64')}`;
    } catch (_) {
      return null;
    } finally {
      if (labeled) await evalAgent(page.mainFrame(), { op: 'unlabels' }).catch(() => {});
    }
  }

  /** Registers an element found by text/role/css and returns its ref. */
  async find(page, query) {
    const bm = pageState(page);
    const frames = usableFrames(page);
    for (const frame of frames) {
      const res = await withTimeout(evalAgent(frame, { op: 'find', ...query }).catch(() => null), FRAME_TIMEOUT, null);
      if (res?.error) throw new Error(res.error);
      if (!res) continue;
      const doc = res.doc || await evalAgent(frame, { op: 'ping' });
      const fk = frameKey(bm, frame);
      const key = `${fk}:${doc}:${res.lid}`;
      let ref = bm.byKey.get(key);
      if (!ref) { ref = `e${bm.next++}`; bm.byKey.set(key, ref); }
      bm.refs.set(ref, { frame, lid: res.lid, doc, sig: { role: res.role, name: res.name } });
      return { ref, role: res.role, name: res.name };
    }
    return null;
  }

  /** Resolves a ref to a live ElementHandle, self-healing re-rendered nodes. */
  async handle(page, ref) {
    const bm = pageState(page);
    const r = bm.refs.get(ref);
    if (!r) {
      throw new StaleRefError(bm.next > 1
        ? `Ref '${ref}' is not on this page (it may be from before a navigation).`
        : `No refs yet. Call brave_observe first or target by text, e.g. ref:"Sign in".`);
    }
    if (r.frame.isDetached()) throw new StaleRefError(`Ref '${ref}' was inside a frame that is gone.`);
    const h = await handleAgent(r.frame, { op: 'get', lid: r.lid, doc: r.doc, sig: r.sig });
    const el = h.asElement();
    if (!el) {
      await h.dispose().catch(() => {});
      throw new StaleRefError(`Ref '${ref}' ("${r.sig.name || r.sig.role}") no longer exists.`);
    }
    return { el, frame: r.frame, info: r.sig };
  }

  invalidate(page = null) {
    if (page?._bm?.seen) page._bm.seen.clear();
  }
}
