---
name: browser-content-capture
description: High-efficiency extraction of dynamic, client-side rendered Single-Page Applications (React, Vue, Next.js, Angular), infinite-scroll feeds, and login-protected web pages with zero token overhead.
---

# Browser Content Capture Skill

Use this skill when you need to extract dynamic, client-side rendered content (SPAs, React/Vue dashboards, infinite scroll feeds, client-side routing) that static scrapers or basic curl requests fail to capture.

---

## 🚀 Key Advantages
- **SPA & Dynamic Hydration**: Waits for network idle and framework hydration before extracting.
- **Infinite Scroll & Lazy Loading**: Automatically scrolls to load deferred or virtualized items.
- **Zero Token DOM Overhead**: Extracts structured content directly via browser evaluation without burning LLM context tokens.
- **Session Re-use**: Attaches to your logged-in Brave browser session (CDP 9222) to capture authenticated dashboards without re-logging in.

---

## 🛠️ Usage

### CLI Execution
Run the capture CLI with a URL or against the active Brave tab:

```bash
# Capture from a target URL
node .agents/skills/browser-content-capture/scripts/capture-cli.js --url "https://news.ycombinator.com" --selector ".athing"

# Capture from your currently active Brave tab with infinite scroll
node .agents/skills/browser-content-capture/scripts/capture-cli.js --active --scrolls 3 --output artifacts/captured_data.json
```

### Options
| Flag | Description | Default |
| :--- | :--- | :--- |
| `--url <url>` | Target URL to navigate and capture | active tab if omitted |
| `--active` | Capture from currently active Brave tab | `false` |
| `--selector <css>` | Target container selector to isolate | `body` |
| `--scrolls <num>` | Number of incremental scrolls for lazy loading | `1` |
| `--output <path>` | File path to save output JSON | console output |
| `--text-only` | Extract clean text instead of HTML structure | `true` |

---

## 💡 Best Practices
1. Combine with `brave_read` when clean article Markdown is needed.
2. For infinite lists (e.g. search results, social feeds), use `--scrolls 3` or `--scrolls 5` to trigger IntersectionObserver loaders.
3. Save structured output directly to `artifacts/` for downstream analysis.
