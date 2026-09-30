import { execSync, spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

const localAppData = process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || '', 'AppData', 'Local');
let braveExe = path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe');
if (!fs.existsSync(braveExe)) {
  const alt1 = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
  const alt2 = 'C:\\Program Files (x86)\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';
  if (fs.existsSync(alt1)) braveExe = alt1;
  else if (fs.existsSync(alt2)) braveExe = alt2;
}

const userData = path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'User Data');

console.log('[1/3] Closing running Brave processes...');
try {
  execSync('taskkill /f /im brave.exe', { stdio: 'ignore' });
} catch (e) {}

await new Promise(r => setTimeout(r, 1500));

console.log('[2/3] Launching Brave with CDP and session restore...');
const child = spawn(braveExe, [
  '--remote-debugging-port=9222',
  '--remote-allow-origins=*',
  `--user-data-dir=${userData}`,
  '--restore-last-session'
], {
  detached: true,
  stdio: 'ignore'
});
child.unref();

console.log('[3/3] Waiting for CDP to respond on port 9222...');
let connected = false;
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 1000));
  try {
    const res = await fetch('http://127.0.0.1:9222/json/version');
    if (res.ok) {
      const data = await res.json();
      console.log('✅ Connected to Brave CDP successfully:', data.Browser);
      connected = true;
      break;
    }
  } catch (e) {}
}

if (!connected) {
  console.error('❌ Failed to connect to CDP on port 9222 within 20 seconds.');
  process.exit(1);
} else {
  console.log('🎉 Brave is ready!');
  process.exit(0);
}
