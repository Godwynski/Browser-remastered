import fs from 'fs';
import { BraveManager } from '../../../../brave-mcp/src/browser.js';

async function main() {
  const args = process.argv.slice(2);
  let inlineData = null;
  let filePath = null;
  let autoSubmit = false;
  let submitSelector = 'button[type="submit"], input[type="submit"]';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data' && args[i + 1]) inlineData = args[++i];
    else if (args[i] === '--file' && args[i + 1]) filePath = args[++i];
    else if (args[i] === '--submit') autoSubmit = true;
    else if (args[i] === '--submit-selector' && args[i + 1]) submitSelector = args[++i];
  }

  let formData = {};
  if (inlineData) {
    formData = JSON.parse(inlineData);
  } else if (filePath) {
    formData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } else {
    console.error('Error: Please provide --data \'{"field":"value"}\' or --file path.json');
    process.exit(1);
  }

  const brave = new BraveManager();
  const page = await brave.getActivePage();

  console.log(`[FormFiller] Populating ${Object.keys(formData).length} field(s) on: "${await page.title()}"`);

  const fillReport = await page.evaluate(({ data, submit, submitSel }) => {
    const filled = [];
    const missing = [];

    for (const [key, value] of Object.entries(data)) {
      const lowerKey = key.toLowerCase();
      // Try ID, Name, Placeholder, Aria-Label matching
      const input = document.querySelector(
        `#${CSS.escape(key)}, [name="${CSS.escape(key)}"], [placeholder*="${CSS.escape(key)}" i], [aria-label*="${CSS.escape(key)}" i]`
      );

      if (input) {
        const tag = input.tagName.toLowerCase();
        if (tag === 'select') {
          input.value = value;
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } else if (input.type === 'checkbox' || input.type === 'radio') {
          input.checked = Boolean(value);
          input.dispatchEvent(new Event('change', { bubbles: true }));
        } else {
          input.value = value;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        filled.push({ key, selector: `#${input.id || input.name || tag}` });
      } else {
        missing.push(key);
      }
    }

    let submitted = false;
    if (submit) {
      let btn = null;
      try { btn = document.querySelector(submitSel); } catch (_) {}
      if (!btn) {
        const buttons = Array.from(document.querySelectorAll('button, input[type="button"], input[type="submit"]'));
        btn = buttons.find(b => /submit|save/i.test(b.innerText || b.value || ''));
      }
      if (btn) {
        btn.click();
        submitted = true;
      }
    }

    return { filled, missing, submitted };
  }, { data: formData, submit: autoSubmit, submitSel: submitSelector });

  console.log(`✅ Filled ${fillReport.filled.length} field(s):`, fillReport.filled.map(f => f.key).join(', '));
  if (fillReport.missing.length > 0) {
    console.log(`⚠️ Could not locate ${fillReport.missing.length} field(s):`, fillReport.missing.join(', '));
  }
  if (fillReport.submitted) {
    console.log('🚀 Form submitted successfully!');
  }
}

main().catch(err => {
  console.error('[FormFiller Error]', err.message);
  process.exit(1);
});
