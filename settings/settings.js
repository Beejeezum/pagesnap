/**
 * PageSnap - Settings Page
 */

document.addEventListener('DOMContentLoaded', async () => {
  // Load current settings
  const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
  const settings = response.settings || {};

  // Populate fields
  document.getElementById('apiKey').value = settings.apiKey || '';
  if (settings.apiKey && settings.apiKey.startsWith('sk-ant-')) {
    document.getElementById('apiKey').placeholder = 'API key configured';
  }
  document.getElementById('defaultFormat').value = settings.defaultFormat || 'png';
  document.getElementById('jpgQuality').value = (settings.jpgQuality || 0.8) * 100;
  document.getElementById('jpgQualityValue').textContent = Math.round((settings.jpgQuality || 0.8) * 100) + '%';
  document.getElementById('defaultOutputMode').value = settings.defaultOutputMode || 'quickquote';
  document.getElementById('voice').value = settings.voice || 'straight-shooter';
  document.getElementById('graphicStyle').value = settings.graphicStyle || 'modern-dark';

  // JPG quality slider
  document.getElementById('jpgQuality').addEventListener('input', (e) => {
    document.getElementById('jpgQualityValue').textContent = e.target.value + '%';
  });

  // Toggle API key visibility
  document.getElementById('toggleApiKey').addEventListener('click', () => {
    const input = document.getElementById('apiKey');
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Save button
  document.getElementById('saveBtn').addEventListener('click', async () => {
    const newSettings = {
      apiKey: document.getElementById('apiKey').value.trim(),
      defaultFormat: document.getElementById('defaultFormat').value,
      jpgQuality: parseInt(document.getElementById('jpgQuality').value) / 100,
      defaultOutputMode: document.getElementById('defaultOutputMode').value,
      voice: document.getElementById('voice').value,
      graphicStyle: document.getElementById('graphicStyle').value
    };

    const result = await chrome.runtime.sendMessage({
      action: 'updateSettings',
      settings: newSettings
    });

    const status = document.getElementById('saveStatus');
    if (result?.error) {
      status.textContent = 'Error: ' + result.error;
      status.style.color = '#DC2626';
    } else {
      status.textContent = 'Settings saved';
      status.style.color = '#059669';
    }
    setTimeout(() => { status.textContent = ''; }, 2000);
  });

  // Export swipe file
  document.getElementById('exportSwipefile').addEventListener('click', async () => {
    const response = await chrome.runtime.sendMessage({ action: 'swipefileExport' });
    if (response.json) {
      const blob = new Blob([response.json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `pagesnap_swipefile_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  });

  // Clear swipe file
  document.getElementById('clearSwipefile').addEventListener('click', async () => {
    if (confirm('Clear your entire swipe file? This cannot be undone.')) {
      await chrome.runtime.sendMessage({ action: 'swipefileClear' });
      const status = document.getElementById('saveStatus');
      status.textContent = 'Swipe file cleared';
      setTimeout(() => { status.textContent = ''; }, 2000);
    }
  });
});
