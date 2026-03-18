/**
 * PageSnap v2 - Content Script
 * Handles capture, content extraction, and editor/output panel mounting.
 * All capture logic inlined (no script injection) for CSP compatibility.
 */

(function() {
  // Use a Symbol on the IIFE scope to prevent page-level fingerprinting
  const INJECTED_KEY = Symbol.for('__pagesnap_injected__');
  if (window[INJECTED_KEY]) return;
  Object.defineProperty(window, INJECTED_KEY, { value: true, enumerable: false, configurable: false, writable: false });

  const EXTENSION_ORIGIN = chrome.runtime.getURL('').slice(0, -1); // remove trailing slash

  let captureMode = null;
  let isCapturing = false;
  let extractedContent = null;

  // =========================================================================
  // Content Extractor (inlined for CSP)
  // =========================================================================

  const Extractor = {
    extract() {
      const content = this._getMainContent();
      return {
        url: window.location.href,
        domain: window.location.hostname,
        title: this._getTitle(),
        description: this._getDescription(),
        author: this._getAuthor(),
        publishDate: this._getPublishDate(),
        content: content,
        excerpt: this._getExcerpt(),
        images: this._getImages(),
        ogImage: this._getOGImage(),
        tags: this._getTags(),
        wordCount: content.wordCount || 0,
        readingTime: content.readingTime || 0,
        timestamp: new Date().toISOString()
      };
    },

    _getTitle() {
      const og = document.querySelector('meta[property="og:title"]');
      if (og) return og.content;
      const tw = document.querySelector('meta[name="twitter:title"]');
      if (tw) return tw.content;
      const h1 = document.querySelector('article h1, main h1, h1');
      if (h1) return h1.textContent.trim();
      return document.title || '';
    },

    _getDescription() {
      const og = document.querySelector('meta[property="og:description"]');
      if (og) return og.content;
      const meta = document.querySelector('meta[name="description"]');
      if (meta) return meta.content;
      return '';
    },

    _getAuthor() {
      const meta = document.querySelector('meta[name="author"]');
      if (meta) return meta.content;
      const ld = this._getLDJson();
      if (ld?.author) return typeof ld.author === 'string' ? ld.author : (ld.author.name || '');
      const selectors = ['[rel="author"]', '.author', '.byline', '[class*="author"]', '[class*="byline"]'];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el) return el.textContent.trim();
      }
      return '';
    },

    _getPublishDate() {
      const meta = document.querySelector('meta[property="article:published_time"]');
      if (meta) return meta.content;
      const time = document.querySelector('time[datetime]');
      if (time) return time.getAttribute('datetime');
      const ld = this._getLDJson();
      if (ld?.datePublished) return ld.datePublished;
      return '';
    },

    _getMainContent() {
      const el = this._findContentElement();
      if (!el) {
        const text = document.body.innerText.substring(0, 10000);
        const wc = text.split(/\s+/).length;
        return { text, html: '', wordCount: wc, readingTime: Math.ceil(wc / 200) };
      }

      const clone = el.cloneNode(true);
      const removeSelectors = [
        'script', 'style', 'nav', 'footer', 'aside',
        '[class*="sidebar"]', '[class*="comment"]', '[class*="share"]',
        '[class*="social"]', '[class*="related"]', '[class*="newsletter"]',
        '[class*="subscribe"]', '[class*="ad-"]', '[class*="advertisement"]',
        'iframe', '[role="navigation"]', '[role="complementary"]'
      ];
      removeSelectors.forEach(sel => {
        clone.querySelectorAll(sel).forEach(e => e.remove());
      });

      const text = clone.innerText.trim();
      const wc = text.split(/\s+/).filter(w => w.length > 0).length;
      return { text, html: clone.innerHTML, wordCount: wc, readingTime: Math.ceil(wc / 200) };
    },

    _findContentElement() {
      const selectors = [
        'article', '[role="main"] article', 'main article', '[role="main"]', 'main',
        '.post-content', '.article-content', '.entry-content', '.content-body',
        '.article-body', '.story-body', '#content', '.post', '.article'
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel);
        if (el && el.innerText.trim().length > 200) return el;
      }

      const candidates = document.querySelectorAll('div, section');
      let best = null, bestScore = 0;
      for (const el of candidates) {
        let score = 0;
        el.querySelectorAll('p').forEach(p => {
          const t = p.innerText.trim();
          if (t.length > 50) score += t.length;
        });
        if (score > bestScore) { bestScore = score; best = el; }
      }
      return best;
    },

    _getExcerpt() {
      const desc = this._getDescription();
      if (desc) return desc;
      const p = document.querySelector('article p, main p, .content p');
      if (p) {
        const t = p.innerText.trim();
        if (t.length > 50) return t.length > 300 ? t.substring(0, 297) + '...' : t;
      }
      return '';
    },

    _getImages() {
      const images = [], seen = new Set();
      const imgEls = document.querySelectorAll('article img, main img, .content img, img[width]');
      for (const img of imgEls) {
        const src = img.src || img.dataset.src;
        if (!src || seen.has(src)) continue;
        if (src.startsWith('data:') && src.length < 100) continue;
        const w = img.naturalWidth || parseInt(img.width) || 0;
        const h = img.naturalHeight || parseInt(img.height) || 0;
        if ((w > 0 && w < 50) || (h > 0 && h < 50)) continue;
        seen.add(src);
        images.push({ src, alt: img.alt || '', width: w, height: h });
        if (images.length >= 10) break;
      }
      return images;
    },

    _getOGImage() {
      const og = document.querySelector('meta[property="og:image"]');
      if (og) return og.content;
      const tw = document.querySelector('meta[name="twitter:image"]');
      if (tw) return tw.content;
      return '';
    },

    _getTags() {
      const meta = document.querySelector('meta[name="keywords"]');
      if (meta) return meta.content.split(',').map(t => t.trim()).filter(t => t);
      const tagEls = document.querySelectorAll('[rel="tag"], .tag, .tags a');
      if (tagEls.length > 0) return Array.from(tagEls).map(el => el.textContent.trim()).slice(0, 10);
      return [];
    },

    _getLDJson() {
      try {
        const scripts = document.querySelectorAll('script[type="application/ld+json"]');
        for (const s of scripts) {
          const d = JSON.parse(s.textContent);
          if (['Article', 'NewsArticle', 'BlogPosting', 'WebPage'].includes(d['@type'])) return d;
          if (d['@graph']) {
            for (const item of d['@graph']) {
              if (['Article', 'NewsArticle', 'BlogPosting'].includes(item['@type'])) return item;
            }
          }
        }
      } catch (e) {}
      return null;
    }
  };

  // =========================================================================
  // Stitch Logic (inlined)
  // =========================================================================

  const Stitch = {
    async stitchCaptures(captures, pageWidth, pageHeight, dpr) {
      if (captures.length === 0) throw new Error('No captures to stitch');
      if (captures.length === 1) return await this._cropSingle(captures[0], pageWidth, pageHeight, dpr);

      const images = await Promise.all(captures.map(c => this._loadImage(c.dataUrl)));
      const outW = Math.round(pageWidth * dpr);
      const outH = Math.min(Math.round(pageHeight * dpr), 32767);

      const canvas = document.createElement('canvas');
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext('2d');

      for (let i = 0; i < captures.length; i++) {
        const drawY = Math.round(captures[i].y * dpr);
        if (i === captures.length - 1) {
          const remaining = Math.round(pageHeight * dpr) - drawY;
          if (remaining < images[i].height) {
            const srcY = images[i].height - remaining;
            ctx.drawImage(images[i], 0, srcY, images[i].width, remaining, 0, drawY, images[i].width, remaining);
            continue;
          }
        }
        ctx.drawImage(images[i], 0, drawY);
      }
      return canvas.toDataURL('image/png');
    },

    async _cropSingle(capture, pageWidth, pageHeight, dpr) {
      const img = await this._loadImage(capture.dataUrl);
      const tH = Math.round(pageHeight * dpr), tW = Math.round(pageWidth * dpr);
      if (img.height >= tH && img.width >= tW) {
        if (img.height === tH && img.width === tW) return capture.dataUrl;
        const c = document.createElement('canvas');
        c.width = tW; c.height = tH;
        c.getContext('2d').drawImage(img, 0, 0, tW, tH, 0, 0, tW, tH);
        return c.toDataURL('image/png');
      }
      return capture.dataUrl;
    },

    _loadImage(dataUrl) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load capture image'));
        img.src = dataUrl;
      });
    }
  };

  // =========================================================================
  // Capture Logic (inlined, with throttling)
  // =========================================================================

  const Capture = {
    _lastCaptureTime: 0,
    _minInterval: 550,

    async captureFullPage() {
      const scrollDelay = 300;
      const maxScrolls = 100;
      const origX = window.scrollX, origY = window.scrollY;

      const pageWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth || 0);
      const pageHeight = Math.max(document.documentElement.scrollHeight, document.body.scrollHeight || 0);
      const vpH = window.innerHeight;
      const dpr = window.devicePixelRatio || 1;

      const styleEl = document.createElement('style');
      styleEl.id = 'pagesnap-capture-style';
      styleEl.textContent = '::-webkit-scrollbar{display:none!important}*{scrollbar-width:none!important}';
      document.head.appendChild(styleEl);

      const fixedEls = this._getFixedElements();
      const captures = [];
      let curY = 0, count = 0;
      let fixedStyles = null;

      try {
        window.scrollTo(0, 0);
        await this._wait(scrollDelay);

        while (curY < pageHeight && count < maxScrolls) {
          window.scrollTo(0, curY);
          await this._wait(scrollDelay);
          this._triggerLazyLoad();

          // First capture (top of page): include headers naturally
          // Subsequent captures: hide fixed/sticky elements to prevent duplication
          if (count === 0) {
            // Capture the first viewport with everything visible
            const result = await this._captureViewport();
            if (result.error) throw new Error(result.error);
            captures.push({ dataUrl: result.dataUrl, y: window.scrollY, height: Math.min(vpH, pageHeight - window.scrollY), viewportHeight: vpH });
            // Now hide fixed elements for all remaining captures
            fixedStyles = this._hideFixedElements(fixedEls);
          } else {
            const result = await this._captureViewport();
            if (result.error) throw new Error(result.error);
            captures.push({ dataUrl: result.dataUrl, y: window.scrollY, height: Math.min(vpH, pageHeight - window.scrollY), viewportHeight: vpH });
          }

          curY += vpH;
          count++;
          if (window.scrollY + vpH >= pageHeight) break;
        }
      } finally {
        if (fixedStyles) this._restoreFixedElements(fixedEls, fixedStyles);
        document.getElementById('pagesnap-capture-style')?.remove();
        window.scrollTo(origX, origY);
      }

      return await Stitch.stitchCaptures(captures, pageWidth, pageHeight, dpr);
    },

    async captureVisibleArea() {
      const result = await this._captureViewport();
      if (result.error) throw new Error(result.error);
      return result.dataUrl;
    },

    async captureRegion(x, y, width, height) {
      const dpr = window.devicePixelRatio || 1;
      const vpH = window.innerHeight;
      const origX = window.scrollX, origY = window.scrollY;

      const styleEl = document.createElement('style');
      styleEl.id = 'pagesnap-capture-style';
      styleEl.textContent = '::-webkit-scrollbar{display:none!important}*{scrollbar-width:none!important}';
      document.head.appendChild(styleEl);

      const fixedEls = this._getFixedElements();
      const fixedStyles = this._hideFixedElements(fixedEls);
      const captures = [];
      let curY = y;

      try {
        while (curY < y + height) {
          window.scrollTo(x, curY);
          await this._wait(300);
          const result = await this._captureViewport();
          if (result.error) throw new Error(result.error);
          captures.push({ dataUrl: result.dataUrl, y: window.scrollY, height: Math.min(vpH, (y + height) - window.scrollY), viewportHeight: vpH });
          curY += vpH;
          if (window.scrollY + vpH >= y + height) break;
        }
      } finally {
        this._restoreFixedElements(fixedEls, fixedStyles);
        document.getElementById('pagesnap-capture-style')?.remove();
        window.scrollTo(origX, origY);
      }

      const full = await Stitch.stitchCaptures(captures, window.innerWidth, y + height - captures[0].y + vpH, dpr);
      return await this._cropDataUrl(full, x * dpr, (y - captures[0].y) * dpr, width * dpr, height * dpr, width, height);
    },

    async _captureViewport() {
      const now = Date.now();
      const elapsed = now - this._lastCaptureTime;
      if (elapsed < this._minInterval) await this._wait(this._minInterval - elapsed);

      for (let attempt = 0; attempt < 3; attempt++) {
        this._lastCaptureTime = Date.now();
        const result = await new Promise(resolve => {
          chrome.runtime.sendMessage({ action: 'captureVisibleTab' }, r => resolve(r || { error: 'No response' }));
        });
        if (result.error && result.error.includes('MAX_CAPTURE') && attempt < 2) {
          await this._wait(1000 * (attempt + 1));
          continue;
        }
        return result;
      }
      return { error: 'Capture rate limited' };
    },

    _wait(ms) { return new Promise(r => setTimeout(r, ms)); },

    _getFixedElements() {
      const fixed = [];
      // Check ALL elements for fixed/sticky positioning (computed style is authoritative)
      const candidates = document.querySelectorAll('header, nav, div, section, aside, [class*="sticky"], [class*="fixed"], [class*="header"], [class*="navbar"], [class*="nav-bar"], [class*="toolbar"], [class*="topbar"], [class*="top-bar"], [class*="banner"], [style*="position"]');
      const seen = new Set();
      for (const el of candidates) {
        if (seen.has(el)) continue;
        seen.add(el);
        try {
          const s = window.getComputedStyle(el);
          if (s.position === 'fixed' || s.position === 'sticky') {
            fixed.push(el);
            // Don't also process children that are fixed — the parent handles it
            el.querySelectorAll('*').forEach(child => seen.add(child));
          }
        } catch (e) {}
      }
      return fixed;
    },

    _hideFixedElements(els) {
      // For fixed elements: use visibility:hidden (doesn't affect document flow)
      // For sticky elements: set to position:relative so they stay in normal flow
      // and only appear once at their natural document position
      return els.map(el => {
        const computed = window.getComputedStyle(el);
        const orig = {
          position: el.style.position,
          visibility: el.style.visibility,
          wasFixed: computed.position === 'fixed',
          wasSticky: computed.position === 'sticky'
        };
        if (computed.position === 'fixed') {
          // Fixed elements float over content — hide them completely
          el.style.visibility = 'hidden';
        } else if (computed.position === 'sticky') {
          // Sticky elements snap to viewport — make them relative so they
          // stay in their natural document position and appear only once
          el.style.position = 'relative';
        }
        return orig;
      });
    },

    _restoreFixedElements(els, styles) {
      els.forEach((el, i) => {
        if (!styles[i]) return;
        el.style.position = styles[i].position;
        el.style.visibility = styles[i].visibility;
      });
    },

    _triggerLazyLoad() {
      document.querySelectorAll('img[data-src], img[loading="lazy"]').forEach(img => {
        if (img.dataset.src && !img.src) img.src = img.dataset.src;
      });
    },

    async _cropDataUrl(dataUrl, sx, sy, sw, sh, dw, dh) {
      return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
          const c = document.createElement('canvas');
          c.width = dw; c.height = dh;
          c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
          resolve(c.toDataURL('image/png'));
        };
        img.src = dataUrl;
      });
    }
  };

  // =========================================================================
  // Message Listener
  // =========================================================================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'beginCapture') {
      handleCapture(message.mode, message.outputMode).then(sendResponse).catch(err => {
        console.error('PageSnap error:', err);
        sendResponse({ error: err.message });
      });
      return true;
    }
  });

  async function handleCapture(mode, outputMode) {
    if (isCapturing) return { error: 'Capture already in progress' };
    captureMode = mode;

    // Always extract content
    extractedContent = Extractor.extract();

    switch (mode) {
      case 'fullpage': return await doFullPageCapture();
      case 'visible': return await doVisibleCapture();
      case 'zone': return startZoneSelect();
      case 'scrollrange': return startScrollRange();
      case 'content': return openEditorWithContent(null, outputMode || 'summary');
      case 'create': return openEditorWithContent(null, outputMode || 'quickquote');
      case 'youtube': return openEditorWithContent(null, null); // opens editor, video tab auto-detected
      default: return { error: 'Unknown mode: ' + mode };
    }
  }

  async function doFullPageCapture() {
    isCapturing = true;
    showIndicator('Capturing full page...');
    try {
      const dataUrl = await Capture.captureFullPage();
      hideIndicator();
      isCapturing = false;
      openEditorWithContent(dataUrl);
      return { success: true };
    } catch (err) {
      hideIndicator();
      isCapturing = false;
      showNotification('Capture failed: ' + err.message, 'error');
      return { error: err.message };
    }
  }

  async function doVisibleCapture() {
    isCapturing = true;
    try {
      const dataUrl = await Capture.captureVisibleArea();
      isCapturing = false;
      openEditorWithContent(dataUrl);
      return { success: true };
    } catch (err) {
      isCapturing = false;
      showNotification('Capture failed: ' + err.message, 'error');
      return { error: err.message };
    }
  }

  function startZoneSelect() {
    const overlay = document.createElement('div');
    overlay.id = 'pagesnap-zone-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483646;cursor:crosshair;background:rgba(0,0,0,0.15);';

    const instructions = document.createElement('div');
    instructions.style.cssText = 'position:fixed;top:16px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:white;padding:8px 16px;border-radius:8px;font-family:-apple-system,sans-serif;font-size:14px;z-index:2147483647;pointer-events:none;';
    instructions.textContent = 'Click and drag to select an area. Press Esc to cancel.';

    const selRect = document.createElement('div');
    selRect.style.cssText = 'position:fixed;border:2px dashed #4F46E5;background:rgba(79,70,229,0.1);display:none;z-index:2147483647;pointer-events:none;';

    overlay.appendChild(instructions);
    overlay.appendChild(selRect);
    document.body.appendChild(overlay);

    let startX, startY, dragging = false;

    const onDown = (e) => { startX = e.clientX; startY = e.clientY; dragging = true; selRect.style.display = 'block'; };
    const onMove = (e) => {
      if (!dragging) return;
      selRect.style.left = Math.min(startX, e.clientX) + 'px';
      selRect.style.top = Math.min(startY, e.clientY) + 'px';
      selRect.style.width = Math.abs(e.clientX - startX) + 'px';
      selRect.style.height = Math.abs(e.clientY - startY) + 'px';
    };
    const onUp = async (e) => {
      if (!dragging) return;
      dragging = false;
      const x = Math.min(startX, e.clientX) + window.scrollX;
      const y = Math.min(startY, e.clientY) + window.scrollY;
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);
      cleanup();
      if (w < 10 || h < 10) { showNotification('Selection too small.', 'warning'); return; }
      isCapturing = true;
      showIndicator('Capturing area...');
      try {
        const dataUrl = await Capture.captureRegion(x, y, w, h);
        hideIndicator();
        isCapturing = false;
        openEditorWithContent(dataUrl);
      } catch (err) {
        hideIndicator();
        isCapturing = false;
        showNotification('Capture failed: ' + err.message, 'error');
      }
    };
    const onKey = (e) => { if (e.key === 'Escape') cleanup(); };

    function cleanup() {
      overlay.removeEventListener('mousedown', onDown);
      overlay.removeEventListener('mousemove', onMove);
      overlay.removeEventListener('mouseup', onUp);
      document.removeEventListener('keydown', onKey);
      overlay.remove();
    }

    overlay.addEventListener('mousedown', onDown);
    overlay.addEventListener('mousemove', onMove);
    overlay.addEventListener('mouseup', onUp);
    document.addEventListener('keydown', onKey);
    return { success: true };
  }

  function startScrollRange() {
    const banner = document.createElement('div');
    banner.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#4F46E5;color:white;padding:12px 20px;font-family:-apple-system,sans-serif;font-size:14px;z-index:2147483647;display:flex;justify-content:space-between;align-items:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);';

    const text = document.createElement('span');
    text.textContent = 'Scroll to START position, then click "Set Start"';

    const btns = document.createElement('div');
    btns.style.cssText = 'display:flex;gap:8px;';

    const btnStart = document.createElement('button');
    btnStart.textContent = 'Set Start';
    btnStart.style.cssText = 'background:white;color:#4F46E5;border:none;padding:6px 16px;border-radius:6px;font-size:13px;font-weight:600;cursor:pointer;';

    const btnCancel = document.createElement('button');
    btnCancel.textContent = 'Cancel';
    btnCancel.style.cssText = 'background:rgba(255,255,255,0.2);color:white;border:1px solid rgba(255,255,255,0.4);padding:6px 16px;border-radius:6px;font-size:13px;cursor:pointer;';

    btns.appendChild(btnStart);
    btns.appendChild(btnCancel);
    banner.appendChild(text);
    banner.appendChild(btns);
    document.body.appendChild(banner);

    let startY = null;
    btnCancel.addEventListener('click', () => banner.remove());

    btnStart.addEventListener('click', () => {
      startY = window.scrollY;
      text.textContent = `Start: ${Math.round(startY)}px. Scroll to END, click "Set End"`;
      btnStart.textContent = 'Set End';
      const newBtn = btnStart.cloneNode(true);
      btnStart.replaceWith(newBtn);
      newBtn.addEventListener('click', async () => {
        const endY = window.scrollY + window.innerHeight;
        banner.remove();
        if (endY <= startY) { showNotification('End must be below start.', 'warning'); return; }
        isCapturing = true;
        showIndicator('Capturing range...');
        try {
          const dataUrl = await Capture.captureRegion(0, startY, window.innerWidth, endY - startY);
          hideIndicator();
          isCapturing = false;
          openEditorWithContent(dataUrl);
        } catch (err) {
          hideIndicator();
          isCapturing = false;
          showNotification('Capture failed: ' + err.message, 'error');
        }
      });
    });
    return { success: true };
  }

  // =========================================================================
  // Editor + Output Panel
  // =========================================================================

  function openEditorWithContent(screenshotDataUrl, initialOutputMode) {
    const existing = document.getElementById('pagesnap-editor-container');
    if (existing) existing.remove();

    // Generate a one-time nonce for secure postMessage authentication
    // The editor iframe reads this from location.hash and validates it on every message
    const nonce = crypto.randomUUID();

    const container = document.createElement('div');
    container.id = 'pagesnap-editor-container';
    container.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;';

    const iframe = document.createElement('iframe');
    iframe.src = chrome.runtime.getURL('editor/editor.html') + '#' + nonce;
    iframe.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;border:none;z-index:2147483647;';

    iframe.onload = () => {
      // Detect YouTube and extract video data
      let youtubeData = null;
      const ytMatch = window.location.href.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
      if (ytMatch) {
        const videoId = ytMatch[1];

        // Extract caption URL directly from page scripts (DOM is available here)
        let captionUrl = null;
        try {
          const scripts = document.querySelectorAll('script');
          for (const script of scripts) {
            const text = script.textContent;
            if (text.includes('captionTracks')) {
              const match = text.match(/"captionTracks":\s*(\[.*?\])/);
              if (match) {
                const tracks = JSON.parse(match[1]);
                const en = tracks.find(t => t.languageCode === 'en' || t.languageCode?.startsWith('en'));
                const track = en || tracks[0];
                if (track?.baseUrl) captionUrl = track.baseUrl;
              }
              break;
            }
          }
        } catch (e) {}

        youtubeData = {
          videoId,
          captionUrl,
          url: window.location.href,
          title: document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string')?.textContent?.trim() || document.title,
          channel: document.querySelector('#channel-name a, ytd-channel-name a')?.textContent?.trim() || '',
          description: document.querySelector('#description-inner, ytd-text-inline-expander > yt-attributed-string')?.textContent?.trim()?.substring(0, 2000) || '',
          thumbnails: {
            maxres: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
            high: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
            medium: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`
          },
          currentTime: document.querySelector('video')?.currentTime || 0,
          duration: document.querySelector('video')?.duration || 0
        };
      }

      iframe.contentWindow.postMessage({
        type: 'pagesnap-load',
        nonce: nonce,
        screenshot: screenshotDataUrl,
        content: extractedContent,
        pageUrl: window.location.href,
        pageTitle: document.title,
        initialOutputMode: initialOutputMode || null,
        youtube: youtubeData
      }, '*');
    };

    container.appendChild(iframe);
    document.body.appendChild(container);

    const onMessage = (e) => {
      // Validate: must include our nonce to prove it came from our editor iframe
      if (e.data?.type === 'pagesnap-editor-close' && e.data?.nonce === nonce) {
        container.remove();
        window.removeEventListener('message', onMessage);
        document.removeEventListener('keydown', onKey);
      }
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && container.parentNode) {
        container.remove();
        window.removeEventListener('message', onMessage);
        document.removeEventListener('keydown', onKey);
      }
    };
    window.addEventListener('message', onMessage);
    document.addEventListener('keydown', onKey);

    // Save to swipe file
    saveToSwipeFile(screenshotDataUrl);
  }

  function saveToSwipeFile(screenshotDataUrl) {
    if (!extractedContent) return;

    let thumbnail = '';
    if (screenshotDataUrl) {
      const img = new Image();
      img.onload = () => {
        const c = document.createElement('canvas');
        const tw = 200;
        const th = Math.round(img.height * (tw / img.width));
        c.width = tw; c.height = th;
        c.getContext('2d').drawImage(img, 0, 0, tw, th);
        thumbnail = c.toDataURL('image/jpeg', 0.5);

        chrome.runtime.sendMessage({
          action: 'swipefileSave',
          item: { ...extractedContent, thumbnail, screenshot: thumbnail }
        });
      };
      img.src = screenshotDataUrl;
    } else {
      chrome.runtime.sendMessage({
        action: 'swipefileSave',
        item: { ...extractedContent }
      });
    }
  }

  // =========================================================================
  // UI Helpers
  // =========================================================================

  function showIndicator(text) {
    let el = document.getElementById('pagesnap-indicator');
    if (!el) { el = document.createElement('div'); el.id = 'pagesnap-indicator'; document.body.appendChild(el); }
    el.style.cssText = 'position:fixed;top:16px;right:16px;background:#4F46E5;color:white;padding:10px 20px;border-radius:8px;font-family:-apple-system,sans-serif;font-size:14px;z-index:2147483647;display:flex;align-items:center;gap:8px;box-shadow:0 4px 12px rgba(79,70,229,0.4);';
    // Build spinner + text with safe DOM APIs (no innerHTML)
    el.textContent = '';
    const styleEl = document.createElement('style');
    styleEl.textContent = '@keyframes ps-spin{to{transform:rotate(360deg)}}';
    const spinner = document.createElement('div');
    spinner.style.cssText = 'width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:ps-spin 0.8s linear infinite;';
    const span = document.createElement('span');
    span.textContent = text;
    el.appendChild(styleEl);
    el.appendChild(spinner);
    el.appendChild(span);
  }

  function hideIndicator() {
    document.getElementById('pagesnap-indicator')?.remove();
  }

  function showNotification(text, type = 'info') {
    const colors = { info: '#4F46E5', error: '#DC2626', warning: '#D97706', success: '#059669' };
    const el = document.createElement('div');
    el.style.cssText = `position:fixed;top:16px;right:16px;background:${colors[type]||colors.info};color:white;padding:10px 20px;border-radius:8px;font-family:-apple-system,sans-serif;font-size:14px;z-index:2147483647;box-shadow:0 4px 12px rgba(0,0,0,0.2);transition:opacity 0.3s;`;
    el.textContent = text;
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
  }
})();
