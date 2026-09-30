function escapeCss(str) {
  return String(str).replace(/([ #;&,.+*~':"!^$[\]()=>|\/@])/g, '\\$1');
}

export class ActionEngine {
  constructor(observer, verifier) {
    this.observer = observer;
    this.verifier = verifier;
  }

  /**
   * Helper to locate an element across the main page or targeted iframe.
   * Employs multi-tier locator resolution: ARIA role, Placeholder, Text, ID/Name attrs.
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
        return context.locator(`#${escapeCss(domMeta.id)}`).first();
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
        if (!ref) throw new Error("Parameter 'ref' is required for action 'click'.");
        const refItem = this.observer.resolveRef(ref, obs_id);
        const locator = this.getLocatorForRef(page, refItem);
        await locator.click({ timeout: 6000 });
        elementChange = `Clicked ${refItem.role || 'element'} "${refItem.name || ref}"${refItem.frameIndex !== null ? ' (inside iframe)' : ''}`;
        break;
      }

      case 'type': {
        if (!ref) throw new Error("Parameter 'ref' is required for action 'type'.");
        if (text === undefined) throw new Error("Parameter 'text' is required for action 'type'.");
        const refItem = this.observer.resolveRef(ref, obs_id);
        const locator = this.getLocatorForRef(page, refItem);
        if (params.humanLike) {
          await locator.click({ timeout: 4000 });
          await page.keyboard.type(text, { delay: 25 });
        } else {
          try {
            await locator.fill(text, { timeout: 6000 });
          } catch (fillErr) {
            // Fallback for custom or contenteditable elements
            await locator.click({ timeout: 4000 });
            await page.keyboard.type(text, { delay: 15 });
          }
        }
        if (pressEnter) {
          await locator.press('Enter');
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
        if (!ref) throw new Error("Parameter 'ref' is required for action 'hover'.");
        const refItem = this.observer.resolveRef(ref, obs_id);
        const locator = this.getLocatorForRef(page, refItem);
        await locator.hover({ timeout: 5000 });
        elementChange = `Hovered over ${refItem.role || 'element'} "${refItem.name || ref}"`;
        break;
      }

      case 'select_option': {
        if (!ref) throw new Error("Parameter 'ref' is required for action 'select_option'.");
        if (!value) throw new Error("Parameter 'value' is required for action 'select_option'.");
        const refItem = this.observer.resolveRef(ref, obs_id);
        const locator = this.getLocatorForRef(page, refItem);
        try {
          await locator.selectOption(value, { timeout: 5000 });
        } catch (selErr) {
          // Fallback for custom ARIA combobox / dropdown: click dropdown then click option text
          await locator.click({ timeout: 4000 });
          await page.waitForTimeout(200);
          const optionLocator = page.locator(`[role="option"]:has-text("${value}"), li:has-text("${value}"), div:has-text("${value}")`).first();
          await optionLocator.click({ timeout: 4000 });
        }
        elementChange = `Selected option "${value}" on ${refItem.role || 'select'} "${refItem.name || ref}"`;
        break;
      }

      case 'upload_file': {
        if (!ref) throw new Error("Parameter 'ref' is required for action 'upload_file'.");
        if (!filePaths || !Array.isArray(filePaths)) throw new Error("Parameter 'filePaths' (array of string paths) is required for action 'upload_file'.");
        const refItem = this.observer.resolveRef(ref, obs_id);
        const locator = this.getLocatorForRef(page, refItem);
        await locator.setInputFiles(filePaths, { timeout: 6000 });
        elementChange = `Uploaded ${filePaths.length} file(s) into file input "${refItem.name || ref}"`;
        break;
      }

      default:
        throw new Error(`Unknown action '${action}'. Supported actions: click, type, press, scroll, hover, select_option, upload_file.`);
    }

    // Capture after state and create receipt
    const afterState = await this.verifier.captureAfterState(page, beforeState, { includeScreenshot });

    const shouldObserve = andObserve || Boolean(params.and_observe);
    let nextObservation = null;

    if (shouldObserve) {
      // Deterministic settlement gate: if URL navigated or loading, wait for domcontentloaded
      if (beforeState.url !== afterState.url || afterState.readyState !== 'complete') {
        await page.waitForLoadState('domcontentloaded', { timeout: 3500 }).catch(() => {});
      }
      // Micro-stabilization for dynamic DOM renders / modal animations
      await page.waitForTimeout(150).catch(() => {});
      nextObservation = await this.observer.observe(page, { format: 'compact', ...observeOptions });
    } else {
      // Invalidate stale observation references if URL navigated to a new page
      if (!suppressInvalidate && beforeState.url !== afterState.url) {
        this.observer.invalidate();
      }
    }

    const receipt = this.verifier.createReceipt(
      { type: action, ref, obs_id, text: text ? text.slice(0, 50) : undefined },
      beforeState,
      afterState,
      { elementChange }
    );

    if (nextObservation) {
      receipt.nextObservation = nextObservation;
    }

    return receipt;
  }
}
