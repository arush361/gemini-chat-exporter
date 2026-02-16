document.addEventListener('DOMContentLoaded', () => {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const exportPdf = document.getElementById('exportPdf');
  const exportMarkdown = document.getElementById('exportMarkdown');
  const exportCsv = document.getElementById('exportCsv');
  const loadingOverlay = document.getElementById('loadingOverlay');
  const loadingText = loadingOverlay.querySelector('.loading-text');
  const toast = document.getElementById('toast');
  const toastMessage = document.getElementById('toastMessage');
  const hint = document.getElementById('hint');

  let isExporting = false;
  let activeTabId = null;
  let toastTimeout = null;

  function setConnected(connected) {
    statusDot.className = 'status-dot ' + (connected ? 'connected' : 'disconnected');
    statusText.textContent = connected ? 'Connected' : 'Not on Gemini';
    exportPdf.disabled = !connected;
    exportMarkdown.disabled = !connected;
    exportCsv.disabled = !connected;
    hint.style.display = connected ? 'block' : 'none';
  }

  function showLoading(visible, text) {
    loadingOverlay.classList.toggle('visible', visible);
    if (text) loadingText.textContent = text;
  }

  function showToast(message, type) {
    if (toastTimeout) clearTimeout(toastTimeout);
    toast.className = 'toast';
    toastMessage.textContent = message;
    void toast.offsetWidth;
    toast.classList.add(type, 'visible');
    toastTimeout = setTimeout(() => { toast.classList.remove('visible'); }, 3000);
  }

  function setDisabled(d) {
    isExporting = d;
    exportPdf.disabled = d;
    exportMarkdown.disabled = d;
    exportCsv.disabled = d;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'extractProgress' && isExporting) {
      const n = msg.collected || 0;
      if (msg.phase === 'scrolling_up') loadingText.textContent = `Loading history... ${n} turns`;
      else if (msg.phase === 'done') loadingText.textContent = `Exporting ${n} messages...`;
    }
  });

  function handleExport(format) {
    if (isExporting || !activeTabId) return;
    setDisabled(true);
    showLoading(true, 'Scanning chat history...');

    chrome.tabs.sendMessage(activeTabId, { action: 'extractChat' }, (response) => {
      if (chrome.runtime.lastError) {
        showLoading(false); setDisabled(false);
        showToast(chrome.runtime.lastError.message || 'Cannot connect', 'error');
        return;
      }
      if (!response || !response.success) {
        showLoading(false); setDisabled(false);
        showToast(response?.error || 'Extraction failed', 'error');
        return;
      }
      if (!response.data?.messages?.length) {
        showLoading(false); setDisabled(false);
        showToast('No messages found', 'error');
        return;
      }

      loadingText.textContent = `Exporting ${response.data.messages.length} messages...`;

      try {
        window.GeminiExporter.exportChat(response.data, format)
          .then(() => {
            showLoading(false); setDisabled(false);
            showToast(`${response.data.messages.length} messages exported!`, 'success');
          })
          .catch(err => {
            showLoading(false); setDisabled(false);
            showToast(err.message || 'Export failed', 'error');
          });
      } catch (err) {
        showLoading(false); setDisabled(false);
        showToast(err.message || 'Export failed', 'error');
      }
    });
  }

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError || !tabs?.length) { setConnected(false); return; }
    activeTabId = tabs[0].id;
    setConnected(/^https:\/\/gemini\.google\.com\//.test(tabs[0].url || ''));
  });

  exportPdf.addEventListener('click', () => handleExport('pdf'));
  exportMarkdown.addEventListener('click', () => handleExport('markdown'));
  exportCsv.addEventListener('click', () => handleExport('csv'));
});
