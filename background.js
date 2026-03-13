/**
 * PageSnap v2 - Background Service Worker
 * Handles capture commands, AI generation routing, downloads, and swipe file.
 */

importScripts('utils/ai-service.js', 'utils/swipefile.js');

// Default settings
const DEFAULT_SETTINGS = {
  apiKey: '',
  lastCaptureMode: 'fullpage',
  defaultFormat: 'png',
  jpgQuality: 0.8,
  filenamePattern: '{domain}_{timestamp}',
  darkMode: 'auto',
  defaultOutputMode: 'quickquote',
  graphicStyle: 'modern-dark',
  graphicRatio: '16:9'
};

// Initialize on install
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get('settings');
  if (!existing.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
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
  switch (message.action) {
    // --- Capture ---
    case 'startCapture':
      return await startCaptureFromPopup(message.mode);

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
      return await getSettings();

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

async function startCaptureFromPopup(mode) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return { error: 'No active tab found' };

  await injectAndCapture(tab, mode);

  const { settings } = await chrome.storage.local.get('settings');
  if (settings) {
    settings.lastCaptureMode = mode;
    await chrome.storage.local.set({ settings });
  }

  return { success: true };
}

async function injectAndCapture(tab, mode) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  } catch (err) {
    console.warn('Script injection note:', err.message);
  }

  await new Promise(r => setTimeout(r, 100));

  try {
    await chrome.tabs.sendMessage(tab.id, {
      action: 'beginCapture',
      mode: mode
    });
  } catch (err) {
    // Retry once
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
    await new Promise(r => setTimeout(r, 200));
    await chrome.tabs.sendMessage(tab.id, {
      action: 'beginCapture',
      mode: mode
    });
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

// --- AI Generation ---

async function generateContent(content, outputMode, customPrompt) {
  const { settings } = await chrome.storage.local.get('settings');
  const apiKey = settings?.apiKey;

  if (!apiKey) {
    return { error: 'API key required. Open PageSnap settings to add your Claude API key.' };
  }

  try {
    const result = await PageSnapAI.generate(apiKey, customPrompt || '', content, outputMode);
    return { result };
  } catch (err) {
    return { error: err.message };
  }
}

// --- Downloads ---

async function downloadImage(dataUrl, filename, format) {
  try {
    const downloadId = await chrome.downloads.download({
      url: dataUrl,
      filename: filename || generateFilename(format || 'png'),
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

async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { settings: settings || DEFAULT_SETTINGS };
}

async function updateSettings(newSettings) {
  const { settings } = await chrome.storage.local.get('settings');
  const merged = { ...(settings || DEFAULT_SETTINGS), ...newSettings };
  await chrome.storage.local.set({ settings: merged });
  return { settings: merged };
}
