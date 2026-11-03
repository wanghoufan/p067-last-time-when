#!/usr/bin/env node
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'docs/design/assets/whenlast-icon.svg');
const OUT_DIR = path.join(ROOT, 'public/icons');
const BRAND = '#5942bb';
const MASKABLE_RATIO = 0.8;

function log(message) {
  process.stdout.write(`[gen-icons] ${message}\n`);
}

async function renderFull(svg, size) {
  return sharp(svg, { density: 600 })
    .resize(size, size, { fit: 'contain' })
    .png()
    .toBuffer();
}

async function renderOnBrandBackdrop(svg, size, ratio) {
  const contentSize = Math.max(1, Math.round(size * ratio));
  const content = await sharp(svg, { density: 600 })
    .resize(contentSize, contentSize, { fit: 'contain' })
    .png()
    .toBuffer();
  const offset = Math.floor((size - contentSize) / 2);
  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: BRAND,
    },
  })
    .composite([{ input: content, left: offset, top: offset }])
    .png()
    .toBuffer();
}

async function assertPng(file, expectedSize) {
  const info = await stat(file);
  if (!info.isFile() || info.size === 0) {
    throw new Error(`产物为空或不是文件：${file}`);
  }
  const metadata = await sharp(file).metadata();
  if (metadata.format !== 'png') {
    throw new Error(`格式不是 png：${file}（${metadata.format}）`);
  }
  if (metadata.width !== expectedSize || metadata.height !== expectedSize) {
    throw new Error(
      `尺寸不符：${file} 期望 ${expectedSize}x${expectedSize}，实际 ${metadata.width}x${metadata.height}`
    );
  }
  log(`${path.relative(ROOT, file)} ${metadata.width}x${metadata.height} ${metadata.format}`);
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  let svg;
  try {
    svg = await readFile(SOURCE);
  } catch (error) {
    throw new Error(`读取图标源文件失败：${SOURCE}（${error.message}）`);
  }

  const targets = [
    { name: 'icon-192.png', size: 192, ratio: null },
    { name: 'icon-512.png', size: 512, ratio: null },
    { name: 'icon-512-maskable.png', size: 512, ratio: MASKABLE_RATIO },
    { name: 'apple-touch-icon-180.png', size: 180, ratio: 1 },
  ];

  for (const target of targets) {
    const file = path.join(OUT_DIR, target.name);
    const buffer =
      target.ratio === null
        ? await renderFull(svg, target.size)
        : await renderOnBrandBackdrop(svg, target.size, target.ratio);
    await writeFile(file, buffer);
    await assertPng(file, target.size);
  }

  log(`完成，共 ${targets.length} 个图标写入 ${path.relative(ROOT, OUT_DIR)}/`);
}

main().catch((error) => {
  process.stderr.write(`[gen-icons] 失败：${error.message}\n`);
  process.exit(1);
});