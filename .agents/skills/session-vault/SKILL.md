---
name: session-vault
description: Browser session and authentication management. Inspects, exports, validates, and preserves login cookies and localStorage across browser sessions without re-authentication loops.
---

# Session Vault Skill

Use this skill when you want to inspect login states, save session cookies/tokens, or verify whether an active tab is authenticated to prevent redundant login flows.

---

## 🚀 Key Advantages

- **Login State Diagnostics**: Verifies if authentication cookies exist for a given domain before attempting actions.
- **Cookie Export & Backup**: Safely saves cookies/localStorage into encrypted or gitignored artifacts.
- **Zero-Friction Co-Browsing**: Works hand-in-hand with your running Brave session so you never get logged out.

---

## 🛠️ Usage

### CLI Execution

```bash
# Check login status and active cookies for the current tab
node .agents/skills/session-vault/scripts/vault-cli.js --status

# Export cookies for the current domain to artifacts/sessions/
node .agents/skills/session-vault/scripts/vault-cli.js --export --domain "github.com"

# List all authenticated domains currently tracked
node .agents/skills/session-vault/scripts/vault-cli.js --list-domains
```

### Options

| Flag | Description | Default |
| :--- | :--- | :--- |
| `--status` | Check authentication status for current tab | `true` |
| `--export` | Export session cookies to `artifacts/sessions/` | `false` |
| `--domain <domain>` | Filter cookies by specific domain | current tab domain |
| `--list-domains` | List domains with stored cookies | `false` |
