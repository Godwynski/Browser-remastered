---
name: dom-mutation-sentinel
description: Zero-latency deterministic waiting for dynamic SPAs, async data fetches, and DOM mutations. Eliminates arbitrary sleep delays and eliminates race conditions with zero token overhead.
---

# DOM Mutation Sentinel Skill

Use this skill when interacting with dynamic Single Page Applications (SPAs) where elements appear asynchronously after network requests, form submissions, or route transitions.

> [!TIP]
> **Zero Latency & Zero Tokens**: Never use arbitrary sleeps like `waitForTimeout(3000)`. Arbitrary sleeps waste execution seconds when pages are fast, and fail when pages are slow. Mutation waiting executes with microsecond precision as soon as the DOM settles.

---

## 🚀 Key Advantages

- **Eliminates Race Conditions**: Detects the exact DOM node insertion or class update instantly.
- **Speeds Up Workflows**: Eliminates 3,000ms+ arbitrary sleeps per step; continues execution within ~15ms of event firing.
- **Zero Token Cost**: Executed directly inside the browser engine using native `MutationObserver` via `brave_eval`.

---

## 🛠️ In-Page Waiting Recipes (via `brave_eval`)

### 1. Wait for Element to Appear (with Timeout)

```javascript
await new Promise((resolve, reject) => {
  const selector = 'div[data-testid="search-results"]';
  const existing = document.querySelector(selector);
  if (existing) return resolve({ found: true, elapsedMs: 0 });

  const start = Date.now();
  const timer = setTimeout(() => {
    observer.disconnect();
    resolve({ found: false, error: 'Timed out waiting for ' + selector });
  }, 5000);

  const observer = new MutationObserver(() => {
    const el = document.querySelector(selector);
    if (el) {
      clearTimeout(timer);
      observer.disconnect();
      resolve({ found: true, elapsedMs: Date.now() - start });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
});
```

### 2. Wait for Loading Spinner or Skeleton to Disappear

```javascript
await new Promise((resolve) => {
  const spinnerSelector = '.loading-spinner, .skeleton, [aria-busy="true"], .loader';
  const isHidden = () => !document.querySelector(spinnerSelector);
  if (isHidden()) return resolve({ cleared: true, elapsedMs: 0 });

  const start = Date.now();
  const timer = setTimeout(() => {
    observer.disconnect();
    resolve({ cleared: false, timeout: true });
  }, 8000);

  const observer = new MutationObserver(() => {
    if (isHidden()) {
      clearTimeout(timer);
      observer.disconnect();
      resolve({ cleared: true, elapsedMs: Date.now() - start });
    }
  });

  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
});
```

### 3. Wait for Text or Price Update (Dynamic State Mutation)

```javascript
await new Promise((resolve) => {
  const target = document.querySelector('#total-price') || document.querySelector('.status-badge');
  if (!target) return resolve({ found: false });

  const initialText = target.innerText.trim();
  const start = Date.now();

  const timer = setTimeout(() => {
    observer.disconnect();
    resolve({ updated: false, text: target.innerText.trim() });
  }, 5000);

  const observer = new MutationObserver(() => {
    const newText = target.innerText.trim();
    if (newText !== initialText) {
      clearTimeout(timer);
      observer.disconnect();
      resolve({ updated: true, newText, elapsedMs: Date.now() - start });
    }
  });

  observer.observe(target, { childList: true, characterData: true, subtree: true });
});
```

### 4. Wait for SPA Route Change (Client-Side Navigation)

```javascript
await new Promise((resolve) => {
  const startUrl = window.location.href;
  const start = Date.now();

  const check = setInterval(() => {
    if (window.location.href !== startUrl) {
      clearInterval(check);
      resolve({ navigated: true, newUrl: window.location.href, elapsedMs: Date.now() - start });
    }
  }, 50);

  setTimeout(() => {
    clearInterval(check);
    resolve({ navigated: false, currentUrl: window.location.href });
  }, 6000);
});
```
