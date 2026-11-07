// scripts/gen-icons.mjs
// Renders the PWA icons and the favicon from the raster master.
// Run from the repo root: node scripts/gen-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

// Master lives outside public/ on purpose, so it is never served.
const SRC = path.resolve('assets/brand/squat-master.png');
const OUT = path.resolve('public/icons');
const FAVICON = path.resolve('src/app/favicon.ico');

// Maskable: the illustration scaled to 76% keeps the bar tip and plates inside
// Android's minimum safe circle (radius 40% of the icon).
const MASKABLE_SCALE = 0.76;

// Sample the master's top-left 32x32 corner (near-black) for the maskable padding.
async function sampleCornerColor(src) {
  const { data, info } = await sharp(src)
    .extract({ left: 0, top: 0, width: 32, height: 32 })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const sum = [0, 0, 0];
  for (let i = 0; i < data.length; i += info.channels) {
    sum[0] += data[i];
    sum[1] += data[i + 1];
    sum[2] += data[i + 2];
  }
  const n = data.length / info.channels;
  const [r, g, b] = sum.map((v) => Math.round(v / n));
  return { r, g, b };
}

// Full-bleed square, opaque (flattened onto bg so iOS never sees alpha).
function fullBleed(src, size, bg) {
  return sharp(src).flatten({ background: bg }).resize(size, size, { fit: 'cover' }).png();
}

async function maskable(src, size, bg) {
  const inner = Math.round(size * MASKABLE_SCALE);
  const art = await sharp(src).flatten({ background: bg }).resize(inner, inner, { fit: 'cover' }).png().toBuffer();
  const offset = Math.round((size - inner) / 2);
  const composed = await sharp({ create: { width: size, height: size, channels: 3, background: bg } })
    .composite([{ input: art, left: offset, top: offset }])
    .png()
    .toBuffer();
  // composite adds an alpha channel; drop it so the icon is opaque like the others.
  return sharp(composed).removeAlpha().png();
}

// sharp cannot write ICO: wrap PNG entries in a hand-built ICONDIR header.
async function buildIco(src, sizes, bg) {
  const pngs = [];
  for (const size of sizes) pngs.push(await fullBleed(src, size, bg).toBuffer());

  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type 1 = icon
  header.writeUInt16LE(sizes.length, 4);

  const entries = Buffer.alloc(16 * sizes.length);
  let offset = header.length + entries.length;
  sizes.forEach((size, i) => {
    const o = 16 * i;
    entries.writeUInt8(size >= 256 ? 0 : size, o); // width (0 = 256)
    entries.writeUInt8(size >= 256 ? 0 : size, o + 1); // height
    entries.writeUInt8(0, o + 2); // palette colors
    entries.writeUInt8(0, o + 3); // reserved
    entries.writeUInt16LE(1, o + 4); // color planes
    entries.writeUInt16LE(32, o + 6); // bits per pixel
    entries.writeUInt32LE(pngs[i].length, o + 8);
    entries.writeUInt32LE(offset, o + 12);
    offset += pngs[i].length;
  });

  return Buffer.concat([header, entries, ...pngs]);
}

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error('Missing assets/brand/squat-master.png');
    process.exit(1);
  }
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const bg = await sampleCornerColor(SRC);
  console.log('background sampled from master corner:', bg);

  const outputs = [
    { name: 'icon-192.png', make: () => fullBleed(SRC, 192, bg) },
    { name: 'icon-512.png', make: () => fullBleed(SRC, 512, bg) },
    { name: 'icon-maskable-512.png', make: () => maskable(SRC, 512, bg) },
    { name: 'apple-touch-icon.png', make: () => fullBleed(SRC, 180, bg) },
  ];
  for (const { name, make } of outputs) {
    const img = await make();
    await img.toFile(path.join(OUT, name));
    console.log('✔ wrote', path.join('public/icons', name));
  }

  fs.writeFileSync(FAVICON, await buildIco(SRC, [16, 32, 48], bg));
  console.log('✔ wrote', path.join('src/app', 'favicon.ico'));

  console.log('Done.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
