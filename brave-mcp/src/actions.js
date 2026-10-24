function escapeCss(str) {
  return String(str).replace(/([ #;&,.+*~':"!^$[\]()=>|\/@])/g, '\\$1');
}

function parseCoordinate(param, xParam, yParam) {
  if (Array.isArray(param) && param.length >= 2) {
    return [Math.round(param[0]), Math.round(param[1])];
  }
  if (param && typeof param === 'object' && 'x' in param && 'y' in param) {
    return [Math.round(param.x), Math.round(param.y)];
  }
  if (typeof param === 'string' && param.includes(',')) {
    const parts = param.split(',').map(s => parseFloat(s.trim()));
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
      return [Math.round(parts[0]), Math.round(parts[1])];
    }
  }
  if (xParam !== undefined && yParam !== undefined) {
    const nx = parseFloat(xParam);
    const ny = parseFloat(yParam);
    if (!isNaN(nx) && !isNaN(ny)) {
      return [Math.round(nx), Math.round(ny)];
    }
  }
  return null;
}

export class ActionEngine {
  constructor(observer, verifier) {
    this.observer = observer;
    this.verifier = verifier;
  }

  /**
   * Helper to locate an element across the main page or targeted iframe.
   * Multi-tier resolution: ID -> Unique CSS Path -> Name Attribute -> ARIA Role -> Text.
   */
  getLocatorForRef(page, refItem) {
    const { role, name, domMeta, frameIndex } = refItem;

    // Determine execution context (main frame or specific iframe)
    let context = page;
    if (frameIndex !== null && frameIndex !== undefined) {
      const frames = page.frames();
      if (frames[frameIndex]) {
        context = frames[frameIndex];
      }
    }

    // Normalize role: ARIA uses 'textbox' for inputs and textareas
    let ariaRole = role ? role.toLowerCase() : '';
    if (ariaRole === 'input' || ariaRole === 'textarea') {
      ariaRole = 'textbox';
    }

    // 1. Direct DOM attribute matches (most precise if available)
    if (domMeta) {
      if (domMeta.id) {
        return context.locator(`[id="${escapeCss(domMeta.id)}"]`).first();
      }
      if (domMeta.uniqueSelector) {
        try {
          return context.locator(domMeta.uniqueSelector).first();
        } catch (e) {}
      }
      if (domMeta.nameAttr) {
        return context.locator(`[name="${escapeCss(domMeta.nameAttr)}"]`).first();
      }
    }

    // 2. Try ARIA role + accessible name (if valid ARIA role)
    const validAriaRoles = new Set([
      'button', 'link', 'textbox', 'searchbox', 'combobox',
      'checkbox', 'radio', 'switch', 'menuitem', 'tab',
      'option', 'slider', 'spinbutton', 'heading', 'dialog'
    ]);

    if (validAriaRoles.has(ariaRole)) {
      if (name) {
        try {
          return context.getByRole(ariaRole, { name, exact: false }).first();
        } catch (e) {}
      } else {
        try {
          return context.getByRole(ariaRole).first();
        } catch (e) {}
      }
    }

    // 3. Try placeholder for inputs
    if (name && (ariaRole === 'textbox' || !ariaRole)) {
      try {
        return context.getByPlaceholder(name, { exact: false }).first();
      } catch (e) {}
    }

    // 4. Try accessible name as text
    if (name) {
      try {
        return context.getByText(name, { exact: false }).first();
      } catch (e) {}
    }

    // 5. Fallback to DOM tag / text
    if (domMeta && domMeta.tag) {
      if (domMeta.name) {
        return context.locator(`${domMeta.tag}:has-text("${domMeta.name}")`).first();
      }
      return context.locator(domMeta.tag).first();
    }

    throw new Error(`Unable to determine locator for element '${refItem.ref}' ("${refItem.name || refItem.role}").`);
  }

  /**
   * Dispatches synthetic DOM events directly to bypass pointer interception,
   * sticky headers, backdrop blockers, and pointer-events: none.
   */
  async _dispatchSyntheticClick(page, refItem, button = 'left') {
    let context = page;
    if (refItem.frameIndex !== null && refItem.frameIndex !== undefined) {
      const frames = page.frames();
      if (frames[refItem.frameIndex]) context = frames[refItem.frameIndex];
    }

    return await context.evaluate(({ uniqueSelector, id, cx, cy }) => {
      let target = null;
      if (id) target = document.getElementById(id);
      if (!target && uniqueSelector) {
        try { target = document.querySelector(uniqueSelector); } catch (e) {}
      }
      if (!target && cx && cy) {
        target = document.elementFromPoint(cx, cy);
      }

      if (!target) return false;

      const clickable = target.closest('button, a, [role="button"], input, select') || target;
      clickable.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });

      const mouseOpts = { bubbles: true, cancelable: true, view: window };
      clickable.dispatchEvent(new MouseEvent('mousedown', mouseOpts));
      clickable.dispatchEvent(new MouseEvent('mouseup', mouseOpts));
      clickable.dispatchEvent(new MouseEvent('click', mouseOpts));
      if (typeof clickable.click === 'function') {
        try { clickable.click(); } catch (_) {}
      }
      return true;
    }, {
      uniqueSelector: refItem.domMeta?.uniqueSelector,
      id: refItem.domMeta?.id,
      cx: refItem.domMeta?.centerX,
      cy: refItem.domMeta?.centerY
    }).catch(() => false);
  }

  /**
   * Auto-detects and dismisses intrusive cookie banners, GDPR prompts, and modal overlays.
   */
  async dismissOverlays(page) {
    try {
      return await page.evaluate(() => {
        const commonSelectors = [
          '#onetrust-accept-btn-handler',
          'button[id*="accept" i]',
          'button[class*="cookie" i]',
          'button[aria-label*="accept" i]',
          '[aria-label="Close"]',
          '.modal-close',
          '.close-button',
          '[data-dismiss="modal"]'
        ];

        for (const sel of commonSelectors) {
          try {
            const btn = document.querySelector(sel);
            if (btn && btn.offsetParent !== null) {
              btn.click();
              return true;
            }
          } catch (_) {}
        }

        const phrases = ['accept all', 'accept cookies', 'i agree', 'allow all', 'got it', 'accept'];
        const buttons = Array.from(document.querySelectorAll('button, a[role="button"]'));
        for (const btn of buttons) {
          if (btn.offsetParent !== null) {
            const txt = (btn.innerText || btn.textContent || '').trim().toLowerCase();
            if (phrases.some(p => txt === p || txt.startsWith(p))) {
              btn.click();
              return true;
            }
          }
        }
        return false;
      });
    } catch (e) {
      return false;
    }
  }

  /**
   * Executes an action against the page and produces an Action Receipt.
   * If andObserve is true, automatically waits for DOM settlement and returns
   * the fresh next-state observation directly inside the receipt.
   */
  async execute(page, params, { suppressInvalidate = false, andObserve = false, observeOptions = {} } = {}) {
    const {
      action,
      ref,
      obs_id,
      text,
      key,
      direction = 'down',
      amount = 500,
      value,
      filePaths,
      pressEnter = false,
      includeScreenshot = false
    } = params;

    const beforeState = await this.verifier.captureBeforeState(page);
    let elementChange = null;

    switch (action) {
      case 'click': {
        const coord = parseCoordinate(params.coordinate, params.x, params.y);
        const clickOptions = { timeout: 2500 };
        const button = params.button || 'left';
        clickOptions.button = button;
        if (params.clickCount) {
          clickOptions.clickCount = params.clickCount;
        }

        // Direct coordinate / visual click mode (bypasses DOM queries for canvas, WebGL, SVG, maps)
        if (coord) {
          const [cx, cy] = coord;
          await page.mouse.click(cx, cy, clickOptions);
          elementChange = `Clicked (${button}${params.clickCount > 1 ? ` x${params.clickCount}` : ''}) at coordinates [${cx}, ${cy}]`;
          break;
        }

        if (!ref) throw new Error("Parameter 'ref' or 'coordinate' ([x, y]) is required for action 'click'.");
        const refItem = this.observer.resolveRef(ref, obs_id, page);

        // --- 5-Tier Self-Healing Click Execution ---
        let clickSucceeded = false;
        let methodUsed = 'standard_click';
        let lastErr = null;

        // Tier 1: Standard Playwright click
        try {
          const locator = this.getLocatorForRef(page, refItem);
          await locator.click(clickOptions);
          clickSucceeded = true;
        } catch (err1) {
          lastErr = err1;

          // Tier 2: Scroll into center + force click (resolves sticky headers & intercepted pointers)
          try {
            const locator = this.getLocatorForRef(page, refItem);
            await locator.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
            await locator.click({ ...clickOptions, force: true, timeout: 2000 });
            clickSucceeded = true;
            methodUsed = 'scroll_and_force_click';
          } catch (err2) {
            lastErr = err2;

            // Tier 3: Synthetic DOM Event Dispatch (bypasses backdrop overlays & pointer-events: none)
            try {
              const executed = await this._dispatchSyntheticClick(page, refItem, params.button);
              if (executed) {
                clickSucceeded = true;
                methodUsed = 'synthetic_dom_dispatch';
              }
            } catch (err3) {}

            // Tier 4: Hardware coordinate click via dynamic bounding box (handles iframes, transforms, and scrolling)
            if (!clickSucceeded) {
              try {
                const locator = this.getLocatorForRef(page, refItem);
                const box = await locator.boundingBox().catch(() => null);
                if (box && box.width > 0 && box.height > 0) {
                  const cx = Math.round(box.x + box.width / 2);
                  const cy = Math.round(box.y + box.height / 2);
                  await page.mouse.click(cx, cy, clickOptions);
                  clickSucceeded = true;
                  methodUsed = 'boundingbox_coordinate_click';
                } else if (refItem.domMeta?.centerX && refItem.domMeta?.centerY && refItem.frameIndex === null) {
                  await page.mouse.click(refItem.domMeta.centerX, refItem.domMeta.centerY, clickOptions);
                  clickSucceeded = true;
                  methodUsed = 'cached_coordinate_click';
                }
              } catch (err4) {}
            }

            // Tier 5: Dismiss overlay blocker and retry
            if (!clickSucceeded) {
              const dismissed = await this.dismissOverlays(page);
              if (dismissed) {
                try {
                  const locator = this.getLocatorForRef(page, refItem);
                  await locator.click({ ...clickOptions, force: true, timeout: 2500 });
                  clickSucceeded = true;
                  methodUsed = 'click_after_overlay_dismissal';
                } catch (err5) {}
              }
            }

            if (!clickSucceeded) {
              throw new Error(`Failed to click element '${ref}' ("${refItem.name || refItem.role}") after self-healing attempts: ${lastErr?.message || 'Element unclickable'}`);
            }
          }
        }

        elementChange = `Clicked (${button}) ${refItem.role || 'element'} "${refItem.name || ref}"${refItem.frameIndex !== null ? ' (inside iframe)' : ''}${methodUsed !== 'standard_click' ? ` [self-healed via ${methodUsed}]` : ''}`;
        break;
      }

      case 'type': {
        if (text === undefined) throw new Error("Parameter 'text' is required for action 'type'.");
        const coord = parseCoordinate(params.coordinate, params.x, params.y);

        // Direct coordinate / visual typing mode (clicks location to focus, clears, and types)
        if (coord) {
          const [cx, cy] = coord;
          await page.mouse.click(cx, cy);
          if (params.clear !== false) {
            const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
            await page.keyboard.press(`${modifier}+a`).catch(() => {});
            await page.keyboard.press('Backspace').catch(() => {});
          }
          await page.keyboard.type(text, { delay: params.humanLike ? 25 : 5 });
          if (pressEnter) {
            await page.keyboard.press('Enter');
          }
          elementChange = `Clicked coordinates [${cx}, ${cy}] and typed "${text}"${pressEnter ? ' and pressed Enter' : ''}`;
          break;
        }

        if (!ref) throw new Error("Parameter 'ref' or 'coordinate' ([x, y]) is required for action 'type'.");
        const refItem = this.observer.resolveRef(ref, obs_id, page);
        const locator = this.getLocatorForRef(page, refItem);

        if (params.clear === false) {
          await locator.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
          await locator.click({ timeout: 2000, force: true }).catch(() => {});
          await page.keyboard.press('End').catch(() => {});
          await page.keyboard.type(text, { delay: params.humanLike ? 25 : 5 });
        } else if (params.humanLike) {
          await locator.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
          await locator.click({ timeout: 3000, force: true }).catch(() => {});
          await page.keyboard.type(text, { delay: 25 });
        } else {
          let typed = false;
          // Tier 1: Standard Playwright fill
          try {
            await locator.fill(text, { timeout: 3500 });
            typed = true;
          } catch (fillErr) {
            // Tier 2: React synthetic setter + contenteditable dispatch
            try {
              let context = page;
              if (refItem.frameIndex !== null && refItem.frameIndex !== undefined) {
                const frames = page.frames();
                if (frames[refItem.frameIndex]) context = frames[refItem.frameIndex];
              }
              typed = await context.evaluate(({ id, uniqueSelector, val }) => {
                let el = null;
                if (id) el = document.getElementById(id);
                if (!el && uniqueSelector) {
                  try { el = document.querySelector(uniqueSelector); } catch (e) {}
                }
                if (!el) return false;

                el.focus();
                if (el.isContentEditable) {
                  el.innerText = val;
                  el.dispatchEvent(new Event('input', { bubbles: true }));
                  return true;
                }

                // Trigger React synthetic setter
                const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
                const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
                if (setter) {
                  setter.call(el, val);
                } else {
                  el.value = val;
                }
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
              }, {
                id: refItem.domMeta?.id,
                uniqueSelector: refItem.domMeta?.uniqueSelector,
                val: text
              });
            } catch (reactErr) {}

            // Tier 3: Click to focus + keyboard typing fallback
            if (!typed) {
              await locator.scrollIntoViewIfNeeded({ timeout: 1500 }).catch(() => {});
              await locator.click({ timeout: 3000, force: true }).catch(() => {});
              const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
              await page.keyboard.press(`${modifier}+a`).catch(() => {});
              await page.keyboard.type(text, { delay: 10 });
            }
          }
        }

        if (pressEnter) {
          await locator.press('Enter').catch(async () => {
            await page.keyboard.press('Enter');
          });
        }
        elementChange = `Typed "${text}" into ${refItem.role || 'input'} "${refItem.name || ref}"${pressEnter ? ' and pressed Enter' : ''}`;
        break;
      }

      case 'press': {
        if (!key) throw new Error("Parameter 'key' is required for action 'press'. Example: 'Enter', 'Tab', 'Escape'.");
        await page.keyboard.press(key);
        elementChange = `Pressed key '${key}'`;
        break;
      }

      case 'scroll': {
        let deltaY = direction === 'down' ? amount : -amount;
        if (direction === 'top') {
          await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
          elementChange = 'Scrolled to top of page';
        } else if (direction === 'bottom') {
          await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
          elementChange = 'Scrolled to bottom of page';
        } else {
          await page.mouse.wheel(0, deltaY);
          elementChange = `Scrolled ${direction} by ${amount}px`;
        }
        break;
      }

      case 'hover': {
        const coord = parseCoordinate(params.coordinate, params.x, params.y);
        if (coord) {
          const [cx, cy] = coord;
          await page.mouse.move(cx, cy);
          elementChange = `Hovered at coordinates [${cx}, ${cy}]`;
          break;
        }

        if (!ref) throw new Error("Parameter 'ref' or 'coordinate' ([x, y]) is required for action 'hover'.");
        const refItem = this.observer.resolveRef(ref, obs_id, page);
        const locator = this.getLocatorForRef(page, refItem);
        try {
          await locator.hover({ timeout: 3500 });
        } catch (hoverErr) {
          // Dynamic bounding box hover fallback
          const box = await locator.boundingBox().catch(() => null);
          if (box && box.width > 0) {
            await page.mouse.move(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
          } else if (refItem.domMeta?.centerX && refItem.domMeta?.centerY) {
            await page.mouse.move(refItem.domMeta.centerX, refItem.domMeta.centerY);
          } else {
            throw hoverErr;
          }
        }
        elementChange = `Hovered over ${refItem.role || 'element'} "${refItem.name || ref}"`;
        break;
      }

      case 'drag': {
        let start = parseCoordinate(params.startCoordinate, params.startX, params.startY);
        let end = parseCoordinate(params.endCoordinate, params.endX, params.endY);

        if (!start && params.startRef) {
          const item = this.observer.resolveRef(params.startRef, obs_id, page);
          const locator = this.getLocatorForRef(page, item);
          const box = await locator.boundingBox().catch(() => null);
          if (box) start = [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)];
        }

        if (!end && params.endRef) {
          const item = this.observer.resolveRef(params.endRef, obs_id, page);
          const locator = this.getLocatorForRef(page, item);
          const box = await locator.boundingBox().catch(() => null);
          if (box) end = [Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2)];
        }

        if (!start || !end) {
          throw new Error("Action 'drag' requires 'startCoordinate' and 'endCoordinate' ([x, y]), or 'startRef' and 'endRef'.");
        }

        const steps = params.steps || 15;
        await page.mouse.move(start[0], start[1]);
        await page.mouse.down();
        await page.mouse.move(end[0], end[1], { steps });
        await page.mouse.up();

        elementChange = `Dragged from [${start[0]}, ${start[1]}] to [${end[0]}, ${end[1]}] in ${steps} steps`;
        break;
      }

      case 'select_option': {
        if (!ref) throw new Error("Parameter 'ref' is required for action 'select_option'.");
        if (value === undefined || value === null) throw new Error("Parameter 'value' is required for action 'select_option'.");
        const refItem = this.observer.resolveRef(ref, obs_id, page);
        const locator = this.getLocatorForRef(page, refItem);
        try {
          await locator.selectOption(value, { timeout: 3500 });
        } catch (selErr) {
          // Fallback for custom ARIA combobox / dropdown: click dropdown then click option text
          let context = page;
          if (refItem.frameIndex !== null && refItem.frameIndex !== undefined) {
            const frames = page.frames();
            if (frames[refItem.frameIndex]) context = frames[refItem.frameIndex];
          }
          await locator.click({ force: true, timeout: 3000 });
          await page.waitForTimeout(150);
          const optionLocator = context.locator('[role="option"], li, div').filter({ hasText: value }).first();
          await optionLocator.click({ force: true, timeout: 4000 });
        }
        elementChange = `Selected option "${value}" on ${refItem.role || 'select'} "${refItem.name || ref}"`;
        break;
      }

      case 'upload_file': {
        if (!ref) throw new Error("Parameter 'ref' is required for action 'upload_file'.");
        if (!filePaths || !Array.isArray(filePaths)) throw new Error("Parameter 'filePaths' (array of string paths) is required for action 'upload_file'.");
        const refItem = this.observer.resolveRef(ref, obs_id, page);
        const locator = this.getLocatorForRef(page, refItem);
        try {
          await locator.setInputFiles(filePaths, { timeout: 4000 });
        } catch (upErr) {
          // Fallback: If targeted element wasn't the input itself (e.g. styled label or wrapper), find nearest file input
          const fileInput = page.locator('input[type="file"]').first();
          await fileInput.setInputFiles(filePaths, { timeout: 4000 });
        }
        elementChange = `Uploaded ${filePaths.length} file(s) into file input "${refItem.name || ref}"`;
        break;
      }

      default:
        throw new Error(`Unknown action '${action}'. Supported actions: click, type, press, scroll, hover, drag, select_option, upload_file.`);
    }

    // Capture after state and create receipt
    const afterState = await this.verifier.captureAfterState(page, beforeState, { includeScreenshot });

    const shouldObserve = andObserve || Boolean(params.and_observe);
    let nextObservation = null;

    if (shouldObserve) {
      // Deterministic settlement gate: if URL navigated or loading, wait for domcontentloaded
      if (beforeState.url !== afterState.url || afterState.readyState !== 'complete') {
        await page.waitForLoadState('domcontentloaded', { timeout: 3500 }).catch(() => {});
      } else {
        // Fast micro-settlement: handle background tabs so they do not freeze on requestIdleCallback
        await page.evaluate(() => new Promise(r => {
          if (document.visibilityState === 'visible' && 'requestIdleCallback' in window) {
            window.requestIdleCallback(r, { timeout: 120 });
          } else {
            setTimeout(r, 50);
          }
        })).catch(() => {});
      }
      nextObservation = await this.observer.observe(page, { format: 'compact', ...observeOptions });
    } else {
      // Invalidate stale observation references if URL navigated to a new page
      if (!suppressInvalidate && beforeState.url !== afterState.url) {
        this.observer.invalidate(page);
      }
    }

    const hasDownload = page._lastDownload && page._lastDownload.timestamp > (beforeState?.lastDownloadTime || 0);
    const hasDialog = page._lastDialog && page._lastDialog.timestamp > (beforeState?.lastDialogTime || 0);

    const receipt = this.verifier.createReceipt(
      {
        type: action,
        ref: ref || (params.coordinate ? `coord[${params.coordinate}]` : undefined),
        obs_id,
        text: text ? text.slice(0, 50) : undefined
      },
      beforeState,
      afterState,
      {
        elementChange,
        download: hasDownload ? page._lastDownload : undefined,
        dialogMessage: hasDialog ? page._lastDialog.message : undefined
      }
    );

    if (nextObservation) {
      receipt.nextObservation = nextObservation;
    }

    return receipt;
  }
}
