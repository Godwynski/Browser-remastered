/**
 * In-page agent. Self-installs on window[Symbol.for('brave-mcp')].call so repeat
 * invocations via runPageAgent only transmit the tiny request object over CDP.
 *
 * Ops: observe, get, find, begin, status, end, text, labels, flash, scroll, ping
 */
export function pageAgent(req) {
  const KEY = Symbol.for('brave-mcp');
  let A = window[KEY];
  if (!A || !A.call) {
    A = A || {
      doc: Math.random().toString(36).slice(2, 8),
      seq: 0,
      els: new Map(),        // lid -> WeakRef<Element>
      ids: new WeakMap(),    // Element -> lid
      lastMut: Date.now(),
      rec: false,
      added: [],
      userAt: 0,
      busy: false,
      shadows: null,
      shadowsAt: -1
    };
    Object.defineProperty(window, KEY, { value: A, enumerable: false, configurable: true });
    if (!A.hooked) {
      A.hooked = true;
      const markUser = (e) => { if (!A.busy && e.isTrusted) A.userAt = Date.now(); };
      for (const t of ['keydown', 'pointerdown', 'wheel', 'input']) {
        window.addEventListener(t, markUser, { capture: true, passive: true });
      }
      try {
        new MutationObserver((recs) => {
          A.lastMut = Date.now();
          if (!A.rec || A.added.length >= 60) return;
          for (const r of recs) {
            if (r.type === 'characterData') A.added.push(r.target.parentElement);
            else for (const n of r.addedNodes) A.added.push(n.nodeType === 3 ? n.parentElement : n);
            if (A.added.length >= 60) break;
          }
        }).observe(document, { subtree: true, childList: true, characterData: true });
      } catch (_) {}
    }

    const clean = (s, n = 60) => {
      s = (s || '').replace(/\s+/g, ' ').trim();
      return s.length > n ? s.slice(0, n - 1) + '…' : s;
    };

    const CLICK_ROLES = 'button,link,checkbox,radio,switch,tab,menuitem,menuitemcheckbox,menuitemradio,option,treeitem';
    const INPUT_ROLES = 'textbox,searchbox,combobox,slider,spinbutton,listbox';
    const SEL =
      'a[href],button,input:not([type=hidden]),select,textarea,summary,' +
      '[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"],' +
      (CLICK_ROLES + ',' + INPUT_ROLES).split(',').map(r => `[role="${r}"]`).join(',') +
      ',[onclick],[tabindex]:not([tabindex="-1"])';

    function roleOf(el) {
      const r = (el.getAttribute('role') || '').split(' ')[0];
      if (r) return r;
      const tag = el.tagName.toLowerCase();
      if (tag === 'a') return 'link';
      if (tag === 'button' || tag === 'summary') return 'button';
      if (tag === 'select') return el.multiple ? 'listbox' : 'combobox';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'input') {
        const t = (el.type || 'text').toLowerCase();
        if (['button', 'submit', 'reset', 'image'].includes(t)) return 'button';
        if (t === 'checkbox' || t === 'radio') return t;
        if (t === 'range') return 'slider';
        if (t === 'number') return 'spinbutton';
        if (t === 'search') return 'searchbox';
        if (t === 'file') return 'file';
        return 'textbox';
      }
      if (el.isContentEditable) return 'textbox';
      return 'clickable';
    }

    function nameOf(el) {
      let s = el.getAttribute('aria-label');
      if (!s) {
        const lb = el.getAttribute('aria-labelledby');
        if (lb) {
          const root = el.getRootNode();
          s = lb.split(/\s+/).map(id => (root.getElementById ? root.getElementById(id) : document.getElementById(id))?.textContent || '').join(' ');
        }
      }
      const tag = el.tagName.toLowerCase();
      const isField = tag === 'input' || tag === 'textarea' || tag === 'select';
      if (!clean(s) && isField && el.labels && el.labels.length) s = el.labels[0].innerText;
      if (!clean(s) && isField) s = el.getAttribute('placeholder') || el.getAttribute('title');
      if (!clean(s) && tag === 'input' && ['button', 'submit', 'reset'].includes(el.type)) s = el.value;
      if (!clean(s) && !isField && !el.isContentEditable) s = el.innerText;
      if (!clean(s)) {
        s = el.getAttribute('title') || el.querySelector?.('img[alt]')?.getAttribute('alt') ||
          el.querySelector?.('svg title')?.textContent || el.getAttribute('placeholder') ||
          el.getAttribute('name') || el.getAttribute('alt') || '';
      }
      return clean(s);
    }

    function visible(el) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) {
        if (getComputedStyle(el).display === 'contents' && el.firstElementChild) return visible(el.firstElementChild);
        return false;
      }
      if (el.checkVisibility) return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0';
    }

    function usableHidden(el) {
      if (el.tagName !== 'INPUT') return false;
      const t = el.type;
      if (t === 'file') return Boolean(nameOf(el));
      if ((t === 'checkbox' || t === 'radio') && el.labels && el.labels.length) return visible(el.labels[0]);
      return false;
    }

    // Cache open shadow roots until the next DOM mutation so we don't TreeWalk the whole page on every query.
    function getShadows(root) {
      if (root === document && A.shadows && A.shadowsAt === A.lastMut) return A.shadows;
      const roots = [];
      const scan = (r) => {
        const walker = document.createTreeWalker(r, NodeFilter.SHOW_ELEMENT);
        let n = walker.currentNode;
        while (n) {
          if (n.shadowRoot && n !== A.overlay) {
            roots.push(n.shadowRoot);
            scan(n.shadowRoot);
          }
          n = walker.nextNode();
        }
      };
      scan(root);
      if (root === document) { A.shadows = roots; A.shadowsAt = A.lastMut; }
      return roots;
    }

    function deepAll(root, sel, out) {
      for (const el of root.querySelectorAll(sel)) out.push(el);
      for (const sr of getShadows(root)) {
        if (root === document || root.contains(sr.host)) {
          for (const el of sr.querySelectorAll(sel)) out.push(el);
        }
      }
      return out;
    }

    // React/Vue style click handlers on non-semantic tags: only scan when standard interactive elements are sparse.
    function pointerCandidates(root, have, vw, vh) {
      if (have.size >= 25) return [];
      const out = [];
      const hasInteractive = (el) => {
        for (const h of have) if (el !== h && (el.contains(h) || h.contains(el))) return true;
        return false;
      };
      const cands = root.querySelectorAll('div, span, li, td, tr, article, section');
      const limit = Math.min(cands.length, 600);
      for (let i = 0; i < limit && out.length < 25; i++) {
        const n = cands[i];
        if (have.has(n) || n.children.length > 6) continue;
        const r = n.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0 || r.bottom <= 0 || r.top >= vh || r.width >= vw * 0.9 || r.height >= vh * 0.5) continue;
        if (getComputedStyle(n).cursor === 'pointer') {
          const parent = n.parentElement;
          if (parent && getComputedStyle(parent).cursor === 'pointer') continue;
          if (!hasInteractive(n) && clean(n.innerText || n.getAttribute('aria-label') || n.getAttribute('title'))) {
            out.push(n);
          }
        }
      }
      return out;
    }

    function lidOf(el) {
      let lid = A.ids.get(el);
      if (!lid) {
        lid = ++A.seq;
        A.ids.set(el, lid);
        A.els.set(lid, new WeakRef(el));
      }
      return lid;
    }

    function stateOf(el, role) {
      const tag = el.tagName.toLowerCase();
      const f = [];
      const aria = (k) => el.getAttribute(k);
      if (el.checked || aria('aria-checked') === 'true') f.push('checked');
      if (aria('aria-selected') === 'true') f.push('selected');
      if (aria('aria-pressed') === 'true') f.push('pressed');
      if (aria('aria-expanded') === 'true') f.push('expanded');
      else if (aria('aria-expanded') === 'false') f.push('collapsed');
      if (el.disabled || aria('aria-disabled') === 'true') f.push('disabled');
      if (aria('aria-invalid') === 'true') f.push('invalid');
      let value;
      if (tag === 'select') value = Array.from(el.selectedOptions || []).map(o => o.text).join(', ');
      else if (tag === 'input' || tag === 'textarea') {
        const t = el.type;
        if (t === 'password') value = el.value ? '••••' : '';
        else if (t !== 'checkbox' && t !== 'radio' && !['button', 'submit', 'reset'].includes(t)) value = el.value;
      } else if (el.isContentEditable && role === 'textbox') value = el.innerText;
      else if (aria('aria-valuenow')) value = aria('aria-valuetext') || aria('aria-valuenow');
      let sub;
      if (tag === 'input' && role === 'textbox' && el.type && el.type !== 'text') sub = el.type;
      return { flags: f, value: value ? clean(value, 50) : undefined, sub };
    }

    function collect(root, filter, vw, vh) {
      const els = deepAll(root, SEL, []);
      const seen = new Set();
      const list = [];
      for (const el of els) {
        if (seen.has(el)) continue;
        seen.add(el);
        if (A.overlay && A.overlay.contains(el)) continue;
        if (!visible(el) && !usableHidden(el)) continue;
        if (el.matches('[tabindex]:not(a,button,input,select,textarea,[role])') && el.querySelector('a,button,input,select,textarea')) continue;
        const role = roleOf(el);
        const isField = INPUT_ROLES.includes(role) || role === 'textbox' || role === 'file' || role === 'checkbox' || role === 'radio';
        if (filter === 'inputs' && !isField) continue;
        if (filter === 'clickable' && isField && role !== 'checkbox' && role !== 'radio') continue;
        const name = nameOf(el);
        if (!name && !isField) continue;
        list.push({ el, role, name });
      }
      if (filter !== 'inputs') {
        const have = new Set(list.map(i => i.el));
        for (const el of pointerCandidates(root, have, vw, vh)) list.push({ el, role: 'clickable', name: nameOf(el) });
      }
      return list;
    }

    function findModal() {
      const cands = deepAll(document, 'dialog[open],[aria-modal="true"]', []).filter(m => {
        if (!visible(m)) return false;
        if (m.tagName === 'DIALOG') { try { return m.matches(':modal'); } catch (_) { return true; } }
        return true;
      });
      return cands.length ? cands[cands.length - 1] : null;
    }

    function alertsOf() {
      const nodes = deepAll(document, '[role="alert"],[role="alertdialog"],[role="status"],[aria-live="assertive"],[aria-live="polite"],[aria-invalid="true"]+*,.error,.error-message,.invalid-feedback,.toast,.alert', []);
      const out = [];
      for (const n of nodes) {
        const t = clean(n.innerText || n.textContent, 120);
        if (t && visible(n) && !out.includes(t)) out.push(t);
        if (out.length >= 3) break;
      }
      return out;
    }

    function locate(el, vh) {
      const r = el.getBoundingClientRect();
      const pos = r.bottom < 0 ? -1 : (r.top > vh ? 1 : 0);
      return { pos, x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
    }

    function isGone(el) {
      return !el || !el.isConnected || (!visible(el) && !usableHidden(el));
    }

    function textOf(el) {
      if (!el || el.nodeType !== 1 || !el.isConnected) return '';
      if (A.overlay && A.overlay.contains(el)) return '';
      if (!visible(el)) return '';
      return clean(el.innerText || el.textContent, 120);
    }

    function resolve(lid, doc, sig, vw, vh) {
      if (doc && doc !== A.doc) return null;
      const ref = A.els.get(lid);
      const el = ref && ref.deref();
      if (el && el.isConnected) return el;
      if (!sig || !sig.name) return null;
      const matches = collect(document, null, vw, vh).filter(i => i.role === sig.role && i.name === sig.name);
      if (matches.length !== 1) return null;
      const fresh = matches[0].el;
      A.ids.set(fresh, lid);
      A.els.set(lid, new WeakRef(fresh));
      return fresh;
    }

    function score(name, q) {
      const n = name.toLowerCase();
      if (n === q) return 4;
      if (n.startsWith(q)) return 3;
      if (n.split(/\W+/).includes(q)) return 2;
      if (n.includes(q)) return 1;
      return 0;
    }

    function find({ role, name, css }, vw, vh) {
      if (css) {
        let el = null;
        try { el = document.querySelector(css); } catch (e) { return { error: `bad selector: ${e.message}` }; }
        if (!el) {
          for (const sr of getShadows(document)) {
            try { el = sr.querySelector(css); } catch (_) {}
            if (el) break;
          }
        }
        return el ? { lid: lidOf(el), role: roleOf(el), name: nameOf(el), doc: A.doc } : null;
      }
      const q = clean(name, 200).toLowerCase();
      let best = null, bestScore = 0;
      for (const item of collect(document, null, vw, vh)) {
        if (role && item.role !== role) continue;
        let s = score(item.name, q);
        if (!s) continue;
        if (locate(item.el, vh).pos === 0) s += 0.5;
        if (s > bestScore) { best = item; bestScore = s; }
      }
      if (!best && !role) {
        const walker = document.createTreeWalker(document.body || document, NodeFilter.SHOW_TEXT);
        let t;
        while ((t = walker.nextNode())) {
          if (t.nodeValue.toLowerCase().includes(q) && t.parentElement && visible(t.parentElement)) {
            const el = t.parentElement;
            return { lid: lidOf(el), role: roleOf(el), name: nameOf(el) || clean(t.nodeValue), doc: A.doc };
          }
        }
      }
      return best ? { lid: lidOf(best.el), role: best.role, name: best.name, doc: A.doc } : null;
    }

    function scrollPage({ dir, amount, lid }, vw, vh) {
      let box = lid ? resolve(lid, null, null, vw, vh) : null;
      const scrollable = (el) => {
        if (!el || el === document.body || el === document.documentElement) return false;
        const cs = getComputedStyle(el);
        const y = /(auto|scroll|overlay)/.test(cs.overflowY) && el.scrollHeight > el.clientHeight + 4;
        const x = /(auto|scroll|overlay)/.test(cs.overflowX) && el.scrollWidth > el.clientWidth + 4;
        return dir === 'left' || dir === 'right' ? x : y;
      };
      if (box && !scrollable(box)) { let p = box.parentElement; while (p && !scrollable(p)) p = p.parentElement; box = p; }
      if (!box) {
        const root = document.scrollingElement || document.documentElement;
        const pageScrolls = root.scrollHeight > root.clientHeight + 4 && getComputedStyle(document.body || root).overflowY !== 'hidden';
        if (!pageScrolls || dir === 'left' || dir === 'right') {
          let p = document.elementFromPoint(vw / 2, vh / 2);
          while (p && !scrollable(p)) p = p.parentElement;
          box = p;
        }
      }
      const target = box || document.scrollingElement || document.documentElement;
      const before = [target.scrollLeft, target.scrollTop];
      const step = amount || Math.round((box ? box.clientHeight : vh) * 0.8);
      if (dir === 'top') target.scrollTop = 0;
      else if (dir === 'bottom') target.scrollTop = target.scrollHeight;
      else if (dir === 'up') target.scrollTop -= step;
      else if (dir === 'left') target.scrollLeft -= step;
      else if (dir === 'right') target.scrollLeft += step;
      else target.scrollTop += step;
      const moved = before[0] !== target.scrollLeft || before[1] !== target.scrollTop;
      return { moved, container: box ? (box.id ? '#' + box.id : box.tagName.toLowerCase()) : 'page', y: Math.round(target.scrollTop), h: target.scrollHeight };
    }

    function overlayRoot() {
      if (A.overlay && A.overlay.isConnected) return A.overlay;
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
      host.attachShadow({ mode: 'open' });
      (document.body || document.documentElement).appendChild(host);
      A.overlay = host;
      return host;
    }

    function box(root, r, color, label) {
      const d = document.createElement('div');
      d.style.cssText = `position:fixed;left:${r.left - 2}px;top:${r.top - 2}px;width:${r.width + 4}px;height:${r.height + 4}px;border:2px solid ${color};border-radius:4px;box-sizing:border-box;transition:opacity .4s;`;
      if (label) {
        const t = document.createElement('span');
        t.textContent = label;
        t.style.cssText = `position:absolute;left:-2px;top:-14px;background:${color};color:#fff;font:bold 10px/12px monospace;padding:0 2px;border-radius:2px;`;
        d.appendChild(t);
      }
      root.shadowRoot.appendChild(d);
      return d;
    }

    A.call = (r) => {
      const vw = window.innerWidth || document.documentElement.clientWidth || 0;
      const vh = window.innerHeight || document.documentElement.clientHeight || 0;
      const { op } = r;

      if (op === 'ping') return A.doc;

      if (op === 'observe') {
        const { scope, filter, max = 40, visibleOnly, seen = [] } = r;
        let root = document, modal = null;
        if (scope) {
          try { root = document.querySelector(scope); } catch (e) { return { error: `bad scope selector: ${e.message}` }; }
          if (!root) return { error: `scope "${scope}" not found` };
        } else {
          const m = findModal();
          if (m) {
            root = m;
            const lb = m.getAttribute('aria-labelledby');
            modal = clean(m.getAttribute('aria-label') || (lb && document.getElementById(lb)?.textContent) ||
              m.querySelector('h1,h2,h3,h4,[role=heading]')?.textContent, 50) || 'dialog';
          }
        }
        const tiny = vw * vh < 2500;
        const raw = tiny ? [] : collect(root, filter, vw, vh);
        const rows = raw.map((i, order) => ({ ...i, ...locate(i.el, vh), order }));
        rows.sort((a, b) => (a.pos === 0 ? 0 : a.pos === 1 ? 1 : 2) - (b.pos === 0 ? 0 : b.pos === 1 ? 1 : 2) || a.order - b.order);
        const pool = visibleOnly ? rows.filter(x => x.pos === 0) : rows;
        const items = pool.slice(0, max).map(x => {
          const lid = lidOf(x.el);
          const st = stateOf(x.el, x.role);
          return {
            lid, role: x.role, name: x.name, pos: x.pos, x: x.x, y: x.y,
            flags: st.flags.length ? st.flags : undefined, value: st.value, sub: st.sub,
            id: x.el.id || undefined, type: x.el.getAttribute('type') || undefined, tag: x.el.tagName.toLowerCase()
          };
        });
        const gone = [];
        for (const lid of seen) {
          const el = A.els.get(lid)?.deref();
          if (isGone(el)) gone.push(lid);
        }
        const se = document.scrollingElement || document.documentElement;
        return {
          doc: A.doc, title: document.title, url: location.href, modal, gone,
          y: Math.round(se.scrollTop), h: se.scrollHeight, vh,
          alerts: alertsOf(), items,
          more: { below: pool.slice(max).filter(x => x.pos === 1).length, above: pool.slice(max).filter(x => x.pos === -1).length, inView: pool.slice(max).filter(x => x.pos === 0).length }
        };
      }

      if (op === 'get') return resolve(r.lid, r.doc, r.sig, vw, vh);
      if (op === 'find') return find(r, vw, vh);

      if (op === 'begin') {
        A.busy = true;
        A.rec = true;
        A.added = [];
        const d = window[Symbol.for('brave-mcp-dialog')];
        return { doc: A.doc, title: document.title, url: location.href, userIdle: Date.now() - A.userAt, ready: document.readyState, dialog: d };
      }

      if (op === 'status') return { quiet: Date.now() - A.lastMut, mutAt: A.lastMut, ready: document.readyState, doc: A.doc, userIdle: Date.now() - A.userAt };

      if (op === 'end') {
        A.busy = false;
        A.rec = false;
        const texts = [];
        for (const n of A.added) {
          const t = textOf(n);
          if (t && t.length > 2 && !texts.some(x => x.includes(t) || t.includes(x))) texts.push(t);
        }
        A.added = [];
        return { doc: A.doc, title: document.title, url: location.href, texts: texts.slice(-3) };
      }

      if (op === 'text') {
        const body = (document.body && document.body.innerText) || '';
        return body.toLowerCase().includes(String(r.q).toLowerCase());
      }

      if (op === 'scroll') return scrollPage(r, vw, vh);

      if (op === 'labels') {
        const root = overlayRoot();
        for (const { lid, ref } of r.items) {
          const el = A.els.get(lid)?.deref();
          if (!el || !el.isConnected) continue;
          const rect = el.getBoundingClientRect();
          if (rect.bottom < 0 || rect.top > vh) continue;
          box(root, rect, '#d6336c', ref);
        }
        return true;
      }

      if (op === 'unlabels') {
        if (A.overlay) A.overlay.shadowRoot.replaceChildren();
        return true;
      }

      return null;
    };
  }
  return A.call(req);
}

const FAST_CALL = (req) => {
  const A = window[Symbol.for('brave-mcp')];
  return A && A.call ? A.call(req) : undefined;
};

/** Fast path: calls pre-installed A.call in 1 line; installs pageAgent only if the frame navigated. */
export async function evalAgent(frame, req) {
  const res = await frame.evaluate(FAST_CALL, req);
  if (res !== undefined) return res;
  return frame.evaluate(pageAgent, req);
}

export async function handleAgent(frame, req) {
  const h = await frame.evaluateHandle(FAST_CALL, req);
  if (h.asElement()) return h;
  const isUndef = await h.evaluate(v => v === undefined).catch(() => false);
  await h.dispose().catch(() => {});
  if (!isUndef) return frame.evaluateHandle(() => null);
  return frame.evaluateHandle(pageAgent, req);
}

/** Element-level helper: briefly outline what the agent is about to touch (co-browsing visibility). */
export function flashElement(el) {
  try {
    const A = window[Symbol.for('brave-mcp')];
    if (!A) return;
    let host = A.overlay;
    if (!host || !host.isConnected) {
      host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483647;';
      host.attachShadow({ mode: 'open' });
      (document.body || document.documentElement).appendChild(host);
      A.overlay = host;
    }
    const r = el.getBoundingClientRect();
    const d = document.createElement('div');
    d.style.cssText = `position:fixed;left:${r.left - 3}px;top:${r.top - 3}px;width:${r.width + 6}px;height:${r.height + 6}px;border:2px solid #7c3aed;border-radius:6px;box-shadow:0 0 0 4px rgba(124,58,237,.25);box-sizing:border-box;transition:opacity .5s;`;
    host.shadowRoot.appendChild(d);
    setTimeout(() => { d.style.opacity = '0'; setTimeout(() => d.remove(), 500); }, 600);
  } catch (_) {}
}
