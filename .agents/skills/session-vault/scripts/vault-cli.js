import fs from 'fs';
import path from 'path';
import { BraveManager } from '../../../../brave-mcp/src/browser.js';
import { PATHS } from '../../../../brave-mcp/src/paths.js';

async function main() {
  const args = process.argv.slice(2);
  let checkStatus = true;
  let doExport = false;
  let listDomains = false;
  let targetDomain = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--export') { doExport = true; checkStatus = false; }
    else if (args[i] === '--list-domains') { listDomains = true; checkStatus = false; }
    else if (args[i] === '--domain' && args[i + 1]) targetDomain = args[++i];
  }

  const brave = new BraveManager();
  const page = await brave.getActivePage();
  const context = page.context();
  const currentUrl = page.url();
  const currentHost = new URL(currentUrl.startsWith('http') ? currentUrl : 'http://localhost').hostname;
  const domainToInspect = targetDomain || currentHost;

  const cookies = await context.cookies();

  if (listDomains) {
    const domains = Array.from(new Set(cookies.map(c => c.domain.replace(/^\./, '')))).sort();
    console.log(`\n🔑 Tracked Authenticated Domains (${domains.length}):`);
    domains.forEach(d => console.log(`   - ${d}`));
    return;
  }

  const domainCookies = cookies.filter(c => c.domain.includes(domainToInspect));
  const hasAuthTokens = domainCookies.some(c => /session|token|auth|jwt|id|ssid|login/i.test(c.name));

  console.log(`\n🔐 Session Vault Status for: "${domainToInspect}"`);
  console.log(`   Active Tab Title:   ${await page.title()}`);
  console.log(`   Cookies Stored:     ${domainCookies.length}`);
  console.log(`   Auth Detected:      ${hasAuthTokens ? '✅ YES (Authenticated)' : 'ℹ️ NO / Public Session'}`);

  if (doExport) {
    const sessionDir = path.join(PATHS.artifacts, 'sessions');
    if (!fs.existsSync(sessionDir)) fs.mkdirSync(sessionDir, { recursive: true });

    const safeDomain = domainToInspect.replace(/[^a-zA-Z0-9.-]/g, '_');
    const outFile = path.join(sessionDir, `${safeDomain}_cookies.json`);

    fs.writeFileSync(outFile, JSON.stringify(domainCookies, null, 2), { encoding: 'utf8', mode: 0o600 });
    console.log(`   💾 Exported ${domainCookies.length} cookies to: ${outFile}\n`);
  }
}

main().catch(err => {
  console.error('[Session Vault Error]', err.message);
  process.exit(1);
});
