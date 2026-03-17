/**
 * PageSnap - YouTube Integration
 * Extracts transcripts, metadata, thumbnails from YouTube videos.
 * Works both from the YouTube page (content script) and via URL (background fetch).
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
   * Extract video metadata from the YouTube page DOM (content script context)
   */
  extractFromPage() {
    const videoId = this.getVideoId(window.location.href);
    if (!videoId) return null;

    const meta = {
      videoId,
      url: window.location.href,
      thumbnails: this.getThumbnails(videoId),
      title: '',
      channel: '',
      description: '',
      duration: '',
      publishDate: '',
      viewCount: ''
    };

    // Title
    const titleEl = document.querySelector('h1.ytd-watch-metadata yt-formatted-string, #title h1 yt-formatted-string, h1.title');
    if (titleEl) meta.title = titleEl.textContent.trim();
    else {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) meta.title = ogTitle.content;
    }

    // Channel
    const channelEl = document.querySelector('#channel-name a, ytd-channel-name a, #upload-info a');
    if (channelEl) meta.channel = channelEl.textContent.trim();

    // Description
    const descEl = document.querySelector('#description-inner, ytd-text-inline-expander > yt-attributed-string, #description yt-attributed-string');
    if (descEl) meta.description = descEl.textContent.trim().substring(0, 2000);

    // View count
    const viewEl = document.querySelector('.view-count, ytd-video-view-count-renderer span');
    if (viewEl) meta.viewCount = viewEl.textContent.trim();

    // Publish date
    const dateEl = document.querySelector('#info-strings yt-formatted-string, ytd-video-primary-info-renderer .date');
    if (dateEl) meta.publishDate = dateEl.textContent.trim();

    // Duration from video element
    const video = document.querySelector('video');
    if (video && video.duration) {
      meta.duration = this._formatDuration(video.duration);
      meta.durationSeconds = Math.floor(video.duration);
    }

    return meta;
  },

  /**
   * Get current playback time from YouTube player
   */
  getCurrentTime() {
    const video = document.querySelector('video');
    return video ? video.currentTime : 0;
  },

  /**
   * Extract transcript from YouTube page
   * Tries multiple methods: page data, captions API
   */
  async extractTranscript(videoId) {
    // Method 1: Try to get from page's ytInitialPlayerResponse
    let captionUrl = this._getCaptionUrlFromPage();
    if (!captionUrl) {
      // Method 2: Fetch the watch page and parse
      captionUrl = await this._fetchCaptionUrl(videoId);
    }

    if (!captionUrl) {
      return { error: 'No captions available for this video.', segments: [] };
    }

    try {
      const response = await fetch(captionUrl);
      const text = await response.text();
      const segments = this._parseCaptionXML(text);
      return { segments, error: null };
    } catch (e) {
      return { error: 'Failed to fetch captions: ' + e.message, segments: [] };
    }
  },

  /**
   * Get caption URL from the current page's player response
   */
  _getCaptionUrlFromPage() {
    try {
      // Look for ytInitialPlayerResponse in page scripts
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent;
        if (text.includes('captionTracks')) {
          const match = text.match(/"captionTracks":\s*(\[.*?\])/);
          if (match) {
            const tracks = JSON.parse(match[1]);
            // Prefer English, fall back to first available
            const en = tracks.find(t => t.languageCode === 'en' || t.languageCode?.startsWith('en'));
            const track = en || tracks[0];
            if (track?.baseUrl) return track.baseUrl;
          }
        }
      }
    } catch (e) {}
    return null;
  },

  /**
   * Fetch caption URL by loading the video page
   */
  async _fetchCaptionUrl(videoId) {
    try {
      const response = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
        headers: { 'Accept-Language': 'en-US,en' }
      });
      const html = await response.text();
      const match = html.match(/"captionTracks":\s*(\[.*?\])/);
      if (match) {
        const tracks = JSON.parse(match[1]);
        const en = tracks.find(t => t.languageCode === 'en' || t.languageCode?.startsWith('en'));
        const track = en || tracks[0];
        if (track?.baseUrl) return track.baseUrl;
      }
    } catch (e) {}
    return null;
  },

  /**
   * Parse YouTube caption XML into timestamped segments
   */
  _parseCaptionXML(xmlText) {
    const segments = [];
    // YouTube captions come as XML: <text start="1.23" dur="4.56">caption text</text>
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlText, 'text/xml');
    const textNodes = doc.querySelectorAll('text');

    for (const node of textNodes) {
      const start = parseFloat(node.getAttribute('start') || 0);
      const dur = parseFloat(node.getAttribute('dur') || 0);
      // Decode HTML entities in caption text
      const temp = document.createElement('div');
      temp.textContent = node.textContent;
      const text = temp.textContent.trim();

      if (text) {
        segments.push({
          start,
          end: start + dur,
          duration: dur,
          text,
          timestamp: this._formatDuration(start)
        });
      }
    }

    return segments;
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
