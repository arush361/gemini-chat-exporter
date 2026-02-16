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

  let isExporting = false;
  let activeTabId = null;
  let toastTimeout = null;

  function setConnected(connected) {
    if (connected) {
      statusDot.className = 'status-dot connected';
      statusText.textContent = 'Connected to Gemini';
      exportPdf.disabled = false;
      exportMarkdown.disabled = false;
      exportCsv.disabled = false;
    } else {
      statusDot.className = 'status-dot disconnected';
      statusText.textContent = 'Not on Gemini page';
      exportPdf.disabled = true;
      exportMarkdown.disabled = true;
      exportCsv.disabled = true;
    }
  }

  function showLoading(visible, text) {
    loadingOverlay.classList.toggle('visible', visible);
    if (text) loadingText.textContent = text;
  }

  function updateLoadingText(text) {
    loadingText.textContent = text;
  }

  function showToast(message, type) {
    if (toastTimeout) clearTimeout(toastTimeout);
    toast.className = 'toast';
    toastMessage.textContent = message;
    void toast.offsetWidth;
    toast.classList.add(type, 'visible');
    toastTimeout = setTimeout(() => {
      toast.classList.remove('visible');
      toastTimeout = null;
    }, 3000);
  }

  function setButtonsDisabled(disabled) {
    isExporting = disabled;
    exportPdf.disabled = disabled;
    exportMarkdown.disabled = disabled;
    exportCsv.disabled = disabled;
  }

  // Listen for progress updates from the content script
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'extractProgress' && isExporting) {
      const count = message.collected || 0;
      if (message.phase === 'scrolling_up') {
        updateLoadingText(`Scrolling up... ${count} messages found`);
      } else if (message.phase === 'scrolling_down') {
        updateLoadingText(`Scrolling down... ${count} messages found`);
      } else if (message.phase === 'done') {
        updateLoadingText(`Collected ${count} messages. Exporting...`);
      }
    }
  });

  function handleExport(format) {
    if (isExporting || !activeTabId) return;

    setButtonsDisabled(true);
    showLoading(true, 'Scanning chat history...');

    chrome.tabs.sendMessage(activeTabId, { action: 'extractChat' }, (response) => {
      if (chrome.runtime.lastError) {
        showLoading(false);
        setButtonsDisabled(false);
        showToast(chrome.runtime.lastError.message || 'Failed to connect to page', 'error');
        return;
      }

      if (!response || !response.success) {
        showLoading(false);
        setButtonsDisabled(false);
        showToast(response?.error || 'Failed to extract chat data', 'error');
        return;
      }

      if (!response.data || !response.data.messages || response.data.messages.length === 0) {
        showLoading(false);
        setButtonsDisabled(false);
        showToast('No chat messages found on this page', 'error');
        return;
      }

      updateLoadingText(`Exporting ${response.data.messages.length} messages as ${format.toUpperCase()}...`);

      try {
        window.GeminiExporter.exportChat(response.data, format)
          .then(() => {
            showLoading(false);
            setButtonsDisabled(false);
            showToast(`Exported ${response.data.messages.length} messages!`, 'success');
          })
          .catch((err) => {
            showLoading(false);
            setButtonsDisabled(false);
            showToast(err.message || 'Export failed', 'error');
          });
      } catch (err) {
        showLoading(false);
        setButtonsDisabled(false);
        showToast(err.message || 'Export failed', 'error');
      }
    });
  }

  // Check active tab
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (chrome.runtime.lastError || !tabs || tabs.length === 0) {
      setConnected(false);
      return;
    }

    const tab = tabs[0];
    activeTabId = tab.id;

    if (tab.url && tab.url.match(/^https:\/\/gemini\.google\.com\//)) {
      setConnected(true);
    } else {
      setConnected(false);
    }
  });

  // Button handlers
  exportPdf.addEventListener('click', () => handleExport('pdf'));
  exportMarkdown.addEventListener('click', () => handleExport('markdown'));
  exportCsv.addEventListener('click', () => handleExport('csv'));
});
