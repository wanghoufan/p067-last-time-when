#!/usr/bin/env node
import { chromium } from 'playwright-core';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const EVIDENCE = path.join(ROOT, 'e2e-evidence');
const FIXTURES = path.join(EVIDENCE, 'fixtures');
const PREVIEW_URL = 'http://localhost:4179/';
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const VIEWPORT = { width: 390, height: 844 };

const checks = [];
const consoleEvents = [];
const pageErrors = [];
const requestFailures = [];

let buildStatus = 'FAIL';
let buildOutput = '';
let context;
let page;
let preview;
let previewLog = '';
let userDataDir = '';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function formatLocalDate(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localToday() {
  return formatLocalDate(new Date());
}

function addDays(value, amount) {
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + amount));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function calendarDaysBetween(from, to) {
  const a = from.split('-').map(Number);
  const b = to.split('-').map(Number);
  return (Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 86400000;
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function relEvidence(name) {
  return path.posix.join('e2e-evidence', name);
}

function record(ac, step, status, evidence, detail) {
  checks.push({
    ac,
    step,
    status: status === 'PASS' ? 'PASS' : 'FAIL',
    evidence: evidence || '',
    detail: detail || '',
  });
}

function recentContext() {
  const parts = [];
  const errors = consoleEvents.filter((event) => event.type === 'error').slice(-3);
  if (errors.length > 0) {
    parts.push(`控制台错误：${errors.map((event) => `${event.text}${event.location?.url ? ` @ ${event.location.url}` : ''}`).join(' || ')}`);
  }
  if (pageErrors.length > 0) {
    parts.push(`页面异常：${pageErrors.slice(-3).join(' || ')}`);
  }
  const failed = requestFailures.slice(-3);
  if (failed.length > 0) {
    parts.push(`请求失败：${failed.map((event) => `${event.url} (${event.error})`).join(' || ')}`);
  }
  return parts.length > 0 ? `｜${parts.join('｜')}` : '';
}

async function check(ac, step, evidence, fn) {
  try {
    const detail = await fn();
    record(ac, step, 'PASS', evidence, typeof detail === 'string' ? detail : '');
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    record(ac, step, 'FAIL', evidence, `${message}${recentContext()}`);
    process.stderr.write(`[FAIL] ${ac} ${step}: ${message}\n`);
    return false;
  }
}

async function capture(name) {
  await sleep(350);
  await page.screenshot({ path: path.join(EVIDENCE, name), fullPage: false });
  return relEvidence(name);
}

function makeBackup({ items, events, settings }) {
  return {
    app: 'whenlast',
    schemaVersion: 1,
    exportedAt: '2026-11-01T08:00:00.000Z',
    items,
    events,
    settings: settings || { id: 'app', theme: 'SYSTEM', language: 'zh-CN' },
  };
}

function makeItem(id, name, createdAt) {
  return {
    id,
    name,
    nameKey: name.toLowerCase(),
    createdAt,
    updatedAt: createdAt,
  };
}

function makeEvent(id, itemId, occurredOn, createdAt) {
  return {
    id,
    itemId,
    occurredOn,
    createdAt,
    updatedAt: createdAt,
  };
}

async function writeResult() {
  const expected = [
    ['BUILD', 'npm run build 成功'],
    ['PWA-PREVIEW', '本地预览启动'],
    ['AC-01', '空态添加「理发」后列表出现事项'],
    ['AC-01', '0 天前（今天）/ 最近两次间隔暂无 / 历史出现今天一条'],
    ['AC-02', '同日再点记一次被禁用且事件数不增加'],
    ['AC-04', '补记过去日期：历史重排、间隔重算'],
    ['AC-04', '补记未来日期被拒且无新记录'],
    ['AC-05', '历史中编辑事件日期成功且全局倒序'],
    ['AC-05', '删除事件取消后仍在'],
    ['AC-05', '删除事件确认后消失且事项保留'],
    ['AC-06', '历史全局按日期倒序'],
    ['AC-06', '同一天多条顺序多次刷新一致'],
    ['AC-03', '固定 JSON 导入成功'],
    ['AC-03', '首页距今天数与最近间隔等于独立计算值'],
    ['AC-07', '刷新后数据仍在（含记录后）'],
    ['AC-08', '导出触发下载并保存'],
    ['AC-08', '导入导出文件：预检统计可见且条数一致'],
    ['AC-08', '坏 JSON 明确失败且原数据条数不变'],
    ['AC-27', '导出文件名含秒级时间戳且内容与本机一致'],
    ['AC-27', '下载提示明确需到下载项确认并另存'],
    ['AC-28', '恢复预检同时显示备份与本机数量'],
    ['AC-28', '取消预检不改动本机数据'],
    ['AC-28', '超大文件、未来日期备份被拒绝且不改数据'],
    ['AC-29', '备份再次恢复后事项/记录/间隔一致'],
    ['AC-32', '备份入口与换机指引可见且不承诺永久保存'],
    ['AC-09', '切 DARK 生效并刷新保持'],
    ['AC-09', '切 LIGHT 生效'],
    ['AC-09', 'SYSTEM + 系统深色解析 dark，切回 light'],
    ['AC-10', '切 English 关键文案英文并刷新保持'],
    ['AC-10', '跟随系统 + fr-FR 回退中文'],
    ['AC-11', '表单打开时系统深色切换：草稿与弹层保持'],
    ['AC-11', '关闭弹层后切主题/语言：记录不丢'],
    ['AC-12', '滚动后底栏仍贴底可见'],
    ['AC-12', '选中态视觉与 aria 可区分'],
    ['AC-13', '界面不出现内部字眼'],
    ['AC-13', '设置内隐私说明可见'],
    ['AC-17', '删除事项取消后无变化'],
    ['AC-17', '坏导入不损坏旧数据'],
    ['AC-18', '首页一键记一次路径直达'],
    ['AC-19', '搜索过滤'],
    ['AC-19', '清空恢复全集'],
    ['PWA-OFFLINE', 'Service Worker 就绪且 controller 存在'],
    ['PWA-OFFLINE', '离线重载仍可打开并显示数据'],
    ['PWA-OFFLINE', '离线再记一次成功写入'],
    ['PWA-OFFLINE', '恢复网络后数据仍在'],
    ['PWA-STATIC', 'manifest 200 且 name/display/icons 正确'],
    ['PWA-STATIC', 'sw.js 200 且注册成功'],
    ['UI-320', '320x640 无横向溢出'],
  ];

  for (const [ac, step] of expected) {
    if (!checks.some((entry) => entry.ac === ac && entry.step === step)) {
      record(ac, step, 'FAIL', '', '未执行（前序步骤失败或流程中断）');
    }
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    build: buildStatus,
    checks,
  };
  await fsp.writeFile(
    path.join(EVIDENCE, 'e2e-result.json'),
    `${JSON.stringify(payload, null, 2)}\n`,
    'utf8',
  );
  return payload;
}

async function portIsOpen() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port: 4179 });
    const finish = (value) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(500);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

async function waitForServer() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(PREVIEW_URL, { signal: AbortSignal.timeout(2000) });
      if (response.ok) return true;
    } catch {
      // 等服务启动
    }
    await sleep(250);
  }
  return false;
}

async function waitApp() {
  await page.waitForSelector('.app-header', { timeout: 20000 });
  await page
    .waitForFunction(() => !document.querySelector('#splash'), null, { timeout: 5000 })
    .catch(() => undefined);
}

async function goHome() {
  await page.locator('.tabbar .tab').nth(0).click();
  await page.waitForSelector('.home', { timeout: 8000 });
}

async function goHistory() {
  await page.locator('.tabbar .tab').nth(1).click();
  await page.waitForSelector('.history-page', { timeout: 8000 });
}

async function closeConfirm() {
  const overlay = page.locator('.confirm-overlay');
  if ((await overlay.count()) === 0) return;
  await page.locator('.confirm-overlay .dialog-actions button').nth(0).click();
  await page.waitForFunction(() => !document.querySelector('.confirm-overlay'), null, {
    timeout: 5000,
  }).catch(() => undefined);
}

async function closeSheet() {
  const overlay = page.locator('.sheet-overlay');
  if ((await overlay.count()) === 0) return;
  const close = page.locator('.sheet-overlay .sheet-close').last();
  if (await close.isVisible().catch(() => false)) {
    await close.click();
  }
  await page.waitForFunction(() => !document.querySelector('.sheet-overlay'), null, {
    timeout: 5000,
  }).catch(() => undefined);
}

async function closeAnyOverlay() {
  await closeConfirm();
  await closeSheet();
}

async function itemLocator(name) {
  return page.locator('.item').filter({ hasText: name }).first();
}

async function openSettings() {
  await closeAnyOverlay();
  await page.locator('[data-settings-trigger]').click();
  await page.waitForSelector('.settings', { timeout: 8000 });
}

async function addItem(name) {
  await closeAnyOverlay();
  await goHome();
  const itemCount = await page.locator('.item').count();
  if (itemCount === 0) {
    await page.locator('.empty-state .btn-primary').click();
  } else {
    await page.locator('.add-button').click();
  }
  await page.waitForSelector('#add-name', { timeout: 8000 });
  await page.fill('#add-name', name);
  await page.locator('.sheet form button[type="submit"]').click();
  await page.waitForFunction(() => !document.querySelector('.sheet-overlay'), null, {
    timeout: 12000,
  }).catch(async () => {
    const errors = await page.locator('.sheet .form-error').allTextContents().catch(() => []);
    throw new Error(`添加事项「${name}」后弹层未关闭：${errors.join('；') || '无错误文案'}`);
  });
  await page.waitForFunction(
    (expected) => [...document.querySelectorAll('.item-name')].some((node) => node.textContent === expected),
    name,
    { timeout: 12000 },
  );
}

async function openDetail(name) {
  await closeAnyOverlay();
  await goHome();
  const item = await itemLocator(name);
  await item.locator('.item-details').click();
  await page.waitForSelector('.detail', { timeout: 8000 });
}

async function readCounts() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('whenlast');
    request.onerror = () => reject(new Error(`IndexedDB 打开失败：${request.error?.message || ''}`));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['items', 'events'], 'readonly');
      const items = tx.objectStore('items').count();
      const events = tx.objectStore('events').count();
      tx.oncomplete = () => {
        const result = { items: items.result, events: events.result };
        db.close();
        resolve(result);
      };
      tx.onerror = () => {
        const message = tx.error?.message || '事务失败';
        db.close();
        reject(new Error(`IndexedDB 计数失败：${message}`));
      };
    };
  }));
}

async function readSettings() {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open('whenlast');
    request.onerror = () => reject(new Error(`IndexedDB 打开失败：${request.error?.message || ''}`));
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('settings', 'readonly');
      const get = tx.objectStore('settings').get('app');
      get.onsuccess = () => {
        const value = get.result;
        db.close();
        resolve(value || null);
      };
      get.onerror = () => {
        db.close();
        reject(new Error(`设置读取失败：${get.error?.message || ''}`));
      };
    };
  }));
}

async function waitSetting(key, value, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const settings = await readSettings();
      if (settings && settings[key] === value) return;
    } catch {
      // 等待写入
    }
    await sleep(100);
  }
  throw new Error(`设置 ${key}=${value} 未在 ${timeout}ms 内持久化`);
}

async function chooseRadio(name, value) {
  const input = page.locator(`input[name="${name}"][value="${value}"]`).first();
  await input.waitFor({ state: 'attached', timeout: 5000 });
  if (!(await input.isChecked())) {
    await input.check();
  }
}

async function downloadBackup(targetName = 'AC-08-1-export.json') {
  const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
  await page.locator('.settings .settings-actions button').first().click();
  const download = await downloadPromise;
  const target = path.join(EVIDENCE, targetName);
  await download.saveAs(target);
  const failure = await download.failure();
  ensure(!failure, `下载失败：${failure || ''}`);
  const stat = await fsp.stat(target);
  ensure(stat.size > 0, '导出文件为空');
  return { target, suggested: download.suggestedFilename(), size: stat.size };
}

async function importBackupFile(filePath, expectedStats, screenshotName) {
  await closeAnyOverlay();
  await openSettings();
  await page.locator('.settings .file-input').setInputFiles(filePath);
  await page.waitForSelector('.import-preview', { timeout: 10000 });
  const text = await page.locator('.import-preview').innerText();
  for (const expected of expectedStats) {
    ensure(text.includes(expected), `预检未显示「${expected}」，实际为：${text.replace(/\n/g, ' / ')}`);
  }
  if (screenshotName) await capture(screenshotName);
  await page.locator('.import-preview .btn-danger').click();
  await page.waitForSelector('.confirm-overlay', { timeout: 5000 });
  await page.locator('.confirm-overlay .dialog-actions button').nth(1).click();
  await page.waitForFunction(() => !document.querySelector('.import-preview'), null, {
    timeout: 12000,
  });
  await sleep(400);
  return text;
}

async function historyRows() {
  return page.$$eval('.history-page .history-row', (rows) =>
    rows.map((row) => ({
      date: row.querySelector('time')?.getAttribute('datetime') || row.querySelector('time')?.textContent || '',
      name: row.querySelector('.history-name')?.textContent || '',
      id: row.getAttribute('data-event-id') || '',
    })),
  );
}

async function detailDates() {
  return page.$$eval('.detail .history-row time', (nodes) =>
    nodes.map((node) => node.getAttribute('datetime') || node.textContent || ''),
  );
}

async function waitLogged(name) {
  await page.waitForFunction((expected) => {
    const item = [...document.querySelectorAll('.item')].find(
      (node) => node.querySelector('.item-name')?.textContent === expected,
    );
    const button = item?.querySelector('.item-log');
    return Boolean(button && button.disabled);
  }, name, { timeout: 12000 });
}

async function clickLog(name) {
  const item = await itemLocator(name);
  await item.locator('.item-log').click();
  await waitLogged(name);
}

async function main() {
  await fsp.mkdir(EVIDENCE, { recursive: true });
  await fsp.mkdir(FIXTURES, { recursive: true });

  const build = spawnSync('npm', ['run', 'build'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 180000,
    maxBuffer: 10 * 1024 * 1024,
  });
  buildOutput = `$ npm run build\n${build.stdout || ''}\n${build.stderr || ''}\nEXIT ${build.status}`;
  await fsp.writeFile(path.join(EVIDENCE, 'build.log'), buildOutput, 'utf8');

  const artifacts = ['dist/index.html', 'dist/sw.js', 'dist/manifest.webmanifest'];
  const artifactsOk = artifacts.every((file) => fs.existsSync(path.join(ROOT, file)));
  buildStatus = build.status === 0 && artifactsOk ? 'PASS' : 'FAIL';
  record(
    'BUILD',
    'npm run build 成功',
    buildStatus,
    relEvidence('build.log'),
    buildStatus === 'PASS' ? 'exit 0；dist/index.html、dist/sw.js、dist/manifest.webmanifest 均存在' : buildOutput,
  );
  if (buildStatus !== 'PASS') {
    await writeResult();
    return;
  }

  if (await portIsOpen()) {
    record('PWA-PREVIEW', '本地预览启动', 'FAIL', relEvidence('preview.log'), '端口 4179 已被占用，未启动本次预览');
    await writeResult();
    return;
  }

  preview = spawn('npm', ['run', 'preview', '--', '--port', '4179', '--strictPort'], {
    cwd: ROOT,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  preview.stdout.on('data', (chunk) => {
    previewLog += chunk.toString();
  });
  preview.stderr.on('data', (chunk) => {
    previewLog += chunk.toString();
  });
  preview.on('error', (error) => {
    previewLog += `preview spawn error: ${error.message}\n`;
  });

  const serverReady = await waitForServer();
  await fsp.writeFile(path.join(EVIDENCE, 'preview.log'), previewLog, 'utf8');
  record(
    'PWA-PREVIEW',
    '本地预览启动',
    serverReady ? 'PASS' : 'FAIL',
    relEvidence('preview.log'),
    serverReady ? `npm run preview -- --port 4179 --strictPort；访问 ${PREVIEW_URL} 返回 200` : previewLog,
  );
  if (!serverReady) {
    await writeResult();
    return;
  }

  const today = localToday();
  const past7 = addDays(today, -7);
  const past10 = addDays(today, -10);
  const future1 = addDays(today, 1);
  const fixedGapDays = calendarDaysBetween('2026-10-01', '2026-10-20');
  const fixedElapsedDays = calendarDaysBetween('2026-10-20', today);

  const fixedBackupPath = path.join(FIXTURES, 'AC-03-fixed-backup.json');
  await fsp.writeFile(
    fixedBackupPath,
    `${JSON.stringify(makeBackup({
      items: [makeItem('item-fixed-walk', '散步', '2026-09-01T08:00:00.000Z')],
      events: [
        makeEvent('event-fixed-1', 'item-fixed-walk', '2026-10-01', '2026-10-01T08:00:00.000Z'),
        makeEvent('event-fixed-2', 'item-fixed-walk', '2026-10-20', '2026-10-20T08:00:00.000Z'),
      ],
    }), null, 2)}\n`,
    'utf8',
  );

  const offlineBackupPath = path.join(FIXTURES, 'offline-backup.json');
  await fsp.writeFile(
    offlineBackupPath,
    `${JSON.stringify(makeBackup({
      items: [
        makeItem('item-offline-a', '离线甲', '2026-09-01T08:00:00.000Z'),
        makeItem('item-offline-b', '离线乙', '2026-09-01T08:00:00.000Z'),
      ],
      events: [
        makeEvent('event-offline-a', 'item-offline-a', '2026-10-01', '2026-10-01T08:00:00.000Z'),
        makeEvent('event-offline-b', 'item-offline-b', '2026-10-01', '2026-10-01T08:00:00.000Z'),
      ],
    }), null, 2)}\n`,
    'utf8',
  );

  const badBackupPath = path.join(FIXTURES, 'bad-backup.json');
  await fsp.writeFile(
    badBackupPath,
    `${JSON.stringify({ app: 'whenlast', schemaVersion: 999, exportedAt: '2026-10-01T00:00:00.000Z', items: [], events: [] }, null, 2)}\n`,
    'utf8',
  );

  userDataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'whenlast-e2e-'));
  context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: CHROME_PATH,
    headless: true,
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    locale: 'zh-CN',
    colorScheme: 'light',
    acceptDownloads: true,
    downloadsPath: EVIDENCE,
  });
  page = context.pages()[0] || (await context.newPage());
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(20000);

  page.on('console', (message) => {
    consoleEvents.push({
      type: message.type(),
      text: message.text(),
      location: message.location(),
    });
  });
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  page.on('requestfailed', (request) => {
    requestFailures.push({
      url: request.url(),
      error: request.failure()?.errorText || 'unknown',
    });
  });

  await page.goto(PREVIEW_URL, { waitUntil: 'load' });
  await waitApp();

  await check('AC-01', '空态添加「理发」后列表出现事项', relEvidence('AC-01-1-空态.png'), async () => {
    ensure((await page.locator('.empty-state').count()) === 1, '初始未显示空态');
    await capture('AC-01-1-空态.png');
    await page.locator('.empty-state .btn-primary').click();
    await page.waitForSelector('#add-name', { timeout: 8000 });
    await page.fill('#add-name', '理发');
    await page.locator('.sheet form button[type="submit"]').click();
    await page.waitForFunction(() => !document.querySelector('.sheet-overlay'), null, { timeout: 12000 });
    await page.waitForFunction(
      () => [...document.querySelectorAll('.item-name')].some((node) => node.textContent === '理发'),
      null,
      { timeout: 12000 },
    );
    const names = await page.locator('.item-name').allTextContents();
    ensure(names.length === 1 && names[0] === '理发', `列表内容异常：${names.join('、')}`);
    const counts = await readCounts();
    ensure(counts.items === 1 && counts.events === 1, `IndexedDB 计数异常：${JSON.stringify(counts)}`);
    await capture('AC-01-2-首页列表.png');
    return `列表事项=${names.join('、')}；IndexedDB items=${counts.items}, events=${counts.events}`;
  });

  await check('AC-01', '0 天前（今天）/ 最近两次间隔暂无 / 历史出现今天一条', relEvidence('AC-01-3-历史首条.png'), async () => {
    const elapsed = (await (await itemLocator('理发')).locator('.item-elapsed').innerText()).trim();
    const gap = (await (await itemLocator('理发')).locator('.item-gap').innerText()).trim();
    const last = (await (await itemLocator('理发')).locator('.item-sub').innerText()).trim();
    ensure(elapsed === '今天', `距今天数应为今天/0 天，实际「${elapsed}」`);
    ensure(gap.includes('暂无'), `最近两次间隔应为暂无，实际「${gap}」`);
    ensure(last.includes(`最近：${today}`), `最近日期应含今天 ${today}，实际「${last}」`);
    await goHistory();
    const rows = await historyRows();
    ensure(rows.length === 1, `历史条数应为 1，实际 ${rows.length}`);
    ensure(rows[0].date === today, `历史日期应为 ${today}，实际 ${rows[0].date}`);
    await capture('AC-01-3-历史首条.png');
    return `elapsed=${elapsed}；gap=${gap}；last=${last}；history=${JSON.stringify(rows)}`;
  });

  await check('AC-02', '同日再点记一次被禁用且事件数不增加', relEvidence('AC-02-1-今天已记.png'), async () => {
    await goHome();
    const item = await itemLocator('理发');
    const button = item.locator('.item-log');
    const before = await readCounts();
    ensure(await button.isDisabled(), '「记一次」按钮未禁用');
    ensure((await button.innerText()).includes('今天已记'), `按钮文案不是今天已记：${await button.innerText()}`);
    await button.click({ force: true, timeout: 1000 }).catch(() => undefined);
    await sleep(400);
    const after = await readCounts();
    ensure(after.events === before.events, `事件数发生变化：${before.events} -> ${after.events}`);
    await capture('AC-02-1-今天已记.png');
    await goHistory();
    const history = await historyRows();
    ensure(history.length === 1, `历史条数应保持 1，实际 ${history.length}`);
    return `按钮禁用且文案=今天已记；IndexedDB events=${after.events}；历史条数=${history.length}`;
  });

  await check('AC-04', '补记过去日期：历史重排、间隔重算', relEvidence('AC-04-2-补记后间隔.png'), async () => {
    await openDetail('理发');
    await capture('AC-04-1-补记前详情.png');
    const datesBefore = await detailDates();
    ensure(datesBefore.length === 1 && datesBefore[0] === today, `补记前详情历史异常：${datesBefore.join('、')}`);
    await page.locator('.detail input[type="date"]').first().fill(past7);
    await page.locator('.detail button[type="submit"]').filter({ hasText: '补记' }).first().click();
    await page.waitForFunction(() => document.querySelectorAll('.detail .history-row').length === 2, null, {
      timeout: 12000,
    });
    await page.waitForFunction(() => document.querySelector('.detail-count')?.textContent?.includes('2'), null, {
      timeout: 8000,
    });
    const datesAfter = await detailDates();
    ensure(datesAfter.join(',') === `${today},${past7}`, `详情历史顺序应为 ${today},${past7}，实际 ${datesAfter.join(',')}`);
    await capture('AC-04-2-补记后间隔.png');
    await closeSheet();
    const gap = (await (await itemLocator('理发')).locator('.item-gap').innerText()).trim();
    const expectedGap = calendarDaysBetween(past7, today);
    ensure(gap.includes(`${expectedGap} 天`), `最近间隔应为 ${expectedGap} 天，实际「${gap}」`);
    await capture('AC-04-2-补记后间隔.png');
    return `补记 ${past7}；详情历史=${datesAfter.join('、')}；首页间隔=${gap}`;
  });

  await check('AC-04', '补记未来日期被拒且无新记录', relEvidence('AC-04-3-未来日期拒绝.png'), async () => {
    await openDetail('理发');
    const countBefore = await readCounts();
    const input = page.locator('.detail input[type="date"]').first();
    await input.fill(future1);
    const validity = await input.evaluate((node) => ({
      valid: node.validity.valid,
      rangeOverflow: node.validity.rangeOverflow,
      max: node.getAttribute('max'),
    }));
    await page.locator('.detail button[type="submit"]').filter({ hasText: '补记' }).first().click();
    await sleep(700);
    const errors = await page.locator('.detail .form-error').allTextContents();
    const countAfter = await readCounts();
    const dates = await detailDates();
    await capture('AC-04-3-未来日期拒绝.png');
    ensure(countAfter.events === countBefore.events, `事件数异常增加：${countBefore.events} -> ${countAfter.events}`);
    ensure(dates.length === 2, `详情历史条数应保持 2，实际 ${dates.length}`);
    ensure(
      errors.some((text) => text.includes('日期不能晚于今天')) || validity.rangeOverflow || validity.valid === false,
      `未来日期未被拒绝：errors=${errors.join('；')}，validity=${JSON.stringify(validity)}`,
    );
    await closeSheet();
    return `未来日期 ${future1}：errors=${errors.join('；') || '无应用层文案'}；validity=${JSON.stringify(validity)}；events 保持 ${countAfter.events}`;
  });

  await check('AC-05', '历史中编辑事件日期成功且全局倒序', relEvidence('AC-05-2-编辑后历史.png'), async () => {
    await goHistory();
    await capture('AC-05-1-历史.png');
    const row = page.locator('.history-page .history-row').filter({ hasText: past7 }).first();
    ensure((await row.count()) === 1, `未找到 ${past7} 的历史行`);
    await row.click();
    await page.waitForSelector('.event-summary', { timeout: 8000 });
    await page.locator('.sheet input[type="date"]').fill(past10);
    await page.locator('.sheet .form button[type="submit"]').click();
    await page.waitForFunction(() => !document.querySelector('.sheet-overlay'), null, { timeout: 12000 });
    await page.waitForFunction(
      (date) => [...document.querySelectorAll('.history-page .history-date')].some((node) => node.textContent === date),
      past10,
      { timeout: 10000 },
    );
    const rows = await historyRows();
    ensure(rows.length === 2, `历史条数应为 2，实际 ${rows.length}`);
    ensure(rows[0].date === today && rows[1].date === past10, `历史倒序应为 ${today},${past10}，实际 ${rows.map((r) => r.date).join(',')}`);
    await capture('AC-05-2-编辑后历史.png');
    return `编辑 ${past7} -> ${past10}；历史=${rows.map((r) => `${r.date} ${r.name}`).join('、')}`;
  });

  await check('AC-05', '删除事件取消后仍在', relEvidence('AC-05-3-删除取消.png'), async () => {
    const row = page.locator('.history-page .history-row').filter({ hasText: past10 }).first();
    await row.click();
    await page.waitForSelector('.event-summary', { timeout: 8000 });
    await page.locator('.sheet .btn-danger').filter({ hasText: '删除这条记录' }).click();
    await page.waitForSelector('.confirm-overlay', { timeout: 5000 });
    const dialogTitle = await page.locator('.confirm-overlay .dialog-title').innerText();
    await page.locator('.confirm-overlay .dialog-actions button').nth(0).click();
    await page.waitForFunction(() => !document.querySelector('.confirm-overlay'), null, { timeout: 5000 });
    await capture('AC-05-3-删除取消.png');
    await closeSheet();
    const rows = await historyRows();
    ensure(rows.some((entry) => entry.date === past10), `取消后 ${past10} 行消失`);
    return `确认弹层「${dialogTitle}」取消；${past10} 行仍在，历史=${rows.map((r) => r.date).join(',')}`;
  });

  await check('AC-05', '删除事件确认后消失且事项保留', relEvidence('AC-05-4-删除确认后.png'), async () => {
    const row = page.locator('.history-page .history-row').filter({ hasText: past10 }).first();
    await row.click();
    await page.waitForSelector('.event-summary', { timeout: 8000 });
    await page.locator('.sheet .btn-danger').filter({ hasText: '删除这条记录' }).click();
    await page.waitForSelector('.confirm-overlay', { timeout: 5000 });
    await page.locator('.confirm-overlay .dialog-actions button').nth(1).click();
    await page.waitForFunction(() => !document.querySelector('.sheet-overlay'), null, { timeout: 12000 });
    await page.waitForFunction(
      (date) => ![...document.querySelectorAll('.history-page .history-date')].some((node) => node.textContent === date),
      past10,
      { timeout: 10000 },
    );
    const rows = await historyRows();
    ensure(!rows.some((entry) => entry.date === past10), `确认后 ${past10} 仍存在`);
    await goHome();
    const names = await page.locator('.item-name').allTextContents();
    ensure(names.includes('理发'), `删除事件后事项丢失：${names.join('、')}`);
    await capture('AC-05-4-删除确认后.png');
    return `删除后历史=${rows.map((r) => r.date).join(',')}；首页仍含理发`;
  });

  await check('AC-06', '历史全局按日期倒序', relEvidence('AC-06-1-同日排序.png'), async () => {
    await addItem('洗车');
    await openDetail('洗车');
    await page.locator('.detail input[type="date"]').first().fill(past10);
    await page.locator('.detail button[type="submit"]').filter({ hasText: '补记' }).first().click();
    await page.waitForFunction(() => document.querySelectorAll('.detail .history-row').length === 2, null, {
      timeout: 12000,
    });
    await closeSheet();
    await goHistory();
    const rows = await historyRows();
    ensure(rows.length === 3, `历史条数应为 3，实际 ${rows.length}`);
    for (let index = 1; index < rows.length; index += 1) {
      ensure(rows[index - 1].date >= rows[index].date, `历史未按日期倒序：${rows.map((r) => r.date).join(',')}`);
    }
    ensure(rows.filter((entry) => entry.date === today).length === 2, `今天应有 2 条，实际 ${rows.filter((entry) => entry.date === today).length}`);
    await capture('AC-06-1-同日排序.png');
    return `历史=${rows.map((r) => `${r.date} ${r.name}`).join('、')}`;
  });

  await check('AC-06', '同一天多条顺序多次刷新一致', relEvidence('AC-06-1-同日排序.png'), async () => {
    const snapshots = [];
    for (let round = 0; round < 3; round += 1) {
      await page.reload({ waitUntil: 'load' });
      await waitApp();
      await goHistory();
      const rows = await historyRows();
      snapshots.push(rows.map((row) => row.id).join(','));
      if (!rows.every((row, index) => index === 0 || rows[index - 1].date >= row.date)) {
        throw new Error(`第 ${round + 1} 次刷新后日期顺序异常：${rows.map((r) => r.date).join(',')}`);
      }
    }
    ensure(new Set(snapshots).size === 1, `多次刷新同日顺序不一致：${snapshots.join(' | ')}`);
    return `3 次刷新事件 ID 顺序一致：${snapshots[0]}`;
  });

  await check('AC-03', '固定 JSON 导入成功', relEvidence('AC-03-1-导入预检.png'), async () => {
    const text = await importBackupFile(fixedBackupPath, ['事项：1', '记录：2'], 'AC-03-1-导入预检.png');
    await closeSheet();
    await goHome();
    const names = await page.locator('.item-name').allTextContents();
    ensure(names.length === 1 && names[0] === '散步', `导入后事项应为散步，实际 ${names.join('、')}`);
    const counts = await readCounts();
    ensure(counts.items === 1 && counts.events === 2, `导入后计数异常：${JSON.stringify(counts)}`);
    return `预检=${text.replace(/\n/g, ' / ')}；IndexedDB=${JSON.stringify(counts)}`;
  });

  await check('AC-03', '首页距今天数与最近间隔等于独立计算值', relEvidence('AC-03-2-固定数据首页.png'), async () => {
    const item = await itemLocator('散步');
    const elapsed = (await item.locator('.item-elapsed').innerText()).trim();
    const gap = (await item.locator('.item-gap').innerText()).trim();
    const expectedElapsedText = fixedElapsedDays === 0 ? '今天' : `${fixedElapsedDays} 天前`;
    ensure(elapsed === expectedElapsedText, `距今天数应为 ${fixedElapsedDays}（${expectedElapsedText}），实际「${elapsed}」`);
    ensure(gap.includes(`${fixedGapDays} 天`), `最近两次间隔应为 ${fixedGapDays} 天，实际「${gap}」`);
    await capture('AC-03-2-固定数据首页.png');
    return `今天=${today}；独立计算 2026-10-20 距今 ${fixedElapsedDays} 天；2026-10-01 与 2026-10-20 间隔 ${fixedGapDays} 天；界面 elapsed=${elapsed}, gap=${gap}`;
  });

  await check('AC-18', '首页一键记一次路径直达', relEvidence('AC-18-1-一键记一次.png'), async () => {
    await goHome();
    const before = await readCounts();
    ensure((await page.locator('.sheet-overlay').count()) === 0, '首页存在遮挡弹层');
    await clickLog('散步');
    const after = await readCounts();
    ensure(after.events === before.events + 1, `一次点击后事件数未 +1：${before.events} -> ${after.events}`);
    ensure((await page.locator('.sheet-overlay').count()) === 0, '一键记一次过程中打开了详情弹层');
    const elapsed = (await (await itemLocator('散步')).locator('.item-elapsed').innerText()).trim();
    ensure(elapsed === '今天', `一键记录后 elapsed 应为今天，实际「${elapsed}」`);
    await capture('AC-18-1-一键记一次.png');
    return `一次点击：events ${before.events} -> ${after.events}；elapsed=${elapsed}；未打开详情`;
  });

  await check('AC-07', '刷新后数据仍在（含记录后）', relEvidence('AC-07-1-刷新后.png'), async () => {
    await page.reload({ waitUntil: 'load' });
    await waitApp();
    const names = await page.locator('.item-name').allTextContents();
    ensure(names.includes('散步'), `刷新后事项丢失：${names.join('、')}`);
    const elapsed = (await (await itemLocator('散步')).locator('.item-elapsed').innerText()).trim();
    ensure(elapsed === '今天', `刷新后 elapsed 应为今天，实际「${elapsed}」`);
    await goHistory();
    const rows = await historyRows();
    ensure(rows.length === 3, `刷新后历史应为 3 条，实际 ${rows.length}`);
    await capture('AC-07-1-刷新后.png');
    return `刷新后事项=${names.join('、')}；历史条数=${rows.length}；elapsed=${elapsed}`;
  });

  await check('AC-19', '搜索过滤', relEvidence('AC-19-1-搜索.png'), async () => {
    await addItem('擦窗');
    await goHome();
    await page.locator('.search-input').fill('散');
    await page.waitForFunction(() => {
      const names = [...document.querySelectorAll('.item-name')].map((node) => node.textContent);
      return names.length === 1 && names[0] === '散步';
    }, null, { timeout: 5000 });
    await capture('AC-19-1-搜索.png');
    await page.locator('.search-input').fill('不存在的事项');
    await page.waitForFunction(() => document.querySelector('.empty-hint')?.textContent === '没有匹配的事项', null, {
      timeout: 5000,
    });
    return '输入「散」仅剩散步；输入不存在关键字显示没有匹配的事项';
  });

  await check('AC-19', '清空恢复全集', relEvidence('AC-19-1-搜索.png'), async () => {
    await page.locator('.search-input').fill('');
    await page.waitForFunction(() => document.querySelectorAll('.item-name').length === 2, null, {
      timeout: 5000,
    });
    const names = await page.locator('.item-name').allTextContents();
    ensure(names.length === 2 && names.includes('散步') && names.includes('擦窗'), `清空后列表异常：${names.join('、')}`);
    await capture('AC-19-1-搜索.png');
    return `清空后恢复 ${names.length} 项：${names.join('、')}`;
  });

  let exportInfo;
  let countsBeforeBadImport;

  await check('AC-08', '导出触发下载并保存', relEvidence('AC-08-1-export.json'), async () => {
    await openSettings();
    exportInfo = await downloadBackup();
    const parsed = JSON.parse(await fsp.readFile(exportInfo.target, 'utf8'));
    ensure(parsed.app === 'whenlast' && parsed.schemaVersion === 1, '导出 JSON 标识或版本不正确');
    ensure(Array.isArray(parsed.items) && parsed.items.length === 2, `导出事项数应为 2，实际 ${parsed.items?.length}`);
    ensure(Array.isArray(parsed.events) && parsed.events.length === 4, `导出记录数应为 4，实际 ${parsed.events?.length}`);
    await closeSheet();
    return `下载文件 ${exportInfo.suggested}，${exportInfo.size} bytes；items=${parsed.items.length}, events=${parsed.events.length}`;
  });

  await check('AC-08', '导入导出文件：预检统计可见且条数一致', relEvidence('AC-08-2-导入预检.png'), async () => {
    ensure(exportInfo, '导出文件缺失，无法导入');
    await closeAnyOverlay();
    await openSettings();
    await page.locator('.settings .file-input').setInputFiles(exportInfo.target);
    await page.waitForSelector('.import-preview', { timeout: 10000 });
    const text = await page.locator('.import-preview').innerText();
    ensure(text.includes('事项：2'), `预检事项数不是 2：${text.replace(/\n/g, ' / ')}`);
    ensure(text.includes('记录：4'), `预检记录数不是 4：${text.replace(/\n/g, ' / ')}`);
    await capture('AC-08-2-导入预检.png');
    await page.locator('.import-preview .btn-danger').click();
    await page.waitForSelector('.confirm-overlay', { timeout: 5000 });
    await page.locator('.confirm-overlay .dialog-actions button').nth(1).click();
    await page.waitForFunction(() => !document.querySelector('.import-preview'), null, { timeout: 12000 });
    await sleep(500);
    const counts = await readCounts();
    ensure(counts.items === 2 && counts.events === 4, `导入后计数异常：${JSON.stringify(counts)}`);
    await closeSheet();
    await goHistory();
    const rows = await historyRows();
    ensure(rows.length === 4, `导入后历史条数应为 4，实际 ${rows.length}`);
    return `预检=${text.replace(/\n/g, ' / ')}；确认后 IndexedDB=${JSON.stringify(counts)}，历史=${rows.length}`;
  });

  await check('AC-08', '坏 JSON 明确失败且原数据条数不变', relEvidence('AC-08-3-坏导入.png'), async () => {
    countsBeforeBadImport = await readCounts();
    await closeAnyOverlay();
    await openSettings();
    await page.locator('.settings .file-input').setInputFiles(badBackupPath);
    await page.waitForFunction(
      () => [...document.querySelectorAll('.settings .form-error')].some((node) => node.textContent?.includes('备份文件无效')),
      null,
      { timeout: 10000 },
    );
    const errors = await page.locator('.settings .form-error').allTextContents();
    const countsAfter = await readCounts();
    ensure(
      errors.some((text) => text.includes('备份文件无效，现有数据未改动')),
      `失败提示不明确：${errors.join('；')}`,
    );
    ensure(
      countsAfter.items === countsBeforeBadImport.items && countsAfter.events === countsBeforeBadImport.events,
      `坏导入改变了数据：${JSON.stringify(countsBeforeBadImport)} -> ${JSON.stringify(countsAfter)}`,
    );
    await capture('AC-08-3-坏导入.png');
    await closeSheet();
    return `提示=${errors.join('；')}；计数保持 ${JSON.stringify(countsAfter)}`;
  });

  await check('AC-17', '坏导入不损坏旧数据', relEvidence('AC-08-3-坏导入.png'), async () => {
    const counts = await readCounts();
    ensure(
      counts.items === countsBeforeBadImport.items && counts.events === countsBeforeBadImport.events,
      `坏导入后数据不一致：${JSON.stringify(countsBeforeBadImport)} -> ${JSON.stringify(counts)}`,
    );
    return `坏导入前后均为 items=${counts.items}, events=${counts.events}`;
  });

  await check('AC-27', '导出文件名含秒级时间戳且内容与本机一致', relEvidence('AC-27-1-export.json'), async () => {
    await closeAnyOverlay();
    await openSettings();
    const info = await downloadBackup('AC-27-1-export.json');
    const toastText = await page.locator('.toast').innerText().catch(() => '');
    ensure(
      /^whenlast-backup-\d{8}-\d{6}\.json$/.test(info.suggested),
      `备份文件名不是 whenlast-backup-YYYYMMDD-HHmmss.json：${info.suggested}`,
    );
    ensure(info.suggested !== '', '备份文件名为空');
    const parsed = JSON.parse(await fsp.readFile(info.target, 'utf8'));
    const counts = await readCounts();
    ensure(parsed.items.length === counts.items, `备份事项数 ${parsed.items.length} 与本机 ${counts.items} 不一致`);
    ensure(parsed.events.length === counts.events, `备份记录数 ${parsed.events.length} 与本机 ${counts.events} 不一致`);
    ensure(!Number.isNaN(Date.parse(parsed.exportedAt)), `exportedAt 无效：${parsed.exportedAt}`);
    ensure(
      !/"(apiKey|token|password|secret)"/i.test(JSON.stringify(parsed)),
      '备份中出现疑似凭据字段',
    );
    ensure(toastText.includes('已发起下载'), `导出提示不得声称已保存成功，实际：${toastText}`);
    exportInfo = info;
    return `文件名=${info.suggested}；items=${parsed.items.length}, events=${parsed.events.length}，与本机一致；toast=「${toastText}」`;
  });

  await check('AC-27', '下载提示明确需到下载项确认并另存', relEvidence('AC-27-2-下载提示.png'), async () => {
    const hint = await page.locator('.settings .export-download-hint').innerText();
    ensure(hint.includes('下载项') || hint.includes('下载'), `下载提示未说明需到下载项确认：${hint}`);
    ensure(hint.includes('另存'), `下载提示未建议另存一份：${hint}`);
    await capture('AC-27-2-下载提示.png');
    await closeSheet();
    return `提示=「${hint}」`;
  });

  await check('AC-28', '恢复预检同时显示备份与本机数量', relEvidence('AC-28-1-导入预检双计数.png'), async () => {
    ensure(exportInfo, '缺少待恢复的备份文件');
    await closeAnyOverlay();
    await openSettings();
    await page.locator('.settings .file-input').setInputFiles(exportInfo.target);
    await page.waitForSelector('.import-preview', { timeout: 10000 });
    const text = await page.locator('.import-preview').innerText();
    const counts = await readCounts();
    for (const expected of ['事项：', '记录：', '本机现有事项：', '本机现有记录：', '不会合并', '导出时间：']) {
      ensure(text.includes(expected), `预检缺少「${expected}」：${text.replace(/\n/g, ' / ')}`);
    }
    ensure(text.includes(`本机现有事项：${counts.items}`), `预检本机事项数不等于 ${counts.items}：${text.replace(/\n/g, ' / ')}`);
    ensure(text.includes(`本机现有记录：${counts.events}`), `预检本机记录数不等于 ${counts.events}：${text.replace(/\n/g, ' / ')}`);
    ensure(
      (await page.locator('.import-preview .import-export-first').count()) === 1,
      '本机已有数据时预检未提供「先备份本机数据」入口',
    );
    await capture('AC-28-1-导入预检双计数.png');
    return `预检=「${text.replace(/\n/g, ' / ')}」，本机计数=${JSON.stringify(counts)}，含先备份入口`;
  });

  await check('AC-28', '取消预检不改动本机数据', relEvidence('AC-28-2-取消预检.png'), async () => {
    const before = await readCounts();
    await page.locator('.import-preview .import-actions button').first().click();
    await page.waitForFunction(() => !document.querySelector('.import-preview'), null, {
      timeout: 5000,
    });
    const after = await readCounts();
    ensure(
      after.items === before.items && after.events === before.events,
      `取消预检后数据变化：${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
    );
    await capture('AC-28-2-取消预检.png');
    return `取消预检后 IndexedDB 保持 ${JSON.stringify(after)}`;
  });

  await check('AC-28', '超大文件、未来日期备份被拒绝且不改数据', relEvidence('AC-28-3-坏备份拒绝.png'), async () => {
    const before = await readCounts();

    const oversizePath = path.join(FIXTURES, 'oversize-backup.json');
    await fsp.writeFile(oversizePath, `{"app":"whenlast"}${' '.repeat(5 * 1024 * 1024)}`, 'utf8');
    await page.locator('.settings .file-input').setInputFiles(oversizePath);
    await page.waitForFunction(
      () => [...document.querySelectorAll('.settings .form-error')].some((node) => node.textContent?.includes('超过 5 MB')),
      null,
      { timeout: 10000 },
    );

    const futurePath = path.join(FIXTURES, 'future-backup.json');
    await fsp.writeFile(
      futurePath,
      `${JSON.stringify({
        app: 'whenlast',
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        items: [{ id: 'item-future', name: '未来事项', nameKey: '未来事项', createdAt: '2026-09-01T08:00:00.000Z', updatedAt: '2026-09-01T08:00:00.000Z' }],
        events: [{ id: 'event-future', itemId: 'item-future', occurredOn: future1, createdAt: '2026-09-01T08:00:00.000Z', updatedAt: '2026-09-01T08:00:00.000Z' }],
      }, null, 2)}\n`,
      'utf8',
    );
    await page.locator('.settings .file-input').setInputFiles(futurePath);
    await page.waitForFunction(
      () => [...document.querySelectorAll('.settings .form-error')].some((node) => node.textContent?.includes('备份文件无效')),
      null,
      { timeout: 10000 },
    );

    const errors = await page.locator('.settings .form-error').allTextContents();
    ensure((await page.locator('.import-preview').count()) === 0, '被拒绝的备份仍出现了恢复预检');
    const after = await readCounts();
    ensure(
      after.items === before.items && after.events === before.events,
      `坏备份改变了数据：${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
    );
    await capture('AC-28-3-坏备份拒绝.png');
    await closeSheet();
    return `超大与未来日期备份被拒（${errors.join('；')}），计数保持 ${JSON.stringify(after)}`;
  });

  await check('AC-29', '备份再次恢复后事项/记录/间隔一致', relEvidence('AC-29-1-恢复后核对.png'), async () => {
    ensure(exportInfo, '缺少待恢复的备份文件');
    await closeAnyOverlay();
    await goHome();
    const before = await readCounts();
    const beforeGaps = await page.evaluate(() =>
      [...document.querySelectorAll('.item')].map(
        (node) => `${node.querySelector('.item-name')?.textContent ?? ''}=${node.querySelector('.item-gap')?.textContent ?? ''}`,
      ),
    );
    ensure(beforeGaps.length === before.items, `首页事项卡数量 ${beforeGaps.length} 与 IndexedDB ${before.items} 不一致`);
    await goHistory();
    const beforeHistory = (await historyRows()).length;
    ensure(beforeHistory === before.events, `历史条数 ${beforeHistory} 与 IndexedDB ${before.events} 不一致`);

    await closeAnyOverlay();
    await openSettings();
    await page.locator('.settings .file-input').setInputFiles(exportInfo.target);
    await page.waitForSelector('.import-preview', { timeout: 10000 });
    await page.locator('.import-preview .btn-danger').click();
    await page.waitForSelector('.confirm-overlay', { timeout: 5000 });
    const message = await page.locator('.confirm-overlay .dialog-message').innerText();
    ensure(
      message.includes('替换') && message.includes('无法撤销'),
      `替换确认未说明会替换且不可撤销：${message}`,
    );
    await page.locator('.confirm-overlay .dialog-actions button').nth(1).click();
    await page.waitForFunction(() => !document.querySelector('.import-preview'), null, { timeout: 12000 });
    await sleep(400);
    await closeSheet();
    await goHome();
    const after = await readCounts();
    ensure(
      after.items === before.items && after.events === before.events,
      `恢复同一备份后计数变化：${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
    );
    const afterGaps = await page.evaluate(() =>
      [...document.querySelectorAll('.item')].map(
        (node) => `${node.querySelector('.item-name')?.textContent ?? ''}=${node.querySelector('.item-gap')?.textContent ?? ''}`,
      ),
    );
    ensure(
      JSON.stringify(afterGaps) === JSON.stringify(beforeGaps),
      `恢复后间隔显示变化：${JSON.stringify(beforeGaps)} -> ${JSON.stringify(afterGaps)}`,
    );
    await capture('AC-29-1-恢复后核对.png');
    await goHistory();
    const afterHistory = (await historyRows()).length;
    ensure(afterHistory === beforeHistory, `恢复后历史条数变化：${beforeHistory} -> ${afterHistory}`);
    return `确认文案=「${message}」；恢复前后 items=${after.items}, events=${after.events}, 历史=${afterHistory}，间隔显示一致`;
  });

  await check('AC-32', '备份入口与换机指引可见且不承诺永久保存', relEvidence('AC-32-1-换机指引.png'), async () => {
    await closeAnyOverlay();
    await openSettings();
    const settingsText = await page.locator('.settings').innerText();
    ensure(settingsText.includes('备份到手机'), '备份入口文案未使用「备份到手机」');
    ensure(settingsText.includes('从文件恢复'), '恢复入口文案未使用「从文件恢复」');
    ensure(settingsText.includes('换手机'), '设置内缺少换手机说明');
    const steps = await page.locator('.settings .migration-steps li').count();
    ensure(steps === 3, `换手机说明步骤数应为 3，实际 ${steps}`);
    ensure(settingsText.includes('另存一份'), '缺少数据丢失/另存一份提醒');
    ensure(!settingsText.includes('永久保存') && !settingsText.includes('永久安全'), '出现了永久保存类不实承诺');
    ensure(!settingsText.includes('云同步'), 'V1.3 不应出现云同步入口');
    await capture('AC-32-1-换机指引.png');
    await closeSheet();
    return `入口=备份到手机/从文件恢复；换手机步骤=${steps}；含另存提醒、无永久保存承诺、无云同步入口`;
  });

  await check('AC-17', '删除事项取消后无变化', relEvidence('AC-17-1-删除事项取消.png'), async () => {
    const before = await readCounts();
    await openDetail('擦窗');
    await page.locator('.detail .detail-danger .btn-danger').click();
    await page.waitForSelector('.confirm-overlay', { timeout: 5000 });
    const title = await page.locator('.confirm-overlay .dialog-title').innerText();
    await page.locator('.confirm-overlay .dialog-actions button').nth(0).click();
    await page.waitForFunction(() => !document.querySelector('.confirm-overlay'), null, { timeout: 5000 });
    await capture('AC-17-1-删除事项取消.png');
    await closeSheet();
    const names = await page.locator('.item-name').allTextContents();
    const after = await readCounts();
    ensure(names.includes('擦窗'), `取消删除后事项消失：${names.join('、')}`);
    ensure(after.items === before.items && after.events === before.events, `取消删除后计数变化：${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    return `确认弹层「${title}」取消；事项仍在；计数保持 ${JSON.stringify(after)}`;
  });

  await check('AC-11', '表单打开时系统深色切换：草稿与弹层保持', relEvidence('AC-11-1-跟随系统深色草稿保留.png'), async () => {
    await closeAnyOverlay();
    await openSettings();
    await chooseRadio('theme', 'SYSTEM');
    await waitSetting('theme', 'SYSTEM');
    await closeSheet();
    await goHome();
    await page.locator('.add-button').click();
    await page.waitForSelector('#add-name', { timeout: 8000 });
    await page.fill('#add-name', '未保存草稿');
    await capture('AC-11-0-草稿输入.png');
    await page.emulateMedia({ colorScheme: 'dark' });
    await sleep(300);
    const darkTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    ensure(darkTheme === 'dark', `跟随系统深色切换后 data-theme 应为 dark，实际 ${darkTheme}`);
    ensure((await page.locator('.sheet-overlay').count()) === 1, '深色切换后添加弹层已关闭');
    const darkDraft = await page.locator('#add-name').inputValue();
    ensure(darkDraft === '未保存草稿', `深色切换后草稿丢失：${darkDraft}`);
    await capture('AC-11-1-跟随系统深色草稿保留.png');
    await page.emulateMedia({ colorScheme: 'light' });
    await sleep(300);
    const lightTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    ensure(lightTheme === 'light', `切回浅色后 data-theme 应为 light，实际 ${lightTheme}`);
    ensure((await page.locator('.sheet-overlay').count()) === 1, '切回浅色后添加弹层已关闭');
    const lightDraft = await page.locator('#add-name').inputValue();
    ensure(lightDraft === '未保存草稿', `切回浅色后草稿丢失：${lightDraft}`);
    await capture('AC-11-1-跟随系统深色草稿保留.png');
    await page.locator('.sheet .form-actions .btn-secondary').first().click();
    await page.waitForFunction(() => !document.querySelector('.sheet-overlay'), null, { timeout: 5000 });
    return `SYSTEM + 系统深色/浅色切换：data-theme=${darkTheme}->${lightTheme}；弹层全程保持打开；草稿保持「${lightDraft}」；取消关闭成功`;
  });

  await check('AC-11', '关闭弹层后切主题/语言：记录不丢', relEvidence('AC-11-2-切换后记录.png'), async () => {
    await closeAnyOverlay();
    await goHome();
    const before = await readCounts();
    const namesBefore = await page.locator('.item-name').allTextContents();
    await openSettings();
    await chooseRadio('theme', 'LIGHT');
    await waitSetting('theme', 'LIGHT');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 5000 });
    await closeSheet();
    const afterLight = await readCounts();
    const namesAfterLight = await page.locator('.item-name').allTextContents();
    ensure(
      afterLight.items === before.items && afterLight.events === before.events,
      `切 LIGHT 后计数变化：${JSON.stringify(before)} -> ${JSON.stringify(afterLight)}`,
    );
    ensure(
      namesAfterLight.join(',') === namesBefore.join(','),
      `切 LIGHT 后事项变化：${namesBefore.join('、')} -> ${namesAfterLight.join('、')}`,
    );
    await capture('AC-11-2-切换后记录.png');
    await page.reload({ waitUntil: 'load' });
    await waitApp();
    const afterReload = await readCounts();
    const namesAfterReload = await page.locator('.item-name').allTextContents();
    ensure(
      afterReload.items === before.items && afterReload.events === before.events,
      `刷新后计数变化：${JSON.stringify(before)} -> ${JSON.stringify(afterReload)}`,
    );
    ensure(
      namesAfterReload.join(',') === namesBefore.join(','),
      `刷新后事项变化：${namesBefore.join('、')} -> ${namesAfterReload.join('、')}`,
    );
    await openSettings();
    for (const [key, value] of [['language', 'en'], ['language', 'FOLLOW_SYSTEM'], ['theme', 'SYSTEM']]) {
      await chooseRadio(key, value);
      await waitSetting(key, value);
    }
    await closeSheet();
    const after = await readCounts();
    const namesAfter = await page.locator('.item-name').allTextContents();
    ensure(after.items === before.items && after.events === before.events, `切换后计数变化：${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
    ensure(namesAfter.join(',') === namesBefore.join(','), `切换后事项变化：${namesBefore.join('、')} -> ${namesAfter.join('、')}`);
    await capture('AC-11-2-切换后记录.png');
    return `LIGHT、en→FOLLOW_SYSTEM 后刷新仍为 ${JSON.stringify(after)}，事项保持 ${namesAfter.join('、')}；主题已切回 SYSTEM`;
  });

  await check('AC-09', '切 DARK 生效并刷新保持', relEvidence('AC-09-1-深色.png'), async () => {
    await openSettings();
    await chooseRadio('theme', 'DARK');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 5000 });
    await waitSetting('theme', 'DARK');
    await capture('AC-09-0-深色设置.png');
    await page.reload({ waitUntil: 'load' });
    await waitApp();
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    ensure(theme === 'dark', `刷新后 data-theme 应为 dark，实际 ${theme}`);
    await capture('AC-09-1-深色.png');
    await openSettings();
    ensure(await page.locator('input[name="theme"][value="DARK"]').isChecked(), '刷新后 DARK 选项未选中');
    return `data-theme=${theme}；刷新后设置仍为 DARK`;
  });

  await check('AC-09', '切 LIGHT 生效', relEvidence('AC-09-1-深色.png'), async () => {
    ensure((await page.locator('.settings').count()) === 1, '设置弹层未打开');
    await chooseRadio('theme', 'LIGHT');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 5000 });
    await waitSetting('theme', 'LIGHT');
    const theme = await page.evaluate(() => document.documentElement.dataset.theme);
    ensure(theme === 'light', `data-theme 应为 light，实际 ${theme}`);
    return `data-theme=${theme}`;
  });

  await check('AC-09', 'SYSTEM + 系统深色解析 dark，切回 light', relEvidence('AC-09-2-跟随系统深色.png'), async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await chooseRadio('theme', 'SYSTEM');
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark', null, { timeout: 5000 });
    await waitSetting('theme', 'SYSTEM');
    await capture('AC-09-2-跟随系统深色.png');
    const darkTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    ensure(darkTheme === 'dark', `SYSTEM 深色应解析 dark，实际 ${darkTheme}`);
    await page.emulateMedia({ colorScheme: 'light' });
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'light', null, { timeout: 5000 });
    const lightTheme = await page.evaluate(() => document.documentElement.dataset.theme);
    ensure(lightTheme === 'light', `切回浅色应解析 light，实际 ${lightTheme}`);
    await closeSheet();
    return `SYSTEM + colorScheme=dark -> ${darkTheme}；切回 colorScheme=light -> ${lightTheme}`;
  });

  await check('AC-10', '切 English 关键文案英文并刷新保持', relEvidence('AC-10-1-英文.png'), async () => {
    await openSettings();
    await chooseRadio('language', 'en');
    await waitSetting('language', 'en');
    await closeSheet();
    await page.waitForFunction(() => document.querySelector('.app-title')?.textContent === 'WhenLast', null, {
      timeout: 8000,
    });
    const tabs = await page.locator('.tab-label').allTextContents();
    ensure(tabs.includes('Home') && tabs.includes('History'), `英文底栏文案异常：${tabs.join('、')}`);
    await capture('AC-10-1-英文.png');
    await page.reload({ waitUntil: 'load' });
    await waitApp();
    const title = (await page.locator('.app-title').innerText()).trim();
    const lang = await page.evaluate(() => document.documentElement.lang);
    ensure(title === 'WhenLast' && lang === 'en', `刷新后英文未保持：title=${title}, lang=${lang}`);
    await capture('AC-10-1-英文.png');
    return `刷新后 title=${title}, lang=${lang}, tabs=${tabs.join('/')}`;
  });

  await check('AC-10', '跟随系统 + fr-FR 回退中文', relEvidence('AC-10-2-法文回退中文.png'), async () => {
    await openSettings();
    await chooseRadio('language', 'FOLLOW_SYSTEM');
    await waitSetting('language', 'FOLLOW_SYSTEM');
    await closeSheet();
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'language', { get: () => 'fr-FR' });
      Object.defineProperty(navigator, 'languages', { get: () => ['fr-FR'] });
    });
    await page.reload({ waitUntil: 'load' });
    await waitApp();
    const language = await page.evaluate(() => navigator.language);
    const lang = await page.evaluate(() => document.documentElement.lang);
    const title = (await page.locator('.app-title').innerText()).trim();
    ensure(language === 'fr-FR', `navigator.language 未被覆写：${language}`);
    ensure(lang === 'zh-CN', `fr-FR 应回退 zh-CN，实际 ${lang}`);
    ensure(title === '上次啥时候', `回退中文后标题异常：${title}`);
    await capture('AC-10-2-法文回退中文.png');
    return `navigator.language=${language}；html.lang=${lang}；title=${title}`;
  });

  await check('AC-12', '滚动后底栏仍贴底可见', relEvidence('AC-12-1-底栏固定.png'), async () => {
    for (const name of ['扩展一', '扩展二', '扩展三', '扩展四', '扩展五']) {
      await addItem(name);
    }
    await goHome();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await sleep(400);
    const metrics = await page.evaluate(() => {
      const tabbar = document.querySelector('.tabbar');
      const rect = tabbar?.getBoundingClientRect();
      const centerX = rect ? rect.left + rect.width / 2 : 0;
      const centerY = rect ? rect.top + rect.height / 2 : 0;
      const hit = document.elementFromPoint(centerX, centerY);
      return {
        scrollY: window.scrollY,
        viewportHeight: window.innerHeight,
        rect: rect ? { top: rect.top, bottom: rect.bottom, height: rect.height, width: rect.width } : null,
        position: tabbar ? getComputedStyle(tabbar).position : '',
        hitInside: Boolean(hit && hit.closest('.tabbar')),
      };
    });
    ensure(metrics.rect, '找不到底栏');
    ensure(metrics.position === 'fixed', `底栏 position 应为 fixed，实际 ${metrics.position}`);
    ensure(Math.abs(metrics.rect.bottom - metrics.viewportHeight) <= 1.5, `滚动后底栏 bottom=${metrics.rect.bottom}，视口高=${metrics.viewportHeight}`);
    ensure(metrics.hitInside, '底栏中心点被其他元素遮挡');
    const itemCount = await page.locator('.item').count();
    ensure(itemCount === 7, `滚动列表事项数应为 7，实际 ${itemCount}`);
    await capture('AC-12-1-底栏固定.png');
    return `事项=${itemCount}；scrollY=${metrics.scrollY}；tabbar bottom=${metrics.rect.bottom}, viewport=${metrics.viewportHeight}, position=${metrics.position}`;
  });

  await check('AC-12', '选中态视觉与 aria 可区分', relEvidence('AC-12-1-底栏固定.png'), async () => {
    const tabs = await page.$$eval('.tabbar .tab', (nodes) =>
      nodes.map((node) => {
        const style = getComputedStyle(node);
        return {
          label: node.querySelector('.tab-label')?.textContent || '',
          selected: node.getAttribute('aria-selected'),
          active: node.classList.contains('is-active'),
          background: style.backgroundColor,
          color: style.color,
          fontWeight: style.fontWeight,
        };
      }),
    );
    ensure(tabs.length === 2, `底栏标签数应为 2，实际 ${tabs.length}`);
    const selected = tabs.filter((tab) => tab.selected === 'true');
    const unselected = tabs.filter((tab) => tab.selected === 'false');
    ensure(selected.length === 1 && unselected.length === 1, `aria-selected 异常：${JSON.stringify(tabs)}`);
    ensure(selected[0].active && !unselected[0].active, 'is-active 与 aria-selected 不一致');
    const visualDiff =
      selected[0].background !== unselected[0].background ||
      selected[0].color !== unselected[0].color ||
      selected[0].fontWeight !== unselected[0].fontWeight;
    ensure(visualDiff, '选中态与未选中态视觉无差异');
    return `选中=${selected[0].label} aria=true 背景=${selected[0].background} 色=${selected[0].color} 字重=${selected[0].fontWeight}；未选中=${unselected[0].label} aria=false 背景=${unselected[0].background} 色=${unselected[0].color} 字重=${unselected[0].fontWeight}`;
  });

  await check('AC-13', '界面不出现内部字眼', relEvidence('AC-13-1-设置隐私.png'), async () => {
    const homeText = await page.evaluate(() => document.body.innerText);
    await goHistory();
    const historyText = await page.evaluate(() => document.body.innerText);
    await goHome();
    await openSettings();
    await capture('AC-13-1-设置隐私.png');
    const settingsText = await page.evaluate(() => document.body.innerText);
    const patterns = [/\bGate\b/i, /\bFR\b/i, /\bAC\b/i, /\bID\b/, /schemaVersion/i, /\bhash\b/i];
    const hits = [];
    for (const [label, text] of [['首页', homeText], ['历史', historyText], ['设置', settingsText]]) {
      for (const pattern of patterns) {
        const match = text.match(pattern);
        if (match) hits.push(`${label}:${match[0]}`);
      }
    }
    ensure(hits.length === 0, `发现内部字眼：${hits.join('、')}`);
    return `首页/历史/设置可见文本均未命中 Gate、FR、AC、ID、schemaVersion、hash`;
  });

  await check('AC-13', '设置内隐私说明可见', relEvidence('AC-13-1-设置隐私.png'), async () => {
    const privacyTitle = await page.locator('.settings .section-title').filter({ hasText: '隐私说明' }).count();
    const privacyText = await page.locator('.settings .privacy-text').innerText();
    ensure(privacyTitle >= 1, '设置内未找到隐私说明标题');
    ensure(privacyText.includes('数据只保存在本机浏览器'), `隐私说明内容异常：${privacyText}`);
    await capture('AC-13-1-设置隐私.png');
    await closeSheet();
    return `隐私说明可见：${privacyText}`;
  });

  await check('UI-320', '320x640 无横向溢出', relEvidence('AC-20-1-320px.png'), async () => {
    await closeAnyOverlay();
    await page.setViewportSize({ width: 320, height: 640 });
    await page.reload({ waitUntil: 'load' });
    await waitApp();
    await page.evaluate(() => window.scrollTo(0, 0));
    await sleep(300);
    const metrics = await page.evaluate(() => {
      const offenders = [...document.querySelectorAll('body *')]
        .filter((node) => {
          const style = getComputedStyle(node);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const rect = node.getBoundingClientRect();
          return rect.width > 0 && rect.right > window.innerWidth + 1;
        })
        .slice(0, 6)
        .map((node) => `${node.tagName.toLowerCase()}.${String(node.className || '').split(' ').filter(Boolean).join('.')}`);
      return {
        innerWidth: window.innerWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        documentClientWidth: document.documentElement.clientWidth,
        bodyScrollWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
        tabbarWidth: document.querySelector('.tabbar')?.getBoundingClientRect().width || 0,
        offenders,
      };
    });
    ensure(metrics.documentScrollWidth <= metrics.documentClientWidth, `documentElement 横向溢出：scrollWidth=${metrics.documentScrollWidth}, clientWidth=${metrics.documentClientWidth}`);
    ensure(metrics.bodyScrollWidth <= metrics.bodyClientWidth, `body 横向溢出：scrollWidth=${metrics.bodyScrollWidth}, clientWidth=${metrics.bodyClientWidth}`);
    ensure(metrics.tabbarWidth <= 320, `底栏宽度 ${metrics.tabbarWidth} 超过 320`);
    await capture('AC-20-1-320px.png');
    await page.setViewportSize(VIEWPORT);
    await page.reload({ waitUntil: 'load' });
    await waitApp();
    return `320x640：document ${metrics.documentScrollWidth}/${metrics.documentClientWidth}，body ${metrics.bodyScrollWidth}/${metrics.bodyClientWidth}，tabbar=${metrics.tabbarWidth}；越界元素=${metrics.offenders.join('、') || '无'}`;
  });

  await check('PWA-OFFLINE', 'Service Worker 就绪且 controller 存在', relEvidence('sw-state.json'), async () => {
    await importBackupFile(offlineBackupPath, ['事项：2', '记录：2']);
    await closeSheet();
    await goHome();
    let state = await page.evaluate(async () => {
      const ready = await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('service worker ready 超时')), 12000)),
      ]);
      return {
        active: ready.active?.scriptURL || null,
        scope: ready.scope,
        controller: Boolean(navigator.serviceWorker.controller),
      };
    });
    if (!state.controller) {
      await page.reload({ waitUntil: 'load' });
      await waitApp();
      state = await page.evaluate(() => ({
        active: null,
        scope: '',
        controller: Boolean(navigator.serviceWorker.controller),
      }));
      const readyAgain = await page.evaluate(async () => {
        const ready = await navigator.serviceWorker.ready;
        return { active: ready.active?.scriptURL || null, scope: ready.scope };
      });
      state.active = readyAgain.active;
      state.scope = readyAgain.scope;
    }
    await fsp.writeFile(path.join(EVIDENCE, 'sw-state.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    ensure(Boolean(state.active), 'Service Worker 无 active worker');
    ensure(state.controller, '页面未被 Service Worker 控制（navigator.serviceWorker.controller 为空）');
    return `active=${state.active}；scope=${state.scope}；controller=${state.controller}`;
  });

  await check('PWA-OFFLINE', '离线重载仍可打开并显示数据', relEvidence('AC-21-1-离线首页.png'), async () => {
    await goHome();
    await clickLog('离线甲');
    const onlineCounts = await readCounts();
    ensure(onlineCounts.items === 2 && onlineCounts.events === 3, `在线记录后计数异常：${JSON.stringify(onlineCounts)}`);
    await context.setOffline(true);
    await sleep(300);
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 });
      await waitApp();
    } catch (error) {
      await capture('AC-21-1-离线失败.png');
      throw new Error(`离线重载失败：${error instanceof Error ? error.message : String(error)}${recentContext()}`);
    }
    const names = await page.locator('.item-name').allTextContents();
    ensure(names.includes('离线甲') && names.includes('离线乙'), `离线重载后事项异常：${names.join('、')}`);
    const elapsedA = (await (await itemLocator('离线甲')).locator('.item-elapsed').innerText()).trim();
    ensure(elapsedA === '今天', `离线重载后离线甲 elapsed 应为今天，实际「${elapsedA}」`);
    const expectedB = calendarDaysBetween('2026-10-01', today);
    const elapsedB = (await (await itemLocator('离线乙')).locator('.item-elapsed').innerText()).trim();
    ensure(elapsedB === `${expectedB} 天前`, `离线乙 elapsed 应为 ${expectedB} 天前，实际「${elapsedB}」`);
    await capture('AC-21-1-离线首页.png');
    return `离线重载成功；事项=${names.join('、')}；离线甲=${elapsedA}；离线乙=${elapsedB}`;
  });

  await check('PWA-OFFLINE', '离线再记一次成功写入', relEvidence('AC-21-2-离线记录.png'), async () => {
    const before = await readCounts();
    await clickLog('离线乙');
    const after = await readCounts();
    await capture('AC-21-2-离线记录.png');
    ensure(after.events === before.events + 1, `离线记录后事件数未 +1：${before.events} -> ${after.events}`);
    const elapsed = (await (await itemLocator('离线乙')).locator('.item-elapsed').innerText()).trim();
    ensure(elapsed === '今天', `离线记录后离线乙 elapsed 应为今天，实际「${elapsed}」`);
    return `离线记录：events ${before.events} -> ${after.events}；离线乙 elapsed=${elapsed}`;
  });

  await check('PWA-OFFLINE', '恢复网络后数据仍在', relEvidence('AC-21-3-恢复网络.png'), async () => {
    await context.setOffline(false);
    await page.reload({ waitUntil: 'load' });
    await waitApp();
    const counts = await readCounts();
    ensure(counts.items === 2 && counts.events === 4, `恢复网络后计数异常：${JSON.stringify(counts)}`);
    const names = await page.locator('.item-name').allTextContents();
    ensure(names.includes('离线甲') && names.includes('离线乙'), `恢复网络后事项异常：${names.join('、')}`);
    const elapsed = (await (await itemLocator('离线乙')).locator('.item-elapsed').innerText()).trim();
    ensure(elapsed === '今天', `恢复网络后离线乙 elapsed 应为今天，实际「${elapsed}」`);
    await capture('AC-21-3-恢复网络.png');
    return `恢复网络：items=${counts.items}, events=${counts.events}；离线乙=${elapsed}`;
  });

  await check('PWA-STATIC', 'manifest 200 且 name/display/icons 正确', relEvidence('pwa-static.json'), async () => {
    const pwa = await page.evaluate(async () => {
      const manifestUrl = new URL('./manifest.webmanifest', location.href).href;
      const manifestResponse = await fetch(manifestUrl);
      const manifest = await manifestResponse.json();
      const icons = [];
      for (const icon of manifest.icons || []) {
        try {
          const response = await fetch(new URL(icon.src, manifestUrl).href);
          icons.push({ src: icon.src, sizes: icon.sizes, purpose: icon.purpose, status: response.status, ok: response.ok });
        } catch (error) {
          icons.push({ src: icon.src, error: String(error) });
        }
      }
      const swResponse = await fetch(new URL('./sw.js', location.href).href);
      const ready = await navigator.serviceWorker.ready;
      const registration = await navigator.serviceWorker.getRegistration();
      return {
        manifestStatus: manifestResponse.status,
        manifest: {
          name: manifest.name,
          short_name: manifest.short_name,
          display: manifest.display,
          icons: (manifest.icons || []).map((icon) => ({ src: icon.src, sizes: icon.sizes, purpose: icon.purpose })),
          start_url: manifest.start_url,
        },
        icons,
        swStatus: swResponse.status,
        swOk: swResponse.ok,
        registration: registration
          ? { scope: registration.scope, active: registration.active?.scriptURL || null }
          : null,
        readyActive: ready.active?.scriptURL || null,
        controller: Boolean(navigator.serviceWorker.controller),
        href: location.href,
      };
    });
    await fsp.writeFile(path.join(EVIDENCE, 'pwa-static.json'), `${JSON.stringify(pwa, null, 2)}\n`, 'utf8');
    ensure(pwa.manifestStatus === 200, `manifest 状态码 ${pwa.manifestStatus}`);
    ensure(pwa.manifest.name === '上次啥时候', `manifest.name=${pwa.manifest.name}`);
    ensure(pwa.manifest.display === 'standalone', `manifest.display=${pwa.manifest.display}`);
    ensure((pwa.manifest.icons || []).some((icon) => icon.sizes === '192x192'), '缺少 192x192 图标');
    ensure((pwa.manifest.icons || []).some((icon) => icon.sizes === '512x512'), '缺少 512x512 图标');
    ensure((pwa.manifest.icons || []).some((icon) => icon.purpose?.includes('maskable')), '缺少 maskable 图标');
    ensure(pwa.icons.every((icon) => icon.ok === true && icon.status === 200), `图标请求异常：${JSON.stringify(pwa.icons)}`);
    return `manifest 200；name=${pwa.manifest.name}；display=${pwa.manifest.display}；icons=${pwa.icons.map((icon) => `${icon.sizes}/${icon.purpose}:${icon.status}`).join('、')}`;
  });

  await check('PWA-STATIC', 'sw.js 200 且注册成功', relEvidence('pwa-static.json'), async () => {
    const pwa = JSON.parse(await fsp.readFile(path.join(EVIDENCE, 'pwa-static.json'), 'utf8'));
    ensure(pwa.swStatus === 200 && pwa.swOk, `sw.js 状态码 ${pwa.swStatus}`);
    ensure(pwa.registration && pwa.registration.active, 'Service Worker 未注册/未激活');
    ensure((pwa.registration.active || '').endsWith('/sw.js'), `注册脚本异常：${pwa.registration.active}`);
    ensure(pwa.readyActive && pwa.readyActive.endsWith('/sw.js'), `ready active 异常：${pwa.readyActive}`);
    ensure(pwa.controller, '页面未被 Service Worker 控制');
    await capture('AC-22-1-PWA静态.png');
    return `sw.js 200；registration.active=${pwa.registration.active}；controller=${pwa.controller}`;
  });

  await fsp.writeFile(
    path.join(EVIDENCE, 'console.log'),
    `${consoleEvents.map((event) => `[${event.type}] ${event.text}${event.location?.url ? ` @ ${event.location.url}` : ''}`).join('\n')}\n`,
    'utf8',
  );
  await fsp.writeFile(
    path.join(EVIDENCE, 'network.log'),
    `${requestFailures.map((event) => `[failed] ${event.url} :: ${event.error}`).join('\n')}\n`,
    'utf8',
  );

  await writeResult();

  const failures = checks.filter((entry) => entry.status === 'FAIL');
  process.stdout.write(`\nBUILD ${buildStatus}\n`);
  process.stdout.write(`PASS ${checks.length - failures.length} / FAIL ${failures.length}\n`);
  if (failures.length > 0) {
    for (const failure of failures) {
      process.stdout.write(`FAIL ${failure.ac} | ${failure.step} | ${failure.detail}\n`);
    }
  }
  if (failures.length > 0) process.exitCode = 1;
}

async function cleanup() {
  if (preview) {
    try {
      process.kill(-preview.pid, 'SIGTERM');
    } catch {
      try {
        preview.kill('SIGTERM');
      } catch {
        // 已退出
      }
    }
    await sleep(600);
    try {
      process.kill(-preview.pid, 'SIGKILL');
    } catch {
      // 已退出
    }
    await fsp.writeFile(path.join(EVIDENCE, 'preview.log'), previewLog, 'utf8').catch(() => undefined);
  }
  if (context) {
    await context.close().catch(() => undefined);
  }
  if (userDataDir) {
    await fsp.rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? `${error.message}\n${error.stack || ''}` : String(error);
  record('GLOBAL', 'E2E 执行未抛出未捕获异常', 'FAIL', '', `${message}${recentContext()}`);
  try {
    await capture('FAIL-全局异常.png');
  } catch {
    // 页面不可用
  }
  await fsp.writeFile(
    path.join(EVIDENCE, 'console.log'),
    `${consoleEvents.map((event) => `[${event.type}] ${event.text}${event.location?.url ? ` @ ${event.location.url}` : ''}`).join('\n')}\n`,
    'utf8',
  ).catch(() => undefined);
  await fsp.writeFile(
    path.join(EVIDENCE, 'network.log'),
    `${requestFailures.map((event) => `[failed] ${event.url} :: ${event.error}`).join('\n')}\n`,
    'utf8',
  ).catch(() => undefined);
  await writeResult().catch(() => undefined);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
} finally {
  await cleanup();
}