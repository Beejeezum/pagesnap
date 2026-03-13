/**
 * PageSnap - Background Service Worker
 * Handles capture commands, message routing, and download coordination.
 */

// Default settings
const DEFAULT_SETTINGS = {
  lastCaptureMode: 'fullpage',
  defaultFormat: 'png',
  jpgQuality: 0.8,
  filenamePattern: '{domain}_{timestamp}',
  metadataStamp: false,
  scrollDelay: 150,
  darkMode: 'auto'
};

// Initialize settings on install
chrome.runtime.onInstalled.addListener(async () => {
  const existing = await chrome.storage.local.get('settings');
  if (!existing.settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS });
  }
});

// Handle keyboard shortcut command
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'capture-default') {
    const { settings } = await chrome.storage.local.get('settings');
    const mode = settings?.lastCaptureMode || 'fullpage';
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) {
      await startCapture(tab, mode);
    }
  }
});

// Message routing
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender).then(sendResponse).catch(err => {
    console.error('PageSnap error:', err);
    sendResponse({ error: err.message });
  });
  return true; // Keep channel open for async response
});

async function handleMessage(message, sender) {
  switch (message.action) {
    case 'startCapture':
      return await startCaptureFromPopup(message.mode);

    case 'captureVisibleTab':
      return await captureCurrentTab();

    case 'downloadImage':
      return await downloadImage(message.dataUrl, message.filename, message.format);

    case 'getSettings':
      return await getSettings();

    case 'updateSettings':
      return await updateSettings(message.settings);

    case 'saveToHistory':
      return await saveToHistory(message.capture);

    case 'getHistory':
      return await getHistory();

    case 'clearHistory':
      return await clearHistory();

    default:
      return { error: 'Unknown action: ' + message.action };
  }
}

/**
 * Start capture from popup - inject content script and begin
 */
async function startCaptureFromPopup(mode) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    return { error: 'No active tab found' };
  }
  await startCapture(tab, mode);
  // Save last used mode
  const { settings } = await chrome.storage.local.get('settings');
  settings.lastCaptureMode = mode;
  await chrome.storage.local.set({ settings });
  return { success: true };
}

/**
 * Inject content script and start capture on the given tab
 */
async function startCapture(tab, mode) {
  // Inject content script
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['content.js']
    });
  } catch (err) {
    // Content script may already be injected, or page doesn't allow it
    console.warn('Script injection note:', err.message);
  }

  // Small delay to let content script initialize
  await new Promise(r => setTimeout(r, 100));

  // Send capture command to content script
  try {
    await chrome.tabs.sendMessage(tab.id, {
      action: 'beginCapture',
      mode: mode
    });
  } catch (err) {
    console.error('Failed to send capture command:', err);
    // Fallback: try injecting and sending again
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

/**
 * Capture the currently visible tab as a data URI
 */
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

/**
 * Download an image with the given filename and format
 */
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

/**
 * Generate a default filename based on pattern
 */
function generateFilename(format) {
  const now = new Date();
  const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `pagesnap_${timestamp}.${format}`;
}

/**
 * Get extension settings
 */
async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { settings: settings || DEFAULT_SETTINGS };
}

/**
 * Update extension settings
 */
async function updateSettings(newSettings) {
  const { settings } = await chrome.storage.local.get('settings');
  const merged = { ...settings, ...newSettings };
  await chrome.storage.local.set({ settings: merged });
  return { settings: merged };
}

/**
 * Save a capture to local history (max 20)
 */
async function saveToHistory(capture) {
  const { captureHistory } = await chrome.storage.local.get('captureHistory');
  const history = captureHistory || [];

  history.unshift({
    id: Date.now(),
    timestamp: new Date().toISOString(),
    thumbnail: capture.thumbnail,
    url: capture.url,
    title: capture.title,
    mode: capture.mode,
    width: capture.width,
    height: capture.height
  });

  // Keep only last 20
  if (history.length > 20) {
    history.length = 20;
  }

  await chrome.storage.local.set({ captureHistory: history });
  return { success: true };
}

/**
 * Get capture history
 */
async function getHistory() {
  const { captureHistory } = await chrome.storage.local.get('captureHistory');
  return { history: captureHistory || [] };
}

/**
 * Clear capture history
 */
async function clearHistory() {
  await chrome.storage.local.remove('captureHistory');
  return { success: true };
}
