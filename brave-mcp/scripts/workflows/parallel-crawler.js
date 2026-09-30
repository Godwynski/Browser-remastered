/**
 * parallel-crawler: High-speed concurrent multi-URL scraper.
 * Opens background tabs in the existing browser context, navigates in parallel,
 * extracts target data, and closes worker tabs in 1 turn.
 */
export async function run(activePage, params, braveManager) {
  const {
    urls = [],
    extractorJs = '({ title: document.title, url: window.location.href })',
    maxConcurrency = 4,
    timeoutMs = 12000
  } = params;

  if (!Array.isArray(urls) || urls.length === 0) {
    throw new Error("Parameter 'urls' must be a non-empty array of URL strings.");
  }

  await braveManager.ensureConnected();
  const context = braveManager.context || braveManager.browser.contexts()[0];
  if (!context) throw new Error("No browser context available.");

  const results = [];

  // Process URLs in batches of maxConcurrency
  for (let i = 0; i < urls.length; i += maxConcurrency) {
    const chunk = urls.slice(i, i + maxConcurrency);

    const chunkPromises = chunk.map(async (url) => {
      let workerPage = null;
      try {
        workerPage = await context.newPage();
        await workerPage.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs });
        const data = await workerPage.evaluate(extractorJs);
        return { url, success: true, data };
      } catch (err) {
        return { url, success: false, error: err.message };
      } finally {
        if (workerPage && !workerPage.isClosed()) {
          await workerPage.close().catch(() => {});
        }
      }
    });

    const chunkResults = await Promise.all(chunkPromises);
    results.push(...chunkResults);
  }

  return {
    totalUrls: urls.length,
    successful: results.filter(r => r.success).length,
    results
  };
}

export default run;
