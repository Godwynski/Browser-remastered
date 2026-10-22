---
name: smart-web-scraper
description: Zero-token structured data extraction. Automatically extracts repeating list items, tables, cards, pricing tiers, articles, or search results directly into clean JSON or CSV format.
---

# Smart Web Scraper Skill

Use this skill when you need to extract structured tabular or repeating data (tables, search result cards, catalogs, article listings) from any webpage directly into JSON or CSV with **zero token consumption**.

---

## 🚀 Key Advantages

- **Automatic Pattern Detection**: Detects tables, grid items, and repeated DOM patterns automatically without manual CSS selector tuning.
- **Zero Token Cost**: Data is extracted, formatted, and written directly by in-browser JS evaluation; the LLM only consumes tokens on the final summary or schema.
- **CSV & JSON Exports**: Export directly to disk for immediate data analysis, Pandas, or Excel import.

---

## 🛠️ Usage

### CLI Execution

```bash
# Scrape HTML tables into CSV
node .agents/skills/smart-web-scraper/scripts/scrape-cli.js --active --type table --format csv --output artifacts/table_data.csv

# Scrape repeating cards/items into JSON
node .agents/skills/smart-web-scraper/scripts/scrape-cli.js --active --type cards --output artifacts/cards_data.json

# Scrape links matching a specific pattern
node .agents/skills/smart-web-scraper/scripts/scrape-cli.js --active --type links --pattern "github.com"
```

### Options

| Flag | Description | Default |
| :--- | :--- | :--- |
| `--active` | Scrape from currently active Brave tab | `true` |
| `--url <url>` | Optional target URL to open and scrape | active tab |
| `--type <mode>` | Extraction mode: `table`, `cards`, `links`, `auto` | `auto` |
| `--format <fmt>` | Output format: `json` or `csv` | `json` |
| `--output <path>` | File path to write extracted data | stdout |
| `--limit <num>` | Maximum records to extract | `100` |
