const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = 'C:\\Users\\huai\\AppData\\Local\\Temp\\opencode\\javdbfusion';
const shim = require('./gm-shim');

async function run(scriptFile, label) {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, locale: 'zh-CN' });
  const calls = [];
  await c.exposeBinding('__gmXhr', async (s, o) => {
    calls.push({ u: o.url, t: Date.now() });
    try {
      const r = await fetch(o.url, { headers: o.headers || {}, redirect: 'follow' });
      const t = await r.text();
      return { status: r.status, text: t, url: r.url };
    } catch (e) { throw e; }
  });
  await c.addInitScript(shim());
  if (scriptFile) await c.addInitScript(fs.readFileSync(scriptFile, 'utf8'));
  const p = await c.newPage();
  let ok=false; for(let a=0;a<6 && !ok;a++){ try{ await p.goto(process.env.TEST_URL || 'https://javdb.com/', { waitUntil: 'domcontentloaded', timeout: 40000 }); ok=true; }catch(e){ await p.waitForTimeout(8000); } }
  if(!ok){ await b.close(); return { label, err: 'goto failed' }; }
  await p.waitForTimeout(6000);
  await p.evaluate(() => { const x = [...document.querySelectorAll('a,button')].find(e => /是,\s*我已滿18歲/.test((e.textContent || '').replace(/\s+/g, ''))); if (x) x.click(); });
  await p.waitForTimeout(12000);
  const uniq = {};
  calls.forEach(x => { uniq[x.u] = (uniq[x.u] || 0) + 1; });
  const dupes = Object.keys(uniq).filter(u => uniq[u] > 1);
  const wasted = calls.length - Object.keys(uniq).length;
  await b.close();
  return { label, total: calls.length, unique: Object.keys(uniq).length, wasted, dupCount: dupes.length, dupes: dupes.slice(0, 10).map(u => uniq[u] + 'x ' + u.slice(0, 70)) };
}

(async () => {
  const url = process.argv[2] || 'https://javdb.com/';
  const a = await run(path.join(ROOT, 'repo', 'JavdbFusion.user.js.orig'), 'before');
  await new Promise(r => setTimeout(r, 4000));
  const b2 = await run(path.join(ROOT, 'repo', 'JavdbFusion.user.js'), 'after');
  console.log(JSON.stringify({ before: a, after: b2 }, null, 1));
})().catch(e => { console.error('FATAL', e); process.exit(1); });


