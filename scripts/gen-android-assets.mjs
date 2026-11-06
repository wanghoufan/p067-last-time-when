import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const RES = path.resolve('android/app/src/main/res');
const PURPLE = '#2F4A7E';
const SPLASH_BG = '#f6f7fa';
const SPLASH_BG_DARK = '#11131b';

const ART = `
  <rect x="28" y="34" width="72" height="66" rx="12" fill="#fff"/>
  <path d="M44 26V40M84 26V40" stroke="#fff" stroke-width="8" stroke-linecap="round" fill="none"/>
  <circle cx="80" cy="82" r="17" fill="${PURPLE}"/>
  <path d="M80 73V83L87 87.5" fill="none" stroke="#fff" stroke-linecap="round" stroke-linejoin="round" stroke-width="6"/>
`;

const fullIcon = (size) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
    <rect width="128" height="128" rx="28" fill="${PURPLE}"/>
    ${ART}
  </svg>`);

const foregroundIcon = (size) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 108 108">
    <g transform="translate(2.52,2.52) scale(0.82)">
      ${ART}
    </g>
  </svg>`);

const roundMask = (size) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
    <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/>
  </svg>`);

const splash = async (width, height, bg, iconSize) => {
  const icon = await sharp(fullIcon(iconSize)).png().toBuffer();
  return sharp({ create: { width, height, channels: 4, background: bg } })
    .composite([{ input: icon, left: Math.round((width - iconSize) / 2), top: Math.round((height - iconSize) / 2) }])
    .png()
    .toBuffer();
};

const write = async (file, buffer) => {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buffer);
};

const legacy = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
const adaptive = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };
const screen = {
  mdpi: [320, 480],
  hdpi: [480, 800],
  xhdpi: [720, 1280],
  xxhdpi: [960, 1600],
  xxxhdpi: [1280, 1920],
};

for (const [density, size] of Object.entries(legacy)) {
  const dir = path.join(RES, `mipmap-${density}`);
  await write(path.join(dir, 'ic_launcher.png'), await sharp(fullIcon(size)).png().toBuffer());

  const rounded = await sharp(fullIcon(size))
    .composite([{ input: await sharp(roundMask(size)).png().toBuffer(), blend: 'dest-in' }])
    .png()
    .toBuffer();
  await write(path.join(dir, 'ic_launcher_round.png'), rounded);
}

for (const [density, size] of Object.entries(adaptive)) {
  await write(
    path.join(RES, `mipmap-${density}`, 'ic_launcher_foreground.png'),
    await sharp(foregroundIcon(size)).png().toBuffer(),
  );
}

for (const [density, [w, h]] of Object.entries(screen)) {
  const iconSize = Math.round(Math.min(w, h) * 0.28);
  await write(path.join(RES, `drawable-port-${density}`, 'splash.png'), await splash(w, h, SPLASH_BG, iconSize));
  await write(path.join(RES, `drawable-land-${density}`, 'splash.png'), await splash(h, w, SPLASH_BG, iconSize));
  await write(
    path.join(RES, `drawable-port-night-${density}`, 'splash.png'),
    await splash(w, h, SPLASH_BG_DARK, iconSize),
  );
  await write(
    path.join(RES, `drawable-land-night-${density}`, 'splash.png'),
    await splash(h, w, SPLASH_BG_DARK, iconSize),
  );
}

await write(path.join(RES, 'drawable', 'splash.png'), await splash(480, 800, SPLASH_BG, 134));
await write(path.join(RES, 'drawable-night', 'splash.png'), await splash(480, 800, SPLASH_BG_DARK, 134));

await write(
  path.join(RES, 'values', 'ic_launcher_background.xml'),
  Buffer.from(
    `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${PURPLE}</color>\n</resources>\n`,
  ),
);

console.log('[android-assets] icons + splash generated');
