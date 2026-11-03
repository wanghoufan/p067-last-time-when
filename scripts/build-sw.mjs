#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { access, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const TEMPLATE = path.join(ROOT, 'public/sw.js');
const MANIFEST = path.join(DIST, 'manifest.webmanifest');
const INDEX = path.join(DIST, 'index.html');
const SW_OUT = path.join(DIST, 'sw.js');
const PRECACHE_MARKER = '/*__PRECACHE__*/';
const EXCLUDED = new Set(['sw.js']);

function log(message) {
  process.stdout.write(`[build-sw] ${message}\n`);
}

function fail(messages) {
  const list = Array.isArray(messages) ? messages : [messages];
  for (const message of list) {
    process.stderr.write(`[build-sw] 失败：${message}\n`);
  }
  process.exit(1);
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(dir, entry.name);
    const relative = path.relative(base, absolute).split(path.sep).join('/');
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(absolute, base)));
    } else if (entry.isFile() && !EXCLUDED.has(relative)) {
      files.push(relative);
    }
  }
  return files;
}

function toPrecacheEntry(relative) {
  return `./${relative}`;
}

async function validateManifest(manifestFile) {
  const raw = await readFile(manifestFile, 'utf8');
  let manifest;
  try {
    manifest = JSON.parse(raw);
  } catch (error) {
    return [`manifest.webmanifest 不是合法 JSON：${error.message}`];
  }
  const problems = [];
  if (!Array.isArray(manifest.icons) || manifest.icons.length === 0) {
    problems.push('manifest.webmanifest 缺少 icons 数组');
    return problems;
  }
  for (const icon of manifest.icons) {
    if (!icon || typeof icon.src !== 'string') {
      problems.push('manifest.webmanifest 存在缺少 src 的 icon 条目');
      continue;
    }
    const iconFile = path.resolve(DIST, icon.src);
    if (!(await exists(iconFile))) {
      problems.push(`manifest 引用的图标不存在：${icon.src}`);
    }
  }
  return problems;
}

async function main() {
  if (!(await exists(DIST))) {
    fail(`dist 目录不存在，请先执行 vite build：${DIST}`);
  }
  if (!(await exists(INDEX))) {
    fail(`缺少构建产物：${INDEX}`);
  }
  if (!(await exists(MANIFEST))) {
    fail(`缺少构建产物：${MANIFEST}`);
  }

  const manifestProblems = await validateManifest(MANIFEST);
  if (manifestProblems.length > 0) {
    fail(manifestProblems);
  }

  const template = await readFile(TEMPLATE, 'utf8');
  if (!template.includes(PRECACHE_MARKER)) {
    fail(`public/sw.js 缺少预缓存占位标记 ${PRECACHE_MARKER}`);
  }
  if (!/const SW_VERSION = ['"][^'"]*['"];/.test(template)) {
    fail('public/sw.js 缺少 SW_VERSION 声明');
  }

  const relativeFiles = await collectFiles(DIST);
  relativeFiles.sort();

  const cacheEntries = [];
  const hashParts = [];
  for (const relative of relativeFiles) {
    const file = path.join(DIST, relative);
    const info = await stat(file);
    const entry = toPrecacheEntry(encodeURI(relative));
    cacheEntries.push(entry);
    hashParts.push(`${relative}:${info.size}`);
  }

  const hash = createHash('sha256').update(hashParts.join('\n')).digest('hex').slice(0, 12);
  const buildStamp = new Date().toISOString();
  const version = `whenlast-v1-${hash}-${Date.now().toString(36)}`;
  const buildComment = `/* WhenLast service worker build: ${buildStamp} | manifest: ${hash} | files: ${cacheEntries.length} */\n`;

  let output = template.replace(PRECACHE_MARKER, JSON.stringify(cacheEntries, null, 2));
  output = output.replace(/const SW_VERSION = ['"][^'"]*['"];/, `const SW_VERSION = '${version}';`);
  output = buildComment + output;

  if (output.includes(PRECACHE_MARKER)) {
    fail('生成结果仍残留预缓存占位标记');
  }
  if (output.includes("'whenlast-v1';")) {
    fail('生成结果未写入新的版本号');
  }

  await writeFile(SW_OUT, output, 'utf8');
  log(`生成 ${path.relative(ROOT, SW_OUT)}（版本 ${version}，预缓存 ${cacheEntries.length} 个文件）`);

  const written = await readFile(SW_OUT, 'utf8');
  const missing = cacheEntries.filter((entry) => !written.includes(JSON.stringify(entry)));
  const required = ['./index.html', './manifest.webmanifest'];
  for (const entry of required) {
    if (!written.includes(JSON.stringify(entry))) {
      missing.push(entry);
    }
  }
  if (!(await exists(SW_OUT))) {
    missing.push(path.relative(ROOT, SW_OUT));
  }
  if (missing.length > 0) {
    fail(['生成后的 sw.js 缺少以下关键缓存路径：', ...missing.map((entry) => `  - ${entry}`)]);
  }

  log(`校验通过：index.html、manifest.webmanifest、sw.js 均存在，共 ${cacheEntries.length} 个缓存路径`);
}

main().catch((error) => {
  fail(`未预期错误：${error && error.message ? error.message : String(error)}`);
});