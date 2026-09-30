import { execSync } from 'child_process';

try {
  const netstat = execSync('netstat -ano | findstr :9222', { encoding: 'utf8' });
  console.log('Netstat:\n', netstat);
  const lines = netstat.trim().split('\n');
  const pids = new Set();
  for (const l of lines) {
    const parts = l.trim().split(/\s+/);
    if (parts.length >= 5) pids.add(parts[parts.length - 1]);
  }
  for (const pid of pids) {
    try {
      const task = execSync(`tasklist /FI "PID eq ${pid}" /FO LIST`, { encoding: 'utf8' });
      console.log(`PID ${pid}:\n${task}`);
    } catch (e) {}
  }
} catch (e) {
  console.error(e);
}
