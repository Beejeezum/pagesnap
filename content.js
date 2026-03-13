/**
 * PageSnap - Content Script
 * Controls scroll capture loop, zone-select overlay, and editor panel mounting.
 * All capture/stitch logic is inlined to avoid CSP issues on strict sites.
 */

(function() {
  // Prevent double-injection
  if (window.__pageSnapInjected) return;
  window.__pageSnapInjected = true;

  // State
  let captureMode = null;
  let zoneSelectOverlay = null;
  let scrollRangeState = null;
  let isCapturing = false;

  // =========================================================================
  // Inline Stitch Logic (avoids CSP script injection issues)
  // =========================================================================

  const Stitch = {
    async stitchCaptures(captures, pageWidth, pageHeight, dpr) {
      if (captures.length === 0) throw new Error('No captures to stitch');

      if (captures.length === 1) {
        return await this._cropSingleCapture(captures[0], pageWidth, pageHeight, dpr);
      }

      const images = await Promise.all(captures.map(c => this._loadImage(c.dataUrl)));

      const outputWidth = Math.round(pageWidth * dpr);
      const outputHeight = Math.min(Math.round(pageHeight * dpr), 32767);

      const canvas = document.createElement('canvas');
      canvas.width = outputWidth;
      canvas.height = outputHeight;
      const ctx = canvas.getContext('2d');

      for (let i = 0; i < captures.length; i++) {
        const capture = captures[i];
        const img = images[i];
        const drawY = Math.round(capture.y * dpr);

        if (i === captures.length - 1) {
          const remainingPixels = Math.round(pageHeight * dpr) - drawY;
          if (remainingPixels < img.height) {
            const srcY = img.height - remainingPixels;
            ctx.drawImage(img, 0, srcY, img.width, remainingPixels, 0, drawY, img.width, remainingPixels);
            continue;
          }
        }
        ctx.drawImage(img, 0, drawY);
      }

      return canvas.toDataURL('image/png');
    },

    async _cropSingleCapture(capture, pageWidth, pageHeight, dpr) {
      const img = await this._loadImage(capture.dataUrl);
      const targetH = Math.round(pageHeight * dpr);
      const targetW = Math.round(pageWidth * dpr);

      if (img.height >= targetH && img.width >= targetW) {
        if (img.height === targetH && img.width === targetW) return capture.dataUrl;
        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, targetW, targetH, 0, 0, targetW, targetH);
        return canvas.toDataURL('image/png');
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
  // Inline Capture Logic
  // =========================================================================

  const Capture = {
    async captureFullPage(options = {}) {
      const scrollDelay = options.scrollDelay || 150;
      const maxScrolls = options.maxScrolls || 100;

      const originalScrollX = window.scrollX;
      const originalScrollY = window.scrollY;

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
        window.scrollTo(0, 0);
        await this._wait(scrollDelay);

        while (currentY < pageHeight && scrollCount < maxScrolls) {
          window.scrollTo(0, currentY);
          await this._wait(scrollDelay);

          this._triggerLazyLoad();
          await this._wait(50);

          const result = await this._captureViewport();
          if (result.error) throw new Error(result.error);

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

          if (capturedY + viewportHeight >= pageHeight) break;
        }
      } finally {
        this._restoreFixedElements(fixedElements, fixedOriginalStyles);
        const cs = document.getElementById('pagesnap-capture-style');
        if (cs) cs.remove();
        window.scrollTo(originalScrollX, originalScrollY);
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
      const viewportHeight = window.innerHeight;
      const scrollDelay = 150;

      const originalScrollX = window.scrollX;
      const originalScrollY = window.scrollY;

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
        const cs = document.getElementById('pagesnap-capture-style');
        if (cs) cs.remove();
        window.scrollTo(originalScrollX, originalScrollY);
      }

      const fullStitch = await Stitch.stitchCaptures(
        captures,
        window.innerWidth,
        y + height - captures[0].y + viewportHeight,
        dpr
      );

      return await this._cropDataUrl(
        fullStitch,
        x * dpr,
        (captures[0] ? (y - captures[0].y) : 0) * dpr,
        width * dpr,
        height * dpr,
        width,
        height
      );
    },

    async captureScrollRange(startY, endY) {
      const height = endY - startY;
      return await this.captureRegion(0, startY, window.innerWidth, height);
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
      const fixed = [];
      // Limit scan to reduce performance impact on large DOMs
      const all = document.querySelectorAll('header, nav, [class*="sticky"], [class*="fixed"], [style*="position: fixed"], [style*="position:fixed"], [style*="position: sticky"], [style*="position:sticky"]');
      for (const el of all) {
        try {
          const style = window.getComputedStyle(el);
          if (style.position === 'fixed' || style.position === 'sticky') {
            fixed.push(el);
          }
        } catch (e) {
          // skip
        }
      }
      return fixed;
    },

    _hideFixedElements(elements) {
      return elements.map(el => {
        const original = { position: el.style.position };
        el.style.position = 'absolute';
        return original;
      });
    },

    _restoreFixedElements(elements, originalStyles) {
      elements.forEach((el, i) => {
        if (originalStyles[i]) {
          el.style.position = originalStyles[i].position;
        }
      });
    },

    _triggerLazyLoad() {
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

  // =========================================================================
  // Message Listener
  // =========================================================================

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'beginCapture') {
      handleCapture(message.mode).then(sendResponse).catch(err => {
        console.error('PageSnap capture error:', err);
        sendResponse({ error: err.message });
      });
      return true;
    }
  });

  /**
   * Main capture handler
   */
  async function handleCapture(mode) {
    if (isCapturing) {
      return { error: 'Capture already in progress' };
    }
    captureMode = mode;

    switch (mode) {
      case 'fullpage':
        return await captureFullPage();
      case 'visible':
        return await captureVisible();
      case 'zone':
        return startZoneSelect();
      case 'scrollrange':
        return startScrollRange();
      default:
        return { error: 'Unknown capture mode: ' + mode };
    }
  }

  /**
   * Full page capture
   */
  async function captureFullPage() {
    isCapturing = true;
    showCaptureIndicator('Capturing full page...');

    try {
      const dataUrl = await Capture.captureFullPage();
      hideCaptureIndicator();
      isCapturing = false;
      openEditor(dataUrl);
      return { success: true };
    } catch (err) {
      hideCaptureIndicator();
      isCapturing = false;
      showNotification('Capture failed: ' + err.message, 'error');
      return { error: err.message };
    }
  }

  /**
   * Visible area capture
   */
  async function captureVisible() {
    isCapturing = true;

    try {
      const dataUrl = await Capture.captureVisibleArea();
      isCapturing = false;
      openEditor(dataUrl);
      return { success: true };
    } catch (err) {
      isCapturing = false;
      showNotification('Capture failed: ' + err.message, 'error');
      return { error: err.message };
    }
  }

  /**
   * Zone select - user draws a rectangle
   */
  function startZoneSelect() {
    if (zoneSelectOverlay) zoneSelectOverlay.remove();

    zoneSelectOverlay = document.createElement('div');
    zoneSelectOverlay.id = 'pagesnap-zone-overlay';
    zoneSelectOverlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2147483646;
      cursor: crosshair;
      background: rgba(0, 0, 0, 0.15);
    `;

    const instructions = document.createElement('div');
    instructions.style.cssText = `
      position: fixed;
      top: 16px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.8);
      color: white;
      padding: 8px 16px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      z-index: 2147483647;
      pointer-events: none;
    `;
    instructions.textContent = 'Click and drag to select an area. Press Esc to cancel.';

    const selectionRect = document.createElement('div');
    selectionRect.style.cssText = `
      position: fixed;
      border: 2px dashed #4F46E5;
      background: rgba(79, 70, 229, 0.1);
      display: none;
      z-index: 2147483647;
      pointer-events: none;
    `;

    zoneSelectOverlay.appendChild(instructions);
    zoneSelectOverlay.appendChild(selectionRect);
    document.body.appendChild(zoneSelectOverlay);

    let startX, startY, isDragging = false;

    const onMouseDown = (e) => {
      startX = e.clientX;
      startY = e.clientY;
      isDragging = true;
      selectionRect.style.display = 'block';
      selectionRect.style.left = startX + 'px';
      selectionRect.style.top = startY + 'px';
      selectionRect.style.width = '0px';
      selectionRect.style.height = '0px';
    };

    const onMouseMove = (e) => {
      if (!isDragging) return;
      const x = Math.min(startX, e.clientX);
      const y = Math.min(startY, e.clientY);
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);
      selectionRect.style.left = x + 'px';
      selectionRect.style.top = y + 'px';
      selectionRect.style.width = w + 'px';
      selectionRect.style.height = h + 'px';
    };

    const onMouseUp = async (e) => {
      if (!isDragging) return;
      isDragging = false;

      const x = Math.min(startX, e.clientX) + window.scrollX;
      const y = Math.min(startY, e.clientY) + window.scrollY;
      const w = Math.abs(e.clientX - startX);
      const h = Math.abs(e.clientY - startY);

      cleanup();

      if (w < 10 || h < 10) {
        showNotification('Selection too small. Please try again.', 'warning');
        return;
      }

      isCapturing = true;
      showCaptureIndicator('Capturing selected area...');

      try {
        const dataUrl = await Capture.captureRegion(x, y, w, h);
        hideCaptureIndicator();
        isCapturing = false;
        openEditor(dataUrl);
      } catch (err) {
        hideCaptureIndicator();
        isCapturing = false;
        showNotification('Capture failed: ' + err.message, 'error');
      }
    };

    const onKeyDown = (e) => {
      if (e.key === 'Escape') cleanup();
    };

    function cleanup() {
      zoneSelectOverlay.removeEventListener('mousedown', onMouseDown);
      zoneSelectOverlay.removeEventListener('mousemove', onMouseMove);
      zoneSelectOverlay.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', onKeyDown);
      if (zoneSelectOverlay && zoneSelectOverlay.parentNode) {
        zoneSelectOverlay.remove();
      }
      zoneSelectOverlay = null;
    }

    zoneSelectOverlay.addEventListener('mousedown', onMouseDown);
    zoneSelectOverlay.addEventListener('mousemove', onMouseMove);
    zoneSelectOverlay.addEventListener('mouseup', onMouseUp);
    document.addEventListener('keydown', onKeyDown);

    return { success: true, message: 'Zone select started' };
  }

  /**
   * Scroll range capture
   */
  function startScrollRange() {
    scrollRangeState = { startY: null, endY: null };

    const banner = document.createElement('div');
    banner.id = 'pagesnap-scrollrange-banner';
    banner.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      background: #4F46E5;
      color: white;
      padding: 12px 20px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      z-index: 2147483647;
      display: flex;
      justify-content: space-between;
      align-items: center;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    `;

    const text = document.createElement('span');
    text.textContent = 'Scroll to the START position, then click "Set Start"';

    const btnContainer = document.createElement('div');
    btnContainer.style.cssText = 'display: flex; gap: 8px;';

    const btnStart = document.createElement('button');
    btnStart.textContent = 'Set Start';
    btnStart.style.cssText = `
      background: white;
      color: #4F46E5;
      border: none;
      padding: 6px 16px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    `;

    const btnCancel = document.createElement('button');
    btnCancel.textContent = 'Cancel';
    btnCancel.style.cssText = `
      background: rgba(255,255,255,0.2);
      color: white;
      border: 1px solid rgba(255,255,255,0.4);
      padding: 6px 16px;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
    `;

    btnContainer.appendChild(btnStart);
    btnContainer.appendChild(btnCancel);
    banner.appendChild(text);
    banner.appendChild(btnContainer);
    document.body.appendChild(banner);

    btnCancel.addEventListener('click', () => {
      banner.remove();
      scrollRangeState = null;
    });

    btnStart.addEventListener('click', () => {
      scrollRangeState.startY = window.scrollY;
      text.textContent = `Start set at ${Math.round(scrollRangeState.startY)}px. Scroll to END position, then click "Set End"`;
      btnStart.textContent = 'Set End';

      const newBtn = btnStart.cloneNode(true);
      btnStart.replaceWith(newBtn);

      newBtn.addEventListener('click', async () => {
        scrollRangeState.endY = window.scrollY + window.innerHeight;
        banner.remove();

        if (scrollRangeState.endY <= scrollRangeState.startY) {
          showNotification('End position must be below start position.', 'warning');
          scrollRangeState = null;
          return;
        }

        isCapturing = true;
        showCaptureIndicator('Capturing scroll range...');

        try {
          const dataUrl = await Capture.captureScrollRange(
            scrollRangeState.startY,
            scrollRangeState.endY
          );
          hideCaptureIndicator();
          isCapturing = false;
          openEditor(dataUrl);
        } catch (err) {
          hideCaptureIndicator();
          isCapturing = false;
          showNotification('Capture failed: ' + err.message, 'error');
        }

        scrollRangeState = null;
      });
    });

    return { success: true, message: 'Scroll range mode started' };
  }

  // =========================================================================
  // Editor
  // =========================================================================

  function openEditor(dataUrl) {
    const existing = document.getElementById('pagesnap-editor-container');
    if (existing) existing.remove();

    const container = document.createElement('div');
    container.id = 'pagesnap-editor-container';
    container.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      z-index: 2147483647;
      background: transparent;
      pointer-events: none;
    `;

    const iframe = document.createElement('iframe');
    iframe.id = 'pagesnap-editor-iframe';
    iframe.src = chrome.runtime.getURL('editor/editor.html');
    iframe.style.cssText = `
      position: fixed;
      top: 0;
      right: 0;
      width: 100vw;
      height: 100vh;
      border: none;
      z-index: 2147483647;
      pointer-events: auto;
      background: transparent;
    `;

    iframe.onload = () => {
      iframe.contentWindow.postMessage({
        type: 'pagesnap-load-image',
        dataUrl: dataUrl,
        pageUrl: window.location.href,
        pageTitle: document.title
      }, '*');
    };

    container.appendChild(iframe);
    document.body.appendChild(container);

    const messageHandler = (event) => {
      if (event.data && event.data.type === 'pagesnap-editor-close') {
        container.remove();
        window.removeEventListener('message', messageHandler);
        document.removeEventListener('keydown', keyHandler);
      }
    };
    const keyHandler = (e) => {
      if (e.key === 'Escape' && container.parentNode) {
        container.remove();
        window.removeEventListener('message', messageHandler);
        document.removeEventListener('keydown', keyHandler);
      }
    };
    window.addEventListener('message', messageHandler);
    document.addEventListener('keydown', keyHandler);

    saveCaptureToHistory(dataUrl);
  }

  function saveCaptureToHistory(dataUrl) {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const thumbWidth = 200;
      const thumbHeight = Math.round(img.height * (thumbWidth / img.width));
      canvas.width = thumbWidth;
      canvas.height = thumbHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, thumbWidth, thumbHeight);

      chrome.runtime.sendMessage({
        action: 'saveToHistory',
        capture: {
          thumbnail: canvas.toDataURL('image/jpeg', 0.5),
          url: window.location.href,
          title: document.title,
          mode: captureMode,
          width: img.width,
          height: img.height
        }
      });
    };
    img.src = dataUrl;
  }

  // =========================================================================
  // UI Indicators
  // =========================================================================

  function showCaptureIndicator(text) {
    let indicator = document.getElementById('pagesnap-capture-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'pagesnap-capture-indicator';
      document.body.appendChild(indicator);
    }
    indicator.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      background: #4F46E5;
      color: white;
      padding: 10px 20px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 8px;
      box-shadow: 0 4px 12px rgba(79, 70, 229, 0.4);
    `;
    indicator.innerHTML = `
      <style>
        @keyframes pagesnap-spin { to { transform: rotate(360deg); } }
      </style>
      <div style="width:16px;height:16px;border:2px solid rgba(255,255,255,0.3);border-top-color:white;border-radius:50%;animation:pagesnap-spin 0.8s linear infinite;"></div>
      <span>${text}</span>
    `;
  }

  function hideCaptureIndicator() {
    const indicator = document.getElementById('pagesnap-capture-indicator');
    if (indicator) indicator.remove();
  }

  function showNotification(text, type = 'info') {
    const colors = {
      info: '#4F46E5',
      error: '#DC2626',
      warning: '#D97706',
      success: '#059669'
    };

    const notification = document.createElement('div');
    notification.style.cssText = `
      position: fixed;
      top: 16px;
      right: 16px;
      background: ${colors[type] || colors.info};
      color: white;
      padding: 10px 20px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      z-index: 2147483647;
      box-shadow: 0 4px 12px rgba(0,0,0,0.2);
      transition: opacity 0.3s;
    `;
    notification.textContent = text;
    document.body.appendChild(notification);

    setTimeout(() => {
      notification.style.opacity = '0';
      setTimeout(() => notification.remove(), 300);
    }, 3000);
  }
})();
