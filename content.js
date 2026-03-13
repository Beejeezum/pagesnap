/**
 * PageSnap - Content Script
 * Controls scroll capture loop, zone-select overlay, and editor panel mounting.
 * Injected into the active tab when a capture is initiated.
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

  // Listen for messages from background script
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
   * Main capture handler - routes to the appropriate capture mode
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
   * Full page capture - scroll and stitch
   */
  async function captureFullPage() {
    isCapturing = true;
    showCaptureIndicator('Capturing full page...');

    try {
      // Load utilities if not already loaded
      await loadUtilScripts();

      const dataUrl = await PageSnapCapture.captureFullPage();
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
   * Visible area capture - single viewport
   */
  async function captureVisible() {
    isCapturing = true;

    try {
      await loadUtilScripts();

      const dataUrl = await PageSnapCapture.captureVisibleArea();
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
   * Zone select - let user draw a rectangle
   */
  function startZoneSelect() {
    if (zoneSelectOverlay) {
      zoneSelectOverlay.remove();
    }

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
        await loadUtilScripts();
        const dataUrl = await PageSnapCapture.captureRegion(x, y, w, h);
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
      if (e.key === 'Escape') {
        cleanup();
      }
    };

    function cleanup() {
      zoneSelectOverlay.removeEventListener('mousedown', onMouseDown);
      zoneSelectOverlay.removeEventListener('mousemove', onMouseMove);
      zoneSelectOverlay.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('keydown', onKeyDown);
      if (zoneSelectOverlay.parentNode) {
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
   * Scroll range capture - user sets start and end points
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

      // Replace click handler
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
          await loadUtilScripts();
          const dataUrl = await PageSnapCapture.captureScrollRange(
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

  // --- Utility script loading ---

  async function loadUtilScripts() {
    if (typeof PageSnapCapture !== 'undefined' && typeof PageSnapStitch !== 'undefined') {
      return;
    }

    const scripts = ['utils/stitch.js', 'utils/capture.js', 'utils/export.js', 'utils/annotations.js'];
    for (const src of scripts) {
      await injectScript(chrome.runtime.getURL(src));
    }
  }

  function injectScript(url) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = url;
      script.onload = () => {
        script.remove();
        resolve();
      };
      script.onerror = () => {
        script.remove();
        reject(new Error('Failed to load: ' + url));
      };
      (document.head || document.documentElement).appendChild(script);
    });
  }

  // --- Editor ---

  function openEditor(dataUrl) {
    // Remove existing editor if any
    const existing = document.getElementById('pagesnap-editor-container');
    if (existing) existing.remove();

    // Create editor container
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

    // Create iframe for editor (isolated from page styles)
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
      // Pass the captured image to the editor
      iframe.contentWindow.postMessage({
        type: 'pagesnap-load-image',
        dataUrl: dataUrl,
        pageUrl: window.location.href,
        pageTitle: document.title
      }, '*');
    };

    container.appendChild(iframe);
    document.body.appendChild(container);

    // Listen for editor close message
    const messageHandler = (event) => {
      if (event.data && event.data.type === 'pagesnap-editor-close') {
        container.remove();
        window.removeEventListener('message', messageHandler);
      }
    };
    window.addEventListener('message', messageHandler);

    // ESC key closes editor
    const keyHandler = (e) => {
      if (e.key === 'Escape' && container.parentNode) {
        container.remove();
        window.removeEventListener('message', messageHandler);
        document.removeEventListener('keydown', keyHandler);
      }
    };
    document.addEventListener('keydown', keyHandler);

    // Save to history
    saveCaptureToHistory(dataUrl);
  }

  function saveCaptureToHistory(dataUrl) {
    // Create thumbnail
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

  // --- UI Indicators ---

  function showCaptureIndicator(text) {
    let indicator = document.getElementById('pagesnap-capture-indicator');
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.id = 'pagesnap-capture-indicator';
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
        animation: pagesnap-pulse 1.5s ease-in-out infinite;
      `;

      const style = document.createElement('style');
      style.textContent = `
        @keyframes pagesnap-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
      `;
      indicator.appendChild(style);
      document.body.appendChild(indicator);
    }

    // Spinner + text
    indicator.innerHTML = `
      <style>
        @keyframes pagesnap-spin { to { transform: rotate(360deg); } }
        @keyframes pagesnap-pulse { 0%,100% { opacity:1; } 50% { opacity:0.7; } }
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
