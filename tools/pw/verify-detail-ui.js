const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const ROOT = 'C:\\Users\\huai\\AppData\\Local\\Temp\\opencode\\javdbfusion';
const shim = require('./gm-shim');
(async () => {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, locale: 'zh-CN' });
  await c.exposeBinding('__gmXhr', async (s, o) => { try { const r = await fetch(o.url, { headers: o.headers || {} }); return { status: r.status, text: await r.text(), url: r.url }; } catch (e) { throw e; } });
  await c.addInitScript(shim());
  await c.addInitScript(fs.readFileSync(path.join(ROOT, 'repo', 'JavdbFusion.user.js'), 'utf8'));
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
  await p.goto('https://javdb.com/v/021OE', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await p.waitForTimeout(6000);
  await p.evaluate(() => { const x = [...document.querySelectorAll('a,button')].find(e => /是,\s*我已滿18歲/.test((e.textContent || '').replace(/\s+/g, ''))); if (x) x.click(); });
  await p.waitForTimeout(8000);

  const info = await p.evaluate(() => {
    const bar = document.querySelector('.emby-dtabbar');
    const R = e => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
    return {
      tabbar: !!bar,
      tabbarRect: R(bar),
      tabs: bar ? [...bar.querySelectorAll('.emby-dtab')].map(t => t.textContent.trim() + (t.classList.contains('active') ? ' *' : '')) : [],
      panes: document.querySelectorAll('.emby-dpane').length,
      visiblePane: (() => { const p = [...document.querySelectorAll('.emby-dpane')].find(x => !x.hidden); return p ? p.id : null; })(),
      anchor: !!document.querySelector('.emby-anchor'),
      anchorItems: [...document.querySelectorAll('.emby-anchor a')].map(a => a.title),
      subtitleBlock: !!document.querySelector('.emby-sub-block'),
      nativeColMoved: !!document.querySelector('.emby-dpane .columns[data-controller="movie-tab"]'),
      heroVisible: (() => { const h = document.querySelector('.emby-detail-hero'); return h ? getComputedStyle(h).display : null; })(),
    };
  });
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(600);
  const atTop = await p.evaluate(() => { const b = document.querySelector('.emby-dtabbar'); return b ? Math.round(b.getBoundingClientRect().top) : null; });
  await p.screenshot({ path: path.join(ROOT, 'shots', 'new-detail-overview.png') });
  // 吸顶检查：滚动 800px 后页签栏应贴在顶栏下方
  await p.evaluate(() => window.scrollTo(0, 800));
  await p.waitForTimeout(600);
  const stuck = await p.evaluate(() => {
    const b = document.querySelector('.emby-dtabbar');
    const tb = document.getElementById('emby-topbar');
    return { tabTop: b ? Math.round(b.getBoundingClientRect().top) : null, topbarH: tb ? Math.round(tb.getBoundingClientRect().height) : null };
  });
  await p.screenshot({ path: path.join(ROOT, 'shots', 'new-detail-sticky.png') });
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(400);

  // 切到「磁力」页签
  await p.evaluate(() => { const t = [...document.querySelectorAll('.emby-dtab')].find(x => /磁力/.test(x.textContent) && !/聚合/.test(x.textContent)); if (t) t.click(); });
  await p.waitForTimeout(1500);
  const magnet = await p.evaluate(() => ({
    visiblePane: (() => { const p = [...document.querySelectorAll('.emby-dpane')].find(x => !x.hidden); return p ? p.id : null; })(),
    active: (() => { const t = document.querySelector('.emby-dtab.active'); return t ? t.textContent.trim() : null; })(),
    nativeActive: (() => { const li = document.querySelector('.columns[data-controller="movie-tab"] .tabs li.is-active'); return li ? li.textContent.trim() : null; })(),
    paneText: (() => { const p = [...document.querySelectorAll('.emby-dpane')].find(x => !x.hidden); return p ? p.innerText.replace(/\s+/g, ' ').trim().slice(0, 120) : null; })(),
  }));
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(ROOT, 'shots', 'new-detail-magnet.png') });

  // 切到「磁力聚合」
  await p.evaluate(() => { const t = [...document.querySelectorAll('.emby-dtab')].find(x => /磁力聚合/.test(x.textContent)); if (t) t.click(); });
  await p.waitForTimeout(1500);
  const agg = await p.evaluate(() => ({
    visiblePane: (() => { const p = [...document.querySelectorAll('.emby-dpane')].find(x => !x.hidden); return p ? p.id : null; })(),
    magPanelIn: (() => { const m = document.getElementById('jf-magnet-panel'); return m ? (m.closest('.emby-dpane') ? m.closest('.emby-dpane').id : 'not-in-pane') : 'no-panel'; })(),
  }));
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(600);
  await p.screenshot({ path: path.join(ROOT, 'shots', 'new-detail-agg.png') });

  console.log(JSON.stringify({ info, atTop, stuck, magnet, agg, pageErrors: errs.slice(0, 5) }, null, 1));
  await b.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });

