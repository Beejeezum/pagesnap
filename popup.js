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
  detectYouTube();
});

// --- YouTube Detection ---
async function detectYouTube() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.url && (tab.url.includes('youtube.com/watch') || tab.url.includes('youtu.be/'))) {
      document.getElementById('youtubeBtn').style.display = 'flex';
    }
  } catch (e) {}
}

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

  try {
    if (filter === 'favorites') {
      response = await chrome.runtime.sendMessage({ action: 'swipefileGetFavorites' });
    } else {
      response = await chrome.runtime.sendMessage({ action: 'swipefileGetAll' });
    }
  } catch (e) {
    list.textContent = '';
    const err = document.createElement('div');
    err.className = 'empty-state';
    err.textContent = 'Failed to load library.';
    list.appendChild(err);
    return;
  }

  const items = response?.items || [];

  if (items.length === 0) {
    list.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const p1 = document.createElement('p');
    p1.textContent = 'No captures yet.';
    const p2 = document.createElement('p');
    p2.className = 'muted';
    p2.textContent = 'Captured content will appear here.';
    empty.appendChild(p1);
    empty.appendChild(p2);
    list.appendChild(empty);
    return;
  }

  list.textContent = '';
  if (items.length > 30) {
    const note = document.createElement('div');
    note.className = 'library-item-domain';
    note.style.cssText = 'padding:4px 8px;font-size:11px;';
    note.textContent = `Showing 30 of ${items.length} items`;
    list.appendChild(note);
  }
  items.slice(0, 30).forEach(item => {
    const el = document.createElement('div');
    el.className = 'library-item';

    const content = document.createElement('div');
    content.className = 'library-item-content';
    const title = document.createElement('div');
    title.className = 'library-item-title';
    title.textContent = item.title || 'Untitled';
    const domain = document.createElement('div');
    domain.className = 'library-item-domain';
    domain.textContent = (item.domain || '') + ' \u00B7 ' + timeAgo(item.timestamp);
    content.appendChild(title);
    content.appendChild(domain);

    const fav = document.createElement('button');
    fav.className = 'library-item-fav' + (item.favorite ? ' active' : '');
    fav.dataset.id = item.id;
    fav.title = 'Toggle favorite';
    fav.textContent = item.favorite ? '\u2605' : '\u2606';

    el.appendChild(content);
    el.appendChild(fav);

    content.addEventListener('click', () => {
      if (item.url) {
        chrome.tabs.create({ url: item.url });
      }
    });

    fav.addEventListener('click', async (e) => {
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
    list.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    const p = document.createElement('p');
    p.textContent = 'No results found.';
    empty.appendChild(p);
    list.appendChild(empty);
    return;
  }
  list.textContent = '';
  items.forEach(item => {
    const el = document.createElement('div');
    el.className = 'library-item';
    const content = document.createElement('div');
    content.className = 'library-item-content';
    const title = document.createElement('div');
    title.className = 'library-item-title';
    title.textContent = item.title || 'Untitled';
    const domain = document.createElement('div');
    domain.className = 'library-item-domain';
    domain.textContent = (item.domain || '') + (item.timestamp ? ' \u00B7 ' + timeAgo(item.timestamp) : '');
    content.appendChild(title);
    content.appendChild(domain);

    const fav = document.createElement('button');
    fav.className = 'library-item-fav' + (item.favorite ? ' active' : '');
    fav.dataset.id = item.id;
    fav.title = 'Toggle favorite';
    fav.textContent = item.favorite ? '\u2605' : '\u2606';

    el.appendChild(content);
    el.appendChild(fav);

    content.addEventListener('click', () => {
      if (item.url) chrome.tabs.create({ url: item.url });
    });

    fav.addEventListener('click', async (e) => {
      e.stopPropagation();
      await chrome.runtime.sendMessage({ action: 'swipefileToggleFavorite', id: item.id });
      // Re-run the search to refresh results
      const query = document.getElementById('librarySearch').value.trim();
      if (query) {
        const response = await chrome.runtime.sendMessage({ action: 'swipefileSearch', query });
        renderSearchResults(response?.items || []);
      } else {
        loadLibrary(document.querySelector('.filter-btn.active')?.dataset.filter);
      }
    });

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
