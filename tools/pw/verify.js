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

const AUDIT = `(() => {
  const lum = c => { const m = c.match(/[\\d.]+/g); if (!m) return 0; const [r,g,b] = m.slice(0,3).map(Number).map(v => { v/=255; return v<=0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055,2.4); }); return 0.2126*r+0.7152*g+0.0722*b; };
  const cr = (a,b) => { const L1=lum(a), L2=lum(b); const hi=Math.max(L1,L2), lo=Math.min(L1,L2); return Math.round(((hi+0.05)/(lo+0.05))*100)/100; };
  const bgOf = el => { let n=el; while(n && n!==document.documentElement){ const c=getComputedStyle(n).backgroundColor; if(c && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(c)) return c; n=n.parentElement; } return 'rgb(22,24,29)'; };
  const probe = sel => { const el=document.querySelector(sel); if(!el) return null; const cs=getComputedStyle(el); return { color:cs.color, bg:bgOf(el), ratio:cr(cs.color,bgOf(el)), font:cs.fontSize }; };
  const R = e => { if(!e) return null; const b=e.getBoundingClientRect(); return {x:Math.round(b.x),y:Math.round(b.y),w:Math.round(b.width),h:Math.round(b.height)}; };
  const tb=document.getElementById('emby-topbar');
  const ml=document.querySelector('.movie-list');
  const items=[...document.querySelectorAll('.movie-list > .item')];
  const tog=document.getElementById('javdb-emby-toggle');
  let overlap=0;
  if(tog && tog.offsetParent){ const a=tog.getBoundingClientRect(); overlap=items.filter(i=>{const b=i.getBoundingClientRect(); return !(a.right<b.left||a.left>b.right||a.bottom<b.top||a.top>b.bottom);}).length; }
  // header gap source
  const bodyCS=getComputedStyle(document.body), htmlCS=getComputedStyle(document.documentElement);
  const sec=document.querySelector('body > section') || document.querySelector('section.section');
  const secCS=sec?getComputedStyle(sec):null;
  const cs=getComputedStyle(document.documentElement);
  return {
    skinOn: document.documentElement.classList.contains('emby-skin'),
    reduceMotion: document.documentElement.classList.contains('reduce-motion'),
    contrast: { title:probe('.item .video-title'), score:probe('.item .score'), meta:probe('.item .meta'), tag:probe('.item .tags .tag') },
    header: {
      htmlPadTop: htmlCS.paddingTop, bodyPadTop: bodyCS.paddingTop, bodyMarginTop: bodyCS.marginTop,
      htmlFontSize: htmlCS.fontSize, bodyFontSize: bodyCS.fontSize,
      headerH: cs.getPropertyValue('--e-header-h').trim(),
      secTop: sec?Math.round(sec.getBoundingClientRect().top):null,
      secPadTop: secCS?secCS.paddingTop:null, secMarginTop: secCS?secCS.marginTop:null,
      topbarBottom: tb?Math.round(tb.getBoundingClientRect().bottom):null,
      listTop: ml?Math.round(ml.getBoundingClientRect().top):null,
      gapTopbarToList: (tb&&ml)?Math.round(ml.getBoundingClientRect().top-tb.getBoundingClientRect().bottom):null,
    },
    homeTabs: (()=>{ const h=document.querySelector('.emby-home-tabs'); const t=document.querySelector('.main-tabs-wrap'); if(!h) return null;
      return { y:Math.round(h.getBoundingClientRect().top), h:Math.round(h.getBoundingClientRect().height), x:Math.round(h.getBoundingClientRect().x),
        nativeTabsY: t?Math.round(t.getBoundingClientRect().top):null,
        order: t ? (h.compareDocumentPosition(t) & Node.DOCUMENT_POSITION_FOLLOWING ? 'before-native' : 'after-native') : 'n/a',
        justify: getComputedStyle(h).justifyContent }; })(),
    toggle: { rect: R(tog), opacity: tog?getComputedStyle(tog).opacity:null, overlapCards: overlap },
    cardDeadSpace: items.slice(0,6).map(i=>{ const bx=i.querySelector('.box'), tg=i.querySelector('.tags'); if(!bx||!tg) return null; return Math.round(bx.getBoundingClientRect().bottom-tg.getBoundingClientRect().bottom); }),
    cardFontSizes: { title: probe('.item .video-title')?.font, score: probe('.item .score')?.font, meta: probe('.item .meta')?.font, tag: probe('.item .tags .tag')?.font },
  };
})()`;

(async () => {
  const target = process.argv[2] || path.join(ROOT, 'repo', 'JavdbFusion.user.js');
  const label = process.argv[3] || 'verify';
  const url = process.argv[4] || 'https://javdb.com/';
  const b = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled'] });
  const c = await b.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true, locale: 'zh-CN',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36' });
  await c.exposeBinding('__gmXhr', async (s, o) => { try { const r = await fetch(o.url, { headers: o.headers || {} }); return { status: r.status, text: await r.text(), url: r.url }; } catch (e) { throw e; } });
  await c.addInitScript(shim());
  await c.addInitScript(fs.readFileSync(target, 'utf8'));
  const p = await c.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(String(e.message).slice(0, 200)));
  let ok = false;
  for (let a = 0; a < 4 && !ok; a++) { try { await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 }); ok = true; } catch (e) { await p.waitForTimeout(4000); } }
  if (!ok) { console.log('goto failed'); await b.close(); return; }
  await p.waitForTimeout(5000);
  await p.evaluate(() => { const x = [...document.querySelectorAll('a,button')].find(e => /是,\s*我已滿18歲/.test((e.textContent || '').replace(/\s+/g, ''))); if (x) x.click(); });
  await p.waitForTimeout(5500);
  const audit = await p.evaluate(AUDIT);
  // CSS 完整性：浏览器 CSSOM 解析后的规则数 vs 源码里的声明数
  // （少冒号之类的写法会被 CSSOM 静默丢弃，只有这样才能发现）
  const cssCheck = await p.evaluate(() => {
    const el = document.getElementById('javdb-emby-skin');
    if (!el) return { error: 'no skin style element' };
    const raw = el.textContent || '';
    const srcTrans = (raw.match(/transition\s*:/gi) || []).length;
    const srcAll = (raw.match(/transition\s*:\s*all\b/gi) || []).length;
    let parsed = 0, rules = 0;
    for (const sheet of document.styleSheets) {
      let rs; try { rs = sheet.cssRules; } catch (e) { continue; }
      if (!rs) continue;
      for (const r of rs) {
        rules++;
        if (r.style && r.style.transitionProperty) parsed++;
        if (r.style && r.style.transition && r.style.transition) parsed++;
      }
    }
    return { rawChars: raw.length, srcTransDecls: srcTrans, srcTransitionAll: srcAll, parsedTransitionRules: parsed, cssRules: rules };
  });
  await p.screenshot({ path: path.join(ROOT, 'shots', `${label}.png`) });
  console.log(JSON.stringify({ label, url, audit, cssCheck, pageErrors: errs.slice(0, 5) }, null, 1));
  await b.close();
})().catch(e => { console.error('FATAL', e); process.exit(1); });
