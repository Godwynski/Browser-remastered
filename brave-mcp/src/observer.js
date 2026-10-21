export class BrowserObserver {
  constructor() {
    this.currentObservation = null;
  }

  /**
   * Generates a lightweight fingerprint of the page's interactive state.
   */
  async getDomFingerprint(page) {
    try {
      return await page.evaluate(() => {
        const interactive = document.querySelectorAll('button, a[href], input, select, textarea, [role="button"]');
        let hash = `${interactive.length}:`;
        for (let i = 0; i < Math.min(25, interactive.length); i++) {
          const el = interactive[i];
          hash += `${el.tagName}:${(el.innerText || el.getAttribute('aria-label') || el.value || '').slice(0, 15)}|`;
        }
        return hash;
      });
    } catch (e) {
      return `fp_${Date.now()}`;
    }
  }

  /**
   * Formats elements into a compact, token-dense text representation with
   * hybrid spatial partitioning (viewport items in full detail, offscreen ledger)
   * and prominent page alert reporting.
   */
  formatCompact(elements, meta = {}) {
    if (!elements || elements.length === 0) return "(No interactive elements detected)";

    const visible = [];
    const offscreenBelow = [];
    const offscreenAbove = [];

    for (const e of elements) {
      if (e.inViewport === false) {
        if (e.domMeta && e.domMeta.top < 0) {
          offscreenAbove.push(e);
        } else {
          offscreenBelow.push(e);
        }
      } else {
        visible.push(e);
      }
    }

    const lines = [];

    if (meta.title || meta.url) {
      lines.push(`# PAGE: ${meta.title || 'Untitled'} | y:${meta.scrollY || 0}/${meta.docHeight || 0} [${meta.obsId || ''}]`);
      if (meta.url) lines.push(`URL: ${meta.url}`);
    }

    if (meta.alerts && meta.alerts.length > 0) {
      for (const alert of meta.alerts) {
        lines.push(`⚠️ PAGE ALERT: "${alert}"`);
      }
    }

    if (meta.directives && meta.directives.length > 0) {
      for (const d of meta.directives) {
        lines.push(`📩 HUD DIRECTIVE: "${d.prompt || d}"`);
      }
    }

    if (lines.length > 0) lines.push('');

    // 1. Visible elements rendered in full detail
    if (visible.length > 0) {
      lines.push(`VISIBLE (${visible.length} items):`);
      for (const e of visible) {
        let line = `[${e.ref}] <${e.role || 'element'}>`;
        if (e.name) line += ` "${e.name}"`;
        if (e.value) line += ` value="${e.value}"`;
        if (e.checked) line += ` [checked]`;
        if (e.disabled) line += ` [disabled]`;
        if (e.domMeta?.id) line += ` #${e.domMeta.id}`;
        if (e.frameIndex !== null && e.frameIndex !== undefined) line += ` (iframe ${e.frameIndex})`;
        lines.push(line);
      }
    } else {
      lines.push(`VISIBLE: (No interactive elements in current viewport)`);
    }

    // 2. Offscreen Landmark Ledger: dense summary with valid refs (pruned if visibleOnly)
    const hasOffscreen = !meta.visibleOnly && (offscreenAbove.length > 0 || offscreenBelow.length > 0);
    if (hasOffscreen) {
      lines.push('');
      lines.push(`OFFSCREEN (direct action auto-scrolls):`);
      if (offscreenAbove.length > 0) {
        const items = offscreenAbove.map(e => `${e.ref} (<${e.role || 'element'}> "${e.name || e.domMeta?.id || ''}")`).slice(0, 8);
        lines.push(`[Above]: ${items.join(', ')}${offscreenAbove.length > 8 ? ` ... (+${offscreenAbove.length - 8} more)` : ''}`);
      }
      if (offscreenBelow.length > 0) {
        const items = offscreenBelow.map(e => `${e.ref} (<${e.role || 'element'}> "${e.name || e.domMeta?.id || ''}")`).slice(0, 12);
        lines.push(`[Below]: ${items.join(', ')}${offscreenBelow.length > 12 ? ` ... (+${offscreenBelow.length - 12} more)` : ''}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Parses Playwright locator.ariaSnapshot() YAML text into structured accessible nodes.
   */
  _parseAriaSnapshot(yamlString, interactiveRoles) {
    if (!yamlString) return [];
    const lines = yamlString.split('\n');
    const elements = [];

    for (const rawLine of lines) {
      const trimmed = rawLine.trim();
      if (!trimmed.startsWith('-')) continue;

      const match = trimmed.match(/^-\s*([a-zA-Z0-9_-]+)(?::\s*|\s+)?(?:"((?:\\.|[^"\\])*)")?(.*)$/);
      if (!match) continue;

      const role = match[1].toLowerCase();
      const name = match[2] ? match[2].replace(/\\"/g, '"').trim() : undefined;
      const flags = match[3] || '';

      if (role === 'document' || role === 'heading' || role === 'paragraph' || role === 'text' || role === 'group') {
        continue;
      }

      if (interactiveRoles && !interactiveRoles.has(role)) {
        continue;
      }

      // Filter out unlabelled non-input elements (e.g. empty links or icon wrappers) to minimize token usage
      const isInputRole = ['textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'slider', 'spinbutton'].includes(role);
      if (!name && !isInputRole) {
        continue;
      }

      const checked = flags.includes('[checked]') ? true : undefined;
      const disabled = flags.includes('[disabled]') ? true : undefined;
      const selected = flags.includes('[selected]') ? true : undefined;

      elements.push({
        role,
        name,
        checked,
        disabled,
        selected
      });
    }
    return elements;
  }

  /**
   * Performs tri-source observation: DOM + ARIA + Screenshot.
   * Discovers elements across main frame and accessible iframes.
   * Generates ephemeral element references (e1, e2, ...).
   * Supports token-efficient compact formatting and scoped selector targeting.
   */
  async observe(page, options = {}) {
    const {
      includeScreenshot = false,
      screenshotScope = null,
      clip = null,
      maxElements = 60,
      format = 'compact',
      scope = null,
      filter = 'interactive',
      visibleOnly = false,
      directives = []
    } = options;

    const obsId = `obs_${Date.now()}`;
    const url = page.url();
    const title = await page.title().catch(() => 'Unknown');

    // 1. DOM state & scroll dimensions
    const domState = await page.evaluate(() => {
      return {
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        documentHeight: document.documentElement.scrollHeight,
        readyState: document.readyState
      };
    }).catch(() => ({
      scrollX: 0,
      scrollY: 0,
      innerWidth: 1280,
      innerHeight: 800,
      documentHeight: 800,
      readyState: 'complete'
    }));

    const domFingerprint = await this.getDomFingerprint(page);

    // 1b. Live-Region & Page Alert Sentinel (captures form errors, banners, toast messages)
    const alerts = await page.evaluate(() => {
      const alertNodes = document.querySelectorAll(
        '[role="alert"], [role="status"], [aria-live="assertive"], [aria-live="polite"], ' +
        '.error-message, .alert, .toast, .notice-error, .invalid-feedback, [aria-invalid="true"]'
      );
      const messages = [];
      for (const el of alertNodes) {
        const text = (el.innerText || el.textContent || '').trim();
        const rect = el.getBoundingClientRect();
        if (text && (rect.width > 0 || rect.height > 0)) {
          messages.push(text.slice(0, 150));
        }
      }
      return Array.from(new Set(messages)).slice(0, 3);
    }).catch(() => []);

    const elements = [];
    const elementMap = new Map();
    let refCounter = 1;

    let interactiveRoles = new Set([
      'button', 'link', 'textbox', 'searchbox', 'combobox',
      'checkbox', 'radio', 'switch', 'menuitem', 'tab',
      'option', 'slider', 'spinbutton'
    ]);

    if (filter === 'inputs') {
      interactiveRoles = new Set(['textbox', 'searchbox', 'combobox', 'checkbox', 'radio', 'slider', 'spinbutton']);
    } else if (filter === 'buttons_links') {
      interactiveRoles = new Set(['button', 'link', 'menuitem', 'tab', 'switch']);
    }

    // 2. ARIA tree snapshot via modern Playwright locator.ariaSnapshot()
    let ariaYaml = null;
    try {
      const locator = scope ? page.locator(scope) : page.locator(':root');
      ariaYaml = await locator.ariaSnapshot({ timeout: 3000 });
    } catch (e) {
      ariaYaml = null;
    }

    if (ariaYaml) {
      const parsedAria = this._parseAriaSnapshot(ariaYaml, interactiveRoles);
      for (const item of parsedAria) {
        if (elements.length >= maxElements) break;
        const ref = `e${refCounter++}`;
        const refItem = {
          ref,
          role: item.role,
          name: item.name || undefined,
          value: item.value || undefined,
          checked: item.checked,
          disabled: item.disabled,
          frameIndex: null
        };
        elements.push(refItem);
        elementMap.set(ref, refItem);
      }
    }

    // 3. Supplementary DOM query (provides precise IDs, input values, iframe elements)
    const frames = page.frames();
    for (let fIdx = 0; fIdx < frames.length; fIdx++) {
      if (elements.length >= maxElements) break;
      const frame = frames[fIdx];
      const isMain = fIdx === 0;

      try {
        const domElements = await frame.evaluate(({ max, scopeSelector, filterMode }) => {
          let root = document;
          if (scopeSelector) {
            try {
              root = document.querySelector(scopeSelector);
              if (!root) return []; // Frame does not contain scopeSelector
            } catch (e) {
              return [];
            }
          }

          let query = 'button, a[href], input, textarea, select, [role="button"], [role="link"], [role="checkbox"], [role="menuitem"], [role="tab"], [role="combobox"], [contenteditable="true"], [tabindex="0"]';
          if (filterMode === 'inputs') {
            query = 'input, textarea, select, [role="textbox"], [role="combobox"], [role="checkbox"]';
          } else if (filterMode === 'buttons_links') {
            query = 'button, a[href], [role="button"], [role="link"]';
          }

          function queryDeep(container) {
            let matches = Array.from(container.querySelectorAll(query));
            try {
              const allElements = container.querySelectorAll('*');
              for (const el of allElements) {
                if (el.shadowRoot) {
                  matches = matches.concat(queryDeep(el.shadowRoot));
                }
              }
            } catch (_) {}
            return matches;
          }

          function getUniquePath(el) {
            if (el.id) {
              return `[id="${CSS.escape(el.id)}"]`;
            }
            const parts = [];
            let cur = el;
            while (cur && cur.nodeType === Node.ELEMENT_NODE && cur.tagName.toLowerCase() !== 'html') {
              let name = cur.tagName.toLowerCase();
              if (cur.id) {
                parts.unshift(`[id="${CSS.escape(cur.id)}"]`);
                break;
              }
              let parent = cur.parentElement;
              if (parent) {
                const siblings = Array.from(parent.children).filter(c => c.tagName.toLowerCase() === name);
                if (siblings.length > 1) {
                  const index = siblings.indexOf(cur) + 1;
                  name += `:nth-of-type(${index})`;
                }
              }
              parts.unshift(name);
              cur = parent;
            }
            return parts.join(' > ');
          }

          const items = [];
          const els = queryDeep(root);
          const vWidth = window.innerWidth || 1280;
          const vHeight = window.innerHeight || 800;

          for (const el of els) {
            const rect = el.getBoundingClientRect();
            const tag = el.tagName.toLowerCase();
            const isFileInput = tag === 'input' && el.type === 'file';
            const style = window.getComputedStyle(el);

            // Strict interactive visibility pruning: skip invisible, hidden or 0-opacity elements
            if (!isFileInput) {
              if (rect.width <= 0 || rect.height <= 0) continue;
              if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
            }

            const rawText = el.innerText || el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('value') || '';
            const text = rawText.replace(/\s+/g, ' ').trim();
            const isFormInput = ['input', 'textarea', 'select'].includes(tag);
            // Drop completely empty, unlabelled non-input nodes to save tokens
            if (!text && !el.id && !el.name && !isFormInput && !isFileInput) {
              continue;
            }

            const inViewport = (rect.top >= 0 && rect.top <= vHeight && rect.left >= 0 && rect.left <= vWidth);
            const cx = Math.round(rect.left + rect.width / 2);
            const cy = Math.round(rect.top + rect.height / 2);

            items.push({
              tag,
              role: el.getAttribute('role') || el.tagName.toLowerCase(),
              name: text.slice(0, 100),
              type: el.getAttribute('type') || undefined,
              value: (el.value || '').slice(0, 100),
              disabled: el.disabled || undefined,
              id: el.id || undefined,
              nameAttr: el.name || undefined,
              uniqueSelector: getUniquePath(el),
              centerX: cx,
              centerY: cy,
              inViewport,
              top: Math.round(rect.top),
              left: Math.round(rect.left),
              width: Math.round(rect.width),
              height: Math.round(rect.height)
            });
          }

          // Viewport-Priority Sorting: visible items first, then top-to-bottom
          items.sort((a, b) => {
            if (a.inViewport && !b.inViewport) return -1;
            if (!a.inViewport && b.inViewport) return 1;
            return a.top - b.top;
          });

          return items.slice(0, max);
        }, { max: maxElements - elements.length, scopeSelector: scope, filterMode: filter });

        for (const d of domElements) {
          // If already discovered by ARIA in the main frame, augment with DOM metadata (ensure 1-to-1 match)
          const existing = isMain ? elements.find(e => 
            e.frameIndex === null &&
            !e.domMeta &&
            ((e.name && d.name && e.name.toLowerCase() === d.name.toLowerCase()) ||
             (e.role === 'textbox' && (d.tag === 'input' || d.tag === 'textarea') && (!e.name || e.name === d.name)))
          ) : null;

          if (existing) {
            existing.domMeta = d;
            existing.inViewport = d.inViewport;
            if (d.value && !existing.value) existing.value = d.value;
            const mapItem = elementMap.get(existing.ref);
            if (mapItem) {
              mapItem.domMeta = d;
              mapItem.inViewport = d.inViewport;
            }
          } else {
            if (elements.length >= maxElements) break;
            const ref = `e${refCounter++}`;
            const item = {
              ref,
              role: d.role,
              name: d.name || undefined,
              value: d.value || undefined,
              disabled: d.disabled,
              domMeta: d,
              inViewport: d.inViewport,
              frameIndex: isMain ? null : fIdx
            };
            elements.push(item);
            elementMap.set(ref, item);
          }
        }
      } catch (err) {
        // Frame may be restricted or cross-origin sandbox
      }
    }

    // 4. Viewport or scoped region screenshot (saves 85%+ vision tokens when scoped)
    let screenshotBase64 = null;
    let screenshotScopeInfo = 'viewport';
    if (includeScreenshot) {
      try {
        let buffer = null;
        if (screenshotScope) {
          const loc = page.locator(screenshotScope).first();
          buffer = await loc.screenshot({ type: 'jpeg', quality: 75, timeout: 5000 });
          screenshotScopeInfo = `element:${screenshotScope}`;
        } else if (clip) {
          let clipRect = null;
          if (Array.isArray(clip) && clip.length >= 4) {
            clipRect = { x: clip[0], y: clip[1], width: clip[2], height: clip[3] };
          } else if (clip && typeof clip === 'object' && clip.x !== undefined && clip.y !== undefined) {
            clipRect = {
              x: Math.round(clip.x),
              y: Math.round(clip.y),
              width: Math.round(clip.width || clip.w || 200),
              height: Math.round(clip.height || clip.h || 200)
            };
          }
          if (clipRect) {
            buffer = await page.screenshot({ clip: clipRect, type: 'jpeg', quality: 75, timeout: 5000 });
            screenshotScopeInfo = `clip:[${clipRect.x},${clipRect.y},${clipRect.width}x${clipRect.height}]`;
          }
        }

        if (!buffer) {
          buffer = await page.screenshot({
            type: 'jpeg',
            quality: 75,
            timeout: 5000
          });
        }
        screenshotBase64 = buffer.toString('base64');
      } catch (err) {
        screenshotBase64 = null;
      }
    }

    // Cache the observation internally (full structured maps preserved)
    this.currentObservation = {
      obsId,
      url,
      title,
      timestamp: Date.now(),
      domState,
      domFingerprint,
      alerts,
      elements,
      elementMap,
      screenshot: screenshotBase64,
      screenshotScope: screenshotScopeInfo
    };

    const compactOutput = this.formatCompact(elements, {
      title,
      url,
      alerts,
      directives,
      scrollY: domState.scrollY,
      docHeight: domState.documentHeight,
      obsId,
      visibleOnly
    });

    return {
      obs_id: obsId,
      tab: {
        title,
        url
      },
      page: {
        loading: domState.readyState !== 'complete',
        scroll: {
          x: domState.scrollX,
          y: domState.scrollY,
          documentHeight: domState.documentHeight
        },
        viewport: {
          width: domState.innerWidth,
          height: domState.innerHeight
        }
      },
      alerts,
      directives,
      format,
      element_count: elements.length,
      elements_compact: compactOutput,
      elements: elements,
      screenshot: screenshotBase64 ? `data:image/jpeg;base64,${screenshotBase64}` : null,
      screenshot_scope: screenshotBase64 ? screenshotScopeInfo : undefined
    };
  }



  /**
   * Resolves an ephemeral reference (e.g. "e2") against the current observation.
   * Validates obs_id if provided.
   */
  resolveRef(ref, expectedObsId = null) {
    if (!this.currentObservation) {
      throw new Error("No active observation found. Call brave_observe first.");
    }

    if (expectedObsId && this.currentObservation.obsId !== expectedObsId) {
      throw new Error(
        `Stale observation error: Action was submitted with obs_id '${expectedObsId}', ` +
        `but active observation is '${this.currentObservation.obsId}'. ` +
        `The page has updated. Call brave_observe to inspect the new page state.`
      );
    }

    const item = this.currentObservation.elementMap.get(ref);
    if (!item) {
      const validRefs = Array.from(this.currentObservation.elementMap.keys()).join(', ');
      throw new Error(
        `Element reference '${ref}' not found in observation '${this.currentObservation.obsId}'.\n` +
        `Available refs: [${validRefs}].\n` +
        `If the page changed, call brave_observe to get a fresh observation.`
      );
    }
    return item;
  }

  /**
   * Invalidate current observation (e.g. after navigation or mutation).
   */
  invalidate() {
    this.currentObservation = null;
  }
}
