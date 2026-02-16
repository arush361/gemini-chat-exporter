#!/usr/bin/env node

// Generates minimal valid PNG icon files for the Chrome extension.
// No external dependencies required - uses raw PNG binary encoding.

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ICONS_DIR = path.join(__dirname, 'icons');

// Google Blue: #4285f4
const BLUE = { r: 66, g: 133, b: 244 };
// White for the arrow/symbol
const WHITE = { r: 255, g: 255, b: 255 };
// Transparent
const TRANSPARENT = { r: 0, g: 0, b: 0, a: 0 };

function createPNG(size) {
  const pixels = Buffer.alloc(size * size * 4, 0); // RGBA

  // Draw a chat bubble with export arrow
  const cx = size / 2;
  const cy = size / 2;
  const radius = size * 0.4;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      const dx = x - cx;
      const dy = y - cy * 0.9; // Shift bubble up slightly

      // Rounded rectangle / circle for chat bubble
      const dist = Math.sqrt(dx * dx + dy * dy);
      const bubbleRadius = radius;

      // Chat bubble shape: rounded rect approximation
      const inBubbleX = Math.abs(dx) < radius * 0.85;
      const inBubbleY = Math.abs(dy) < radius * 0.7;
      const inCorner =
        Math.sqrt(
          Math.pow(Math.max(0, Math.abs(dx) - radius * 0.55), 2) +
            Math.pow(Math.max(0, Math.abs(dy) - radius * 0.4), 2)
        ) < radius * 0.32;
      const inBubble = (inBubbleX && inBubbleY) || inCorner;

      // Chat bubble tail (small triangle at bottom)
      const tailCx = cx - radius * 0.2;
      const tailTop = cy * 0.9 + radius * 0.55;
      const tailBot = cy * 0.9 + radius * 0.9;
      const inTail =
        y >= tailTop &&
        y <= tailBot &&
        x >= tailCx - (y - tailTop) * 0.4 &&
        x <= tailCx + radius * 0.25 - (y - tailTop) * 0.3;

      if (inBubble || inTail) {
        // Check if this pixel is part of the download arrow (white)
        const arrowCx = cx;
        const arrowCy = cy * 0.85;
        const arrowSize = radius * 0.5;

        // Arrow shaft (vertical line)
        const inShaft =
          Math.abs(x - arrowCx) < arrowSize * 0.18 &&
          y > arrowCy - arrowSize * 0.6 &&
          y < arrowCy + arrowSize * 0.3;

        // Arrow head (V shape pointing down)
        const headY = arrowCy + arrowSize * 0.05;
        const headDy = y - headY;
        const inHead =
          headDy > 0 &&
          headDy < arrowSize * 0.5 &&
          Math.abs(x - arrowCx) < headDy * 0.9 &&
          Math.abs(x - arrowCx) > headDy * 0.9 - arrowSize * 0.22;

        // Arrow head center fill
        const inHeadFill =
          headDy > 0 &&
          headDy < arrowSize * 0.5 &&
          Math.abs(x - arrowCx) <= headDy * 0.9;

        // Base line (horizontal line under arrow)
        const inBase =
          Math.abs(y - (arrowCy + arrowSize * 0.55)) < arrowSize * 0.1 &&
          Math.abs(x - arrowCx) < arrowSize * 0.55;

        if (inShaft || inHeadFill || inBase) {
          pixels[idx] = WHITE.r;
          pixels[idx + 1] = WHITE.g;
          pixels[idx + 2] = WHITE.b;
          pixels[idx + 3] = 255;
        } else {
          pixels[idx] = BLUE.r;
          pixels[idx + 1] = BLUE.g;
          pixels[idx + 2] = BLUE.b;
          pixels[idx + 3] = 255;
        }
      } else {
        // Transparent background
        pixels[idx] = 0;
        pixels[idx + 1] = 0;
        pixels[idx + 2] = 0;
        pixels[idx + 3] = 0;
      }
    }
  }

  return encodePNG(pixels, size, size);
}

function encodePNG(pixels, width, height) {
  // Build raw image data with filter bytes
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4);
    rawData[rowStart] = 0; // No filter
    pixels.copy(rawData, rowStart + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(rawData);

  const chunks = [];

  // PNG Signature
  chunks.push(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  chunks.push(makeChunk('IHDR', ihdr));

  // IDAT chunk
  chunks.push(makeChunk('IDAT', compressed));

  // IEND chunk
  chunks.push(makeChunk('IEND', Buffer.alloc(0)));

  return Buffer.concat(chunks);
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

// CRC32 implementation for PNG
function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  crcTable[n] = c;
}

// Generate icons
if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
}

const sizes = [16, 48, 128];
for (const size of sizes) {
  const png = createPNG(size);
  const filePath = path.join(ICONS_DIR, `icon${size}.png`);
  fs.writeFileSync(filePath, png);
  console.log(`Generated ${filePath} (${png.length} bytes)`);
}

console.log('Icon generation complete.');
