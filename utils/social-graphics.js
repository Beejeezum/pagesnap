/**
 * PageSnap v3 - Social Graphics Generator
 * Creates shareable visual cards from content using Canvas API.
 * Supports screenshot overlays, quote cards, stat cards.
 */

const PageSnapGraphics = {
  generate(options = {}) {
    const width = options.width || 1200;
    const height = options.height || 675;
    const style = options.style || 'modern-dark';
    const quote = options.quote || '';
    const source = options.source || '';
    const author = options.author || '';
    const title = options.title || '';

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    const preset = this._getPreset(style);

    if (style === 'screenshot-overlay' && options.backgroundImage) {
      this._drawScreenshotOverlay(ctx, width, height, options.backgroundImage, quote, title, source, author);
    } else {
      this._drawBackground(ctx, width, height, preset);
      this._drawQuote(ctx, width, height, quote, preset);
      this._drawAttribution(ctx, width, height, source, author, preset);
    }

    return canvas.toDataURL('image/png');
  },

  getPresets() {
    return [
      { id: 'modern-dark', name: 'Modern Dark', colors: ['#0F172A', '#1E293B'] },
      { id: 'modern-light', name: 'Modern Light', colors: ['#FFFFFF', '#F8FAFC'] },
      { id: 'gradient-purple', name: 'Purple Gradient', colors: ['#4F46E5', '#7C3AED'] },
      { id: 'gradient-ocean', name: 'Ocean Gradient', colors: ['#0EA5E9', '#06B6D4'] },
      { id: 'gradient-sunset', name: 'Sunset Gradient', colors: ['#F59E0B', '#EF4444'] },
      { id: 'gradient-forest', name: 'Forest Gradient', colors: ['#059669', '#10B981'] },
      { id: 'bold-red', name: 'Bold Red', colors: ['#DC2626', '#991B1B'] },
      { id: 'minimal', name: 'Minimal', colors: ['#FAFAFA', '#F5F5F5'] },
      { id: 'screenshot-overlay', name: 'Screenshot Overlay', colors: ['#000', '#000'] }
    ];
  },

  getAspectRatios() {
    return [
      { id: '16:9', name: 'Landscape (16:9)', width: 1200, height: 675 },
      { id: '1:1', name: 'Square (1:1)', width: 1080, height: 1080 },
      { id: '4:5', name: 'Portrait (4:5)', width: 1080, height: 1350 },
      { id: '9:16', name: 'Story (9:16)', width: 1080, height: 1920 }
    ];
  },

  // --- Screenshot overlay mode ---
  _drawScreenshotOverlay(ctx, w, h, bgImage, quote, title, source, author) {
    // Draw screenshot as background
    ctx.drawImage(bgImage, 0, 0, w, h);

    // Dark gradient overlay from bottom
    const gradient = ctx.createLinearGradient(0, h * 0.3, 0, h);
    gradient.addColorStop(0, 'rgba(0,0,0,0)');
    gradient.addColorStop(0.4, 'rgba(0,0,0,0.4)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.85)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // Top subtle gradient
    const topGrad = ctx.createLinearGradient(0, 0, 0, h * 0.15);
    topGrad.addColorStop(0, 'rgba(0,0,0,0.5)');
    topGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = topGrad;
    ctx.fillRect(0, 0, w, h * 0.15);

    const padding = w * 0.06;

    // Quote text at bottom
    if (quote) {
      const fontSize = Math.round(w * 0.035);
      ctx.font = `700 ${fontSize}px -apple-system, "SF Pro Display", "Segoe UI", sans-serif`;
      ctx.fillStyle = '#FFFFFF';
      const lines = this._wrapText(ctx, quote, w - padding * 2);
      const lineHeight = fontSize * 1.35;
      const maxLines = Math.min(lines.length, 5);
      const textStartY = h - padding - (maxLines * lineHeight) - 40;

      // Accent bar
      ctx.fillStyle = '#818CF8';
      ctx.fillRect(padding, textStartY - 12, 36, 3);

      ctx.fillStyle = '#FFFFFF';
      for (let i = 0; i < maxLines; i++) {
        let line = lines[i];
        if (i === maxLines - 1 && lines.length > maxLines) line += '...';
        ctx.fillText(line, padding, textStartY + i * lineHeight);
      }

      // Attribution
      const attrY = textStartY + maxLines * lineHeight + 8;
      ctx.font = `400 ${Math.round(w * 0.014)}px -apple-system, sans-serif`;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      let attrText = '';
      if (author) attrText += author;
      if (source) {
        try { const url = new URL(source); attrText += (attrText ? ' \u00B7 ' : '') + url.hostname; }
        catch(e) { attrText += (attrText ? ' \u00B7 ' : '') + source; }
      }
      if (attrText) ctx.fillText(attrText, padding, attrY);
    }
  },

  // --- Presets ---
  _getPreset(styleId) {
    const presets = {
      'modern-dark': {
        bg: ['#0F172A', '#1E293B'],
        textColor: '#F8FAFC',
        accentColor: '#818CF8',
        sourceColor: '#94A3B8',
        quoteFont: { weight: 600, sizeRatio: 0.042, family: '-apple-system, "SF Pro Display", sans-serif' },
        sourceFont: { weight: 400, sizeRatio: 0.016, family: '-apple-system, sans-serif' },
        quoteMark: true
      },
      'modern-light': {
        bg: ['#FFFFFF', '#F8FAFC'],
        textColor: '#0F172A',
        accentColor: '#4F46E5',
        sourceColor: '#64748B',
        quoteFont: { weight: 600, sizeRatio: 0.042, family: '-apple-system, "SF Pro Display", sans-serif' },
        sourceFont: { weight: 400, sizeRatio: 0.016, family: '-apple-system, sans-serif' },
        quoteMark: true
      },
      'gradient-purple': {
        bg: ['#4F46E5', '#7C3AED'],
        textColor: '#FFFFFF',
        accentColor: '#E0E7FF',
        sourceColor: 'rgba(255,255,255,0.7)',
        quoteFont: { weight: 700, sizeRatio: 0.045, family: '-apple-system, "SF Pro Display", sans-serif' },
        sourceFont: { weight: 400, sizeRatio: 0.016, family: '-apple-system, sans-serif' },
        quoteMark: false
      },
      'gradient-ocean': {
        bg: ['#0EA5E9', '#06B6D4'],
        textColor: '#FFFFFF',
        accentColor: '#E0F2FE',
        sourceColor: 'rgba(255,255,255,0.7)',
        quoteFont: { weight: 700, sizeRatio: 0.045, family: '-apple-system, "SF Pro Display", sans-serif' },
        sourceFont: { weight: 400, sizeRatio: 0.016, family: '-apple-system, sans-serif' },
        quoteMark: false
      },
      'gradient-sunset': {
        bg: ['#F59E0B', '#EF4444'],
        textColor: '#FFFFFF',
        accentColor: '#FEF3C7',
        sourceColor: 'rgba(255,255,255,0.8)',
        quoteFont: { weight: 700, sizeRatio: 0.045, family: '-apple-system, "SF Pro Display", sans-serif' },
        sourceFont: { weight: 400, sizeRatio: 0.016, family: '-apple-system, sans-serif' },
        quoteMark: false
      },
      'gradient-forest': {
        bg: ['#059669', '#10B981'],
        textColor: '#FFFFFF',
        accentColor: '#D1FAE5',
        sourceColor: 'rgba(255,255,255,0.7)',
        quoteFont: { weight: 700, sizeRatio: 0.045, family: '-apple-system, "SF Pro Display", sans-serif' },
        sourceFont: { weight: 400, sizeRatio: 0.016, family: '-apple-system, sans-serif' },
        quoteMark: false
      },
      'bold-red': {
        bg: ['#DC2626', '#991B1B'],
        textColor: '#FFFFFF',
        accentColor: '#FEE2E2',
        sourceColor: 'rgba(255,255,255,0.7)',
        quoteFont: { weight: 800, sizeRatio: 0.048, family: '-apple-system, "SF Pro Display", sans-serif' },
        sourceFont: { weight: 400, sizeRatio: 0.016, family: '-apple-system, sans-serif' },
        quoteMark: false
      },
      'minimal': {
        bg: ['#FAFAFA', '#F5F5F5'],
        textColor: '#171717',
        accentColor: '#A3A3A3',
        sourceColor: '#737373',
        quoteFont: { weight: 300, sizeRatio: 0.04, family: 'Georgia, "Times New Roman", serif' },
        sourceFont: { weight: 400, sizeRatio: 0.014, family: '-apple-system, sans-serif' },
        quoteMark: true
      }
    };

    return presets[styleId] || presets['modern-dark'];
  },

  // --- Drawing ---
  _drawBackground(ctx, w, h, preset) {
    const gradient = ctx.createLinearGradient(0, 0, w * 0.3, h);
    gradient.addColorStop(0, preset.bg[0]);
    gradient.addColorStop(1, preset.bg[1]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // Subtle noise texture
    ctx.globalAlpha = 0.02;
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = Math.random() * 80 + 30;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = preset.textColor;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },

  _drawQuote(ctx, w, h, quote, preset) {
    const padding = w * 0.08;
    const maxWidth = w - padding * 2;
    const topOffset = h * 0.22;
    const qf = preset.quoteFont;

    // Quote mark
    if (preset.quoteMark) {
      const qmSize = Math.round(h * 0.12);
      ctx.font = `700 ${qmSize}px Georgia, serif`;
      ctx.fillStyle = preset.accentColor;
      ctx.globalAlpha = 0.15;
      ctx.fillText('\u201C', padding - 8, topOffset + 10);
      ctx.globalAlpha = 1;
    }

    // Accent line
    ctx.fillStyle = preset.accentColor;
    ctx.fillRect(padding, topOffset - 28, 36, 3);

    // Quote text with proper sizing
    const fontSize = Math.round(w * qf.sizeRatio);
    ctx.font = `${qf.weight} ${fontSize}px ${qf.family}`;
    ctx.fillStyle = preset.textColor;

    const lines = this._wrapText(ctx, quote, maxWidth);
    const lineHeight = fontSize * 1.4;
    const maxLines = Math.floor((h * 0.48) / lineHeight);
    const visibleLines = lines.slice(0, maxLines);

    if (lines.length > maxLines) {
      visibleLines[visibleLines.length - 1] += '...';
    }

    for (let i = 0; i < visibleLines.length; i++) {
      ctx.fillText(visibleLines[i], padding, topOffset + i * lineHeight);
    }
  },

  _drawAttribution(ctx, w, h, source, author, preset) {
    const padding = w * 0.08;
    const sf = preset.sourceFont;
    const fontSize = Math.round(w * sf.sizeRatio);
    const bottomOffset = h * 0.86;

    ctx.font = `${sf.weight} ${fontSize}px ${sf.family}`;
    ctx.fillStyle = preset.sourceColor;

    if (author) {
      ctx.fillText(`\u2014 ${author}`, padding, bottomOffset);
    }

    if (source) {
      let displaySource = source;
      try { const url = new URL(source); displaySource = url.hostname; } catch (e) {}
      const y = author ? bottomOffset + fontSize * 1.6 : bottomOffset;
      ctx.fillText(displaySource, padding, y);
    }
  },

  // --- Text Wrapping ---
  _wrapText(ctx, text, maxWidth) {
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    for (const word of words) {
      const testLine = currentLine ? currentLine + ' ' + word : word;
      const metrics = ctx.measureText(testLine);

      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
    return lines;
  }
};
