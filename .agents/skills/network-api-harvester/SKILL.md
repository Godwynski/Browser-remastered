---
name: network-api-harvester
description: High-speed background API, JSON REST endpoint, and SPA hydration state harvester. Intercepts fetch/XHR responses and in-page caches (Next.js __NEXT_DATA__, Nuxt, Redux) directly with zero DOM parsing and maximum token efficiency.
---

# Network & API Harvester Skill

Use this skill when you need to extract data from modern Single Page Applications (Next.js, React, Vue, Angular, e-commerce, social portals, data tables) by intercepting the underlying JSON endpoints and in-page state caches rather than scraping the rendered HTML DOM.

---

## 🚀 Key Advantages

- **99% Token Savings**: Completely bypasses HTML/ARIA DOM tree generation; returns pristine, structured JSON directly from the source API.
- **Immune to UI Changes & Layout Shifts**: CSS classes and layout mutations don't break data retrieval because it targets the network payload.
- **Instant Extraction**: No scrolling or waiting for infinite-scroll hydration; grabs the full dataset in a single evaluation.

---

## 🛠️ In-Page Evaluation Playbook (via `brave_eval`)

### 1. Extracting Next.js / Nuxt Pre-Hydrated Data

Many sites (e-commerce, docs, media) embed the entire page payload into JSON scripts:

```javascript
// Next.js:
const nextData = window.__NEXT_DATA__?.props?.pageProps;

// Nuxt:
const nuxtData = window.__NUXT__;

// Universal application/json script tags:
const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]'))
  .map(s => { try { return JSON.parse(s.textContent); } catch (_) { return null; } })
  .filter(Boolean);
```

### 2. Evaluating Same-Origin Fetch with Session Cookies

Because `brave_eval` runs in the context of the user's authenticated tab, it automatically includes the user's cookies, CSRF tokens, and credentials:

```javascript
// Fetch directly from internal REST API using browser session cookies:
const res = await fetch('/api/v1/items?limit=100');
const data = await res.json();
return data;
```

### 3. Intercepting In-Memory State Stores (Redux / Pinia / Apollo)

```javascript
// React / Redux stores:
const state = document.querySelector('#root')?._reactRootContainer?._internalRoot?.current?.memoizedState;
```
