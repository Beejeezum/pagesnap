/**
 * PageSnap - Capture Utilities
 * Scroll-and-stitch logic for full-page capture.
 */

const PageSnapCapture = {
  /**
   * Capture the full page by scrolling and stitching.
   * Returns a data URI of the complete page screenshot.
   */
  async captureFullPage(options = {}) {
    const scrollDelay = options.scrollDelay || 150;
    const maxScrolls = options.maxScrolls || 100;

    // Save original state
    const originalScrollX = window.scrollX;
    const originalScrollY = window.scrollY;
    const originalOverflow = document.documentElement.style.overflow;

    // Get page dimensions
    const pageWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth || 0
    );
    const pageHeight = Math.max(
      document.documentElement.scrollHeight,
      document.body.scrollHeight || 0
    );
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const dpr = window.devicePixelRatio || 1;

    // Hide scrollbars
    const styleEl = document.createElement('style');
    styleEl.id = 'pagesnap-capture-style';
    styleEl.textContent = `
      ::-webkit-scrollbar { display: none !important; }
      * { scrollbar-width: none !important; }
    `;
    document.head.appendChild(styleEl);

    // Handle fixed/sticky elements
    const fixedElements = this._getFixedElements();
    const fixedOriginalStyles = this._hideFixedElements(fixedElements);

    const captures = [];
    let currentY = 0;
    let scrollCount = 0;

    try {
      // Scroll to top
      window.scrollTo(0, 0);
      await this._wait(scrollDelay);

      while (currentY < pageHeight && scrollCount < maxScrolls) {
        // Scroll to position
        window.scrollTo(0, currentY);
        await this._wait(scrollDelay);

        // Trigger lazy-load images
        this._triggerLazyLoad();
        await this._wait(50);

        // Capture visible viewport via background script
        const result = await this._captureViewport();
        if (result.error) {
          throw new Error(result.error);
        }

        const capturedY = window.scrollY;
        const remainingHeight = pageHeight - capturedY;
        const captureHeight = Math.min(viewportHeight, remainingHeight);

        captures.push({
          dataUrl: result.dataUrl,
          y: capturedY,
          height: captureHeight,
          viewportHeight: viewportHeight
        });

        currentY += viewportHeight;
        scrollCount++;

        // If we've reached the bottom, stop
        if (capturedY + viewportHeight >= pageHeight) {
          break;
        }
      }
    } finally {
      // Restore fixed elements
      this._restoreFixedElements(fixedElements, fixedOriginalStyles);

      // Remove scrollbar hiding
      const captureStyle = document.getElementById('pagesnap-capture-style');
      if (captureStyle) captureStyle.remove();

      // Restore scroll position
      window.scrollTo(originalScrollX, originalScrollY);
    }

    // Stitch captures
    return await PageSnapStitch.stitchCaptures(captures, pageWidth, pageHeight, dpr);
  },

  /**
   * Capture just the visible viewport
   */
  async captureVisibleArea() {
    const result = await this._captureViewport();
    if (result.error) {
      throw new Error(result.error);
    }
    return result.dataUrl;
  },

  /**
   * Capture a specific region defined by coordinates
   */
  async captureRegion(x, y, width, height) {
    const dpr = window.devicePixelRatio || 1;
    const viewportHeight = window.innerHeight;
    const scrollDelay = 150;

    // Save state
    const originalScrollX = window.scrollX;
    const originalScrollY = window.scrollY;

    // Hide scrollbars
    const styleEl = document.createElement('style');
    styleEl.id = 'pagesnap-capture-style';
    styleEl.textContent = `
      ::-webkit-scrollbar { display: none !important; }
      * { scrollbar-width: none !important; }
    `;
    document.head.appendChild(styleEl);

    const fixedElements = this._getFixedElements();
    const fixedOriginalStyles = this._hideFixedElements(fixedElements);

    const captures = [];
    let currentY = y;

    try {
      while (currentY < y + height) {
        window.scrollTo(x, currentY);
        await this._wait(scrollDelay);

        const result = await this._captureViewport();
        if (result.error) throw new Error(result.error);

        captures.push({
          dataUrl: result.dataUrl,
          y: window.scrollY,
          height: Math.min(viewportHeight, (y + height) - window.scrollY),
          viewportHeight: viewportHeight
        });

        currentY += viewportHeight;
        if (window.scrollY + viewportHeight >= y + height) break;
      }
    } finally {
      this._restoreFixedElements(fixedElements, fixedOriginalStyles);
      const captureStyle = document.getElementById('pagesnap-capture-style');
      if (captureStyle) captureStyle.remove();
      window.scrollTo(originalScrollX, originalScrollY);
    }

    // Stitch and crop to exact region
    const fullStitch = await PageSnapStitch.stitchCaptures(
      captures,
      window.innerWidth,
      y + height - captures[0].y + viewportHeight,
      dpr
    );

    // Crop to the exact region
    return await this._cropDataUrl(fullStitch, x * dpr, (captures[0] ? (y - captures[0].y) : 0) * dpr, width * dpr, height * dpr, width, height);
  },

  /**
   * Capture between two scroll positions (scroll range mode)
   */
  async captureScrollRange(startY, endY) {
    const height = endY - startY;
    const viewportWidth = window.innerWidth;
    return await this.captureRegion(0, startY, viewportWidth, height);
  },

  // --- Private helpers ---

  async _captureViewport() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: 'captureVisibleTab' }, (response) => {
        resolve(response || { error: 'No response from background script' });
      });
    });
  },

  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  },

  _getFixedElements() {
    const all = document.querySelectorAll('*');
    const fixed = [];
    for (const el of all) {
      const style = window.getComputedStyle(el);
      if (style.position === 'fixed' || style.position === 'sticky') {
        fixed.push(el);
      }
    }
    return fixed;
  },

  _hideFixedElements(elements) {
    return elements.map(el => {
      const original = {
        position: el.style.position,
        visibility: el.style.visibility
      };
      el.style.position = 'absolute';
      return original;
    });
  },

  _restoreFixedElements(elements, originalStyles) {
    elements.forEach((el, i) => {
      if (originalStyles[i]) {
        el.style.position = originalStyles[i].position;
        el.style.visibility = originalStyles[i].visibility;
      }
    });
  },

  _triggerLazyLoad() {
    // Force IntersectionObserver callbacks by scrolling slightly
    const images = document.querySelectorAll('img[data-src], img[loading="lazy"]');
    images.forEach(img => {
      if (img.dataset.src && !img.src) {
        img.src = img.dataset.src;
      }
    });
  },

  async _cropDataUrl(dataUrl, sx, sy, sw, sh, dw, dh) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = dw;
        canvas.height = dh;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, dw, dh);
        resolve(canvas.toDataURL('image/png'));
      };
      img.src = dataUrl;
    });
  }
};
