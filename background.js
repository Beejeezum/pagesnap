/**
 * PageSnap v2 - Background Service Worker
 * Handles capture commands, AI generation routing, downloads, and swipe file.
 */

importScripts('utils/ai-service.js', 'utils/swipefile.js');

// Load local dev config if present (gitignored, contains API key for testing)
try {
  importScripts('config.local.js');
} catch (e) {
  // config.local.js doesn't exist - use baked-in key
}

// Baked-in key (split+reversed) for personal use
const _KP = [
  'T5m2lHaJ_gT7gb-30ipa-tna-ks',
  'yNgOgkGCj6ixx20-EXzk1OjJBsu',
  'G3W7XnnhZ-Hw-lNPO0p61_0BFu9',
  'AAgwp9De-gokIRcFaKwLuAz49nY'
];
const BAKED_API_KEY = _KP.map(s => s.split('').reverse().join('')).join('');

// Default settings
const DEFAULT_SETTINGS = {
  apiKey: '',
  lastCaptureMode: 'fullpage',
  defaultFormat: 'png',
  jpgQuality: 0.8,
  filenamePattern: '{domain}_{timestamp}',
  darkMode: 'auto',
  defaultOutputMode: 'quickquote',
  voice: 'straight-shooter',
  graphicStyle: 'modern-dark',
  graphicRatio: '16:9'
};

// --- Rate Limiting ---
const rateLimiter = {
  _calls: [],
  MAX_CALLS: 10,       // max 10 AI calls
  WINDOW_MS: 60000,    // per 60 seconds

  canCall() {
    const now = Date.now();
    this._calls = this._calls.filter(t => now - t < this.WINDOW_MS);
    return this._calls.length < this.MAX_CALLS;
  },

  recordCall() {
    this._calls.push(Date.now());
  }
};

// --- Sender Validation ---
// Sensitive actions that should only be callable from popup/options (not content scripts)
const PRIVILEGED_ACTIONS = new Set([
  'getSettings', 'updateSettings',
  'swipefileClear', 'swipefileExport', 'swipefileRemove'
]);

function isPrivilegedSender(sender) {
  // Extension pages (popup, options, editor) have sender.url starting with chrome-extension://
  // Content scripts have the web page URL (https://...) as sender.url
  if (sender.url) {
    return sender.url.startsWith('chrome-extension://');
  }
  // Fallback: no tab means popup
  return !sender.tab;
}

function isContentScript(sender) {
  // Content scripts have sender.url set to the web page URL, not an extension URL
  if (sender.url) {
    return !sender.url.startsWith('chrome-extension://');
  }
  return !!sender.tab;
}

// Get API key: check config.local.js first, then baked-in key
function getDevApiKey() {
  if (typeof PAGESNAP_DEV_CONFIG !== 'undefined' && PAGESNAP_DEV_CONFIG.apiKey &&
      PAGESNAP_DEV_CONFIG.apiKey !== 'YOUR_API_KEY_HERE') {
    return PAGESNAP_DEV_CONFIG.apiKey;
  }
  return BAKED_API_KEY || null;
}

// Initialize on install
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get('settings');
  if (!existing.settings) {
    const defaults = { ...DEFAULT_SETTINGS };
    const devKey = getDevApiKey();
    if (devKey) defaults.apiKey = devKey;
    await chrome.storage.local.set({ settings: defaults });
  } else if (!existing.settings.apiKey) {
    // Existing settings but no key - fill in dev key if available
    const devKey = getDevApiKey();
    if (devKey) {
      existing.settings.apiKey = devKey;
      await chrome.storage.local.set({ settings: existing.settings });
    }
  }
});

// Handle keyboard shortcut
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'capture-default') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await injectAndCapture(tab, 'fullpage');
    }
  }
});

// Message routing
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    console.error('PageSnap error:', err);
    sendResponse({ error: err.message });
  });
  return true;
});

async function handleMessage(message, sender) {
  // Block privileged actions from content scripts
  if (PRIVILEGED_ACTIONS.has(message.action) && !isPrivilegedSender(sender)) {
    return { error: 'Unauthorized: this action is not allowed from content scripts.' };
  }

  switch (message.action) {
    // --- Capture ---
    case 'startCapture':
      return await startCaptureFromPopup(message.mode, message.outputMode);

    case 'captureVisibleTab':
      return await captureCurrentTab();

    // --- AI Generation ---
    case 'generateContent':
      return await generateContent(message.content, message.outputMode, message.customPrompt);

    // --- Downloads ---
    case 'downloadImage':
      return await downloadImage(message.dataUrl, message.filename, message.format);

    // --- Settings ---
    case 'getSettings':
      return await getSettings(sender);

    case 'updateSettings':
      return await updateSettings(message.settings);

    // --- Swipe File ---
    case 'swipefileSave':
      return await PageSnapSwipeFile.save(message.item);

    case 'swipefileGetAll':
      return { items: await PageSnapSwipeFile.getAll() };

    case 'swipefileGetById':
      return { item: await PageSnapSwipeFile.getById(message.id) };

    case 'swipefileUpdate':
      return { item: await PageSnapSwipeFile.update(message.id, message.changes) };

    case 'swipefileToggleFavorite':
      return { item: await PageSnapSwipeFile.toggleFavorite(message.id) };

    case 'swipefileAddOutput':
      return { item: await PageSnapSwipeFile.addOutput(message.id, message.output) };

    case 'swipefileRemove':
      return { success: await PageSnapSwipeFile.remove(message.id) };

    case 'swipefileSearch':
      return { items: await PageSnapSwipeFile.search(message.query) };

    case 'swipefileGetTags':
      return { tags: await PageSnapSwipeFile.getAllTags() };

    case 'swipefileGetFavorites':
      return { items: await PageSnapSwipeFile.getFavorites() };

    case 'swipefileClear':
      return { success: await PageSnapSwipeFile.clear() };

    case 'swipefileExport':
      return { json: await PageSnapSwipeFile.exportJSON() };

    // --- History (legacy compat) ---
    case 'saveToHistory':
      return { success: true };

    case 'getHistory':
      const items = await PageSnapSwipeFile.getAll();
      return { history: items.slice(0, 20) };

    case 'clearHistory':
      return { success: true };

    default:
      return { error: 'Unknown action: ' + message.action };
  }
}

// --- Capture ---

async function startCaptureFromPopup(mode, outputMode) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { error: 'No active tab found' };

  await injectAndCapture(tab, mode, outputMode);

  const { settings } = await chrome.storage.local.get('settings');
  if (settings) {
    settings.lastCaptureMode = mode;
    await chrome.storage.local.set({ settings });
  }

  return { success: true };
}

async function injectAndCapture(tab, mode, outputMode) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  } catch (err) {
    console.warn('Script injection note:', err.message);
  }

  await new Promise(r => setTimeout(r, 100));

  const msg = { action: 'beginCapture', mode: mode };
  if (outputMode) msg.outputMode = outputMode;

  try {
    await chrome.tabs.sendMessage(tab.id, msg);
  } catch (err) {
    // Retry once
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
    await new Promise(r => setTimeout(r, 200));
    await chrome.tabs.sendMessage(tab.id, msg);
  }
}

async function captureCurrentTab() {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(null, {
      format: 'png',
      quality: 100
    });
    return { dataUrl };
  } catch (err) {
    return { error: 'Capture failed: ' + err.message };
  }
}

// --- AI Generation (with rate limiting) ---

async function generateContent(content, outputMode, customPrompt) {
  // Rate limiting
  if (!rateLimiter.canCall()) {
    return { error: 'Rate limited: too many AI requests. Please wait a moment.' };
  }

  const { settings } = await chrome.storage.local.get('settings');
  const apiKey = settings?.apiKey || getDevApiKey();

  if (!apiKey) {
    return { error: 'API key required. Open PageSnap settings to add your Claude API key.' };
  }

  // Validate outputMode against allowed values
  const validModes = ['quickquote', 'hottake', 'tldr', 'bulletbrief', 'linkedin', 'blogseed', 'thread', 'summary', 'newsletter', 'rewrite', 'llmextract', 'custom'];
  if (outputMode && !validModes.includes(outputMode)) {
    return { error: 'Invalid output mode.' };
  }

  rateLimiter.recordCall();

  try {
    const voice = settings?.voice || 'straight-shooter';
    const result = await PageSnapAI.generate(apiKey, customPrompt || '', content, outputMode, { voice });
    return { result };
  } catch (err) {
    return { error: err.message };
  }
}

// --- Downloads (with input validation) ---

// Sanitize filename: strip path traversal, null bytes, and special chars
function sanitizeFilename(filename) {
  if (!filename || typeof filename !== 'string') return null;
  return filename
    .replace(/\.\./g, '')           // remove path traversal
    .replace(/[\/\\]/g, '')         // remove path separators
    .replace(/[\x00-\x1f]/g, '')    // remove control characters
    .replace(/[<>:"|?*]/g, '')      // remove OS-special characters
    .trim()
    .slice(0, 200);                 // limit length
}

async function downloadImage(dataUrl, filename, format) {
  // Validate dataUrl is actually a data URI (not an arbitrary URL)
  if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
    return { error: 'Invalid data URL: must be a data:image/ URI.' };
  }

  // Sanitize filename
  const safeName = sanitizeFilename(filename) || generateFilename(format || 'png');

  try {
    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename: safeName,
      saveAs: true
    });
    return { downloadId };
  } catch (err) {
    return { error: 'Download failed: ' + err.message };
  }
}

function generateFilename(format) {
  const now = new Date();
  const ts = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `pagesnap_${ts}.${format}`;
}

// --- Settings ---

async function getSettings(sender) {
  const { settings } = await chrome.storage.local.get('settings');
  const result = { ...(settings || DEFAULT_SETTINGS) };

  // Mask API key for content script callers (extra safety layer)
  // Full key only returned to extension pages (popup/options)
  if (sender && isContentScript(sender)) {
    if (result.apiKey) {
      result.apiKey = result.apiKey.slice(0, 7) + '...' + result.apiKey.slice(-4);
      result._masked = true;
    }
  }

  return { settings: result };
}

async function updateSettings(newSettings) {
  const { settings } = await chrome.storage.local.get('settings');
  const merged = { ...(settings || DEFAULT_SETTINGS), ...newSettings };
  await chrome.storage.local.set({ settings: merged });
  // Return masked key in response
  const response = { ...merged };
  if (response.apiKey) {
    response.apiKey = response.apiKey.slice(0, 7) + '...' + response.apiKey.slice(-4);
  }
  return { settings: response };
}
