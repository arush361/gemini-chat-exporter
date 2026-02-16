/**
 * Gemini Chat Exporter - PDF Export Module
 * Requires jsPDF loaded globally (window.jspdf.jsPDF).
 */
(function () {
  'use strict';

  window.GeminiExporter = window.GeminiExporter || {};

  var MARGIN = 20;
  var PAGE_WIDTH = 210; // A4 width in mm
  var CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
  var TITLE_FONT_SIZE = 20;
  var MESSAGE_FONT_SIZE = 11;
  var CODE_FONT_SIZE = 10;
  var LINE_HEIGHT = 1.4;
  var USER_COLOR = [66, 133, 244];       // #4285f4
  var ASSISTANT_COLOR = [51, 51, 51];     // #333333
  var CODE_BG_COLOR = [245, 245, 245];    // light gray background

  /**
   * Add a page number footer to the current page.
   * @param {jsPDF} doc
   * @param {number} pageNum
   */
  function addPageNumber(doc, pageNum) {
    doc.setFontSize(9);
    doc.setTextColor(150, 150, 150);
    doc.text('Page ' + pageNum, PAGE_WIDTH / 2, 290, { align: 'center' });
  }

  /**
   * Check if we need a new page, and add one if so.
   * @param {jsPDF} doc
   * @param {number} y - current y position
   * @param {number} neededHeight - height needed for next block
   * @param {Object} state - { pageNum }
   * @returns {number} updated y position
   */
  function ensureSpace(doc, y, neededHeight, state) {
    if (y + neededHeight > 280) {
      addPageNumber(doc, state.pageNum);
      doc.addPage();
      state.pageNum++;
      return MARGIN;
    }
    return y;
  }

  /**
   * Render wrapped text lines, handling page breaks.
   * @param {jsPDF} doc
   * @param {string[]} lines - pre-split lines
   * @param {number} x
   * @param {number} y
   * @param {number} lineSpacing - mm per line
   * @param {Object} state
   * @returns {number} updated y position
   */
  function renderLines(doc, lines, x, y, lineSpacing, state) {
    for (var i = 0; i < lines.length; i++) {
      y = ensureSpace(doc, y, lineSpacing, state);
      doc.text(lines[i], x, y);
      y += lineSpacing;
    }
    return y;
  }

  /**
   * Parse content into segments of plain text and code blocks.
   * @param {string} content
   * @returns {Array<{type: string, text: string, lang: string}>}
   */
  function parseContent(content) {
    var segments = [];
    var codeBlockRegex = /```(\w*)\n?([\s\S]*?)```/g;
    var lastIndex = 0;
    var match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      if (match.index > lastIndex) {
        segments.push({ type: 'text', text: content.slice(lastIndex, match.index) });
      }
      segments.push({ type: 'code', text: match[2], lang: match[1] || '' });
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < content.length) {
      segments.push({ type: 'text', text: content.slice(lastIndex) });
    }

    return segments;
  }

  /**
   * Generate and download a PDF from chat data.
   * @param {Object} chatData - { title, messages: [{ role, content, timestamp }] }
   */
  function exportToPDF(chatData) {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error('jsPDF library is not loaded. Cannot generate PDF.');
    }

    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ unit: 'mm', format: 'a4' });
    var title = chatData.title || 'Untitled Chat';
    var messages = chatData.messages || [];
    var exportDate = new Date().toLocaleString();
    var state = { pageNum: 1 };

    // ---- Title Page ----
    doc.setFontSize(TITLE_FONT_SIZE);
    doc.setTextColor(51, 51, 51);
    doc.setFont('helvetica', 'bold');

    var titleLines = doc.splitTextToSize(title, CONTENT_WIDTH);
    var titleY = 80;
    for (var t = 0; t < titleLines.length; t++) {
      doc.text(titleLines[t], PAGE_WIDTH / 2, titleY, { align: 'center' });
      titleY += TITLE_FONT_SIZE * 0.5;
    }

    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(120, 120, 120);
    doc.text('Gemini Chat Export', PAGE_WIDTH / 2, titleY + 10, { align: 'center' });
    doc.text(exportDate, PAGE_WIDTH / 2, titleY + 18, { align: 'center' });
    doc.text(messages.length + ' messages', PAGE_WIDTH / 2, titleY + 26, { align: 'center' });

    addPageNumber(doc, state.pageNum);

    // ---- Message Pages ----
    doc.addPage();
    state.pageNum++;
    var y = MARGIN;
    var textLineSpacing = MESSAGE_FONT_SIZE * LINE_HEIGHT * 0.352778; // pt to mm
    var codeLineSpacing = CODE_FONT_SIZE * LINE_HEIGHT * 0.352778;

    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      var isUser = msg.role === 'user';
      var roleLabel = isUser ? 'You:' : 'Gemini:';
      var color = isUser ? USER_COLOR : ASSISTANT_COLOR;
      var timestamp = msg.timestamp ? '  [' + msg.timestamp + ']' : '';

      // Role header
      y = ensureSpace(doc, y, textLineSpacing * 2 + 4, state);
      doc.setFontSize(MESSAGE_FONT_SIZE + 1);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(color[0], color[1], color[2]);
      doc.text(roleLabel + timestamp, MARGIN, y);
      y += textLineSpacing + 2;

      // Message content
      doc.setFontSize(MESSAGE_FONT_SIZE);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(color[0], color[1], color[2]);

      var segments = parseContent(msg.content || '');

      for (var s = 0; s < segments.length; s++) {
        var seg = segments[s];

        if (seg.type === 'code') {
          // Code block
          doc.setFont('courier', 'normal');
          doc.setFontSize(CODE_FONT_SIZE);
          doc.setTextColor(51, 51, 51);

          var codeLines = doc.splitTextToSize(seg.text.replace(/\t/g, '    '), CONTENT_WIDTH - 10);
          var blockHeight = codeLines.length * codeLineSpacing + 4;

          y = ensureSpace(doc, y, Math.min(blockHeight, 260), state);

          // Draw background rectangle for the visible portion
          var bgHeight = Math.min(blockHeight, 280 - y);
          doc.setFillColor(CODE_BG_COLOR[0], CODE_BG_COLOR[1], CODE_BG_COLOR[2]);
          doc.rect(MARGIN, y - 2, CONTENT_WIDTH, bgHeight, 'F');

          y += 2;
          y = renderLines(doc, codeLines, MARGIN + 3, y, codeLineSpacing, state);
          y += 2;

          // Restore message style
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(MESSAGE_FONT_SIZE);
          doc.setTextColor(color[0], color[1], color[2]);
        } else {
          // Plain text
          var textContent = seg.text.trim();
          if (textContent) {
            var wrappedLines = doc.splitTextToSize(textContent, CONTENT_WIDTH);
            y = renderLines(doc, wrappedLines, MARGIN, y, textLineSpacing, state);
          }
        }
      }

      // Spacing between messages
      y += 6;
    }

    // Final page number
    addPageNumber(doc, state.pageNum);

    // Download
    var filename = (chatData.title || 'gemini-chat').replace(/[^a-z0-9_\-]/gi, '_') + '.pdf';
    doc.save(filename);
  }

  window.GeminiExporter.exportToPDF = exportToPDF;
})();
