/**
 * PageSnap v3 - Editor
 * Screenshot annotation + AI content generation panel.
 * Zoom/pan, paintbrush, eraser, streaming AI, voice/tone.
 */

(function() {
  // --- State ---
  let imageCanvas, imageCtx, annotCanvas, annotCtx, container;
  let originalImage = null;
  let currentTool = 'select';
  let currentColor = '#FF0000';
  let currentLineWidth = 2;
  let currentFontSize = 16;
  let currentOpacity = 1;
  let annotationState = null;
  let pageContent = null;
  let pageUrl = '', pageTitle = '';
  let isDrawing = false, drawStartX = 0, drawStartY = 0;
  let canvasScale = 1;
  let cropMode = false, cropRect = {}, cropDragging = false;
  let freehandPoints = [];
  let currentOutputMode = 'quickquote';
  let currentVoice = 'straight-shooter';
  let lastGeneratedOutput = null;
  let hasScreenshot = false;

  // Zoom/pan state
  let zoomLevel = 1; // 1 = fit-to-view
  let panX = 0, panY = 0;
  let isPanning = false, panStartX = 0, panStartY = 0, panStartPanX = 0, panStartPanY = 0;
  let spacePressed = false;
  let baseScale = 1; // the fit-to-view scale

  const EDITOR_NONCE = location.hash ? location.hash.slice(1) : '';

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
    setupZoomControls();
    loadVoiceSetting();

    window.addEventListener('message', (e) => {
      if (e.data?.nonce !== EDITOR_NONCE) return;
      if (e.data?.type === 'pagesnap-load') {
        if (e.data.screenshot) {
          loadImage(e.data.screenshot);
        } else {
          hasScreenshot = false;
          document.getElementById('noScreenshot').style.display = 'block';
          document.getElementById('annotationTools').style.visibility = 'hidden';
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
          if (pageContent) setTimeout(() => generateContent(), 300);
        }
      }
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
    baseScale = Math.min((rect.width - pad * 2) / originalImage.width, (rect.height - pad * 2) / originalImage.height, 1);

    imageCanvas.width = originalImage.width;
    imageCanvas.height = originalImage.height;
    annotCanvas.width = originalImage.width;
    annotCanvas.height = originalImage.height;

    applyZoom();
    imageCtx.drawImage(originalImage, 0, 0);
    redrawAnnotations();
  }

  function applyZoom() {
    if (!originalImage) return;
    canvasScale = baseScale * zoomLevel;
    const dw = Math.round(originalImage.width * canvasScale);
    const dh = Math.round(originalImage.height * canvasScale);

    const style = `width:${dw}px;height:${dh}px;transform:translate(${panX}px,${panY}px);`;
    imageCanvas.style.cssText = style;
    annotCanvas.style.cssText = style;

    updateZoomDisplay();
  }

  // --- Zoom Controls ---
  function setupZoomControls() {
    document.getElementById('zoomIn')?.addEventListener('click', () => setZoom(zoomLevel * 1.25));
    document.getElementById('zoomOut')?.addEventListener('click', () => setZoom(zoomLevel / 1.25));
    document.getElementById('zoomFit')?.addEventListener('click', () => { zoomLevel = 1; panX = 0; panY = 0; applyZoom(); });

    // Scroll wheel zoom
    container.addEventListener('wheel', (e) => {
      if (!hasScreenshot) return;
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      setZoom(zoomLevel * delta);
    }, { passive: false });
  }

  function setZoom(level) {
    zoomLevel = Math.max(0.1, Math.min(10, level));
    applyZoom();
  }

  function updateZoomDisplay() {
    const el = document.getElementById('zoomLevel');
    if (el) el.textContent = Math.round(zoomLevel * 100) + '%';
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

    const fullText = content.content?.text;
    if (fullText && fullText.length > 100) {
      const toggleWrap = document.getElementById('contentFullTextToggle');
      const textEl = document.getElementById('contentFullText');
      const toggleBtn = document.getElementById('toggleFullText');
      const copyBtn = document.getElementById('copyFullText');
      toggleWrap.style.display = 'flex';
      textEl.textContent = fullText;

      toggleBtn.addEventListener('click', () => {
        const visible = textEl.style.display !== 'none';
        textEl.style.display = visible ? 'none' : 'block';
        toggleBtn.textContent = visible ? 'Show Full Text' : 'Hide Full Text';
      });

      copyBtn.addEventListener('click', async () => {
        try {
          const copyText = (content.title ? content.title + '\n\n' : '') + fullText;
          await navigator.clipboard.writeText(copyText);
          showToast('Text copied to clipboard');
        } catch (e) { showToast('Copy failed'); }
      });
    }
  }

  // --- Output Modes ---
  function setupOutputModes() {
    document.querySelectorAll('.output-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => setOutputMode(btn.dataset.mode));
    });
    document.getElementById('generateBtn').addEventListener('click', generateContent);
    document.getElementById('copyOutput').addEventListener('click', copyOutputToClipboard);
    document.getElementById('copyCloseOutput').addEventListener('click', async () => {
      await copyOutputToClipboard();
      setTimeout(closeEditor, 300);
    });
    document.getElementById('saveOutput').addEventListener('click', saveOutputToLibrary);

    // Voice selector
    const voiceSelect = document.getElementById('voiceSelect');
    if (voiceSelect) {
      voiceSelect.addEventListener('change', (e) => {
        currentVoice = e.target.value;
        chrome.runtime.sendMessage({ action: 'updateSettings', settings: { voice: currentVoice } });
      });
    }
  }

  async function loadVoiceSetting() {
    try {
      const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
      if (response?.settings?.voice) {
        currentVoice = response.settings.voice;
        const voiceSelect = document.getElementById('voiceSelect');
        if (voiceSelect) voiceSelect.value = currentVoice;
      }
    } catch (e) { /* use default */ }
  }

  function setOutputMode(mode) {
    currentOutputMode = mode;
    document.querySelectorAll('.output-mode-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.output-mode-btn[data-mode="${mode}"]`)?.classList.add('active');

    const graphicPreview = document.getElementById('graphicPreview');
    const aiOutput = document.getElementById('aiOutput');
    if (mode === 'graphic') {
      graphicPreview.style.display = 'flex';
      aiOutput.style.display = 'none';
      if (pageContent && !document.getElementById('graphicQuote').value) {
        document.getElementById('graphicQuote').value = pageContent.excerpt || pageContent.title || '';
      }
    } else {
      graphicPreview.style.display = 'none';
      aiOutput.style.display = 'block';
    }
  }

  async function generateContent() {
    if (!pageContent) { showToast('No content extracted. Capture a page first.'); return; }
    if (currentOutputMode === 'graphic') { generateGraphic(); return; }

    const btn = document.getElementById('generateBtn');
    const output = document.getElementById('aiOutput');
    const actions = document.getElementById('outputActions');

    btn.disabled = true;
    btn.textContent = 'Generating...';
    output.textContent = '';

    // Streaming: show text as it arrives
    let streamedText = '';
    const streamContainer = document.createElement('div');
    streamContainer.className = 'streaming-output';
    output.appendChild(streamContainer);

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

  // --- Safe DOM rendering helpers ---

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
      const keyForm = document.createElement('div');
      keyForm.style.cssText = 'margin-top:12px;display:flex;gap:8px;align-items:center;';
      const keyInput = document.createElement('input');
      keyInput.type = 'password';
      keyInput.placeholder = 'Paste your Claude API key here...';
      keyInput.style.cssText = 'flex:1;padding:8px 12px;border:1px solid var(--border);border-radius:6px;background:var(--bg-secondary);color:var(--text);font-size:12px;';
      const saveBtn = document.createElement('button');
      saveBtn.textContent = 'Save & Generate';
      saveBtn.style.cssText = 'padding:8px 16px;background:var(--accent);color:white;border:none;border-radius:6px;font-size:12px;cursor:pointer;white-space:nowrap;';
      saveBtn.addEventListener('click', async () => {
        const key = keyInput.value.trim();
        if (!key) return;
        saveBtn.disabled = true;
        saveBtn.textContent = 'Saving...';
        await chrome.runtime.sendMessage({ action: 'updateSettings', settings: { apiKey: key } });
        showToast('API key saved');
        generateContent();
      });
      keyForm.appendChild(keyInput);
      keyForm.appendChild(saveBtn);
      container.appendChild(keyForm);
      const hint = document.createElement('div');
      hint.style.cssText = 'margin-top:6px;font-size:11px;color:var(--text-muted);';
      hint.textContent = 'Your key is stored locally and never sent anywhere except the Claude API.';
      container.appendChild(hint);
    }
  }

  function renderFormattedOutput(container, text) {
    container.textContent = '';
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) { container.appendChild(document.createElement('br')); continue; }

      const h3Match = trimmed.match(/^###\s+(.+)$/);
      if (h3Match) { const el = document.createElement('h4'); el.style.cssText = 'margin:8px 0 4px;font-size:13px;'; el.textContent = h3Match[1]; container.appendChild(el); continue; }
      const h2Match = trimmed.match(/^##\s+(.+)$/);
      if (h2Match) { const el = document.createElement('h3'); el.style.cssText = 'margin:10px 0 4px;font-size:14px;'; el.textContent = h2Match[1]; container.appendChild(el); continue; }
      const h1Match = trimmed.match(/^#\s+(.+)$/);
      if (h1Match) { const el = document.createElement('h2'); el.style.cssText = 'margin:12px 0 6px;font-size:15px;'; el.textContent = h1Match[1]; container.appendChild(el); continue; }

      const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
      if (bulletMatch) { const el = document.createElement('div'); el.style.paddingLeft = '12px'; el.textContent = '\u2022 ' + bulletMatch[1]; container.appendChild(el); continue; }

      const numMatch = trimmed.match(/^(\d+)[./]\s+(.+)$/);
      if (numMatch) { const el = document.createElement('div'); el.style.paddingLeft = '12px'; el.textContent = numMatch[1] + '. ' + numMatch[2]; container.appendChild(el); continue; }

      const span = document.createElement('span');
      renderInlineMarkdown(span, trimmed);
      container.appendChild(span);
      container.appendChild(document.createElement('br'));
    }
  }

  function renderInlineMarkdown(parent, text) {
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
    } catch (e) { showToast('Copy failed'); }
  }

  async function saveOutputToLibrary() {
    if (!lastGeneratedOutput || !pageContent) return;
    try {
      const response = await chrome.runtime.sendMessage({ action: 'swipefileGetAll' });
      const items = response?.items || [];
      const match = items.find(i => i.url === pageContent.url);
      if (match) {
        await chrome.runtime.sendMessage({ action: 'swipefileAddOutput', id: match.id, output: lastGeneratedOutput });
      }
      showToast('Saved to library');
    } catch (e) { showToast('Save failed'); }
  }

  // --- Social Graphics ---
  function setupGraphicControls() {
    document.getElementById('generateGraphic').addEventListener('click', generateGraphic);
    document.getElementById('graphicStyle').addEventListener('change', generateGraphic);
    document.getElementById('graphicRatio').addEventListener('change', generateGraphic);
  }

  function generateGraphic() {
    const quote = document.getElementById('graphicQuote').value.trim();
    if (!quote) { showToast('Enter a quote for the graphic'); return; }

    const style = document.getElementById('graphicStyle').value;
    const ratioId = document.getElementById('graphicRatio').value;
    const ratios = { '16:9': [1200, 675], '1:1': [1080, 1080], '4:5': [1080, 1350], '9:16': [1080, 1920] };
    const [w, h] = ratios[ratioId] || [1200, 675];

    const options = {
      quote,
      source: pageContent?.url || pageUrl,
      author: pageContent?.author || '',
      title: pageContent?.title || pageTitle,
      style,
      width: w,
      height: h
    };

    // If we have a screenshot, pass a thumbnail for background
    if (hasScreenshot && originalImage) {
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = w;
      thumbCanvas.height = h;
      const tCtx = thumbCanvas.getContext('2d');
      tCtx.drawImage(originalImage, 0, 0, w, h);
      options.backgroundImage = thumbCanvas;
    }

    const dataUrl = PageSnapGraphics.generate(options);
    const wrap = document.getElementById('graphicCanvasWrap');
    wrap.textContent = '';
    const img = document.createElement('img');
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) img.src = dataUrl;
    img.alt = 'Generated graphic';
    wrap.appendChild(img);

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

    if (tool === 'pan') annotCanvas.style.cursor = 'grab';
    else if (tool === 'text') annotCanvas.style.cursor = 'text';
    else if (tool === 'select') annotCanvas.style.cursor = 'default';
    else if (tool === 'eraser') annotCanvas.style.cursor = 'crosshair';
    else annotCanvas.style.cursor = 'crosshair';

    updateToolOptions();
    if (tool === 'crop') enterCropMode();
    else if (cropMode) cancelCrop();
  }

  function updateToolOptions() {
    const drawTools = ['arrow', 'rectangle', 'highlight', 'blur', 'freehand', 'text', 'marker', 'eraser'];
    const hasColor = drawTools.includes(currentTool) && currentTool !== 'eraser' && currentTool !== 'blur';
    const hasWidth = ['arrow', 'rectangle', 'freehand', 'marker', 'eraser'].includes(currentTool);
    const hasFont = currentTool === 'text';
    const hasOpacity = ['highlight', 'marker'].includes(currentTool);
    document.getElementById('colorPicker').style.display = hasColor ? 'flex' : 'none';
    document.getElementById('lineWidthGroup').style.display = hasWidth ? 'flex' : 'none';
    document.getElementById('fontSizeGroup').style.display = hasFont ? 'flex' : 'none';
    const opGroup = document.getElementById('opacityGroup');
    if (opGroup) opGroup.style.display = hasOpacity ? 'flex' : 'none';
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
    // Opacity slider
    const opSlider = document.getElementById('opacitySlider');
    if (opSlider) {
      opSlider.addEventListener('input', (e) => {
        currentOpacity = parseInt(e.target.value) / 100;
        document.getElementById('opacityValue').textContent = e.target.value + '%';
      });
    }
    // Line width presets
    document.querySelectorAll('.width-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        currentLineWidth = parseInt(btn.dataset.width);
        document.getElementById('lineWidth').value = currentLineWidth;
        document.getElementById('lineWidthValue').textContent = currentLineWidth;
        document.querySelectorAll('.width-preset').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });
  }

  // --- Canvas Events ---
  function setupCanvasEvents() {
    annotCanvas.addEventListener('mousedown', onDown);
    annotCanvas.addEventListener('mousemove', onMove);
    annotCanvas.addEventListener('mouseup', onUp);
    // Middle click pan
    annotCanvas.addEventListener('mousedown', (e) => {
      if (e.button === 1) { e.preventDefault(); startPan(e); }
    });
    window.addEventListener('resize', () => fitImageToContainer());
  }

  function startPan(e) {
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    panStartPanX = panX;
    panStartPanY = panY;
    annotCanvas.style.cursor = 'grabbing';

    const onPanMove = (e) => {
      panX = panStartPanX + (e.clientX - panStartX);
      panY = panStartPanY + (e.clientY - panStartY);
      applyZoom();
    };
    const onPanUp = () => {
      isPanning = false;
      annotCanvas.style.cursor = currentTool === 'pan' ? 'grab' : 'default';
      document.removeEventListener('mousemove', onPanMove);
      document.removeEventListener('mouseup', onPanUp);
    };
    document.addEventListener('mousemove', onPanMove);
    document.addEventListener('mouseup', onPanUp);
  }

  function getCoords(e) {
    const r = annotCanvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * annotCanvas.width / r.width, y: (e.clientY - r.top) * annotCanvas.height / r.height };
  }

  function onDown(e) {
    if (e.button === 1) return; // middle click handled separately
    if (cropMode) return;

    // Space+drag = pan
    if (spacePressed || currentTool === 'pan') { startPan(e); return; }

    const { x, y } = getCoords(e);
    isDrawing = true; drawStartX = x; drawStartY = y;

    if (currentTool === 'select') {
      const hit = PageSnapAnnotations.hitTest(annotationState, x, y);
      annotationState.selectedId = hit ? hit.id : null;
      redrawAnnotations();
      if (hit) isDrawing = false;
      return;
    }
    if (currentTool === 'eraser') {
      // Erase any annotation under cursor
      const hit = PageSnapAnnotations.hitTest(annotationState, x, y);
      if (hit) {
        PageSnapAnnotations.removeAnnotation(annotationState, hit.id);
        redrawAnnotations();
        updateUndoRedo();
      }
      isDrawing = false;
      return;
    }
    if (currentTool === 'text') {
      isDrawing = false;
      showTextInput(e.clientX, e.clientY, x, y);
      return;
    }
    if (currentTool === 'freehand' || currentTool === 'marker') freehandPoints = [{ x, y }];
  }

  function onMove(e) {
    if (!isDrawing || cropMode || isPanning) return;
    const { x, y } = getCoords(e);

    if (currentTool === 'freehand' || currentTool === 'marker') {
      freehandPoints.push({ x, y });
      redrawAnnotations();
      annotCtx.save();
      if (currentTool === 'marker') {
        annotCtx.globalAlpha = currentOpacity;
        annotCtx.strokeStyle = currentColor;
        annotCtx.lineWidth = Math.max(currentLineWidth * 3, 12);
      } else {
        annotCtx.strokeStyle = currentColor;
        annotCtx.lineWidth = currentLineWidth;
      }
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
    if (currentTool === 'marker') {
      if (freehandPoints.length > 2) {
        PageSnapAnnotations.addAnnotation(annotationState, { type: 'marker', points: [...freehandPoints], color: currentColor, lineWidth: Math.max(currentLineWidth * 3, 12), opacity: currentOpacity });
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
        ctx.globalAlpha = currentOpacity || 0.35; ctx.fillStyle = currentColor;
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
      case 'highlight': return { type: 'highlight', x: Math.min(x1,x2), y: Math.min(y1,y2), width: Math.abs(x2-x1), height: Math.abs(y2-y1), color: currentColor, opacity: currentOpacity || 0.35 };
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
      zoomLevel = 1; panX = 0; panY = 0;
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
    if (lastGeneratedOutput?.graphicDataUrl && currentOutputMode === 'graphic') {
      const fn = `pagesnap_graphic_${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}.png`;
      try { await chrome.runtime.sendMessage({ action: 'downloadImage', dataUrl: lastGeneratedOutput.graphicDataUrl, filename: fn }); }
      catch(e) { downloadViaLink(lastGeneratedOutput.graphicDataUrl, fn); }
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
    try { await chrome.runtime.sendMessage({ action: 'downloadImage', dataUrl, filename: fn }); }
    catch(e) { downloadViaLink(dataUrl, fn); }
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
      if (e.key === ' ') { spacePressed = true; e.preventDefault(); return; }

      const ti = document.getElementById('textInput');
      if (ti.style.display !== 'none') return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === 'z' && !e.shiftKey) { e.preventDefault(); if (PageSnapAnnotations.undo(annotationState)) { redrawAnnotations(); updateUndoRedo(); } return; }
      if (ctrl && (e.key === 'Z' || (e.key === 'z' && e.shiftKey) || e.key === 'y')) { e.preventDefault(); if (PageSnapAnnotations.redo(annotationState)) { redrawAnnotations(); updateUndoRedo(); } return; }
      if ((e.key === 'Delete' || e.key === 'Backspace') && annotationState.selectedId) { e.preventDefault(); PageSnapAnnotations.removeAnnotation(annotationState, annotationState.selectedId); redrawAnnotations(); updateUndoRedo(); return; }

      // Zoom shortcuts
      if (ctrl && (e.key === '=' || e.key === '+')) { e.preventDefault(); setZoom(zoomLevel * 1.25); return; }
      if (ctrl && e.key === '-') { e.preventDefault(); setZoom(zoomLevel / 1.25); return; }
      if (ctrl && e.key === '0') { e.preventDefault(); zoomLevel = 1; panX = 0; panY = 0; applyZoom(); return; }

      switch (e.key.toLowerCase()) {
        case 'v': setTool('select'); break;
        case 'c': if (!ctrl) setTool('crop'); break;
        case 'a': setTool('arrow'); break;
        case 'r': setTool('rectangle'); break;
        case 't': setTool('text'); break;
        case 'h': setTool('highlight'); break;
        case 'b': setTool('blur'); break;
        case 'd': setTool('freehand'); break;
        case 'm': setTool('marker'); break;
        case 'e': setTool('eraser'); break;
        case 'p': setTool('pan'); break;
        case 'escape': if (cropMode) cancelCrop(); else closeEditor(); break;
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.key === ' ') spacePressed = false;
    });
  }

  function closeEditor() {
    window.parent.postMessage({ type: 'pagesnap-editor-close', nonce: EDITOR_NONCE }, '*');
  }

  function showToast(msg) {
    document.querySelector('.editor-toast')?.remove();
    const t = document.createElement('div'); t.className = 'editor-toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 300); }, 2000);
  }

  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
