const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = 'C:\\Users\\huai\\AppData\\Local\\Temp\\opencode\\javdbfusion';
const SCRIPT_PATH = path.join(ROOT, 'JavdbFusion.user.js');
const shim = () => `window.__gmStore={};
window.GM_getValue=function(k,d){return (k in window.__gmStore)?window.__gmStore[k]:d;};
window.GM_setValue=function(k,v){window.__gmStore[k]=v;};
window.GM_deleteValue=function(k){delete window.__gmStore[k];};
window.GM_listValues=function(){return Object.keys(window.__gmStore);};
window.GM_setClipboard=function(){};window.GM_registerMenuCommand=function(){};window.GM_notification=function(){};
window.GM_getResourceText=function(){return '';};window.unsafeWindow=window;
window.GM_addStyle=function(c){var s=document.createElement('style');s.textContent=c;(document.head||document.documentElement).appendChild(s);};
window.GM_openInTab=function(u){window.open(u,'_blank');};
window.GM_xmlhttpRequest=function(o){if(o&&o.onerror)setTimeout(function(){o.onerror({status:0});},0);return{abort:function(){}};};`;

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, locale: 'zh-CN',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' });
  await ctx.exposeBinding('__gmXhr', async (src, o) => { try { const r = await fetch(o.url, { headers: o.headers || {} }); return { status: r.status, text: await r.text(), url: r.url }; } catch (e) { throw e; } });
  await ctx.addInitScript(shim());
  await ctx.addInitScript(fs.readFileSync(SCRIPT_PATH, 'utf8'));
  const page = await ctx.newPage();
  await page.goto('https://javdb.com/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(6000);
  await page.evaluate(() => { const b = [...document.querySelectorAll('a,button')].find(x => /是,\s*我已滿18歲/.test((x.textContent || '').replace(/\s+/g, ''))); if (b) b.click(); });
  await page.waitForTimeout(5000);

  const r = await page.evaluate(() => {
    const R = el => { if (!el) return null; const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return { tag: el.tagName, cls: (typeof el.className === 'string' ? el.className : '').slice(0, 50), x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), disp: cs.display, pos: cs.position, mt: cs.marginTop, mb: cs.marginBottom, pt: cs.paddingTop, pb: cs.paddingBottom, bg: cs.backgroundColor, vis: cs.visibility, op: cs.opacity, fs: cs.fontSize }; };
    const kids = [];
    const main = document.querySelector('main') || document.body;
    // walk the main content column, top-down
    const walk = (el, depth) => {
      if (depth > 4) return;
      for (const c of el.children) {
        const b = c.getBoundingClientRect();
        if (b.height === 0) continue;
        if (b.y < 900) kids.push({ d: depth, ...R(c) });
        if (c.querySelector('main,.container,.movie-list')) walk(c, depth + 1);
      }
    };
    walk(main, 0);
    const cs = getComputedStyle(document.documentElement);
    const vars = {};
    for (const n of ['--e-text', '--e-text2', '--e-text3', '--e-accent', '--e-bg', '--e-card']) vars[n] = cs.getPropertyValue(n).trim();
    const item = document.querySelector('.movie-list > .item');
    const box = item && item.querySelector('.box');
    const tags = item && item.querySelector('.tags');
    const title = item && item.querySelector('.video-title');
    const score = item && item.querySelector('.score');
    const meta = item && item.querySelector('.meta');
    return {
      vars,
      headerStack: kids.slice(0, 26),
      nativeNavbar: R(document.querySelector('.navbar')),
      container: R(document.querySelector('.container')),
      main: R(document.querySelector('main')),
      movieList: R(document.querySelector('.movie-list')),
      toggle: R(document.getElementById('javdb-emby-toggle')),
      backtop: R(document.getElementById('emby-backtop')),
      card: { item: R(item), box: R(box), tags: R(tags), title: R(title), score: R(score), meta: R(meta),
        boxCS: box ? (() => { const c = getComputedStyle(box); return { pad: c.padding, minH: c.minHeight, h: c.height, align: c.alignItems, justify: c.justifyContent, display: c.display, flexDir: c.flexDirection }; })() : null,
        tagsCS: tags ? (() => { const c = getComputedStyle(tags); return { minH: c.minHeight, h: c.height, display: c.display }; })() : null,
        titleCS: title ? (() => { const c = getComputedStyle(title); return { fs: c.fontSize, lh: c.lineHeight, color: c.color, clamp: c.webkitLineClamp, overflow: c.overflow, h: c.height, ws: c.whiteSpace }; })() : null,
      },
    };
  });
  console.log(JSON.stringify(r, null, 1).slice(0, 6000));
  await browser.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
