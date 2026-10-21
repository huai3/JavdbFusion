const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = 'C:\\Users\\huai\\AppData\\Local\\Temp\\opencode\\javdbfusion';
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

const PAGES = [
  ['home', 'https://javdb.com/'],
  ['detail', 'https://javdb.com/v/021OE'],
  ['search', 'https://javdb.com/search?q=IPZZ'],
  ['actors', 'https://javdb.com/actors/AE'],
  ['ranking', 'https://javdb.com/rankings/movies'],
  ['favorites', 'https://javdb.com/users/lists'],
];

(async () => {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, locale: 'zh-CN',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' });
  await c.exposeBinding('__gmXhr', async (s, o) => { try { const r = await fetch(o.url, { headers: o.headers || {} }); return { status: r.status, text: await r.text(), url: r.url }; } catch (e) { throw e; } });
  await c.addInitScript(shim());
  await c.addInitScript(fs.readFileSync(path.join(ROOT, 'repo', 'JavdbFusion.user.js'), 'utf8'));
  const p = await c.newPage();
  const rows = [];
  for (const [name, url] of PAGES) {
    const errs = [];
    const onErr = e => errs.push(String(e.message).slice(0, 140));
    p.on('pageerror', onErr);
    let ok = false;
    for (let a = 0; a < 3 && !ok; a++) { try { await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 40000 }); ok = true; } catch (e) { await p.waitForTimeout(3000); } }
    if (!ok) { rows.push({ name, url, err: 'goto failed' }); p.off('pageerror', onErr); continue; }
    await p.waitForTimeout(5000);
    await p.evaluate(() => { const x = [...document.querySelectorAll('a,button')].find(e => /是,\s*我已滿18歲/.test((e.textContent || '').replace(/\s+/g, ''))); if (x) x.click(); });
    await p.waitForTimeout(4000);
    const st = await p.evaluate(() => ({
      skin: document.documentElement.classList.contains('emby-skin'),
      topbar: !!document.getElementById('emby-topbar'),
      cssKB: Math.round([...document.querySelectorAll('style')].reduce((a, s) => a + (s.textContent.length || 0), 0) / 1024),
      items: document.querySelectorAll('.item').length,
      homeTabs: document.querySelectorAll('.emby-home-tabs').length,
      overflowX: document.documentElement.scrollWidth > innerWidth + 2 ? 'HORIZONTAL OVERFLOW ' + document.documentElement.scrollWidth : 'ok',
      bodyBg: getComputedStyle(document.body).backgroundColor,
    }));
    await p.screenshot({ path: path.join(ROOT, 'shots', `smoke-${name}.png`) });
    rows.push({ name, url, ...st, errors: errs });
    p.off('pageerror', onErr);
  }
  console.log(JSON.stringify(rows, null, 1));
  await b.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
