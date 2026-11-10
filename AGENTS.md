# Agent Instructions & Developer Standards: Browser Remastered (`brave-mcp`)

## 🌐 Workspace Overview & Purpose

This workspace is the dedicated developer repository for **Evidence-Grounded Brave Browser Agent (`brave-mcp`)**, the Chrome DevTools Protocol (CDP) bridge connecting AI agents (Antigravity / Gemini) directly to your running **Brave Browser**.

### ⚠️ Workspace Separation Notice: Decoupled Coursework

> [!IMPORTANT]
> **Academic Coursework Decoupled**:
> All external coursework, subject folders, assignments, and academic skills have been separated into a dedicated external workspace.
>
> When working in this repository (`Browser-remastered`), the AI agent must **never** look for coursework or create assignment files. This repository is strictly for browser infrastructure and web automation engineering.

---

## 🏛️ Repository Architecture

```text
Browser-remastered/
├── brave-mcp/                     # MCP Server & CDP Bridge Engine
│   ├── src/                       # Core engine: index.js, browser.js, page-agent.js, page-hooks.js, observer.js, actions.js, verifier.js, reader.js, workflow.js
│   ├── scripts/                   # Modular automation scripts (cdp, workflows)
│   ├── test/                      # Comprehensive test batteries
│   └── run-mcp.cmd                # Launcher script called by global mcp_config.json
├── brave-launcher/                # Scripts to start Brave with CDP debugging flags
│   ├── launch-brave.cmd           # Batch launcher (double-click)
│   ├── launch-brave.ps1           # PowerShell launcher
│   └── create-connected-shortcut.ps1 # Permanent desktop shortcut generator
├── artifacts/                     # Ephemeral runtime screenshots, receipts, test runs (gitignored)
└── .agents/skills/
    ├── browser-content-capture/   # Dynamic SPA & infinite scroll capture
    ├── dom-mutation-sentinel/     # Zero-latency deterministic waiting for SPAs & async events
    ├── media-stream-harvester/    # Direct media, stream & document link extractor
    ├── network-api-harvester/     # Zero-DOM JSON REST/GraphQL endpoint extractor
    ├── parallel-tab-worker/       # Concurrent multi-tab batch processing in 1 turn
    ├── self-healing-action/       # Auto-diagnostics & recovery for blocked/obscured actions
    ├── session-vault/             # Session & cookie persistence
    ├── smart-web-scraper/         # Zero-token structured table & card extractor
    ├── stealth-interaction/       # Anti-bot stealth, human physics & cookie dismissal
    ├── visual-region-cropper/     # Targeted element screenshot cropping (85%+ token savings)
    ├── web-form-filler/           # Batch multi-field form filler
    └── website-automator/         # Decision protocol & zero-token scaffolding
```

---

## 🛡️ Critical Agent Directives (Zero Tolerance)

### 1. Universal Web Automation & The 4-Tier Decision Protocol

This tool is **not** site-specific. It is a universal browser engine that accommodates **ANY** website.
To achieve **minimum code with maximum efficiency and minimum token usage**, follow this strict execution hierarchy:

1. **Tier 1 (Single Action / Read)**: Use atomic MCP tools (`brave_read`, `brave_eval`, `brave_act`). **Never generate a script for 1-step tasks.**
2. **Tier 2 (Sequential Workflow, 2–10 steps)**: Use one `brave_act` call with `steps` (goto, type, click, wait, eval...) to run the sequence in **1 single turn**. Target by label (`"Sign in"`, `"button:Save"`) when it's known, so no observe call is needed. **Do not generate a script.**
3. **Tier 3 (Repetitive Loops / Bulk / Multi-Page Pagination)**: Use `brave_workflow` (`paginate_extract` / `bulk_action`). Loops natively inside CDP at **0 tokens per page**.
4. **Tier 4 (Recurring Task Across Sessions / Custom Pipelines)**: Only synthesize a dedicated script in `brave-mcp/scripts/workflows/<name>.js` when an operation is executed repeatedly over time.

### 2. Never Open Secondary Browser Instances

- The user's personal Brave browser is already running and connected via remote debugging port **9222**.
- **NEVER** launch an `AgentProfile` or spawn secondary browser windows.
- Always attach to the existing CDP session or use the registered `brave-control` MCP tools.

### 3. Scripts Organization Mandate

All scripts must be placed in their appropriate subdirectory under `brave-mcp/scripts/`:

- `brave-mcp/scripts/cdp/`: Port 9222 health checks and CDP diagnostics.
- `brave-mcp/scripts/workflows/`: Reusable compiled workflow routines for recurring automation tasks across any website.
- **NEVER** dump ad-hoc `.js`, `.py`, `.sh`, or `.cmd` scripts into the root workspace folder.

---

## 🛠️ The 6 MCP Tools (`brave-control`)

| Tool | Primary Purpose | Key Parameters |
| :--- | :--- | :--- |
| `brave_tabs` | list / switch / new / close / focus tabs (stable ids t1, t2...) | `action`, `tab`, `url` |
| `brave_observe` | interactive elements as `e12 role "name" ="value" [flags]`, viewport first, auto-scoped to open modals | `scope`, `filter`, `max`, `visible_only`, `screenshot`, `labels`, `crop` |
| `brave_read` | page as Markdown (paged by `offset`), or the site's own XHR/fetch JSON | `scope`, `offset`, `max`, `network`, `response` |
| `brave_act` | one action or `steps`; replies with only the changes (+ new, ~ changed, - gone, text:) | `action`, `ref`, `text`, `enter`, `value`, `key`, `files`, `xy`, `url`, `dir`, `steps`, `observe` |
| `brave_eval` | in-page JavaScript, JSON result (bulk extraction) | `script`, `frame` |
| `brave_workflow` | zero-turn loops | `paginate_extract`, `bulk_action`, `run_script` |

`brave_batch_act` and `brave_navigate` still work as hidden aliases of `brave_act`.

### Engine rules (keep these when changing `brave-mcp`)

- **Co-browsing safety**: attach with `noDefaults`; never auto-answer dialogs the agent didn't cause; never redirect downloads; never bring a tab to front unless asked; keep the agent on its own (sticky) tab; never pass `--remote-allow-origins=*` (it lets any website control the browser).
- **Universal**: no site-specific selectors or logic in `src/`. Site-specific routines belong in `scripts/workflows/`.
- **Tokens and speed**: every tool reply is judged by tokens per step and CDP round trips. Observation runs as one in-page call per frame (`src/page-agent.js`); settle polls from Node (background tabs throttle page timers).

---

## 🧪 Testing & Verification Protocol

When modifying `brave-mcp`, always run the test battery to verify that protocol contracts, co-browsing isolation, and token optimizations remain intact:

```bash
cd brave-mcp
npm test               # Run live CDP diagnostic test against active Brave browser
npm run test:protocol  # MCP handshake + 6-tool discovery
npm run test:tokens    # Compact notation, alerts, scope, reader, act+observe
npm run test:workflow  # Universal pagination, bulk action & compiled script test
npm run test:healing   # 5-tier self-healing action engine & overlay auto-dismissal
npm run test:battery   # 14-point critical guarantee test battery
npm run test:fixes     # Cross-tab isolation, background tab speed & receipt tracking
npm run test:cobrowse  # End-to-end MCP over CDP: dialogs, popups, sticky tab, deltas, network, user guard
npm run test:all       # Run entire comprehensive test suite (headless, never touches your Brave)
node test/bench-sites.js  # Real-site universality & speed benchmark
```
