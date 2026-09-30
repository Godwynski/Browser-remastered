import path from 'path';
import fs from 'fs';
import { PATHS, ensureArtifactDirs } from '../../src/paths.js';

/**
 * crop-screenshot: Captures a tightly-cropped screenshot of a specific selector or bounding box.
 * Saves 85%+ visual tokens compared to full-screen captures.
 */
export async function run(page, params = {}) {
  const {
    selector,
    clip, // { x, y, width, height }
    saveToFile = true,
    quality = 75
  } = params;

  ensureArtifactDirs();
  let buffer = null;
  let boundingBox = null;

  if (selector) {
    const locator = page.locator(selector).first();
    boundingBox = await locator.boundingBox().catch(() => null);
    buffer = await locator.screenshot({
      type: 'jpeg',
      quality,
      timeout: 5000
    });
  } else if (clip) {
    boundingBox = clip;
    buffer = await page.screenshot({
      type: 'jpeg',
      quality,
      clip,
      timeout: 5000
    });
  } else {
    throw new Error("Either 'selector' or 'clip' ({ x, y, width, height }) must be provided.");
  }

  const base64 = buffer.toString('base64');
  let savedPath = null;

  if (saveToFile) {
    const filename = `crop-${Date.now()}.jpeg`;
    savedPath = path.join(PATHS.screenshots, filename);
    fs.writeFileSync(savedPath, buffer);
  }

  return {
    status: 'Cropped',
    selector: selector || undefined,
    boundingBox,
    filePath: savedPath,
    bytes: buffer.length,
    base64Preview: `data:image/jpeg;base64,${base64.slice(0, 100)}... (${base64.length} chars)`,
    base64
  };
}

export default run;
