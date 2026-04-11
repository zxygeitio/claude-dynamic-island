// Generate a minimal ICO file for the app icon
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Create a 32x32 RGBA pixel buffer (blue square with transparency)
const SIZE = 32;
const buffer = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const idx = (y * SIZE + x) * 4;
    // Create a gradient blue-purple icon with rounded corners
    const cx = SIZE / 2, cy = SIZE / 2;
    const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    const cornerRadius = 6;
    const inRoundedRect = (
      x >= cornerRadius && x < SIZE - cornerRadius ||
      y >= cornerRadius && y < SIZE - cornerRadius ||
      dist <= cornerRadius
    );

    if (inRoundedRect) {
      buffer[idx] = 96;     // R
      buffer[idx + 1] = 165; // G
      buffer[idx + 2] = 250; // B
      buffer[idx + 3] = 255; // A
    } else {
      buffer[idx + 3] = 0; // transparent
    }
  }
}

// ICO file format:
// - ICONDIR (6 bytes): reserved(2) + type(2) + count(2)
// - ICONDIRENTRY (16 bytes per image): width, height, colors, reserved, planes(2), bpp(2), size(4), offset(4)
// - Image data (PNG or BMP)

// We'll create a minimal BMP-based ICO (simpler than PNG)
const bmpInfoSize = 40;
const bmpDataSize = SIZE * SIZE * 4;
const imageSize = bmpInfoSize + bmpDataSize;

const ico = Buffer.alloc(6 + 16 + imageSize);

// ICONDIR
ico.writeUInt16LE(0, 0);      // Reserved
ico.writeUInt16LE(1, 2);      // Type: 1 = ICO
ico.writeUInt16LE(1, 4);      // Count

// ICONDIRENTRY
ico.writeUInt8(SIZE, 6);      // Width
ico.writeUInt8(SIZE, 7);       // Height
ico.writeUInt8(0, 8);         // Colors (0 = no palette)
ico.writeUInt8(0, 9);         // Reserved
ico.writeUInt16LE(1, 10);    // Planes
ico.writeUInt16LE(32, 12);    // Bits per pixel
ico.writeUInt32LE(imageSize, 14); // Image size
ico.writeUInt32LE(22, 18);    // Image offset (6 + 16)

// BITMAPINFOHEADER
ico.writeUInt32LE(40, 22);    // biSize
ico.writeInt32LE(SIZE, 26);   // biWidth
ico.writeInt32LE(SIZE * 2, 30); // biHeight (doubled for XOR + AND masks)
ico.writeUInt16LE(1, 34);     // biPlanes
ico.writeUInt16LE(32, 36);    // biBitCount
ico.writeUInt32LE(0, 38);     // biCompression (BI_RGB)
ico.writeUInt32LE(bmpDataSize, 42); // biSizeImage
ico.writeInt32LE(0, 46);      // biXPelsPerMeter
ico.writeInt32LE(0, 50);      // biYPelsPerMeter
ico.writeUInt32LE(0, 54);     // biClrUsed
ico.writeUInt32LE(0, 58);     // biClrImportant

// Write pixel data (bottom-up, BGRA)
for (let y = SIZE - 1; y >= 0; y--) {
  for (let x = 0; x < SIZE; x++) {
    const srcIdx = (y * SIZE + x) * 4;
    const dstIdx = 62 + ((SIZE - 1 - y) * SIZE + x) * 4;
    ico[dstIdx] = buffer[srcIdx + 2];     // B
    ico[dstIdx + 1] = buffer[srcIdx + 1]; // G
    ico[dstIdx + 2] = buffer[srcIdx];     // R
    ico[dstIdx + 3] = buffer[srcIdx + 3]; // A
  }
}

const outPath = path.join(__dirname, '..', 'src-tauri', 'icons', 'icon.ico');
fs.writeFileSync(outPath, ico);
console.log(`Generated icon: ${outPath}`);

// Also generate PNG version for other platforms
const pngSig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // color type RGBA
ihdr[10] = 0; // compression
ihdr[11] = 0; // filter
ihdr[12] = 0; // interlace

function crc32(buf) {
  let table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[i] = c;
  }
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeB, data]);
  const crcVal = crc32(crcData);
  const crcB = Buffer.alloc(4);
  crcB.writeUInt32BE(crcVal, 0);
  return Buffer.concat([len, typeB, data, crcB]);
}

const rawData = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  rawData[y * (1 + SIZE * 4)] = 0;
  for (let x = 0; x < SIZE; x++) {
    const srcIdx = (y * SIZE + x) * 4;
    const dstIdx = y * (1 + SIZE * 4) + 1 + x * 4;
    rawData[dstIdx] = buffer[srcIdx];
    rawData[dstIdx + 1] = buffer[srcIdx + 1];
    rawData[dstIdx + 2] = buffer[srcIdx + 2];
    rawData[dstIdx + 3] = buffer[srcIdx + 3];
  }
}

const compressed = zlib.deflateSync(rawData);
const png = Buffer.concat([
  pngSig,
  chunk('IHDR', ihdr),
  chunk('IDAT', compressed),
  chunk('IEND', Buffer.alloc(0))
]);

fs.writeFileSync(path.join(__dirname, '..', 'src-tauri', 'icons', '32x32.png'), png);
fs.writeFileSync(path.join(__dirname, '..', 'src-tauri', 'icons', '128x128.png'), png);
fs.writeFileSync(path.join(__dirname, '..', 'src-tauri', 'icons', '128x128@2x.png'), png);
console.log('Generated PNG icons');
