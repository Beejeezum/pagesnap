/**
 * PageSnap - YouTube Integration
 * Utility methods for YouTube video IDs, thumbnails, timestamps.
 * NOTE: Transcript extraction now happens in editor.js directly (not here)
 * because service workers have no DOM APIs (DOMParser, document, etc).
 */

const PageSnapYouTube = {
  /**
   * Extract video ID from a YouTube URL
   */
  getVideoId(url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes('youtube.com')) {
        return u.searchParams.get('v') || u.pathname.split('/').pop();
      }
      if (u.hostname === 'youtu.be') {
        return u.pathname.slice(1).split('/')[0];
      }
    } catch (e) {}
    return null;
  },

  /**
   * Check if a URL is a YouTube video
   */
  isYouTubeVideo(url) {
    return !!this.getVideoId(url);
  },

  /**
   * Get all thumbnail URLs for a video
   */
  getThumbnails(videoId) {
    return {
      default: `https://img.youtube.com/vi/${videoId}/default.jpg`,
      medium: `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`,
      high: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
      standard: `https://img.youtube.com/vi/${videoId}/sddefault.jpg`,
      maxres: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`
    };
  },

  /**
   * Get transcript text for a specific time range
   */
  getTranscriptRange(segments, startTime, endTime) {
    return segments
      .filter(s => s.start >= startTime && s.start <= endTime)
      .map(s => s.text)
      .join(' ');
  },

  /**
   * Get full transcript as plain text
   */
  getFullTranscriptText(segments) {
    return segments.map(s => s.text).join(' ');
  },

  /**
   * Get transcript with timestamps
   */
  getTimestampedTranscript(segments) {
    return segments.map(s => `[${s.timestamp}] ${s.text}`).join('\n');
  },

  /**
   * Format seconds to HH:MM:SS or MM:SS
   */
  _formatDuration(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${m}:${String(s).padStart(2,'0')}`;
  },

  /**
   * Parse a timestamp string (MM:SS or HH:MM:SS) to seconds
   */
  parseTimestamp(ts) {
    const parts = ts.split(':').map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0] || 0;
  }
};
