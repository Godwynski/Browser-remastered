# Evidence-Grounded Brave Browser Agent (`brave-mcp`)

[![MCP Protocol](https://img.shields.io/badge/MCP-1.6.1-blue.svg)](https://modelcontextprotocol.io/)
[![Playwright Core](https://img.shields.io/badge/Playwright-1.50.1-green.svg)](https://playwright.dev/)
[![Browsers](https://img.shields.io/badge/Browsers-Brave%20%7C%20Edge%20%7C%20Chrome-orange.svg)](#-quick-start-guide)
[![Co-Browsing](https://img.shields.io/badge/Co--Browsing-Isolated%20Tabs-purple.svg)](#-key-capabilities--features)
[![Tests](https://img.shields.io/badge/Tests-100%25%20Passing-brightgreen.svg)](#-testing--diagnostics-protocol)

Direct, evidence-grounded browser control bridge connecting **Antigravity / Gemini** directly to your active **Brave Browser** session via Playwright and the Chrome DevTools Protocol (CDP).

---

> [!IMPORTANT]
> ### ⚠️ Project Scope & Architecture Separation
> **All coursework, subject materials, and external academic assignments have been cleanly decoupled from this repository.**
> - **This Repository (`Browser-activity`)**: Dedicated strictly to browser automation infrastructure, the CDP bridge MCP server, launcher utilities, companion extensions, and test suites.
> - **Global Availability**: The browser MCP server configured here serves the **entire computer globally** via `~/.gemini/config/mcp_config.json`. Any workspace on your machine can automate Brave without duplicating code.

---

## 🏛️ System Architecture

```mermaid
graph TD
    subgraph AI["Antigravity / Gemini Agent"]
        AGY["Antigravity IDE / CLI"]
    end

    subgraph Config["Global MCP Layer (~/.gemini/config/mcp_config.json)"]
        CMD["run-mcp.cmd (Node.js Stdio Pipe)"]
    end

    subgraph Bridge["brave-mcp Engine (Port 9222)"]
        INDEX["src/index.js (MCP Server)"]
        BROWSER["src/browser.js (Playwright CDP Bridge)"]
        OBS["src/observer.js (Tri-Source Observer)"]
        ACT["src/actions.js (5-Tier Action Engine)"]
        VER["src/verifier.js (Action Receipts & Diffing)"]
        TEL["src/telemetry-server.js (WebSocket Daemon)"]
    end

    subgraph Brave["Brave Browser (Personal Profile)"]
        UW["User Tabs (Personal Browsing, Uninterrupted)"]
        AW["Agent Tabs (Dedicated Automated Workflows)"]
        EXT["brave-extension (Floating Mission Control HUD)"]
    end

    AGY <-->|MCP Protocol (stdio)| CMD
    CMD <--> INDEX
    INDEX --> BROWSER
    BROWSER <-->|CDP WebSocket ws://localhost:9222| Brave
    BROWSER --> OBS
    BROWSER --> ACT
    ACT --> VER
    TEL <-->|ws://localhost:8765| EXT
```

---

## 🌟 Key Capabilities & Features

### 1. Parallel Co-Browsing (Zero Interruption)
- Operates inside dedicated, automated **Agent Tabs**.
- You can watch YouTube, read articles, or type in your personal tabs without the AI stealing focus, minimizing your windows, or hijacking mouse pointers.

### 2. Full Personal Profile Preservation
- Reuses your actual browser profile (`Default`), preserving active logins, session cookies, bookmarks, extensions, and password managers.
- No dummy test profiles or repeated login CAPTCHAs.

### 3. Brave Shields Ad & Tracker Immunity
- Automatically leverages Brave Shields to block intrusive cookie consent modals, paywalls, banner ads, and redirect trackers that frequently derail AI agents.

### 4. 5-Tier Self-Healing Action Engine
- Automatically recovers from common browser interaction traps without multi-turn LLM failures:
  - **Tier 1 (Nested & SVG Elements)**: Resolves pointer-events disabled child nodes to their interactive parent button/link.
  - **Tier 2 (ContentEditable Rich Text)**: Detects modern rich text editors and dispatches direct input events.
  - **Tier 3 (Overlay & Modal Auto-Dismissal)**: Auto-detects and dismisses cookie consent banners using text heuristics.
  - **Tier 4 (Numeric & Complex IDs)**: Escapes unconventional element IDs (e.g. `123-btn`) to prevent querySelector syntax crashes.
  - **Tier 5 (Direct Coordinate Fallback)**: Bypasses DOM entirely using exact `[x, y]` coordinates for Canvas, WebGL, SVG, charts, and maps.

### 5. Token-Optimized Spatial Observation (~79% Savings)
- Emits dense, single-line structured syntax for interactive elements.
- Drastically reduces context window consumption compared to raw HTML dumps or verbose JSON trees.

### 6. Visual Region Cropping (85%+ Vision Token Savings)
- Supports `screenshotScope` and `clip` bounding boxes to capture only the relevant element or container rather than full-screen 1080p images.

### 7. Action Receipts & Evidence Diffing
- Every execution returns an evidence-grounded receipt comparing:
  - Before/after URL and page title
  - DOM mutation confirmation
  - Action settlement indicators

---

## 🚀 Quick Start Guide

### Step 1: Launch Your Browser with Remote Debugging (Port 9222)

Before the AI agent can attach, your browser must run with `--remote-debugging-port=9222`. Both **Brave** and **Microsoft Edge** are supported out-of-the-box.

#### If Using Brave Browser:
- **Batch (Windows)**: Double-click `brave-launcher\launch-brave.cmd`
- **PowerShell**: `.\brave-launcher\launch-brave.ps1`
- **Permanent Desktop Shortcut**: Run `powershell -ExecutionPolicy Bypass -File .\brave-launcher\create-connected-shortcut.ps1`

#### If Using Microsoft Edge:
- **Batch (Windows)**: Double-click `brave-launcher\launch-edge.cmd`
- **PowerShell**: `.\brave-launcher\launch-edge.ps1`
- **Manual PowerShell Launch**:
  ```powershell
  # 1. Terminate background processes (Edge Startup Boost blocks port 9222 if running)
  taskkill /f /im msedge.exe
  # 2. Launch Edge with CDP enabled
  & "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --remote-debugging-port=9222 --remote-allow-origins=* --user-data-dir="$env:LOCALAPPDATA\Microsoft\Edge\User Data" --restore-last-session
  ```

> [!TIP]
> **Edge Optimization**: Open `edge://settings/system` in Edge and turn **OFF** *"Startup boost"* and *"Continue running background extensions and apps when Microsoft Edge is closed"*. This ensures Edge fully terminates when closed and allows the debug flag to bind cleanly.

---

### Step 2: Global Antigravity MCP Configuration

The MCP server is registered in your global configuration (`~/.gemini/config/mcp_config.json`):

```json
{
  "mcpServers": {
    "brave-control": {
      "command": "cmd.exe",
      "args": [
        "/c",
        "C:\\path\\to\\Browser-activity\\brave-mcp\\run-mcp.cmd"
      ]
    }
  }
}
```

*Because this configuration is global, any workspace in Antigravity has automatic access to `brave-control`.*

---

## 💻 Multi-Machine & CLI Setup Guide

You can easily run this MCP server and control browsers from the CLI or across other computers.

### Scenario A: Running on Another Computer (CLI / Local Agent)

1. **Install Prerequisites**:
   - [Node.js](https://nodejs.org/) (v18 or higher)
   - Git
   - Brave, Microsoft Edge, or Google Chrome

2. **Clone & Install**:
   ```bash
   git clone https://github.com/Godwynski/Browser-activity.git
   cd Browser-activity/brave-mcp
   npm install
   ```

3. **Start the Browser on Port 9222**:
   - **Windows**: Run `..\brave-launcher\launch-brave.cmd` or `..\brave-launcher\launch-edge.cmd`
   - **macOS (Edge / Brave)**:
     ```bash
     "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" --remote-debugging-port=9222 --remote-allow-origins=* --restore-last-session
     ```
   - **Linux (Edge / Brave)**:
     ```bash
     brave-browser --remote-debugging-port=9222 --remote-allow-origins=* --restore-last-session
     ```
   - **Verify Connectivity**:
     ```bash
     curl http://127.0.0.1:9222/json/version
     ```

4. **Connect Your Preferred CLI / Agent**:
   - **Antigravity CLI / IDE (`agy`)**:
     Add to `~/.gemini/config/mcp_config.json`:
     ```json
     {
       "mcpServers": {
         "brave-control": {
           "command": "node",
           "args": ["<path-to-repo>/brave-mcp/src/index.js"]
         }
       }
     }
     ```
   - **Claude Code CLI**:
     ```bash
     claude mcp add brave-control node <path-to-repo>/brave-mcp/src/index.js
     ```
   - **Cursor / Windsurf / Codex**:
     Add standard MCP server entry: Command `node`, Args `["<path-to-repo>/brave-mcp/src/index.js"]`.

---

### Scenario B: Remote Control Over Network (Browser on Machine A, CLI on Machine B)

If your browser runs on **Machine A** (`192.168.1.50`) and your CLI runs on **Machine B**:

1. On **Machine A**, run Edge or Brave with `--remote-debugging-port=9222 --remote-allow-origins=*` (ensure your firewall allows port 9222 inbound on your local network).
2. On **Machine B**, set the `CDP_URL` environment variable:
   ```bash
   # Windows (PowerShell)
   $env:CDP_URL = "http://192.168.1.50:9222"
   node src/index.js

   # Linux / macOS
   export CDP_URL="http://192.168.1.50:9222"
   node src/index.js
   ```

---

## 🛠️ The 8 Core MCP Tools Reference

| Tool | Primary Purpose | Key Parameters |
| :--- | :--- | :--- |
| [`brave_tabs`](#1-brave_tabs) | Manage & inspect open tabs | `action`, `index`, `url`, `bringToFront` |
| [`brave_observe`](#2-brave_observe) | Token-efficient hybrid spatial DOM/ARIA observation | `target`, `scope`, `filter`, `format`, `includeScreenshot`, `screenshotScope`, `clip` |
| [`brave_read`](#3-brave_read) | Zero-DOM article & table extraction as Markdown (~90% token savings) | `target`, `scope`, `maxLength` |
| [`brave_act`](#4-brave_act) | Execute browser actions with 5-tier self-healing & direct coordinates | `action`, `ref`, `coordinate`, `text`, `key`, `drag`, `button`, `and_observe` |
| [`brave_batch_act`](#5-brave_batch_act) | Sequential execution without LLM latency + compound observation | `actions` (array of actions), `and_observe` (default `true`), `target` |
| [`brave_workflow`](#6-brave_workflow) | Repetitive pagination loops, bulk actions & compiled routines (0 token loops) | `action`, `itemSelector`, `nextSelector`, `selector`, `bulkType`, `scriptName` |
| [`brave_eval`](#7-brave_eval) | Direct in-page JavaScript execution for instant scraping | `script`, `target`, `frameIndex` |
| [`brave_navigate`](#8-brave_navigate) | Direct tab navigation & history | `url`, `action`, `target` |

---

### 1. `brave_tabs`
Inspects, switches, creates, or closes tabs across personal and agent windows.
- `action`: `"list"` (default), `"switch"`, `"new"`, `"close"`, `"focus"`
- `index`: 0-based tab index
- `url`: Destination URL for new tabs
- `bringToFront`: `boolean` (default `false` to avoid stealing user focus)

### 2. `brave_observe`
Extracts structured interactive element state with hybrid spatial partitioning (viewport items in full detail, offscreen landmark ledger) and live page alert detection.
- `target`: `"agent"` (default) or `"user"` (user's active tab)
- `format`: `"compact"` (default, dense plaintext syntax saving ~79% tokens) or `"json"`
- `scope`: CSS selector restricting observation to a specific container (e.g. `"main"`, `"#search-results"`, `"form"`)
- `filter`: `"interactive"` (default), `"inputs"`, `"buttons_links"`, `"all"`
- `includeScreenshot`: `boolean` (default `false` for rapid reasoning)
- `screenshotScope`: CSS selector to crop screenshot to a specific element (saves 85%+ vision tokens)
- `clip`: Bounding box `{ x, y, width, height }` to crop screenshot
- `visibleOnly`: Only index elements currently inside the active viewport
- `maxElements`: Integer (default `60`)

### 3. `brave_read`
Extracts readable articles, documentation, or tables as clean Markdown with zero interactive element noise.
- `target`: `"agent"` (default) or `"user"`
- `scope`: Optional CSS selector to scope content extraction (e.g. `"article"`, `"#main-content"`, `"table"`)
- `maxLength`: Integer maximum character length (default `6000`)
- **Use case**: Research, reading documentation, and table scraping without polluting context with UI buttons.

### 4. `brave_act`
Executes an atomic browser action against the targeted tab with automatic compound observation and 5-tier self-healing.
- `action`: `"click"`, `"type"`, `"press"`, `"scroll"`, `"hover"`, `"drag"`, `"select_option"`, `"upload_file"`
- `target`: `"agent"` (default) or `"user"`
- `ref`: Ephemeral element reference from `brave_observe` (e.g. `"e1"`, `"e12"`)
- `coordinate`: Direct `[x, y]` screen coordinate to interact directly without DOM inspection (ideal for Canvas, SVG, maps)
- `text`: Text string to type into input or rich text editor
- `pressEnter`: `boolean` (press Enter immediately after typing)
- `clear`: `boolean` (clear input before typing, default `true`)
- `button`: `"left"` (default), `"right"`, `"middle"`
- `clickCount`: Integer (default `1`, set `2` for double-click)
- `startCoordinate` / `endCoordinate`: `[x, y]` coordinates for action `"drag"`
- `steps`: Smooth drag interpolation steps (default `10`)
- `and_observe`: `boolean` (default `true` - waits for DOM settlement and returns fresh observation in the same turn, cutting turn count by 50%)

### 5. `brave_batch_act`
Executes an array of actions sequentially in a single turn without round-trip LLM delays.
- `actions`: Array of action objects following the `brave_act` schema
- `and_observe`: `boolean` (default `true` - returns the final post-action observation automatically)
- `target`: `"agent"` or `"user"`
- **Returns**: Array of step receipts verifying sequential completion + optional final observation.

### 6. `brave_workflow`
Executes high-speed multi-step repetitive operations across ANY website in a single tool call without intermediate LLM loops.
- `action`: `"paginate_extract"` (loops through pages and scrapes items), `"bulk_action"` (acts on all matching elements on page), or `"run_script"` (executes reusable script from `scripts/workflows/`)
- `itemSelector`: CSS selector for repeating cards/items/rows to extract across pages
- `nextSelector`: CSS selector for the Next button/link
- `scrollMode`: `boolean` (if true, uses infinite scrolling instead of clicking next button)
- `selector`: CSS selector targeting multiple elements (for `bulk_action`)
- `bulkType`: `"click"`, `"check"`, `"extract_attribute"` (for `bulk_action`)
- `scriptName`: Name of script in `brave-mcp/scripts/workflows/` (for `run_script`)
- `params`: JSON parameters passed to script

### 7. `brave_eval`
Executes arbitrary JavaScript directly in the tab context with zero token overhead.
- `script`: JavaScript code string (e.g. `document.title` or bulk DOM extractors)
- `target`: `"agent"` or `"user"`
- `frameIndex`: Optional iframe index to evaluate inside

### 8. `brave_navigate`
Controls tab navigation and history.
- `url`: Target web address (e.g. `"https://github.com"`)
- `action`: `"goto"` (default), `"reload"`, `"back"`, `"forward"`
- `target`: `"agent"` or `"user"`

---

## 📁 Repository Structure

```
Browser-activity/
├── brave-mcp/                     # Core MCP Server & CDP Bridge
│   ├── package.json               # Dependencies: @modelcontextprotocol/sdk, playwright-core, ws
│   ├── run-mcp.cmd                # Launcher script called by global mcp_config.json
│   ├── src/
│   │   ├── index.js               # MCP Server entrypoint & 8 tool registrations
│   │   ├── browser.js             # Playwright CDP connection & tab management
│   │   ├── observer.js            # Tri-source observer & compact formatter
│   │   ├── reader.js              # Clean zero-DOM Markdown & table extractor
│   │   ├── actions.js             # 5-tier self-healing action engine & coordinate resolver
│   │   ├── verifier.js            # Action receipts & DOM state diffing
│   │   ├── workflow.js            # High-speed pagination, bulk actions & script runner
│   │   ├── telemetry-server.js    # WebSocket server for Mission Control HUD
│   │   └── telemetry.js           # Lightweight logging client
│   ├── scripts/                   # Modular automation scripts
│   │   ├── cdp/                   # Port 9222 diagnostics & connection checks
│   │   └── workflows/             # Zero-token compiled workflows (e.g. table-exporter.js)
│   └── test/                      # Comprehensive test batteries
│       ├── test-connection.js     # Live CDP diagnostic test
│       ├── test-mcp-protocol.js   # MCP stdio protocol validation (8 tools)
│       ├── test-battery.js        # 14-point critical guarantee test battery
│       ├── test-token-optimizations.js # Token savings & compact formatting test
│       ├── test-workflow.js       # Pagination & workflow execution test
│       ├── test-self-healing.js   # 5-tier self-healing action engine test
│       └── test-helper.js         # Browser binary resolver utility
├── brave-launcher/                # Browser startup & CDP connection utilities
│   ├── launch-brave.cmd           # Double-click batch launcher for Brave
│   ├── launch-brave.ps1           # PowerShell launcher for Brave
│   ├── launch-edge.cmd            # Double-click batch launcher for Microsoft Edge
│   ├── launch-edge.ps1            # PowerShell launcher for Microsoft Edge
│   └── create-connected-shortcut.ps1 # Permanent desktop shortcut generator
├── brave-extension/               # Companion browser extension & HUD
│   ├── manifest.json              # Manifest V3 extension definition
│   ├── background.js              # Service worker hot-reloader
│   ├── content/                   # Floating Mission Control HUD
│   └── popup/                     # Mission Control popup UI
├── artifacts/                     # [GITIGNORED] Runtime screenshots, test runs & downloads
├── .agents/skills/                # Developer agent skills & automation playbooks
│   ├── browser-content-capture/   # Dynamic SPA & infinite scroll capture
│   ├── dom-mutation-sentinel/     # Zero-latency deterministic waiting for SPAs & async events
│   ├── media-stream-harvester/    # Direct media, stream & document link extractor
│   ├── network-api-harvester/     # Zero-DOM JSON REST/GraphQL endpoint extractor
│   ├── parallel-tab-worker/       # Concurrent multi-tab batch processing in 1 turn
│   ├── self-healing-action/       # Auto-diagnostics & recovery for blocked/obscured actions
│   ├── session-vault/             # Session & cookie persistence
│   ├── smart-web-scraper/         # Zero-token structured table & card extractor
│   ├── stealth-interaction/       # Anti-bot stealth, human physics & cookie dismissal
│   ├── visual-region-cropper/     # Targeted element screenshot cropping (85%+ token savings)
│   ├── web-form-filler/           # Batch multi-field form filler
│   └── website-automator/         # Decision protocol & zero-token scaffolding
├── AGENTS.md                      # Developer instructions & 4-tier decision protocol
└── README.md                      # Complete project documentation
```

---

## 🧪 Testing & Diagnostics Protocol

To verify server health, CDP connectivity, and protocol guarantees, run:

```bash
cd brave-mcp

# 1. Test live CDP connection to browser (Port 9222)
npm test

# 2. Test MCP stdio protocol contracts (all 8 tools)
npm run test:protocol

# 3. Test token reduction & compact format engine
npm run test:tokens

# 4. Test universal workflow engine (pagination & bulk actions)
npm run test:workflow

# 5. Test 5-tier self-healing action engine & overlay auto-dismissal
npm run test:healing

# 6. Run the full 14-point critical test battery
npm run test:battery

# 7. Run all test suites sequentially
npm run test:all
```

---

## 🔧 Troubleshooting Guide

### 1. `Error: connect ECONNREFUSED 127.0.0.1:9222`
- **Cause**: The browser is either not running or was launched without remote debugging enabled.
- **Fix**: Run `brave-launcher\launch-brave.cmd` (for Brave) or `brave-launcher\launch-edge.cmd` (for Edge).

### 2. Edge does not open port 9222 despite launching with the flag
- **Cause**: Microsoft Edge has background processes running by default ("Startup Boost"), causing new instances to delegate to the background process without applying the `--remote-debugging-port` flag.
- **Fix**: Run `taskkill /f /im msedge.exe` before launching, or launch via `brave-launcher\launch-edge.cmd` (which terminates lingering background processes automatically). In Edge, turn off "Startup boost" under `edge://settings/system`.

### 3. Antigravity does not list `brave-control` tools
- **Cause**: The MCP server is either not configured in `mcp_config.json` or path syntax has unescaped backslashes.
- **Fix**: Verify `~/.gemini/config/mcp_config.json` points to your local `brave-mcp\run-mcp.cmd` path with properly escaped backslashes.

### 4. Telemetry Port Conflict (Port 8765 in use)
- **Cause**: Another background MCP server or HUD process is already using port 8765.
- **Fix**: The telemetry server automatically detects and attaches to the existing daemon cleanly without crashing the MCP protocol.
