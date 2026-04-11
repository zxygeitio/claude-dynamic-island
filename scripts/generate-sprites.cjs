// Script to generate a default pixel cat spritesheet
// Run with: node scripts/generate-sprites.js
// This creates a simple 16x16 pixel cat with 5 animation rows

const fs = require('fs');
const path = require('path');

// Create a simple PNG with pixel data for the cat character
// We'll use a raw pixel approach and write a minimal PNG

const FRAME_W = 16;
const FRAME_H = 16;
const ROWS = 5; // idle, working, celebrating, sleeping, confused
const MAX_FRAMES = 8; // max frames per row
const SHEET_W = FRAME_W * MAX_FRAMES;
const SHEET_H = FRAME_H * ROWS;

// Colors (RGBA)
const C = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 255],
  white: [255, 255, 255, 255],
  orange: [255, 165, 0, 255],
  darkOrange: [200, 120, 0, 255],
  pink: [255, 150, 150, 255],
  green: [100, 255, 100, 255],
  blue: [100, 150, 255, 255],
  yellow: [255, 255, 100, 255],
  gray: [150, 150, 150, 255],
  darkGray: [80, 80, 80, 255],
  red: [255, 80, 80, 255],
};

function createPixelBuffer() {
  const buffer = new Uint8Array(SHEET_W * SHEET_H * 4);
  // Fill with transparent
  for (let i = 0; i < buffer.length; i += 4) {
    buffer[i] = 0; buffer[i+1] = 0; buffer[i+2] = 0; buffer[i+3] = 0;
  }
  return buffer;
}

function setPixel(buffer, sheetX, sheetY, color) {
  const idx = (sheetY * SHEET_W + sheetX) * 4;
  buffer[idx] = color[0];
  buffer[idx+1] = color[1];
  buffer[idx+2] = color[2];
  buffer[idx+3] = color[3];
}

function drawFrame(buffer, frameIdx, rowIdx, pixels) {
  const offsetX = frameIdx * FRAME_W;
  const offsetY = rowIdx * FRAME_H;
  for (let y = 0; y < FRAME_H; y++) {
    for (let x = 0; x < FRAME_W; x++) {
      const color = pixels[y]?.[x];
      if (color) {
        setPixel(buffer, offsetX + x, offsetY + y, color);
      }
    }
  }
}

// Base cat sprite (16x16) - a cute sitting cat
// . = transparent, O = orange, o = dark orange, K = black, W = white, P = pink
function getBaseCat(earOffset = 0, eyeState = 'open', tailFrame = 0, mouthState = 'normal') {
  const O = C.orange, o = C.darkOrange, K = C.black, W = C.white, P = C.pink;
  const G = C.green, T = C.transparent, B = C.blue, Y = C.yellow;

  // Cat body template
  const base = [
    [T,T,T,T,T,O,O,T,T,O,O,T,T,T,T,T], // ears
    [T,T,T,T,O,o,o,O,O,o,o,O,T,T,T,T], // ear fill
    [T,T,T,O,o,o,o,o,o,o,o,o,O,T,T,T], // head top
    [T,T,O,o,o,o,o,o,o,o,o,o,o,O,T,T], // head
    [T,O,o,o,K,W,o,o,o,K,W,o,o,o,O,T], // eyes
    [T,O,o,o,o,o,P,o,P,o,o,o,o,o,O,T], // nose + cheeks
    [T,O,o,o,o,o,o,K,o,o,o,o,o,o,O,T], // mouth
    [T,T,O,o,o,o,o,o,o,o,o,o,o,O,T,T], // chin
    [T,T,T,O,o,o,o,o,o,o,o,o,O,T,T,T], // neck
    [T,T,O,o,o,o,o,o,o,o,o,o,o,O,T,T], // body top
    [T,O,o,o,o,o,o,o,o,o,o,o,o,o,O,T], // body
    [T,O,o,o,o,o,o,o,o,o,o,o,o,o,O,T], // body
    [T,O,o,o,o,o,o,o,o,o,o,o,o,o,O,T], // body
    [T,T,O,o,o,o,o,o,o,o,o,o,O,T,T,T], // body bottom
    [T,T,T,O,O,o,o,o,o,o,O,O,T,T,T,T], // feet
    [T,T,T,T,O,O,O,O,O,O,O,T,T,T,T,T], // feet bottom
  ];
  return base;
}

// Idle animation frames - cat sitting with tail swish and occasional blink
function generateIdleFrames(buffer) {
  for (let f = 0; f < 8; f++) {
    const frame = getBaseCat();
    // Add subtle variations - blink on frames 3-4
    if (f === 3 || f === 4) {
      // Close eyes (replace eye whites with dark orange)
      const O = C.orange, o = C.darkOrange;
      frame[4][5] = o; frame[4][6] = o; frame[4][10] = o; frame[4][11] = o;
    }
    drawFrame(buffer, f, 0, frame);
  }
}

// Working animation - cat typing at a keyboard
function generateWorkingFrames(buffer) {
  const T = C.transparent;
  for (let f = 0; f < 8; f++) {
    const frame = getBaseCat();
    // Add keyboard below (simple row of keys)
    const K = C.darkGray, G = C.gray, W = C.white;
    frame[12] = [T,T,T,T,T,K,G,K,G,K,G,K,T,T,T,T];
    frame[13] = [T,T,T,T,K,G,K,G,K,G,K,G,K,T,T,T];
    frame[14] = [T,T,T,K,K,K,K,K,K,K,K,K,K,K,T,T];

    // Alternating key press animation
    if (f % 2 === 0) {
      frame[12][6] = W; frame[12][10] = W;
    } else {
      frame[12][5] = W; frame[12][9] = W;
    }
    drawFrame(buffer, f, 1, frame);
  }
}

// Celebrating animation - cat jumping with sparkles
function generateCelebratingFrames(buffer) {
  for (let f = 0; f < 6; f++) {
    const frame = getBaseCat();
    const Y = C.yellow, G = C.green, T = C.transparent;

    // Jump offset - shift body up on middle frames
    if (f >= 1 && f <= 4) {
      // Arms up (modify body rows)
      frame[9][2] = T; frame[9][3] = C.orange;
      frame[9][12] = C.orange; frame[9][13] = T;
    }

    // Sparkles around the cat
    if (f === 1 || f === 3) {
      frame[2][1] = Y; frame[4][14] = Y;
      frame[8][0] = G; frame[6][15] = G;
    } else if (f === 2 || f === 4) {
      frame[1][3] = Y; frame[3][13] = Y;
      frame[7][1] = G; frame[5][14] = G;
    }
    drawFrame(buffer, f, 2, frame);
  }
}

// Sleeping animation - cat curled up, breathing
function generateSleepingFrames(buffer) {
  const O = C.orange, o = C.darkOrange, K = C.black, T = C.transparent, P = C.pink;

  for (let f = 0; f < 4; f++) {
    // Curled up cat - simpler shape
    const frame = Array.from({length: 16}, () => Array(16).fill(T));

    // Rounded sleeping body
    const bodyRows = [
      [T,T,T,T,T,T,T,T,T,T,T,T,T,T,T,T],
      [T,T,T,T,T,T,O,O,O,O,T,T,T,T,T,T],
      [T,T,T,T,O,O,o,o,o,o,O,O,T,T,T,T],
      [T,T,T,O,o,o,o,o,o,o,o,o,O,T,T,T],
      [T,T,O,o,o,o,o,o,o,o,o,o,o,O,T,T], // head area
      [T,T,O,o,K,o,o,o,o,o,K,o,o,O,T,T], // closed eyes
      [T,T,O,o,o,o,P,o,P,o,o,o,o,O,T,T], // nose
      [T,T,O,o,o,o,o,o,o,o,o,o,o,O,T,T],
      [T,T,T,O,o,o,o,o,o,o,o,o,O,T,T,T],
      [T,T,T,T,O,o,o,o,o,o,o,O,T,T,T,T],
      [T,T,T,O,O,o,o,o,o,o,O,O,T,T,T,T],
      [T,T,T,O,o,o,o,o,o,o,o,O,T,T,T,T],
      [T,T,T,T,O,O,o,o,o,O,O,T,T,T,T,T],
      [T,T,T,T,T,O,O,O,O,O,T,T,T,T,T,T],
    ];

    // Breathing animation - slightly inflate on frames 1,2
    for (let y = 0; y < bodyRows.length; y++) {
      for (let x = 0; x < 16; x++) {
        frame[y + 1][x] = bodyRows[y][x];
      }
    }

    // Z particles for sleeping
    if (f === 1) {
      frame[1][12] = C.blue; frame[0][14] = C.blue;
    } else if (f === 2) {
      frame[0][14] = C.blue; frame[0][15] = C.blue;
    } else if (f === 3) {
      frame[1][13] = C.blue;
    }

    drawFrame(buffer, f, 3, frame);
  }
}

// Confused animation - cat with tilted head and question mark
function generateConfusedFrames(buffer) {
  for (let f = 0; f < 6; f++) {
    const frame = getBaseCat();
    const Y = C.yellow, K = C.black, T = C.transparent;

    // Question mark above head
    frame[0][8] = Y;
    frame[1][8] = Y; frame[1][9] = Y;
    frame[2][9] = Y;
    frame[3][8] = Y;

    // Tilted head - shift upper rows slightly
    if (f % 2 === 0) {
      // Swap eye colors for confused look
      frame[4][5] = C.orange; frame[4][6] = C.white;
      frame[4][10] = C.white; frame[4][11] = C.orange;
    }

    drawFrame(buffer, f, 4, frame);
  }
}

// Minimal PNG writer
function writePNG(buffer, width, height) {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type (RGBA)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const ihdrChunk = createChunk('IHDR', ihdr);

  // IDAT chunk - raw pixel data with filter bytes
  const rawData = Buffer.alloc(height * (1 + width * 4));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 4)] = 0; // No filter
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      const dstIdx = y * (1 + width * 4) + 1 + x * 4;
      rawData[dstIdx] = buffer[srcIdx];
      rawData[dstIdx + 1] = buffer[srcIdx + 1];
      rawData[dstIdx + 2] = buffer[srcIdx + 2];
      rawData[dstIdx + 3] = buffer[srcIdx + 3];
    }
  }

  const zlib = require('zlib');
  const compressed = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressed);

  // IEND chunk
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);

  const typeBuffer = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuffer, data]);

  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);

  return Buffer.concat([length, typeBuffer, data, crc]);
}

// CRC32 implementation
function crc32(buf) {
  let table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }

  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// Main
const buffer = createPixelBuffer();
generateIdleFrames(buffer);
generateWorkingFrames(buffer);
generateCelebratingFrames(buffer);
generateSleepingFrames(buffer);
generateConfusedFrames(buffer);

const png = writePNG(buffer, SHEET_W, SHEET_H);
const outPath = path.join(__dirname, '..', 'characters', 'default-cat', 'spritesheet.png');
fs.writeFileSync(outPath, png);
console.log(`Generated spritesheet: ${outPath} (${SHEET_W}x${SHEET_H})`);
