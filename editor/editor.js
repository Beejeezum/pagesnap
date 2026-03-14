/**
 * PageSnap v2 - Editor
 * Screenshot annotation + AI content generation panel.
 */

(function() {
  // --- State ---
  let imageCanvas, imageCtx, annotCanvas, annotCtx, container;
  let originalImage = null;
  let currentTool = 'select';
  let currentColor = '#FF0000';
  let currentLineWidth = 2;
  let currentFontSize = 16;
  let annotationState = null;
  let pageContent = null;
  let pageUrl = '', pageTitle = '';
  let isDrawing = false, drawStartX = 0, drawStartY = 0;
  let canvasScale = 1;
  let cropMode = false, cropRect = {}, cropDragging = false;
  let freehandPoints = [];
  let currentOutputMode = 'quickquote';
  let lastGeneratedOutput = null;
  let hasScreenshot = false;
  const EXTENSION_ORIGIN = chrome.runtime.getURL('').slice(0, -1);

  function init() {
    imageCanvas = document.getElementById('imageCanvas');
    annotCanvas = document.getElementById('annotationCanvas');
    imageCtx = imageCanvas.getContext('2d');
    annotCtx = annotCanvas.getContext('2d');
    container = document.getElementById('canvasContainer');
    annotationState = PageSnapAnnotations.createState();

    setupToolbar();
    setupToolOptions();
    setupExportButtons();
    setupCanvasEvents();
    setupKeyboardShortcuts();
    setupCropEvents();
    setupPanelTabs();
    setupOutputModes();
    setupGraphicControls();

    window.addEventListener('message', (e) => {
      // Validate origin: only accept messages from our own extension
      if (e.origin !== EXTENSION_ORIGIN && e.origin !== location.origin) return;
      if (e.data?.type === 'pagesnap-load') {
        if (e.data.screenshot) {
          loadImage(e.data.screenshot);
        } else {
          hasScreenshot = false;
          document.getElementById('noScreenshot').style.display = 'block';
          document.getElementById('annotationTools').style.visibility = 'hidden';
          // Switch to content panel
          switchPanel('content');
        }
        if (e.data.content) {
          pageContent = e.data.content;
          populateContentPanel(e.data.content);
        }
        pageUrl = e.data.pageUrl || '';
        pageTitle = e.data.pageTitle || '';
        if (e.data.initialOutputMode) {
          setOutputMode(e.data.initialOutputMode);
          // Auto-generate if coming from Create tab
          if (pageContent) {
            setTimeout(() => generateContent(), 300);
          }
        }
      }
      // Legacy support
      if (e.data?.type === 'pagesnap-load-image') {
        loadImage(e.data.dataUrl);
        pageUrl = e.data.pageUrl || '';
        pageTitle = e.data.pageTitle || '';
      }
    });
  }

  // --- Image Loading ---
  function loadImage(dataUrl) {
    const img = new Image();
    img.onload = () => {
      originalImage = img;
      hasScreenshot = true;
      document.getElementById('noScreenshot').style.display = 'none';
      document.getElementById('annotationTools').style.visibility = 'visible';
      fitImageToContainer();
      document.getElementById('imageInfo').textContent = `${img.width} x ${img.height}px`;
    };
    img.src = dataUrl;
  }

  function fitImageToContainer() {
    if (!originalImage) return;
    const rect = container.getBoundingClientRect();
    const pad = 30;
    canvasScale = Math.min((rect.width - pad * 2) / originalImage.width, (rect.height - pad * 2) / originalImage.height, 1);
    const dw = Math.round(originalImage.width * canvasScale);
    const dh = Math.round(originalImage.height * canvasScale);

    imageCanvas.width = originalImage.width;
    imageCanvas.height = originalImage.height;
    imageCanvas.style.width = dw + 'px';
    imageCanvas.style.height = dh + 'px';
    annotCanvas.width = originalImage.width;
    annotCanvas.height = originalImage.height;
    annotCanvas.style.width = dw + 'px';
    annotCanvas.style.height = dh + 'px';
    imageCtx.drawImage(originalImage, 0, 0);
    redrawAnnotations();
  }

  // --- Panel Tabs ---
  function setupPanelTabs() {
    document.querySelectorAll('.toolbar-tab').forEach(tab => {
      tab.addEventListener('click', () => switchPanel(tab.dataset.panel));
    });
  }

  function switchPanel(panel) {
    document.querySelectorAll('.toolbar-tab').forEach(t => t.classList.remove('active'));
    document.querySelector(`.toolbar-tab[data-panel="${panel}"]`)?.classList.add('active');

    const sp = document.getElementById('screenshotPanel');
    const cp = document.getElementById('contentPanel');

    if (panel === 'screenshot') {
      sp.classList.add('active');
      sp.style.display = 'flex';
      cp.style.display = 'none';
      document.getElementById('annotationTools').style.display = 'flex';
    } else {
      sp.style.display = 'none';
      cp.style.display = 'flex';
      document.getElementById('annotationTools').style.display = 'none';
    }

    // If both panels should show (has screenshot), show side-by-side
    if (hasScreenshot && panel === 'content') {
      sp.style.display = 'flex';
      cp.style.display = 'flex';
      document.getElementById('annotationTools').style.display = 'flex';
    }
  }

  // --- Content Panel ---
  function populateContentPanel(content) {
    document.getElementById('contentTitle').textContent = content.title || 'Untitled';
    document.getElementById('contentDomain').textContent = content.domain || '';
    document.getElementById('contentWordCount').textContent =
      content.content?.wordCount ? `${content.content.wordCount} words` : '';
    document.getElementById('contentExcerpt').textContent = content.excerpt || content.description || '';
  }

  // --- Output Modes ---
  function setupOutputModes() {
    document.querySelectorAll('.output-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => setOutputMode(btn.dataset.mode));
    });
    document.getElementById('generateBtn').addEventListener('click', generateContent);
    document.getElementById('copyOutput').addEventListener('click', copyOutputToClipboard);
    document.getElementById('saveOutput').addEventListener('click', saveOutputToLibrary);
  }

  function setOutputMode(mode) {
    currentOutputMode = mode;
    document.querySelectorAll('.output-mode-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.output-mode-btn[data-mode="${mode}"]`)?.classList.add('active');

    // Show/hide graphic controls
    const graphicPreview = document.getElementById('graphicPreview');
    const aiOutput = document.getElementById('aiOutput');
    if (mode === 'graphic') {
      graphicPreview.style.display = 'flex';
      aiOutput.style.display = 'none';
      // Pre-fill quote with excerpt
      if (pageContent && !document.getElementById('graphicQuote').value) {
        document.getElementById('graphicQuote').value = pageContent.excerpt || pageContent.title || '';
      }
    } else {
      graphicPreview.style.display = 'none';
      aiOutput.style.display = 'block';
    }
  }

  async function generateContent() {
    if (!pageContent) {
      showToast('No content extracted. Capture a page first.');
      return;
    }

    if (currentOutputMode === 'graphic') {
      generateGraphic();
      return;
    }

    const btn = document.getElementById('generateBtn');
    const output = document.getElementById('aiOutput');
    const actions = document.getElementById('outputActions');

    btn.disabled = true;
    btn.textContent = 'Generating...';
    setLoadingState(output);

    try {
      const customPrompt = document.getElementById('customPrompt').value.trim();
      const response = await chrome.runtime.sendMessage({
        action: 'generateContent',
        content: pageContent,
        outputMode: currentOutputMode,
        customPrompt: customPrompt
      });

      if (response.error) {
        setErrorState(output, response.error);
      } else {
        lastGeneratedOutput = response.result;
        renderFormattedOutput(output, response.result.formatted);
        actions.style.display = 'flex';
      }
    } catch (err) {
      setErrorState(output, err.message);
    }

    btn.disabled = false;
    btn.textContent = 'Generate';
  }

  // --- Safe DOM rendering helpers (no innerHTML with user/AI content) ---

  function setLoadingState(container) {
    container.textContent = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'loading';
    const style = document.createElement('style');
    style.textContent = '@keyframes ps-spin{to{transform:rotate(360deg)}}';
    const spinner = document.createElement('div');
    spinner.style.cssText = 'width:14px;height:14px;border:2px solid var(--border);border-top-color:var(--accent);border-radius:50%;animation:ps-spin 0.8s linear infinite;';
    wrapper.appendChild(style);
    wrapper.appendChild(spinner);
    wrapper.appendChild(document.createTextNode(' Generating with Claude...'));
    container.appendChild(wrapper);
  }

  function setErrorState(container, errorMsg) {
    container.textContent = '';
    const div = document.createElement('div');
    div.style.color = '#EF4444';
    div.textContent = errorMsg;
    container.appendChild(div);
    if (errorMsg.includes('API key')) {
      const hint = document.createElement('div');
      hint.style.cssText = 'margin-top:8px;font-size:11px;color:var(--text-muted);';
      hint.textContent = 'Open extension settings to add your Claude API key.';
      container.appendChild(hint);
    }
  }

  function renderFormattedOutput(container, text) {
    // Safe rendering: parse markdown line-by-line using DOM APIs
    container.textContent = '';
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { container.appendChild(document.createElement('br')); continue; }

      // Headings
      const h3Match = trimmed.match(/^###\s+(.+)$/);
      if (h3Match) { const el = document.createElement('h4'); el.style.cssText = 'margin:8px 0 4px;font-size:13px;'; el.textContent = h3Match[1]; container.appendChild(el); continue; }
      const h2Match = trimmed.match(/^##\s+(.+)$/);
      if (h2Match) { const el = document.createElement('h3'); el.style.cssText = 'margin:10px 0 4px;font-size:14px;'; el.textContent = h2Match[1]; container.appendChild(el); continue; }
      const h1Match = trimmed.match(/^#\s+(.+)$/);
      if (h1Match) { const el = document.createElement('h2'); el.style.cssText = 'margin:12px 0 6px;font-size:15px;'; el.textContent = h1Match[1]; container.appendChild(el); continue; }

      // Bullet points
      const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
      if (bulletMatch) { const el = document.createElement('div'); el.style.paddingLeft = '12px'; el.textContent = '\u2022 ' + bulletMatch[1]; container.appendChild(el); continue; }

      // Numbered lists
      const numMatch = trimmed.match(/^(\d+)[./]\s+(.+)$/);
      if (numMatch) { const el = document.createElement('div'); el.style.paddingLeft = '12px'; el.textContent = numMatch[1] + '. ' + numMatch[2]; container.appendChild(el); continue; }

      // Bold/italic inline — render as styled spans safely
      const span = document.createElement('span');
      renderInlineMarkdown(span, trimmed);
      container.appendChild(span);
      container.appendChild(document.createElement('br'));
    }
  }

  function renderInlineMarkdown(parent, text) {
    // Parse bold (**text**) and italic (*text*) safely
    const parts = text.split(/(\*\*.*?\*\*|\*.*?\*)/g);
    for (const part of parts) {
      if (part.startsWith('**') && part.endsWith('**')) {
        const strong = document.createElement('strong');
        strong.textContent = part.slice(2, -2);
        parent.appendChild(strong);
      } else if (part.startsWith('*') && part.endsWith('*') && part.length > 2) {
        const em = document.createElement('em');
        em.textContent = part.slice(1, -1);
        parent.appendChild(em);
      } else {
        parent.appendChild(document.createTextNode(part));
      }
    }
  }

  async function copyOutputToClipboard() {
    if (!lastGeneratedOutput) return;
    try {
      await navigator.clipboard.writeText(lastGeneratedOutput.copyText || lastGeneratedOutput.raw);
      showToast('Copied to clipboard');
    } catch (e) {
      showToast('Copy failed');
    }
  }

  async function saveOutputToLibrary() {
    if (!lastGeneratedOutput || !pageContent) return;
    try {
      // Find the swipe file item for this URL and add the output
      const response = await chrome.runtime.sendMessage({ action: 'swipefileGetAll' });
      const items = response?.items || [];
      const match = items.find(i => i.url === pageContent.url);
      if (match) {
        await chrome.runtime.sendMessage({
          action: 'swipefileAddOutput',
          id: match.id,
          output: lastGeneratedOutput
        });
      }
      showToast('Saved to library');
    } catch (e) {
      showToast('Save failed');
    }
  }

  // --- Social Graphics ---
  function setupGraphicControls() {
    document.getElementById('generateGraphic').addEventListener('click', generateGraphic);
    document.getElementById('graphicStyle').addEventListener('change', generateGraphic);
    document.getElementById('graphicRatio').addEventListener('change', generateGraphic);
  }

  function generateGraphic() {
    const quote = document.getElementById('graphicQuote').value.trim();
    if (!quote) {
      showToast('Enter a quote for the graphic');
      return;
    }

    const style = document.getElementById('graphicStyle').value;
    const ratioId = document.getElementById('graphicRatio').value;
    const ratios = { '16:9': [1200, 675], '1:1': [1080, 1080], '4:5': [1080, 1350], '9:16': [1080, 1920] };
    const [w, h] = ratios[ratioId] || [1200, 675];

    const dataUrl = PageSnapGraphics.generate({
      quote: quote,
      source: pageContent?.url || pageUrl,
      author: pageContent?.author || '',
      style: style,
      width: w,
      height: h
    });

    const wrap = document.getElementById('graphicCanvasWrap');
    wrap.textContent = '';
    const img = document.createElement('img');
    // Validate dataUrl is actually a data URI before using as src
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
      img.src = dataUrl;
    }
    img.alt = 'Generated graphic';
    wrap.appendChild(img);

    // Show export actions for the graphic
    document.getElementById('outputActions').style.display = 'flex';
    lastGeneratedOutput = {
      mode: 'graphic',
      raw: quote,
      formatted: quote,
      copyText: quote,
      graphicDataUrl: dataUrl
    };
  }

  // --- Toolbar ---
  function setupToolbar() {
    document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (cropMode && btn.dataset.tool !== 'crop') cancelCrop();
        setTool(btn.dataset.tool);
      });
    });
    document.getElementById('undoBtn').addEventListener('click', () => {
      if (PageSnapAnnotations.undo(annotationState)) { redrawAnnotations(); updateUndoRedo(); }
    });
    document.getElementById('redoBtn').addEventListener('click', () => {
      if (PageSnapAnnotations.redo(annotationState)) { redrawAnnotations(); updateUndoRedo(); }
    });
    document.getElementById('closeBtn').addEventListener('click', closeEditor);
  }

  function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.tool-btn[data-tool="${tool}"]`)?.classList.add('active');
    annotationState.selectedId = null;
    redrawAnnotations();
    annotCanvas.style.cursor = ['select'].includes(tool) ? 'default' : 'crosshair';
    if (tool === 'text') annotCanvas.style.cursor = 'text';
    updateToolOptions();
    if (tool === 'crop') enterCropMode();
    else if (cropMode) cancelCrop();
  }

  function updateToolOptions() {
    const drawTools = ['arrow', 'rectangle', 'highlight', 'blur', 'freehand', 'text'];
    const hasColor = drawTools.includes(currentTool);
    const hasWidth = ['arrow', 'rectangle', 'freehand'].includes(currentTool);
    const hasFont = currentTool === 'text';
    document.getElementById('colorPicker').style.display = hasColor ? 'flex' : 'none';
    document.getElementById('lineWidthGroup').style.display = hasWidth ? 'flex' : 'none';
    document.getElementById('fontSizeGroup').style.display = hasFont ? 'flex' : 'none';
  }

  function setupToolOptions() {
    document.querySelectorAll('.color-swatch').forEach(s => {
      s.addEventListener('click', () => {
        currentColor = s.dataset.color;
        document.querySelectorAll('.color-swatch').forEach(sw => sw.classList.remove('active'));
        s.classList.add('active');
        document.getElementById('customColor').value = currentColor;
      });
    });
    document.getElementById('customColor').addEventListener('input', (e) => {
      currentColor = e.target.value;
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    });
    document.getElementById('lineWidth').addEventListener('input', (e) => {
      currentLineWidth = parseInt(e.target.value);
      document.getElementById('lineWidthValue').textContent = currentLineWidth;
    });
    document.getElementById('fontSize').addEventListener('input', (e) => {
      currentFontSize = parseInt(e.target.value);
      document.getElementById('fontSizeValue').textContent = currentFontSize;
    });
  }

  // --- Canvas Events ---
  function setupCanvasEvents() {
    annotCanvas.addEventListener('mousedown', onDown);
    annotCanvas.addEventListener('mousemove', onMove);
    annotCanvas.addEventListener('mouseup', onUp);
    window.addEventListener('resize', () => fitImageToContainer());
  }

  function getCoords(e) {
    const r = annotCanvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * annotCanvas.width / r.width, y: (e.clientY - r.top) * annotCanvas.height / r.height };
  }

  function onDown(e) {
    if (cropMode) return;
    const { x, y } = getCoords(e);
    isDrawing = true; drawStartX = x; drawStartY = y;

    if (currentTool === 'select') {
      const hit = PageSnapAnnotations.hitTest(annotationState, x, y);
      annotationState.selectedId = hit ? hit.id : null;
      redrawAnnotations();
      if (hit) isDrawing = false;
      return;
    }
    if (currentTool === 'text') {
      isDrawing = false;
      showTextInput(e.clientX, e.clientY, x, y);
      return;
    }
    if (currentTool === 'freehand') freehandPoints = [{ x, y }];
  }

  function onMove(e) {
    if (!isDrawing || cropMode) return;
    const { x, y } = getCoords(e);

    if (currentTool === 'freehand') {
      freehandPoints.push({ x, y });
      redrawAnnotations();
      annotCtx.save();
      annotCtx.strokeStyle = currentColor; annotCtx.lineWidth = currentLineWidth;
      annotCtx.lineCap = 'round'; annotCtx.lineJoin = 'round';
      annotCtx.beginPath(); annotCtx.moveTo(freehandPoints[0].x, freehandPoints[0].y);
      for (let i = 1; i < freehandPoints.length; i++) annotCtx.lineTo(freehandPoints[i].x, freehandPoints[i].y);
      annotCtx.stroke(); annotCtx.restore();
      return;
    }
    redrawAnnotations();
    annotCtx.save(); previewAnnotation(drawStartX, drawStartY, x, y); annotCtx.restore();
  }

  function onUp(e) {
    if (!isDrawing || cropMode) return;
    isDrawing = false;
    const { x, y } = getCoords(e);

    if (currentTool === 'freehand') {
      if (freehandPoints.length > 2) {
        PageSnapAnnotations.addAnnotation(annotationState, { type: 'freehand', points: [...freehandPoints], color: currentColor, lineWidth: currentLineWidth });
      }
      freehandPoints = []; redrawAnnotations(); updateUndoRedo(); return;
    }

    const ann = makeAnnotation(drawStartX, drawStartY, x, y);
    if (ann) { PageSnapAnnotations.addAnnotation(annotationState, ann); redrawAnnotations(); updateUndoRedo(); }
  }

  function previewAnnotation(x1, y1, x2, y2) {
    const ctx = annotCtx;
    switch (currentTool) {
      case 'arrow':
        ctx.strokeStyle = currentColor; ctx.fillStyle = currentColor; ctx.lineWidth = currentLineWidth; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        const a = Math.atan2(y2-y1, x2-x1); const hl = Math.max(10, currentLineWidth*5);
        ctx.beginPath(); ctx.moveTo(x2, y2);
        ctx.lineTo(x2-hl*Math.cos(a-Math.PI/6), y2-hl*Math.sin(a-Math.PI/6));
        ctx.lineTo(x2-hl*Math.cos(a+Math.PI/6), y2-hl*Math.sin(a+Math.PI/6));
        ctx.closePath(); ctx.fill(); break;
      case 'rectangle':
        ctx.strokeStyle = currentColor; ctx.lineWidth = currentLineWidth;
        ctx.strokeRect(x1, y1, x2-x1, y2-y1); break;
      case 'highlight':
        ctx.globalAlpha = 0.35; ctx.fillStyle = currentColor;
        ctx.fillRect(x1, y1, x2-x1, y2-y1); ctx.globalAlpha = 1; break;
      case 'blur':
        ctx.fillStyle = 'rgba(128,128,128,0.4)'; ctx.fillRect(x1, y1, x2-x1, y2-y1);
        ctx.strokeStyle = '#999'; ctx.lineWidth = 1; ctx.setLineDash([4,4]);
        ctx.strokeRect(x1, y1, x2-x1, y2-y1); ctx.setLineDash([]); break;
    }
  }

  function makeAnnotation(x1, y1, x2, y2) {
    if (Math.abs(x2-x1) < 5 && Math.abs(y2-y1) < 5) return null;
    switch (currentTool) {
      case 'arrow': return { type: 'arrow', x1, y1, x2, y2, color: currentColor, lineWidth: currentLineWidth };
      case 'rectangle': return { type: 'rectangle', x: Math.min(x1,x2), y: Math.min(y1,y2), width: Math.abs(x2-x1), height: Math.abs(y2-y1), color: currentColor, lineWidth: currentLineWidth, filled: false, opacity: 0.3 };
      case 'highlight': return { type: 'highlight', x: Math.min(x1,x2), y: Math.min(y1,y2), width: Math.abs(x2-x1), height: Math.abs(y2-y1), color: currentColor };
      case 'blur': return { type: 'blur', x: Math.min(x1,x2), y: Math.min(y1,y2), width: Math.abs(x2-x1), height: Math.abs(y2-y1), intensity: 10 };
      default: return null;
    }
  }

  // --- Text ---
  function showTextInput(sx, sy, cx, cy) {
    const ti = document.getElementById('textInput');
    ti.style.display = 'block'; ti.style.left = sx+'px'; ti.style.top = sy+'px';
    ti.style.fontSize = currentFontSize+'px'; ti.style.color = currentColor;
    ti.value = ''; ti.focus();

    const commit = () => {
      const text = ti.value.trim();
      if (text) {
        annotCtx.font = `${currentFontSize}px -apple-system, sans-serif`;
        const m = annotCtx.measureText(text);
        PageSnapAnnotations.addAnnotation(annotationState, {
          type: 'text', x: cx, y: cy, text, color: currentColor, fontSize: currentFontSize,
          textWidth: m.width, textHeight: currentFontSize * 1.3
        });
        redrawAnnotations(); updateUndoRedo();
      }
      ti.style.display = 'none'; ti.removeEventListener('blur', commit); ti.removeEventListener('keydown', onK);
    };
    const onK = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit(); }
      if (e.key === 'Escape') { ti.style.display = 'none'; ti.removeEventListener('blur', commit); ti.removeEventListener('keydown', onK); }
    };
    ti.addEventListener('blur', commit); ti.addEventListener('keydown', onK);
  }

  // --- Crop ---
  function enterCropMode() {
    cropMode = true;
    cropRect = { x: 10, y: 10, width: annotCanvas.clientWidth - 20, height: annotCanvas.clientHeight - 20 };
    updateCropDisplay();
    document.getElementById('cropOverlay').style.display = 'block';
    const region = document.getElementById('cropRegion');
    if (!region.querySelector('.crop-actions')) {
      const actions = document.createElement('div'); actions.className = 'crop-actions';
      const applyBtn = document.createElement('button');
      applyBtn.className = 'crop-action-btn crop-apply';
      applyBtn.textContent = 'Apply';
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'crop-action-btn crop-cancel';
      cancelBtn.textContent = 'Cancel';
      actions.appendChild(applyBtn);
      actions.appendChild(cancelBtn);
      region.appendChild(actions);
      actions.querySelector('.crop-apply').addEventListener('click', applyCrop);
      actions.querySelector('.crop-cancel').addEventListener('click', cancelCrop);
    }
  }

  function setupCropEvents() {
    const overlay = document.getElementById('cropOverlay');
    const region = document.getElementById('cropRegion');
    let dragType = null, startRect = null, startX = 0, startY = 0;

    region.addEventListener('mousedown', (e) => {
      if (!cropMode) return; e.stopPropagation();
      cropDragging = true; startX = e.clientX; startY = e.clientY; startRect = { ...cropRect };
      dragType = e.target.classList.contains('crop-handle') ? e.target.dataset.handle : 'move';
    });
    overlay.addEventListener('mousedown', (e) => {
      if (!cropMode || e.target !== overlay) return;
      const r = overlay.getBoundingClientRect();
      cropRect = { x: e.clientX - r.left, y: e.clientY - r.top, width: 0, height: 0 };
      cropDragging = true; startX = e.clientX; startY = e.clientY; dragType = 'draw';
    });
    document.addEventListener('mousemove', (e) => {
      if (!cropDragging || !cropMode) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (dragType === 'draw') {
        const r = overlay.getBoundingClientRect();
        cropRect = { x: Math.min(startX - r.left, e.clientX - r.left), y: Math.min(startY - r.top, e.clientY - r.top), width: Math.abs(dx), height: Math.abs(dy) };
      } else if (dragType === 'move') {
        cropRect.x = startRect.x + dx; cropRect.y = startRect.y + dy;
      } else {
        const r = { ...startRect };
        if (dragType.includes('e')) r.width += dx;
        if (dragType.includes('w')) { r.x += dx; r.width -= dx; }
        if (dragType.includes('s')) r.height += dy;
        if (dragType.includes('n')) { r.y += dy; r.height -= dy; }
        cropRect = r;
      }
      cropRect.width = Math.max(20, cropRect.width); cropRect.height = Math.max(20, cropRect.height);
      updateCropDisplay();
    });
    document.addEventListener('mouseup', () => { cropDragging = false; });
  }

  function updateCropDisplay() {
    const r = document.getElementById('cropRegion');
    r.style.left = cropRect.x+'px'; r.style.top = cropRect.y+'px';
    r.style.width = cropRect.width+'px'; r.style.height = cropRect.height+'px';
  }

  function applyCrop() {
    if (!originalImage) return;
    const dw = parseFloat(annotCanvas.style.width), dh = parseFloat(annotCanvas.style.height);
    const cr = annotCanvas.getBoundingClientRect(), or = document.getElementById('cropOverlay').getBoundingClientRect();
    const offX = cr.left - or.left, offY = cr.top - or.top;
    const sx = Math.max(0, Math.round((cropRect.x - offX) * originalImage.width / dw));
    const sy = Math.max(0, Math.round((cropRect.y - offY) * originalImage.height / dh));
    const sw = Math.min(originalImage.width - sx, Math.round(cropRect.width * originalImage.width / dw));
    const sh = Math.min(originalImage.height - sy, Math.round(cropRect.height * originalImage.height / dh));
    if (sw < 1 || sh < 1) { cancelCrop(); return; }

    const merged = getMergedCanvas();
    const tc = document.createElement('canvas'); tc.width = sw; tc.height = sh;
    tc.getContext('2d').drawImage(merged, sx, sy, sw, sh, 0, 0, sw, sh);
    const ci = new Image();
    ci.onload = () => {
      originalImage = ci; annotationState = PageSnapAnnotations.createState();
      fitImageToContainer(); updateUndoRedo();
      document.getElementById('imageInfo').textContent = `${sw} x ${sh}px`;
      showToast('Cropped');
    };
    ci.src = tc.toDataURL('image/png');
    cancelCrop();
  }

  function cancelCrop() {
    cropMode = false;
    document.getElementById('cropOverlay').style.display = 'none';
    if (currentTool === 'crop') setTool('select');
  }

  // --- Rendering ---
  function redrawAnnotations() {
    annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
    const blurs = annotationState.annotations.filter(a => a.type === 'blur');
    const others = annotationState.annotations.filter(a => a.type !== 'blur');

    for (const ann of blurs) {
      annotCtx.save();
      try {
        const id = imageCtx.getImageData(Math.max(0,ann.x), Math.max(0,ann.y), Math.min(ann.width, imageCanvas.width-ann.x), Math.min(ann.height, imageCanvas.height-ann.y));
        const ps = Math.max(4, Math.round(ann.intensity || 10));
        for (let py=0; py<id.height; py+=ps) for (let px=0; px<id.width; px+=ps) {
          let r=0,g=0,b=0,c=0;
          for (let dy=0; dy<ps&&py+dy<id.height; dy++) for (let dx=0; dx<ps&&px+dx<id.width; dx++) {
            const i=((py+dy)*id.width+(px+dx))*4; r+=id.data[i]; g+=id.data[i+1]; b+=id.data[i+2]; c++;
          }
          r=Math.round(r/c); g=Math.round(g/c); b=Math.round(b/c);
          for (let dy=0; dy<ps&&py+dy<id.height; dy++) for (let dx=0; dx<ps&&px+dx<id.width; dx++) {
            const i=((py+dy)*id.width+(px+dx))*4; id.data[i]=r; id.data[i+1]=g; id.data[i+2]=b;
          }
        }
        annotCtx.putImageData(id, ann.x, ann.y);
      } catch(e) { annotCtx.fillStyle='rgba(128,128,128,0.8)'; annotCtx.fillRect(ann.x,ann.y,ann.width,ann.height); }
      annotCtx.restore();
    }

    for (const ann of others) {
      annotCtx.save();
      PageSnapAnnotations._renderAnnotation(annotCtx, ann, 1, ann.id === annotationState.selectedId);
      annotCtx.restore();
    }
  }

  function updateUndoRedo() {
    document.getElementById('undoBtn').disabled = annotationState.undoStack.length === 0;
    document.getElementById('redoBtn').disabled = annotationState.redoStack.length === 0;
  }

  // --- Export ---
  function setupExportButtons() {
    document.getElementById('pngBtn').addEventListener('click', () => exportImage('png'));
    document.getElementById('jpgBtn').addEventListener('click', () => exportImage('jpg'));
    document.getElementById('pdfBtn').addEventListener('click', () => exportImage('pdf'));
    document.getElementById('copyBtn').addEventListener('click', exportClipboard);
  }

  function getMergedCanvas() {
    const c = document.createElement('canvas');
    c.width = imageCanvas.width; c.height = imageCanvas.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(imageCanvas, 0, 0);
    ctx.drawImage(annotCanvas, 0, 0);
    return c;
  }

  async function exportImage(format) {
    // If it's a graphic, download that
    if (lastGeneratedOutput?.graphicDataUrl && currentOutputMode === 'graphic') {
      const fn = `pagesnap_graphic_${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}.png`;
      try {
        await chrome.runtime.sendMessage({ action: 'downloadImage', dataUrl: lastGeneratedOutput.graphicDataUrl, filename: fn });
      } catch(e) { downloadViaLink(lastGeneratedOutput.graphicDataUrl, fn); }
      showToast('Graphic saved');
      return;
    }

    if (!hasScreenshot) { showToast('No screenshot to export'); return; }
    const merged = getMergedCanvas();
    let dataUrl;
    if (format === 'jpg') {
      const c2 = document.createElement('canvas'); c2.width = merged.width; c2.height = merged.height;
      const ctx = c2.getContext('2d'); ctx.fillStyle = '#FFF'; ctx.fillRect(0,0,c2.width,c2.height);
      ctx.drawImage(merged, 0, 0);
      dataUrl = c2.toDataURL('image/jpeg', 0.85);
    } else {
      dataUrl = merged.toDataURL('image/png');
    }
    const ext = format === 'pdf' ? 'png' : format;
    const fn = `pagesnap_${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}.${ext}`;
    try {
      await chrome.runtime.sendMessage({ action: 'downloadImage', dataUrl, filename: fn });
    } catch(e) { downloadViaLink(dataUrl, fn); }
    showToast(`${format.toUpperCase()} saved`);
  }

  async function exportClipboard() {
    if (lastGeneratedOutput?.graphicDataUrl && currentOutputMode === 'graphic') {
      try {
        const r = await fetch(lastGeneratedOutput.graphicDataUrl);
        const blob = await r.blob();
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showToast('Graphic copied'); return;
      } catch(e) {}
    }
    if (!hasScreenshot) {
      if (lastGeneratedOutput) { copyOutputToClipboard(); return; }
      showToast('Nothing to copy'); return;
    }
    const merged = getMergedCanvas();
    try {
      const blob = await new Promise(r => merged.toBlob(r, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      showToast('Copied to clipboard');
    } catch(e) { showToast('Copy failed'); }
  }

  function downloadViaLink(dataUrl, fn) {
    const a = document.createElement('a'); a.href = dataUrl; a.download = fn; a.click();
  }

  // --- Keyboard Shortcuts ---
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      const ti = document.getElementById('textInput');
      if (ti.style.display !== 'none') return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); if (PageSnapAnnotations.undo(annotationState)) { redrawAnnotations(); updateUndoRedo(); } return; }
      if (ctrl && (e.key === 'Z' || (e.key === 'z' && e.shiftKey) || e.key === 'y')) { e.preventDefault(); if (PageSnapAnnotations.redo(annotationState)) { redrawAnnotations(); updateUndoRedo(); } return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && annotationState.selectedId) { e.preventDefault(); PageSnapAnnotations.removeAnnotation(annotationState, annotationState.selectedId); redrawAnnotations(); updateUndoRedo(); return; }

      switch (e.key.toLowerCase()) {
        case 'v': setTool('select'); break;
        case 'c': if (!ctrl) setTool('crop'); break;
        case 'a': setTool('arrow'); break;
        case 'r': setTool('rectangle'); break;
        case 't': setTool('text'); break;
        case 'h': setTool('highlight'); break;
        case 'b': setTool('blur'); break;
        case 'd': setTool('freehand'); break;
        case 'escape': if (cropMode) cancelCrop(); else closeEditor(); break;
      }
    });
  }

  function closeEditor() { window.parent.postMessage({ type: 'pagesnap-editor-close' }, EXTENSION_ORIGIN); }

  function showToast(msg) {
    document.querySelector('.editor-toast')?.remove();
    const t = document.createElement('div'); t.className = 'editor-toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2000);
  }

  function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
