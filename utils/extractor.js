/**
 * PageSnap - Content Extractor
 * Readability-style parser that extracts meaningful content from any web page.
 * Runs in the content script context.
 */

const PageSnapExtractor = {
  /**
   * Extract all meaningful content from the current page.
   * Returns a structured object with title, content, images, metadata.
   */
  extract() {
    return {
      url: window.location.href,
      domain: window.location.hostname,
      title: this._getTitle(),
      description: this._getDescription(),
      author: this._getAuthor(),
      publishDate: this._getPublishDate(),
      content: this._getMainContent(),
      excerpt: this._getExcerpt(),
      images: this._getImages(),
      ogImage: this._getOGImage(),
      tags: this._getTags(),
      wordCount: 0, // filled after content extraction
      readingTime: 0, // filled after content extraction
      timestamp: new Date().toISOString()
    };
  },

  // --- Title ---
  _getTitle() {
    // Try structured data first
    const ogTitle = document.querySelector('meta[property="og:title"]');
    if (ogTitle) return ogTitle.content;

    const twitterTitle = document.querySelector('meta[name="twitter:title"]');
    if (twitterTitle) return twitterTitle.content;

    // Try h1
    const h1 = document.querySelector('article h1, main h1, h1');
    if (h1) return h1.textContent.trim();

    return document.title || '';
  },

  // --- Description ---
  _getDescription() {
    const ogDesc = document.querySelector('meta[property="og:description"]');
    if (ogDesc) return ogDesc.content;

    const metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) return metaDesc.content;

    const twitterDesc = document.querySelector('meta[name="twitter:description"]');
    if (twitterDesc) return twitterDesc.content;

    return '';
  },

  // --- Author ---
  _getAuthor() {
    const metaAuthor = document.querySelector('meta[name="author"]');
    if (metaAuthor) return metaAuthor.content;

    const ldJson = this._getLDJson();
    if (ldJson) {
      if (ldJson.author) {
        return typeof ldJson.author === 'string' ? ldJson.author : (ldJson.author.name || '');
      }
    }

    // Common selectors
    const selectors = [
      '[rel="author"]', '.author', '.byline', '[class*="author"]',
      '[class*="byline"]', '[itemprop="author"]'
    ];
    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el) return el.textContent.trim();
    }

    return '';
  },

  // --- Publish Date ---
  _getPublishDate() {
    const metaDate = document.querySelector('meta[property="article:published_time"]');
    if (metaDate) return metaDate.content;

    const timeEl = document.querySelector('time[datetime]');
    if (timeEl) return timeEl.getAttribute('datetime');

    const ldJson = this._getLDJson();
    if (ldJson && ldJson.datePublished) return ldJson.datePublished;

    return '';
  },

  // --- Main Content ---
  _getMainContent() {
    // Try to find the main article content
    const contentEl = this._findContentElement();
    if (!contentEl) {
      // Fallback: get body text
      const text = document.body.innerText.substring(0, 10000);
      const wordCount = text.split(/\s+/).length;
      return {
        text: text,
        html: '',
        wordCount: wordCount,
        readingTime: Math.ceil(wordCount / 200)
      };
    }

    // Clone to avoid modifying the page
    const clone = contentEl.cloneNode(true);

    // Remove unwanted elements
    const removeSelectors = [
      'script', 'style', 'nav', 'footer', 'header', 'aside',
      '[class*="sidebar"]', '[class*="comment"]', '[class*="share"]',
      '[class*="social"]', '[class*="related"]', '[class*="newsletter"]',
      '[class*="subscribe"]', '[class*="popup"]', '[class*="modal"]',
      '[class*="ad-"]', '[class*="advertisement"]', '[id*="ad-"]',
      'iframe', '[role="navigation"]', '[role="complementary"]'
    ];
    removeSelectors.forEach(sel => {
      clone.querySelectorAll(sel).forEach(el => el.remove());
    });

    const text = clone.innerText.trim();
    const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

    return {
      text: text,
      html: clone.innerHTML,
      wordCount: wordCount,
      readingTime: Math.ceil(wordCount / 200)
    };
  },

  _findContentElement() {
    // Priority order of content containers
    const selectors = [
      'article',
      '[role="main"] article',
      'main article',
      '[role="main"]',
      'main',
      '.post-content',
      '.article-content',
      '.entry-content',
      '.content-body',
      '.article-body',
      '.story-body',
      '#article-body',
      '#content',
      '.post',
      '.article'
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.innerText.trim().length > 200) {
        return el;
      }
    }

    // Heuristic: find the element with the most paragraph text
    const candidates = document.querySelectorAll('div, section');
    let best = null;
    let bestScore = 0;

    for (const el of candidates) {
      const paragraphs = el.querySelectorAll('p');
      let score = 0;
      paragraphs.forEach(p => {
        const text = p.innerText.trim();
        if (text.length > 50) score += text.length;
      });

      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }

    return best;
  },

  // --- Excerpt ---
  _getExcerpt() {
    const desc = this._getDescription();
    if (desc) return desc;

    const content = document.querySelector('article p, main p, .content p');
    if (content) {
      const text = content.innerText.trim();
      if (text.length > 50) {
        return text.length > 300 ? text.substring(0, 297) + '...' : text;
      }
    }

    return '';
  },

  // --- Images ---
  _getImages() {
    const images = [];
    const seen = new Set();

    // Get all meaningful images
    const imgEls = document.querySelectorAll('article img, main img, .content img, img[width]');
    for (const img of imgEls) {
      const src = img.src || img.dataset.src;
      if (!src || seen.has(src)) continue;
      if (src.startsWith('data:') && src.length < 100) continue; // skip tiny data URIs (tracking pixels)

      const width = img.naturalWidth || parseInt(img.width) || 0;
      const height = img.naturalHeight || parseInt(img.height) || 0;

      // Skip tiny images (likely icons/tracking)
      if (width > 0 && width < 50) continue;
      if (height > 0 && height < 50) continue;

      seen.add(src);
      images.push({
        src: src,
        alt: img.alt || '',
        width: width,
        height: height
      });

      if (images.length >= 10) break;
    }

    return images;
  },

  _getOGImage() {
    const ogImage = document.querySelector('meta[property="og:image"]');
    if (ogImage) return ogImage.content;

    const twitterImage = document.querySelector('meta[name="twitter:image"]');
    if (twitterImage) return twitterImage.content;

    return '';
  },

  // --- Tags / Keywords ---
  _getTags() {
    const metaKeywords = document.querySelector('meta[name="keywords"]');
    if (metaKeywords) {
      return metaKeywords.content.split(',').map(t => t.trim()).filter(t => t);
    }

    const ldJson = this._getLDJson();
    if (ldJson && ldJson.keywords) {
      if (typeof ldJson.keywords === 'string') {
        return ldJson.keywords.split(',').map(t => t.trim());
      }
      if (Array.isArray(ldJson.keywords)) return ldJson.keywords;
    }

    // Try article tags
    const tagEls = document.querySelectorAll('[rel="tag"], .tag, .tags a');
    if (tagEls.length > 0) {
      return Array.from(tagEls).map(el => el.textContent.trim()).slice(0, 10);
    }

    return [];
  },

  // --- Structured Data ---
  _getLDJson() {
    try {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        const data = JSON.parse(script.textContent);
        if (data['@type'] === 'Article' || data['@type'] === 'NewsArticle' ||
            data['@type'] === 'BlogPosting' || data['@type'] === 'WebPage') {
          return data;
        }
        // Handle @graph arrays
        if (data['@graph']) {
          for (const item of data['@graph']) {
            if (item['@type'] === 'Article' || item['@type'] === 'NewsArticle' ||
                item['@type'] === 'BlogPosting') {
              return item;
            }
          }
        }
      }
    } catch (e) {
      // JSON parse error, ignore
    }
    return null;
  }
};
