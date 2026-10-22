---
name: parallel-tab-worker
description: Concurrent multi-tab batch processing and data collection. Executes multi-URL scraping, status checking, and comparison workflows in parallel across background tabs in a single turn.
---

# Parallel Tab Worker Skill

Use this skill when you need to process multiple URLs simultaneously (e.g. comparing prices of 5 items, checking status across 4 dashboards, extracting details from 10 search results).

> [!IMPORTANT]
> **5x–10x Speedup with Zero Extra Turns**: Instead of opening, waiting, reading, and closing pages one-by-one across multiple LLM turns, the parallel tab worker spawns lightweight background tabs in your running browser, executes in parallel, aggregates results, and closes worker tabs in a single tool call.

---

## 🚀 Key Advantages

- **Concurrent Execution**: Fetches 4–8 pages simultaneously using `Promise.all`.
- **Zero Token Loops**: Eliminates back-and-forth LLM conversation turns.
- **Auto-Cleanup**: Automatically closes background worker tabs upon completion, keeping your browser workspace clean.

---

## 🛠️ Usage via `brave_workflow`

Invoke the compiled workflow script `parallel-crawler` via `brave_workflow`:

```json
{
  "action": "run_script",
  "scriptName": "parallel-crawler",
  "params": {
    "urls": [
      "https://news.ycombinator.com",
      "https://github.com/trending",
      "https://lobste.rs"
    ],
    "maxConcurrency": 3,
    "extractorJs": "({ title: document.title, firstHeading: document.querySelector('h1, h2')?.innerText?.trim() })"
  }
}
```

### Options

| Parameter | Description | Default |
| :--- | :--- | :--- |
| `urls` | Array of URLs to process concurrently | Required |
| `extractorJs` | JavaScript expression to evaluate inside each tab | `({ title, url })` |
| `maxConcurrency` | Maximum tabs open in parallel | `4` |
| `timeoutMs` | Page navigation timeout in milliseconds | `12000` |
