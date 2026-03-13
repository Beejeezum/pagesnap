/**
 * PageSnap - Social Graphics Generator
 * Creates shareable visual cards from content using Canvas API.
 */

const PageSnapGraphics = {
  /**
   * Generate a social media graphic card
   * @param {object} options
   * @param {string} options.quote - Pull quote or key text
   * @param {string} options.source - Source attribution
   * @param {string} options.author - Author name
   * @param {string} options.style - Visual style preset
   * @param {number} options.width - Canvas width (default 1200)
   * @param {number} options.height - Canvas height (default 675 for 16:9)
   * @returns {string} Data URL of the generated graphic
   */
  generate(options = {}) {
    const width = options.width || 1200;
    const height = options.height || 675;
    const style = options.style || 'modern-dark';
    const quote = options.quote || '';
    const source = options.source || '';
    const author = options.author || '';

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');

    // Apply style preset
    const preset = this._getPreset(style);
    this._drawBackground(ctx, width, height, preset);
    this._drawQuote(ctx, width, height, quote, preset);
    this._drawAttribution(ctx, width, height, source, author, preset);
    this._drawBranding(ctx, width, height, preset);

    return canvas.toDataURL('image/png');
  },

  /**
   * Available style presets
   */
  getPresets() {
    return [
      { id: 'modern-dark', name: 'Modern Dark', colors: ['#0F172A', '#1E293B'] },
      { id: 'modern-light', name: 'Modern Light', colors: ['#FFFFFF', '#F8FAFC'] },
      { id: 'gradient-purple', name: 'Purple Gradient', colors: ['#4F46E5', '#7C3AED'] },
      { id: 'gradient-ocean', name: 'Ocean Gradient', colors: ['#0EA5E9', '#06B6D4'] },
      { id: 'gradient-sunset', name: 'Sunset Gradient', colors: ['#F59E0B', '#EF4444'] },
      { id: 'gradient-forest', name: 'Forest Gradient', colors: ['#059669', '#10B981'] },
      { id: 'bold-red', name: 'Bold Red', colors: ['#DC2626', '#991B1B'] },
      { id: 'minimal', name: 'Minimal', colors: ['#FAFAFA', '#F5F5F5'] }
    ];
  },

  /**
   * Available aspect ratios
   */
  getAspectRatios() {
    return [
      { id: '16:9', name: 'Landscape (16:9)', width: 1200, height: 675 },
      { id: '1:1', name: 'Square (1:1)', width: 1080, height: 1080 },
      { id: '4:5', name: 'Portrait (4:5)', width: 1080, height: 1350 },
      { id: '9:16', name: 'Story (9:16)', width: 1080, height: 1920 }
    ];
  },

  // --- Presets ---

  _getPreset(styleId) {
    const presets = {
      'modern-dark': {
        bg: ['#0F172A', '#1E293B'],
        textColor: '#F8FAFC',
        accentColor: '#818CF8',
        sourceColor: '#94A3B8',
        quoteFont: '600 36px Inter, -apple-system, sans-serif',
        sourceFont: '400 16px Inter, -apple-system, sans-serif',
        quoteMark: true
      },
      'modern-light': {
        bg: ['#FFFFFF', '#F8FAFC'],
        textColor: '#0F172A',
        accentColor: '#4F46E5',
        sourceColor: '#64748B',
        quoteFont: '600 36px Inter, -apple-system, sans-serif',
        sourceFont: '400 16px Inter, -apple-system, sans-serif',
        quoteMark: true
      },
      'gradient-purple': {
        bg: ['#4F46E5', '#7C3AED'],
        textColor: '#FFFFFF',
        accentColor: '#E0E7FF',
        sourceColor: 'rgba(255,255,255,0.7)',
        quoteFont: '700 38px Inter, -apple-system, sans-serif',
        sourceFont: '400 16px Inter, -apple-system, sans-serif',
        quoteMark: false
      },
      'gradient-ocean': {
        bg: ['#0EA5E9', '#06B6D4'],
        textColor: '#FFFFFF',
        accentColor: '#E0F2FE',
        sourceColor: 'rgba(255,255,255,0.7)',
        quoteFont: '700 38px Inter, -apple-system, sans-serif',
        sourceFont: '400 16px Inter, -apple-system, sans-serif',
        quoteMark: false
      },
      'gradient-sunset': {
        bg: ['#F59E0B', '#EF4444'],
        textColor: '#FFFFFF',
        accentColor: '#FEF3C7',
        sourceColor: 'rgba(255,255,255,0.8)',
        quoteFont: '700 38px Inter, -apple-system, sans-serif',
        sourceFont: '400 16px Inter, -apple-system, sans-serif',
        quoteMark: false
      },
      'gradient-forest': {
        bg: ['#059669', '#10B981'],
        textColor: '#FFFFFF',
        accentColor: '#D1FAE5',
        sourceColor: 'rgba(255,255,255,0.7)',
        quoteFont: '700 38px Inter, -apple-system, sans-serif',
        sourceFont: '400 16px Inter, -apple-system, sans-serif',
        quoteMark: false
      },
      'bold-red': {
        bg: ['#DC2626', '#991B1B'],
        textColor: '#FFFFFF',
        accentColor: '#FEE2E2',
        sourceColor: 'rgba(255,255,255,0.7)',
        quoteFont: '800 40px Inter, -apple-system, sans-serif',
        sourceFont: '400 16px Inter, -apple-system, sans-serif',
        quoteMark: false
      },
      'minimal': {
        bg: ['#FAFAFA', '#F5F5F5'],
        textColor: '#171717',
        accentColor: '#A3A3A3',
        sourceColor: '#737373',
        quoteFont: '300 34px Inter, -apple-system, sans-serif',
        sourceFont: '400 14px Inter, -apple-system, sans-serif',
        quoteMark: true
      }
    };

    return presets[styleId] || presets['modern-dark'];
  },

  // --- Drawing ---

  _drawBackground(ctx, w, h, preset) {
    const gradient = ctx.createLinearGradient(0, 0, w, h);
    gradient.addColorStop(0, preset.bg[0]);
    gradient.addColorStop(1, preset.bg[1]);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);

    // Subtle texture pattern
    ctx.globalAlpha = 0.03;
    for (let i = 0; i < 50; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = Math.random() * 100 + 20;
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
    const topOffset = h * 0.2;

    // Quote mark
    if (preset.quoteMark) {
      ctx.font = `700 ${Math.round(h * 0.15)}px Georgia, serif`;
      ctx.fillStyle = preset.accentColor;
      ctx.globalAlpha = 0.2;
      ctx.fillText('\u201C', padding - 10, topOffset);
      ctx.globalAlpha = 1;
    }

    // Accent line
    ctx.fillStyle = preset.accentColor;
    ctx.fillRect(padding, topOffset - 30, 40, 3);

    // Quote text with word wrap
    ctx.font = preset.quoteFont;
    ctx.fillStyle = preset.textColor;

    const lines = this._wrapText(ctx, quote, maxWidth);
    const lineHeight = parseInt(preset.quoteFont) * 1.4;
    const maxLines = Math.floor((h * 0.5) / lineHeight);
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
    const bottomOffset = h * 0.85;

    ctx.font = preset.sourceFont;
    ctx.fillStyle = preset.sourceColor;

    if (author) {
      ctx.fillText(`\u2014 ${author}`, padding, bottomOffset);
    }

    if (source) {
      // Truncate long URLs
      let displaySource = source;
      try {
        const url = new URL(source);
        displaySource = url.hostname;
      } catch (e) {
        // Not a URL, use as-is
      }
      const y = author ? bottomOffset + 24 : bottomOffset;
      ctx.fillText(displaySource, padding, y);
    }
  },

  _drawBranding(ctx, w, h, preset) {
    // Subtle PageSnap watermark
    ctx.font = `500 12px -apple-system, sans-serif`;
    ctx.fillStyle = preset.sourceColor;
    ctx.globalAlpha = 0.4;
    ctx.textAlign = 'right';
    ctx.fillText('PageSnap', w - w * 0.08, h - 20);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
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
