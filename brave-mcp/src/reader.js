/**
 * ContentReader: High-efficiency, zero-DOM article and document extractor.
 * Converts readable page content directly into clean Markdown, bypassing
 * interactive element indexing for ~90% token savings on information retrieval tasks.
 */

export class ContentReader {
  /**
   * Extracts clean Markdown and structured metadata from the current page.
   * @param {import('playwright-core').Page} page
   * @param {Object} options
   * @param {string|null} options.scope - Optional CSS selector to scope extraction (e.g. 'article', '#main-content')
   * @param {number} options.maxLength - Maximum character length of extracted markdown (default 6000)
   */
  async extract(page, options = {}) {
    const { scope = null, maxLength = 6000, offset = 0 } = options;

    const result = await page.evaluate(({ scopeSelector, maxChars, start }) => {
      // 1. Locate the best content container
      let root = null;
      if (scopeSelector) {
        try {
          root = document.querySelector(scopeSelector);
        } catch (_) {}
      }

      if (!root) {
        // Pick the content container with the most text; fall back to <body> when "main" is just a stub.
        const bodyLen = (document.body?.innerText || '').length;
        let best = null, bestLen = 0;
        for (const c of document.querySelectorAll('article, main, [role="main"], #content, #main-content, .content, .post, .article-body, .markdown-body')) {
          const l = (c.innerText || '').length;
          if (l > bestLen) { best = c; bestLen = l; }
        }
        root = best && bestLen > bodyLen * 0.4 ? best : document.body;
      }

      if (!root) {
        return {
          title: document.title || 'Untitled',
          url: window.location.href,
          markdown: '(No readable content found on page)',
          wordCount: 0,
          readingTimeMin: 0
        };
      }

      // 2. Boilerplate to skip. Walk the live DOM (not a clone) so shadow DOM and CSS visibility are respected.
      //    <form> is NOT skipped: many sites (ASP.NET, portals) wrap the whole page in one.
      const UNWANTED = [
        'script', 'style', 'noscript', 'template', 'svg', 'canvas', 'iframe', 'select', 'button',
        'nav', 'footer', 'body > header', '[role="banner"]', '[role="navigation"]', '[aria-hidden="true"]',
        '.advertisement', '.ads', '.cookie-banner', '.cookie-consent', '#onetrust-consent-sdk',
        '.sidebar', '#sidebar', '.social-share'
      ].join(',');

      // 3. Convert HTML elements to Markdown
      function htmlToMarkdown(node) {
        if (!node) return '';

        // Text node
        if (node.nodeType === Node.TEXT_NODE) {
          return node.nodeValue.replace(/\s+/g, ' ');
        }

        if (node.nodeType !== Node.ELEMENT_NODE) return '';
        if (node !== root && node.matches(UNWANTED)) return '';
        // display:contents boxes report invisible but their children render.
        if (node.checkVisibility && !node.checkVisibility({ checkVisibilityCSS: true }) && getComputedStyle(node).display !== 'contents') return '';

        const tag = node.tagName.toLowerCase();

        // Process children (including open shadow roots and slotted content)
        const kids = tag === 'slot' ? node.assignedNodes({ flatten: true }) : Array.from((node.shadowRoot || node).childNodes);
        const childrenMd = kids
          .map(child => htmlToMarkdown(child))
          .join('');

        const trimmedChildren = childrenMd.trim();
        if (!trimmedChildren && !['hr', 'br', 'img'].includes(tag)) {
          return '';
        }

        switch (tag) {
          case 'h1': return `\n\n# ${trimmedChildren}\n\n`;
          case 'h2': return `\n\n## ${trimmedChildren}\n\n`;
          case 'h3': return `\n\n### ${trimmedChildren}\n\n`;
          case 'h4': return `\n\n#### ${trimmedChildren}\n\n`;
          case 'h5': return `\n\n##### ${trimmedChildren}\n\n`;
          case 'h6': return `\n\n###### ${trimmedChildren}\n\n`;
          case 'p': return `\n\n${trimmedChildren}\n\n`;
          case 'blockquote': return `\n\n> ${trimmedChildren.replace(/\n/g, '\n> ')}\n\n`;
          case 'strong':
          case 'b': return `**${trimmedChildren}**`;
          case 'em':
          case 'i': return `*${trimmedChildren}*`;
          case 'code': {
            if (node.parentElement && node.parentElement.tagName.toLowerCase() === 'pre') {
              return trimmedChildren;
            }
            return `\`${trimmedChildren}\``;
          }
          case 'pre': {
            const lang = node.querySelector('code')?.className?.match(/language-([a-zA-Z0-9_-]+)/)?.[1] || '';
            return `\n\n\`\`\`${lang}\n${node.textContent.trim()}\n\`\`\`\n\n`;
          }
          case 'a': {
            const href = node.getAttribute('href');
            if (href && !href.startsWith('javascript:') && !href.startsWith('#') && trimmedChildren) {
              return `[${trimmedChildren}](${href})`;
            }
            return trimmedChildren;
          }
          case 'ul': {
            const items = Array.from(node.children)
              .filter(c => c.tagName.toLowerCase() === 'li')
              .map(li => `- ${htmlToMarkdown(li).trim()}`)
              .join('\n');
            return `\n\n${items}\n\n`;
          }
          case 'ol': {
            const items = Array.from(node.children)
              .filter(c => c.tagName.toLowerCase() === 'li')
              .map((li, i) => `${i + 1}. ${htmlToMarkdown(li).trim()}`)
              .join('\n');
            return `\n\n${items}\n\n`;
          }
          case 'li': return trimmedChildren;
          case 'table': {
            const rows = Array.from(node.querySelectorAll('tr'));
            if (rows.length === 0) return '';

            let tableMd = '\n\n';
            let headersExtracted = false;

            for (let rIdx = 0; rIdx < rows.length; rIdx++) {
              const row = rows[rIdx];
              const cells = Array.from(row.querySelectorAll('th, td'));
              if (cells.length === 0) continue;

              const cellTexts = cells.map(c => c.textContent.trim().replace(/\|/g, '\\|') || ' ');
              tableMd += `| ${cellTexts.join(' | ')} |\n`;

              if (!headersExtracted && (row.querySelector('th') || rIdx === 0)) {
                tableMd += `| ${cellTexts.map(() => '---').join(' | ')} |\n`;
                headersExtracted = true;
              }
            }
            return tableMd + '\n';
          }
          case 'hr': return '\n\n---\n\n';
          case 'br': return '\n';
          default:
            return childrenMd;
        }
      }

      let markdown = htmlToMarkdown(root);

      // Clean excessive newlines & spaces
      markdown = markdown
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

      const words = markdown.split(/\s+/).filter(Boolean);
      const wordCount = words.length;

      const totalChars = markdown.length;
      let end = Math.min(totalChars, start + maxChars);
      // Cut at a line boundary when possible so chunks stay readable.
      if (end < totalChars) {
        const cut = markdown.lastIndexOf('\n', end);
        if (cut > start + maxChars * 0.6) end = cut;
      }
      markdown = markdown.slice(start, end);
      const truncated = end < totalChars;

      return {
        title: document.title || 'Untitled',
        url: window.location.href,
        markdown,
        wordCount,
        readingTimeMin: Math.max(1, Math.ceil(wordCount / 200)),
        truncated,
        offset: start,
        nextOffset: truncated ? end : null,
        totalChars
      };
    }, { scopeSelector: scope, maxChars: maxLength, start: Math.max(0, offset) });

    return result;
  }
}
