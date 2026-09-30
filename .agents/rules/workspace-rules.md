# Workspace Rules: Browser Activity Tooling

## 🎯 Purpose
These rules govern code structure, script organization, and agent behavior within the Brave MCP browser automation repository.

---

## 🏛️ Directory Hierarchy Mandate

```
Browser activity/
├── brave-mcp/                     # Playwright & CDP bridge server
│   ├── src/                       # Core MCP server code & tool definitions
│   ├── test/                      # Protocol & live test battery
│   └── scripts/
│       ├── cdp/                   # Port 9222 & CDP health checks
│       ├── gdrive/                # Google Drive automation
│       ├── social/                # Instagram / social automation
│       └── scratch/               # One-off experimental scripts
├── brave-launcher/                # Brave startup & shortcut utilities
├── brave-extension/               # Floating HUD & browser companion
└── artifacts/                     # Runtime test logs, screenshots & raw data
```

---

## 🚫 Forbidden Practices (Zero Tolerance)
1. **NO Wandering & Excessive Reading**: Never execute exploratory `list_dir` or recursive searches across the root workspace or `.agents/`.
2. **NO New Browser Instances**: Never launch a new browser process or separate profile (`AgentProfile`). Always attach to the existing connected session on port 9222.
3. **NO Ad-Hoc Scripts in Root**: All scripts must be housed in `brave-mcp/scripts/<category>/` or within their respective tool directory.
4. **NO Clutter in Git**: Keep node modules, cache files, and runtime screenshots out of git.
