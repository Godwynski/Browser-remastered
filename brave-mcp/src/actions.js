import { pageAgent, flashElement } from './page-agent.js';
import { attachPage } from './page-hooks.js';
import { pageState } from './observer.js';

const HIGHLIGHT = process.env.BRAVE_MCP_HIGHLIGHT !== '0';

const ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'combobox', 'listbox', 'checkbox', 'radio', 'switch',
  'tab', 'menuitem', 'option', 'slider', 'spinbutton', 'treeitem', 'file', 'clickable'
]);

const STATEFUL = new Set(['checkbox', 'radio', 'switch', 'textbox', 'searchbox', 'combobox', 'listbox', 'slider', 'spinbutton', 'file']);

const ALIASES = { select_option: 'select', upload_file: 'upload', navigate: 'goto', key: 'press' };

/** Accepts legacy and shorthand parameter names so any agent's guess works. */
export function normalizeStep(p = {}) {
  const s = { ...p };
  s.action = ALIASES[s.action] || s.action;
  if (s.xy === undefined) s.xy = s.coordinate ?? (s.x !== undefined && s.y !== undefined ? [s.x, s.y] : undefined);
  if (s.enter === undefined && s.pressEnter !== undefined) s.enter = s.pressEnter;
  if (s.files === undefined) s.files = s.filePaths;
  if (typeof s.files === 'string') s.files = [s.files];
  if (s.dir === undefined) s.dir = s.direction;
  if (s.slowly === undefined) s.slowly = s.humanLike;
  if (s.to === undefined) s.to = s.endRef ?? s.endCoordinate;
  if (s.ref === undefined && s.startRef !== undefined) s.ref = s.startRef;
  if (s.xy === undefined && s.startCoordinate !== undefined) s.xy = s.startCoordinate;
  if (s.action === 'press' && !s.key && s.text) s.key = s.text;
  if (s.action === 'select' && s.value === undefined && s.text !== undefined) s.value = s.text;
  return s;
}

function parseXY(v) {
  if (Array.isArray(v) && v.length >= 2) return [Math.round(+v[0]), Math.round(+v[1])];
  if (v && typeof v === 'object' && 'x' in v) return [Math.round(+v.x), Math.round(+v.y)];
  if (typeof v === 'string' && v.includes(',')) { const [x, y] = v.split(',').map(Number); if (!isNaN(x) && !isNaN(y)) return [Math.round(x), Math.round(y)]; }
  return null;
}

/** "e12" -> ref; "css:.x" / "#id" -> css; "button:Save" -> role+name; anything else -> visible text. */
export function parseTarget(ref) {
  const r = String(ref).trim();
  if (/^e\d+$/.test(r)) return { ref: r };
  let m = r.match(/^css[:=]([\s\S]+)$/);
  if (m) return { css: m[1].trim() };
  if (/^[#.[][\w-]/.test(r) && !/\s/.test(r)) return { css: r };
  m = r.match(/^([a-z]+):\s*([\s\S]*)$/);
  if (m && ROLES.has(m[1])) return { role: m[1], name: m[2].trim() }; // "combobox:" = first combobox
  m = r.match(/^text[:=]([\s\S]+)$/);
  return { name: m ? m[1].trim() : r };
}

function short(msg) {
  return String(msg || '').split('\n')[0].replace(/^[\w.]+: /, '').slice(0, 160);
}

const REJECT = ['reject all', 'reject', 'decline', 'deny', 'only necessary', 'necessary only', 'essential only', 'use necessary', 'refuse',
  'alle ablehnen', 'ablehnen', 'tout refuser', 'refuser', 'rechazar todo', 'rechazar', 'rifiuta tutto', 'rifiuta', 'recusar', 'rejeitar',
  'weigeren', 'alles weigeren', 'odrzuć', 'отклонить', '拒绝', '拒否', '거부'];
const ACCEPT = ['accept all', 'accept', 'i agree', 'agree', 'allow all', 'got it', 'ok', 'okay', 'continue', 'alle akzeptieren', 'akzeptieren',
  'tout accepter', 'accepter', 'aceptar todo', 'aceptar', 'accetta tutto', 'accetta', 'aceitar', 'akkoord', 'zgadzam się', 'принять', '同意', '接受', '同意する', '동의'];

export class ActionEngine {
  constructor(observer, verifier) {
    this.observer = observer;
    this.verifier = verifier;
  }

  /** Resolves any target string to a live element handle. */
  async target(page, ref) {
    const q = parseTarget(ref);
    if (q.ref) return { ...(await this.observer.handle(page, q.ref)), ref: q.ref };
    const found = await this.observer.find(page, q);
    if (!found) throw new Error(`No element matches "${ref}". Observe the page to get refs.`);
    return { ...(await this.observer.handle(page, found.ref)), ref: found.ref };
  }

  /**
   * Closes cookie/consent/modal blockers. Prefers the privacy-preserving choice
   * (reject / necessary-only), then a close button, then accept. Works in many languages.
   */
  async dismissOverlays(page) {
    return page.evaluate(({ reject, accept }) => {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
      const buttons = Array.from(document.querySelectorAll('button, [role="button"], a[role="button"], input[type="button"], input[type="submit"]')).filter(vis);
      const label = (b) => (b.innerText || b.value || b.getAttribute('aria-label') || '').trim().toLowerCase();
      const pick = (phrases) => {
        for (const p of phrases) {
          const b = buttons.find(x => { const t = label(x); return t === p || (t.startsWith(p) && t.length < p.length + 20); });
          if (b) return b;
        }
        return null;
      };
      let btn = pick(reject);
      if (!btn) btn = Array.from(document.querySelectorAll('#onetrust-reject-all-handler, [aria-label="Close" i], [aria-label="Dismiss" i], [data-dismiss="modal"], .modal-close, .close-button')).find(vis);
      if (!btn) btn = pick(accept);
      if (!btn) return false;
      btn.click();
      return true;
    }, { reject: REJECT, accept: ACCEPT }).catch(() => false);
  }

  async _click(page, t, p) {
    const opts = { button: p.button || 'left', clickCount: p.clickCount || 1, modifiers: p.modifiers };
    if (HIGHLIGHT) await t.el.evaluate(flashElement).catch(() => {});
    let first;
    try { await t.el.click({ ...opts, timeout: 2000 }); return null; } catch (e) { first = e; }

    // Visually hidden checkbox/radio behind a styled <label>.
    const label = await t.el.evaluateHandle(el => (el.labels && el.labels[0]) || null).catch(() => null);
    const labelEl = label && label.asElement();
    if (labelEl) {
      try { await labelEl.click({ timeout: 1500 }); return 'via label'; } catch (_) {}
    }
    if (/intercept/i.test(first.message) && await this.dismissOverlays(page)) {
      try { await t.el.click({ ...opts, timeout: 1500 }); return 'after closing overlay'; } catch (_) {}
    }
    try { await t.el.click({ ...opts, force: true, timeout: 1500 }); return 'forced'; } catch (_) {}
    const ok = await t.el.evaluate((el, button) => {
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      const o = { bubbles: true, cancelable: true, composed: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: button === 'right' ? 2 : 0 };
      el.dispatchEvent(new PointerEvent('pointerdown', o));
      el.dispatchEvent(new MouseEvent('mousedown', o));
      if (el.focus) el.focus();
      el.dispatchEvent(new PointerEvent('pointerup', o));
      el.dispatchEvent(new MouseEvent('mouseup', o));
      el.dispatchEvent(new MouseEvent(button === 'right' ? 'contextmenu' : 'click', o));
      return true;
    }, opts.button).catch(() => false);
    if (ok) return 'dom events';
    throw new Error(`click failed: ${short(first.message)}`);
  }

  async _type(page, t, text, p) {
    if (HIGHLIGHT) await t.el.evaluate(flashElement).catch(() => {});
    if (p.clear === false) {
      await t.el.evaluate(el => {
        el.focus();
        if (typeof el.setSelectionRange === 'function' && typeof el.value === 'string') {
          try { el.setSelectionRange(el.value.length, el.value.length); } catch (_) {}
        } else if (el.isContentEditable) {
          const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
          const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        }
      });
      await page.keyboard.type(text, { delay: p.slowly ? 30 : 0 });
      return;
    }
    if (p.slowly) {
      await t.el.fill('').catch(() => {});
      await t.el.click({ timeout: 2000 }).catch(() => t.el.focus());
      await page.keyboard.type(text, { delay: 30 });
      return;
    }
    try {
      await t.el.fill(text, { timeout: 2500 });
    } catch (_) {
      // Not directly fillable (custom widget or wrapper): focus it and type like a user.
      await t.el.click({ timeout: 2000 }).catch(() => t.el.focus().catch(() => {}));
      await page.keyboard.press('ControlOrMeta+a').catch(() => {});
      await page.keyboard.type(text);
    }
  }

  async _select(page, t, value) {
    try {
      await t.el.selectOption(String(value), { timeout: 2500 });
      return null;
    } catch (_) {
      // Custom dropdown: open it, then click the option by its text.
      await this._click(page, t, {});
      await page.waitForTimeout(150);
      const opt = await this.observer.find(page, { role: 'option', name: String(value) }) || await this.observer.find(page, { name: String(value) });
      if (!opt) throw new Error(`option "${value}" not found`);
      const o = await this.observer.handle(page, opt.ref);
      await this._click(page, o, {});
      return 'custom dropdown';
    }
  }

  async _upload(page, t, files) {
    const isFile = await t.el.evaluate(el => el.tagName === 'INPUT' && el.type === 'file');
    if (isFile) { await t.el.setInputFiles(files); return null; }
    // Styled upload button: catch the native file chooser it opens.
    try {
      const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 3000 }), t.el.click({ timeout: 2000 })]);
      await chooser.setFiles(files);
      return 'file chooser';
    } catch (_) {
      const near = await t.el.evaluateHandle(el => {
        let p = el;
        while (p && !p.querySelector?.('input[type=file]')) p = p.parentElement;
        return p ? p.querySelector('input[type=file]') : document.querySelector('input[type=file]');
      });
      const input = near.asElement();
      if (!input) throw new Error('no file input found near target');
      await input.setInputFiles(files);
      return 'nearest file input';
    }
  }

  async _wait(page, p) {
    const timeout = p.timeout ?? 10000;
    if (p.ms) { await page.waitForTimeout(Math.min(+p.ms, 30000)); return `waited ${p.ms}ms`; }
    const end = Date.now() + timeout;
    let what;
    const check = async () => {
      if (p.url) { what = `url ~ "${p.url}"`; return page.url().includes(p.url); }
      if (p.text) { what = `text "${p.text}"`; return page.mainFrame().evaluate(pageAgent, { op: 'text', q: p.text }).catch(() => false); }
      if (p.gone) { what = `text "${p.gone}" gone`; return !(await page.mainFrame().evaluate(pageAgent, { op: 'text', q: p.gone }).catch(() => true)); }
      if (p.ref) {
        what = `"${p.ref}"`;
        try { await this.target(page, p.ref); return true; } catch (_) { return false; }
      }
      throw new Error("wait needs one of: text, gone, ref, url, ms");
    };
    while (true) {
      if (await check()) return `waited for ${what}`;
      if (Date.now() > end) throw new Error(`wait timed out after ${timeout}ms for ${what}`);
      await new Promise(r => setTimeout(r, 150));
    }
  }

  async _eval(page, script) {
    const s = String(script).trim();
    const body = /(^|[;\n{]\s*)return\b/.test(s) && !/^(async\s*)?(\(|function\b)/.test(s) ? `(async () => { ${s} })()` : s;
    return page.evaluate(body);
  }

  /** Answers a dialog the page is currently showing (the page is blocked until then). */
  async answerDialog(page, p) {
    const bm = attachPage(page);
    const d = bm.pendingDialog;
    if (!d) throw new Error('No open dialog on this tab.');
    bm.pendingDialog = null;
    const accept = p.accept !== false;
    try {
      if (accept) await d.accept(p.text ?? d.defaultValue());
      else await d.dismiss();
    } catch (_) {}
    return `${accept ? 'accepted' : 'dismissed'} ${d.type()} "${d.message().slice(0, 80)}"`;
  }

  /**
   * Executes one action and returns a receipt. observe: 'delta' | 'full' | 'none'.
   */
  async execute(page, params, { andObserve = false, observe = null, observeOptions = {}, tabId = null } = {}) {
    const p = normalizeStep(params);
    const action = p.action;
    if (!action) throw new Error("Missing 'action'.");
    const mode = observe || ((andObserve || p.and_observe) ? 'delta' : 'none');

    if (action === 'dialog') {
      const msg = await this.answerDialog(page, p);
      const receipt = { action: { type: 'dialog' }, executed: true, changes: [msg], before: {}, after: {} };
      if (mode !== 'none') receipt.nextObservation = await this.observer.observe(page, { delta: mode === 'delta', tabId, ...observeOptions });
      return receipt;
    }

    const bm = attachPage(page);
    bm.dialogPolicy = { accept: p.dialog !== 'dismiss', text: p.dialogText };
    const before = await this.verifier.captureBeforeState(page, { respectUser: p.force !== true });

    let did, how = null, result, refUsed = p.ref, targetRole = null;
    const xy = parseXY(p.xy);
    const needTarget = async () => {
      if (p.ref === undefined || p.ref === null || p.ref === '') throw new Error(`Action '${action}' needs 'ref' (e.g. "e12" or "Sign in") or 'xy'.`);
      const t = await this.target(page, p.ref);
      refUsed = t.ref;
      targetRole = t.info?.role;
      return t;
    };
    const label = (t) => `${t.ref}${t.info?.name ? ` "${t.info.name.slice(0, 40)}"` : ''}`;

    try {
      switch (action) {
        case 'click': {
          if (xy) {
            await page.mouse.click(xy[0], xy[1], { button: p.button || 'left', clickCount: p.clickCount || 1 });
            did = `click at ${xy}`;
            break;
          }
          const t = await needTarget();
          how = await this._click(page, t, p);
          did = `click ${label(t)}`;
          break;
        }
        case 'type': {
          if (p.text === undefined) throw new Error("'type' needs 'text'.");
          const text = String(p.text);
          if (xy) {
            await page.mouse.click(xy[0], xy[1]);
            if (p.clear !== false) await page.keyboard.press('ControlOrMeta+a').catch(() => {});
            await page.keyboard.type(text, { delay: p.slowly ? 30 : 0 });
            if (p.enter) await page.keyboard.press('Enter');
            did = `type at ${xy}`;
            break;
          }
          const t = await needTarget();
          await this._type(page, t, text, p);
          if (p.enter) await t.el.press('Enter').catch(() => page.keyboard.press('Enter'));
          did = `type ${label(t)} "${text.length > 40 ? text.slice(0, 40) + '…' : text}"${p.enter ? ' + Enter' : ''}`;
          break;
        }
        case 'press': {
          if (!p.key) throw new Error("'press' needs 'key' (e.g. Enter, Escape, Control+a).");
          if (p.ref) { const t = await needTarget(); await t.el.press(p.key); did = `press ${p.key} on ${label(t)}`; }
          else { await page.keyboard.press(p.key); did = `press ${p.key}`; }
          break;
        }
        case 'select': {
          if (p.value === undefined || p.value === null) throw new Error("'select' needs 'value' (option value or visible text).");
          const t = await needTarget();
          how = await this._select(page, t, p.value);
          did = `select "${p.value}" in ${label(t)}`;
          break;
        }
        case 'upload': {
          if (!Array.isArray(p.files) || !p.files.length) throw new Error("'upload' needs 'files' (absolute paths).");
          const t = await needTarget();
          how = await this._upload(page, t, p.files);
          did = `upload ${p.files.length} file(s) to ${label(t)}`;
          break;
        }
        case 'hover': {
          if (xy) { await page.mouse.move(xy[0], xy[1]); did = `hover at ${xy}`; break; }
          const t = await needTarget();
          await t.el.hover({ timeout: 2500 }).catch(async () => {
            const b = await t.el.boundingBox();
            if (!b) throw new Error('element has no box');
            await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
          });
          did = `hover ${label(t)}`;
          break;
        }
        case 'scroll': {
          let lid, frame = page.mainFrame();
          if (p.ref) {
            const t = await needTarget();
            if (!p.dir) { await t.el.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {}); did = `scroll to ${label(t)}`; break; }
            lid = pageState(page).refs.get(t.ref)?.lid;
            frame = t.frame;
          }
          const r = await frame.evaluate(pageAgent, { op: 'scroll', dir: p.dir || 'down', amount: p.amount, lid });
          did = `scroll ${p.dir || 'down'} (${r.container}) y=${r.y}/${r.h}${r.moved ? '' : ' — did not move (end reached?)'}`;
          break;
        }
        case 'drag': {
          const point = async (v) => {
            const c = parseXY(v);
            if (c) return c;
            const t = await this.target(page, v);
            await t.el.scrollIntoViewIfNeeded().catch(() => {});
            const b = await t.el.boundingBox();
            if (!b) throw new Error(`drag target "${v}" has no box`);
            return [b.x + b.width / 2, b.y + b.height / 2];
          };
          const from = xy || await point(p.ref);
          if (p.to === undefined) throw new Error("'drag' needs 'to' (ref or [x,y]).");
          const to = await point(p.to);
          await page.mouse.move(from[0], from[1]);
          await page.mouse.down();
          await page.mouse.move(to[0], to[1], { steps: p.steps || 12 });
          await page.mouse.up();
          did = `drag ${from.map(Math.round)} → ${to.map(Math.round)}`;
          break;
        }
        case 'goto': {
          if (!p.url) throw new Error("'goto' needs 'url'.");
          let url = String(p.url).trim();
          if (!/^[a-z][a-z0-9+.-]*:/i.test(url)) url = (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/i.test(url) ? 'http://' : 'https://') + url;
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: p.timeout || 20000 });
          did = `goto ${url}`;
          break;
        }
        case 'back': await page.goBack({ waitUntil: 'domcontentloaded', timeout: 15000 }); did = 'back'; break;
        case 'forward': await page.goForward({ waitUntil: 'domcontentloaded', timeout: 15000 }); did = 'forward'; break;
        case 'reload': await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }); did = 'reload'; break;
        case 'wait': did = await this._wait(page, p); break;
        case 'eval': {
          if (!p.script) throw new Error("'eval' needs 'script'.");
          result = await this._eval(page, p.script);
          const s = typeof result === 'string' ? result : JSON.stringify(result);
          did = `eval → ${s === undefined ? 'undefined' : s.length > 300 ? s.slice(0, 300) + '…' : s}`;
          break;
        }
        default:
          throw new Error(`Unknown action '${action}'. Use: click, type, press, select, upload, hover, scroll, drag, goto, back, forward, reload, wait, eval, dialog.`);
      }
    } catch (err) {
      await this.verifier.captureAfterState(page, before, { maxWait: 300 }).catch(() => {});
      throw err;
    }

    const after = await this.verifier.captureAfterState(page, before, {
      includeScreenshot: p.includeScreenshot,
      maxWait: action === 'wait' ? 400 : 1500,
      // Toggles and form fields change properties, not DOM, so don't wait for a mutation there.
      expectChange: (action === 'click' || action === 'press') && !xy && !STATEFUL.has(targetRole)
    });
    const fx = this.verifier.sideEffects(page, before);
    const popup = bm.popup && !bm.popup.isClosed() ? bm.popup : null;
    const receipt = this.verifier.createReceipt(
      { type: action, ref: refUsed, text: p.text ? String(p.text).slice(0, 50) : undefined },
      before,
      after,
      {
        elementChange: how ? `${did} [${how}]` : did,
        download: fx.download,
        dialogMessage: fx.dialog?.message,
        dialogAccepted: fx.dialog?.accepted
      }
    );
    if (result !== undefined) receipt.result = result;
    if (popup) receipt.newPage = popup;
    if (after.navigated) receipt.navigated = true;

    if (mode !== 'none' && !after.closed) {
      const obsPage = popup || page;
      if (popup) await popup.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => {});
      receipt.nextObservation = await this.observer.observe(obsPage, { delta: mode === 'delta' && !popup, tabId: popup ? null : tabId, ...observeOptions });
      // Don't repeat new text that is already shown as an element name.
      const names = new Set(receipt.nextObservation.elements.map(e => e.name).filter(Boolean));
      receipt.changes = receipt.changes.filter(c => !(c.startsWith('text: "') && names.has(c.slice(7, -1))));
    }
    return receipt;
  }
}
