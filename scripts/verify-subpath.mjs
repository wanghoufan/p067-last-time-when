#!/usr/bin/env node
/**
 * verify-subpath.mjs — GitHub Pages 项目子路径 PWA 适配的本地可复现验收。
 *
 * 做法：把 dist/ 只读复制到系统临时目录下的 <tmp>/p067-last-time-when/，
 * 用本地静态服务模拟 https://<user>.github.io/p067-last-time-when/ 的子路径环境，
 * 逐项自检资源路径、manifest scope、Service Worker 预缓存清单与 404 行为。
 *
 * 只读：不修改 dist/、不修改 src/、不执行构建。
 * 零第三方依赖：仅 node: 标准库 + 内置 fetch（Node 18+，脚本按 Node 22 写）。
 *
 * 用法：
 *   node scripts/verify-subpath.mjs            # 随机端口
 *   SUBPATH_PORT=4173 node scripts/verify-subpath.mjs
 */
import { createServer } from 'node:http';
import { cp, mkdtemp, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const REPO_SEGMENT = 'p067-last-time-when';
const BASE_PATH = `/${REPO_SEGMENT}/`;
const HOST = '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

const results = [];

function record(ok, label, detail) {
  results.push({ ok, label, detail });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${label} ${detail}\n`);
}

function summarize() {
  const failed = results.filter((r) => !r.ok);
  process.stdout.write(`SUBPATH-RESULT: ${failed.length === 0 ? 'PASS' : 'FAIL'}\n`);
  return failed.length === 0 ? 0 : 1;
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

function contentTypeFor(file) {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

function createStaticServer(root) {
  return createServer(async (req, res) => {
    const finish = (status, headers, body) => {
      res.writeHead(status, headers);
      if (body !== undefined) res.end(body);
      else res.end();
    };
    const notFound = () =>
      finish(404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not Found\n');

    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? HOST}`);
      let pathname;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return notFound();
      }

      // 模拟 GitHub Pages：不带结尾斜杠的项目根先 301 到带斜杠版本。
      if (pathname === BASE_PATH.slice(0, -1)) {
        return finish(301, { Location: BASE_PATH + url.search }, undefined);
      }
      if (!pathname.startsWith(BASE_PATH)) return notFound();

      let rel = pathname.slice(BASE_PATH.length);
      if (rel === '' || rel.endsWith('/')) rel += 'index.html';

      const file = path.resolve(root, rel);
      // 目录穿越保护
      if (file !== root && !file.startsWith(root + path.sep)) return notFound();

      let info;
      try {
        info = await stat(file);
      } catch {
        return notFound();
      }
      if (info.isDirectory()) return notFound();
      if (!info.isFile()) return notFound();

      res.writeHead(200, {
        'Content-Type': contentTypeFor(file),
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
      });
      if (req.method === 'HEAD') return res.end();
      createReadStream(file).pipe(res);
    } catch {
      notFound();
    }
  });
}

async function get(url) {
  const res = await fetch(url, { redirect: 'follow' });
  const body = await res.text();
  return { res, body, url: res.url, status: res.status, type: res.headers.get('content-type') ?? '' };
}

function insideBase(target) {
  return new URL(target).pathname.startsWith(BASE_PATH);
}

async function main() {
  process.stdout.write(`[verify-subpath] dist: ${DIST}\n`);
  if (!(await exists(DIST)) || !(await exists(path.join(DIST, 'index.html')))) {
    record(false, 'dist', 'dist/ 或 dist/index.html 不存在，请先构建；脚本不会自行构建');
    return summarize();
  }

  const rawPort = process.env.SUBPATH_PORT;
  const port = rawPort === undefined || rawPort === '' ? 0 : Number(rawPort);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    record(false, 'port', `SUBPATH_PORT 非法：${rawPort}`);
    return summarize();
  }

  const tmpRoot = await mkdtemp(path.join(os.tmpdir(), 'p067-subpath-'));
  const servedRoot = path.join(tmpRoot, REPO_SEGMENT);
  await cp(DIST, servedRoot, { recursive: true });
  process.stdout.write(`[verify-subpath] 副本: ${servedRoot}\n`);

  const server = createStaticServer(servedRoot);
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, HOST, resolve);
    });
  } catch (error) {
    await rm(tmpRoot, { recursive: true, force: true });
    record(
      false,
      'listen',
      `端口 ${port} 监听失败：${error && error.code ? error.code : String(error)}；可用 SUBPATH_PORT 指定空闲端口`,
    );
    return summarize();
  }
  const actualPort = server.address().port;
  const BASE_URL = `http://${HOST}:${actualPort}${BASE_PATH}`;
  process.stdout.write(`[verify-subpath] 服务: ${BASE_URL}\n\n`);

  try {
    // ① 子路径首页
    {
      const page = await get(BASE_URL);
      const isHtml = page.type.includes('text/html');
      const looksHtml = /<!doctype html/i.test(page.body) && page.body.includes('id="app"');
      const stayedInBase = insideBase(page.url);
      record(
        page.status === 200 && isHtml && looksHtml && stayedInBase,
        '① 子路径首页',
        `status=${page.status} type=${page.type.split(';')[0]} html=${looksHtml} url=${page.url}`,
      );
    }

    const index = await get(BASE_URL);

    // ② index.html 引用的 ./assets/*.js|css
    {
      const refs = [...index.body.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1]);
      const absolute = refs.filter((r) => r.startsWith('/'));
      const relative = refs.filter((r) => !r.startsWith('/'));
      if (refs.length === 0) {
        record(false, '② 资源引用', 'index.html 中未找到任何 .js/.css 引用');
      } else {
        const details = [];
        let ok = absolute.length === 0;
        if (absolute.length > 0) details.push(`根绝对路径(子路径下会 404): ${absolute.join(',')}`);
        for (const ref of relative) {
          const target = new URL(ref, BASE_URL).href;
          const asset = await get(target);
          const pathOk = insideBase(target);
          const typeOk =
            ref.endsWith('.css') ? asset.type.includes('text/css') : /javascript/.test(asset.type);
          if (asset.status !== 200 || !pathOk || !typeOk) ok = false;
          details.push(`${ref}→${new URL(target).pathname} status=${asset.status} type=${asset.type.split(';')[0]}${pathOk ? '' : ' [越出子路径]'}${typeOk ? '' : ' [MIME 不符]'}`);
        }
        record(ok, '② 资源引用', details.join(' | '));
      }
    }

    // ③ manifest
    {
      const manifestUrl = new URL('./manifest.webmanifest', BASE_URL).href;
      const manifest = await get(manifestUrl);
      let ok = manifest.status === 200 && manifest.type.includes('json');
      const details = [`status=${manifest.status}`, `type=${manifest.type.split(';')[0]}`];
      let parsed = null;
      try {
        parsed = JSON.parse(manifest.body);
      } catch (error) {
        ok = false;
        details.push(`JSON 解析失败: ${error.message}`);
      }
      if (parsed) {
        for (const key of ['start_url', 'scope']) {
          const value = parsed[key];
          if (typeof value !== 'string') {
            ok = false;
            details.push(`${key} 缺失或非字符串`);
            continue;
          }
          const resolved = new URL(value, manifestUrl);
          const pathOk = resolved.pathname.startsWith(BASE_PATH);
          if (!pathOk || resolved.origin !== `http://${HOST}:${actualPort}`) ok = false;
          details.push(`${key}="${value}"→${resolved.pathname}${pathOk ? '' : ' [越出子路径]'}`);
        }
        const icons = Array.isArray(parsed.icons) ? parsed.icons : [];
        if (icons.length === 0) {
          ok = false;
          details.push('icons 为空');
        }
        const badIcons = [];
        for (const icon of icons) {
          if (!icon || typeof icon.src !== 'string') {
            badIcons.push('(无 src)');
            continue;
          }
          const iconRes = await get(new URL(icon.src, manifestUrl).href);
          if (iconRes.status !== 200 || !iconRes.type.includes('image/png')) {
            badIcons.push(`${icon.src}(status=${iconRes.status})`);
          }
        }
        if (badIcons.length > 0) ok = false;
        details.push(`icons=${icons.length}${badIcons.length ? ` 失效: ${badIcons.join(',')}` : ' 全部 200'}`);
      }
      record(ok, '③ manifest', details.join(' | '));
    }

    // ④ sw.js：注入的 PRECACHE + SW_VERSION
    const swUrl = new URL('./sw.js', BASE_URL).href;
    const sw = await get(swUrl);
    let precache = [];
    {
      const details = [`status=${sw.status}`, `type=${sw.type.split(';')[0]}`];
      let ok = sw.status === 200;
      const match = sw.body.match(/const\s+PRECACHE\s*=\s*(\[[\s\S]*?\]);/);
      if (!match) {
        ok = false;
        details.push('未找到 PRECACHE 数组');
      } else {
        try {
          precache = JSON.parse(match[1]);
        } catch (error) {
          ok = false;
          details.push(`PRECACHE 解析失败: ${error.message}`);
        }
      }
      const versionMatch = sw.body.match(/const\s+SW_VERSION\s*=\s*['"]([^'"]+)['"]/);
      const version = versionMatch ? versionMatch[1] : '';
      if (!version) {
        ok = false;
        details.push('未找到 SW_VERSION');
      } else if (version === 'whenlast-v1') {
        ok = false;
        details.push(`SW_VERSION 仍是模板占位值 ${version}`);
      } else {
        details.push(`SW_VERSION=${version}`);
      }
      if (precache.length === 0) ok = false;
      details.push(`PRECACHE=${precache.length} 项`);
      details.push(sw.body.includes('__PRECACHE__') ? '残留占位标记' : '占位标记已替换');
      if (sw.body.includes('__PRECACHE__')) ok = false;
      record(ok, '④ sw.js 注入', details.join(' | '));
    }

    // ⑤ PRECACHE 每一项按子路径可达
    {
      if (precache.length === 0) {
        record(false, '⑤ PRECACHE 可达性', 'PRECACHE 为空，跳过');
      } else {
        const bad = [];
        const escaped = [];
        for (const entry of precache) {
          const target = new URL(entry, swUrl);
          if (!target.pathname.startsWith(BASE_PATH)) {
            escaped.push(`${entry}→${target.pathname}`);
            continue;
          }
          const item = await get(target.href);
          if (item.status !== 200) bad.push(`${entry}(status=${item.status})`);
        }
        const ok = bad.length === 0 && escaped.length === 0;
        const detail = [`共 ${precache.length} 项`];
        if (escaped.length) detail.push(`越出子路径: ${escaped.join(',')}`);
        if (bad.length) detail.push(`不可达: ${bad.join(',')}`);
        if (ok) detail.push('全部 200 且在子路径内');
        record(ok, '⑤ PRECACHE 可达性', detail.join(' | '));
      }
    }

    // ⑦ index.html 必须真的引用 manifest 与 apple-touch-icon（否则浏览器不当可安装应用）
    {
      const details = [];
      let ok = true;
      const manifestLink = /<link[^>]+rel=["']manifest["'][^>]*>/i.exec(index.body);
      if (!manifestLink) {
        ok = false;
        details.push('index.html 缺少 <link rel="manifest">');
      } else {
        const href = /href=["']([^"']+)["']/i.exec(manifestLink[0]);
        const value = href ? href[1] : '';
        if (!value) {
          ok = false;
          details.push('manifest 链接缺少 href');
        } else if (/^(?:https?:|\/)/i.test(value)) {
          ok = false;
          details.push(`manifest 链接不是相对路径（子路径会 404）：${value}`);
        } else {
          const resolved = new URL(value, BASE_URL).href;
          const res = await get(resolved);
          if (!insideBase(resolved)) ok = false;
          if (res.status !== 200) ok = false;
          details.push(`manifest=${value}→${new URL(resolved).pathname} status=${res.status}`);
        }
      }
      const touchLink = /<link[^>]+rel=["']apple-touch-icon["'][^>]*>/i.exec(index.body);
      if (!touchLink) {
        ok = false;
        details.push('缺少 apple-touch-icon');
      } else {
        const href = /href=["']([^"']+)["']/i.exec(touchLink[0]);
        const value = href ? href[1] : '';
        if (!value || /^(?:https?:|\/)/i.test(value)) {
          ok = false;
          details.push(`apple-touch-icon 不是相对路径：${value || '(无 href)'}`);
        } else {
          const res = await get(new URL(value, BASE_URL).href);
          if (res.status !== 200) ok = false;
          details.push(`apple-touch-icon=${value} status=${res.status}`);
        }
      }
      record(ok, '⑦ index 链接 manifest', details.join(' | '));
    }

    // ⑥ 未知路径必须 404，不能回落到 index.html
    {
      const missUrl = new URL('nope', BASE_URL).href;
      const miss = await get(missUrl);
      const fellBack = /<!doctype html/i.test(miss.body) && miss.body.includes('id="app"');
      record(
        miss.status === 404 && !fellBack,
        '⑥ 未知路径',
        `${new URL(missUrl).pathname} status=${miss.status} 回落index=${fellBack}`,
      );
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(tmpRoot, { recursive: true, force: true });
    process.stdout.write(`\n[verify-subpath] 已关闭服务并清理临时目录 ${tmpRoot}\n`);
  }

  return summarize();
}

process.exitCode = await main().catch((error) => {
  record(false, 'unexpected', error && error.stack ? error.stack.split('\n')[0] : String(error));
  return summarize();
});
