/**
 * Gemini Chat Exporter - Markdown Export Module
 */
(function () {
  'use strict';

  window.GeminiExporter = window.GeminiExporter || {};

  /**
   * Convert chat data to a Markdown string.
   * @param {Object} chatData - { title, messages: [{ role, content, timestamp }] }
   * @returns {string} Markdown-formatted string
   */
  function exportToMarkdown(chatData) {
    var title = chatData.title || 'Untitled Chat';
    var messages = chatData.messages || [];
    var exportDate = new Date().toLocaleString();

    var lines = [];

    // Header
    lines.push('# ' + title);
    lines.push('');
    lines.push('*Exported on ' + exportDate + ' | ' + messages.length + ' messages*');
    lines.push('');
    lines.push('---');
    lines.push('');

    // Messages
    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      var roleLabel = msg.role === 'user' ? 'You' : 'Gemini';
      var timestamp = msg.timestamp ? ' (' + msg.timestamp + ')' : '';

      lines.push('## ' + roleLabel + timestamp);
      lines.push('');

      if (msg.role === 'user') {
        // User messages in blockquotes — preserve multi-line content
        var contentLines = (msg.content || '').split('\n');
        for (var j = 0; j < contentLines.length; j++) {
          lines.push('> ' + contentLines[j]);
        }
      } else {
        // Assistant messages as plain text (code blocks already use ```)
        lines.push(msg.content || '');
      }

      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Generate and download a Markdown file from chat data.
   * @param {Object} chatData
   */
  function downloadMarkdown(chatData) {
    var markdown = exportToMarkdown(chatData);
    var blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);

    var filename = (chatData.title || 'gemini-chat').replace(/[^a-z0-9_\-]/gi, '_') + '.md';

    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  window.GeminiExporter.exportToMarkdown = exportToMarkdown;
  window.GeminiExporter.downloadMarkdown = downloadMarkdown;
})();
