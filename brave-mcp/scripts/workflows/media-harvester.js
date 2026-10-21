/**
 * media-harvester: Zero-DOM media link extractor.
 * Automatically discovers direct video streams (mp4, m3u8), audio, high-res images,
 * and downloadable documents embedded on the current page.
 */
export async function run(page, params = {}) {
  const { filterType = 'all', maxResults = 50 } = params;

  const media = await page.evaluate((type) => {
    const results = [];

    // Helper to add unique media
    function addMedia(src, mediaType, title = '') {
      if (!src || src.startsWith('data:') || (src.startsWith('blob:') && type !== 'all')) return;
      if (!results.some(r => r.src === src)) {
        results.push({
          type: mediaType,
          src,
          title: title.slice(0, 100) || undefined
        });
      }
    }

    // 1. Video & Source Elements
    if (type === 'all' || type === 'video') {
      const videos = document.querySelectorAll('video, video source');
      for (const v of videos) {
        const src = v.currentSrc || v.src || v.getAttribute('src');
        if (src) addMedia(src, 'video', document.title);
      }
    }

    // 2. Audio Elements
    if (type === 'all' || type === 'audio') {
      const audios = document.querySelectorAll('audio, audio source');
      for (const a of audios) {
        const src = a.currentSrc || a.src || a.getAttribute('src');
        if (src) addMedia(src, 'audio', document.title);
      }
    }

    // 3. High-Res Images
    if (type === 'all' || type === 'image') {
      const imgs = document.querySelectorAll('img[src]');
      for (const img of imgs) {
        // Find best source from srcset or direct src
        const src = img.currentSrc || img.src;
        const rect = img.getBoundingClientRect();
        // Ignore tiny icon images
        if (src && (rect.width > 100 || rect.height > 100 || !img.complete)) {
          addMedia(src, 'image', img.alt || img.title || '');
        }
      }
    }

    // 4. Downloadable Documents (PDF, Docx, Zip)
    if (type === 'all' || type === 'document') {
      const links = document.querySelectorAll('a[href]');
      const docExtensions = ['.pdf', '.docx', '.xlsx', '.csv', '.zip', '.tar.gz', '.json'];
      for (const a of links) {
        const href = a.href;
        if (docExtensions.some(ext => href.toLowerCase().endsWith(ext) || href.toLowerCase().includes(ext + '?'))) {
          addMedia(href, 'document', a.innerText.trim() || a.title);
        }
      }
    }

    // 5. Active Network Stream Manifests (m3u8, mpd) via Performance API
    if (type === 'all' || type === 'video') {
      const resources = performance.getEntriesByType('resource');
      for (const res of resources) {
        const name = res.name;
        if (name.includes('.m3u8') || name.includes('.mpd') || name.includes('.mp4?')) {
          addMedia(name, 'stream', 'Streaming Manifest');
        }
      }
    }

    return results;
  }, filterType);

  return {
    status: 'MediaHarvested',
    count: Math.min(media.length, maxResults),
    filterType,
    items: media.slice(0, maxResults)
  };
}

export default run;
