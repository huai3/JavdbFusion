#!/usr/bin/env node
/**
 * JavdbFusion 动态自检（Playwright + GM shim）
 *
 * 覆盖用户反馈的四个点：
 *   1. 详情页页签：概览 / 磁力 / 短评 / 相关清单 / 磁力聚合 是否各有内容、地址栏不跳锚点
 *   2. 预告片：多线路是否平铺、打开时是否默认暂停、关闭后重开是否命中缓存
 *   3. 磁力聚合：是否懒加载、首条结果耗时、每源状态、⟳ 刷新是否报错
 *   4. 可读性：关键文字的实测字号/行高/对比度
 *
 * 用法：
 *   node tools/pw/live-check.js https://javdb.com/v/xJqp6
 *   CHROME_PATH=/path/to/chrome node tools/pw/live-check.js ...
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { launchOptions } = require('./browser');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'JavdbFusion.user.js'), 'utf8');
const SHIM = fs.readFileSync(path.join(__dirname, 'gm-shim-live.js'), 'utf8');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const ARGS = process.argv.slice(2);
const AUTH_ARG = ARGS.find((a) => a.startsWith('--auth='));
const AUTH = AUTH_ARG ? path.resolve(AUTH_ARG.slice('--auth='.length)) : (process.env.JF_AUTH ? path.resolve(process.env.JF_AUTH) : '');
const PUSH115 = ARGS.includes('--push115');
const TARGET = ARGS.find((a) => !a.startsWith('--')) || 'https://javdb.com/v/xJqp6';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function rgb(s) {
  const m = String(s || '').match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(',').map((x) => parseFloat(x));
  return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
}
function lum(c) {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}
// 把半透明背景逐层合成到不透明底色上，避免把 rgba(255,255,255,.06) 当成纯白算对比度
function solidBg(el) {
  const layers = [];
  let n = el;
  while (n && n.nodeType === 1) {
    const c = rgb(getComputedStyle(n).backgroundColor);
    if (c && c.a > 0.001) layers.push(c);
    if (c && c.a >= 0.999) break;
    n = n.parentElement;
  }
  let out = { r: 22, g: 24, b: 29 };
  for (let i = layers.length - 1; i >= 0; i--) {
    const c = layers[i];
    out = { r: c.r * c.a + out.r * (1 - c.a), g: c.g * c.a + out.g * (1 - c.a), b: c.b * c.a + out.b * (1 - c.a) };
  }
  return out;
}
function contrast(fg, bg) {
  if (!fg || fg.a < 0.05) return null;
  const l1 = lum(fg) + 0.05, l2 = lum(bg) + 0.05;
  return +(Math.max(l1, l2) / Math.min(l1, l2)).toFixed(2);
}

(async () => {
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 }, locale: 'zh-CN', userAgent: UA,
    storageState: AUTH || undefined
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 500)));
  page.on('console', (m) => { if (m.type() === 'error' && /JAVDB|Uncaught|TypeError|ReferenceError/.test(m.text())) errors.push('console: ' + m.text().slice(0, 300)); });

  const net = [];
  // 关键：用 Playwright 的 ctx.request 发 GM 请求 —— 它与浏览器上下文共享 Cookie。
  // 用户手动登录 JAVDB / 115 后，脚本里的 GM_xmlhttpRequest 才会真正带上登录态；
  // 旧实现走 Node fetch，天然拿不到浏览器 cookie，115 推送永远「登录失效」。
  const api = ctx.request;
  await ctx.exposeBinding('__gmFetch', async (source, req) => {
    const t0 = Date.now();
    const headers = Object.assign({}, req.headers || {});
    if (!headers['user-agent'] && !headers['User-Agent']) headers['user-agent'] = UA;
    const data = req.data != null ? req.data : undefined;
    try {
      const r = await api.fetch(req.url, {
        method: req.method || 'GET',
        headers,
        data,
        failOnStatusCode: false,
        timeout: 60000,
        maxRedirects: 20
      });
      const text = await r.text();
      const out = { status: r.status(), statusText: r.statusText(), text, url: r.url(), headers: r.headers() };
      net.push({ url: req.url, status: out.status, ms: Date.now() - t0, len: text.length });
      return out;
    } catch (e) {
      // 某些自定义头（Cookie/Referer/Origin）在 APIRequestContext 下可能被拒绝，降级再试一次
      try {
        const clean = Object.fromEntries(Object.entries(headers).filter(([k]) => !/^(cookie|referer|origin)$/i.test(k)));
        const r = await api.fetch(req.url, { method: req.method || 'GET', headers: clean, data, failOnStatusCode: false, timeout: 60000 });
        const text = await r.text();
        net.push({ url: req.url, status: r.status(), ms: Date.now() - t0, len: text.length });
        return { status: r.status(), statusText: r.statusText(), text, url: r.url(), headers: r.headers() };
      } catch (e2) {
        net.push({ url: req.url, status: 0, ms: Date.now() - t0, error: String(e2.message || e2) });
        throw e2;
      }
    }
  });

  await ctx.addInitScript('window.openAuthModal=function(){};'); // 未登录时不弹登录框，保证自动化稳定
  await ctx.addInitScript(SHIM);
  await ctx.addInitScript(SCRIPT);

  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(2500);
  await page.evaluate(() => {
    const x = [...document.querySelectorAll('a,button')].find((e) => /是,\s*我已滿18歲|是,\s*我已满18岁/.test((e.textContent || '').replace(/\s+/g, '')));
    if (x) x.click();
  }).catch(() => {});
  await sleep(4500);

  const out = { target: TARGET, initial: null, tabs: {}, magnet: {}, trailer: {}, readability: [], errors, netSummary: null };
  const authCookies = await ctx.cookies();
  const javdbLoggedIn = await page.evaluate(() => {
    // 未登录时导航里一定有 /login；登录后换成 profile/logout
    return !document.querySelector('a[href="/login"]') &&
      !!(document.querySelector('a[href="/logout"], a[href^="/users/profile"], a[href="/users/lists"]'));
  }).catch(() => false);
  out.auth = {
    storageState: AUTH || null,
    cookieCount: authCookies.length,
    javdb: javdbLoggedIn,
    pan115: authCookies.some((c) => /(^|\.)115\.com$/.test(c.domain) && c.name === 'UID' && c.value)
  };
  out.initial = await page.evaluate(() => {
    const bar = document.querySelector('.emby-dtabbar');
    return {
      scrollY: Math.round(scrollY), hash: location.hash, search: location.search,
      active: (document.querySelector('.emby-dtab.active') || {}).textContent,
      tabbar: bar ? { y: Math.round(bar.getBoundingClientRect().y), h: Math.round(bar.getBoundingClientRect().height) } : null
    };
  });
  await page.screenshot({ path: path.join(OUT, 'overview.png') });

  const dismissModals = () => page.evaluate(() => {
    document.querySelectorAll('.modal.is-active').forEach((m) => m.classList.remove('is-active'));
    document.querySelectorAll('.modal-background').forEach((m) => { m.style.display = 'none'; });
  }).catch(() => {});
  const clickTab = async (k, wait) => {
    await page.evaluate((kk) => { const a = document.querySelector('.emby-dtab[data-dtab="' + kk + '"]'); if (a) a.click(); }, k);
    await sleep(wait || 1500);
    await dismissModals();
    const st = await page.evaluate((kk) => {
      const pane = document.getElementById('emby-dtab-' + kk);
      const native = document.querySelector('.columns[data-controller="movie-tab"]');
      const r = native ? native.getBoundingClientRect() : null;
      return {
        key: kk,
        active: (document.querySelector('.emby-dtab.active') || {}).textContent,
        paneTextLen: pane ? (pane.innerText || '').trim().length : 0,
        paneText: pane ? (pane.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 100) : '',
        nativeInPane: !!(native && pane && pane.contains(native)),
        nativeVisible: !!(r && r.width > 0 && r.height > 0),
        scrollY: Math.round(scrollY), hash: location.hash, search: location.search
      };
    }, k);
    await page.screenshot({ path: path.join(OUT, 'tab-' + k + '.png') });
    return st;
  };

  for (const k of ['magnet', 'review', 'list', 'agg', 'overview']) {
    out.tabs[k] = await clickTab(k, (k === 'magnet' || k === 'agg') ? 6000 : 2000);
  }

  // ---- 短评增强：最新 / 最热 + ed2k→115 ----
  await page.evaluate(() => document.querySelector('.emby-dtab[data-dtab="review"]').click());
  await sleep(1200);
  await page.evaluate(() => document.querySelector('#emby-dtab-review [data-sort="hotly"]')?.click());
  for (let i = 0; i < 40; i++) {
    const n = await page.evaluate(() => document.querySelectorAll('#emby-dtab-review .jf-review-item, #emby-dtab-review .jf-review-error').length).catch(() => 0);
    if (n > 0) break;
    await sleep(250);
  }
  out.reviewSort = await page.evaluate(() => ({
    toolbar: !!document.querySelector('#emby-dtab-review .jf-review-sec'),
    items: document.querySelectorAll('#emby-dtab-review .jf-review-item').length,
    first: (document.querySelector('#emby-dtab-review .jf-review-item') || {}).innerText?.replace(/\s+/g, ' ').slice(0, 100) || '',
    ed2kButtons: document.querySelectorAll('#emby-dtab-review .jf-review-115').length,
    errorText: (document.querySelector('#emby-dtab-review .jf-review-error') || {}).innerText || '',
    activeSort: document.querySelector('#emby-dtab-review [data-sort].active')?.dataset.sort || null,
    nativeHidden: (() => { const n = document.querySelector('[data-movie-tab-target="reviews"]'); return n ? getComputedStyle(n).display === 'none' : null; })(),
    nativeItems: document.querySelectorAll('[data-movie-tab-target="reviews"] .review-item').length
  }));
  await page.screenshot({ path: path.join(OUT, 'review-sort.png') });
  // 115 推送会真的创建离线任务，默认不点，只有显式 --push115 才执行
  if (PUSH115 && out.reviewSort.ed2kButtons) {
    await page.evaluate(() => document.querySelector('#emby-dtab-review .jf-review-115').click());
    const seen = [];
    for (let i = 0; i < 30; i++) {
      await sleep(200);
      const t = await page.evaluate(() => [...document.querySelectorAll('.jf-mag-toast, #emby-toast')].map((e) => e.textContent));
      t.forEach((x) => { if (x && !seen.includes(x)) seen.push(x); });
    }
    out.reviewSort.pushToasts = seen;
    out.reviewSort.pushToast = seen[seen.length - 1] || '';
  }

  // ---- 磁力聚合：首条结果耗时 / 每源状态 / 刷新 ----
  await page.evaluate(() => document.querySelector('.emby-dtab[data-dtab="agg"]').click());
  const t0 = Date.now();
  let firstRowMs = null;
  for (let i = 0; i < 200; i++) {
    if (await page.evaluate(() => document.querySelectorAll('#jfMagList .jf-magrow').length > 0)) { firstRowMs = Date.now() - t0; break; }
    await sleep(100);
  }
  let settledMs = null;
  for (let i = 0; i < 200; i++) {
    if (await page.evaluate(() => document.querySelectorAll('.jf-magsrc-chip.pending').length === 0)) { settledMs = Date.now() - t0; break; }
    await sleep(100);
  }
  out.magnet = await page.evaluate(() => ({
    rows: document.querySelectorAll('#jfMagList .jf-magrow').length,
    sourceChips: [...document.querySelectorAll('.jf-magsrc-chip')].map((e) => e.textContent.trim()),
    panelParent: document.getElementById('jf-magnet-panel')?.parentElement?.id || null
  }));
  out.magnet.firstRowMs = firstRowMs;
  out.magnet.allSourcesSettledMs = settledMs;
  const beforeRefresh = errors.length;
  await page.evaluate(() => document.getElementById('jfMagRefresh').click());
  await sleep(800);
  out.magnet.refresh = await page.evaluate(() => ({ disabled: document.getElementById('jfMagRefresh').disabled, busy: document.getElementById('jfMagList').getAttribute('aria-busy') }));
  out.magnet.refreshErrors = errors.slice(beforeRefresh);
  await page.screenshot({ path: path.join(OUT, 'agg.png') });
  await sleep(5000);

  // ---- 预告片：多线路 + 默认暂停 + 关闭重开 ----
  await page.evaluate(() => document.querySelector('.emby-dtab[data-dtab="overview"]').click());
  await sleep(600);
  await dismissModals();
  out.trailer.hasButton = await page.evaluate(() => !!document.querySelector('.jf-poster-play'));
  if (out.trailer.hasButton) {
    await page.click('.jf-poster-play');
    await sleep(9000);
    out.trailer.open = await page.evaluate(() => {
      const v = document.getElementById('jfTrailerVideo');
      return {
        overlay: !!document.querySelector('.jf-trailer-overlay'),
        routes: [...document.querySelectorAll('.jf-route')].map((b) => b.innerText.replace(/\s+/g, ' ').trim()),
        activeRoute: (document.querySelector('.jf-route.is-active') || {}).innerText,
        src: v ? (v.currentSrc || v.src) : null,
        paused: v ? v.paused : null,
        readyState: v ? v.readyState : null,
        playButtonVisible: document.getElementById('jfTrailerPlayBtn') ? !document.getElementById('jfTrailerPlayBtn').hidden : null,
        autoplayChecked: document.getElementById('jfTrailerAuto') ? document.getElementById('jfTrailerAuto').checked : null
      };
    });
    await page.screenshot({ path: path.join(OUT, 'trailer.png') });
    await page.evaluate(() => document.getElementById('jfTrailerClose').click());
    await sleep(400);
    const r0 = Date.now();
    await page.click('.jf-poster-play');
    await sleep(900);
    out.trailer.reopen = await page.evaluate(() => ({
      routes: document.querySelectorAll('.jf-route').length,
      src: !!document.getElementById('jfTrailerVideo')?.src,
      paused: document.getElementById('jfTrailerVideo')?.paused
    }));
    out.trailer.reopenMs = Date.now() - r0;
    await page.screenshot({ path: path.join(OUT, 'trailer-reopen.png') });
  }

  // ---- 可读性：真实计算字号 / 行高 / 对比度（半透明背景逐层合成） ----
  out.readability = await page.evaluate(() => {
    const sels = ['.emby-dtab', '.emby-anchor a', '.jf-magrow-title', '.jf-magrow-meta', '.jf-magchip',
      '.review-items .content p', '.review-items .review-title', '.emby-detail-hero .info h1',
      '.emby-dpane-native .message-body'];
    const parse = (s) => { const m = String(s || '').match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
    const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const bgOf = (el) => {
      const layers = []; let n = el;
      while (n && n.nodeType === 1) {
        const c = parse(getComputedStyle(n).backgroundColor);
        if (c && c.a > 0.001) { layers.push(c); if (c.a >= 0.999) break; }
        n = n.parentElement;
      }
      let out = { r: 22, g: 24, b: 29 };
      for (let i = layers.length - 1; i >= 0; i--) {
        const c = layers[i];
        out = { r: c.r * c.a + out.r * (1 - c.a), g: c.g * c.a + out.g * (1 - c.a), b: c.b * c.a + out.b * (1 - c.a) };
      }
      return out;
    };
    const res = [];
    for (const sel of sels) {
      const el = document.querySelector(sel);
      if (!el) { res.push({ sel, missing: true }); continue; }
      const cs = getComputedStyle(el);
      const fg = parse(cs.color), bg = bgOf(el);
      let ratio = null;
      if (fg) { const l1 = lum(fg) + 0.05, l2 = lum(bg) + 0.05; ratio = +(Math.max(l1, l2) / Math.min(l1, l2)).toFixed(2); }
      res.push({ sel, font: cs.fontSize, line: cs.lineHeight, color: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`, ratio, text: (el.textContent || '').trim().slice(0, 30) });
    }
    return res;
  });

  out.netSummary = {
    total: net.length,
    failed: net.filter((n) => n.status === 0 || n.status >= 400).length,
    dupUrls: Object.entries(net.reduce((m, n) => { const k = n.url; m[k] = (m[k] || 0) + 1; return m; }, {})).filter(([, c]) => c > 1).map(([u, c]) => ({ url: u, count: c })).slice(0, 10)
  };

  fs.writeFileSync(path.join(OUT, 'live-check.json'), JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
  if (errors.length) process.exitCode = 2;
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
