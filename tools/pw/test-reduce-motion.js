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

async function run(label, reduceMotion) {
  const b = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, locale: 'zh-CN',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' });
  await c.exposeBinding('__gmXhr', async (s, o) => { try { const r = await fetch(o.url, { headers: o.headers || {} }); return { status: r.status, text: await r.text(), url: r.url }; } catch (e) { throw e; } });
  await c.addInitScript(shim());
  // pre-seed the setting BEFORE the userscript runs
  await c.addInitScript(`try{ localStorage.setItem('javdbEmbyReduceMotion', ${reduceMotion ? "'1'" : "'0'"}); }catch(e){}`);
  await c.addInitScript(fs.readFileSync(path.join(ROOT, 'repo', 'JavdbFusion.user.js'), 'utf8'));
  const p = await c.newPage();
  const cdp = await c.newCDPSession(p);
  await cdp.send('Performance.enable');
  let ok = false;
  for (let a = 0; a < 4 && !ok; a++) { try { await p.goto('https://javdb.com/', { waitUntil: 'domcontentloaded', timeout: 45000 }); ok = true; } catch (e) { await p.waitForTimeout(4000); } }
  if (!ok) { await b.close(); return { label, err: 'goto' }; }
  await p.waitForTimeout(5000);
  await p.evaluate(() => { const x = [...document.querySelectorAll('a,button')].find(e => /是,\s*我已滿18歲/.test((e.textContent || '').replace(/\s+/g, ''))); if (x) x.click(); });
  await p.waitForTimeout(5000);
  for (let i = 0; i < 8; i++) { await p.mouse.wheel(0, 500); await p.waitForTimeout(100); }
  await p.waitForTimeout(1200);
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(800);
  const { metrics } = await cdp.send('Performance.getMetrics');
  const M = Object.fromEntries(metrics.map(m => [m.name, m.value]));
  const cls = await p.evaluate(() => ({
    reduce: document.documentElement.classList.contains('reduce-motion'),
    anims: document.getAnimations().length,
    qsSwitchExists: !!document.getElementById('qs-reduce-motion'),
  }));
  await b.close();
  return { label, ...cls, task: Math.round(M.TaskDuration * 1000), script: Math.round(M.ScriptDuration * 1000), layout: Math.round(M.LayoutDuration * 1000), recalc: Math.round(M.RecalcStyleDuration * 1000), layoutCount: M.LayoutCount, recalcCount: M.RecalcStyleCount };
}

(async () => {
  const a = await run('normal', false);
  await new Promise(r => setTimeout(r, 5000));
  const b = await run('reduce-motion', true);
  const keys = ['reduce', 'anims', 'task', 'script', 'layout', 'recalc', 'layoutCount', 'recalcCount', 'qsSwitchExists'];
  console.log('metric'.padEnd(18) + String(a.label).padStart(16) + String(b.label).padStart(16) + 'delta'.padStart(12));
  for (const k of keys) {
    const d = (typeof a[k] === 'number') ? (b[k] - a[k]) : '';
    console.log(String(k).padEnd(18) + String(a[k]).padStart(16) + String(b[k]).padStart(16) + String(d).padStart(12));
  }
})().catch(e => { console.error('FATAL', e); process.exit(1); });
