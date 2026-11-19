# Browser Remastered (`brave-mcp`) — Agent Rules

## 1. The 4-Tier Execution Protocol (Min Tokens / Max Speed)
1. **Single Action / Read**: Use `brave_read`, `brave_eval`, or `brave_act` directly. Target by label (`ref: "Sign in"`, `ref: "button:Save"`) when known—no `brave_observe` needed.
2. **Multi-Step Flow (2–10 steps)**: Pass `steps` to a single `brave_act` call (`goto`, `type`, `select`, `click`, `wait`). Intermediate steps execute in fast mode with zero observation overhead; only the final delta is returned.
3. **Pagination / Bulk**: Use `brave_workflow` (`paginate_extract`, `bulk_action`, or `run_script`).
4. **Network / Bulk Data**: Prefer `brave_read(network: true)` for SPA JSON responses or `brave_eval` for custom DOM extraction.

## 2. Co-Browsing & Workspace Rules
- **Never launch a new browser**: Always use the user's running Brave on CDP port `9222` (`noDefaults`).
- **Sticky Tab**: Stay on your assigned tab unless `tab` is specified. Use `observe: false` on `brave_tabs(switch/new)` when you don't need an immediate element dump.
- **Universal Engine**: Keep `brave-mcp/src/` free of site-specific selectors. Reusable workflows belong in `brave-mcp/scripts/workflows/`.

## 3. Verification
```bash
cd brave-mcp && npm run test:all
```
