/**
 * PageSnap - Editor
 * Canvas-based annotation editor with crop, draw, and export tools.
 */

(function() {
  // --- State ---
  let imageCanvas, imageCtx;
  let annotCanvas, annotCtx;
  let container;
  let originalImage = null;
  let currentTool = 'select';
  let currentColor = '#FF0000';
  let currentLineWidth = 2;
  let currentFontSize = 16;
  let currentOpacity = 0.3;
  let currentFilled = false;
  let annotationState = null;
  let pageUrl = '';
  let pageTitle = '';

  // Drawing state
  let isDrawing = false;
  let drawStartX = 0, drawStartY = 0;
  let canvasScale = 1;
  let canvasOffsetX = 0, canvasOffsetY = 0;

  // Crop state
  let cropMode = false;
  let cropRect = { x: 0, y: 0, width: 0, height: 0 };
  let cropDragging = false;
  let cropHandle = null;
  let cropDragStartX = 0, cropDragStartY = 0;

  // Text state
  let textInput = null;
  let pendingTextAnnotation = null;

  // Freehand points
  let freehandPoints = [];

  // --- Initialization ---
  function init() {
    imageCanvas = document.getElementById('imageCanvas');
    annotCanvas = document.getElementById('annotationCanvas');
    imageCtx = imageCanvas.getContext('2d');
    annotCtx = annotCanvas.getContext('2d');
    container = document.getElementById('canvasContainer');
    textInput = document.getElementById('textInput');

    annotationState = PageSnapAnnotations.createState();

    setupToolbar();
    setupToolOptions();
    setupExportButtons();
    setupCanvasEvents();
    setupKeyboardShortcuts();
    setupCropEvents();

    // Listen for image from content script
    window.addEventListener('message', (event) => {
      if (event.data && event.data.type === 'pagesnap-load-image') {
        loadImage(event.data.dataUrl);
        pageUrl = event.data.pageUrl || '';
        pageTitle = event.data.pageTitle || '';
      }
    });
  }

  // --- Image Loading ---
  function loadImage(dataUrl) {
    const img = new Image();
    img.onload = () => {
      originalImage = img;

      // Fit image into container
      fitImageToContainer();

      // Update info
      document.getElementById('imageInfo').textContent =
        `${img.width} x ${img.height}px`;
    };
    img.src = dataUrl;
  }

  function fitImageToContainer() {
    if (!originalImage) return;

    const containerRect = container.getBoundingClientRect();
    const padding = 40;
    const availW = containerRect.width - padding * 2;
    const availH = containerRect.height - padding * 2;

    canvasScale = Math.min(
      availW / originalImage.width,
      availH / originalImage.height,
      1 // Don't upscale
    );

    const displayW = Math.round(originalImage.width * canvasScale);
    const displayH = Math.round(originalImage.height * canvasScale);

    // Set both canvases
    imageCanvas.width = originalImage.width;
    imageCanvas.height = originalImage.height;
    imageCanvas.style.width = displayW + 'px';
    imageCanvas.style.height = displayH + 'px';

    annotCanvas.width = originalImage.width;
    annotCanvas.height = originalImage.height;
    annotCanvas.style.width = displayW + 'px';
    annotCanvas.style.height = displayH + 'px';

    // Draw image
    imageCtx.drawImage(originalImage, 0, 0);

    // Redraw annotations
    redrawAnnotations();
  }

  // --- Toolbar ---
  function setupToolbar() {
    const toolBtns = document.querySelectorAll('.tool-btn[data-tool]');
    toolBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (cropMode && btn.dataset.tool !== 'crop') {
          cancelCrop();
        }
        setTool(btn.dataset.tool);
      });
    });

    document.getElementById('undoBtn').addEventListener('click', () => {
      if (PageSnapAnnotations.undo(annotationState)) {
        redrawAnnotations();
        updateUndoRedoButtons();
      }
    });

    document.getElementById('redoBtn').addEventListener('click', () => {
      if (PageSnapAnnotations.redo(annotationState)) {
        redrawAnnotations();
        updateUndoRedoButtons();
      }
    });

    document.getElementById('closeBtn').addEventListener('click', closeEditor);
  }

  function setTool(tool) {
    currentTool = tool;

    // Update active button
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
    const activeBtn = document.querySelector(`.tool-btn[data-tool="${tool}"]`);
    if (activeBtn) activeBtn.classList.add('active');

    // Deselect any selected annotation
    annotationState.selectedId = null;
    redrawAnnotations();

    // Update cursor
    updateCursor();

    // Show/hide relevant tool options
    updateToolOptions();

    // Handle crop mode
    if (tool === 'crop') {
      enterCropMode();
    } else if (cropMode) {
      cancelCrop();
    }
  }

  function updateCursor() {
    const cursors = {
      select: 'default',
      crop: 'crosshair',
      arrow: 'crosshair',
      line: 'crosshair',
      rectangle: 'crosshair',
      text: 'text',
      highlight: 'crosshair',
      blur: 'crosshair',
      freehand: 'crosshair'
    };
    annotCanvas.style.cursor = cursors[currentTool] || 'default';
  }

  function updateToolOptions() {
    const colorPicker = document.getElementById('colorPicker');
    const lineWidthGroup = document.getElementById('lineWidthGroup');
    const fontSizeGroup = document.getElementById('fontSizeGroup');
    const opacityGroup = document.getElementById('opacityGroup');
    const filledGroup = document.getElementById('filledGroup');

    const drawTools = ['arrow', 'line', 'rectangle', 'highlight', 'blur', 'freehand', 'text'];
    const hasColor = drawTools.includes(currentTool);
    const hasWidth = ['arrow', 'line', 'rectangle', 'freehand'].includes(currentTool);
    const hasFont = currentTool === 'text';
    const hasOpacity = ['highlight', 'rectangle'].includes(currentTool);
    const hasFilled = currentTool === 'rectangle';

    colorPicker.style.display = hasColor ? 'flex' : 'none';
    lineWidthGroup.style.display = hasWidth ? 'flex' : 'none';
    fontSizeGroup.style.display = hasFont ? 'flex' : 'none';
    opacityGroup.style.display = hasOpacity ? 'flex' : 'none';
    filledGroup.style.display = hasFilled ? 'flex' : 'none';
  }

  function setupToolOptions() {
    // Color swatches
    document.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        currentColor = swatch.dataset.color;
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
        swatch.classList.add('active');
        document.getElementById('customColor').value = currentColor;
      });
    });

    // Custom color
    document.getElementById('customColor').addEventListener('input', (e) => {
      currentColor = e.target.value;
      document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('active'));
    });

    // Line width
    const lineWidth = document.getElementById('lineWidth');
    lineWidth.addEventListener('input', () => {
      currentLineWidth = parseInt(lineWidth.value);
      document.getElementById('lineWidthValue').textContent = currentLineWidth;
    });

    // Font size
    const fontSize = document.getElementById('fontSize');
    fontSize.addEventListener('input', () => {
      currentFontSize = parseInt(fontSize.value);
      document.getElementById('fontSizeValue').textContent = currentFontSize;
    });

    // Opacity
    const opacity = document.getElementById('opacity');
    opacity.addEventListener('input', () => {
      currentOpacity = parseInt(opacity.value) / 100;
      document.getElementById('opacityValue').textContent = opacity.value + '%';
    });

    // Filled
    document.getElementById('filledCheck').addEventListener('change', (e) => {
      currentFilled = e.target.checked;
    });
  }

  // --- Canvas Events ---
  function setupCanvasEvents() {
    annotCanvas.addEventListener('mousedown', onCanvasMouseDown);
    annotCanvas.addEventListener('mousemove', onCanvasMouseMove);
    annotCanvas.addEventListener('mouseup', onCanvasMouseUp);
    annotCanvas.addEventListener('dblclick', onCanvasDoubleClick);

    // Handle window resize
    window.addEventListener('resize', () => {
      fitImageToContainer();
    });
  }

  function getCanvasCoords(e) {
    const rect = annotCanvas.getBoundingClientRect();
    const scaleX = annotCanvas.width / rect.width;
    const scaleY = annotCanvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  }

  function onCanvasMouseDown(e) {
    if (cropMode) return;

    const { x, y } = getCanvasCoords(e);
    isDrawing = true;
    drawStartX = x;
    drawStartY = y;

    if (currentTool === 'select') {
      const hit = PageSnapAnnotations.hitTest(annotationState, x, y);
      annotationState.selectedId = hit ? hit.id : null;
      redrawAnnotations();
      if (hit) {
        isDrawing = false; // Don't start a new annotation
        // TODO: implement drag to move
      }
      return;
    }

    if (currentTool === 'text') {
      isDrawing = false;
      showTextInput(e.clientX, e.clientY, x, y);
      return;
    }

    if (currentTool === 'freehand') {
      freehandPoints = [{ x, y }];
    }
  }

  function onCanvasMouseMove(e) {
    if (!isDrawing || cropMode) return;

    const { x, y } = getCanvasCoords(e);

    if (currentTool === 'freehand') {
      freehandPoints.push({ x, y });
      // Preview freehand
      redrawAnnotations();
      annotCtx.save();
      annotCtx.strokeStyle = currentColor;
      annotCtx.lineWidth = currentLineWidth;
      annotCtx.lineCap = 'round';
      annotCtx.lineJoin = 'round';
      annotCtx.beginPath();
      annotCtx.moveTo(freehandPoints[0].x, freehandPoints[0].y);
      for (let i = 1; i < freehandPoints.length; i++) {
        annotCtx.lineTo(freehandPoints[i].x, freehandPoints[i].y);
      }
      annotCtx.stroke();
      annotCtx.restore();
      return;
    }

    // Preview current drawing
    redrawAnnotations();
    annotCtx.save();
    previewAnnotation(annotCtx, drawStartX, drawStartY, x, y);
    annotCtx.restore();
  }

  function onCanvasMouseUp(e) {
    if (!isDrawing || cropMode) return;
    isDrawing = false;

    const { x, y } = getCanvasCoords(e);

    if (currentTool === 'freehand') {
      if (freehandPoints.length > 2) {
        PageSnapAnnotations.addAnnotation(annotationState, {
          type: 'freehand',
          points: [...freehandPoints],
          color: currentColor,
          lineWidth: currentLineWidth
        });
      }
      freehandPoints = [];
      redrawAnnotations();
      updateUndoRedoButtons();
      return;
    }

    // Create the annotation
    const ann = createAnnotationFromDraw(drawStartX, drawStartY, x, y);
    if (ann) {
      PageSnapAnnotations.addAnnotation(annotationState, ann);
      redrawAnnotations();
      updateUndoRedoButtons();
    }
  }

  function onCanvasDoubleClick(e) {
    if (currentTool === 'select') {
      const { x, y } = getCanvasCoords(e);
      const hit = PageSnapAnnotations.hitTest(annotationState, x, y);
      if (hit && hit.type === 'text') {
        // Edit existing text
        // TODO: implement text editing
      }
    }
  }

  function previewAnnotation(ctx, x1, y1, x2, y2) {
    switch (currentTool) {
      case 'arrow':
        drawArrowPreview(ctx, x1, y1, x2, y2);
        break;
      case 'line':
        ctx.strokeStyle = currentColor;
        ctx.lineWidth = currentLineWidth;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();
        break;
      case 'rectangle':
        ctx.strokeStyle = currentColor;
        ctx.lineWidth = currentLineWidth;
        if (currentFilled) {
          ctx.globalAlpha = currentOpacity;
          ctx.fillStyle = currentColor;
          ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
          ctx.globalAlpha = 1;
        }
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        break;
      case 'highlight':
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = currentColor;
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        ctx.globalAlpha = 1;
        break;
      case 'blur':
        ctx.fillStyle = 'rgba(128, 128, 128, 0.4)';
        ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
        // Show dashed border
        ctx.strokeStyle = '#999';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.setLineDash([]);
        break;
    }
  }

  function drawArrowPreview(ctx, x1, y1, x2, y2) {
    ctx.strokeStyle = currentColor;
    ctx.fillStyle = currentColor;
    ctx.lineWidth = currentLineWidth;
    ctx.lineCap = 'round';

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = Math.max(10, currentLineWidth * 5);

    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.closePath();
    ctx.fill();
  }

  function createAnnotationFromDraw(x1, y1, x2, y2) {
    const minSize = 5;

    switch (currentTool) {
      case 'arrow':
        if (Math.abs(x2 - x1) < minSize && Math.abs(y2 - y1) < minSize) return null;
        return { type: 'arrow', x1, y1, x2, y2, color: currentColor, lineWidth: currentLineWidth };

      case 'line':
        if (Math.abs(x2 - x1) < minSize && Math.abs(y2 - y1) < minSize) return null;
        return { type: 'line', x1, y1, x2, y2, color: currentColor, lineWidth: currentLineWidth };

      case 'rectangle': {
        const rx = Math.min(x1, x2), ry = Math.min(y1, y2);
        const rw = Math.abs(x2 - x1), rh = Math.abs(y2 - y1);
        if (rw < minSize || rh < minSize) return null;
        return { type: 'rectangle', x: rx, y: ry, width: rw, height: rh, color: currentColor, lineWidth: currentLineWidth, filled: currentFilled, opacity: currentOpacity };
      }

      case 'highlight': {
        const hx = Math.min(x1, x2), hy = Math.min(y1, y2);
        const hw = Math.abs(x2 - x1), hh = Math.abs(y2 - y1);
        if (hw < minSize || hh < minSize) return null;
        return { type: 'highlight', x: hx, y: hy, width: hw, height: hh, color: currentColor };
      }

      case 'blur': {
        const bx = Math.min(x1, x2), by = Math.min(y1, y2);
        const bw = Math.abs(x2 - x1), bh = Math.abs(y2 - y1);
        if (bw < minSize || bh < minSize) return null;
        return { type: 'blur', x: bx, y: by, width: bw, height: bh, intensity: 10 };
      }

      default:
        return null;
    }
  }

  // --- Text Annotation ---
  function showTextInput(screenX, screenY, canvasX, canvasY) {
    textInput.style.display = 'block';
    textInput.style.left = screenX + 'px';
    textInput.style.top = screenY + 'px';
    textInput.style.fontSize = currentFontSize + 'px';
    textInput.style.color = currentColor;
    textInput.value = '';
    textInput.focus();

    pendingTextAnnotation = { x: canvasX, y: canvasY };

    // Commit on blur or Enter
    const commit = () => {
      const text = textInput.value.trim();
      if (text && pendingTextAnnotation) {
        // Measure text
        annotCtx.font = `${currentFontSize}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        const metrics = annotCtx.measureText(text);

        PageSnapAnnotations.addAnnotation(annotationState, {
          type: 'text',
          x: pendingTextAnnotation.x,
          y: pendingTextAnnotation.y,
          text: text,
          color: currentColor,
          fontSize: currentFontSize,
          backgroundColor: null,
          textWidth: metrics.width,
          textHeight: currentFontSize * 1.3
        });
        redrawAnnotations();
        updateUndoRedoButtons();
      }
      textInput.style.display = 'none';
      textInput.value = '';
      pendingTextAnnotation = null;
      textInput.removeEventListener('blur', commit);
      textInput.removeEventListener('keydown', onKey);
    };

    const onKey = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        commit();
      }
      if (e.key === 'Escape') {
        textInput.style.display = 'none';
        textInput.value = '';
        pendingTextAnnotation = null;
        textInput.removeEventListener('blur', commit);
        textInput.removeEventListener('keydown', onKey);
      }
    };

    textInput.addEventListener('blur', commit);
    textInput.addEventListener('keydown', onKey);
  }

  // --- Crop Mode ---
  function enterCropMode() {
    cropMode = true;
    const overlay = document.getElementById('cropOverlay');
    const region = document.getElementById('cropRegion');

    // Default crop to full image
    cropRect = {
      x: 10, y: 10,
      width: Math.round(annotCanvas.clientWidth - 20),
      height: Math.round(annotCanvas.clientHeight - 20)
    };

    updateCropRegionDisplay();
    overlay.style.display = 'block';

    // Add apply/cancel buttons
    let actions = region.querySelector('.crop-actions');
    if (!actions) {
      actions = document.createElement('div');
      actions.className = 'crop-actions';
      actions.innerHTML = `
        <button class="crop-action-btn crop-apply">Apply Crop</button>
        <button class="crop-action-btn crop-cancel">Cancel</button>
      `;
      region.appendChild(actions);

      actions.querySelector('.crop-apply').addEventListener('click', applyCrop);
      actions.querySelector('.crop-cancel').addEventListener('click', cancelCrop);
    }
  }

  function setupCropEvents() {
    const overlay = document.getElementById('cropOverlay');
    const region = document.getElementById('cropRegion');

    let dragType = null;
    let dragStartRect = null;

    overlay.addEventListener('mousedown', (e) => {
      if (!cropMode) return;
      if (e.target === overlay) {
        // Clicked outside region - start drawing new region
        const rect = overlay.getBoundingClientRect();
        cropRect.x = e.clientX - rect.left;
        cropRect.y = e.clientY - rect.top;
        cropRect.width = 0;
        cropRect.height = 0;
        cropDragging = true;
        cropDragStartX = e.clientX;
        cropDragStartY = e.clientY;
        dragType = 'draw';
      }
    });

    region.addEventListener('mousedown', (e) => {
      if (!cropMode) return;
      e.stopPropagation();

      cropDragging = true;
      cropDragStartX = e.clientX;
      cropDragStartY = e.clientY;
      dragStartRect = { ...cropRect };

      if (e.target.classList.contains('crop-handle')) {
        dragType = e.target.dataset.handle;
      } else {
        dragType = 'move';
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (!cropDragging || !cropMode) return;

      const dx = e.clientX - cropDragStartX;
      const dy = e.clientY - cropDragStartY;
      const overlayRect = overlay.getBoundingClientRect();

      if (dragType === 'draw') {
        const startX = cropDragStartX - overlayRect.left;
        const startY = cropDragStartY - overlayRect.top;
        cropRect.x = Math.min(startX, e.clientX - overlayRect.left);
        cropRect.y = Math.min(startY, e.clientY - overlayRect.top);
        cropRect.width = Math.abs(e.clientX - cropDragStartX);
        cropRect.height = Math.abs(e.clientY - cropDragStartY);
      } else if (dragType === 'move') {
        cropRect.x = dragStartRect.x + dx;
        cropRect.y = dragStartRect.y + dy;
      } else {
        // Handle resize
        const r = { ...dragStartRect };
        switch (dragType) {
          case 'se': r.width += dx; r.height += dy; break;
          case 'sw': r.x += dx; r.width -= dx; r.height += dy; break;
          case 'ne': r.width += dx; r.y += dy; r.height -= dy; break;
          case 'nw': r.x += dx; r.y += dy; r.width -= dx; r.height -= dy; break;
          case 'n': r.y += dy; r.height -= dy; break;
          case 's': r.height += dy; break;
          case 'e': r.width += dx; break;
          case 'w': r.x += dx; r.width -= dx; break;
        }
        cropRect = r;
      }

      // Clamp
      cropRect.width = Math.max(20, cropRect.width);
      cropRect.height = Math.max(20, cropRect.height);

      updateCropRegionDisplay();
    });

    document.addEventListener('mouseup', () => {
      cropDragging = false;
      dragType = null;
    });
  }

  function updateCropRegionDisplay() {
    const region = document.getElementById('cropRegion');
    region.style.left = cropRect.x + 'px';
    region.style.top = cropRect.y + 'px';
    region.style.width = cropRect.width + 'px';
    region.style.height = cropRect.height + 'px';
  }

  function applyCrop() {
    if (!originalImage) return;

    // Convert crop rect from display coords to image coords
    const displayW = parseFloat(annotCanvas.style.width);
    const displayH = parseFloat(annotCanvas.style.height);
    const canvasRect = annotCanvas.getBoundingClientRect();
    const overlayRect = document.getElementById('cropOverlay').getBoundingClientRect();

    // Crop region is relative to the overlay, which covers the container
    // Canvas is centered in the container
    const canvasLeft = canvasRect.left - overlayRect.left;
    const canvasTop = canvasRect.top - overlayRect.top;

    const scaleX = originalImage.width / displayW;
    const scaleY = originalImage.height / displayH;

    const sx = Math.max(0, Math.round((cropRect.x - canvasLeft) * scaleX));
    const sy = Math.max(0, Math.round((cropRect.y - canvasTop) * scaleY));
    const sw = Math.min(originalImage.width - sx, Math.round(cropRect.width * scaleX));
    const sh = Math.min(originalImage.height - sy, Math.round(cropRect.height * scaleY));

    if (sw < 1 || sh < 1) {
      cancelCrop();
      return;
    }

    // Create cropped image
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = sw;
    tempCanvas.height = sh;
    const tempCtx = tempCanvas.getContext('2d');

    // Draw current state (image + annotations) into temp
    const mergedCanvas = getMergedCanvas();
    tempCtx.drawImage(mergedCanvas, sx, sy, sw, sh, 0, 0, sw, sh);

    // Replace original image
    const croppedImg = new Image();
    croppedImg.onload = () => {
      originalImage = croppedImg;
      // Clear all annotations (they're baked in)
      annotationState = PageSnapAnnotations.createState();
      fitImageToContainer();
      updateUndoRedoButtons();
      document.getElementById('imageInfo').textContent = `${sw} x ${sh}px`;
      showToast('Image cropped');
    };
    croppedImg.src = tempCanvas.toDataURL('image/png');

    cancelCrop();
  }

  function cancelCrop() {
    cropMode = false;
    document.getElementById('cropOverlay').style.display = 'none';
    if (currentTool === 'crop') {
      setTool('select');
    }
  }

  // --- Rendering ---
  function redrawAnnotations() {
    annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);

    // For blur annotations, we need the image data
    // First render all non-blur annotations, then blur, then remaining
    const blurAnns = annotationState.annotations.filter(a => a.type === 'blur');
    const otherAnns = annotationState.annotations.filter(a => a.type !== 'blur');

    // Render blur annotations using image data
    for (const ann of blurAnns) {
      annotCtx.save();
      // Copy region from image canvas
      try {
        const imgData = imageCtx.getImageData(
          Math.max(0, ann.x), Math.max(0, ann.y),
          Math.min(ann.width, imageCanvas.width - ann.x),
          Math.min(ann.height, imageCanvas.height - ann.y)
        );
        // Pixelate
        const pixelSize = Math.max(4, Math.round((ann.intensity || 10)));
        for (let py = 0; py < imgData.height; py += pixelSize) {
          for (let px = 0; px < imgData.width; px += pixelSize) {
            let r = 0, g = 0, b = 0, count = 0;
            for (let dy = 0; dy < pixelSize && py + dy < imgData.height; dy++) {
              for (let dx = 0; dx < pixelSize && px + dx < imgData.width; dx++) {
                const i = ((py + dy) * imgData.width + (px + dx)) * 4;
                r += imgData.data[i]; g += imgData.data[i + 1]; b += imgData.data[i + 2];
                count++;
              }
            }
            r = Math.round(r / count); g = Math.round(g / count); b = Math.round(b / count);
            for (let dy = 0; dy < pixelSize && py + dy < imgData.height; dy++) {
              for (let dx = 0; dx < pixelSize && px + dx < imgData.width; dx++) {
                const i = ((py + dy) * imgData.width + (px + dx)) * 4;
                imgData.data[i] = r; imgData.data[i + 1] = g; imgData.data[i + 2] = b;
              }
            }
          }
        }
        annotCtx.putImageData(imgData, ann.x, ann.y);
      } catch (e) {
        annotCtx.fillStyle = 'rgba(128, 128, 128, 0.8)';
        annotCtx.fillRect(ann.x, ann.y, ann.width, ann.height);
      }
      if (ann.id === annotationState.selectedId) {
        PageSnapAnnotations._renderSelectionHandles(annotCtx, ann, 1);
      }
      annotCtx.restore();
    }

    // Render other annotations
    for (const ann of otherAnns) {
      annotCtx.save();
      PageSnapAnnotations._renderAnnotation(annotCtx, ann, 1, ann.id === annotationState.selectedId);
      annotCtx.restore();
    }
  }

  function updateUndoRedoButtons() {
    document.getElementById('undoBtn').disabled = annotationState.undoStack.length === 0;
    document.getElementById('redoBtn').disabled = annotationState.redoStack.length === 0;
  }

  // --- Export ---
  function setupExportButtons() {
    document.getElementById('pngBtn').addEventListener('click', exportPNG);
    document.getElementById('jpgBtn').addEventListener('click', exportJPG);
    document.getElementById('pdfBtn').addEventListener('click', exportPDF);
    document.getElementById('copyBtn').addEventListener('click', exportClipboard);
  }

  function getMergedCanvas() {
    const canvas = document.createElement('canvas');
    canvas.width = imageCanvas.width;
    canvas.height = imageCanvas.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(imageCanvas, 0, 0);
    ctx.drawImage(annotCanvas, 0, 0);
    return canvas;
  }

  function getExportDataUrl(format, quality) {
    const merged = getMergedCanvas();
    if (format === 'jpeg') {
      const c2 = document.createElement('canvas');
      c2.width = merged.width;
      c2.height = merged.height;
      const ctx2 = c2.getContext('2d');
      ctx2.fillStyle = '#FFFFFF';
      ctx2.fillRect(0, 0, c2.width, c2.height);
      ctx2.drawImage(merged, 0, 0);
      return c2.toDataURL('image/jpeg', quality || 0.8);
    }
    return merged.toDataURL('image/png');
  }

  function generateFilename(ext) {
    const domain = pageUrl ? new URL(pageUrl).hostname.replace(/\./g, '_') : 'screenshot';
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `pagesnap_${domain}_${ts}.${ext}`;
  }

  async function exportPNG() {
    const dataUrl = getExportDataUrl('png');
    const filename = generateFilename('png');
    try {
      await chrome.runtime.sendMessage({
        action: 'downloadImage',
        dataUrl,
        filename
      });
      showToast('PNG saved');
    } catch (e) {
      // Fallback: direct download
      downloadViaLink(dataUrl, filename);
      showToast('PNG saved');
    }
  }

  async function exportJPG() {
    const dataUrl = getExportDataUrl('jpeg', 0.85);
    const filename = generateFilename('jpg');
    try {
      await chrome.runtime.sendMessage({
        action: 'downloadImage',
        dataUrl,
        filename
      });
      showToast('JPG saved');
    } catch (e) {
      downloadViaLink(dataUrl, filename);
      showToast('JPG saved');
    }
  }

  async function exportPDF() {
    const dataUrl = getExportDataUrl('png');
    const filename = generateFilename('pdf');

    // Simple PDF generation using the export utility if available
    try {
      if (typeof PageSnapExport !== 'undefined') {
        await PageSnapExport.downloadPDF(dataUrl, filename);
        showToast('PDF saved');
        return;
      }
    } catch (e) {
      console.warn('PDF export via utility failed:', e);
    }

    // Fallback: download as PNG
    try {
      await chrome.runtime.sendMessage({
        action: 'downloadImage',
        dataUrl,
        filename: filename.replace('.pdf', '.png')
      });
      showToast('Saved as PNG (PDF fallback)');
    } catch (e) {
      downloadViaLink(dataUrl, filename.replace('.pdf', '.png'));
    }
  }

  async function exportClipboard() {
    const merged = getMergedCanvas();
    try {
      const blob = await new Promise(resolve => merged.toBlob(resolve, 'image/png'));
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      showToast('Copied to clipboard');
    } catch (e) {
      showToast('Clipboard access denied', 'error');
    }
  }

  function downloadViaLink(dataUrl, filename) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    a.click();
  }

  // --- Keyboard Shortcuts ---
  function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
      // Don't intercept if text input is focused
      if (textInput.style.display !== 'none') return;
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      const ctrl = e.ctrlKey || e.metaKey;

      // Undo/Redo
      if (ctrl && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (PageSnapAnnotations.undo(annotationState)) {
          redrawAnnotations();
          updateUndoRedoButtons();
        }
        return;
      }
      if (ctrl && (e.key === 'Z' || (e.key === 'z' && e.shiftKey)) ) {
        e.preventDefault();
        if (PageSnapAnnotations.redo(annotationState)) {
          redrawAnnotations();
          updateUndoRedoButtons();
        }
        return;
      }
      if (ctrl && e.key === 'y') {
        e.preventDefault();
        if (PageSnapAnnotations.redo(annotationState)) {
          redrawAnnotations();
          updateUndoRedoButtons();
        }
        return;
      }

      // Delete selected annotation
      if ((e.key === 'Delete' || e.key === 'Backspace') && annotationState.selectedId) {
        e.preventDefault();
        PageSnapAnnotations.removeAnnotation(annotationState, annotationState.selectedId);
        redrawAnnotations();
        updateUndoRedoButtons();
        return;
      }

      // Tool shortcuts
      switch (e.key.toLowerCase()) {
        case 'v': setTool('select'); break;
        case 'c': if (!ctrl) setTool('crop'); break;
        case 'a': setTool('arrow'); break;
        case 'l': setTool('line'); break;
        case 'r': setTool('rectangle'); break;
        case 't': setTool('text'); break;
        case 'h': setTool('highlight'); break;
        case 'b': setTool('blur'); break;
        case 'd': setTool('freehand'); break;
        case 'escape':
          if (cropMode) {
            cancelCrop();
          } else {
            closeEditor();
          }
          break;
      }
    });
  }

  // --- Close ---
  function closeEditor() {
    window.parent.postMessage({ type: 'pagesnap-editor-close' }, '*');
  }

  // --- Toast ---
  function showToast(message) {
    const existing = document.querySelector('.editor-toast');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'editor-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // --- Start ---
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
