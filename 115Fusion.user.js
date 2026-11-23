// ==UserScript==
// @name         115Fusion - Apple TV+ 海报墙 · 悬停多图剧照 · 智能番号归档
// @namespace    com.local.javdbemby.115fusion
// @version      1.1.1-appletv-pro
// @description  专为 115 网盘打造的 Apple TV+ 影院级伴侣脚本（与 JavdbFusion 双端联动）：无限容量 IndexedDB 缓存 + DMM 确定性直链零搜索预测 + 视口懒加载防风控海报墙（千部大目录永不失效）、光标滑动预览多张剧照与高清灯箱、libmpv 签名对齐原画串流直调 IINA/PotPlayer/mpv/Infuse、JAVDB+JavBus+AV-Wiki 三源女优识别与纯番号智能归档。
// @author       hy3 + fusion
// @homepageURL  https://github.com/huai3/JavdbFusion
// @supportURL   https://github.com/huai3/JavdbFusion/issues
// @downloadURL  https://raw.githubusercontent.com/huai3/JavdbFusion/main/115Fusion.user.js
// @updateURL    https://raw.githubusercontent.com/huai3/JavdbFusion/main/115Fusion.user.js
// @match        *://115.com/*
// @match        *://*.115.com/*
// @connect      115.com
// @connect      webapi.115.com
// @connect      proapi.115.com
// @connect      115vod.com
// @connect      cpats01.115.com
// @connect      javdb580.com
// @connect      javdb.com
// @connect      c0.jdbstatic.com
// @connect      jdbstatic.com
// @connect      awsimgsrc.dmm.co.jp
// @connect      pics.dmm.co.jp
// @connect      www.javbus.com
// @connect      av-wiki.net
// @connect      *
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // 仅在顶层窗口挂载全局 UI，自动穿透读取 115 内嵌 iframe[name="wangpan"] 当前目录 CID，避免双重悬浮球与弹层被裁切
  if (window !== window.top) return;
  if (window.__115FusionLoaded) return;
  window.__115FusionLoaded = true;

  /* =========================================================================
   * 一、基础配置与工具函数
   * ======================================================================= */
  const CONF_KEYS = {
    javdbHost: 'f115_javdb_host',
    defaultPlayer: 'f115_default_player',
    dirTpl: 'f115_dir_tpl',
    folderTpl: 'f115_folder_tpl',
    fileTpl: 'f115_file_tpl',
    noActorPolicy: 'f115_no_actor_policy',
    cleanJunk: 'f115_clean_junk',
    theme: 'f115_theme',
    enrichDetail: 'f115_enrich_detail',
    useBrowserUA: 'f115_use_browser_ua',
    playerUA: 'f115_player_ua'
  };

  // 一次性平滑迁移旧版冗长默认文件名模板（${code}${cnsub}${suffix} ${title} → 极简纯番号 ${code}）
  try {
    if (!GM_getValue('f115_tpl_migrated_v110', false)) {
      const oldFileTpl = GM_getValue(CONF_KEYS.fileTpl, '');
      if (!oldFileTpl || oldFileTpl === '${code}${cnsub}${suffix} ${title}' || oldFileTpl === '${code} ${title}') {
        GM_setValue(CONF_KEYS.fileTpl, '${code}');
      }
      GM_setValue('f115_tpl_migrated_v110', true);
    }
  } catch (e) {}

  function getConf() {
    return {
      javdbHost: String(GM_getValue(CONF_KEYS.javdbHost, 'https://javdb580.com') || 'https://javdb580.com').replace(/\/+$/, ''),
      defaultPlayer: GM_getValue(CONF_KEYS.defaultPlayer, 'iina') || 'iina',
      dirTpl: GM_getValue(CONF_KEYS.dirTpl, '云下载/${actor}') || '',
      folderTpl: GM_getValue(CONF_KEYS.folderTpl, '${code}') || '',
      fileTpl: GM_getValue(CONF_KEYS.fileTpl, '${code}') || '${code}',
      noActorPolicy: GM_getValue(CONF_KEYS.noActorPolicy, 'maker_or_skip') || 'maker_or_skip',
      cleanJunk: GM_getValue(CONF_KEYS.cleanJunk, true) !== false,
      theme: GM_getValue(CONF_KEYS.theme, 'dark') || 'dark',
      enrichDetail: GM_getValue(CONF_KEYS.enrichDetail, true) !== false,
      useBrowserUA: GM_getValue(CONF_KEYS.useBrowserUA, false) === true,
      playerUA: String(GM_getValue(CONF_KEYS.playerUA, '') || '').trim()
    };
  }
  function setConf(k, v) { GM_setValue(k, v); }

  function escHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escAttr(s) { return escHtml(s); }

  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

  function formatBytes(bytes) {
    const b = Number(bytes || 0);
    if (!b || b <= 0) return '0 B';
    if (b >= 1073741824) return (b / 1073741824).toFixed(2).replace(/\.00$/, '') + ' GB';
    if (b >= 1048576) return Math.round(b / 1048576) + ' MB';
    if (b >= 1024) return Math.round(b / 1024) + ' KB';
    return b + ' B';
  }

  function formatDuration(sec) {
    const s = Math.round(Number(sec || 0));
    if (!s || s <= 0) return '';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h > 0) return h + ':' + String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0');
    return m + ':' + String(r).padStart(2, '0');
  }

  function toast(msg, ok) {
    const old = document.querySelector('.f115-toast');
    if (old) old.remove();
    const el = document.createElement('div');
    el.className = 'f115-toast' + (ok === false ? ' is-err' : '');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.classList.add('show'); }, 10);
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.remove(); }, 260);
    }, 3200);
  }

  function gmReq(opts) {
    return new Promise(function (resolve, reject) {
      GM_xmlhttpRequest({
        method: opts.method || 'GET',
        url: opts.url,
        headers: opts.headers || {},
        data: opts.data,
        timeout: opts.timeout || 15000,
        anonymous: Boolean(opts.anonymous),
        onload: function (res) { resolve(res); },
        onerror: function (err) { reject(new Error((err && err.error) || '网络请求失败')); },
        ontimeout: function () { reject(new Error('请求超时')); }
      });
    });
  }

  /* =========================================================================
   * 二、番号提取与 DMM 确定性零搜索直链预测引擎
   * ======================================================================= */
  function extractCode(rawName) {
    let s = String(rawName || '').trim();
    // 剥离常见资源站前缀域名（如 489155.com@SSIS-858-LTX.mp4 / hhd800.com@300MIUM-1024.mp4）
    s = s.replace(/^[a-z0-9.-]+\.(?:com|net|org|me|cc|tv|xyz|info|vip|la|pw|top|club|site)@/i, '');
    s = s.replace(/\.[a-z0-9]{2,5}$/i, '');
    const fc2 = s.match(/FC2[-_ ]?(?:PPV[-_ ]?)?(\d{5,8})/i);
    if (fc2) return 'FC2-' + fc2[1];
    const heyzo = s.match(/HEYZO[-_ ]?(\d{3,5})/i);
    if (heyzo) return 'HEYZO-' + heyzo[1];
    const carib = s.match(/(?:CARIB(?:BEAN)?(?:COM)?)[-_ ]?(\d{5,6})[-_](\d{3})/i);
    if (carib) return 'CARIB-' + carib[1] + '-' + carib[2];
    const pondo = s.match(/(?:1PONDO)[-_ ]?(\d{5,6})[-_](\d{3})/i);
    if (pondo) return '1PONDO-' + pondo[1] + '_' + pondo[2];
    // 全局扫描：支持 2~4 位数字前缀素人番号（300MIUM / 200GANA / 259LUXU / 300MAAN / 261ARA / 390JAC / 420HOI / 1000GIRI）、
    // 常规字母前缀番号及 T28-555 等形态；命中黑名单噪点词（如 CD-01 / FHD-1080）时跳过继续向后匹配
    const ignorePrefix = /^(?:MP4|MKV|AVI|WMV|FHD|UHD|HEVC|X264|X265|H264|H265|AAC|CHS|CHT|PART|CD|DISC|10BIT|1080P|720P|4K)$/i;
    const stdRe = /(?<![A-Za-z0-9])([0-9]{2,4}[A-Za-z]{2,6}|[A-Za-z]{2,10}|[A-Za-z]\d{2}(?=[-_]))[-_]?(\d{2,6})(?=[^0-9]|$)/g;
    let m;
    while ((m = stdRe.exec(s)) !== null) {
      const prefix = m[1].toUpperCase();
      if (ignorePrefix.test(prefix)) continue;
      return prefix + '-' + m[2];
    }
    // 裸 6 位无码日期番号（如 012324-001 / 123456_001）
    const unc = s.match(/(?<![A-Za-z0-9])(\d{6})([-_])(\d{2,3})(?=[^0-9]|$)/);
    if (unc) return unc[1] + unc[2] + unc[3];
    return '';
  }

  function normalizeCode(code) {
    const c = extractCode(code) || String(code || '').trim().toUpperCase();
    return c;
  }

  // 根据正规番号推导 DMM CDN 候选 CID（零搜索请求秒出高清大图 + 10 张预览剧照）
  const DMM_PREFIX_MAP = {
    'STARS': '1stars', 'SDDE': '1sdde', 'SDJS': '1sdjs', 'SDAB': '1sdab', 'SDNM': '1sdnm',
    'SDAM': '1sdam', 'SDMM': '1sdmm', 'SDMU': '1sdmu', 'SDTH': '1sdth', 'SILK': '1silk',
    'IENF': '1ienf', 'IESP': '1iesp', 'DANDY': '1dandy',
    'FSDSS': '1fsdss', 'FALENO': '1fsdss', 'MTALL': '1mtall', 'MOGI': '1mogi', 'NHDTB': '1nhdtb',
    'RCTD': '1rctd', 'SVDVD': '1svdvd', 'SW': '1sw', 'HABA': '1haba'
  };

  function buildDmmCidCandidates(code) {
    const m = String(code || '').trim().match(/^([A-Z0-9]{2,10})-(\d{2,6})$/i);
    if (!m || /^FC2$/i.test(m[1])) return [];
    const rawMaker = m[1].toUpperCase();
    const maker = rawMaker.toLowerCase();
    const num = m[2];
    const pad5 = num.padStart(5, '0');
    const cids = [];
    const add = function (c) { if (c && cids.indexOf(c) < 0) cids.push(c); };
    if (DMM_PREFIX_MAP[rawMaker]) {
      add(DMM_PREFIX_MAP[rawMaker] + num.padStart(3, '0'));
      add(DMM_PREFIX_MAP[rawMaker] + pad5);
    }
    add(maker + pad5);
    add('1' + maker + num.padStart(3, '0'));
    add('1' + maker + pad5);
    add(maker + num);
    add('h_068' + maker + pad5);
    return cids.slice(0, 4);
  }

  function dmmCoverUrl(cid) {
    return 'https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/' + cid + '/' + cid + 'pl.jpg';
  }
  function dmmSampleUrls(cid, count) {
    const n = count || 10;
    const list = [];
    for (let i = 1; i <= n; i++) {
      list.push('https://awsimgsrc.dmm.co.jp/pics_dig/digital/video/' + cid + '/' + cid + 'jp-' + i + '.jpg');
    }
    return list;
  }

  // 检测图片 URL 是否真实高清有效（过滤 DMM 120x90 now_printing 占位图）
  function probeImageValid(url) {
    return new Promise(function (resolve) {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      const timer = setTimeout(function () { img.src = ''; resolve(false); }, 5500);
      img.onload = function () {
        clearTimeout(timer);
        // DMM 缺失占位图尺寸极小（如 100x136 / 120x90），真实 pl.jpg 宽度通常为 800px
        resolve(img.naturalWidth >= 240 && img.naturalHeight >= 160);
      };
      img.onerror = function () {
        clearTimeout(timer);
        resolve(false);
      };
      img.src = url;
    });
  }

  /* =========================================================================
   * 三、无限容量 IndexedDB 元数据与剧照缓存层 (115FusionMetaDB)
   * ======================================================================= */
  const MetaDB = (function () {
    const DB_NAME = '115FusionMetaDB';
    const STORE = 'movies';
    let dbPromise = null;
    const mem = new Map();

    function open() {
      if (dbPromise) return dbPromise;
      dbPromise = new Promise(function (resolve, reject) {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function (e) {
          const db = e.target.result;
          if (!db.objectStoreNames.contains(STORE)) {
            db.createObjectStore(STORE, { keyPath: 'code' });
          }
        };
        req.onsuccess = function (e) { resolve(e.target.result); };
        req.onerror = function (e) { dbPromise = null; reject(e.target.error); };
      });
      return dbPromise;
    }

    function memSetCapped(k, v) {
      mem.set(k, v);
      if (mem.size > 1500) {
        const oldest = mem.keys().next().value;
        mem.delete(oldest);
      }
    }

    async function get(code) {
      const k = normalizeCode(code);
      if (!k) return null;
      if (mem.has(k)) return mem.get(k);
      try {
        const db = await open();
        return await new Promise(function (resolve) {
          const tx = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).get(k);
          req.onsuccess = function () {
            const val = req.result || null;
            if (val) memSetCapped(k, val);
            resolve(val);
          };
          req.onerror = function () { resolve(null); };
        });
      } catch (e) { return null; }
    }

    async function put(record) {
      if (!record || !record.code) return;
      const k = normalizeCode(record.code);
      const data = Object.assign({}, record, { code: k, updatedAt: Date.now() });
      memSetCapped(k, data);
      try {
        const db = await open();
        await new Promise(function (resolve) {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(data);
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        });
      } catch (e) {}
    }

    async function clearAll() {
      mem.clear();
      try {
        const db = await open();
        await new Promise(function (resolve) {
          const tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).clear();
          tx.oncomplete = function () { resolve(true); };
          tx.onerror = function () { resolve(false); };
        });
      } catch (e) {}
    }

    return { get: get, put: put, clearAll: clearAll };
  })();

  /* =========================================================================
   * 四、防风控视口懒加载元数据与剧照引擎（DMM 零搜索优先 + Concurrency=2 JAVDB 节流兜底）
   * ======================================================================= */
  const ArtworkEngine = (function () {
    const queue = [];
    const inflight = new Map();
    let activeWorkers = 0;
    const MAX_CONCURRENCY = 2;
    let javdbCooldownUntil = 0;

    function resolveImgUrl(src, baseHost) {
      if (!src) return '';
      let s = String(src).trim();
      if (s.indexOf('//') === 0) return 'https:' + s;
      if (s.indexOf('/') === 0) return baseHost + s;
      return s;
    }

    async function fetchFromJavdb(code, needDetail) {
      if (Date.now() < javdbCooldownUntil) return null;
      const host = getConf().javdbHost;
      const searchUrl = host + '/search?q=' + encodeURIComponent(code) + '&f=all';
      const r = await gmReq({
        url: searchUrl,
        timeout: 12000,
        headers: { 'Accept': 'text/html,application/xhtml+xml', 'Referer': host + '/' }
      });
      if (r.status === 429 || r.status === 403 || r.status === 503) {
        // 触发限流熔断保护 3 分钟，杜绝大目录连环封 IP
        javdbCooldownUntil = Date.now() + 3 * 60 * 1000;
        return null;
      }
      const html = r.responseText || '';
      if (!html || /cf-turnstile|Just a moment|安全验证/i.test(html)) {
        javdbCooldownUntil = Date.now() + 3 * 60 * 1000;
        return null;
      }
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const items = doc.querySelectorAll('.movie-list .item');
      let matchedBox = null;
      const normTarget = normalizeCode(code);
      for (let i = 0; i < items.length; i++) {
        const st = items[i].querySelector('.video-title strong');
        const c = normalizeCode(st ? st.textContent : '');
        if (c === normTarget) {
          matchedBox = items[i].querySelector('a.box') || items[i];
          break;
        }
      }
      if (!matchedBox && items.length === 1) {
        const st0 = items[0].querySelector('.video-title strong');
        if (normalizeCode(st0 ? st0.textContent : '').indexOf(normTarget.split('-')[1] || '') >= 0) {
          matchedBox = items[0].querySelector('a.box') || items[0];
        }
      }
      if (!matchedBox) return null;

      const href = matchedBox.getAttribute('href') || '';
      const imgEl = matchedBox.querySelector('.cover img');
      let cover = resolveImgUrl((imgEl && (imgEl.getAttribute('src') || imgEl.getAttribute('data-src'))) || '', host);
      cover = cover.replace(/\/thumbs\//, '/covers/');
      const titleEl = matchedBox.querySelector('.video-title');
      let cleanTitle = '';
      if (titleEl) {
        const clone = titleEl.cloneNode(true);
        const st = clone.querySelector('strong');
        if (st) st.remove();
        cleanTitle = (clone.textContent || '').trim();
      }
      const scoreEl = matchedBox.querySelector('.score .value, .score');
      const scoreMatch = ((scoreEl && scoreEl.textContent) || '').match(/([0-5]\.\d{1,2})/);
      const score = scoreMatch ? scoreMatch[1] : '';
      const metaEl = matchedBox.querySelector('.meta');
      const dateMatch = ((metaEl && metaEl.textContent) || '').match(/\b(20\d{2}-\d{2}-\d{2}|19\d{2}-\d{2}-\d{2})\b/);
      const date = dateMatch ? dateMatch[1] : '';

      const out = {
        code: normTarget,
        cover: cover,
        thumbs: [],
        title: cleanTitle,
        score: score,
        date: date,
        actors: [],
        maker: '',
        series: '',
        detailUrl: href ? (host + href) : (host + '/search?q=' + encodeURIComponent(normTarget))
      };

      if (needDetail && href && Date.now() >= javdbCooldownUntil) {
        await sleep(280);
        try {
          const dr = await gmReq({
            url: host + href,
            timeout: 12000,
            headers: { 'Accept': 'text/html,application/xhtml+xml', 'Referer': searchUrl }
          });
          if (dr.status === 200 && dr.responseText) {
            const ddoc = new DOMParser().parseFromString(dr.responseText, 'text/html');
            const bigCover = ddoc.querySelector('.column-video-cover img');
            if (bigCover && bigCover.getAttribute('src')) {
              out.cover = resolveImgUrl(bigCover.getAttribute('src'), host);
            }
            // 2026 版 JAVDB 女优链接带有 class="actor-female"，而男优仅为普通 <a href="/actors/...">（无 actor-female）！
            // 严格只采信女优，杜绝把西島雄介/今井勇太/鮫島等男优误识别为归档女优
            const femaleActors = [];
            ddoc.querySelectorAll('.movie-panel-info .panel-block a[href*="/actors/"]').forEach(function (a) {
              const sym = a.nextElementSibling;
              const nextTxt = (sym ? sym.textContent : '') + ((a.nextSibling && a.nextSibling.textContent) || '');
              const isMale = Boolean((a.classList && a.classList.contains('actor-male')) || (sym && sym.classList && sym.classList.contains('male')) || /♂/.test(nextTxt));
              const isFemale = Boolean((a.classList && a.classList.contains('actor-female')) || (sym && sym.classList && sym.classList.contains('female')) || /♀/.test(nextTxt));
              if (isMale || !isFemale) return;
              const nm = (a.textContent || '').replace(/[\u2640\u2642]/g, '').trim();
              if (nm && femaleActors.indexOf(nm) < 0) femaleActors.push(nm);
            });
            out.actors = femaleActors;
            const mk = ddoc.querySelector('.movie-panel-info .panel-block a[href*="/makers/"]');
            if (mk) out.maker = (mk.textContent || '').trim();
            const sr = ddoc.querySelector('.movie-panel-info .panel-block a[href*="/series/"]');
            if (sr) out.series = (sr.textContent || '').trim();
            const samples = [];
            ddoc.querySelectorAll('.preview-images a.tile-item[href], .tile-images.preview-images a[href]').forEach(function (a) {
              const h = a.getAttribute('href') || '';
              if (h && !/\.mp4/i.test(h)) samples.push(resolveImgUrl(h, host));
            });
            if (samples.length) out.thumbs = samples.slice(0, 14);
          }
        } catch (e) {}
      }
      return out;
    }

    // 第二源兜底：JavBus 按番号直达页（无需搜索接口，不吃搜索限流，直接拿正规片女优与片商）
    async function fetchFromJavBus(code) {
      try {
        const r = await gmReq({
          url: 'https://www.javbus.com/' + encodeURIComponent(code),
          timeout: 9000,
          anonymous: true,
          headers: { 'Accept': 'text/html,application/xhtml+xml', 'Accept-Language': 'zh-CN,zh;q=0.9,ja;q=0.8', 'Cookie': 'existmag=all' }
        });
        if (r.status !== 200 || !r.responseText) return null;
        const doc = new DOMParser().parseFromString(r.responseText, 'text/html');
        const stars = [];
        doc.querySelectorAll('.star-name a').forEach(function (a) {
          const nm = (a.textContent || '').trim();
          if (nm && stars.indexOf(nm) < 0) stars.push(nm);
        });
        let title = '';
        const h3 = doc.querySelector('.container h3');
        if (h3) {
          title = (h3.textContent || '').replace(new RegExp('^' + code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*', 'i'), '').trim();
        }
        let maker = '';
        doc.querySelectorAll('.movie .info p').forEach(function (p) {
          const t = (p.textContent || '').trim();
          if (/^(?:製作商|廠商|メーカー):/i.test(t)) {
            const a = p.querySelector('a');
            if (a) maker = (a.textContent || '').trim();
          }
        });
        return { actors: stars, title: title, maker: maker };
      } catch (e) { return null; }
    }

    // 第三源兜底：AV-Wiki 素人女优真名百科（专破 HAWA / SIRO / LUXU / ARA / GANA / MAAN 等 JAVDB 不标女优的素人企划片！）
    async function fetchFromAvWiki(code) {
      try {
        const r = await gmReq({
          url: 'https://av-wiki.net/?s=' + encodeURIComponent(code) + '&post_type=product',
          timeout: 9500,
          anonymous: true,
          headers: { 'Accept': 'text/html,application/xhtml+xml', 'User-Agent': navigator.userAgent }
        });
        if (r.status !== 200 || !r.responseText) return null;
        const doc = new DOMParser().parseFromString(r.responseText, 'text/html');
        const articles = doc.querySelectorAll('article.archive-list, article');
        const parts = code.toLowerCase().split('-');
        const compact = parts.join('');
        const numOnly = (parts[1] || '').replace(/^0+(?=\d)/, '');
        const escapedPrefix = parts[0] ? parts[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
        const escapedNum = numOnly ? numOnly.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : '';
        const fallbackRe = (escapedPrefix && escapedNum) ? new RegExp(escapedPrefix + '0*' + escapedNum) : null;
        for (let i = 0; i < articles.length; i++) {
          const art = articles[i];
          const rawHtml = (art.innerHTML || '').toLowerCase();
          if (rawHtml.indexOf(code.toLowerCase()) < 0 && rawHtml.indexOf(compact) < 0 && !(fallbackRe && fallbackRe.test(rawHtml))) {
            continue;
          }
          const actors = [];
          art.querySelectorAll('li.actress-name a, a[href*="/av-actress/"]').forEach(function (a) {
            const nm = (a.textContent || '').trim();
            if (nm && !/一覧|まとめ|ランキング/.test(nm) && actors.indexOf(nm) < 0) actors.push(nm);
          });
          let dmmCid = '';
          const cidMatch = rawHtml.match(/\/pics_dig\/digital\/video\/([a-z0-9_]+)\//i);
          if (cidMatch) dmmCid = cidMatch[1];
          if (actors.length || dmmCid) return { actors: actors, dmmCid: dmmCid };
        }
      } catch (e) {}
      return null;
    }

    async function resolveMeta(code, opts) {
      opts = opts || {};
      const norm = normalizeCode(code);
      if (!norm) return null;

      // 1. 先查无限容量 IndexedDB 永久缓存（若强制要求女优名且旧缓存无女优或未走过 v1.1 三源识别，则自动穿透补全）
      const cached = await MetaDB.get(norm);
      if (cached && cached.cover && (!opts.forceActors || (cached._v110Actors && ((cached.actors && cached.actors.length) || cached._allSourcesTried)))) {
        return cached;
      }

      if (inflight.has(norm)) return inflight.get(norm);

      const jobPromise = (async function () {
        // 2. DMM CDN 确定性直链零搜索预测（不消耗任何搜索配额，大目录千部秒开核心）
        let dmmCover = '';
        let dmmThumbs = [];
        const cids = buildDmmCidCandidates(norm);
        for (let i = 0; i < cids.length; i++) {
          const u = dmmCoverUrl(cids[i]);
          const ok = await probeImageValid(u);
          if (ok) {
            dmmCover = u;
            dmmThumbs = dmmSampleUrls(cids[i], 10);
            break;
          }
        }

        const wantActors = Boolean(getConf().enrichDetail || opts.forceActors);
        let javMeta = null;
        if (!dmmCover || wantActors) {
          javMeta = await fetchFromJavdb(norm, wantActors);
          await sleep(280 + Math.floor(Math.random() * 160));
        }

        let actors = (javMeta && javMeta.actors && javMeta.actors.length) ? javMeta.actors.slice() : [];
        let maker = (javMeta && javMeta.maker) || (cached && cached.maker) || '';
        let title = (javMeta && javMeta.title) || (cached && cached.title) || '';

        // 若 JAVDB 未标出女优（例如无码条目、限流或素人企划片如 HAWA-389），依次穿透 JavBus 与 AV-Wiki 素人百科！
        let allTried = false;
        if (wantActors && !actors.length) {
          const jb = await fetchFromJavBus(norm);
          if (jb) {
            if (jb.actors && jb.actors.length) actors = jb.actors;
            if (!maker && jb.maker) maker = jb.maker;
            if (!title && jb.title) title = jb.title;
          }
          if (!actors.length) {
            const aw = await fetchFromAvWiki(norm);
            if (aw) {
              if (aw.actors && aw.actors.length) actors = aw.actors;
              if (!dmmCover && aw.dmmCid) {
                const u2 = dmmCoverUrl(aw.dmmCid);
                if (await probeImageValid(u2)) {
                  dmmCover = u2;
                  dmmThumbs = dmmSampleUrls(aw.dmmCid, 10);
                }
              }
            }
          }
          allTried = true;
        }

        // DMM CDN (awsimgsrc.dmm.co.jp) 在 115.com 跨域环境下零防盗链、零 403，优先采用其 800px 封面与剧照；无 DMM 时再用 JAVDB 图床兜底
        const merged = {
          code: norm,
          cover: dmmCover || (javMeta && javMeta.cover) || (cached && cached.cover) || '',
          thumbs: dmmThumbs.length ? dmmThumbs : ((javMeta && javMeta.thumbs && javMeta.thumbs.length) ? javMeta.thumbs : ((cached && cached.thumbs) || [])),
          title: title,
          score: (javMeta && javMeta.score) || (cached && cached.score) || '',
          date: (javMeta && javMeta.date) || (cached && cached.date) || '',
          actors: actors,
          maker: maker,
          series: (javMeta && javMeta.series) || (cached && cached.series) || '',
          detailUrl: (javMeta && javMeta.detailUrl) || (cached && cached.detailUrl) || (getConf().javdbHost + '/search?q=' + encodeURIComponent(norm)),
          _detailFetched: wantActors,
          _v110Actors: wantActors,
          _allSourcesTried: allTried
        };

        if (merged.cover || merged.title || merged.actors.length) {
          await MetaDB.put(merged);
        }
        return merged;
      })().finally(function () {
        inflight.delete(norm);
      });

      inflight.set(norm, jobPromise);
      return jobPromise;
    }

    function pump() {
      while (activeWorkers < MAX_CONCURRENCY && queue.length > 0) {
        const task = queue.shift();
        if (!task || task.cancelled) continue;
        activeWorkers++;
        resolveMeta(task.code, task.opts).then(function (res) {
          if (!task.cancelled && typeof task.onDone === 'function') task.onDone(res);
        }).catch(function () {
          if (!task.cancelled && typeof task.onDone === 'function') task.onDone(null);
        }).finally(function () {
          activeWorkers--;
          pump();
        });
      }
    }

    function enqueueViewportCard(code, opts, onDone) {
      const handle = { code: code, opts: opts || {}, onDone: onDone, cancelled: false };
      queue.push(handle);
      pump();
      return {
        cancel: function () { handle.cancelled = true; }
      };
    }

    return { resolveMeta: resolveMeta, enqueueViewportCard: enqueueViewportCard };
  })();

  /* =========================================================================
   * 五、115 WebAPI 核心接口与免 Cookie 原画串流引擎
   * ======================================================================= */
  const Api115 = (function () {
    const streamCache = new Map();

    function safeJsonParse(rawText, label) {
      const txt = String(rawText || '').trim();
      if (!txt) return {};
      if (txt.charAt(0) === '<') {
        throw new Error((label || '115 接口') + '返回了非 JSON 页面（请确认已登录 115 且会话未过期）');
      }
      try {
        return JSON.parse(txt);
      } catch (e) {
        throw new Error((label || '115 接口') + '响应解析失败');
      }
    }

    // 穿透顶层 URL 与 iframe[name="wangpan"] 实时感知当前浏览的目录 CID
    function detectActiveCid() {
      try {
        const frames = document.querySelectorAll('iframe[name="wangpan"], iframe#js_center_main_box, iframe[src*="ct=file"]');
        for (let i = 0; i < frames.length; i++) {
          try {
            const cw = frames[i].contentWindow;
            if (cw && cw.location && cw.location.href) {
              const u = new URL(cw.location.href);
              const fCid = u.searchParams.get('cid');
              if (fCid !== null && fCid !== '') return fCid;
            }
          } catch (e) {}
        }
      } catch (e) {}
      try {
        const topUrl = new URL(window.location.href);
        const cid = topUrl.searchParams.get('cid');
        if (cid !== null && cid !== '') return cid;
        const hashMatch = (window.location.hash || '').match(/cid=(\d+)/);
        if (hashMatch) return hashMatch[1];
      } catch (e) {}
      return '0';
    }

    function mapItem(it) {
      const isFile = Boolean(it && it.fid);
      const name = String((it && (it.n || it.file_name)) || '');
      const size = Number((it && it.s != null) ? it.s : ((it && it.size) || 0));
      const pickcode = String((it && (it.pc || it.pick_code || it.video_id)) || '');
      const ext = (name.match(/\.([a-z0-9]{2,5})$/i) || ['', String((it && it.ico) || '')])[1].toLowerCase();
      const isVideo = isFile && Boolean((it && it.iv === 1) || /^(mp4|mkv|avi|wmv|mov|ts|m2ts|iso|flv|webm|rmvb|m4v)$/i.test(ext));
      const isSub = isFile && /^(srt|ass|ssa|vtt|sub|idx)$/i.test(ext);
      const code = extractCode(name);
      return {
        id: String(isFile ? it.fid : ((it && it.cid) || '')),
        fid: isFile ? String(it.fid) : '',
        cid: String(isFile ? (it.cid || '0') : ((it && it.cid) || '')),
        parentCid: String(isFile ? (it.cid || '0') : ((it && (it.pid || '0')) || '0')),
        name: name,
        size: isNaN(size) ? 0 : size,
        pickcode: pickcode,
        ext: ext,
        dir: !isFile && Boolean(it && it.cid),
        isFile: isFile,
        isVideo: isVideo,
        isSub: isSub,
        duration: Number((it && it.play_long) || 0),
        thumb115: String((it && it.u) || ''),
        code: code
      };
    }

    // 跨分页全量读取指定目录（彻底突破单页几十条限制，支持千部大目录）
    async function listDirAll(cid, maxItems, onProgress) {
      const targetCid = String(cid || '0').trim() || '0';
      const limit = 200;
      const cap = maxItems || 1600;
      let offset = 0;
      let all = [];
      let pathInfo = [];
      let totalCount = 0;

      while (offset < cap) {
        const url = 'https://webapi.115.com/files?aid=1&cid=' + encodeURIComponent(targetCid) +
          '&offset=' + offset + '&limit=' + limit + '&show_dir=1&o=user_ptime&asc=0&natsort=1&format=json';
        const r = await gmReq({
          url: url,
          timeout: 15000,
          headers: { 'Accept': 'application/json', 'Referer': 'https://115.com/' }
        });
        let j = safeJsonParse(r.responseText, '读取目录');
        // 某些排序参数在特殊目录下若触发 errNo=20130827，自动退回默认 file_name 排序
        if (j.state === false && offset === 0) {
          const fallbackUrl = 'https://webapi.115.com/files?aid=1&cid=' + encodeURIComponent(targetCid) +
            '&offset=0&limit=' + limit + '&show_dir=1&o=file_name&asc=1&format=json';
          const r2 = await gmReq({ url: fallbackUrl, timeout: 15000, headers: { 'Accept': 'application/json', 'Referer': 'https://115.com/' } });
          j = safeJsonParse(r2.responseText, '读取目录');
        }
        if (j.state === false && j.errNo !== 0) {
          throw new Error(j.error || j.error_msg || '读取 115 目录失败（请确认已登录 115）');
        }
        if (Array.isArray(j.path) && j.path.length) pathInfo = j.path;
        totalCount = Number(j.count || 0);
        const batch = (j.data || []).map(mapItem);
        all = all.concat(batch);
        if (typeof onProgress === 'function') onProgress(all.length, totalCount || all.length);
        if (!batch.length || all.length >= totalCount || batch.length < limit) break;
        offset += batch.length;
        await sleep(160);
      }
      return { cid: targetCid, items: all, count: totalCount || all.length, path: pathInfo };
    }

    // 针对「番号独立子文件夹」（如 SSIS-858-LTX），按需钻取内部最大的正片视频用于一键直播
    async function findMainVideoInDir(dirCid) {
      const res = await listDirAll(dirCid, 80);
      const vids = res.items.filter(function (x) { return x.isVideo && x.pickcode; })
        .sort(function (a, b) { return b.size - a.size; });
      return vids[0] || null;
    }

    // 115 视频流 CDN (cpats01.115.com) 带 se=u,ua 参数：流签名强绑定发起 m3u8 请求时的 User-Agent！
    // 原生 IINA / mpv 默认发送 User-Agent: libmpv；因此请求 m3u8 时必须用 GM_xmlhttpRequest 携带同款 User-Agent 签名
    function targetUaForPlayer(playerMode) {
      const conf = getConf();
      if (conf.playerUA) return conf.playerUA;
      if (conf.useBrowserUA) return navigator.userAgent;
      const m = String(playerMode || 'iina').toLowerCase();
      if (m === 'iina' || m === 'mpv') return 'libmpv';
      if (m === 'vlc') return 'VLC/3.0.21 LibVLC/3.0.21';
      if (m === 'potplayer') return 'Lavf/60.16.100';
      return navigator.userAgent;
    }

    function buildSafeIinaUaCmd(rawUa) {
      // 转义 mpv.conf 双引号值中的反斜杠与双引号，再以 POSIX 单引号安全转义嵌入 printf '%s'，
      // 彻底免疫单引号注入、sed 分隔符 (| / &) 损坏与 printf % 格式化注入，并通过临时文件原子替换 mpv.conf
      const mpvVal = String(rawUa || '').replace(/[\r\n]+/g, ' ').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const shSingle = "'" + mpvVal.replace(/'/g, "'\\''") + "'";
      return 'd="$HOME/Library/Application Support/com.colliderli.iina"; f="$d/mpv.conf"; mkdir -p "$d" && { [ -f "$f" ] && grep -v "^user-agent=" "$f" || true; printf \'user-agent="%s"\\n\' ' + shSingle + '; } > "$f.tmp" && mv "$f.tmp" "$f"';
    }

    function showIinaUaSetupModal(streamUrl) {
      const old = document.getElementById('f115-ua-helper');
      if (old) old.remove();
      const cmd = buildSafeIinaUaCmd(navigator.userAgent);
      const mask = document.createElement('div');
      mask.id = 'f115-ua-helper';
      mask.className = 'f115-modal-mask';
      mask.innerHTML =
        '<div class="f115-modal" style="width:min(620px,94vw);">' +
          '<div class="f115-modal-head">' +
            '<div style="font-size:15px;font-weight:750;">⚠️ 检测到浏览器扩展拦截了自定义 UA（IINA 首次配对指引）</div>' +
            '<button type="button" class="f115-btn" data-ua-close>✕</button>' +
          '</div>' +
          '<div class="f115-modal-body" style="display:flex;flex-direction:column;gap:12px;font-size:13px;line-height:1.6;">' +
            '<div>115 视频流带有 <code>se=u,ua</code> 校验（要求播放器 UA 与签名时一致）。当前浏览器扩展未放行 <code>libmpv</code> 请求头重写，导致直链被绑定到了你的浏览器 UA。</div>' +
            '<div style="padding:10px 12px;border-radius:10px;background:rgba(10,132,255,.12);border:1px solid rgba(10,132,255,.3);">只需打开 macOS「终端 (Terminal)」粘贴运行下方一行命令（一劳永逸将 IINA 默认 UA 同步为当前浏览器 UA，重启一次 IINA 即可永久秒播）：</div>' +
            '<textarea class="f115-inp" readonly style="width:100%;height:74px;font-family:ui-monospace,SFMono-Regular,monospace;font-size:11.5px;">' + escHtml(cmd) + '</textarea>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end;">' +
              '<button type="button" class="f115-btn" data-ua-vod>改用 115 网页云播</button>' +
              '<button type="button" class="f115-btn f115-btn-primary" data-ua-copy>📋 一键复制终端命令并标记已完成</button>' +
            '</div>' +
          '</div>' +
        '</div>';
      document.body.appendChild(mask);
      mask.querySelector('[data-ua-close]').addEventListener('click', function () { mask.remove(); });
      mask.querySelector('[data-ua-vod]').addEventListener('click', function () {
        mask.remove();
        if (streamUrl && streamUrl._pickcode) {
          window.open('https://115vod.com/?pickcode=' + encodeURIComponent(streamUrl._pickcode) + '&share_id=0', '_blank', 'noopener');
        }
      });
      mask.querySelector('[data-ua-copy]').addEventListener('click', function () {
        GM_setClipboard(cmd);
        setConf(CONF_KEYS.useBrowserUA, true);
        mask.remove();
        toast('✅ 已复制终端命令！在终端粘贴回车并重启一次 IINA 后即可永久秒播', true);
      });
    }

    async function resolveSignedM3u8(pickcode, playerMode) {
      const pc = String(pickcode || '').trim();
      if (!pc) throw new Error('缺少 pickcode');
      const ua = targetUaForPlayer(playerMode);
      const cacheKey = pc + '|' + ua;
      if (streamCache.has(cacheKey)) {
        const hit = streamCache.get(cacheKey);
        if (Date.now() - hit.ts < 4 * 60 * 1000) return hit;
      }
      const r = await gmReq({
        url: 'https://115.com/api/video/m3u8/' + encodeURIComponent(pc) + '.m3u8',
        timeout: 12000,
        headers: {
          'Accept': '*/*',
          'Referer': 'https://115vod.com/',
          'User-Agent': ua
        }
      });
      const txt = String(r.responseText || '').trim();
      if (txt.indexOf('#EXTM3U') < 0) {
        throw new Error('115 暂未返回视频流（请确认已在当前浏览器登录 115 且视频已完成云端转码）');
      }
      const lines = txt.split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
      let bestUrl = '';
      let bestBw = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].indexOf('#EXT-X-STREAM-INF') === 0) {
          const m = lines[i].match(/BANDWIDTH=(\d+)/i);
          const bw = m ? parseInt(m[1], 10) : 0;
          const next = lines[i + 1] || '';
          if (/^https?:\/\//i.test(next) && bw >= bestBw) {
            bestBw = bw;
            bestUrl = next;
          }
        } else if (!bestUrl && /^https?:\/\//i.test(lines[i])) {
          bestUrl = lines[i];
        }
      }
      if (!bestUrl) throw new Error('未能解析签名串流地址');

      // 差分自检：当目标为 libmpv 时，用故意不匹配的 UA 匿名探测 cpats01；
      // 若返回 403 则 100% 证明 Tampermonkey 已成功将流签名为 libmpv；若仍返回 200 说明扩展未重写 UA（被签成了浏览器 UA）
      let uaOverrideFailed = false;
      if (ua === 'libmpv' && /se=[^&]*ua/i.test(bestUrl)) {
        try {
          const probe = await gmReq({
            url: bestUrl,
            timeout: 5000,
            anonymous: true,
            headers: { 'User-Agent': 'F115UaDifferentialProbe/1.0' }
          });
          if (probe.status === 200) uaOverrideFailed = true;
        } catch (e) {}
      }

      const entry = { ts: Date.now(), url: bestUrl, ua: ua, uaOverrideFailed: uaOverrideFailed };
      streamCache.set(cacheKey, entry);
      if (streamCache.size > 200) {
        const oldest = streamCache.keys().next().value;
        streamCache.delete(oldest);
      }
      return entry;
    }

    async function playItem(item, playerMode) {
      let target = item;
      if (item && item.dir && item.cid && !item.pickcode) {
        toast('📂 正在定位文件夹内的主视频文件…', true);
        target = await findMainVideoInDir(item.cid);
        if (!target || !target.pickcode) {
          toast('⚠️ 该文件夹内未找到可播放的视频文件', false);
          return;
        }
      }
      if (!target || !target.pickcode) {
        toast('⚠️ 缺少有效视频 pickcode', false);
        return;
      }
      const mode = playerMode || getConf().defaultPlayer || 'iina';
      if (mode === '115vod') {
        window.open('https://115vod.com/?pickcode=' + encodeURIComponent(target.pickcode) + '&share_id=0', '_blank', 'noopener');
        return;
      }
      try {
        const streamMode = mode === 'copy' ? (getConf().defaultPlayer || 'iina') : mode;
        toast('⏳ 正在获取与 ' + streamMode.toUpperCase() + ' 签名绑定的原画串流…', true);
        const resolved = await resolveSignedM3u8(target.pickcode, streamMode);
        const streamUrl = resolved.url;
        if (mode === 'copy') {
          GM_setClipboard(streamUrl);
          toast('✅ 已复制 115 签名 M3U8 直链（已绑定 UA: ' + resolved.ua + '）', true);
          return;
        }
        if ((mode === 'iina' || mode === 'mpv') && resolved.uaOverrideFailed && !getConf().useBrowserUA) {
          showIinaUaSetupModal({ _pickcode: target.pickcode });
          return;
        }
        let href = streamUrl;
        if (mode === 'iina') href = 'iina://weblink?url=' + encodeURIComponent(streamUrl);
        else if (mode === 'potplayer') href = 'potplayer://' + streamUrl;
        else if (mode === 'mpv') href = 'mpv://' + streamUrl;
        else if (mode === 'vlc') href = 'vlc://' + streamUrl;
        else if (mode === 'infuse') href = 'infuse://x-callback-url/play?url=' + encodeURIComponent(streamUrl);
        const a = document.createElement('a');
        a.href = href;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { a.remove(); }, 500);
        toast('🎬 已唤起 ' + mode.toUpperCase() + ' 播放：' + target.name, true);
      } catch (e) {
        toast('❌ 串流唤起失败：' + (e && e.message ? e.message : '未知错误'), false);
      }
    }

    // 写操作 API（均带防风控安全间隔）
    async function postForm(url, dataStr, label) {
      const r = await gmReq({
        url: url,
        method: 'POST',
        timeout: 15000,
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Origin': 'https://115.com',
          'Referer': 'https://115.com/'
        },
        data: dataStr
      });
      const j = safeJsonParse(r.responseText, label || '115 写操作');
      if (j.state === false) {
        const err = new Error((label || '操作') + '失败: ' + (j.error_msg || j.error || j.msg || '未知错误'));
        err.errNo = j.errno || j.errNo || 0;
        throw err;
      }
      return j.data !== undefined ? j.data : j;
    }

    async function mkdir(pid, cname) {
      return postForm('https://webapi.115.com/files/add', 'pid=' + encodeURIComponent(pid || '0') + '&cname=' + encodeURIComponent(cname), '新建目录');
    }
    async function ensureDirPath(baseCid, rawPath, dirCache) {
      const cache = dirCache || new Map();
      const segs = String(rawPath || '').split(/[\/\\]+/).map(function (s) {
        return s.replace(/[:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
      }).filter(Boolean);
      let curCid = String(baseCid || '0').trim() || '0';
      async function loadDirMap(parentCid, force) {
        const mapKey = '__dirmap::' + parentCid;
        if (!force && cache.has(mapKey)) return cache.get(mapKey);
        const listing = await listDirAll(parentCid, 5000);
        const byName = new Map();
        listing.items.forEach(function (x) {
          if (x.dir && x.cid && x.name && !byName.has(x.name)) byName.set(x.name, x.cid);
        });
        cache.set(mapKey, byName);
        return byName;
      }
      for (let i = 0; i < segs.length; i++) {
        const seg = segs[i];
        const key = curCid + '::' + seg;
        if (cache.has(key)) {
          curCid = cache.get(key);
          continue;
        }
        let dirMap = await loadDirMap(curCid, false);
        let foundCid = dirMap.get(seg);
        if (foundCid) {
          curCid = foundCid;
          cache.set(key, curCid);
        } else {
          await sleep(240);
          let nextCid = '';
          try {
            const mk = await mkdir(curCid, seg);
            nextCid = String((mk && (mk.cid || mk.file_id || mk.category_id || mk.id)) || '');
          } catch (e) {
            // 若目录并发已存在（errNo 20004），强制全量重刷目录定位其真实 cid
            dirMap = await loadDirMap(curCid, true);
            foundCid = dirMap.get(seg);
            if (foundCid) nextCid = foundCid;
            else throw e;
          }
          if (!nextCid || nextCid === '0') throw new Error('无法获取新建目录 CID：' + seg);
          dirMap.set(seg, nextCid);
          curCid = nextCid;
          cache.set(key, curCid);
        }
      }
      return curCid;
    }
    async function rename(fid, newName) {
      return postForm('https://webapi.115.com/files/edit', 'fid=' + encodeURIComponent(fid) + '&file_name=' + encodeURIComponent(newName), '改名');
    }
    // 关键修复：115 webapi.115.com/files/move 目标目录参数名必须为 pid（旧写 to_cid 会被 115 当作 pid=0 移进根目录！）
    // 大批量按 50 项分片提交，避免单次请求超出 115 服务端批量上限
    async function move(fids, destCid) {
      const list = (fids || []).filter(Boolean);
      if (!list.length) return null;
      const targetPid = String(destCid || '').trim();
      if (!targetPid || targetPid === '0' || !/^\d+$/.test(targetPid)) {
        throw new Error('安全拦截：目标目录 CID 无效 (' + targetPid + ')，已阻止移动到根目录');
      }
      const CHUNK = 50;
      let lastRes = null;
      for (let offset = 0; offset < list.length; offset += CHUNK) {
        const part = list.slice(offset, offset + CHUNK);
        const body = part.map(function (id, i) { return encodeURIComponent('fid[' + i + ']') + '=' + encodeURIComponent(id); })
          .concat(['pid=' + encodeURIComponent(targetPid)]).join('&');
        lastRes = await postForm('https://webapi.115.com/files/move', body, '移动');
        if (offset + CHUNK < list.length) await sleep(240);
      }
      return lastRes;
    }
    async function removeJunk(fids, parentCid) {
      const list = (fids || []).filter(Boolean);
      if (!list.length) return null;
      const CHUNK = 50;
      let lastRes = null;
      for (let offset = 0; offset < list.length; offset += CHUNK) {
        const part = list.slice(offset, offset + CHUNK);
        const body = part.map(function (id, i) { return encodeURIComponent('fid[' + i + ']') + '=' + encodeURIComponent(id); })
          .concat(parentCid ? ['pid=' + encodeURIComponent(parentCid)] : [])
          .concat(['ignore_warn=1']).join('&');
        lastRes = await postForm('https://webapi.115.com/rb/delete', body, '清理垃圾');
        if (offset + CHUNK < list.length) await sleep(240);
      }
      return lastRes;
    }

    return {
      detectActiveCid: detectActiveCid,
      listDirAll: listDirAll,
      findMainVideoInDir: findMainVideoInDir,
      resolveSignedM3u8: resolveSignedM3u8,
      playItem: playItem,
      ensureDirPath: ensureDirPath,
      rename: rename,
      move: move,
      removeJunk: removeJunk
    };
  })();

  /* =========================================================================
   * 六、智能归档与模板规则引擎（视频 + 外挂字幕同步配对 + 垃圾识别）
   * ======================================================================= */
  function isJunkFile(it) {
    if (!it || !it.isFile || it.dir) return false;
    const size = Number(it.size || 0);
    // 铁律：>= 50MB 的文件绝不判为垃圾，外挂字幕绝不判为垃圾
    if (size >= 50 * 1048576 || it.isSub) return false;
    const n = String(it.name || '').toLowerCase();
    if (size === 0) return true;
    if (/sample|preview|trailer|广告|宣传|福利|最新地址|网址|扫码|直播|美女荷官|澳门|赌场|ad[-_. ]?ver|readme|\.nfo$|\.txt$|\.url$|\.html?$|\.htm$|\.mht$|\.apk$|\.chm$|\.torrent$|\.jpg$|\.jpeg$|\.png$|\.gif$|\.bmp$/i.test(n)) return true;
    if (it.isVideo && size > 0 && size < 25 * 1048576) return true;
    return false;
  }

  function extractSuffix(name) {
    const m = String(name || '').match(/((?:-|_)(?:LTX|U|UC|UW|4K|2K|HEVC|X264|X265|FHD|HD|1080P?|720P?)[A-Za-z0-9]*)/i);
    return m ? m[1].toUpperCase() : '';
  }

  function fillTemplate(tpl, vars) {
    return String(tpl || '').replace(/\$\{(\w+)\}/g, function (_, k) {
      const v = vars[k];
      return (v === undefined || v === null) ? '' : String(v);
    }).replace(/[\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function extractPartTag(name) {
    const m = String(name || '').match(/(?:[-_.]|\b)(cd\s*[1-9]|part\s*[1-9]|disc\s*[1-9]|[1-9]of[1-9])(?=\.[a-z0-9]{2,5}$|[-_.]|$)/i);
    return m ? ('-' + m[1].replace(/\s+/g, '').toUpperCase()) : '';
  }

  function buildArchivePlanForItem(fileObj, meta, conf) {
    const code = fileObj.code || (meta && meta.code) || extractCode(fileObj.name);
    const rawBase = String(fileObj.name || '')
      .replace(/^[a-z0-9.-]+\.(?:com|net|org|me|cc|tv|xyz|info|vip|la|pw|top|club|site)@/i, '')
      .replace(/\.[a-z0-9]{2,5}$/i, '');
    const hasCnsub = /(?:[-_.]c|[-_.]ch|ch|cnsub|中字|中文字幕)(?:[-_.]|$)/i.test(rawBase);
    const realActor = (meta && meta.actors && meta.actors[0]) ? meta.actors[0] : '';
    const maker = (meta && meta.maker) ? meta.maker : '';
    const policy = (conf && conf.noActorPolicy) || 'maker_or_skip';

    // 彻底告别乱建「佚名」目录：按策略优雅处理极少数全网均无女优署名的素人作品
    let actorFolderToken = realActor;
    let skipMove = false;
    let actorStatus = realActor ? ('👩 ' + realActor) : '';
    const tplUsesActor = /\$\{actors?\}/.test((conf.dirTpl || '') + '/' + (conf.folderTpl || ''));

    if (!realActor && tplUsesActor) {
      if (policy === 'maker_or_skip') {
        if (maker) {
          actorFolderToken = maker;
          actorStatus = '🏢 片商兜底: ' + maker;
        } else {
          skipMove = true;
          actorStatus = '⚠️ 未识别女优（已自动跳过防建佚名）';
        }
      } else if (policy === 'skip') {
        skipMove = true;
        actorStatus = '⚠️ 未识别女优（暂不移动）';
      } else if (policy === 'flatten') {
        actorFolderToken = '';
        actorStatus = '📂 省略女优层';
      } else {
        actorFolderToken = '未分类女优';
        actorStatus = '📁 未分类女优';
      }
    }

    const actors = (meta && meta.actors && meta.actors.length) ? meta.actors.slice(0, 4).join(' ') : actorFolderToken;
    // 铁律：${title} 只使用真实抓取到的影片标题，绝不退回带 _restored_LTX 等杂质的原文件名！
    const cleanTitle = (meta && meta.title) ? meta.title.slice(0, 85) : '';
    const year = (meta && meta.date) ? meta.date.slice(0, 4) : '';
    const partTag = extractPartTag(fileObj.name);

    const vars = {
      code: code,
      actor: actorFolderToken,
      actors: actors,
      maker: maker,
      series: (meta && meta.series) || '',
      date: (meta && meta.date) || '',
      year: year,
      title: cleanTitle,
      raw_name: rawBase,
      cnsub: hasCnsub ? '-C' : '',
      suffix: extractSuffix(fileObj.name),
      crack: /破解|无码|uncensored|[-_]u(?:c|w)?\b/i.test(rawBase) ? '无码' : '',
      res: /4k|2160/i.test(rawBase) ? '4K' : (/1080|fhd/i.test(rawBase) ? '1080P' : '')
    };

    const extMatch = fileObj.name.match(/(\.(?:zh|chs|cht|jpn|ja|en|sc|tc|big5|gb))?\.([a-z0-9]{2,5})$/i);
    const subLang = (extMatch && fileObj.isSub && extMatch[1]) ? extMatch[1] : '';
    const ext = extMatch ? extMatch[2].toLowerCase() : fileObj.ext;
    let baseName = fillTemplate(conf.fileTpl || '${code}', vars).replace(/\//g, ' ').trim() || code || rawBase;
    if (ext && baseName.toLowerCase().endsWith('.' + ext)) {
      baseName = baseName.slice(0, -(ext.length + 1));
    }
    if (partTag && baseName.toUpperCase().indexOf(partTag) < 0) {
      baseName += partTag;
    }
    const newFileName = ext ? (baseName + subLang + '.' + ext) : baseName;
    const dirPart = fillTemplate(conf.dirTpl, vars).replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
    const folderPart = fillTemplate(conf.folderTpl, vars).replace(/^\/+|\/+$/g, '');
    const targetRelPath = skipMove ? '' : [dirPart, folderPart].filter(Boolean).join('/');

    return {
      code: code,
      actor: realActor,
      actorStatus: actorStatus,
      skipMove: skipMove,
      newFileName: newFileName,
      targetRelPath: targetRelPath
    };
  }

  // 在扩展名及字幕语言后缀（如 .zh.srt / .chs.ass）之前插入消歧序号，保留外挂字幕语言识别标签
  function appendSeqBeforeExt(fileName, seq) {
    const s = String(fileName || '');
    const m = s.match(/(\.(?:zh|chs|cht|jpn|ja|en|sc|tc|big5|gb))?(\.[a-z0-9]{2,5})$/i);
    if (m) {
      const tail = (m[1] || '') + m[2];
      return s.slice(0, s.length - tail.length) + '-' + seq + tail;
    }
    return s + '-' + seq;
  }

  // 同批次同目标目录重名防冲突消歧（例如同时存在 HAWA-389-LTX.mp4 与 HAWA-389-ltx.mp4 时，自动命名为 HAWA-389.mp4 与 HAWA-389-2.mp4；
  // 留原目录改名时同时避让源目录内既有未变更文件名，且字幕语言后缀 .zh.srt 完整保留）
  function disambiguateBatchPlans(rows, allSourceItems) {
    const usedByScope = new Map();
    const curScope = '__cur__';
    const curUsed = new Set();
    const batchFids = new Set();
    (rows || []).forEach(function (r) { if (r && r.file && r.file.fid) batchFids.add(r.file.fid); });
    (allSourceItems || []).forEach(function (it) {
      if (it && it.isFile && !batchFids.has(it.fid) && it.name) {
        curUsed.add(String(it.name).toLowerCase());
      }
    });
    usedByScope.set(curScope, curUsed);

    (rows || []).forEach(function (r) {
      if (!r || !r.plan || !r.plan.newFileName) return;
      const scope = (r.plan.targetRelPath || curScope).toLowerCase();
      if (!usedByScope.has(scope)) usedByScope.set(scope, new Set());
      const scopeSet = usedByScope.get(scope);
      let candidate = r.plan.newFileName;
      let seq = 2;
      while (scopeSet.has(candidate.toLowerCase())) {
        candidate = appendSeqBeforeExt(r.plan.newFileName, seq);
        seq++;
      }
      r.plan.newFileName = candidate;
      scopeSet.add(candidate.toLowerCase());
    });
  }

  /* =========================================================================
   * 七、Apple TV+ / tvOS 18 影院级 UI 样式系统
   * ======================================================================= */
  function injectStyles() {
    if (document.getElementById('f115-appletv-style')) return;
    const st = document.createElement('style');
    st.id = 'f115-appletv-style';
    st.textContent = [
      ':root{--f115-bg:#060609;--f115-card:rgba(28,28,34,.76);--f115-glass:rgba(30,30,38,.72);--f115-rim:rgba(255,255,255,.14);--f115-text:#f5f5f7;--f115-text2:rgba(235,235,245,.68);--f115-text3:rgba(235,235,245,.45);--f115-accent:#0a84ff;}',
      /* 右下角悬浮 tvOS 胶囊入口 */
      '#f115-dock{position:fixed;right:24px;bottom:24px;z-index:2147483500;display:inline-flex;align-items:center;gap:4px;padding:5px;border-radius:999px;background:rgba(24,24,30,.78);backdrop-filter:saturate(190%) blur(28px);-webkit-backdrop-filter:saturate(190%) blur(28px);border:.5px solid rgba(255,255,255,.18);box-shadow:0 16px 40px rgba(0,0,0,.52),inset 0 .5px 0 rgba(255,255,255,.22);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC",sans-serif;user-select:none;}',
      '#f115-dock button{border:none;background:transparent;color:#f5f5f7;padding:7px 13px;border-radius:999px;font-size:12.5px;font-weight:600;letter-spacing:-.01em;cursor:pointer;display:inline-flex;align-items:center;gap:5px;transition:background .2s ease,transform .18s ease,color .18s ease;white-space:nowrap;}',
      '#f115-dock button:hover{background:rgba(255,255,255,.12);transform:translateY(-1px);}',
      '#f115-dock button.is-primary{background:#f5f5f7;color:#09090b;font-weight:700;box-shadow:0 2px 10px rgba(0,0,0,.28);}',
      '#f115-dock button.is-primary:hover{background:#ffffff;}',

      /* 全屏 Apple TV+ 海报墙剧场层 */
      '#f115-wall-overlay{position:fixed;inset:0;z-index:2147483550;display:none;flex-direction:column;background:#060609;background-image:radial-gradient(ellipse 90% 44% at 50% -10%,rgba(42,58,96,.28),transparent 72%);color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","PingFang SC",sans-serif;-webkit-font-smoothing:antialiased;}',
      '#f115-wall-overlay.open{display:flex;}',
      '#f115-wall-overlay.is-light{background:#f5f5f7;background-image:radial-gradient(ellipse 90% 44% at 50% -10%,rgba(10,132,255,.08),transparent 72%);color:#1d1d1f;}',
      '.f115-topbar{display:flex;align-items:center;gap:12px;padding:14px 28px;background:rgba(12,12,16,.72);backdrop-filter:saturate(190%) blur(30px);-webkit-backdrop-filter:saturate(190%) blur(30px);border-bottom:.5px solid rgba(255,255,255,.1);flex-wrap:wrap;}',
      '#f115-wall-overlay.is-light .f115-topbar{background:rgba(255,255,255,.82);border-bottom-color:rgba(0,0,0,.08);}',
      '.f115-brand{display:flex;align-items:center;gap:9px;font-size:16px;font-weight:750;letter-spacing:-.02em;}',
      '.f115-brand-badge{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:999px;background:rgba(10,132,255,.18);color:#64b5ff;border:.5px solid rgba(10,132,255,.34);}',
      '.f115-crumbs{display:flex;align-items:center;gap:5px;flex-wrap:wrap;font-size:12.5px;color:rgba(235,235,245,.66);}',
      '#f115-wall-overlay.is-light .f115-crumbs{color:rgba(60,60,67,.72);}',
      '.f115-crumb{border:none;background:rgba(255,255,255,.07);color:inherit;padding:4px 10px;border-radius:999px;cursor:pointer;font-size:12px;transition:background .16s;}',
      '#f115-wall-overlay.is-light .f115-crumb{background:rgba(0,0,0,.05);}',
      '.f115-crumb:hover{background:rgba(10,132,255,.24);color:#fff;}',
      '.f115-seg{display:inline-flex;padding:3px;border-radius:999px;background:rgba(255,255,255,.07);border:.5px solid rgba(255,255,255,.1);}',
      '#f115-wall-overlay.is-light .f115-seg{background:rgba(0,0,0,.05);border-color:rgba(0,0,0,.08);}',
      '.f115-seg button{border:none;background:transparent;color:inherit;opacity:.68;padding:5px 12px;border-radius:999px;font-size:12px;font-weight:600;cursor:pointer;transition:all .18s ease;}',
      '.f115-seg button.active{opacity:1;background:#f5f5f7;color:#09090b;box-shadow:0 2px 8px rgba(0,0,0,.25);}',
      '#f115-wall-overlay.is-light .f115-seg button.active{background:#1d1d1f;color:#fff;}',
      '.f115-search{background:rgba(255,255,255,.08);border:.5px solid rgba(255,255,255,.14);border-radius:999px;color:inherit;padding:6px 14px;font-size:12.5px;outline:none;width:190px;transition:border-color .18s,width .22s;}',
      '#f115-wall-overlay.is-light .f115-search{background:rgba(0,0,0,.05);border-color:rgba(0,0,0,.12);}',
      '.f115-search:focus{border-color:#0a84ff;width:240px;}',
      '.f115-top-actions{margin-left:auto;display:flex;align-items:center;gap:8px;}',
      '.f115-btn{border:.5px solid rgba(255,255,255,.16);background:rgba(255,255,255,.08);color:inherit;padding:6px 13px;border-radius:999px;font-size:12.5px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:5px;transition:all .18s ease;white-space:nowrap;}',
      '#f115-wall-overlay.is-light .f115-btn{background:rgba(0,0,0,.05);border-color:rgba(0,0,0,.12);}',
      '.f115-btn:hover{background:rgba(255,255,255,.16);transform:translateY(-1px);}',
      '.f115-btn-primary{background:#0a84ff!important;border-color:transparent!important;color:#fff!important;}',
      '.f115-btn-primary:hover{filter:brightness(1.1);}',

      /* 海报墙网格：纯粹无框 Apple TV+ 悬浮海报卡片 */
      '.f115-wall-body{flex:1;overflow-y:auto;padding:22px 28px 60px;}',
      '.f115-status-bar{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;font-size:12.5px;opacity:.68;}',
      '.f115-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:26px 20px;}',
      '.f115-card{display:flex;flex-direction:column;min-width:0;position:relative;}',
      '.f115-poster{position:relative;aspect-ratio:16/10.6;border-radius:14px;overflow:hidden;background:linear-gradient(135deg,#14151c,#1d202b);box-shadow:0 14px 32px -8px rgba(0,0,0,.68),0 3px 8px rgba(0,0,0,.38);transition:transform .36s cubic-bezier(.22,1,.36,1),box-shadow .36s cubic-bezier(.22,1,.36,1);cursor:pointer;}',
      '#f115-wall-overlay.is-light .f115-poster{background:linear-gradient(135deg,#e5e7eb,#d1d5db);box-shadow:0 12px 28px -8px rgba(0,0,0,.18);}',
      '.f115-poster::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;box-shadow:inset 0 0 0 .5px rgba(255,255,255,.18),inset 0 1px 0 rgba(255,255,255,.24);z-index:5;}',
      '.f115-card:hover .f115-poster{transform:translateY(-5px) scale(1.028);box-shadow:0 26px 54px -10px rgba(0,0,0,.85),0 8px 20px rgba(0,0,0,.48);}',
      '.f115-poster img.f115-main-img{position:relative;z-index:2;width:100%;height:100%;object-fit:cover;display:block!important;opacity:0;transition:opacity .24s ease;}',
      '.f115-poster img.f115-main-img.is-loaded{opacity:1;}',
      '.f115-poster-fallback{position:absolute;inset:0;z-index:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;padding:14px;text-align:center;color:rgba(235,235,245,.55);font-weight:700;font-size:15px;letter-spacing:.02em;}',
      '#f115-wall-overlay.is-light .f115-poster-fallback{color:rgba(60,60,67,.65);}',

      /* 顶部光标滑动多图剧照进度槽 (Scrub Bar) */
      '.f115-scrub-bar{position:absolute;top:7px;left:9px;right:9px;z-index:7;display:flex;gap:3px;opacity:0;transition:opacity .18s ease;pointer-events:none;}',
      '.f115-poster:hover .f115-scrub-bar.has-thumbs{opacity:1;}',
      '.f115-scrub-seg{flex:1;height:2.5px;border-radius:99px;background:rgba(255,255,255,.28);overflow:hidden;}',
      '.f115-scrub-seg.active{background:#fff;box-shadow:0 0 6px rgba(255,255,255,.9);}',

      /* 封面角标与悬浮操作条 */
      '.f115-badges{position:absolute;top:13px;left:10px;z-index:6;display:flex;gap:5px;pointer-events:none;}',
      '.f115-pill{padding:2px 7px;border-radius:6px;font-size:10.5px;font-weight:700;background:rgba(12,12,16,.72);color:#f5f5f7;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:.5px solid rgba(255,255,255,.2);font-variant-numeric:tabular-nums;}',
      '.f115-pill.is-dir{background:rgba(10,132,255,.82);color:#fff;}',
      '.f115-pill.is-score{background:rgba(245,158,11,.86);color:#09090b;}',
      '.f115-hover-bar{position:absolute;left:8px;right:8px;bottom:8px;z-index:8;display:flex;align-items:center;gap:5px;opacity:0;transform:translateY(4px);transition:opacity .2s ease,transform .2s ease;}',
      '.f115-poster:hover .f115-hover-bar{opacity:1;transform:translateY(0);}',
      '.f115-act{border:.5px solid rgba(255,255,255,.26);background:rgba(16,16,22,.76);backdrop-filter:saturate(180%) blur(14px);-webkit-backdrop-filter:saturate(180%) blur(14px);color:#f5f5f7;padding:4px 9px;border-radius:999px;font-size:11px;font-weight:650;cursor:pointer;text-decoration:none;transition:background .15s,color .15s;white-space:nowrap;}',
      '.f115-act:hover{background:#ffffff;color:#09090b;border-color:transparent;}',
      '.f115-act.is-play{background:rgba(10,132,255,.88);border-color:transparent;color:#fff;}',
      '.f115-act.is-play:hover{background:#409cff;color:#fff;}',

      /* 海报下方无框信息排版 */
      '.f115-info{padding:9px 2px 0;display:flex;flex-direction:column;gap:3px;}',
      '.f115-title-row{font-size:13.5px;font-weight:550;line-height:1.35;letter-spacing:-.012em;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}',
      '.f115-code{font-weight:750;color:#64b5ff;margin-right:5px;letter-spacing:-.02em;}',
      '#f115-wall-overlay.is-light .f115-code{color:#0066cc;}',
      '.f115-sub-row{font-size:11.5px;color:rgba(235,235,245,.52);display:flex;align-items:center;gap:6px;flex-wrap:wrap;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}',
      '#f115-wall-overlay.is-light .f115-sub-row{color:rgba(60,60,67,.62);}',

      /* 剧照高清灯箱 (Lightbox) */
      '#f115-lightbox{position:fixed;inset:0;z-index:2147483620;background:rgba(4,4,8,.88);backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;color:#fff;font-family:-apple-system,BlinkMacSystemFont,sans-serif;}',
      '.f115-lb-stage{position:relative;max-width:min(1180px,92vw);max-height:74vh;display:flex;align-items:center;justify-content:center;}',
      '.f115-lb-stage img{max-width:100%;max-height:74vh;object-fit:contain;border-radius:12px;box-shadow:0 24px 64px rgba(0,0,0,.75);}',
      '.f115-lb-nav{position:absolute;top:50%;transform:translateY(-50%);width:42px;height:42px;border-radius:50%;border:.5px solid rgba(255,255,255,.25);background:rgba(24,24,30,.72);color:#fff;font-size:22px;cursor:pointer;display:flex;align-items:center;justify-content:center;}',
      '.f115-lb-nav:hover{background:#0a84ff;border-color:transparent;}',
      '.f115-lb-prev{left:-56px;}.f115-lb-next{right:-56px;}',
      '.f115-lb-strip{display:flex;gap:6px;overflow-x:auto;max-width:90vw;margin-top:14px;padding:6px;border-radius:10px;background:rgba(255,255,255,.06);}',
      '.f115-lb-strip img{width:84px;height:52px;object-fit:cover;border-radius:6px;opacity:.52;cursor:pointer;border:2px solid transparent;transition:opacity .15s;}',
      '.f115-lb-strip img.active{opacity:1;border-color:#0a84ff;}',

      /* 模态弹窗（批量自动归档 / 设置） */
      '.f115-modal-mask{position:fixed;inset:0;z-index:2147483610;background:rgba(6,6,10,.68);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);display:flex;align-items:center;justify-content:center;padding:20px;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#f5f5f7;}',
      '.f115-modal{width:min(980px,95vw);max-height:86vh;display:flex;flex-direction:column;border-radius:18px;background:rgba(24,26,33,.95);border:1px solid rgba(255,255,255,.14);box-shadow:0 28px 72px rgba(0,0,0,.72);overflow:hidden;}',
      '.f115-modal-head{display:flex;align-items:center;justify-content:space-between;padding:15px 20px;border-bottom:1px solid rgba(255,255,255,.08);}',
      '.f115-modal-body{padding:16px 20px;overflow-y:auto;flex:1;}',
      '.f115-inp{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);border-radius:9px;color:#f5f5f7;padding:7px 11px;font-size:13px;outline:none;box-sizing:border-box;}',
      '.f115-inp:focus{border-color:#0a84ff;}',
      '.f115-table{width:100%;border-collapse:collapse;font-size:12.5px;}',
      '.f115-table th,.f115-table td{padding:8px 10px;border-bottom:1px solid rgba(255,255,255,.06);text-align:left;}',
      '.f115-table th{color:rgba(235,235,245,.55);font-weight:600;position:sticky;top:0;background:#191b22;}',

      /* Toast */
      '.f115-toast{position:fixed;bottom:78px;right:26px;z-index:2147483640;padding:10px 18px;border-radius:999px;background:rgba(24,26,34,.92);border:.5px solid rgba(255,255,255,.18);backdrop-filter:blur(16px);color:#f5f5f7;font-size:13px;font-weight:600;box-shadow:0 12px 32px rgba(0,0,0,.5);opacity:0;transform:translateY(8px);transition:opacity .22s ease,transform .22s ease;font-family:-apple-system,BlinkMacSystemFont,sans-serif;}',
      '.f115-toast.show{opacity:1;transform:translateY(0);}',
      '.f115-toast.is-err{border-color:rgba(248,113,113,.5);color:#fca5a5;}'
    ].join('\n');
    (document.head || document.documentElement).appendChild(st);
  }

  /* =========================================================================
   * 八、剧照高清走马灯灯箱 (openGalleryLightbox)
   * ======================================================================= */
  function openGalleryLightbox(title, urls, startIdx) {
    if (!urls || !urls.length) {
      toast('ℹ️ 该作品暂无更多预览剧照', true);
      return;
    }
    const old = document.getElementById('f115-lightbox');
    if (old) {
      if (typeof old._close === 'function') old._close();
      else old.remove();
    }
    let idx = Math.max(0, Math.min(urls.length - 1, startIdx || 0));
    const mask = document.createElement('div');
    mask.id = 'f115-lightbox';
    mask.innerHTML =
      '<div style="display:flex;align-items:center;justify-content:space-between;width:min(1180px,92vw);margin-bottom:12px;">' +
        '<div style="font-size:14px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escHtml(title) + ' <span data-lb-idx style="opacity:.6;font-weight:500;margin-left:6px;"></span></div>' +
        '<button type="button" class="f115-btn" data-lb-close>✕ 关闭 (Esc)</button>' +
      '</div>' +
      '<div class="f115-lb-stage">' +
        '<button type="button" class="f115-lb-nav f115-lb-prev" data-lb-prev>‹</button>' +
        '<img data-lb-hero referrerpolicy="no-referrer" alt="">' +
        '<button type="button" class="f115-lb-nav f115-lb-next" data-lb-next>›</button>' +
      '</div>' +
      '<div class="f115-lb-strip">' +
        urls.map(function (u, i) {
          return '<img src="' + escAttr(u) + '" data-lb-thumb="' + i + '" referrerpolicy="no-referrer" loading="lazy" alt="">';
        }).join('') +
      '</div>';
    document.body.appendChild(mask);

    const hero = mask.querySelector('[data-lb-hero]');
    const idxEl = mask.querySelector('[data-lb-idx]');
    const thumbs = mask.querySelectorAll('[data-lb-thumb]');

    function show(next) {
      idx = (next + urls.length) % urls.length;
      hero.src = urls[idx];
      idxEl.textContent = (idx + 1) + ' / ' + urls.length;
      thumbs.forEach(function (t, i) { t.classList.toggle('active', i === idx); });
    }
    const close = function () {
      document.removeEventListener('keydown', onKey, true);
      mask.remove();
    };
    mask._close = close;
    const onKey = function (e) {
      if (e.key === 'Escape') { e.stopPropagation(); close(); }
      else if (e.key === 'ArrowLeft') { e.stopPropagation(); show(idx - 1); }
      else if (e.key === 'ArrowRight') { e.stopPropagation(); show(idx + 1); }
    };
    document.addEventListener('keydown', onKey, true);
    mask.querySelector('[data-lb-close]').addEventListener('click', close);
    mask.querySelector('[data-lb-prev]').addEventListener('click', function () { show(idx - 1); });
    mask.querySelector('[data-lb-next]').addEventListener('click', function () { show(idx + 1); });
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });
    thumbs.forEach(function (t) {
      t.addEventListener('error', function () { t.style.display = 'none'; });
      t.addEventListener('click', function () { show(parseInt(t.getAttribute('data-lb-thumb'), 10) || 0); });
    });
    show(idx);
  }

  /* =========================================================================
   * 九、Apple TV+ 海报墙剧场主视图（视口 IntersectionObserver 懒加载 + 滑动多图预览）
   * ======================================================================= */
  const PosterWall = (function () {
    let overlay = null;
    let currentCid = '0';
    let allItems = [];
    let pathCrumbs = [];
    let filterMode = 'media'; // 'media' | 'video' | 'dir' | 'all'
    let searchKw = '';
    let io = null;

    function ensureOverlay() {
      if (overlay) return overlay;
      overlay = document.createElement('div');
      overlay.id = 'f115-wall-overlay';
      if (getConf().theme === 'light') overlay.classList.add('is-light');
      overlay.innerHTML =
        '<div class="f115-topbar">' +
          '<div class="f115-brand"><span>🎬 115Fusion</span><span class="f115-brand-badge">Apple TV+ 海报墙</span></div>' +
          '<div class="f115-crumbs" data-wall-crumbs></div>' +
          '<div class="f115-seg" data-wall-seg>' +
            '<button type="button" data-mode="media" class="active">片库视图</button>' +
            '<button type="button" data-mode="video">仅视频文件</button>' +
            '<button type="button" data-mode="dir">仅文件夹</button>' +
          '</div>' +
          '<input type="search" class="f115-search" data-wall-search placeholder="搜索番号 / 标题 / 文件名…">' +
          '<div class="f115-top-actions">' +
            '<button type="button" class="f115-btn" data-wall-refresh title="重新扫描当前目录">🔄 刷新</button>' +
            '<button type="button" class="f115-btn f115-btn-primary" data-wall-archive>🧹 批量自动归档</button>' +
            '<button type="button" class="f115-btn" data-wall-theme title="切换深色 / 浅色">🌗</button>' +
            '<button type="button" class="f115-btn" data-wall-settings>⚙️ 设置</button>' +
            '<button type="button" class="f115-btn" data-wall-close>✕ 返回网盘</button>' +
          '</div>' +
        '</div>' +
        '<div class="f115-wall-body">' +
          '<div class="f115-status-bar"><span data-wall-stat>准备就绪</span><span>💡 光标在海报上左右滑动可实时预览多张剧照 · 点击播放默认唤醒本地原画播放器</span></div>' +
          '<div class="f115-grid" data-wall-grid></div>' +
        '</div>';
      document.body.appendChild(overlay);

      overlay.querySelector('[data-wall-close]').addEventListener('click', close);
      overlay.querySelector('[data-wall-refresh]').addEventListener('click', function () { loadCid(currentCid); });
      overlay.querySelector('[data-wall-archive]').addEventListener('click', function () { openBatchArchiveModal(currentCid, allItems); });
      overlay.querySelector('[data-wall-settings]').addEventListener('click', openSettingsModal);
      overlay.querySelector('[data-wall-theme]').addEventListener('click', function () {
        const isLight = overlay.classList.toggle('is-light');
        setConf(CONF_KEYS.theme, isLight ? 'light' : 'dark');
      });
      overlay.querySelectorAll('[data-wall-seg] button').forEach(function (btn) {
        btn.addEventListener('click', function () {
          filterMode = btn.getAttribute('data-mode') || 'media';
          overlay.querySelectorAll('[data-wall-seg] button').forEach(function (x) { x.classList.toggle('active', x === btn); });
          renderGrid();
        });
      });
      const sInp = overlay.querySelector('[data-wall-search]');
      sInp.addEventListener('input', function () {
        searchKw = (sInp.value || '').trim().toLowerCase();
        renderGrid();
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && overlay.classList.contains('open') && !document.getElementById('f115-lightbox') && !document.querySelector('.f115-modal-mask')) {
          close();
        }
      });
      return overlay;
    }

    function cleanupObserver() {
      if (io) {
        io.disconnect();
        io = null;
      }
      if (overlay) {
        overlay.querySelectorAll('.f115-card').forEach(function (c) {
          if (c._cancelJob) { c._cancelJob(); c._cancelJob = null; }
        });
      }
    }

    function applyMetaToCard(card, item, meta) {
      if (!card || !card.isConnected || !meta) return;
      const mainImg = card.querySelector('img.f115-main-img');
      const fallback = card.querySelector('.f115-poster-fallback');
      const scrubBar = card.querySelector('.f115-scrub-bar');
      const badges = card.querySelector('.f115-badges');
      const titleSpan = card.querySelector('[data-card-title]');
      const subRow = card.querySelector('.f115-sub-row');
      const jdbLink = card.querySelector('[data-act-jdb]');

      if (meta.cover && mainImg) {
        const markCoverReady = function () {
          mainImg.classList.add('is-loaded');
          if (fallback) fallback.style.display = 'none';
        };
        mainImg.referrerPolicy = 'no-referrer';
        mainImg.onload = markCoverReady;
        mainImg.src = meta.cover;
        if (mainImg.complete && mainImg.naturalWidth > 0) markCoverReady();
        card._baseCover = meta.cover;
      }
      if (meta.title && titleSpan) {
        titleSpan.textContent = meta.title;
      }
      if (meta.score && badges && !badges.querySelector('.is-score')) {
        const sp = document.createElement('span');
        sp.className = 'f115-pill is-score';
        sp.textContent = '★ ' + meta.score;
        badges.appendChild(sp);
      }
      if (jdbLink && meta.detailUrl) {
        jdbLink.href = meta.detailUrl;
      }
      const subParts = [];
      if (meta.actors && meta.actors.length) subParts.push('👩 ' + meta.actors.slice(0, 3).join(' · '));
      if (meta.date) subParts.push(meta.date);
      if (item.isFile) subParts.push(formatBytes(item.size));
      if (item.duration) subParts.push(formatDuration(item.duration));
      if (subParts.length && subRow) subRow.textContent = subParts.join(' · ');

      // 登记待悬停懒加载的候选剧照：首次 mouseenter 该卡片时再按原序探测，
      // 彻底避免视口滑过 50 张卡瞬间并发 500 张高清剧照请求，且保持剧照原始顺序不乱序、减少重复 DOM 重排
      if (meta.thumbs && meta.thumbs.length) {
        const rawList = [meta.cover].concat(meta.thumbs).filter(Boolean).slice(0, 11);
        card._pendingThumbUrls = rawList;
        card._thumbsProbing = false;
        card._thumbsLoaded = false;
        card._loadScrubThumbs = function () {
          if (card._thumbsProbing || card._thumbsLoaded || !card.isConnected) return;
          card._thumbsProbing = true;
          const slots = new Array(rawList.length);
          slots[0] = rawList[0];
          let remaining = rawList.length - 1;
          let paintQueued = false;
          const flushBar = function () {
            paintQueued = false;
            if (!card.isConnected || !scrubBar) return;
            const ordered = slots.filter(Boolean);
            if (ordered.length > 1) {
              card._scrubUrls = ordered;
              scrubBar.classList.add('has-thumbs');
              scrubBar.innerHTML = ordered.map(function (_, i) {
                return '<span class="f115-scrub-seg' + (i === (card._scrubIdx || 0) ? ' active' : '') + '"></span>';
              }).join('');
              card._scrubSegs = scrubBar.querySelectorAll('.f115-scrub-seg');
            }
          };
          const scheduleFlush = function () {
            if (paintQueued) return;
            paintQueued = true;
            requestAnimationFrame(flushBar);
          };
          if (remaining <= 0) {
            card._thumbsLoaded = true;
            card._thumbsProbing = false;
            return;
          }
          for (let idx = 1; idx < rawList.length; idx++) {
            (function (i, u) {
              const probe = new Image();
              probe.referrerPolicy = 'no-referrer';
              const done = function (ok) {
                if (ok && card.isConnected) {
                  slots[i] = u;
                  scheduleFlush();
                }
                remaining--;
                if (remaining <= 0) {
                  card._thumbsLoaded = true;
                  card._thumbsProbing = false;
                  if (card.isConnected) flushBar();
                }
              };
              probe.onload = function () { done(probe.naturalWidth >= 200); };
              probe.onerror = function () { done(false); };
              probe.src = u;
            })(idx, rawList[idx]);
          }
        };
      }
    }

    function renderGrid() {
      cleanupObserver();
      const grid = overlay.querySelector('[data-wall-grid]');
      const stat = overlay.querySelector('[data-wall-stat]');
      const crumbsEl = overlay.querySelector('[data-wall-crumbs]');

      crumbsEl.innerHTML = (pathCrumbs.length ? pathCrumbs : [{ name: '根目录', cid: '0' }]).map(function (p, idx, arr) {
        const cid = String(p.cid != null ? p.cid : (p.aid === 0 ? '0' : '0'));
        return '<button type="button" class="f115-crumb" data-crumb-cid="' + escAttr(cid) + '">' + escHtml(p.name || '根目录') + '</button>' +
          (idx < arr.length - 1 ? '<span style="opacity:.4;">/</span>' : '');
      }).join('');
      crumbsEl.querySelectorAll('[data-crumb-cid]').forEach(function (b) {
        b.addEventListener('click', function () { loadCid(b.getAttribute('data-crumb-cid') || '0'); });
      });

      const filtered = allItems.filter(function (it) {
        if (isJunkFile(it)) return false;
        if (filterMode === 'video' && !it.isVideo) return false;
        if (filterMode === 'dir' && !it.dir) return false;
        if (filterMode === 'media' && !it.isVideo && !it.dir) return false;
        if (searchKw) {
          const hay = (it.name + ' ' + (it.code || '')).toLowerCase();
          if (hay.indexOf(searchKw) < 0) return false;
        }
        return true;
      });

      const codeCount = filtered.filter(function (x) { return Boolean(x.code); }).length;
      stat.textContent = '当前目录共 ' + allItems.length + ' 项 · 展示 ' + filtered.length + ' 项（自动识别番号 ' + codeCount + ' 部）';

      if (!filtered.length) {
        grid.innerHTML = '<div style="grid-column:1/-1;padding:70px 20px;text-align:center;opacity:.5;font-size:14px;">当前筛选条件下暂无视频或文件夹</div>';
        return;
      }

      const defP = getConf().defaultPlayer || 'iina';
      const playBtnText = defP === '115vod' ? '▶ 云播' : ('▶ ' + defP.toUpperCase());

      grid.innerHTML = '';
      io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          const card = entry.target;
          const code = card.dataset.code || '';
          if (!code) return;
          if (entry.isIntersecting) {
            if (card.dataset.metaLoaded || card._cancelJob) return;
            const job = ArtworkEngine.enqueueViewportCard(code, {}, function (meta) {
              card._cancelJob = null;
              card.dataset.metaLoaded = '1';
              if (meta) applyMetaToCard(card, card._itemRef, meta);
            });
            card._cancelJob = job.cancel;
          } else if (card._cancelJob) {
            // 滑出视口立即取消尚未发出的排队请求，保证千部大目录丝滑零积压
            card._cancelJob();
            card._cancelJob = null;
          }
        });
      }, { root: overlay.querySelector('.f115-wall-body'), rootMargin: '280px 0px' });

      filtered.forEach(function (it) {
        const card = document.createElement('div');
        card.className = 'f115-card';
        card._itemRef = it;
        if (it.code) card.dataset.code = it.code;

        const initThumb = it.thumb115 || '';
        const host = getConf().javdbHost;
        const jdbHref = it.code ? (host + '/search?q=' + encodeURIComponent(it.code) + '&f=all') : '';

        card.innerHTML =
          '<div class="f115-poster">' +
            '<div class="f115-scrub-bar"></div>' +
            '<div class="f115-badges">' +
              (it.dir ? '<span class="f115-pill is-dir">📂 文件夹</span>' : '<span class="f115-pill">' + escHtml(formatBytes(it.size)) + '</span>') +
              (it.duration ? '<span class="f115-pill">' + escHtml(formatDuration(it.duration)) + '</span>' : '') +
            '</div>' +
            '<img class="f115-main-img' + (initThumb ? ' is-loaded' : '') + '" referrerpolicy="no-referrer"' + (initThumb ? (' src="' + escAttr(initThumb) + '"') : '') + ' alt="">' +
            '<div class="f115-poster-fallback"' + (initThumb ? ' style="display:none;"' : '') + '>' +
              '<span style="font-size:26px;">' + (it.dir ? '📁' : '🎬') + '</span>' +
              '<span>' + escHtml(it.code || it.name.slice(0, 26)) + '</span>' +
            '</div>' +
            '<div class="f115-hover-bar">' +
              ((it.isVideo || (it.dir && it.code)) ? '<button type="button" class="f115-act is-play" data-act-play>' + escHtml(playBtnText) + '</button>' : '') +
              ((it.isVideo || (it.dir && it.code)) && defP !== '115vod' ? '<button type="button" class="f115-act" data-act-vod title="115 官方网页云播">云播</button>' : '') +
              (it.dir ? '<button type="button" class="f115-act" data-act-enter>进入目录</button>' : '') +
              (it.code ? '<button type="button" class="f115-act" data-act-gallery>剧照</button>' : '') +
              (it.code ? '<a class="f115-act" data-act-jdb href="' + escAttr(jdbHref) + '" target="_blank" rel="noopener">JavDB ↗</a>' : '') +
            '</div>' +
          '</div>' +
          '<div class="f115-info">' +
            '<div class="f115-title-row">' +
              (it.code ? '<span class="f115-code">' + escHtml(it.code) + '</span>' : '') +
              '<span data-card-title>' + escHtml(it.name) + '</span>' +
            '</div>' +
            '<div class="f115-sub-row">' + escHtml(it.dir ? ('子目录 CID ' + it.cid) : (formatBytes(it.size) + (it.ext ? ' · ' + it.ext.toUpperCase() : ''))) + '</div>' +
          '</div>';

        const poster = card.querySelector('.f115-poster');
        const mainImg = card.querySelector('img.f115-main-img');
        const scrubBar = card.querySelector('.f115-scrub-bar');

        // 光标悬停懒加载剧照并缓存几何与进度槽引用，消除 mousemove 高频 getBoundingClientRect / querySelectorAll 布局抖动
        let posterRect = null;
        poster.addEventListener('mouseenter', function () {
          posterRect = poster.getBoundingClientRect();
          if (typeof card._loadScrubThumbs === 'function') card._loadScrubThumbs();
        });
        poster.addEventListener('mousemove', function (e) {
          const urls = card._scrubUrls;
          if (!urls || urls.length < 2) return;
          if (!posterRect || !posterRect.width) posterRect = poster.getBoundingClientRect();
          if (!posterRect.width) return;
          const ratio = Math.max(0, Math.min(0.999, (e.clientX - posterRect.left) / posterRect.width));
          const idx = Math.floor(ratio * urls.length);
          if (card._scrubIdx === idx) return;
          card._scrubIdx = idx;
          mainImg.src = urls[idx];
          const segs = card._scrubSegs || scrubBar.querySelectorAll('.f115-scrub-seg');
          segs.forEach(function (s, i) { s.classList.toggle('active', i === idx); });
        });
        poster.addEventListener('mouseleave', function () {
          posterRect = null;
          if (card._baseCover && card._scrubIdx !== undefined && card._scrubIdx !== 0) {
            card._scrubIdx = 0;
            mainImg.src = card._baseCover;
            const segs = card._scrubSegs || scrubBar.querySelectorAll('.f115-scrub-seg');
            segs.forEach(function (s, i) { s.classList.toggle('active', i === 0); });
          }
        });

        poster.addEventListener('click', function (e) {
          if (e.target.closest && e.target.closest('.f115-hover-bar')) return;
          if (it.dir && !it.code) loadCid(it.cid);
          else if (it.isVideo || (it.dir && it.code)) Api115.playItem(it, getConf().defaultPlayer);
        });

        const btnPlay = card.querySelector('[data-act-play]');
        if (btnPlay) btnPlay.addEventListener('click', function (e) { e.stopPropagation(); Api115.playItem(it, getConf().defaultPlayer); });
        const btnVod = card.querySelector('[data-act-vod]');
        if (btnVod) btnVod.addEventListener('click', function (e) { e.stopPropagation(); Api115.playItem(it, '115vod'); });
        const btnEnter = card.querySelector('[data-act-enter]');
        if (btnEnter) btnEnter.addEventListener('click', function (e) { e.stopPropagation(); loadCid(it.cid); });
        const btnGal = card.querySelector('[data-act-gallery]');
        if (btnGal) {
          btnGal.addEventListener('click', async function (e) {
            e.stopPropagation();
            const list = card._scrubUrls && card._scrubUrls.length > 1 ? card._scrubUrls : null;
            if (list) {
              openGalleryLightbox((it.code || '') + ' · ' + (card.querySelector('[data-card-title]').textContent || ''), list, 0);
            } else {
              toast('⏳ 正在加载高清预览剧照…', true);
              const meta = await ArtworkEngine.resolveMeta(it.code, { forceActors: true });
              const urls = meta ? [meta.cover].concat(meta.thumbs || []).filter(Boolean) : [];
              openGalleryLightbox((it.code || '') + ' · ' + ((meta && meta.title) || it.name), urls, 0);
            }
          });
        }

        grid.appendChild(card);
        if (it.code) io.observe(card);
      });
    }

    async function loadCid(cid) {
      ensureOverlay();
      currentCid = String(cid || '0').trim() || '0';
      const stat = overlay.querySelector('[data-wall-stat]');
      const grid = overlay.querySelector('[data-wall-grid]');
      stat.textContent = '⏳ 正在跨分页扫描 115 目录 CID ' + currentCid + '…';
      grid.innerHTML = '<div style="grid-column:1/-1;padding:70px 20px;text-align:center;opacity:.65;">正在读取 115 云盘目录数据…</div>';
      try {
        const res = await Api115.listDirAll(currentCid, 1600, function (loaded, total) {
          stat.textContent = '⏳ 已读取 ' + loaded + ' / ' + total + ' 项…';
        });
        allItems = res.items;
        pathCrumbs = res.path || [];
        renderGrid();
      } catch (e) {
        stat.textContent = '❌ 读取失败：' + e.message;
        grid.innerHTML = '<div style="grid-column:1/-1;padding:60px 20px;text-align:center;color:#fca5a5;">' + escHtml(e.message) + '</div>';
      }
    }

    function open(cid) {
      ensureOverlay();
      overlay.classList.add('open');
      loadCid(cid != null ? cid : Api115.detectActiveCid());
    }

    function close() {
      cleanupObserver();
      if (overlay) overlay.classList.remove('open');
    }

    return { open: open, close: close, reload: function () { if (overlay && overlay.classList.contains('open')) loadCid(currentCid); } };
  })();

  /* =========================================================================
   * 十、存量番号视频批量自动整理归档面板（三源女优识别 + 纯番号规范改名 + 防移根目录保护）
   * ======================================================================= */
  async function openBatchArchiveModal(cid, preloadedItems) {
    const old = document.querySelector('.f115-modal-mask');
    if (old) old.remove();
    const targetCid = String(cid != null ? cid : Api115.detectActiveCid()) || '0';
    const conf = getConf();

    const mask = document.createElement('div');
    mask.className = 'f115-modal-mask';
    mask.innerHTML =
      '<div class="f115-modal" style="width:min(1060px,96vw);">' +
        '<div class="f115-modal-head">' +
          '<div style="font-size:15.5px;font-weight:750;">🧹 115 智能番号整理与归档器 <span style="font-size:12px;opacity:.55;font-weight:500;">当前源 CID ' + escHtml(targetCid) + '</span></div>' +
          '<button type="button" class="f115-btn" data-m-close>✕ 关闭</button>' +
        '</div>' +
        '<div class="f115-modal-body">' +
          '<div style="display:grid;grid-template-columns:1fr .85fr 1.15fr;gap:10px;margin-bottom:10px;">' +
            '<div><div style="font-size:11.5px;opacity:.68;margin-bottom:4px;">归档主目录模板</div><input class="f115-inp" data-tpl-dir value="' + escAttr(conf.dirTpl) + '" style="width:100%;" placeholder="云下载/${actor}"></div>' +
            '<div><div style="font-size:11.5px;opacity:.68;margin-bottom:4px;">影片子目录模板（留空不建子目录）</div><input class="f115-inp" data-tpl-folder value="' + escAttr(conf.folderTpl) + '" style="width:100%;" placeholder="${code}"></div>' +
            '<div>' +
              '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px;">' +
                '<span style="font-size:11.5px;opacity:.68;">视频/字幕改名模板（默认纯番号）</span>' +
                '<span style="display:inline-flex;gap:4px;">' +
                  '<button type="button" class="f115-btn" data-preset="${code}" style="padding:1px 7px;font-size:10.5px;">纯番号</button>' +
                  '<button type="button" class="f115-btn" data-preset="${code}${cnsub}" style="padding:1px 7px;font-size:10.5px;">+中字</button>' +
                  '<button type="button" class="f115-btn" data-preset="${code} ${actor}" style="padding:1px 7px;font-size:10.5px;">+女优</button>' +
                '</span>' +
              '</div>' +
              '<input class="f115-inp" data-tpl-file value="' + escAttr(conf.fileTpl) + '" style="width:100%;" placeholder="${code}">' +
            '</div>' +
          '</div>' +
          '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px;">' +
            '<label style="font-size:12.5px;display:inline-flex;align-items:center;gap:6px;cursor:pointer;"><input type="checkbox" data-chk-junk ' + (conf.cleanJunk ? 'checked' : '') + '> 顺带清理 <50MB 广告/垃圾</label>' +
            '<label style="font-size:12.5px;display:inline-flex;align-items:center;gap:6px;"><span>无女优片处理：</span>' +
              '<select class="f115-inp" data-no-actor style="padding:4px 8px;font-size:12px;">' +
                '<option value="maker_or_skip"' + (conf.noActorPolicy === 'maker_or_skip' ? ' selected' : '') + '>片商名兜底，无片商则跳过（绝不建佚名）</option>' +
                '<option value="skip"' + (conf.noActorPolicy === 'skip' ? ' selected' : '') + '>暂不移动（留在原目录）</option>' +
                '<option value="flatten"' + (conf.noActorPolicy === 'flatten' ? ' selected' : '') + '>省略女优层（如 云下载/HAWA-389）</option>' +
                '<option value="unclassified"' + (conf.noActorPolicy === 'unclassified' ? ' selected' : '') + '>归入「未分类女优」目录</option>' +
              '</select>' +
            '</label>' +
            '<button type="button" class="f115-btn" data-btn-enrich title="强制穿透 JAVDB + JavBus + AV-Wiki 素人库重查女优">🔍 重新穿透识别女优</button>' +
            '<button type="button" class="f115-btn" data-btn-preview>🔄 刷新预览</button>' +
            '<button type="button" class="f115-btn f115-btn-primary" data-btn-exec style="margin-left:auto;">⚡ 开始安全节流归档</button>' +
          '</div>' +
          '<div data-arc-log style="font-size:12.5px;padding:8px 12px;border-radius:9px;background:rgba(255,255,255,.05);margin-bottom:10px;">正在扫描目录并自动识别番号与女优…</div>' +
          '<div style="max-height:47vh;overflow:auto;border:1px solid rgba(255,255,255,.08);border-radius:10px;" data-arc-table-wrap></div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(mask);

    let closed = false;
    const close = function () { closed = true; mask.remove(); };
    mask.querySelector('[data-m-close]').addEventListener('click', close);
    mask.addEventListener('click', function (e) { if (e.target === mask) close(); });

    const logEl = mask.querySelector('[data-arc-log]');
    const tableWrap = mask.querySelector('[data-arc-table-wrap]');
    let items = preloadedItems && preloadedItems.length ? preloadedItems.slice() : [];
    let rows = [];

    mask.querySelectorAll('[data-preset]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        mask.querySelector('[data-tpl-file]').value = btn.getAttribute('data-preset') || '${code}';
        buildPreview(false);
      });
    });
    mask.querySelector('[data-no-actor]').addEventListener('change', function () { buildPreview(false); });

    if (!items.length) {
      try {
        const res = await Api115.listDirAll(targetCid, 1000);
        items = res.items;
      } catch (e) {
        logEl.textContent = '❌ 读取目录失败：' + e.message;
        return;
      }
    }

    async function enrichMissingCodes(forceRefresh) {
      const codes = [];
      items.forEach(function (f) {
        if (f.isFile && !isJunkFile(f) && (f.isVideo || f.isSub) && f.code && codes.indexOf(f.code) < 0) {
          codes.push(f.code);
        }
      });
      for (let i = 0; i < codes.length; i++) {
        if (closed) return;
        const c = codes[i];
        const cached = await MetaDB.get(c);
        if (!forceRefresh && cached && cached._v110Actors && ((cached.actors && cached.actors.length) || cached._allSourcesTried)) {
          continue;
        }
        logEl.textContent = '🔍 正在三源联查女优元数据 (' + (i + 1) + '/' + codes.length + ')：' + c + '（JAVDB → JavBus → AV-Wiki 素人库）…';
        const resolved = await ArtworkEngine.resolveMeta(c, { forceActors: true });
        if (resolved && resolved.actors && resolved.actors.length) {
          logEl.textContent = '✅ 已识别 ' + c + ' → ' + resolved.actors[0];
        }
      }
    }

    async function buildPreview(autoFetchMissing) {
      const curConf = {
        dirTpl: mask.querySelector('[data-tpl-dir]').value.trim(),
        folderTpl: mask.querySelector('[data-tpl-folder]').value.trim(),
        fileTpl: mask.querySelector('[data-tpl-file]').value.trim() || '${code}',
        noActorPolicy: mask.querySelector('[data-no-actor]').value,
        cleanJunk: mask.querySelector('[data-chk-junk]').checked
      };
      setConf(CONF_KEYS.dirTpl, curConf.dirTpl);
      setConf(CONF_KEYS.folderTpl, curConf.folderTpl);
      setConf(CONF_KEYS.fileTpl, curConf.fileTpl);
      setConf(CONF_KEYS.noActorPolicy, curConf.noActorPolicy);
      setConf(CONF_KEYS.cleanJunk, curConf.cleanJunk);

      const needMeta = /\$\{(?:actors?|maker|series|title|year|date)\}/.test(curConf.dirTpl + ' ' + curConf.folderTpl + ' ' + curConf.fileTpl);
      if (autoFetchMissing && needMeta) {
        await enrichMissingCodes(false);
      }
      if (closed) return;

      rows = [];
      const junkList = items.filter(isJunkFile);
      const candidates = items.filter(function (f) { return f.isFile && !isJunkFile(f) && (f.isVideo || f.isSub) && f.code; });

      for (let i = 0; i < candidates.length; i++) {
        const f = candidates[i];
        const meta = await MetaDB.get(f.code);
        const plan = buildArchivePlanForItem(f, meta, curConf);
        rows.push({ file: f, meta: meta, plan: plan, checked: !plan.skipMove });
      }
      disambiguateBatchPlans(rows, items);

      const readyCount = rows.filter(function (r) { return r.checked; }).length;
      const skippedCount = rows.length - readyCount;
      logEl.textContent = '共扫描带番号视频/字幕 ' + rows.length + ' 项：已就绪 ' + readyCount + ' 项' +
        (skippedCount ? (' · 未识别女优自动暂缓 ' + skippedCount + ' 项（可在下方表格直接手填目标目录后勾选）') : '') +
        (curConf.cleanJunk ? (' · 待清垃圾 ' + junkList.length + ' 项') : '');

      if (!rows.length && (!curConf.cleanJunk || !junkList.length)) {
        tableWrap.innerHTML = '<div style="padding:36px;text-align:center;opacity:.5;">当前目录下没有散落的番号视频文件（若视频已在子文件夹内，可进入对应目录再整理）</div>';
        return;
      }

      tableWrap.innerHTML =
        '<table class="f115-table">' +
          '<thead><tr><th style="width:34px;"><input type="checkbox" data-chk-all checked></th><th>番号 / 识别女优</th><th>原文件名</th><th>改名后文件名（可直接微调）</th><th>目标归档目录（可直接手填修正）</th></tr></thead>' +
          '<tbody>' +
            rows.map(function (r, idx) {
              return '<tr>' +
                '<td><input type="checkbox" data-row-idx="' + idx + '"' + (r.checked ? ' checked' : '') + '></td>' +
                '<td style="white-space:nowrap;">' +
                  '<div style="font-weight:700;color:#64b5ff;">' + escHtml(r.plan.code) + '</div>' +
                  '<div style="font-size:11px;opacity:.75;">' + escHtml(r.plan.actorStatus || '—') + '</div>' +
                '</td>' +
                '<td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + escAttr(r.file.name) + '">' + escHtml(r.file.name) + '</td>' +
                '<td><input class="f115-inp" data-edit-name="' + idx + '" value="' + escAttr(r.plan.newFileName) + '" style="width:100%;padding:4px 8px;font-size:12px;color:#86efac;"></td>' +
                '<td><input class="f115-inp" data-edit-path="' + idx + '" value="' + escAttr(r.plan.targetRelPath) + '" placeholder="留空=仅改名不移动" style="width:100%;padding:4px 8px;font-size:12px;color:#fcd34d;"></td>' +
              '</tr>';
            }).join('') +
          '</tbody>' +
        '</table>';

      const chkAll = tableWrap.querySelector('[data-chk-all]');
      if (chkAll) {
        chkAll.addEventListener('change', function () {
          tableWrap.querySelectorAll('[data-row-idx]').forEach(function (cb) {
            cb.checked = chkAll.checked;
            rows[parseInt(cb.getAttribute('data-row-idx'), 10)].checked = cb.checked;
          });
        });
      }
      tableWrap.querySelectorAll('[data-row-idx]').forEach(function (cb) {
        cb.addEventListener('change', function () {
          rows[parseInt(cb.getAttribute('data-row-idx'), 10)].checked = cb.checked;
        });
      });
      tableWrap.querySelectorAll('[data-edit-name]').forEach(function (inp) {
        inp.addEventListener('input', function () {
          rows[parseInt(inp.getAttribute('data-edit-name'), 10)].plan.newFileName = inp.value.trim();
        });
      });
      tableWrap.querySelectorAll('[data-edit-path]').forEach(function (inp) {
        inp.addEventListener('input', function () {
          const i = parseInt(inp.getAttribute('data-edit-path'), 10);
          rows[i].plan.targetRelPath = inp.value.trim().replace(/^\/+|\/+$/g, '');
          if (rows[i].plan.targetRelPath && !rows[i].checked) {
            rows[i].checked = true;
            const cb = tableWrap.querySelector('[data-row-idx="' + i + '"]');
            if (cb) cb.checked = true;
          }
        });
      });
    }

    mask.querySelector('[data-btn-preview]').addEventListener('click', function () { buildPreview(false); });
    mask.querySelector('[data-btn-enrich]').addEventListener('click', async function () {
      const btn = mask.querySelector('[data-btn-enrich]');
      btn.disabled = true;
      await enrichMissingCodes(true);
      btn.disabled = false;
      await buildPreview(false);
    });

    mask.querySelector('[data-btn-exec]').addEventListener('click', async function () {
      const execBtn = mask.querySelector('[data-btn-exec]');
      execBtn.disabled = true;
      const doClean = mask.querySelector('[data-chk-junk]').checked;
      const junkList = items.filter(isJunkFile);
      const selected = rows.filter(function (r) { return r.checked; });
      const dirCache = new Map();
      let cleaned = 0, renamed = 0, moved = 0, failed = 0;
      let lastErr = '';

      try {
        if (doClean && junkList.length) {
          logEl.textContent = '🧹 正在清理 ' + junkList.length + ' 个垃圾广告文件…';
          await Api115.removeJunk(junkList.map(function (x) { return x.fid; }), targetCid);
          cleaned = junkList.length;
          await sleep(280);
        }

        // 先按目标目录分组移动到目标目录，再在目标目录内执行改名：
        // 彻底避免源目录中既有同名文件拦截就地改名，也避免改名失败后把未改名文件误移走
        const moveGroups = new Map();
        const readyToRename = [];
        for (let i = 0; i < selected.length; i++) {
          const r = selected[i];
          const rel = String(r.plan.targetRelPath || '').trim().replace(/^\/+|\/+$/g, '');
          if (rel) {
            if (!moveGroups.has(rel)) moveGroups.set(rel, []);
            moveGroups.get(rel).push(r);
          } else {
            readyToRename.push(r);
          }
        }

        for (const entry of moveGroups.entries()) {
          const relPath = entry[0];
          const groupRows = entry[1];
          const fids = groupRows.map(function (r) { return r.file.fid; });
          logEl.textContent = '📂 正在定位目标目录并移入：' + relPath + ' (' + fids.length + ' 项)…';
          const rootBase = (relPath.indexOf('/') >= 0 || relPath.indexOf('云下载') === 0) ? '0' : targetCid;
          try {
            const destCid = await Api115.ensureDirPath(rootBase, relPath, dirCache);
            if (destCid && destCid !== '0' && destCid !== targetCid) {
              await sleep(240);
              await Api115.move(fids, destCid);
              moved += fids.length;
              groupRows.forEach(function (r) { readyToRename.push(r); });
            } else {
              groupRows.forEach(function (r) { readyToRename.push(r); });
            }
          } catch (e) {
            failed += groupRows.length;
            lastErr = e.message;
          }
        }

        for (let i = 0; i < readyToRename.length; i++) {
          const r = readyToRename[i];
          if (!r.plan.newFileName || r.plan.newFileName === r.file.name) continue;
          logEl.textContent = '✏️ 正在规范改名 (' + (i + 1) + '/' + readyToRename.length + ')：' + r.file.name + ' → ' + r.plan.newFileName + '…';
          let targetName = r.plan.newFileName;
          let ok = false;
          for (let attempt = 0; attempt < 5; attempt++) {
            try {
              await Api115.rename(r.file.fid, targetName);
              r.file.name = targetName;
              r.plan.newFileName = targetName;
              renamed++;
              ok = true;
              await sleep(260);
              break;
            } catch (e) {
              const msg = String((e && e.message) || '');
              const isDup = /已存在|重名|同名|exists/i.test(msg) || Number(e && e.errNo) === 20004 || Number(e && e.errNo) === 20019;
              if (isDup && attempt < 4) {
                targetName = appendSeqBeforeExt(r.plan.newFileName, attempt + 2);
                await sleep(160);
                continue;
              }
              lastErr = msg || '改名失败';
              break;
            }
          }
          if (!ok) failed++;
        }

        logEl.textContent = '✅ 批量归档完成！清理垃圾 ' + cleaned + ' 项 · 规范改名 ' + renamed + ' 项 · 成功移入目标目录 ' + moved + ' 项' +
          (failed ? (' · 失败 ' + failed + ' 项 (' + lastErr + ')') : '');
        toast('✨ 115 批量归档完成！', failed === 0);
        PosterWall.reload();
      } catch (e) {
        logEl.textContent = '❌ 归档中断：' + e.message;
      } finally {
        execBtn.disabled = false;
      }
    });

    await buildPreview(true);
  }

  /* =========================================================================
   * 十一、设置弹窗与右下角常驻悬浮胶囊挂载
   * ======================================================================= */
  function openSettingsModal() {
    const old = document.querySelector('.f115-modal-mask');
    if (old) old.remove();
    const conf = getConf();
    const mask = document.createElement('div');
    mask.className = 'f115-modal-mask';
    mask.innerHTML =
      '<div class="f115-modal" style="width:min(580px,94vw);">' +
        '<div class="f115-modal-head">' +
          '<div style="font-size:15.5px;font-weight:750;">⚙️ 115Fusion 偏好设置</div>' +
          '<button type="button" class="f115-btn" data-s-close>✕ 关闭</button>' +
        '</div>' +
        '<div class="f115-modal-body" style="display:flex;flex-direction:column;gap:14px;">' +
          '<div>' +
            '<div style="font-size:12.5px;font-weight:650;margin-bottom:5px;">JAVDB 镜像域名（与你已登录的 VIP 镜像保持一致以共享 Cookie）</div>' +
            '<input class="f115-inp" data-s-host value="' + escAttr(conf.javdbHost) + '" style="width:100%;" placeholder="https://javdb580.com">' +
          '</div>' +
          '<div>' +
            '<div style="font-size:12.5px;font-weight:650;margin-bottom:5px;">海报点击主播放方式（自动签名对应播放器的 User-Agent 过 se=u,ua 校验）</div>' +
            '<select class="f115-inp" data-s-player style="width:100%;">' +
              '<option value="iina"' + (conf.defaultPlayer === 'iina' ? ' selected' : '') + '>IINA 原画串流 (macOS 默认 · 自动签 libmpv UA)</option>' +
              '<option value="potplayer"' + (conf.defaultPlayer === 'potplayer' ? ' selected' : '') + '>PotPlayer 原画串流 (Windows)</option>' +
              '<option value="mpv"' + (conf.defaultPlayer === 'mpv' ? ' selected' : '') + '>mpv 原画串流</option>' +
              '<option value="infuse"' + (conf.defaultPlayer === 'infuse' ? ' selected' : '') + '>Infuse 原画串流</option>' +
              '<option value="115vod"' + (conf.defaultPlayer === '115vod' ? ' selected' : '') + '>115 官方网页云播 (115vod.com)</option>' +
            '</select>' +
          '</div>' +
          '<div>' +
            '<div style="font-size:12.5px;font-weight:650;margin-bottom:5px;">自定义外部播放器 User-Agent（留空则对 IINA/mpv 自动使用 <code>libmpv</code>）</div>' +
            '<input class="f115-inp" data-s-ua value="' + escAttr(conf.playerUA) + '" style="width:100%;" placeholder="留空自动匹配；若修改过 IINA mpv.conf 的 user-agent 可填于此">' +
          '</div>' +
          '<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">' +
            '<input type="checkbox" data-s-bua ' + (conf.useBrowserUA ? 'checked' : '') + '>' +
            '<span>IINA 已配置与当前浏览器一致的 User-Agent（不重写 libmpv 请求头）</span>' +
          '</label>' +
          '<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;">' +
            '<input type="checkbox" data-s-detail ' + (conf.enrichDetail ? 'checked' : '') + '>' +
            '<span>后台节流补全 JAVDB/JavBus/AV-Wiki 标题、评分与女优（关闭则仅使用 DMM 零搜索秒开封面与剧照）</span>' +
          '</label>' +
          '<div style="display:flex;justify-content:space-between;align-items:center;padding-top:10px;border-top:1px solid rgba(255,255,255,.08);">' +
            '<button type="button" class="f115-btn" data-s-clear>🗑️ 清空本地元数据与剧照缓存</button>' +
            '<button type="button" class="f115-btn f115-btn-primary" data-s-save>保存设置</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(mask);

    mask.querySelector('[data-s-close]').addEventListener('click', function () { mask.remove(); });
    mask.addEventListener('click', function (e) { if (e.target === mask) mask.remove(); });
    mask.querySelector('[data-s-clear]').addEventListener('click', async function () {
      await MetaDB.clearAll();
      toast('✅ 已清空 IndexedDB 缓存（下次打开归档将重新三源识别女优）', true);
    });
    mask.querySelector('[data-s-save]').addEventListener('click', function () {
      const h = mask.querySelector('[data-s-host]').value.trim().replace(/\/+$/, '') || 'https://javdb580.com';
      setConf(CONF_KEYS.javdbHost, h);
      setConf(CONF_KEYS.defaultPlayer, mask.querySelector('[data-s-player]').value);
      setConf(CONF_KEYS.playerUA, mask.querySelector('[data-s-ua]').value.trim());
      setConf(CONF_KEYS.useBrowserUA, mask.querySelector('[data-s-bua]').checked);
      setConf(CONF_KEYS.enrichDetail, mask.querySelector('[data-s-detail]').checked);
      mask.remove();
      toast('✅ 设置已保存', true);
      PosterWall.reload();
    });
  }

  function mountDock() {
    if (document.getElementById('f115-dock')) return;
    // 115 播放页 115vod.com 不展示目录悬浮球
    if (/115vod\.com/i.test(location.hostname)) return;
    injectStyles();
    const dock = document.createElement('div');
    dock.id = 'f115-dock';
    dock.innerHTML =
      '<button type="button" class="is-primary" data-dock-wall title="以 Apple TV+ 海报墙浏览当前 115 目录（支持多张预览剧照滑动与本地播放器原画直连）">🎬 海报墙</button>' +
      '<button type="button" data-dock-archive title="批量扫描当前目录番号视频并自动改名归档">🧹 批量归档</button>' +
      '<button type="button" data-dock-set title="115Fusion 偏好设置">⚙️</button>';
    document.body.appendChild(dock);

    dock.querySelector('[data-dock-wall]').addEventListener('click', function () {
      PosterWall.open(Api115.detectActiveCid());
    });
    dock.querySelector('[data-dock-archive]').addEventListener('click', function () {
      openBatchArchiveModal(Api115.detectActiveCid());
    });
    dock.querySelector('[data-dock-set]').addEventListener('click', openSettingsModal);

    try {
      GM_registerMenuCommand('🎬 打开 115 Apple TV+ 海报墙', function () { PosterWall.open(Api115.detectActiveCid()); });
      GM_registerMenuCommand('🧹 批量整理归档当前 115 目录', function () { openBatchArchiveModal(Api115.detectActiveCid()); });
      GM_registerMenuCommand('⚙️ 115Fusion 设置', openSettingsModal);
    } catch (e) {}
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountDock);
  } else {
    mountDock();
  }
})();
