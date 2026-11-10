import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import { BraveManager } from './browser.js';
import { BrowserObserver } from './observer.js';
import { StateVerifier } from './verifier.js';
import { ActionEngine } from './actions.js';
import { ContentReader } from './reader.js';
import { WorkflowEngine } from './workflow.js';
import { attachPage } from './page-hooks.js';

const brave = new BraveManager();
const observer = new BrowserObserver();
const verifier = new StateVerifier(observer);
const actions = new ActionEngine(observer, verifier);
const reader = new ContentReader();
const workflow = new WorkflowEngine(brave);

const INSTRUCTIONS = `Controls the user's real, already-open Brave browser. The user may be using it at the same time.
- Observe once (brave_observe), then act (brave_act). Refs like e12 stay valid while the element exists. brave_act replies with only what changed: "+" new, "~" changed, "-" gone, text: new page text.
- ref also accepts visible text ("Sign in"), role:text ("button:Save") or css ("css:#q"), so you can act without observing when the label is known.
- Put known sequences in ONE brave_act via steps (goto, type, click, wait...). Steps stop at the first failure and you get the current state back.
- Reading: brave_read (Markdown, paged by offset). For app-like sites, brave_read network:true lists the site's own JSON responses (often cheaper than the page). Bulk extraction: brave_eval or brave_workflow.
- You keep your own tab: calls go there until you pass tab. New tabs open in the background. Only use focus if the user asks.
- Dialogs, popups and downloads caused by your actions are handled and reported. Never act on the user's tab while they are typing in it.`;

const S = (description, extra = {}) => ({ type: 'string', description, ...extra });
const B = (description) => ({ type: 'boolean', description });
const I = (description) => ({ type: 'integer', description });
const TAB = S('Tab id (t3), index, or URL/title text. Omit to use your current tab.');

const ACT_FIELDS = {
  action: S('What to do', { enum: ['click', 'type', 'press', 'select', 'upload', 'hover', 'scroll', 'drag', 'goto', 'back', 'forward', 'reload', 'wait', 'eval', 'dialog'] }),
  ref: S('Target: e12, visible text, role:text (button:Save), or css:selector'),
  text: S('type: text to enter. wait: text to appear. dialog: prompt answer'),
  enter: B('type: press Enter after'),
  clear: B('type: false appends instead of replacing'),
  key: S('press: Enter, Escape, Tab, ArrowDown, Control+a ...'),
  value: S('select: option text or value'),
  files: { type: 'array', items: { type: 'string' }, description: 'upload: absolute file paths' },
  xy: { type: 'array', items: { type: 'number' }, description: '[x,y] viewport point instead of ref (canvas, maps)' },
  to: S('drag: destination ref or "x,y"'),
  url: S('goto: URL. wait: URL substring'),
  dir: S('scroll direction (with ref: scrolls that container)', { enum: ['down', 'up', 'left', 'right', 'top', 'bottom'] }),
  gone: S('wait: until this text disappears'),
  ms: I('wait: fixed milliseconds'),
  timeout: I('wait: max ms (default 10000)'),
  script: S('eval: JS expression, or a body using return'),
  accept: B('dialog: false to dismiss')
};

const TOOLS = [
  {
    name: 'brave_tabs',
    description: 'List, switch, open, close or focus tabs. List marks * = user is viewing, @ = your tab. switch/new make it your tab without stealing focus.',
    inputSchema: {
      type: 'object',
      properties: {
        action: S('Default list', { enum: ['list', 'switch', 'new', 'close', 'focus'] }),
        tab: TAB,
        url: S('new: URL to open')
      }
    }
  },
  {
    name: 'brave_observe',
    description: 'Interactive elements of the page as "e12 role "name" ="value" [flags]", viewport first. Auto-limits to an open modal. Use brave_read for text content.',
    inputSchema: {
      type: 'object',
      properties: {
        tab: TAB,
        scope: S('CSS selector to limit to (e.g. form, main, #results)'),
        filter: S('Only some elements', { enum: ['inputs', 'clickable'] }),
        max: I('Max elements (default 50)'),
        visible_only: B('Only elements in the viewport'),
        screenshot: B('Attach a screenshot'),
        labels: B('Draw refs on the screenshot (implies screenshot)'),
        crop: S('CSS selector: screenshot only this element')
      }
    }
  },
  {
    name: 'brave_read',
    description: 'Page content as clean Markdown (headings, lists, tables, links), paged by offset. network:true lists the JSON/XHR responses the site loaded; response:n returns one body.',
    inputSchema: {
      type: 'object',
      properties: {
        tab: TAB,
        scope: S('CSS selector of the content to read'),
        offset: I('Character offset to continue from'),
        max: I('Max characters (default 6000)'),
        network: B('List recent XHR/fetch responses instead'),
        response: I('Return the body of network response n')
      }
    }
  },
  {
    name: 'brave_act',
    description: 'Do one action, or several in order via steps, then return only what changed. Waits for the page to settle automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        tab: TAB,
        ...ACT_FIELDS,
        steps: { type: 'array', items: { type: 'object' }, description: 'Several actions in order, each with the same fields as above' },
        observe: S('After acting: delta (default, only changes), full, or none', { enum: ['delta', 'full', 'none'] }),
        screenshot: B('Attach a screenshot after acting')
      }
    }
  },
  {
    name: 'brave_eval',
    description: 'Run JavaScript in the page and return the result (JSON). Best for bulk extraction. A body with return is wrapped in an async function.',
    inputSchema: {
      type: 'object',
      required: ['script'],
      properties: {
        script: S('JS expression or function body'),
        tab: TAB,
        frame: S('Frame index or URL substring (default main frame)')
      }
    }
  },
  {
    name: 'brave_workflow',
    description: 'Loops without LLM turns: paginate_extract (items across pages), bulk_action (act on every match), run_script (scripts/workflows/<name>.js).',
    inputSchema: {
      type: 'object',
      required: ['action'],
      properties: {
        action: S('Workflow', { enum: ['paginate_extract', 'bulk_action', 'run_script'] }),
        tab: TAB,
        itemSelector: S('paginate: CSS of each item'),
        fields: { type: 'object', description: 'paginate: {key: CSS inside item}' },
        nextSelector: S('paginate: CSS of the Next control'),
        scrollMode: B('paginate: infinite scroll instead of Next'),
        maxPages: I('paginate: default 5'),
        maxItems: I('paginate: default 100'),
        selector: S('bulk: CSS of elements'),
        bulkType: S('bulk: default click', { enum: ['click', 'check', 'extract_attribute'] }),
        attribute: S('bulk extract_attribute: attribute name'),
        scriptName: S('run_script: file name'),
        params: { type: 'object', description: 'run_script: parameters' }
      }
    }
  }
];

// ---------- formatting helpers ----------
const json = (v) => JSON.stringify(v);
const clip = (s, n = 12000) => (s.length > n ? s.slice(0, n) + `\n…[truncated ${s.length - n} chars]` : s);

function shortUrl(u) {
  try {
    const x = new URL(u);
    if (!/^https?:$/.test(x.protocol)) return u.slice(0, 60);
    const s = x.host + x.pathname.replace(/\/$/, '');
    return s.length > 70 ? s.slice(0, 69) + '…' : s;
  } catch (_) { return String(u).slice(0, 70); }
}

function imagePart(dataUrl) {
  if (!dataUrl) return null;
  const m = /^data:(image\/\w+);base64,(.+)$/.exec(dataUrl);
  return m ? { type: 'image', mimeType: m[1], data: m[2] } : null;
}

function reply(text, image = null) {
  const content = [{ type: 'text', text }];
  const img = imagePart(image);
  if (img) content.push(img);
  return { content };
}

async function tabLines() {
  const tabs = await brave.listTabs();
  return tabs.map(t => `${t.id}${t.isAgent ? '@' : ''}${t.isActive ? '*' : ''} ${t.title.length > 50 ? t.title.slice(0, 49) + '…' : t.title} — ${shortUrl(t.url)}`).join('\n');
}

const pick = (...vals) => vals.find(v => v !== undefined && v !== null && v !== '');

// ---------- handlers ----------
async function handleTabs(a) {
  const action = a.action || 'list';
  const tab = pick(a.tab, a.index, a.tabIndex);
  if (action === 'list') return reply(await tabLines());

  if (action === 'switch' || action === 'focus') {
    const page = tab !== undefined ? await brave.setActivePage(tab, { bringToFront: action === 'focus' || a.bringToFront === true }) : await brave.getTargetPage();
    if (action === 'focus' && tab === undefined) await page.bringToFront().catch(() => {});
    if (action === 'focus') return reply(`ok focused ${brave.tabId(page)} for the user`);
    const obs = await observer.observe(page, { tabId: brave.tabId(page) });
    return reply(`ok your tab is now ${brave.tabId(page)}\n${obs.elements_compact}`);
  }

  if (action === 'new') {
    const page = await brave.newTab(a.url || 'about:blank');
    if (!a.url || a.url === 'about:blank') return reply(`ok opened ${brave.tabId(page)} in the background (your tab)`);
    const obs = await observer.observe(page, { tabId: brave.tabId(page) });
    return reply(`ok opened ${brave.tabId(page)} in the background (your tab)\n${obs.elements_compact}`);
  }

  if (action === 'close') {
    if (tab === undefined) throw new Error("close needs 'tab'.");
    await brave.closeTab(tab);
    return reply(`ok closed ${tab}\n${await tabLines()}`);
  }
  throw new Error(`Unknown tabs action '${action}'.`);
}

async function handleObserve(a) {
  const page = await brave.getTargetPage(null, pick(a.tab, a.tabIndex));
  const crop = pick(a.crop, a.screenshotScope);
  const obs = await observer.observe(page, {
    tabId: brave.tabId(page),
    scope: a.scope,
    filter: a.filter,
    maxElements: pick(a.max, a.maxElements) ?? 50,
    visibleOnly: a.visible_only ?? a.visibleOnly ?? false,
    includeScreenshot: Boolean(a.screenshot || a.includeScreenshot || a.labels || crop || a.clip),
    labels: Boolean(a.labels),
    screenshotScope: crop,
    clip: a.clip
  });
  return reply(obs.elements_compact, obs.screenshot);
}

async function handleRead(a) {
  const page = await brave.getTargetPage(null, pick(a.tab, a.tabIndex));
  const max = pick(a.max, a.maxLength) ?? 6000;
  const offset = a.offset ?? 0;

  if (a.network || a.response !== undefined) {
    const bm = attachPage(page);
    if (a.response === undefined) {
      if (!bm.net.length) return reply('(no XHR/fetch responses captured yet; they are recorded once the agent uses this tab. Reload or interact, then ask again)');
      return reply(bm.net.slice(-25).map(r => `n${r.n} ${r.method} ${r.status} ${r.ctype || '?'}${r.size ? ' ' + (r.size > 1024 ? (r.size / 1024).toFixed(1) + 'KB' : r.size + 'B') : ''} ${shortUrl(r.url)}${new URL(r.url).search.slice(0, 60)}`).join('\n'));
    }
    const entry = bm.net.find(r => r.n === Number(a.response));
    if (!entry) throw new Error(`No network response n${a.response}. Use network:true to list.`);
    let body;
    try { body = await entry.resp.text(); } catch (_) { throw new Error('That response body is no longer available (the page navigated). Re-trigger it and list again.'); }
    try { body = JSON.stringify(JSON.parse(body)); } catch (_) {}
    const chunk = body.slice(offset, offset + max);
    const more = offset + max < body.length ? `\n[more: offset=${offset + max} of ${body.length}]` : '';
    return reply(`n${entry.n} ${entry.method} ${entry.url}\n${chunk}${more}`);
  }

  const r = await reader.extract(page, { scope: a.scope, maxLength: max, offset });
  const range = r.totalChars > max || offset ? ` | chars ${r.offset}-${r.offset + r.markdown.length} of ${r.totalChars}` : '';
  const more = r.nextOffset ? `\n[more: offset=${r.nextOffset}]` : '';
  return reply(`# ${r.title}\n${shortUrl(r.url)} | ~${r.wordCount} words${range}\n\n${r.markdown}${more}`);
}

async function handleAct(a) {
  let page = await brave.getTargetPage(null, pick(a.tab, a.tabIndex));
  const steps = Array.isArray(a.steps) && a.steps.length ? a.steps : (Array.isArray(a.actions) && a.actions.length ? a.actions : [a]);
  const mode = a.observe || (a.and_observe === false ? 'none' : 'delta');
  const multi = steps.length > 1;
  const lines = [];
  let last = null, failed = null;

  for (let i = 0; i < steps.length; i++) {
    const isLast = i === steps.length - 1;
    const step = { ...steps[i] };
    if (isLast && (a.screenshot || a.includeScreenshot)) step.includeScreenshot = true;
    const prefix = multi ? `${i + 1}. ` : '';
    try {
      const r = await actions.execute(page, step, { observe: isLast ? mode : 'none', tabId: brave.tabId(page) });
      lines.push(`${prefix}ok ${r.changes.join(' | ')}`);
      if (r.newPage) {
        page = r.newPage;
        brave.agentPage = page;
        lines.push(`→ opened new tab ${brave.tabId(page)} (now your tab)`);
      }
      last = r;
    } catch (err) {
      failed = err;
      lines.push(`${prefix}FAIL ${step.action || '?'}${step.ref ? ' ' + step.ref : ''}: ${err.message}`);
      if (multi && i < steps.length - 1) lines.push(`(steps ${i + 2}-${steps.length} not run)`);
      break;
    }
  }

  let obsText = last?.nextObservation?.elements_compact;
  if (failed && mode !== 'none') {
    // Give the agent the current state so it can recover without another call.
    obsText = await observer.observe(page, { delta: true, tabId: brave.tabId(page) }).then(o => o.elements_compact).catch(() => null);
  }
  const text = lines.join('\n') + (obsText ? `\n${obsText}` : '');
  const out = reply(text, last?.screenshot);
  if (failed && !last) out.isError = true;
  return out;
}

async function handleEval(a) {
  const page = await brave.getTargetPage(null, pick(a.tab, a.tabIndex));
  if (a.listFrames) return reply(page.frames().map((f, i) => `${i} ${shortUrl(f.url())}${f.name() ? ' name=' + f.name() : ''}`).join('\n'));
  if (!a.script) throw new Error("'script' is required.");
  let target = page;
  const frame = pick(a.frame, a.frameIndex, a.frameUrl);
  if (frame !== undefined) {
    const frames = page.frames();
    target = /^\d+$/.test(String(frame)) ? frames[Number(frame)] : frames.find(f => f.url().includes(String(frame)));
    if (!target) throw new Error(`Frame "${frame}" not found. Frames:\n${frames.map((f, i) => `${i} ${shortUrl(f.url())}`).join('\n')}`);
  }
  const result = await actions._eval(target, a.script);
  const text = result === undefined ? 'undefined' : typeof result === 'string' ? result : json(result);
  return reply(clip(text));
}

async function handleWorkflow(a) {
  const page = await brave.getTargetPage(null, pick(a.tab, a.tabIndex));
  let result;
  if (a.action === 'paginate_extract') {
    result = await workflow.paginateExtract(page, {
      itemSelector: a.itemSelector,
      nextSelector: a.nextSelector,
      scrollMode: a.scrollMode ?? false,
      maxPages: a.maxPages || 5,
      maxItems: a.maxItems || 100,
      pageDelay: a.pageDelay || 800,
      fields: a.fields || null
    });
  } else if (a.action === 'bulk_action') {
    result = await workflow.bulkAction(page, {
      selector: a.selector,
      action: a.bulkType || 'click',
      attribute: a.attribute || 'href',
      maxElements: a.maxElements || 50,
      delayMs: a.delayMs ?? 150
    });
  } else if (a.action === 'run_script') {
    result = await workflow.runScript(page, a.scriptName, a.params || {});
  } else {
    throw new Error(`Unknown workflow action '${a.action}'.`);
  }
  return reply(clip(json(result)));
}

// Old tool names keep working (not advertised, so they cost no schema tokens).
function legacy(name, a) {
  if (name === 'brave_batch_act') return ['brave_act', { ...a, steps: a.actions }];
  if (name === 'brave_navigate') return ['brave_act', { ...a, action: a.action && a.action !== 'goto' ? a.action : 'goto', tab: pick(a.tab, a.tabIndex), observe: a.and_observe === false ? 'none' : 'full' }];
  return [name, a];
}

const HANDLERS = {
  brave_tabs: handleTabs,
  brave_observe: handleObserve,
  brave_read: handleRead,
  brave_act: handleAct,
  brave_eval: handleEval,
  brave_workflow: handleWorkflow
};

const server = new Server({ name: 'brave-control', version: '2.0.0' }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const [name, args] = legacy(request.params.name, request.params.arguments || {});
  const handler = HANDLERS[name];
  try {
    if (!handler) throw new Error(`Unknown tool: ${name}`);
    return await handler(args);
  } catch (err) {
    return { isError: true, content: [{ type: 'text', text: `Error: ${String(err.message || err).split('\n').slice(0, 4).join('\n')}` }] };
  }
});
server.connect(new StdioServerTransport()).catch((error) => {
  console.error('Fatal error in brave-mcp server:', error);
  process.exit(1);
});
