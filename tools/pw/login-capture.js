#!/usr/bin/env node
/**
 * 打开一个真实（有界面）的 Chromium，让用户手动登录 JAVDB / 115，
 * 登录完成后把 cookie + localStorage 保存成 Playwright storageState。
 *
 * 用法：
 *   node tools/pw/login-capture.js
 *   node tools/pw/login-capture.js --out=tools/pw/auth/storage.json
 *
 * 保存后运行：
 *   node tools/pw/live-check.js --auth=tools/pw/auth/storage.json
 *
 * 注意：storage.json 里是登录 Cookie，等同账号凭据；不要提交、不要发给别人。
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');
const { launchOptions } = require('./browser');

const arg = (name, def) => {
  const hit = process.argv.find((a) => a === '--' + name || a.startsWith('--' + name + '='));
  if (!hit) return def;
  const eq = hit.indexOf('=');
  return eq >= 0 ? hit.slice(eq + 1) : true;
};
const OUT = path.resolve(arg('out', path.join(__dirname, 'auth', 'storage.json')));
const START_URL = String(arg('url', 'https://javdb.com/'));
const TIMEOUT = Number(arg('timeout', 900)) * 1000;
const PROFILE = path.join(__dirname, 'auth', 'profile');

const BANNER = `
<div id="jf-capture-banner" style="position:fixed;z-index:2147483647;left:50%;top:14px;transform:translateX(-50%);
  width:min(860px,calc(100vw - 24px));box-sizing:border-box;padding:14px 18px;border-radius:14px;
  background:rgba(16,20,28,.97);color:#e8edf6;border:1px solid rgba(120,180,255,.5);
  box-shadow:0 14px 44px rgba(0,0,0,.55);font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;">
  <div style="font-size:16px;font-weight:800;margin-bottom:4px;">JavdbFusion 登录态采集</div>
  <div style="opacity:.85;">1）登录 <b>${START_URL}</b> 对应站点；2）如果要测 115 推送，另开标签页登录 <b>115.com</b>；3）都登录好后点右侧按钮。</div>
  <div style="margin-top:8px;font-size:12px;opacity:.6;">登录态只保存在本机 <code style="color:#9ecbff;">${OUT.replace(/</g, '&lt;')}</code>，测试结束可删除。不要把该文件提交/发给别人。</div>
  <button id="jf-capture-save" style="position:absolute;right:14px;top:12px;border:none;border-radius:9px;padding:10px 16px;
    background:#00a4dc;color:#04121a;font-weight:800;font-size:14px;cursor:pointer;">已登录，保存</button>
</div>`;

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.mkdirSync(PROFILE, { recursive: true });
  const opts = launchOptions();
  const ctx = await chromium.launchPersistentContext(PROFILE, {
    headless: false,
    executablePath: opts.executablePath,
    args: ['--no-sandbox', '--start-maximized'],
    viewport: null,
    locale: 'zh-CN'
  });
  const pages = ctx.pages();
  const page = pages[0] || await ctx.newPage();

  const injectBanner = async (p) => {
    try { await p.evaluate((html) => {
      if (document.getElementById('jf-capture-banner')) return;
      const wrap = document.createElement('div');
      wrap.innerHTML = html;
      document.body.appendChild(wrap.firstElementChild);
      document.getElementById('jf-capture-save').addEventListener('click', () => { window.__JF_CAPTURE_SAVE__ = true; });
    }, BANNER); } catch (e) {}
  };
  const wire = (p) => {
    p.on('domcontentloaded', () => injectBanner(p).catch(() => {}));
    p.on('load', () => injectBanner(p).catch(() => {}));
  };
  ctx.pages().forEach(wire);

  await page.goto(START_URL, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await injectBanner(page);
  // 115 用独立标签页，方便用户分别登录
  const p115 = await ctx.newPage();
  wire(p115);
  await p115.goto('https://115.com/', { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
  await p115.bringToFront();
  await injectBanner(p115);
  await page.bringToFront();
  await injectBanner(page);

  console.log('=== 已打开登录窗口 ===');
  console.log('请在那个 Chromium 窗口里：');
  console.log('  1. 登录 ' + START_URL);
  console.log('  2. 如需测试 115 推送，切到 115 标签页登录 https://115.com');
  console.log('  3. 回到页面，点右上角「已登录，保存」按钮');
  console.log('等待中（最长 ' + Math.round(TIMEOUT / 1000) + ' 秒）…');

  const started = Date.now();
  let saved = false;
  while (Date.now() - started < TIMEOUT) {
    for (const p of ctx.pages()) {
      let done = false;
      try { done = await p.evaluate(() => !!window.__JF_CAPTURE_SAVE__); } catch (e) {}
      if (done) { saved = true; break; }
    }
    if (saved) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!saved) {
    console.error('TIMEOUT: 没有点保存按钮，未写入登录态。');
    await ctx.close().catch(() => {});
    process.exit(2);
  }

  await ctx.storageState({ path: OUT });
  const cookies = await ctx.cookies();
  const has115 = cookies.some((c) => /(^|\.)115\.com$/.test(c.domain) && c.name === 'UID' && c.value);
  // 115 登录判断用 UID；JAVDB 用页面登录链接是否消失（_jdb_session 未登录也有）
  const hasJavdb = await page.evaluate(() => !document.querySelector('a[href="/login"]') &&
    !!(document.querySelector('a[href="/logout"], a[href^="/users/profile"], a[href="/users/lists"]'))).catch(() => false);
  const meta = { savedAt: new Date().toISOString(), cookies: cookies.length, javdb: hasJavdb, pan115: has115 };
  fs.writeFileSync(OUT.replace(/\.json$/i, '') + '.meta.json', JSON.stringify(meta, null, 2));
  console.log('SAVED ' + OUT);
  console.log('cookie 数=' + cookies.length + ' javdb=' + hasJavdb + ' 115=' + has115);
  console.log('下一步: node tools/pw/live-check.js --auth=' + path.relative(process.cwd(), OUT));
  await ctx.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
