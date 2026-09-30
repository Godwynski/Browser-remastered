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
    const { scope = null, maxLength = 6000 } = options;

    const result = await page.evaluate(({ scopeSelector, maxChars }) => {
      // 1. Locate the best content container
      let root = null;
      if (scopeSelector) {
        try {
          root = document.querySelector(scopeSelector);
        } catch (_) {}
      }

      if (!root) {
        root = document.querySelector('article, main, [role="main"], #content, #main-content, .content, .post, .article-body, .markdown-body');
      }

      if (!root) {
        root = document.body;
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

      // Clone container to avoid mutating actual DOM
      const clone = root.cloneNode(true);

      // 2. Strip non-content / boilerplate elements
      const unwantedSelectors = [
        'script', 'style', 'noscript', 'svg', 'canvas', 'iframe',
        'nav', 'footer', 'header', 'form', '[aria-hidden="true"]',
        '.advertisement', '.ad', '.ads', '.cookie-banner', '.cookie-consent',
        '.sidebar', '#sidebar', '.comments', '#comments', '.social-share',
        '.popup', '.modal', '.banner'
      ];

      for (const sel of unwantedSelectors) {
        const els = clone.querySelectorAll(sel);
        for (const el of els) {
          el.remove();
        }
      }

      // 3. Convert HTML elements to Markdown
      function htmlToMarkdown(node) {
        if (!node) return '';

        // Text node
        if (node.nodeType === Node.TEXT_NODE) {
          return node.nodeValue.replace(/\s+/g, ' ');
        }

        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const tag = node.tagName.toLowerCase();

        // Process children
        const childrenMd = Array.from(node.childNodes)
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
              const ths = Array.from(row.querySelectorAll('th'));
              const tds = Array.from(row.querySelectorAll('td'));
              const cells = ths.length > 0 ? ths : tds;

              const cellTexts = cells.map(c => c.textContent.trim().replace(/\|/g, '\\|') || ' ');
              tableMd += `| ${cellTexts.join(' | ')} |\n`;

              if (!headersExtracted && (ths.length > 0 || rIdx === 0)) {
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

      let markdown = htmlToMarkdown(clone);

      // Clean excessive newlines & spaces
      markdown = markdown
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .trim();

      const words = markdown.split(/\s+/).filter(Boolean);
      const wordCount = words.length;

      let truncated = false;
      if (markdown.length > maxChars) {
        markdown = markdown.slice(0, maxChars) + `\n\n... [Content truncated at ${maxChars} characters]`;
        truncated = true;
      }

      // Metadata extraction
      const descEl = document.querySelector('meta[name="description"], meta[property="og:description"]');
      const authorEl = document.querySelector('meta[name="author"], meta[property="article:author"]');

      return {
        title: document.title || 'Untitled',
        url: window.location.href,
        description: descEl ? descEl.getAttribute('content') : null,
        author: authorEl ? authorEl.getAttribute('content') : null,
        markdown,
        wordCount,
        readingTimeMin: Math.max(1, Math.ceil(wordCount / 200)),
        truncated
      };
    }, { scopeSelector: scope, maxChars: maxLength });

    return result;
  }
}
