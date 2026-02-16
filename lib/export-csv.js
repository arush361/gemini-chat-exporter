/**
 * Gemini Chat Exporter - CSV Export Module
 */
(function () {
  'use strict';

  window.GeminiExporter = window.GeminiExporter || {};

  /**
   * Escape a value for safe inclusion in a CSV cell.
   * Rules: if the value contains a double quote, comma, or newline,
   * wrap it in double quotes and double any existing double quotes.
   * @param {string} value
   * @returns {string}
   */
  function escapeCSV(value) {
    var str = String(value == null ? '' : value);
    if (str.indexOf('"') !== -1 || str.indexOf(',') !== -1 || str.indexOf('\n') !== -1 || str.indexOf('\r') !== -1) {
      return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
  }

  /**
   * Convert chat data to a CSV string.
   * @param {Object} chatData - { title, messages: [{ role, content, timestamp }] }
   * @returns {string} CSV-formatted string with UTF-8 BOM
   */
  function exportToCSV(chatData) {
    var messages = chatData.messages || [];
    var rows = [];

    // UTF-8 BOM for Excel compatibility
    var bom = '\uFEFF';

    // Header row
    rows.push(['Turn Number', 'Role', 'Content', 'Timestamp'].map(escapeCSV).join(','));

    // Data rows
    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      var role = msg.role === 'user' ? 'You' : 'Gemini';
      var row = [
        escapeCSV(i + 1),
        escapeCSV(role),
        escapeCSV(msg.content || ''),
        escapeCSV(msg.timestamp || '')
      ];
      rows.push(row.join(','));
    }

    return bom + rows.join('\n');
  }

  /**
   * Generate and download a CSV file from chat data.
   * @param {Object} chatData
   */
  function downloadCSV(chatData) {
    var csv = exportToCSV(chatData);
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);

    var filename = (chatData.title || 'gemini-chat').replace(/[^a-z0-9_\-]/gi, '_') + '.csv';

    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  window.GeminiExporter.exportToCSV = exportToCSV;
  window.GeminiExporter.downloadCSV = downloadCSV;
})();
