import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Workspace root is 2 levels up from brave-mcp/src
export const WORKSPACE_ROOT = path.resolve(__dirname, '../../');
export const ARTIFACTS_DIR = path.join(WORKSPACE_ROOT, 'artifacts');

export const PATHS = {
  root: WORKSPACE_ROOT,
  artifacts: ARTIFACTS_DIR,
  downloads: path.join(ARTIFACTS_DIR, 'downloads'),
  downloadsRaw: path.join(ARTIFACTS_DIR, 'downloads', 'raw'),
  testRuns: path.join(ARTIFACTS_DIR, 'test-runs'),
  screenshots: path.join(ARTIFACTS_DIR, 'screenshots'),
  temp: path.join(ARTIFACTS_DIR, 'temp')
};

/**
 * Ensures all standard runtime artifact directories exist.
 */
export function ensureArtifactDirs() {
  const dirs = [
    PATHS.artifacts,
    PATHS.downloads,
    PATHS.downloadsRaw,
    PATHS.testRuns,
    PATHS.screenshots,
    PATHS.temp
  ];

  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

/**
 * Resolves a path relative to the artifacts directory.
 */
export function getArtifactPath(...segments) {
  return path.join(ARTIFACTS_DIR, ...segments);
}
