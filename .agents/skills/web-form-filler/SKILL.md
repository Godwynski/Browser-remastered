---
name: web-form-filler
description: Batch multi-field form filler and UI wizard automation. Uses smart schema inference to populate text fields, dropdowns, checkboxes, and submit buttons in a single turn without multi-step LLM loops.
---

# Web Form Filler Skill

Use this skill when you need to fill out web forms (surveys, login inputs, search filters, lead forms, account settings) in a **single turn** instead of typing fields one by one.

---

## 🚀 Key Advantages
- **Single-Turn Batch Filling**: Submits all inputs in one batch, eliminating multi-turn latency and token overhead.
- **Smart Field Matching**: Matches JSON key-value pairs to `<input>`, `<textarea>`, and `<select>` elements by ID, name attribute, label, or placeholder.
- **Auto-Submission**: Optionally clicks the submit button after all inputs are filled.

---

## 🛠️ Usage

### CLI Execution
```bash
# Fill a form using a JSON string
node .agents/skills/web-form-filler/scripts/form-filler-cli.js --active --data '{"username":"demo_user","email":"demo@example.com"}' --submit

# Fill a form using a JSON file payload
node .agents/skills/web-form-filler/scripts/form-filler-cli.js --active --file "artifacts/form_data.json" --submit
```

### Options
| Flag | Description | Default |
| :--- | :--- | :--- |
| `--active` | Fill form on active tab | `true` |
| `--data <json>` | Inline JSON key-value map of form fields | none |
| `--file <path>` | Path to JSON file with form values | none |
| `--submit` | Automatically click the submit button after filling | `false` |
| `--submit-selector` | Custom selector for the submit button | `button[type="submit"], input[type="submit"]` |
