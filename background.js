// Gemini Chat Exporter - Background Service Worker

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'export') {
    handleExport(message.format, message.data)
      .then((result) => sendResponse({ success: true, result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    // Return true to indicate we will send a response asynchronously
    return true;
  }

  if (message.action === 'ping') {
    sendResponse({ status: 'alive' });
    return false;
  }
});

async function handleExport(format, data) {
  // The actual export (PDF/Markdown/CSV generation and download) happens
  // in the popup context since service workers cannot access DOM APIs
  // needed for Blob creation and download triggers.
  //
  // This background script acts as a relay for any cross-context
  // communication needs (e.g., between content script and popup).
  //
  // For now, we simply validate and pass through.
  const supportedFormats = ['pdf', 'markdown', 'csv'];
  if (!supportedFormats.includes(format)) {
    throw new Error(`Unsupported export format: ${format}`);
  }

  if (!data || !data.messages || data.messages.length === 0) {
    throw new Error('No chat data to export');
  }

  return { format, messageCount: data.messages.length };
}
