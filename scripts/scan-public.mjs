#!/usr/bin/env node
/**
 * scan-public.mjs — 公开仓库 / 构建产物的敏感信息与私密内容扫描（AC-31）。
 *
 * 只读：不改任何文件。退出码 0 = PASS，1 = FAIL。
 * 用法：node scripts/scan-public.mjs
 *      node scripts/scan-public.mjs --dir dist   # 额外扫描指定构建产物目录
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const MAX_SCAN_BYTES = 512 * 1024;
const TEXT_EXT = new Set([
  '.md', '.txt', '.json', '.jsonl', '.yml', '.yaml', '.js', '.mjs', '.cjs', '.ts',
  '.tsx', '.css', '.html', '.webmanifest', '.sh', '.toml', '',
]);

// 治理 / 私密资料：不得进入公开仓库
const FORBIDDEN_TRACKED = [
  /^AGENTS\.md$/,
  /^agent\.md$/,
  /^\.project\.yaml$/,
  /^GOVERNANCE_VERSION$/,
  /^经验一句话\.md$/,
  /^USER_MODEL_OVERRIDE\.md/,
  /^Orca .*\.md$/,
  /^ORCA治理体系说明\.md$/,
  /^归位表/,
  /^外部开发者提示词\.md$/,
  /^编排者提示词\.md$/,
  /^docs\//,
  /^scripts\/model\//,
  /^scripts\/orchestration\//,
  /^scripts\/decision\//,
  /^\.codeartsdoer\//,
  /^\.screenshots\//,
];

// 真实个人备份：绝不允许被跟踪或进入 dist
const FORBIDDEN_ARTIFACT = [/whenlast-backup-\d{8}-\d{6}\.json$/i];

const SECRET_PATTERNS = [
  { name: 'OpenAI key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'GitHub token', re: /\b(ghp|gho|ghs|ghu)_[A-Za-z0-9]{20,}\b/ },
  { name: 'GitHub fine-grained token', re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/ },
  { name: 'Bearer token literal', re: /\bBearer\s+[A-Za-z0-9._-]{24,}\b/ },
];

const problems = [];
const notes = [];

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function trackedFiles() {
  try {
    return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean);
  } catch {
    notes.push('未检测到 git 或当前不是仓库：跳过跟踪文件清单检查');
    return [];
  }
}

function isText(file) {
  return TEXT_EXT.has(path.extname(file).toLowerCase());
}

function scanFile(file, label) {
  let info;
  try {
    info = statSync(file);
  } catch {
    problems.push(`${label}：文件不存在 ${rel(file)}`);
    return;
  }
  if (info.size === 0) return;
  if (info.size > MAX_SCAN_BYTES) {
    notes.push(`${label}：跳过过大文件 ${rel(file)} (${info.size} bytes)`);
    return;
  }
  if (!isText(file)) return;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    notes.push(`${label}：无法读取（按二进制跳过）${rel(file)}`);
    return;
  }
  for (const rule of SECRET_PATTERNS) {
    if (rule.re.test(text)) {
      problems.push(`${label}：${rel(file)} 命中「${rule.name}」`);
    }
  }
  if (FORBIDDEN_ARTIFACT.some((re) => re.test(path.basename(file))) && label === '构建产物') {
    problems.push(`${label}：${rel(file)} 疑似真实备份文件被打包`);
  }
}

const tracked = trackedFiles();
for (const file of tracked) {
  if (FORBIDDEN_TRACKED.some((re) => re.test(file))) {
    problems.push(`跟踪文件：治理/私密资料被 git 跟踪 → ${file}`);
  }
  scanFile(path.join(ROOT, file), '跟踪文件');
}

// 允许显式指定构建产物目录（默认 dist）
const dirIndex = process.argv.indexOf('--dir');
const distDirs = dirIndex >= 0 ? [path.resolve(ROOT, process.argv[dirIndex + 1])] : [path.join(ROOT, 'dist')];
for (const dist of distDirs) {
  let st;
  try {
    st = statSync(dist);
  } catch {
    notes.push(`构建产物目录不存在，跳过：${rel(dist)}`);
    continue;
  }
  if (!st.isDirectory()) {
    notes.push(`构建产物路径不是目录，跳过：${rel(dist)}`);
    continue;
  }
  const stack = [dist];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const entry of readdirSafe(current)) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(absolute);
        continue;
      }
      if (FORBIDDEN_ARTIFACT.some((re) => re.test(entry.name))) {
        problems.push(`构建产物：${rel(absolute)} 疑似真实备份文件被打包`);
      }
      if (/\.(md|jsonl)$/i.test(entry.name) && /AGENTS|handoff|HANDOFF|经验一句话/.test(entry.name)) {
        problems.push(`构建产物：${rel(absolute)} 疑似治理文档被打包`);
      }
      scanFile(absolute, '构建产物');
    }
  }
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

console.log(`[scan-public] 跟踪文件 ${tracked.length} 个；扫描构建目录 ${distDirs.map(rel).join(', ') || '(无)'}`);
for (const note of notes) console.log(`NOTE ${note}`);
if (problems.length > 0) {
  for (const problem of problems) console.log(`FAIL ${problem}`);
  console.log(`PUBLIC-SCAN-RESULT: FAIL (${problems.length} 项)`);
  process.exit(1);
}
console.log('PASS 跟踪文件无治理/私密资料、无密钥特征；构建产物无真实备份');
console.log('PUBLIC-SCAN-RESULT: PASS');