/**
 * PageSnap v2 - Popup Script
 * Command center: Capture, Create (AI), Library (Swipe File)
 */

document.addEventListener('DOMContentLoaded', () => {
  setupTabs();
  setupCaptureButtons();
  setupCreateButtons();
  setupLibrary();
  setupSettings();
});

// --- Tabs ---
function setupTabs() {
  const tabs = document.querySelectorAll('.tab');
  const contents = document.querySelectorAll('.tab-content');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      contents.forEach(c => c.classList.remove('active'));

      tab.classList.add('active');
      const target = tab.dataset.tab;
      document.getElementById(target + 'Tab').classList.add('active');

      if (target === 'library') loadLibrary();
    });
  });
}

// --- Capture Buttons ---
function setupCaptureButtons() {
  document.querySelectorAll('.capture-btn[data-mode]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const mode = btn.dataset.mode;
      btn.classList.add('loading');

      try {
        if (mode === 'content') {
          // Content-only extraction (no screenshot)
          await chrome.runtime.sendMessage({
            action: 'startCapture',
            mode: 'content'
          });
        } else {
          await chrome.runtime.sendMessage({
            action: 'startCapture',
            mode: mode
          });
        }
      } catch (err) {
        console.error('Capture failed:', err);
      }

      setTimeout(() => window.close(), 150);
    });
  });
}

// --- Create Buttons (AI Output) ---
function setupCreateButtons() {
  document.querySelectorAll('.create-btn[data-output]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const outputMode = btn.dataset.output;
      btn.classList.add('loading');

      try {
        // Extract content and generate in one step
        await chrome.runtime.sendMessage({
          action: 'startCapture',
          mode: 'create',
          outputMode: outputMode
        });
      } catch (err) {
        console.error('Create failed:', err);
      }

      setTimeout(() => window.close(), 150);
    });
  });
}

// --- Library (Swipe File) ---
async function loadLibrary(filter) {
  const list = document.getElementById('libraryList');
  let response;

  if (filter === 'favorites') {
    response = await chrome.runtime.sendMessage({ action: 'swipefileGetFavorites' });
  } else {
    response = await chrome.runtime.sendMessage({ action: 'swipefileGetAll' });
  }

  const items = response?.items || [];

  if (items.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <p>No captures yet.</p>
        <p class="muted">Captured content will appear here.</p>
      </div>
    `;
    return;
  }

  list.innerHTML = '';
  items.slice(0, 30).forEach(item => {
    const el = document.createElement('div');
    el.className = 'library-item';
    el.innerHTML = `
      <div class="library-item-content">
        <div class="library-item-title">${escapeHtml(item.title || 'Untitled')}</div>
        <div class="library-item-domain">${escapeHtml(item.domain || '')} &middot; ${timeAgo(item.timestamp)}</div>
      </div>
      <button class="library-item-fav ${item.favorite ? 'active' : ''}" data-id="${item.id}" title="Toggle favorite">
        ${item.favorite ? '\u2605' : '\u2606'}
      </button>
    `;

    // Click to open (future: open detail view)
    el.querySelector('.library-item-content').addEventListener('click', () => {
      // For now, open the URL
      if (item.url) {
        chrome.tabs.create({ url: item.url });
      }
    });

    // Favorite toggle
    el.querySelector('.library-item-fav').addEventListener('click', async (e) => {
      e.stopPropagation();
      await chrome.runtime.sendMessage({
        action: 'swipefileToggleFavorite',
        id: item.id
      });
      loadLibrary(document.querySelector('.filter-btn.active')?.dataset.filter);
    });

    list.appendChild(el);
  });
}

function setupLibrary() {
  // Filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      loadLibrary(btn.dataset.filter);
    });
  });

  // Search
  let searchTimeout;
  document.getElementById('librarySearch').addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(async () => {
      const query = e.target.value.trim();
      if (!query) {
        loadLibrary();
        return;
      }
      const response = await chrome.runtime.sendMessage({
        action: 'swipefileSearch',
        query: query
      });
      renderSearchResults(response?.items || []);
    }, 300);
  });
}

function renderSearchResults(items) {
  const list = document.getElementById('libraryList');
  if (items.length === 0) {
    list.innerHTML = `<div class="empty-state"><p>No results found.</p></div>`;
    return;
  }
  // Reuse same render logic
  list.innerHTML = '';
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'library-item';
    el.innerHTML = `
      <div class="library-item-content">
        <div class="library-item-title">${escapeHtml(item.title || 'Untitled')}</div>
        <div class="library-item-domain">${escapeHtml(item.domain || '')}</div>
      </div>
    `;
    list.appendChild(el);
  });
}

// --- Settings ---
function setupSettings() {
  document.getElementById('settingsBtn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage?.() ||
      chrome.tabs.create({ url: chrome.runtime.getURL('settings/settings.html') });
  });
}

// --- Helpers ---
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function timeAgo(timestamp) {
  if (!timestamp) return '';
  const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
  if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
  if (seconds < 604800) return Math.floor(seconds / 86400) + 'd ago';
  return new Date(timestamp).toLocaleDateString();
}
