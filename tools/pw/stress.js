#!/usr/bin/env node
/**
 * JavdbFusion 压力 / 性能 / 稳定性测试
 *
 * 用法：
 *   node tools/pw/stress.js
 *   node tools/pw/stress.js --auth=tools/pw/auth/storage.json
 *
 * 覆盖：多页面加载、详情页页签反复切换、预告片反复开关、磁力源切换、
 *       LTX 筛选反复开关、长任务/内存/DOM 节点/请求数/JS 报错。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { launchOptions } = require('./browser');

const ROOT = path.resolve(__dirname, '..', '..');
const ARGS = process.argv.slice(2);
const SCRIPT_ARG = ARGS.find((a) => a.startsWith('--script='));
const SCRIPT_PATH = SCRIPT_ARG ? path.resolve(SCRIPT_ARG.slice('--script='.length)) : path.join(ROOT, 'JavdbFusion.user.js');
const SCRIPT = fs.readFileSync(SCRIPT_PATH, 'utf8');
const SHIM = fs.readFileSync(path.join(__dirname, 'gm-shim-live.js'), 'utf8');
const AUTH_ARG = ARGS.find((a) => a.startsWith('--auth='));
const AUTH = AUTH_ARG ? path.resolve(AUTH_ARG.slice('--auth='.length)) : (process.env.JF_AUTH ? path.resolve(process.env.JF_AUTH) : '');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PAGES = [
  ['home', 'https://javdb.com/'],
  ['search', 'https://javdb.com/search?q=SSIS-457&f=all'],
  ['actor', 'https://javdb.com/actors/RdEb4'],
  ['ranking', 'https://javdb.com/rankings/movies'],
  ['top250', 'https://javdb.com/rankings/top'],
  ['detail', 'https://javdb.com/v/xJqp6']
];

const PERF_SCRIPT = `
window.__jfPerf = { long: [], nav: null };
try {
  new PerformanceObserver((list) => {
    list.getEntries().forEach((e) => window.__jfPerf.long.push({ start: Math.round(e.startTime), dur: Math.round(e.duration) }));
  }).observe({ type: 'longtask', buffered: true });
} catch (e) {}
window.addEventListener('load', () => {
  try {
    const n = performance.getEntriesByType('navigation')[0];
    window.__jfPerf.nav = n ? { dcl: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd), transfer: n.transferSize } : null;
  } catch (e) {}
});
`;

(async () => {
  const browser = await chromium.launch(launchOptions());
  const rows = [];
  for (const [name, url] of PAGES) {
    const ctx = await browser.newContext({
      viewport: { width: 1440, height: 900 }, locale: 'zh-CN', userAgent: UA,
      storageState: AUTH || undefined
    });
    const page = await ctx.newPage();
    const errors = [];
    const requests = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 220)));
    page.on('console', (m) => { if (m.type() === 'error' && /JAVDB|Uncaught|TypeError|ReferenceError/.test(m.text())) errors.push('console: ' + m.text().slice(0, 180)); });
    const api = ctx.request;
    await ctx.exposeBinding('__gmFetch', async (source, req) => {
      requests.push(req.url);
      const res = await api.fetch(req.url, { method: req.method || 'GET', headers: req.headers || {}, data: req.data != null ? req.data : undefined, failOnStatusCode: false, timeout: 60000 });
      const text = await res.text();
      return { status: res.status(), statusText: res.statusText(), text, url: res.url(), headers: res.headers() };
    });
    await ctx.addInitScript(PERF_SCRIPT);
    await ctx.addInitScript(SHIM);
    await ctx.addInitScript(SCRIPT);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
    await sleep(6000);
    // 年龄门
    await page.evaluate(() => {
      const a = [...document.querySelectorAll('a,button')].find((e) => /是,\s*我已滿18歲|是,\s*我已满18岁/.test((e.textContent || '').replace(/\s+/g, '')));
      if (a) a.click();
    }).catch(() => {});
    await sleep(1000);

    const actions = [];
    if (name === 'detail') {
      for (let round = 0; round < 4; round++) {
        for (const key of ['magnet', 'review', 'list', 'agg', 'overview']) {
          await page.evaluate((k) => document.querySelector('.emby-dtab[data-dtab="' + k + '"]')?.click(), key);
          await sleep(350);
        }
        actions.push('tabs');
      }
      // review sort toggles
      await page.evaluate(() => document.querySelector('.emby-dtab[data-dtab="review"]')?.click());
      await sleep(1000);
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => document.querySelector('#emby-dtab-review [data-sort="hotly"]')?.click());
        await sleep(1200);
        await page.evaluate(() => document.querySelector('#emby-dtab-review [data-sort="recently"]')?.click());
        await sleep(1200);
      }
      actions.push('review-sort');
      // trailer open/close 5x (no play)
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => document.querySelector('.emby-dtab[data-dtab="overview"]')?.click());
        await sleep(300);
        await page.click('.jf-poster-play').catch(() => {});
        await sleep(1500);
        await page.evaluate(() => document.getElementById('jfTrailerClose')?.click()).catch(() => {});
        await sleep(350);
      }
      actions.push('trailer-open-close');
    } else {
      // scroll list 2 screens, then LTX toggle if index available
      await page.evaluate(() => window.scrollTo(0, 1600));
      await sleep(700);
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(300);
      for (let i = 0; i < 3; i++) {
        await page.evaluate(() => document.getElementById('jf-ltx-btn')?.click());
        await sleep(500);
      }
      actions.push('scroll+ltx');
    }

    const state = await page.evaluate(() => {
      const perf = window.__jfPerf || { long: [], nav: null };
      const longTotal = perf.long.reduce((a, b) => a + b.dur, 0);
      return {
        path: location.pathname,
        nav: perf.nav,
        longTasks: perf.long.length,
        longTotalMs: longTotal,
        longMaxMs: perf.long.reduce((a, b) => Math.max(a, b.dur), 0),
        nodes: document.getElementsByTagName('*').length,
        panes: document.querySelectorAll('.emby-dpane').length,
        overlays: document.querySelectorAll('.jf-trailer-overlay').length,
        magPanels: document.querySelectorAll('#jf-magnet-panel').length,
        ltxBadges: document.querySelectorAll('.jf-ltx-badge').length,
        overflowX: document.documentElement.scrollWidth > innerWidth + 2 ? document.documentElement.scrollWidth : null,
        heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null
      };
    });
    rows.push({ name, url, actions, ...state, requests: requests.length, dupRequests: requests.length - new Set(requests).size, errors });
    await ctx.close();
  }
  console.log(JSON.stringify(rows, null, 2));
  fs.writeFileSync(path.join(OUT, 'stress.json'), JSON.stringify(rows, null, 2));
  await browser.close();
  if (rows.some((r) => r.errors.length)) process.exitCode = 2;
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
