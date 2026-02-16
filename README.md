# Gemini Chat Exporter

A Chrome extension that exports your Google Gemini conversations to PDF, Markdown, or CSV. Sounds simple, right? It wasn't.

## The Story

I wanted a dead-simple thing: export my Gemini chats so I could use them in other tools. Gemini doesn't give you an export button, so I figured — how hard can a Chrome extension be?

### Act 1: The Optimistic Build

Spun up a team of 4 AI agents working in parallel — one on the content script (DOM parsing), one on export logic (PDF/MD/CSV), one on the popup UI, and one on the manifest + icons. Everything came together in about 90 seconds. Beautiful code, clean architecture, nice Google-inspired UI with dark mode. Loaded it up, clicked export, and...

It exported like 3 messages out of a 34-message chat.

### Act 2: "Why Is It Only Grabbing What's On Screen?"

Turns out Gemini uses **lazy loading**. It only renders the messages you can actually see. The rest? They don't exist in the DOM until you scroll to them. So my carefully crafted DOM parser was working perfectly — it just had nothing to parse.

First attempt at fixing this: wrote a generic "find the scrollable container and scroll to the top" function. Used heuristics like `overflow-y: auto`, biggest scrollable div, class names containing "scroll" or "chat". Seemed reasonable.

It didn't scroll anything. The messages stayed the same.

### Act 3: Reverse-Engineering Gemini's DOM

Had to go spelunking into Gemini's actual page structure. Here's what I found:

- The chat lives inside a **custom element** called `<infinite-scroller>` (not a div!)
- Each conversation turn is a `.conversation-container` containing two MORE custom elements: `<user-query>` and `<model-response>`
- Gemini adds hidden `<span class="screen-reader-only">You said</span>` text that was polluting my exports
- The scroller has `overflow: scroll` but my generic finder was looking for divs, not custom elements

And here's the real kicker about the scrolling behavior:

**When you set `scrollTop = 0`, Gemini loads older messages ABOVE the current ones and then adjusts `scrollTop` back to keep your viewport in place.** So you scroll to the top, it loads content, and then you're NOT at the top anymore. You have to keep hammering `scrollTop = 0` over and over until it stops loading new content.

Verified this manually: first scroll showed 10 conversations. After repeatedly setting `scrollTop = 0` with pauses, it grew to 20, then 34 — the full chat history.

### Act 4: The Fix

The final content script:
1. Finds `<infinite-scroller class="chat-history">` directly (no guessing)
2. Repeatedly sets `scrollTop = 0`, waits 600ms for Gemini to prepend older messages
3. Checks if `.conversation-container` count increased
4. Stops after 3 stable rounds (no new content = we're at the true top)
5. Extracts all `<user-query>` and `<model-response>` elements
6. Scrolls back to the bottom so you're not disoriented
7. Exports the whole thing

## What It Does

- **PDF** — Color-coded (blue for you, gray for Gemini), paginated, code blocks in monospace with gray background, title page with metadata. Uses jsPDF.
- **Markdown** — Clean formatting with `## You` / `## Gemini` headers, blockquoted user messages, preserved code fences with language hints.
- **CSV** — Turn number, role, content, timestamp columns. UTF-8 BOM for Excel compatibility. Properly escaped.

## Install

1. Clone this repo (or download ZIP)
2. Open `chrome://extensions/`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked**
5. Select the `gemini-chat-exporter` folder
6. Go to [gemini.google.com](https://gemini.google.com), open any chat
7. Click the extension icon in your toolbar
8. Pick your format and hit export

## How It Works

```
You click "Export as PDF"
    ↓
Popup sends message to content script
    ↓
Content script finds <infinite-scroller>
    ↓
Scrolls to top repeatedly (scrollTop = 0, wait, repeat)
    ↓
Gemini lazy-loads older messages above
    ↓
Keeps going until conversation count stabilizes
    ↓
Extracts all <user-query> + <model-response> elements
    ↓
Scrolls back to bottom
    ↓
Returns structured data to popup
    ↓
Export module generates PDF/MD/CSV
    ↓
File downloads
```

## File Structure

```
gemini-chat-exporter/
├── manifest.json          # Chrome Extension Manifest V3
├── background.js          # Service worker
├── content.js             # The hard-won DOM parser + scroll logic
├── popup.html             # Extension popup
├── popup.css              # Google-inspired styling + dark mode
├── popup.js               # Export orchestration + progress UI
├── icons/                 # Extension icons (16/48/128px)
└── lib/
    ├── jspdf.umd.min.js   # jsPDF for PDF generation
    ├── export-pdf.js       # PDF export module
    ├── export-markdown.js  # Markdown export module
    ├── export-csv.js       # CSV export module
    └── exporter.js         # Export coordinator
```

## Lessons Learned

1. **Gemini uses custom HTML elements** (`<infinite-scroller>`, `<user-query>`, `<model-response>`) — generic selectors like `div[class*="message"]` won't find them
2. **Virtual/infinite scrolling is adversarial to scrapers** — content literally doesn't exist until you scroll to it
3. **Prepend-on-scroll is sneaky** — the page loads content above you and adjusts your scroll position so you don't notice. You have to fight it by repeatedly forcing `scrollTop = 0`
4. **Screen reader text pollutes exports** — always filter out `.screen-reader-only` elements
5. **Always inspect the real DOM** — don't guess at selectors, go look at what's actually there

## Built With

- Vanilla JavaScript (no build tools, no frameworks)
- [jsPDF](https://github.com/parallax/jsPDF) for PDF generation
- Chrome Extension Manifest V3
- A lot of `scrollTop = 0` and patience
