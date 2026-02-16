/**
 * Content script for Gemini Chat Exporter.
 * Runs on gemini.google.com and extracts full chat history.
 *
 * Gemini uses an <infinite-scroller class="chat-history"> with virtual scrolling.
 * Each turn is a .conversation-container containing <user-query> and <model-response>.
 * Scrolling to top (scrollTop=0) triggers lazy-loading of older messages above.
 * We repeatedly scroll to top until no new content appears, then extract everything.
 */

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function extractFormattedText(element) {
  if (!element) return '';
  const parts = [];
  processNode(element, parts);
  return parts.join('').trim();
}

function processNode(node, parts) {
  if (node.nodeType === Node.TEXT_NODE) {
    parts.push(node.textContent);
    return;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return;

  const tag = node.tagName.toLowerCase();

  // Skip accessibility/screen-reader-only prefixes like "You said" / "Gemini said"
  if (tag === 'span' && node.classList.contains('screen-reader-only')) return;

  if (tag === 'pre' || tag === 'code-block') {
    const codeEl = node.querySelector('code') || node;
    const lang = detectCodeLanguage(node);
    const codeText = codeEl.textContent.trim();
    parts.push(`\n\`\`\`${lang}\n${codeText}\n\`\`\`\n`);
    return;
  }

  if (tag === 'code' && !isInsidePre(node)) {
    parts.push('`' + node.textContent + '`');
    return;
  }

  if (tag === 'img') {
    parts.push('[Image attachment]');
    return;
  }

  if (tag === 'ul' || tag === 'ol') {
    parts.push('\n');
    const items = node.querySelectorAll(':scope > li');
    items.forEach((li, i) => {
      const prefix = tag === 'ol' ? `${i + 1}. ` : '- ';
      parts.push(prefix);
      processNode(li, parts);
      parts.push('\n');
    });
    return;
  }
  if (tag === 'li') {
    for (const child of node.childNodes) processNode(child, parts);
    return;
  }

  if (tag === 'table') {
    parts.push('\n');
    formatTable(node, parts);
    parts.push('\n');
    return;
  }

  if (tag === 'strong' || tag === 'b') {
    parts.push('**');
    for (const child of node.childNodes) processNode(child, parts);
    parts.push('**');
    return;
  }
  if (tag === 'em' || tag === 'i') {
    parts.push('*');
    for (const child of node.childNodes) processNode(child, parts);
    parts.push('*');
    return;
  }

  if (tag === 'br') { parts.push('\n'); return; }
  if (tag === 'hr') { parts.push('\n---\n'); return; }

  if (/^h[1-6]$/.test(tag)) {
    const level = parseInt(tag[1], 10);
    parts.push('\n' + '#'.repeat(level) + ' ');
    for (const child of node.childNodes) processNode(child, parts);
    parts.push('\n');
    return;
  }

  if (tag === 'blockquote') {
    parts.push('\n> ');
    for (const child of node.childNodes) processNode(child, parts);
    parts.push('\n');
    return;
  }

  const blockTags = new Set([
    'p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'blockquote', 'section', 'article', 'header', 'footer', 'br', 'hr',
  ]);

  const isBlock = blockTags.has(tag);
  if (isBlock) parts.push('\n');
  for (const child of node.childNodes) processNode(child, parts);
  if (isBlock) parts.push('\n');
}

function detectCodeLanguage(preOrCodeBlock) {
  const classes = (preOrCodeBlock.className || '') + ' ' +
    ((preOrCodeBlock.querySelector('code') || {}).className || '');
  const match = classes.match(/(?:language|lang)-(\w+)/);
  if (match) return match[1];
  const dataLang = preOrCodeBlock.getAttribute('data-language') ||
    preOrCodeBlock.getAttribute('data-lang');
  if (dataLang) return dataLang;
  const prev = preOrCodeBlock.previousElementSibling;
  if (prev && prev.textContent && prev.textContent.length < 30) {
    const text = prev.textContent.trim().toLowerCase();
    const knownLangs = [
      'python', 'javascript', 'typescript', 'java', 'c++', 'c#', 'go',
      'rust', 'ruby', 'php', 'swift', 'kotlin', 'sql', 'html', 'css',
      'bash', 'shell', 'json', 'yaml', 'xml', 'markdown', 'r', 'scala',
    ];
    if (knownLangs.includes(text)) return text;
  }
  return '';
}

function isInsidePre(el) {
  let parent = el.parentElement;
  while (parent) {
    if (parent.tagName.toLowerCase() === 'pre') return true;
    parent = parent.parentElement;
  }
  return false;
}

function formatTable(table, parts) {
  const rows = table.querySelectorAll('tr');
  if (rows.length === 0) return;
  rows.forEach((row, rowIndex) => {
    const cells = row.querySelectorAll('th, td');
    const cellTexts = Array.from(cells).map(c => c.textContent.trim());
    parts.push('| ' + cellTexts.join(' | ') + ' |\n');
    if (rowIndex === 0 && row.querySelector('th')) {
      parts.push('| ' + cellTexts.map(() => '---').join(' | ') + ' |\n');
    }
  });
}

// ---------------------------------------------------------------------------
// Chat title
// ---------------------------------------------------------------------------

function getChatTitle() {
  // Try the document title, strip " - Google Gemini" suffix
  const docTitle = document.title || '';
  const cleaned = docTitle
    .replace(/[-–|]\s*Google\s*Gemini.*/i, '')
    .replace(/[-–|]\s*Gemini.*/i, '')
    .trim();
  if (cleaned && cleaned.length > 0 && cleaned.toLowerCase() !== 'gemini') {
    return cleaned;
  }
  return 'Untitled Chat';
}

// ---------------------------------------------------------------------------
// Extract messages from currently loaded DOM
// ---------------------------------------------------------------------------

function extractCurrentMessages() {
  const scroller = document.querySelector('infinite-scroller.chat-history');
  if (!scroller) return [];

  const containers = scroller.querySelectorAll('.conversation-container');
  const messages = [];

  containers.forEach((container) => {
    // Extract user query
    const userQuery = container.querySelector('user-query');
    if (userQuery) {
      // Get the actual text content, skipping the "You said" screen reader prefix
      const queryContent = userQuery.querySelector('.query-text') ||
                           userQuery.querySelector('.query-content') ||
                           userQuery.querySelector('user-query-content') ||
                           userQuery;
      const text = extractFormattedText(queryContent);
      if (text) {
        messages.push({ role: 'user', content: text });
      }
    }

    // Extract model response
    const modelResponse = container.querySelector('model-response');
    if (modelResponse) {
      // Look for the main response text content area
      const responseContent = modelResponse.querySelector('message-content') ||
                              modelResponse.querySelector('.model-response-text') ||
                              modelResponse.querySelector('.response-container') ||
                              modelResponse;
      const text = extractFormattedText(responseContent);
      if (text) {
        messages.push({ role: 'assistant', content: text });
      }
    }
  });

  return messages;
}

// ---------------------------------------------------------------------------
// Scroll to top and load all history
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Repeatedly scroll the infinite-scroller to top until all older messages
 * have been lazy-loaded. Gemini prepends content when scrollTop reaches 0
 * and adjusts scrollTop to maintain visual position.
 */
async function scrollToTopAndLoadAll(onProgress) {
  const scroller = document.querySelector('infinite-scroller.chat-history');
  if (!scroller) {
    throw new Error('Could not find chat scroller. Are you in a Gemini conversation?');
  }

  // Remember original scroll position to restore later
  const originalScrollTop = scroller.scrollTop;

  let lastConversationCount = scroller.querySelectorAll('.conversation-container').length;
  let stableRounds = 0;
  const MAX_ATTEMPTS = 100;
  const STABLE_THRESHOLD = 3; // Consider done after 3 rounds with no new content

  if (onProgress) onProgress({ phase: 'starting', collected: lastConversationCount });

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Scroll to the very top
    scroller.scrollTop = 0;

    // Wait for Gemini to load older messages
    await sleep(600);

    const currentCount = scroller.querySelectorAll('.conversation-container').length;

    if (onProgress) {
      onProgress({ phase: 'scrolling_up', collected: currentCount, attempt });
    }

    if (currentCount === lastConversationCount) {
      stableRounds++;
      if (stableRounds >= STABLE_THRESHOLD) {
        // No new content for several rounds - all history is loaded
        break;
      }
    } else {
      stableRounds = 0;
      lastConversationCount = currentCount;
    }
  }

  // Final check - make sure scrollTop=0 is truly at the top
  scroller.scrollTop = 0;
  await sleep(300);

  const finalCount = scroller.querySelectorAll('.conversation-container').length;
  if (onProgress) onProgress({ phase: 'loaded', collected: finalCount });

  // Extract all messages from the now-complete DOM
  const messages = extractCurrentMessages();

  // Scroll back to original position (bottom) so user isn't disoriented
  scroller.scrollTop = scroller.scrollHeight;

  if (onProgress) onProgress({ phase: 'done', collected: messages.length });

  return messages;
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

function deduplicateMessages(messages) {
  const seen = new Set();
  const result = [];
  for (const msg of messages) {
    const fp = msg.role + '::' + msg.content.substring(0, 200).trim();
    if (!seen.has(fp)) {
      seen.add(fp);
      result.push(msg);
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Main extraction
// ---------------------------------------------------------------------------

async function extractChatFull(sendProgress) {
  try {
    const messages = await scrollToTopAndLoadAll((status) => {
      if (sendProgress) {
        try { sendProgress(status); } catch (_) {}
      }
    });

    const deduped = deduplicateMessages(messages);

    return {
      success: true,
      data: {
        title: getChatTitle(),
        messages: deduped,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: `Failed to extract chat: ${err.message}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Message listener
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (!request) return;

  if (request.action === 'extractChat') {
    extractChatFull((progress) => {
      try {
        chrome.runtime.sendMessage({
          action: 'extractProgress',
          ...progress,
        });
      } catch (_) {}
    }).then((result) => {
      sendResponse(result);
    }).catch((err) => {
      sendResponse({ success: false, error: err.message });
    });
    return true; // async response
  }
});
