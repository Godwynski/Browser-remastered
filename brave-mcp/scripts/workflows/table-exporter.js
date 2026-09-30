/**
 * Reusable Workflow Script: Table Exporter
 * Extracts any HTML table on the page into clean JSON and CSV with zero LLM tokens.
 */
export async function run(page, params = {}) {
  const { selector = 'table', limit = 100 } = params;

  const data = await page.evaluate(({ tableSel, rowLimit }) => {
    const table = document.querySelector(tableSel);
    if (!table) return { error: `No table matching '${tableSel}' found on page.` };

    const rows = Array.from(table.querySelectorAll('tr'));
    const headers = Array.from(rows[0]?.querySelectorAll('th, td') || []).map(c => c.innerText.trim());
    const records = [];

    for (let i = 1; i < Math.min(rows.length, rowLimit + 1); i++) {
      const cells = Array.from(rows[i].querySelectorAll('td, th')).map(c => c.innerText.trim());
      if (cells.length > 0) {
        const obj = {};
        cells.forEach((val, idx) => {
          const col = headers[idx] || `col_${idx + 1}`;
          obj[col] = val;
        });
        records.push(obj);
      }
    }

    return { headers, count: records.length, records };
  }, { tableSel: selector, rowLimit: limit });

  return data;
}

export default run;
