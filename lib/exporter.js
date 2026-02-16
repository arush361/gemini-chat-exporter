/**
 * Gemini Chat Exporter - Main Coordinator
 * Depends on: export-markdown.js, export-csv.js, export-pdf.js
 */
(function () {
  'use strict';

  window.GeminiExporter = window.GeminiExporter || {};

  /**
   * Export chat data in the specified format.
   * @param {Object} chatData - { title, messages: [{ role, content, timestamp }] }
   * @param {'pdf'|'markdown'|'csv'} format
   * @returns {Promise<void>} Resolves on success, rejects with an Error on failure.
   */
  function exportChat(chatData, format) {
    return new Promise(function (resolve, reject) {
      try {
        if (!chatData || !chatData.messages || !Array.isArray(chatData.messages)) {
          throw new Error('Invalid chat data: expected an object with a "messages" array.');
        }

        if (chatData.messages.length === 0) {
          throw new Error('No messages to export.');
        }

        switch (format) {
          case 'markdown':
            if (typeof window.GeminiExporter.downloadMarkdown !== 'function') {
              throw new Error('Markdown export module is not loaded.');
            }
            window.GeminiExporter.downloadMarkdown(chatData);
            resolve();
            break;

          case 'csv':
            if (typeof window.GeminiExporter.downloadCSV !== 'function') {
              throw new Error('CSV export module is not loaded.');
            }
            window.GeminiExporter.downloadCSV(chatData);
            resolve();
            break;

          case 'pdf':
            if (typeof window.GeminiExporter.exportToPDF !== 'function') {
              throw new Error('PDF export module is not loaded.');
            }
            window.GeminiExporter.exportToPDF(chatData);
            resolve();
            break;

          default:
            throw new Error('Unsupported export format: "' + format + '". Use "pdf", "markdown", or "csv".');
        }
      } catch (err) {
        reject(new Error('Export failed (' + format + '): ' + err.message));
      }
    });
  }

  window.GeminiExporter.exportChat = exportChat;
})();
