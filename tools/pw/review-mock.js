#!/usr/bin/env node
/**
 * 短评 / 相关清单 页签的确定性测试（不依赖登录）
 * - 拦截 /lists/related，返回 mock 清单
 * - 直接向原生 reviews 面板注入 16 条 mock 短评，验证搬进页签后的排版/字号/行高
 * - 检查：页签内容非空、原生组件确实在页签内、滚动后页签栏不被顶栏遮住
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { launchOptions } = require('./browser');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'JavdbFusion.user.js'), 'utf8');
const SHIM = fs.readFileSync(path.join(__dirname, 'gm-shim-live.js'), 'utf8');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36';
const TARGET = process.argv[2] || 'https://javdb.com/v/xJqp6';
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const REVIEW_ITEMS = Array.from({ length: 16 }, (_, i) => `
<dt class="review-item"><div class="review-title"><span>用户${i + 1}</span><span class="time">2024-01-01</span><span class="score-stars">★★★★☆</span></div>
<div class="content"><p>第 ${i + 1} 条短评：这是一段用于检验可读性的中文短评正文，包含标点、English words 与数字 12345。短评正文应该以 14.5px 字号、1.78 行高、足够对比度呈现。</p></div></dt>`).join('');
const REVIEWS = `<dl class="review-items movie-review-list">${REVIEW_ITEMS}</dl>`;
const LISTS = `<article class="message video-panel"><div class="message-body"><dl class="review-items movie-review-list">
<dt class="review-item list-item"><div class="review-title"><a href="/lists/1">测试清单一</a><span>2024-01-01</span></div>
<div class="content"><p>视频: 12 | 收藏: 3 | 查看: 99</p></div></dt></dl></div></article>`;

(async () => {
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'zh-CN', userAgent: UA });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.stack || e).slice(0, 400)));
  await page.route(/\/reviews\/lastest/, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: REVIEWS }));
  await page.route(/\/lists\/related/, (r) => r.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: LISTS }));
  await ctx.addInitScript('window.openAuthModal=function(){};');
  await ctx.exposeBinding('__gmFetch', async (s, req) => {
    const r = await fetch(req.url, { method: req.method || 'GET', headers: req.headers || {}, body: req.data ?? undefined });
    const text = await r.text();
    return { status: r.status, statusText: r.statusText, text, url: r.url };
  });
  await ctx.addInitScript(SHIM);
  await ctx.addInitScript(SCRIPT);
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await sleep(5000);

  await page.evaluate(() => window.scrollTo(0, 1500));
  await sleep(300);
  await page.evaluate(() => document.querySelector('.emby-dtab[data-dtab="review"]').click());
  await sleep(1500);
  // 登录态由服务端渲染评论；这里手动注入 mock 评论到原生面板
  await page.evaluate((html) => {
    const el = document.querySelector('[data-movie-tab-target="reviews"]');
    if (el) { el.innerHTML = html; el.style.display = 'block'; }
  }, REVIEWS);

  const review = await page.evaluate(() => {
    const pane = document.getElementById('emby-dtab-review');
    const p = pane.querySelector('.review-item .content p');
    const cs = p ? getComputedStyle(p) : null;
    return {
      scrollY: Math.round(scrollY),
      paneItems: pane.querySelectorAll('.review-item').length,
      nativeInPane: !!document.querySelector('.columns[data-controller="movie-tab"]')?.closest('.emby-dpane'),
      font: cs && cs.fontSize, line: cs && cs.lineHeight,
      tabbarBottom: Math.round(document.querySelector('.emby-dtabbar').getBoundingClientRect().bottom),
      paneTop: Math.round(pane.getBoundingClientRect().top)
    };
  });
  await page.screenshot({ path: path.join(OUT, 'review-mock.png') });

  await page.evaluate(() => document.querySelector('.emby-dtab[data-dtab="list"]').click());
  await sleep(1500);
  const list = await page.evaluate(() => ({
    items: document.querySelectorAll('#emby-dtab-list .review-item').length,
    text: (document.getElementById('emby-dtab-list').innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  }));
  await page.screenshot({ path: path.join(OUT, 'list-mock.png') });

  const out = { target: TARGET, review, list, errors };
  console.log(JSON.stringify(out, null, 1));
  fs.writeFileSync(path.join(OUT, 'review-mock.json'), JSON.stringify(out, null, 2));
  await browser.close();
  if (errors.length) process.exitCode = 2;
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
