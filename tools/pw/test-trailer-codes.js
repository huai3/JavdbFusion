const fs = require('fs');
const { chromium } = require('playwright');
const path = require('path');
const ROOT = 'C:\\Users\\huai\\AppData\\Local\\Temp\\opencode\\javdbfusion';
const shim = require('./gm-shim');

(async () => {
  const b = await chromium.launch({ headless: true });
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, locale: 'zh-CN' });
  const reqLog = [];
  await c.exposeBinding('__gmXhr', async (s, o) => {
    const t0 = Date.now();
    try {
      const r = await fetch(o.url, { headers: o.headers || {}, redirect: 'follow' });
      const t = await r.text();
      reqLog.push({ u: o.url.slice(0, 120), st: r.status, ms: Date.now() - t0, len: t.length });
      return { status: r.status, text: t, url: r.url };
    } catch (e) { reqLog.push({ u: o.url.slice(0, 120), st: 0, ms: Date.now() - t0, err: String(e).slice(0, 40) }); throw e; }
  });
  await c.addInitScript(shim());
  await c.addInitScript(fs.readFileSync(path.join(ROOT, 'repo', 'JavdbFusion.user.js'), 'utf8'));
  const p = await c.newPage();

  const CODES = process.argv.slice(2).length ? process.argv.slice(2) : ['GANA-3475', 'MIUM-1457'];
  for (const code of CODES) {
    console.log('\n══════════════ ' + code + ' ══════════════');
    // 1) 先用 JAVDB 搜索拿到 video id
    let vid = null, searchTxt = '';
    for (let a = 0; a < 3 && !vid; a++) {
      try {
        await p.goto('https://javdb.com/search?q=' + encodeURIComponent(code), { waitUntil: 'domcontentloaded', timeout: 45000 });
      } catch (e) { await p.waitForTimeout(3000); continue; }
      await p.waitForTimeout(3500);
      await p.evaluate(() => { const x = [...document.querySelectorAll('a,button')].find(e => /是,\s*我已滿18歲/.test((e.textContent || '').replace(/\s+/g, ''))); if (x) x.click(); });
      await p.waitForTimeout(2500);
      const r = await p.evaluate((cd) => {
        const items = [...document.querySelectorAll('.item')];
        for (const it of items) {
          const t = (it.textContent || '').replace(/\s+/g, ' ');
          if (t.toUpperCase().indexOf(cd.toUpperCase()) >= 0) {
            const a = it.querySelector('a[href*="/v/"]');
            if (a) return { href: a.getAttribute('href'), txt: t.trim().slice(0, 70) };
          }
        }
        return { href: null, txt: (document.querySelector('.movie-list') || {}).innerText?.replace(/\s+/g, ' ').slice(0, 90) || 'no-list' };
      }, code);
      searchTxt = r.txt;
      if (r.href) vid = r.href;
    }
    console.log('搜索命中: ' + (vid || '（无）') + '   列表摘要: ' + searchTxt);
    if (!vid) { console.log('→ 跳过（搜索页无此番号）'); continue; }

    // 2) 打开详情页
    let ok = false;
    for (let a = 0; a < 3 && !ok; a++) { try { await p.goto('https://javdb.com' + vid, { waitUntil: 'domcontentloaded', timeout: 45000 }); ok = true; } catch (e) { await p.waitForTimeout(3000); } }
    if (!ok) { console.log('→ 详情页加载失败'); continue; }
    await p.waitForTimeout(6000);
    await p.evaluate(() => { const x = [...document.querySelectorAll('a,button')].find(e => /是,\s*我已滿18歲/.test((e.textContent || '').replace(/\s+/g, ''))); if (x) x.click(); });
    await p.waitForTimeout(7000);
    const page = await p.evaluate(() => ({
      title: document.title,
      code: ((document.querySelector('.emby-title') || {}).textContent || '').trim(),
      official: (() => { const b = document.querySelector('.preview-video-container'); if (!b) return null; const a = b.querySelector('a[href*=".mp4"], a[href*=".m3u8"]'); return a ? a.getAttribute('href').slice(0, 100) : '有容器但无 mp4 链接'; })(),
      hasTile: document.querySelectorAll('.tile-item').length,
    }));
    console.log('页面: ' + page.title + '  番号: ' + page.code);
    console.log('官方预告片: ' + page.official + '   预览图 tile: ' + page.hasTile);

    // 3) 点预告片
    const before = reqLog.length;
    const clicked = await p.evaluate(() => {
      const cands = [...document.querySelectorAll('.jf-poster-play, .jf-circle-btn[data-jf-type="trailer"]')].filter(e => e.offsetParent);
      if (!cands.length) return false; cands[0].click(); return true;
    });
    let st = null;
    for (let i = 0; i < 30; i++) {
      await p.waitForTimeout(500);
      st = await p.evaluate(() => {
        const ov = document.querySelector('.jf-trailer-overlay');
        if (!ov) return { overlay: false };
        const v = ov.querySelector('video'), q = ov.querySelector('#jfTrailerQuality');
        const l = ov.querySelector('#jfTrailerLoading');
        return { src: (ov.querySelector('#jfTrailerSrc') || {}).textContent, quality: q ? [...q.options].map(o => o.textContent.trim()) : [], w: v ? v.videoWidth : 0, h: v ? v.videoHeight : 0, err: v && v.error ? v.error.code : null, load: l ? l.innerText.replace(/\s+/g, ' ').trim().slice(0, 90) : null };
      });
      if (st.overlay && (st.w > 0 || (st.load && /失败|未找到|超时/.test(st.load)))) break;
    }
    console.log('点开预告片: ' + (clicked ? '已点' : '无入口'));
    console.log('解析结果: ' + JSON.stringify(st));
    console.log('相关请求:');
    reqLog.slice(before).forEach(r => console.log('   ' + r.st + '  ' + r.ms + 'ms  ' + (r.u || '').slice(0, 96) + (r.err ? '  ' + r.err : '')));
    await p.screenshot({ path: path.join(ROOT, 'shots', 'trailer-' + code + '.png') });
  }
  await b.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
