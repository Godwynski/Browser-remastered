---
name: stealth-interaction
description: Human-like interaction physics, overlay and cookie consent auto-dismissal, and anti-bot stealth patterns. Eliminates automated detection flags and smoothly interacts with protected websites.
---

# Stealth Interaction Skill

Use this skill when interacting with modern websites that deploy anti-bot heuristics, aggressive bot scoring (Cloudflare Turnstile, Datadome, reCAPTCHA v3), or intrusive cookie consent modals and subscription paywalls.

---

## 🚀 Key Advantages
- **Human-Cadence Typing**: Injects realistic micro-delays (15ms–45ms) between keystrokes to pass behavioral biometrics.
- **Universal Overlay & Cookie Consent Dismissal**: Automatically identifies and clicks common "Accept All", "Agree", or "Close" buttons on cookie banners and modal overlays.
- **Scroll Physics**: Emulates natural mouse-wheel scrolls with deceleration rather than instantaneous coordinate jumps.

---

## 🛠️ Automated Cookie Banner Dismissal (via `brave_eval`)

Run this snippet via `brave_eval` to dismiss intrusive cookie banners, GDPR prompts, or subscription modals across ANY website:

```javascript
(() => {
  const commonSelectors = [
    '#onetrust-accept-btn-handler',
    'button[id*="accept" i]',
    'button[class*="cookie" i]:has-text("Accept")',
    'button[aria-label*="accept" i]',
    'a[class*="accept" i]',
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Allow all")',
    'button:has-text("Got it")',
    '[aria-label="Close"]',
    '.modal-close',
    '.close-button'
  ];

  for (const sel of commonSelectors) {
    try {
      const btn = document.querySelector(sel);
      if (btn && btn.offsetParent !== null) {
        btn.click();
        return { dismissed: true, selector: sel };
      }
    } catch (_) {}
  }
  return { dismissed: false };
})();
```

---

## 🛡️ Anti-Detection Best Practices

1. **Leverage User Profile & Brave Shields**: Because `brave-mcp` connects to your running personal Brave browser on port 9222, Brave Shields automatically blocks trackers and ads, while your existing profile passes Cloudflare checks natively.
2. **Avoid Rapid Multi-Click Spams**: Space out navigation and high-frequency clicks using `brave_batch_act` with `delayMs: 250` or `brave_act` with standard human pauses.
3. **Use `humanLike: true` in `brave_act`**: When typing into sensitive search or login fields, `humanLike: true` dispatches keyboard events with organic human jitter.
