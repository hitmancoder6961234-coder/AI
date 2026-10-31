const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

function createIco(pngBuffers) {
  const count = pngBuffers.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const totalHeaderSize = headerSize + dirEntrySize * count;

  let currentOffset = totalHeaderSize;
  const dirEntries = [];

  for (const item of pngBuffers) {
    const w = item.width >= 256 ? 0 : item.width;
    const h = item.height >= 256 ? 0 : item.height;
    const size = item.buffer.length;
    const entry = Buffer.alloc(16);
    entry.writeUInt8(w, 0); // width
    entry.writeUInt8(h, 1); // height
    entry.writeUInt8(0, 2); // color palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(size, 8); // image size in bytes
    entry.writeUInt32LE(currentOffset, 12); // offset
    dirEntries.push(entry);
    currentOffset += size;
  }

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = ICO
  header.writeUInt16LE(count, 4); // count of images

  return Buffer.concat([header, ...dirEntries, ...pngBuffers.map((p) => p.buffer)]);
}

async function main() {
  console.log("Starting Clarity brand icon generation...");

  const publicDir = path.resolve(__dirname, "../public");
  const distDir = path.resolve(__dirname, "../dist");
  const assetsDir = path.resolve(__dirname, "../assets");

  const darkSrc = path.join(publicDir, "clarity-icon.png");
  const whiteSrc = path.join(publicDir, "clarity-icon-white.png");

  if (!fs.existsSync(darkSrc) || !fs.existsSync(whiteSrc)) {
    throw new Error("Source logo files not found in public/ directory!");
  }

  // Extract square 477x477 glyph bounding box
  const glyphDark = await sharp(darkSrc)
    .extract({ left: 10, top: 10, width: 477, height: 477 })
    .toBuffer();

  const glyphWhite = await sharp(whiteSrc)
    .extract({ left: 10, top: 10, width: 477, height: 477 })
    .toBuffer();

  // Helper to generate a centered icon on transparent canvas with safe padding
  async function makeIcon(glyphBuffer, totalSize, innerSize) {
    const pad = Math.floor((totalSize - innerSize) / 2);
    const resizedGlyph = await sharp(glyphBuffer)
      .resize(innerSize, innerSize, { fit: "contain" })
      .toBuffer();

    return sharp({
      create: {
        width: totalSize,
        height: totalSize,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([{ input: resizedGlyph, left: pad, top: pad }])
      .png()
      .toBuffer();
  }

  // 1. icon-16.png (16x16, 14x14 glyph, 1px pad)
  // For browser tab favicons, we use the dark mark with fine contrast edge
  // Or high-contrast dark mark
  const icon16 = await makeIcon(glyphDark, 16, 14);

  // 2. icon-32.png (32x32, 28x28 glyph, 2px pad)
  const icon32 = await makeIcon(glyphDark, 32, 28);

  // 3. icon-48.png (48x48, 42x42 glyph, 3px pad)
  const icon48 = await makeIcon(glyphDark, 48, 42);

  // 4. icon-180.png (180x180, 150x150 glyph, 15px pad) - Apple Touch Icon (white logo on transparent, dark themed)
  const icon180 = await makeIcon(glyphWhite, 180, 150);

  // 5. icon-192.png (192x192, 160x160 glyph, 16px pad) - PWA Standard Icon
  const icon192 = await makeIcon(glyphWhite, 192, 160);

  // 6. icon-512.png (512x512, 420x420 glyph, 46px pad) - PWA Standard Icon
  const icon512 = await makeIcon(glyphWhite, 512, 420);

  // 7. icon-512-maskable.png (512x512 with #121212 background, glyph 330x330 inside 80% safe zone circle)
  const resizedMaskableGlyph = await sharp(glyphWhite)
    .resize(330, 330, { fit: "contain" })
    .toBuffer();

  const icon512Maskable = await sharp({
    create: {
      width: 512,
      height: 512,
      channels: 4,
      background: { r: 18, g: 18, b: 18, alpha: 1 }, // #121212 theme background
    },
  })
    .composite([{ input: resizedMaskableGlyph, left: 91, top: 91 }])
    .png()
    .toBuffer();

  // 8. favicon.ico containing 16x16, 32x32, and 48x48
  const faviconIco = createIco([
    { width: 16, height: 16, buffer: icon16 },
    { width: 32, height: 32, buffer: icon32 },
    { width: 48, height: 48, buffer: icon48 },
  ]);

  // 9. favicon.svg (Adaptive SVG with prefers-color-scheme)
  const darkBase64 = glyphDark.toString("base64");
  const whiteBase64 = glyphWhite.toString("base64");

  const faviconSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <style>
    .clarity-mark-light { display: block; }
    .clarity-mark-dark { display: none; }
    @media (prefers-color-scheme: dark) {
      .clarity-mark-light { display: none; }
      .clarity-mark-dark { display: block; }
    }
  </style>
  <image class="clarity-mark-light" href="data:image/png;base64,${darkBase64}" x="32" y="32" width="448" height="448" />
  <image class="clarity-mark-dark" href="data:image/png;base64,${whiteBase64}" x="32" y="32" width="448" height="448" />
</svg>
`;

  const filesToWrite = [
    { name: "icon-16.png", buffer: icon16 },
    { name: "icon-32.png", buffer: icon32 },
    { name: "icon-48.png", buffer: icon48 },
    { name: "icon-180.png", buffer: icon180 },
    { name: "icon-192.png", buffer: icon192 },
    { name: "icon-512.png", buffer: icon512 },
    { name: "icon-512-maskable.png", buffer: icon512Maskable },
    { name: "favicon.ico", buffer: faviconIco },
    { name: "favicon.svg", buffer: Buffer.from(faviconSvg, "utf-8") },
  ];

  // Write to public/, dist/ (if exists), and assets/ (if exists)
  const targetDirs = [publicDir];
  if (fs.existsSync(distDir)) targetDirs.push(distDir);
  if (fs.existsSync(assetsDir)) targetDirs.push(assetsDir);

  for (const dir of targetDirs) {
    for (const f of filesToWrite) {
      const dest = path.join(dir, f.name);
      fs.writeFileSync(dest, f.buffer);
      console.log(`Wrote ${f.name} (${f.buffer.length} bytes) to ${path.relative(process.cwd(), dest)}`);
    }
  }

  console.log("All icon assets generated successfully!");
}

main().catch((err) => {
  console.error("Failed to generate icons:", err);
  process.exit(1);
});
