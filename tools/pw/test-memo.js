const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = 'C:\\Users\\huai\\AppData\\Local\\Temp\\opencode\\javdbfusion';
const shim = require('./gm-shim');
(async () => {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1280, height: 800 } });
  const calls = [];
  await c.exposeBinding('__gmXhr', async (s, o) => { calls.push(o.url); await new Promise(r => setTimeout(r, 200)); return { status: 200, text: 'ok', url: o.url }; });
  await c.addInitScript(shim());
  await c.addInitScript(fs.readFileSync(path.join(ROOT, 'repo', 'JavdbFusion.user.js'), 'utf8'));
  const p = await c.newPage();
  let ok=false; for(let a=0;a<6 && !ok;a++){ try{ await p.goto('https://javdb.com/', { waitUntil: 'domcontentloaded', timeout: 40000 }); ok=true; }catch(e){ await p.waitForTimeout(8000); } }
  if(!ok){ console.log('goto failed'); await b.close(); return; }
  await p.waitForTimeout(6000);
  const before = calls.length;
  const r = await p.evaluate(async () => {
    const fire = (u) => new Promise(res => GM_xmlhttpRequest({ method: 'GET', url: u, timeout: 8000, onload: x => res(x.status), onerror: () => res(0), ontimeout: () => res(-1) }));
    const u = 'https://www.njav.com/zh/search?q=memoprobe';
    const seq = [];
    for (let i = 0; i < 3; i++) { seq.push(await fire(u)); await new Promise(r => setTimeout(r, 300)); }
    const con = await Promise.all([fire(u), fire(u), fire(u)]);
    return { seq, con };
  });
  console.log('页面内结果:', JSON.stringify(r));
  console.log('合成请求实际发出次数（期望 1）:', calls.length - before);
  console.log('明细:', calls.slice(before).map(u => u.slice(0, 60)).join(' | ') || '(无)');
  await b.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

