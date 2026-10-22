---
name: self-healing-action
description: Automated diagnostics and recovery for failed web interactions (obscured clicks, backdrop blockers, shadow DOM, sticky headers). Resolves interaction failures deterministically in a single step.
---

# Self-Healing Action Skill

Use this skill when an action fails (e.g. click intercepted by an overlay, element obscured by a fixed header, disabled state, or unclickable element). Instead of spending multiple turns guessing, this skill diagnoses and fixes the issue deterministically in 1 turn.

---

## 🚀 Common Failure Modes & Solutions

| Failure Mode | Diagnosis | Self-Healing Fix |
| :--- | :--- | :--- |
| **Overlaid by Backdrop / Modal** | Another element intercepts pointer events at coordinates | Dismiss modal, remove blocker, or dispatch synthetic click |
| **Obscured by Sticky Header** | `rect.top` falls under a `position: fixed` header | `scrollIntoView({ block: 'center' })` |
| **Shadow DOM Encapsulation** | Element exists inside `#shadow-root` | Pierce shadow DOM recursively |
| **`pointer-events: none`** | CSS prevents mouse events on element | Trigger click on parent container or invoke click via JS |
| **Delayed Enabled State** | Button is disabled until async validation completes | Wait for `element.disabled === false` |

---

## 🛠️ Diagnostics & Auto-Recovery Recipes (via `brave_eval`)

### 1. Diagnose Element Obscuration (`elementFromPoint`)

```javascript
((selector) => {
  const target = document.querySelector(selector);
  if (!target) return { found: false, error: 'Target element not found' };

  const rect = target.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  const topElement = document.elementFromPoint(centerX, centerY);

  if (target === topElement || target.contains(topElement)) {
    return { clear: true, targetTag: target.tagName, rect };
  }

  return {
    clear: false,
    obscuredBy: {
      tag: topElement?.tagName,
      id: topElement?.id,
      className: topElement?.className,
      text: topElement?.innerText?.slice(0, 50)
    },
    recommendation: 'Remove or dismiss blocker before clicking'
  };
})('button#submit-button');
```

### 2. Auto-Scroll to Center (Prevent Sticky Header Obscuring)

```javascript
((selector) => {
  const el = document.querySelector(selector);
  if (!el) return { success: false };

  el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
  return { success: true, rect: el.getBoundingClientRect() };
})('input[name="email"]');
```

### 3. Pierce Shadow DOM to Find Hidden Elements

```javascript
((selector) => {
  function queryShadowRoot(root, sel) {
    let match = root.querySelector(sel);
    if (match) return match;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      if (node.shadowRoot) {
        match = queryShadowRoot(node.shadowRoot, sel);
        if (match) return match;
      }
    }
    return null;
  }

  const el = queryShadowRoot(document, selector);
  if (el) {
    el.click();
    return { success: true, tag: el.tagName };
  }
  return { success: false, notFound: true };
})('input#shadow-input');
```

### 4. Synthetic Deep Click Fallback (Bypasses UI Pointer Interception)

```javascript
((selector) => {
  const el = document.querySelector(selector);
  if (!el) return { success: false };

  // Dispatch full synthetic event chain
  ['mousedown', 'mouseup', 'click'].forEach(eventType => {
    el.dispatchEvent(new MouseEvent(eventType, {
      bubbles: true,
      cancelable: true,
      view: window
    }));
  });

  return { success: true, eventDispatched: true };
})('button.interrupted-btn');
```
