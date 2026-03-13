/**
 * PageSnap - Stitch Utilities
 * Canvas compositing for stitching scroll captures into a single image.
 */

const PageSnapStitch = {
  /**
   * Stitch an array of viewport captures into a single full-page image.
   * @param {Array} captures - Array of {dataUrl, y, height, viewportHeight}
   * @param {number} pageWidth - Total page width in CSS pixels
   * @param {number} pageHeight - Total page height in CSS pixels
   * @param {number} dpr - Device pixel ratio
   * @returns {string} Data URL of the stitched image
   */
  async stitchCaptures(captures, pageWidth, pageHeight, dpr) {
    if (captures.length === 0) {
      throw new Error('No captures to stitch');
    }

    // Single capture - return as-is (with potential crop)
    if (captures.length === 1) {
      return await this._cropSingleCapture(captures[0], pageWidth, pageHeight, dpr);
    }

    // Load all images in parallel
    const images = await Promise.all(
      captures.map(c => this._loadImage(c.dataUrl))
    );

    // Create output canvas at the correct dimensions
    const outputWidth = Math.round(pageWidth * dpr);
    const outputHeight = Math.round(pageHeight * dpr);

    // Check if page is extremely tall - split if needed
    if (outputHeight > 32767) {
      // Canvas max height varies by browser, 32767 is a safe limit
      console.warn('PageSnap: Page is very tall, capping at 32767px');
    }

    const canvas = document.createElement('canvas');
    canvas.width = outputWidth;
    canvas.height = Math.min(outputHeight, 32767);
    const ctx = canvas.getContext('2d');

    // Draw each captured viewport at its correct position
    for (let i = 0; i < captures.length; i++) {
      const capture = captures[i];
      const img = images[i];

      const drawY = Math.round(capture.y * dpr);
      let srcHeight = img.height;
      let drawHeight = srcHeight;

      // For the last capture, only draw the portion that fits within pageHeight
      if (i === captures.length - 1) {
        const remainingPixels = Math.round(pageHeight * dpr) - drawY;
        if (remainingPixels < drawHeight) {
          // Crop from the bottom of the viewport image
          const srcY = drawHeight - remainingPixels;
          ctx.drawImage(
            img,
            0, srcY, img.width, remainingPixels,
            0, drawY, img.width, remainingPixels
          );
          continue;
        }
      }

      ctx.drawImage(img, 0, drawY);
    }

    return canvas.toDataURL('image/png');
  },

  /**
   * Crop a single capture to the actual page dimensions
   */
  async _cropSingleCapture(capture, pageWidth, pageHeight, dpr) {
    const img = await this._loadImage(capture.dataUrl);

    const targetHeight = Math.round(pageHeight * dpr);
    const targetWidth = Math.round(pageWidth * dpr);

    // If viewport matches or exceeds page, just crop
    if (img.height >= targetHeight && img.width >= targetWidth) {
      if (img.height === targetHeight && img.width === targetWidth) {
        return capture.dataUrl;
      }
      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, targetWidth, targetHeight, 0, 0, targetWidth, targetHeight);
      return canvas.toDataURL('image/png');
    }

    return capture.dataUrl;
  },

  /**
   * Load an image from a data URL
   */
  _loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load capture image'));
      img.src = dataUrl;
    });
  }
};
