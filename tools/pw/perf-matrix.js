const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = 'C:\\Users\\huai\\AppData\\Local\\Temp\\opencode\\javdbfusion';
const SCRIPT_PATH = path.join(ROOT, 'JavdbFusion.user.js');
const CSS_FILE = path.join(ROOT, 'pw', 'skin.css');
const URL_ = process.argv[2] || 'https://javdb.com/';

function shim() {
  return `window.__gmStore={};
  window.GM_getValue=function(k,d){return (k in window.__gmStore)?window.__gmStore[k]:d;};
  window.GM_setValue=function(k,v){window.__gmStore[k]=v;};
  window.GM_deleteValue=function(k){delete window.__gmStore[k];};
  window.GM_listValues=function(){return Object.keys(window.__gmStore);};
  window.GM_setClipboard=function(){};window.GM_registerMenuCommand=function(){};window.GM_notification=function(){};
  window.GM_getResourceText=function(){return '';};window.unsafeWindow=window;
  window.GM_addStyle=function(c){var s=document.createElement('style');s.textContent=c;(document.head||document.documentElement).appendChild(s);};
  window.GM_openInTab=function(u){window.open(u,'_blank');};
  window.GM_xmlhttpRequest=function(o){if(o&&o.onerror)setTimeout(function(){o.onerror({status:0});},0);return{abort:function(){}};};`;
}

async function run(label, mode) {
  const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, locale: 'zh-CN',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  });
  await ctx.exposeBinding('__gmXhr', async (src, o) => {
    const ac = new AbortController(); const t = setTimeout(() => ac.abort(), o.timeout || 30000);
    try { const r = await fetch(o.url, { method: o.method || 'GET', headers: o.headers || {}, body: o.data || undefined, signal: ac.signal }); const text = await r.text(); return { status: r.status, text, url: r.url }; } finally { clearTimeout(t); }
  });
  await ctx.addInitScript(shim());
  const raw = fs.readFileSync(SCRIPT_PATH, 'utf8');
  if (mode === 'cssonly') {
    const css = fs.readFileSync(CSS_FILE, 'utf8');
    await ctx.addInitScript(`document.addEventListener('DOMContentLoaded',function(){var s=document.createElement('style');s.id='javdb-emby-skin';s.textContent=${JSON.stringify(css)};(document.head||document.documentElement).appendChild(s);});`);
  } else if (mode === 'jsonly') {
    await ctx.addInitScript(raw.replace("skinEl.textContent = buildEmbyCSS('#00a4dc');", "skinEl.textContent = '';"));
  } else if (mode === 'full') {
    await ctx.addInitScript(raw);
  }
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  const t0 = Date.now();
  let loadMs = -1;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      await page.goto(URL_, { waitUntil: 'domcontentloaded', timeout: 45000 });
      loadMs = Date.now() - t0;
      break;
    } catch (e) {
      console.log(`  [${label}] goto attempt ${attempt + 1} failed: ${e.message.split('\n')[0]}`);
      await page.waitForTimeout(4000);
    }
  }
  if (loadMs < 0) { await browser.close(); throw new Error('goto failed for ' + label); }
  await page.waitForTimeout(4500);
  await page.evaluate(() => { const b = [...document.querySelectorAll('a,button')].find(x => /是,\s*我已滿18歲/.test((x.textContent || '').replace(/\s+/g, ''))); if (b) b.click(); });
  await page.waitForTimeout(4500);
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 500); await page.waitForTimeout(100); }
  await page.waitForTimeout(1200);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
  const { metrics } = await cdp.send('Performance.getMetrics');
  const M = Object.fromEntries(metrics.map(m => [m.name, m.value]));
  const dom = await page.evaluate(() => ({
    nodes: document.getElementsByTagName('*').length,
    styleKB: Math.round([...document.querySelectorAll('style')].reduce((a, s) => a + (s.textContent.length || 0), 0) / 1024),
  }));
  await browser.close();
  return { label, mode, loadMs, task: Math.round(M.TaskDuration * 1000), script: Math.round(M.ScriptDuration * 1000), layout: Math.round(M.LayoutDuration * 1000), recalc: Math.round(M.RecalcStyleDuration * 1000), recalcCount: M.RecalcStyleCount, layoutCount: M.LayoutCount, heapMB: Math.round(M.JSHeapUsedSize / 1048576), domNodes: dom.nodes, styleKB: dom.styleKB };
}

(async () => {
  // 1) capture the real skin CSS from a live run
  if (!fs.existsSync(CSS_FILE)) {
    const browser = await chromium.launch({ headless: true });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
    await ctx.addInitScript(shim());
    await ctx.addInitScript(fs.readFileSync(SCRIPT_PATH, 'utf8'));
    const p = await ctx.newPage();
    await p.goto(URL_, { waitUntil: 'domcontentloaded' });
    await p.waitForTimeout(6000);
    const css = await p.evaluate(() => (document.getElementById('javdb-emby-skin') || {}).textContent || '');
    fs.writeFileSync(CSS_FILE, css, 'utf8');
    console.log('captured skin CSS:', css.length, 'chars');
    await browser.close();
  }
  const modes = [['native', 'native'], ['cssonly', 'cssonly'], ['jsonly', 'jsonly'], ['full', 'full']];
  const res = [];
  for (const [label, mode] of modes) { res.push(await run(label, mode)); await new Promise(r => setTimeout(r, 5000)); }
  const keys = ['loadMs', 'task', 'script', 'layout', 'recalc', 'recalcCount', 'layoutCount', 'heapMB', 'domNodes', 'styleKB'];
  console.log('\n=== ' + URL_ + ' ===');
  console.log('mode'.padEnd(10) + keys.map(k => k.padStart(11)).join(''));
  for (const r of res) console.log(r.mode.padEnd(10) + keys.map(k => String(r[k]).padStart(11)).join(''));
  fs.writeFileSync(path.join(ROOT, 'shots', 'perf-matrix.json'), JSON.stringify(res, null, 1));
})().catch(e => { console.error('FATAL', e); process.exit(1); });
