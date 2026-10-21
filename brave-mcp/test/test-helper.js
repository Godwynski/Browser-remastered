import fs from 'fs';
import path from 'path';

export function getTestBrowserExe() {
  const localAppData = process.env.LOCALAPPDATA || '';
  const candidates = [
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    path.join(localAppData, "Microsoft\\Edge\\Application\\msedge.exe"),
    "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe",
    path.join(localAppData, "BraveSoftware\\Brave-Browser\\Application\\brave.exe")
  ];
  return candidates.find(p => p && fs.existsSync(p)) || undefined;
}
