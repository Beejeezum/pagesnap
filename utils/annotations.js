/**
 * PageSnap - Annotation State & Rendering
 * Manages annotation objects, undo/redo stack, and canvas rendering.
 */

const PageSnapAnnotations = {
  MAX_UNDO: 50,

  /**
   * Create a new annotation state manager
   */
  createState() {
    return {
      annotations: [],
      undoStack: [],
      redoStack: [],
      selectedId: null,
      nextId: 1
    };
  },

  /**
   * Add an annotation and push to undo stack
   */
  addAnnotation(state, annotation) {
    const ann = {
      ...annotation,
      id: state.nextId++
    };
    state.undoStack.push({
      type: 'add',
      annotation: { ...ann }
    });
    if (state.undoStack.length > this.MAX_UNDO) {
      state.undoStack.shift();
    }
    state.redoStack = [];
    state.annotations.push(ann);
    return ann;
  },

  /**
   * Update an existing annotation
   */
  updateAnnotation(state, id, changes) {
    const idx = state.annotations.findIndex(a => a.id === id);
    if (idx === -1) return null;

    const oldAnn = { ...state.annotations[idx] };
    state.undoStack.push({
      type: 'update',
      oldAnnotation: oldAnn,
      newAnnotation: { ...oldAnn, ...changes }
    });
    if (state.undoStack.length > this.MAX_UNDO) {
      state.undoStack.shift();
    }
    state.redoStack = [];

    state.annotations[idx] = { ...oldAnn, ...changes };
    return state.annotations[idx];
  },

  /**
   * Remove an annotation
   */
  removeAnnotation(state, id) {
    const idx = state.annotations.findIndex(a => a.id === id);
    if (idx === -1) return false;

    const removed = state.annotations.splice(idx, 1)[0];
    state.undoStack.push({
      type: 'remove',
      annotation: { ...removed }
    });
    if (state.undoStack.length > this.MAX_UNDO) {
      state.undoStack.shift();
    }
    state.redoStack = [];

    if (state.selectedId === id) {
      state.selectedId = null;
    }
    return true;
  },

  /**
   * Undo last operation
   */
  undo(state) {
    if (state.undoStack.length === 0) return false;

    const op = state.undoStack.pop();
    state.redoStack.push(op);

    switch (op.type) {
      case 'add':
        state.annotations = state.annotations.filter(a => a.id !== op.annotation.id);
        break;
      case 'remove':
        state.annotations.push(op.annotation);
        break;
      case 'update':
        const idx = state.annotations.findIndex(a => a.id === op.oldAnnotation.id);
        if (idx !== -1) {
          state.annotations[idx] = { ...op.oldAnnotation };
        }
        break;
    }
    return true;
  },

  /**
   * Redo last undone operation
   */
  redo(state) {
    if (state.redoStack.length === 0) return false;

    const op = state.redoStack.pop();
    state.undoStack.push(op);

    switch (op.type) {
      case 'add':
        state.annotations.push(op.annotation);
        break;
      case 'remove':
        state.annotations = state.annotations.filter(a => a.id !== op.annotation.id);
        break;
      case 'update':
        const idx = state.annotations.findIndex(a => a.id === op.newAnnotation.id);
        if (idx !== -1) {
          state.annotations[idx] = { ...op.newAnnotation };
        }
        break;
    }
    return true;
  },

  /**
   * Find annotation at a given point (for selection)
   */
  hitTest(state, x, y) {
    // Test in reverse order (top-most first)
    for (let i = state.annotations.length - 1; i >= 0; i--) {
      const ann = state.annotations[i];
      if (this._isPointInAnnotation(ann, x, y)) {
        return ann;
      }
    }
    return null;
  },

  /**
   * Render all annotations to a canvas context
   */
  render(ctx, state, scale = 1) {
    for (const ann of state.annotations) {
      ctx.save();
      this._renderAnnotation(ctx, ann, scale, ann.id === state.selectedId);
      ctx.restore();
    }
  },

  // --- Rendering for each annotation type ---

  _renderAnnotation(ctx, ann, scale, isSelected) {
    switch (ann.type) {
      case 'arrow':
        this._renderArrow(ctx, ann, scale, isSelected);
        break;
      case 'rectangle':
        this._renderRectangle(ctx, ann, scale, isSelected);
        break;
      case 'text':
        this._renderText(ctx, ann, scale, isSelected);
        break;
      case 'blur':
        this._renderBlur(ctx, ann, scale, isSelected);
        break;
      case 'highlight':
        this._renderHighlight(ctx, ann, scale, isSelected);
        break;
      case 'line':
        this._renderLine(ctx, ann, scale, isSelected);
        break;
      case 'freehand':
        this._renderFreehand(ctx, ann, scale, isSelected);
        break;
      case 'marker':
        this._renderMarker(ctx, ann, scale, isSelected);
        break;
    }

    if (isSelected) {
      this._renderSelectionHandles(ctx, ann, scale);
    }
  },

  _renderArrow(ctx, ann, scale, isSelected) {
    const { x1, y1, x2, y2, color, lineWidth } = ann;
    const sx1 = x1 * scale, sy1 = y1 * scale;
    const sx2 = x2 * scale, sy2 = y2 * scale;
    const lw = (lineWidth || 2) * scale;

    ctx.strokeStyle = color || '#FF0000';
    ctx.fillStyle = color || '#FF0000';
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';

    // Draw line
    ctx.beginPath();
    ctx.moveTo(sx1, sy1);
    ctx.lineTo(sx2, sy2);
    ctx.stroke();

    // Draw arrowhead
    const angle = Math.atan2(sy2 - sy1, sx2 - sx1);
    const headLength = Math.max(10, lw * 5) * scale;

    ctx.beginPath();
    ctx.moveTo(sx2, sy2);
    ctx.lineTo(
      sx2 - headLength * Math.cos(angle - Math.PI / 6),
      sy2 - headLength * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      sx2 - headLength * Math.cos(angle + Math.PI / 6),
      sy2 - headLength * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  },

  _renderRectangle(ctx, ann, scale, isSelected) {
    const { x, y, width, height, color, lineWidth, filled, opacity } = ann;
    const sx = x * scale, sy = y * scale;
    const sw = width * scale, sh = height * scale;
    const lw = (lineWidth || 2) * scale;

    ctx.strokeStyle = color || '#FF0000';
    ctx.lineWidth = lw;

    if (filled) {
      ctx.globalAlpha = opacity || 0.3;
      ctx.fillStyle = color || '#FF0000';
      ctx.fillRect(sx, sy, sw, sh);
      ctx.globalAlpha = 1;
    }
    ctx.strokeRect(sx, sy, sw, sh);
  },

  _renderText(ctx, ann, scale, isSelected) {
    const { x, y, text, color, fontSize, backgroundColor } = ann;
    const sx = x * scale, sy = y * scale;
    const fs = (fontSize || 16) * scale;

    ctx.font = `${fs}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
    ctx.textBaseline = 'top';

    const metrics = ctx.measureText(text || '');
    const textWidth = metrics.width;
    const textHeight = fs * 1.3;
    const padding = 4 * scale;

    if (backgroundColor) {
      ctx.fillStyle = backgroundColor;
      ctx.globalAlpha = 0.85;
      const radius = 4 * scale;
      this._roundRect(ctx, sx - padding, sy - padding, textWidth + padding * 2, textHeight + padding * 2, radius);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = color || '#FF0000';
    ctx.fillText(text || '', sx, sy);
  },

  _renderBlur(ctx, ann, scale) {
    const { x, y, width, height, intensity } = ann;
    const sx = x * scale, sy = y * scale;
    const sw = width * scale, sh = height * scale;
    const blurAmount = (intensity || 10) * scale;

    // Get image data from the area and pixelate it
    try {
      const imageData = ctx.getImageData(sx, sy, Math.max(1, sw), Math.max(1, sh));
      const pixelSize = Math.max(4, Math.round(blurAmount));

      for (let py = 0; py < imageData.height; py += pixelSize) {
        for (let px = 0; px < imageData.width; px += pixelSize) {
          // Average the pixel block
          let r = 0, g = 0, b = 0, count = 0;
          for (let dy = 0; dy < pixelSize && py + dy < imageData.height; dy++) {
            for (let dx = 0; dx < pixelSize && px + dx < imageData.width; dx++) {
              const i = ((py + dy) * imageData.width + (px + dx)) * 4;
              r += imageData.data[i];
              g += imageData.data[i + 1];
              b += imageData.data[i + 2];
              count++;
            }
          }
          r = Math.round(r / count);
          g = Math.round(g / count);
          b = Math.round(b / count);

          // Fill the block with the average
          for (let dy = 0; dy < pixelSize && py + dy < imageData.height; dy++) {
            for (let dx = 0; dx < pixelSize && px + dx < imageData.width; dx++) {
              const i = ((py + dy) * imageData.width + (px + dx)) * 4;
              imageData.data[i] = r;
              imageData.data[i + 1] = g;
              imageData.data[i + 2] = b;
            }
          }
        }
      }
      ctx.putImageData(imageData, sx, sy);
    } catch (e) {
      // Fallback: draw a semi-opaque rectangle
      ctx.fillStyle = 'rgba(128, 128, 128, 0.8)';
      ctx.fillRect(sx, sy, sw, sh);
    }
  },

  _renderHighlight(ctx, ann, scale) {
    const { x, y, width, height, color, opacity } = ann;
    const sx = x * scale, sy = y * scale;
    const sw = width * scale, sh = height * scale;

    ctx.globalAlpha = opacity || 0.35;
    ctx.fillStyle = color || '#FFFF00';
    ctx.fillRect(sx, sy, sw, sh);
    ctx.globalAlpha = 1;
  },

  _renderLine(ctx, ann, scale) {
    const { x1, y1, x2, y2, color, lineWidth } = ann;
    ctx.strokeStyle = color || '#FF0000';
    ctx.lineWidth = (lineWidth || 2) * scale;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1 * scale, y1 * scale);
    ctx.lineTo(x2 * scale, y2 * scale);
    ctx.stroke();
  },

  _renderFreehand(ctx, ann, scale) {
    const { points, color, lineWidth } = ann;
    if (!points || points.length < 2) return;

    ctx.strokeStyle = color || '#FF0000';
    ctx.lineWidth = (lineWidth || 2) * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(points[0].x * scale, points[0].y * scale);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x * scale, points[i].y * scale);
    }
    ctx.stroke();
  },

  _renderMarker(ctx, ann, scale) {
    const { points, color, lineWidth, opacity } = ann;
    if (!points || points.length < 2) return;

    ctx.globalAlpha = opacity || 0.4;
    ctx.strokeStyle = color || '#FFFF00';
    ctx.lineWidth = (lineWidth || 12) * scale;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(points[0].x * scale, points[0].y * scale);
    for (let i = 1; i < points.length; i++) {
      ctx.lineTo(points[i].x * scale, points[i].y * scale);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  },

  _renderSelectionHandles(ctx, ann, scale) {
    const bounds = this._getAnnotationBounds(ann);
    if (!bounds) return;

    const { x, y, width, height } = bounds;
    const sx = x * scale, sy = y * scale;
    const sw = width * scale, sh = height * scale;

    // Dashed selection border
    ctx.strokeStyle = '#4F46E5';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(sx - 4, sy - 4, sw + 8, sh + 8);
    ctx.setLineDash([]);

    // Corner handles
    const handleSize = 6;
    ctx.fillStyle = '#FFFFFF';
    ctx.strokeStyle = '#4F46E5';
    ctx.lineWidth = 1.5;

    const corners = [
      [sx - 4, sy - 4],
      [sx + sw + 4, sy - 4],
      [sx - 4, sy + sh + 4],
      [sx + sw + 4, sy + sh + 4]
    ];

    for (const [cx, cy] of corners) {
      ctx.fillRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize);
      ctx.strokeRect(cx - handleSize / 2, cy - handleSize / 2, handleSize, handleSize);
    }
  },

  // --- Geometry helpers ---

  _isPointInAnnotation(ann, x, y) {
    const bounds = this._getAnnotationBounds(ann);
    if (!bounds) return false;
    const margin = 5;
    return x >= bounds.x - margin && x <= bounds.x + bounds.width + margin &&
           y >= bounds.y - margin && y <= bounds.y + bounds.height + margin;
  },

  _getAnnotationBounds(ann) {
    switch (ann.type) {
      case 'arrow':
      case 'line':
        return {
          x: Math.min(ann.x1, ann.x2),
          y: Math.min(ann.y1, ann.y2),
          width: Math.abs(ann.x2 - ann.x1),
          height: Math.abs(ann.y2 - ann.y1)
        };
      case 'rectangle':
      case 'blur':
      case 'highlight':
        return { x: ann.x, y: ann.y, width: ann.width, height: ann.height };
      case 'text':
        return { x: ann.x, y: ann.y, width: ann.textWidth || 100, height: ann.textHeight || 20 };
      case 'freehand':
      case 'marker':
        if (!ann.points || ann.points.length === 0) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of ann.points) {
          minX = Math.min(minX, p.x);
          minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x);
          maxY = Math.max(maxY, p.y);
        }
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      default:
        return null;
    }
  },

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
};
