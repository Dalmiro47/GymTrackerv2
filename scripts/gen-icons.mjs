// scripts/gen-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const SRC = path.resolve('public/logo.svg');
const OUT = path.resolve('public/icons');

const bg = '#0B1220';              // your theme bg
const sizes = [
  { name: 'icon-192.png', size: 192, flatten: false },
  { name: 'icon-512.png', size: 512, flatten: false },
  // Apple touch icon should NOT be transparent. We'll flatten to bg color.
  { name: 'apple-touch-icon.png', size: 180, flatten: true },
];

(async () => {
  if (!fs.existsSync(SRC)) {
    console.error('Missing public/logo.svg');
    process.exit(1);
  }
  if (!fs.existsSync(OUT)) fs.mkdirSync(OUT, { recursive: true });

  const svg = fs.readFileSync(SRC);

  for (const { name, size, flatten } of sizes) {
    let img = sharp(svg, { density: 512 }); // high density for crisp SVG render
    if (flatten) img = img.flatten({ background: bg }); // remove alpha for iOS icon
    await img
      .resize(size, size, { fit: 'contain', background: bg })
      .png()
      .toFile(path.join(OUT, name));
    console.log('✔ wrote', path.join('public/icons', name));
  }
  console.log('Done.');
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
