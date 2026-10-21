const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = 'C:\\Users\\huai\\AppData\\Local\\Temp\\opencode\\javdbfusion';
const URL_ = process.argv[2] || 'https://javdb.com/';
const FILES = process.argv.slice(3);
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

async function run(file, label) {
  const b = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const c = await b.newContext({
    viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, locale: 'zh-CN',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  });
  await c.exposeBinding('__gmXhr', async (s, o) => { try { const r = await fetch(o.url, { headers: o.headers || {} }); return { status: r.status, text: await r.text(), url: r.url }; } catch (e) { throw e; } });
  await c.addInitScript(shim());
  if (file) await c.addInitScript(fs.readFileSync(file, 'utf8'));
  const p = await c.newPage();
  const cdp = await c.newCDPSession(p);
  await cdp.send('Performance.enable');
  let ok = false;
  for (let a = 0; a < 4 && !ok; a++) { try { await p.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 45000 }); ok = true; } catch (e) { await p.waitForTimeout(4000); } }
  if (!ok) { await b.close(); return { label, err: 'goto' }; }
  await p.waitForTimeout(4500);
  await p.evaluate(() => { const x = [...document.querySelectorAll('a,button')].find(e => /是,\s*我已滿18歲/.test((e.textContent || '').replace(/\s+/g, ''))); if (x) x.click(); });
  await p.waitForTimeout(4500);
  for (let i = 0; i < 8; i++) { await p.mouse.wheel(0, 500); await p.waitForTimeout(100); }
  await p.waitForTimeout(1200);
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(800);
  const { metrics } = await cdp.send('Performance.getMetrics');
  const M = Object.fromEntries(metrics.map(m => [m.name, m.value]));
  const dom = await p.evaluate(() => {
    const lum = c => { const m = c.match(/[\d.]+/g); if (!m) return 0; const [r, g, b] = m.map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const cr = (a, b) => { const L1 = lum(a), L2 = lum(b); const hi = Math.max(L1, L2), lo = Math.min(L1, L2); return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100; };
    const bgOf = el => { let n = el; while (n && n !== document.documentElement) { const c = getComputedStyle(n).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c)) return c; n = n.parentElement; } return 'rgb(22,24,29)'; };
    const probe = sel => { const el = document.querySelector(sel); if (!el) return null; const cs = getComputedStyle(el); return { color: cs.color, bg: bgOf(el), ratio: cr(cs.color, bgOf(el)), font: cs.fontSize }; };
    const tb = document.getElementById('emby-topbar');
    const ml = document.querySelector('.movie-list');
    const items = [...document.querySelectorAll('.movie-list > .item')];
    const tog = document.getElementById('javdb-emby-toggle');
    let overlap = 0;
    if (tog && tog.offsetParent) { const a = tog.getBoundingClientRect(); overlap = items.filter(i => { const b = i.getBoundingClientRect(); return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom); }).length; }
    return {
      skinOn: document.documentElement.classList.contains('emby-skin'),
      styleKB: Math.round([...document.querySelectorAll('style')].reduce((a, s) => a + (s.textContent.length || 0), 0) / 1024),
      domNodes: document.getElementsByTagName('*').length,
      headerGap: tb && ml ? Math.round(ml.getBoundingClientRect().top - tb.getBoundingClientRect().bottom) : null,
      homeTabsY: (() => { const h = document.querySelector('.emby-home-tabs'); const t = document.querySelector('.main-tabs-wrap'); if (!h || !t) return null; return { homeTabs: Math.round(h.getBoundingClientRect().top), nativeTabs: Math.round(t.getBoundingClientRect().top), homeTabsFirst: h.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING ? 'after' : 'before' }; })(),
      overlapCards: overlap,
      contrast: {
        title: probe('.item .video-title'), score: probe('.item .score'),
        meta: probe('.item .meta'), tag: probe('.item .tags .tag'),
      },
    };
  });
  await b.close();
  return {
    label, task: Math.round(M.TaskDuration * 1000), script: Math.round(M.ScriptDuration * 1000),
    layout: Math.round(M.LayoutDuration * 1000), recalc: Math.round(M.RecalcStyleDuration * 1000),
    recalcCount: M.RecalcStyleCount, layoutCount: M.LayoutCount, heapMB: Math.round(M.JSHeapUsedSize / 1048576),
    ...dom,
  };
}

(async () => {
  const res = [];
  for (const f of FILES) {
    const label = f ? path.basename(f) : 'native';
    const r = await run(f, label);
    res.push(r);
    console.log(label, JSON.stringify(r).slice(0, 260));
    await new Promise(r => setTimeout(r, 5000));
  }
  const keys = ['task', 'script', 'layout', 'recalc', 'recalcCount', 'layoutCount', 'heapMB', 'domNodes', 'styleKB', 'headerGap', 'overlapCards'];
  console.log('\nmetric'.padEnd(16) + res.map(r => String(r.label).slice(0, 16).padStart(18)).join(''));
  for (const k of keys) console.log(String(k).padEnd(16) + res.map(r => String(r[k] ?? '-').padStart(18)).join(''));
  console.log('\ncontrast:');
  for (const r of res) console.log('  ' + String(r.label).slice(0, 22).padEnd(24) + JSON.stringify(r.contrast));
  console.log('\nhomeTabs order:', JSON.stringify(res.map(r => r.homeTabsY)));
  fs.writeFileSync(path.join(ROOT, 'shots', 'compare.json'), JSON.stringify(res, null, 1));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
