/**
 * Content script for Gemini Chat Exporter.
 * Injects a floating export button on Gemini pages and handles full chat extraction.
 *
 * Gemini uses <infinite-scroller class="chat-history"> with virtual scrolling.
 * Each turn is a .conversation-container with <user-query> and <model-response>.
 * We repeatedly set scrollTop=0 to force-load all lazy-loaded history.
 */

// ---------------------------------------------------------------------------
// DOM text extraction
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

  // Skip screen-reader-only prefixes ("You said", "Gemini said")
  if (tag === 'span' && node.classList.contains('screen-reader-only')) return;
  // Skip the injected export UI
  if (node.id === 'gce-root' || node.id === 'gce-toast') return;

  if (tag === 'pre' || tag === 'code-block') {
    const codeEl = node.querySelector('code') || node;
    const lang = detectCodeLanguage(node);
    parts.push(`\n\`\`\`${lang}\n${codeEl.textContent.trim()}\n\`\`\`\n`);
    return;
  }
  if (tag === 'code' && !isInsidePre(node)) {
    parts.push('`' + node.textContent + '`');
    return;
  }
  if (tag === 'img') { parts.push('[Image attachment]'); return; }

  if (tag === 'ul' || tag === 'ol') {
    parts.push('\n');
    node.querySelectorAll(':scope > li').forEach((li, i) => {
      parts.push(tag === 'ol' ? `${i + 1}. ` : '- ');
      processNode(li, parts);
      parts.push('\n');
    });
    return;
  }
  if (tag === 'li') {
    for (const child of node.childNodes) processNode(child, parts);
    return;
  }
  if (tag === 'table') { parts.push('\n'); formatTable(node, parts); parts.push('\n'); return; }

  if (tag === 'strong' || tag === 'b') {
    parts.push('**'); for (const c of node.childNodes) processNode(c, parts); parts.push('**'); return;
  }
  if (tag === 'em' || tag === 'i') {
    parts.push('*'); for (const c of node.childNodes) processNode(c, parts); parts.push('*'); return;
  }
  if (tag === 'br') { parts.push('\n'); return; }
  if (tag === 'hr') { parts.push('\n---\n'); return; }
  if (/^h[1-6]$/.test(tag)) {
    parts.push('\n' + '#'.repeat(parseInt(tag[1], 10)) + ' ');
    for (const c of node.childNodes) processNode(c, parts);
    parts.push('\n');
    return;
  }
  if (tag === 'blockquote') {
    parts.push('\n> '); for (const c of node.childNodes) processNode(c, parts); parts.push('\n'); return;
  }

  const blockTags = new Set(['p','div','h1','h2','h3','h4','h5','h6','blockquote','section','article','header','footer','br','hr']);
  const isBlock = blockTags.has(tag);
  if (isBlock) parts.push('\n');
  for (const child of node.childNodes) processNode(child, parts);
  if (isBlock) parts.push('\n');
}

function detectCodeLanguage(pre) {
  const cls = (pre.className || '') + ' ' + ((pre.querySelector('code') || {}).className || '');
  const m = cls.match(/(?:language|lang)-(\w+)/);
  if (m) return m[1];
  const dl = pre.getAttribute('data-language') || pre.getAttribute('data-lang');
  if (dl) return dl;
  return '';
}

function isInsidePre(el) {
  let p = el.parentElement;
  while (p) { if (p.tagName.toLowerCase() === 'pre') return true; p = p.parentElement; }
  return false;
}

function formatTable(table, parts) {
  table.querySelectorAll('tr').forEach((row, ri) => {
    const cells = Array.from(row.querySelectorAll('th, td')).map(c => c.textContent.trim());
    parts.push('| ' + cells.join(' | ') + ' |\n');
    if (ri === 0 && row.querySelector('th')) parts.push('| ' + cells.map(() => '---').join(' | ') + ' |\n');
  });
}

// ---------------------------------------------------------------------------
// Chat title & message extraction
// ---------------------------------------------------------------------------

function getChatTitle() {
  const t = document.title || '';
  const c = t.replace(/[-\u2013|]\s*Google\s*Gemini.*/i, '').replace(/[-\u2013|]\s*Gemini.*/i, '').trim();
  return (c && c.toLowerCase() !== 'gemini') ? c : 'Untitled Chat';
}

function extractCurrentMessages() {
  const scroller = document.querySelector('infinite-scroller.chat-history');
  if (!scroller) return [];
  const messages = [];
  scroller.querySelectorAll('.conversation-container').forEach(container => {
    const uq = container.querySelector('user-query');
    if (uq) {
      const el = uq.querySelector('.query-text') || uq.querySelector('.query-content') || uq.querySelector('user-query-content') || uq;
      const text = extractFormattedText(el);
      if (text) messages.push({ role: 'user', content: text });
    }
    const mr = container.querySelector('model-response');
    if (mr) {
      const el = mr.querySelector('message-content') || mr.querySelector('.model-response-text') || mr;
      const text = extractFormattedText(el);
      if (text) messages.push({ role: 'assistant', content: text });
    }
  });
  return messages;
}

// ---------------------------------------------------------------------------
// Scroll-to-top history loader
// ---------------------------------------------------------------------------

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function scrollToTopAndLoadAll(onProgress) {
  const scroller = document.querySelector('infinite-scroller.chat-history');
  if (!scroller) throw new Error('No chat found. Open a Gemini conversation first.');

  let lastCount = scroller.querySelectorAll('.conversation-container').length;
  let stable = 0;
  if (onProgress) onProgress({ phase: 'starting', collected: lastCount });

  for (let i = 0; i < 100; i++) {
    scroller.scrollTop = 0;
    await sleep(600);
    const count = scroller.querySelectorAll('.conversation-container').length;
    if (onProgress) onProgress({ phase: 'scrolling_up', collected: count });
    if (count === lastCount) { stable++; if (stable >= 3) break; }
    else { stable = 0; lastCount = count; }
  }

  scroller.scrollTop = 0;
  await sleep(300);

  const messages = extractCurrentMessages();
  scroller.scrollTop = scroller.scrollHeight;
  if (onProgress) onProgress({ phase: 'done', collected: messages.length });
  return messages;
}

function deduplicateMessages(messages) {
  const seen = new Set();
  return messages.filter(m => {
    const fp = m.role + '::' + m.content.substring(0, 200).trim();
    if (seen.has(fp)) return false;
    seen.add(fp);
    return true;
  });
}

async function extractChatFull(onProgress) {
  try {
    const messages = await scrollToTopAndLoadAll(onProgress);
    return { success: true, data: { title: getChatTitle(), messages: deduplicateMessages(messages) } };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

// ---------------------------------------------------------------------------
// In-page export (generates and downloads files directly)
// ---------------------------------------------------------------------------

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(title) {
  return (title || 'gemini-chat').replace(/[^a-z0-9_\-]/gi, '_').substring(0, 80);
}

function exportMarkdown(data) {
  const lines = [
    '# ' + data.title, '',
    `*Exported on ${new Date().toLocaleString()} | ${data.messages.length} messages*`, '', '---', ''
  ];
  data.messages.forEach(m => {
    const label = m.role === 'user' ? 'You' : 'Gemini';
    lines.push('## ' + label, '');
    if (m.role === 'user') {
      m.content.split('\n').forEach(l => lines.push('> ' + l));
    } else {
      lines.push(m.content);
    }
    lines.push('');
  });
  downloadBlob(new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' }), sanitizeFilename(data.title) + '.md');
}

function exportCSV(data) {
  const esc = v => { const s = String(v ?? ''); return (s.includes('"') || s.includes(',') || s.includes('\n')) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const rows = ['\uFEFF' + ['Turn','Role','Content','Timestamp'].map(esc).join(',')];
  data.messages.forEach((m, i) => {
    rows.push([esc(i + 1), esc(m.role === 'user' ? 'You' : 'Gemini'), esc(m.content), esc(m.timestamp || '')].join(','));
  });
  downloadBlob(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }), sanitizeFilename(data.title) + '.csv');
}

async function exportPDF(data) {
  // Dynamically load jsPDF if not present
  if (!window.jspdf) {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('lib/jspdf.umd.min.js');
    document.head.appendChild(script);
    await new Promise((resolve, reject) => {
      script.onload = resolve;
      script.onerror = () => reject(new Error('Failed to load jsPDF'));
    });
  }

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 20, CW = W - M * 2;
  const LS = 11 * 1.4 * 0.352778;

  // Title page
  doc.setFontSize(22); doc.setFont('helvetica', 'bold'); doc.setTextColor(26, 26, 26);
  doc.splitTextToSize(data.title, CW).forEach((line, i) => doc.text(line, W / 2, 80 + i * 10, { align: 'center' }));
  doc.setFontSize(12); doc.setFont('helvetica', 'normal'); doc.setTextColor(120, 120, 120);
  doc.text('Gemini Chat Export', W / 2, 100, { align: 'center' });
  doc.text(new Date().toLocaleString(), W / 2, 108, { align: 'center' });
  doc.text(data.messages.length + ' messages', W / 2, 116, { align: 'center' });

  let pg = 1;
  const footer = () => { doc.setFontSize(9); doc.setTextColor(150); doc.text('Page ' + pg, W / 2, 290, { align: 'center' }); };
  footer();

  doc.addPage(); pg++; let y = M;

  data.messages.forEach(m => {
    const isUser = m.role === 'user';
    const color = isUser ? [66, 133, 244] : [51, 51, 51];
    const label = isUser ? 'You:' : 'Gemini:';

    if (y + LS * 3 > 280) { footer(); doc.addPage(); pg++; y = M; }
    doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(...color);
    doc.text(label, M, y); y += LS + 2;

    doc.setFontSize(11); doc.setFont('helvetica', 'normal'); doc.setTextColor(...color);
    const segments = m.content.split(/```(\w*)\n?([\s\S]*?)```/g);
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i].trim();
      if (!seg) continue;
      if (i % 3 === 2) {
        // Code block
        doc.setFont('courier', 'normal'); doc.setFontSize(10);
        const lines = doc.splitTextToSize(seg.replace(/\t/g, '    '), CW - 10);
        const bh = lines.length * (10 * 1.4 * 0.352778) + 4;
        if (y + bh > 280) { footer(); doc.addPage(); pg++; y = M; }
        doc.setFillColor(245, 245, 245); doc.rect(M, y - 2, CW, Math.min(bh, 260), 'F');
        lines.forEach(l => { if (y > 280) { footer(); doc.addPage(); pg++; y = M; } doc.text(l, M + 3, y); y += 10 * 1.4 * 0.352778; });
        y += 2; doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
      } else if (i % 3 === 0) {
        // Plain text
        const lines = doc.splitTextToSize(seg, CW);
        lines.forEach(l => { if (y > 280) { footer(); doc.addPage(); pg++; y = M; } doc.text(l, M, y); y += LS; });
      }
    }
    y += 6;
  });

  footer();
  doc.save(sanitizeFilename(data.title) + '.pdf');
}

// ---------------------------------------------------------------------------
// Injected UI
// ---------------------------------------------------------------------------

function injectUI() {
  if (document.getElementById('gce-root')) return;

  const root = document.createElement('div');
  root.id = 'gce-root';
  root.innerHTML = `
    <button id="gce-fab" title="Export chat">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
    </button>
    <div id="gce-menu">
      <div id="gce-menu-header">Export conversation</div>
      <button class="gce-menu-item gce-pdf" data-format="pdf">
        <span class="gce-item-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
        </span>
        <span class="gce-item-label">
          <span class="gce-item-title">PDF</span>
          <span class="gce-item-desc">Formatted document</span>
        </span>
      </button>
      <button class="gce-menu-item gce-md" data-format="markdown">
        <span class="gce-item-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
        </span>
        <span class="gce-item-label">
          <span class="gce-item-title">Markdown</span>
          <span class="gce-item-desc">For docs & notes</span>
        </span>
      </button>
      <button class="gce-menu-item gce-csv" data-format="csv">
        <span class="gce-item-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="3" y1="9" x2="21" y2="9"/>
            <line x1="3" y1="15" x2="21" y2="15"/>
            <line x1="9" y1="3" x2="9" y2="21"/>
          </svg>
        </span>
        <span class="gce-item-label">
          <span class="gce-item-title">CSV</span>
          <span class="gce-item-desc">For spreadsheets</span>
        </span>
      </button>
    </div>
    <div id="gce-progress">
      <div id="gce-progress-spinner"></div>
      <div id="gce-progress-text">Scanning chat...</div>
      <div id="gce-progress-sub"></div>
    </div>
  `;
  document.body.appendChild(root);

  // Toast (separate from root so it centers on screen)
  const toast = document.createElement('div');
  toast.id = 'gce-toast';
  document.body.appendChild(toast);

  // Event handlers
  const fab = root.querySelector('#gce-fab');
  const menu = root.querySelector('#gce-menu');
  const progress = root.querySelector('#gce-progress');
  const progressText = root.querySelector('#gce-progress-text');
  const progressSub = root.querySelector('#gce-progress-sub');

  let menuOpen = false;

  fab.addEventListener('click', () => {
    menuOpen = !menuOpen;
    fab.classList.toggle('open', menuOpen);
    menu.classList.toggle('open', menuOpen);
  });

  // Close menu on outside click
  document.addEventListener('click', (e) => {
    if (menuOpen && !root.contains(e.target)) {
      menuOpen = false;
      fab.classList.remove('open');
      menu.classList.remove('open');
    }
  });

  // Export handlers
  root.querySelectorAll('.gce-menu-item').forEach(btn => {
    btn.addEventListener('click', async () => {
      const format = btn.dataset.format;
      menuOpen = false;
      fab.classList.remove('open');
      menu.classList.remove('open');

      // Show progress
      progress.classList.add('visible');
      progressText.textContent = 'Scanning chat history...';
      progressSub.textContent = '';

      const result = await extractChatFull((status) => {
        if (status.phase === 'scrolling_up') {
          progressText.textContent = 'Loading full history...';
          progressSub.textContent = status.collected + ' turns found';
        } else if (status.phase === 'done') {
          progressText.textContent = 'Exporting ' + status.collected + ' messages...';
          progressSub.textContent = '';
        }
      });

      if (!result.success) {
        progress.classList.remove('visible');
        showToast(result.error, 'error');
        return;
      }

      if (!result.data.messages.length) {
        progress.classList.remove('visible');
        showToast('No messages found in this chat', 'error');
        return;
      }

      try {
        if (format === 'markdown') exportMarkdown(result.data);
        else if (format === 'csv') exportCSV(result.data);
        else if (format === 'pdf') await exportPDF(result.data);
        progress.classList.remove('visible');
        showToast(`Exported ${result.data.messages.length} messages as ${format.toUpperCase()}`, 'success');
      } catch (err) {
        progress.classList.remove('visible');
        showToast('Export failed: ' + err.message, 'error');
      }
    });
  });
}

function showToast(message, type) {
  const toast = document.getElementById('gce-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.className = 'gce-toast ' + type + ' visible';
  // Using the ID-based styles from CSS
  toast.id = 'gce-toast';
  toast.className = type + ' visible';
  setTimeout(() => { toast.classList.remove('visible'); }, 3500);
}

// ---------------------------------------------------------------------------
// Init: inject UI when page is ready, re-inject on SPA navigation
// ---------------------------------------------------------------------------

function init() {
  injectUI();
  // Gemini is a SPA - watch for navigation changes
  const observer = new MutationObserver(() => {
    if (!document.getElementById('gce-root')) injectUI();
  });
  observer.observe(document.body, { childList: true, subtree: false });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ---------------------------------------------------------------------------
// Message listener (for popup fallback)
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (!request) return;
  if (request.action === 'extractChat') {
    extractChatFull((progress) => {
      try { chrome.runtime.sendMessage({ action: 'extractProgress', ...progress }); } catch (_) {}
    }).then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
});
