/**
 * PageSnap - Export Utilities
 * PNG, JPG, PDF, and clipboard export functionality.
 */

const PageSnapExport = {
  /**
   * Export image as PNG and trigger download
   */
  async downloadPNG(dataUrl, filename) {
    const fname = filename || this._generateFilename('png');
    return this._triggerDownload(dataUrl, fname, 'png');
  },

  /**
   * Export image as JPG with quality setting
   */
  async downloadJPG(dataUrl, filename, quality) {
    const q = quality || 0.8;
    const jpgDataUrl = await this._convertToJPG(dataUrl, q);
    const fname = filename || this._generateFilename('jpg');
    return this._triggerDownload(jpgDataUrl, fname, 'jpg');
  },

  /**
   * Export image as PDF
   */
  async downloadPDF(dataUrl, filename, options = {}) {
    const img = await this._loadImage(dataUrl);
    const fname = filename || this._generateFilename('pdf');

    // Create PDF using jsPDF-like manual approach (no external deps)
    const pdfDataUrl = await this._createPDF(img, options);
    return this._triggerDownload(pdfDataUrl, fname, 'pdf');
  },

  /**
   * Copy image to clipboard
   */
  async copyToClipboard(dataUrl) {
    try {
      const blob = await this._dataUrlToBlob(dataUrl);
      await navigator.clipboard.write([
        new ClipboardItem({ 'image/png': blob })
      ]);
      return { success: true };
    } catch (err) {
      // Fallback: create a temporary canvas and try execCommand
      try {
        const img = await this._loadImage(dataUrl);
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        return new Promise((resolve) => {
          canvas.toBlob(async (blob) => {
            try {
              await navigator.clipboard.write([
                new ClipboardItem({ 'image/png': blob })
              ]);
              resolve({ success: true });
            } catch (e) {
              resolve({ error: 'Clipboard access denied: ' + e.message });
            }
          }, 'image/png');
        });
      } catch (e) {
        return { error: 'Clipboard copy failed: ' + e.message };
      }
    }
  },

  /**
   * Get a data URL in the specified format
   */
  async getDataUrl(sourceDataUrl, format, quality) {
    if (format === 'jpg' || format === 'jpeg') {
      return await this._convertToJPG(sourceDataUrl, quality || 0.8);
    }
    return sourceDataUrl;
  },

  // --- Private helpers ---

  async _convertToJPG(dataUrl, quality) {
    const img = await this._loadImage(dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    // Fill white background for JPG (no transparency)
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);
    return canvas.toDataURL('image/jpeg', quality);
  },

  async _createPDF(img, options = {}) {
    // Create a simple PDF manually (subset of PDF spec)
    // This avoids any external library dependency
    const pageMargin = options.pageBorder ? 20 : 0;

    // A4-ish proportions, scale image to fit
    const maxWidth = 595 - (pageMargin * 2); // A4 width in points
    const scale = maxWidth / img.width;
    const imgWidthPt = img.width * scale;
    const imgHeightPt = img.height * scale;

    // For very tall images, split into pages
    const pageHeight = 842 - (pageMargin * 2); // A4 height in points
    const pages = Math.ceil(imgHeightPt / pageHeight);

    // Convert image to base64 JPEG for embedding
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0);

    // For single-page or shorter images, use a simple single-image PDF
    // For multi-page, create multiple pages
    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const jpegBase64 = jpegDataUrl.split(',')[1];
    const jpegBinary = atob(jpegBase64);
    const jpegBytes = new Uint8Array(jpegBinary.length);
    for (let i = 0; i < jpegBinary.length; i++) {
      jpegBytes[i] = jpegBinary.charCodeAt(i);
    }

    // Build PDF
    const totalPageHeight = pageMargin * 2 + Math.min(imgHeightPt, pageHeight);
    const totalPageWidth = pageMargin * 2 + imgWidthPt;

    let pdf = '%PDF-1.4\n';

    // Object 1: Catalog
    pdf += '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';

    // Object 2: Pages
    const pageRefs = [];
    for (let p = 0; p < pages; p++) {
      pageRefs.push(`${4 + p} 0 R`);
    }
    pdf += `2 0 obj\n<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pages} >>\nendobj\n`;

    // Object 3: Image XObject
    const imgObjNum = 3;
    pdf += `${imgObjNum} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegBytes.length} >>\nstream\n`;

    // We'll build the final binary PDF separately since stream data is binary
    const pdfHeader = new TextEncoder().encode(pdf);
    const pdfAfterStream = new TextEncoder().encode('\nendstream\nendobj\n');

    // Build page objects as text
    let pagesPdf = '';
    for (let p = 0; p < pages; p++) {
      const pageObjNum = 4 + p;
      const contentObjNum = 4 + pages + p;
      const ph = (p === pages - 1) ? Math.min(pageHeight, imgHeightPt - p * pageHeight) + pageMargin * 2 : totalPageHeight;

      pagesPdf += `${pageObjNum} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${totalPageWidth} ${ph}] /Contents ${contentObjNum} 0 R /Resources << /XObject << /Img ${imgObjNum} 0 R >> >> >>\nendobj\n`;

      // Content stream: position image for this page slice
      const sliceY = p * pageHeight;
      const sliceHeight = Math.min(pageHeight, imgHeightPt - sliceY);
      // PDF coordinates: origin at bottom-left
      // We need to show a portion of the image
      // Use cm matrix to position and clip
      const content = `q ${imgWidthPt} 0 0 ${imgHeightPt} ${pageMargin} ${pageMargin + sliceHeight - imgHeightPt + sliceY} cm /Img Do Q`;
      pagesPdf += `${contentObjNum} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`;
    }
    const pagesPdfBytes = new TextEncoder().encode(pagesPdf);

    // Combine all parts
    const totalLength = pdfHeader.length + jpegBytes.length + pdfAfterStream.length + pagesPdfBytes.length;
    const xrefOffset = totalLength;

    // Build xref
    const totalObjects = 4 + pages * 2;
    let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
    // We can't easily compute exact offsets without tracking, so use a simpler approach:
    // Convert to blob URL instead of inline PDF

    // Simpler approach: create PDF blob from canvas
    const pdfBlob = await this._canvasToPDFBlob(canvas, img.width, img.height, imgWidthPt, imgHeightPt, pageHeight, pages, pageMargin);
    return URL.createObjectURL(pdfBlob);
  },

  async _canvasToPDFBlob(canvas, imgW, imgH, imgWidthPt, imgHeightPt, pageHeightPt, pages, margin) {
    // Minimal PDF generator
    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.92);
    const jpegBase64 = jpegDataUrl.split(',')[1];
    const jpegBinary = atob(jpegBase64);
    const jpegLen = jpegBinary.length;

    const objects = [];
    let objCount = 0;

    function addObj(content) {
      objCount++;
      objects.push(content);
      return objCount;
    }

    // 1: Catalog
    addObj('<< /Type /Catalog /Pages 2 0 R >>');

    // 2: Pages - will be updated
    addObj(null); // placeholder

    // 3: Image
    addObj(`<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpegLen} >>`);

    // Page and content objects
    const pageObjNums = [];
    for (let p = 0; p < pages; p++) {
      const sliceHeight = Math.min(pageHeightPt, imgHeightPt - p * pageHeightPt);
      const ph = sliceHeight + margin * 2;
      const pw = imgWidthPt + margin * 2;

      // Content stream
      const yOffset = margin + sliceHeight - imgHeightPt + p * pageHeightPt;
      const contentStr = `q ${imgWidthPt} 0 0 ${imgHeightPt} ${margin} ${yOffset} cm /Img Do Q`;
      const contentObjNum = addObj(`<< /Length ${contentStr.length} >>\nstream\n${contentStr}\nendstream`);

      const pageObjNum = addObj(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pw.toFixed(2)} ${ph.toFixed(2)}] /Contents ${contentObjNum} 0 R /Resources << /XObject << /Img 3 0 R >> >> >>`);
      pageObjNums.push(pageObjNum);
    }

    // Update Pages object
    objects[1] = `<< /Type /Pages /Kids [${pageObjNums.map(n => n + ' 0 R').join(' ')}] /Count ${pages} >>`;

    // Build PDF binary
    const parts = [];
    const offsets = [];

    const header = '%PDF-1.4\n';
    parts.push(new TextEncoder().encode(header));
    let pos = header.length;

    for (let i = 0; i < objects.length; i++) {
      offsets.push(pos);
      const objNum = i + 1;
      const objHeader = `${objNum} 0 obj\n${objects[i]}\n`;

      if (objNum === 3) {
        // Image object - insert binary JPEG stream
        const beforeStream = `${objNum} 0 obj\n${objects[i]}\nstream\n`;
        const afterStream = '\nendstream\nendobj\n';
        parts.push(new TextEncoder().encode(beforeStream));
        pos += beforeStream.length;

        // Add JPEG binary data
        const jpegArr = new Uint8Array(jpegLen);
        for (let j = 0; j < jpegLen; j++) {
          jpegArr[j] = jpegBinary.charCodeAt(j);
        }
        parts.push(jpegArr);
        pos += jpegLen;

        parts.push(new TextEncoder().encode(afterStream));
        pos += afterStream.length;
      } else {
        const objStr = `${objNum} 0 obj\n${objects[i]}\nendobj\n`;
        parts.push(new TextEncoder().encode(objStr));
        pos += objStr.length;
      }
    }

    // xref table
    const xrefPos = pos;
    let xref = `xref\n0 ${objects.length + 1}\n`;
    xref += '0000000000 65535 f \n';
    for (const offset of offsets) {
      xref += String(offset).padStart(10, '0') + ' 00000 n \n';
    }
    xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
    xref += `startxref\n${xrefPos}\n%%EOF`;
    parts.push(new TextEncoder().encode(xref));

    return new Blob(parts, { type: 'application/pdf' });
  },

  async _triggerDownload(dataUrl, filename, format) {
    // If it's a blob URL (for PDF), handle differently
    if (dataUrl.startsWith('blob:')) {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({
          action: 'downloadImage',
          dataUrl: dataUrl,
          filename: filename,
          format: format
        }, resolve);
      });
    }

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({
        action: 'downloadImage',
        dataUrl: dataUrl,
        filename: filename,
        format: format
      }, resolve);
    });
  },

  _generateFilename(extension) {
    const now = new Date();
    const domain = window.location.hostname.replace(/\./g, '_');
    const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
    return `pagesnap_${domain}_${ts}.${extension}`;
  },

  _loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = dataUrl;
    });
  },

  _dataUrlToBlob(dataUrl) {
    return new Promise((resolve) => {
      const arr = dataUrl.split(',');
      const mime = arr[0].match(/:(.*?);/)[1];
      const bstr = atob(arr[1]);
      const u8arr = new Uint8Array(bstr.length);
      for (let i = 0; i < bstr.length; i++) {
        u8arr[i] = bstr.charCodeAt(i);
      }
      resolve(new Blob([u8arr], { type: mime }));
    });
  }
};
