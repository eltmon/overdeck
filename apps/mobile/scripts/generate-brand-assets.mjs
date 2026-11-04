#!/usr/bin/env node
// Render the phone app's launcher icons and splash images from the Overdeck mark (PAN-4841 D-8).
//
//   node apps/mobile/scripts/generate-brand-assets.mjs
//
// Source: src/dashboard/frontend/public/favicon.svg, centred on #202020 (the PWA background).
// Each target PNG is overwritten at its current pixel size, so no Xcode or Android resource list
// changes. Run it again after the mark changes and commit the outputs.

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const BACKGROUND = '#202020';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const mobile = join(repoRoot, 'apps/mobile');
const markSvg = readFileSync(join(repoRoot, 'src/dashboard/frontend/public/favicon.svg'));
const MARK_VIEWBOX = 32;

const iosAssets = join(mobile, 'ios/App/App/Assets.xcassets');
const androidRes = join(mobile, 'android/app/src/main/res');

/** The mark as a PNG buffer, `size` pixels square, on a transparent background. */
async function renderMark(size) {
  const density = (72 * size) / MARK_VIEWBOX;
  return sharp(markSvg, { density }).resize(size, size).png().toBuffer();
}

/**
 * Draw the mark centred on a `width` × `height` canvas.
 * `markRatio` is the mark's size as a share of the shorter side. A null `background` keeps the
 * canvas transparent; `round` clips the result to a circle.
 */
async function compose(width, height, { markRatio, background, round = false }) {
  const markSize = Math.round(Math.min(width, height) * markRatio);
  const mark = await renderMark(markSize);
  const fill = background ?? { r: 0, g: 0, b: 0, alpha: 0 };
  let image = sharp({ create: { width, height, channels: 4, background: fill } }).composite([
    { input: mark, left: Math.round((width - markSize) / 2), top: Math.round((height - markSize) / 2) },
  ]);
  if (round) {
    const r = Math.min(width, height) / 2;
    const circle = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><circle cx="${width / 2}" cy="${height / 2}" r="${r}" fill="#fff"/></svg>`,
    );
    image = sharp(await image.png().toBuffer()).composite([{ input: circle, blend: 'dest-in' }]);
  }
  return image;
}

async function write(file, options, finish = (image) => image) {
  const { width, height } = await sharp(file).metadata();
  const image = finish(await compose(width, height, options));
  await image.png().toFile(file);
  console.log(`${relative(repoRoot, file)} ${width}x${height}`);
}

// iOS app icon: Apple rejects icons with an alpha channel.
await write(
  join(iosAssets, 'AppIcon.appiconset/AppIcon-512@2x.png'),
  { markRatio: 0.7, background: BACKGROUND },
  (image) => image.flatten({ background: BACKGROUND }).removeAlpha(),
);

// Android launcher icons, per density.
for (const dir of readdirSync(androidRes).filter((name) => name.startsWith('mipmap-') && !name.includes('anydpi')).sort()) {
  await write(join(androidRes, dir, 'ic_launcher.png'), { markRatio: 0.7, background: BACKGROUND });
  await write(join(androidRes, dir, 'ic_launcher_round.png'), { markRatio: 0.7, background: BACKGROUND, round: true });
  // Adaptive-icon foreground: the mark stays inside the 66 dp safe zone of the 108 dp layer.
  await write(join(androidRes, dir, 'ic_launcher_foreground.png'), { markRatio: 0.46, background: null });
}

// Splash images.
for (const name of readdirSync(join(iosAssets, 'Splash.imageset')).filter((n) => n.endsWith('.png')).sort()) {
  await write(join(iosAssets, 'Splash.imageset', name), { markRatio: 0.2, background: BACKGROUND });
}
for (const dir of readdirSync(androidRes).filter((name) => name.startsWith('drawable')).sort()) {
  const file = join(androidRes, dir, 'splash.png');
  if (readdirSync(join(androidRes, dir)).includes('splash.png')) {
    await write(file, { markRatio: 0.2, background: BACKGROUND });
  }
}
