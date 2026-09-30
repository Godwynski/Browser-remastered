---
name: website-automator
description: Universal web automation playbook and decision engine. Governs when to use atomic MCP tools, single-turn batching, workflow loops, and when to synthesize reusable zero-token scripts for recurring tasks on ANY website.
---

# Universal Website Automator & Workflow Protocol

This playbook governs how Antigravity automates tasks on **ANY website** with maximum speed and minimum token consumption.

---

## 🎯 The 4-Tier Efficiency Decision Protocol

To achieve **minimum code with maximum efficiency and minimum token usage**, follow this strict decision hierarchy:

```
┌─────────────────────────────────────────────────────────────┐
│ 1. SINGLE ACTION / READ?                                    │
│    👉 Use atomic MCP tools: brave_read, brave_eval, brave_act│
│    ❌ DO NOT generate a script! 1-turn direct execution.    │
├─────────────────────────────────────────────────────────────┤
│ 2. SEQUENTIAL WORKFLOW (3–10 steps)?                        │
│    👉 Use brave_batch_act                                   │
│    ❌ DO NOT generate a script! Single-turn execution.      │
├─────────────────────────────────────────────────────────────┤
│ 3. REPETITIVE LOOPS (Pagination, Bulk Clicks, Multi-Page)?  │
│    👉 Use brave_workflow (paginate_extract / bulk_action)   │
│    ⚡ Automatically loops inside CDP at 0 tokens per page.   │
├─────────────────────────────────────────────────────────────┤
│ 4. RECURRING TASK ACROSS MULTIPLE SESSIONS / COMPLEX LOGIC? │
│    👉 Synthesize a dedicated reusable script:                │
│       brave-mcp/scripts/workflows/<workflow-name>.js         │
│    ⚡ Reusable across runs, 0 ongoing LLM token consumption!  │
└─────────────────────────────────────────────────────────────┘
```

---

## 🛠️ Tier 1 & 2: Instant Zero-Overhead Actions

- **Reading content**: Always prefer `brave_read` over `brave_observe`. It extracts clean Markdown (~90% token reduction).
- **Evaluating in-page metrics**: Always prefer `brave_eval` (e.g. `document.title`, `document.querySelectorAll('...').length`). Cost: ~30 tokens.
- **Form submission / Sequences**: Pack multiple clicks and keystrokes into a single `brave_batch_act` call.

---

## ⚡ Tier 3: High-Speed Loops with `brave_workflow`

Never run a multi-turn LLM loop to click "Next Page" or check 20 checkboxes. Use `brave_workflow`:

```json
// Example: Traverse 5 pages and scrape all cards in 1 turn
{
  "action": "paginate_extract",
  "itemSelector": ".product-card",
  "nextSelector": "a[rel='next']",
  "maxPages": 5
}
```

```json
// Example: Check all matching checkboxes in 1 turn
{
  "action": "bulk_action",
  "selector": "input[type='checkbox'].item-select",
  "bulkType": "check"
}
```

---

## 📜 Tier 4: When (and How) to Synthesize a Dedicated Script

Only generate a script when a user requests a recurring task or when an operation is executed repeatedly across sessions.

### Step 1: Create the script in `brave-mcp/scripts/workflows/<name>.js`
```javascript
import { BraveManager } from '../../src/browser.js';

/**
 * Universal Workflow: Export or perform repeated task
 */
export async function run(page, params = {}, brave = null) {
  const targetPage = page || (await new BraveManager().getActivePage());

  // 1. Perform in-page high-speed operations (0 tokens)
  const result = await targetPage.evaluate((args) => {
    // Custom in-page logic
    return { success: true };
  }, params);

  return result;
}

export default run;
```

### Step 2: Execute via `brave_workflow` or CLI
- **Via MCP**: Call `brave_workflow(action: 'run_script', scriptName: '<name>', params: { ... })`
- **Via CLI**: `node brave-mcp/scripts/workflows/<name>.js`

---

## 💡 Universal Standards
1. **Never hardcode specific sites**: Use accessible ARIA roles, semantic HTML tags, or dynamically inferred selectors so workflows work across any site.
2. **Never open secondary browser windows**: Always attach to the user's running Brave session on CDP port 9222.
3. **Compound Settlement**: Let `and_observe: true` handle post-action state updates automatically.
