/**
 * PageSnap - Popup Script
 * Mode selector UI and recent captures display.
 */

document.addEventListener('DOMContentLoaded', () => {
  // Capture mode buttons
  const captureButtons = document.querySelectorAll('.capture-btn[data-mode]');
  captureButtons.forEach(btn => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.mode;
      btn.classList.add('loading');

      try {
        const response = await chrome.runtime.sendMessage({
          action: 'startCapture',
          mode: mode
        });

        if (response?.error) {
          console.error('Capture error:', response.error);
        }
      } catch (err) {
        console.error('Failed to start capture:', err);
      }

      // Close popup after initiating capture
      setTimeout(() => window.close(), 150);
    });
  });

  // Load recent captures
  loadRecentCaptures();

  // Clear history button
  document.getElementById('clearHistory').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ action: 'clearHistory' });
    document.getElementById('recentSection').style.display = 'none';
  });
});

async function loadRecentCaptures() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'getHistory' });
    const history = response?.history || [];

    if (history.length === 0) return;

    const section = document.getElementById('recentSection');
    const grid = document.getElementById('recentGrid');
    section.style.display = 'block';

    // Show up to 6 recent thumbnails in the popup
    const recent = history.slice(0, 6);
    grid.innerHTML = '';

    for (const capture of recent) {
      const thumb = document.createElement('div');
      thumb.className = 'recent-thumb';
      thumb.title = `${capture.title || 'Untitled'}\n${capture.url || ''}\n${new Date(capture.timestamp).toLocaleString()}`;

      if (capture.thumbnail) {
        const img = document.createElement('img');
        img.src = capture.thumbnail;
        img.alt = capture.title || 'Capture';
        thumb.appendChild(img);
      }

      grid.appendChild(thumb);
    }
  } catch (err) {
    console.error('Failed to load history:', err);
  }
}
