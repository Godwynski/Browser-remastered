export class StateVerifier {
  constructor(observer) {
    this.observer = observer;
  }

  /**
   * Captures a quick lightweight snapshot of the page before an action.
   */
  async captureBeforeState(page) {
    const url = page.url();
    const title = await page.title().catch(() => '');
    const readyState = await page.evaluate(() => document.readyState).catch(() => 'complete');
    const fingerprint = this.observer ? await this.observer.getDomFingerprint(page) : '';

    return {
      url,
      title,
      readyState,
      fingerprint,
      lastDownloadTime: page._lastDownload?.timestamp || 0,
      lastDialogTime: page._lastDialog?.timestamp || 0,
      timestamp: Date.now()
    };
  }

  /**
   * Waits for relevant state change following an action, then captures after state.
   */
  async captureAfterState(page, beforeState, options = {}) {
    const { includeScreenshot = false } = options;

    // Fast deterministic stabilization: rAF for foreground, setTimeout for background to avoid freezing
    await page.evaluate(() => new Promise(r => {
      if (document.visibilityState === 'visible') {
        requestAnimationFrame(() => setTimeout(r, 60));
      } else {
        setTimeout(r, 50);
      }
    })).catch(() => {});

    const afterUrl = page.url();
    const afterTitle = await page.title().catch(() => '');
    const afterReady = await page.evaluate(() => document.readyState).catch(() => 'complete');
    const afterFingerprint = this.observer ? await this.observer.getDomFingerprint(page) : '';

    let screenshotBase64 = null;
    if (includeScreenshot) {
      try {
        const buffer = await page.screenshot({
          type: 'jpeg',
          quality: 70,
          timeout: 4000
        });
        screenshotBase64 = buffer.toString('base64');
      } catch (e) {
        screenshotBase64 = null;
      }
    }

    return {
      url: afterUrl,
      title: afterTitle,
      readyState: afterReady,
      fingerprint: afterFingerprint,
      timestamp: Date.now(),
      screenshot: screenshotBase64
    };
  }

  /**
   * Computes the diff between beforeState and afterState and returns an Action Receipt.
   */
  createReceipt(actionSummary, beforeState, afterState, extraDetails = {}) {
    const changes = [];

    if (beforeState.url !== afterState.url) {
      changes.push(`URL navigated from ${beforeState.url} to ${afterState.url}`);
    }

    if (beforeState.title !== afterState.title) {
      changes.push(`Page title changed from "${beforeState.title}" to "${afterState.title}"`);
    }

    if (extraDetails.elementChange) {
      changes.push(extraDetails.elementChange);
    }

    // Detect dynamic DOM mutation (SPA state change without URL change)
    if (beforeState.fingerprint && afterState.fingerprint && beforeState.fingerprint !== afterState.fingerprint) {
      changes.push("DOM structure mutated (dynamic element or content update)");
    }

    if (extraDetails.download) {
      changes.push(`Downloaded file "${extraDetails.download.filename}" to ${extraDetails.download.path}`);
    }

    if (extraDetails.dialogMessage) {
      changes.push(`Dialog opened with message: "${extraDetails.dialogMessage}"`);
    }

    if (changes.length === 0) {
      changes.push("Action executed; no immediate top-level DOM or URL change observed.");
    }

    return {
      action: actionSummary,
      executed: true,
      before: {
        url: beforeState.url,
        title: beforeState.title
      },
      after: {
        url: afterState.url,
        title: afterState.title
      },
      changes,
      screenshot: afterState.screenshot ? `data:image/jpeg;base64,${afterState.screenshot}` : null
    };
  }
}
