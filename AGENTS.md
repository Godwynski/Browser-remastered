# Agent Instructions & Developer Standards: Browser Remastered (`brave-mcp`)

## 🌐 Workspace Overview & Purpose
This workspace is the dedicated developer repository for **Evidence-Grounded Brave Browser Agent (`brave-mcp`)**, the Chrome DevTools Protocol (CDP) bridge connecting AI agents (Antigravity / Gemini) directly to your running **Brave Browser**.

### ⚠️ Workspace Separation Notice: Decoupled Coursework
> [!IMPORTANT]
> **Academic Coursework Decoupled**:
> All external coursework, subject folders, assignments, and academic skills have been separated into a dedicated external workspace.
> 
> When working in this repository (`Browser remastered`), the AI agent must **never** look for coursework or create assignment files. This repository is strictly for browser infrastructure and web automation engineering.

---

## 🏛️ Repository Architecture

```
Browser remastered/
├── brave-mcp/                     # MCP Server & CDP Bridge Engine
│   ├── src/                       # Core engine: browser.js, observer.js, actions.js, verifier.js, workflow.js, reader.js, index.js
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
2. **Tier 2 (Sequential Workflow, 3–10 steps)**: Use `brave_batch_act` to execute the sequence in **1 single turn** without multi-turn LLM loops. **Do not generate a script.**
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

## 🛠️ The 8 Core MCP Tools (`brave-control`)

Antigravity controls Brave via the following 8 MCP tools registered in `mcp_config.json`:

| Tool | Primary Purpose | Key Parameters |
| :--- | :--- | :--- |
| `brave_tabs` | Manage and inspect open tabs | `action` (`list`, `switch`, `new`, `close`, `focus`), `index`, `url` |
| `brave_observe` | Extract hybrid spatial DOM/ARIA state with minimal token footprint | `target` (`agent` / `user`), `scope`, `filter`, `format` (`compact`/`json`), `includeScreenshot` |
| `brave_read` | Dedicated zero-DOM article and table extraction as clean Markdown | `target`, `scope`, `maxLength` (saves ~90% tokens on reading tasks) |
| `brave_act` | Perform browser actions with automatic compound observation | `action`, `ref` (ephemeral ID e.g. `e1`), `text`, `and_observe` (default `true`) |
| `brave_batch_act` | Execute multiple actions sequentially without LLM loops | `actions` (array of action objects), `and_observe` (default `true`), `target` |
| `brave_workflow` | High-speed pagination, bulk actions, and compiled workflow routines | `action` (`paginate_extract`, `bulk_action`, `run_script`), `itemSelector`, `nextSelector` |
| `brave_eval` | Execute direct in-page JavaScript for instant zero-token scraping | `script` (JS string), `target`, `frameIndex` |
| `brave_navigate` | Direct tab navigation | `url`, `action` (`goto`, `reload`, `back`, `forward`), `target` |

---

## 🧪 Testing & Verification Protocol

When modifying `brave-mcp`, always run the test battery to verify that protocol contracts, co-browsing isolation, and token optimizations remain intact:

```bash
cd brave-mcp
npm test               # Run live CDP diagnostic test against active Brave browser
npm run test:protocol  # Verify 8-tool MCP JSON-RPC protocol discovery
npm run test:tokens    # Token reduction (79%+ savings), compact notation & alerts test
npm run test:workflow  # Universal pagination, bulk action & compiled script test
npm run test:healing   # 5-tier self-healing action engine & overlay auto-dismissal
npm run test:battery   # 14-point critical guarantee test battery
npm run test:all       # Run entire comprehensive test suite
```
