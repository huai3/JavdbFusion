/*
 * JavdbFusion 磁力面板增强补丁
 *   ① 多源聚合：新增 btdig / u9a9 / btsow，默认「全部聚合」一次拉全部源
 *   ② 缓存改为 per-key 存储：原先把整块缓存塞进一个 GM 键，
 *      每次读写都要对全量 JSON 做 parse/stringify（60 键 × 50 行时会到几百 KB），
 *      改为 jf_magpanel_<site>_<code> 单键存储 + 一个索引键做清理
 */
const fs = require('fs');
const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');
let applied = 0, skipped = 0;
function repx(re, newStr, label) {
  const before = src;
  src = src.replace(re, newStr);
  if (before === src) { console.log('  MISS  ' + label); skipped++; return; }
  applied++; console.log('  ok    ' + label);
}
function rep(oldStr, newStr, label) {
  const n = src.split(oldStr).length - 1;
  if (n === 0) { console.log('  MISS  ' + label); skipped++; return; }
  if (n > 1) { console.log('  AMBIG(' + n + ')  ' + label); skipped++; return; }
  src = src.replace(oldStr, newStr); applied++; console.log('  ok    ' + label);
}

console.log('== 磁力面板增强补丁 ==');

/* 1) 源列表：新增 3 个源 + 全部聚合 */
rep(
  `    const MAG_SEARCH_SITES = [
      { id: 'sukebei', name: 'Sukebei', search: 'https://sukebei.nyaa.si/?f=0&c=0_0&q={code}', icon: '🐱' },
      { id: 'bt4g', name: 'BT4G', search: 'https://bt4gprx.com/search?q={code}', icon: '🧲' }
    ];`,
  `    const MAG_SEARCH_SITES = [
      { id: 'sukebei', name: 'Sukebei', search: 'https://sukebei.nyaa.si/?f=0&c=0_0&q={code}', icon: '🐱' },
      { id: 'bt4g', name: 'BT4G', search: 'https://bt4gprx.com/search?q={code}', icon: '🧲' },
      { id: 'btdig', name: 'BTDigg', search: 'https://btdig.com/search?q={code}', icon: '🐉' },
      { id: 'u9a9', name: 'U9A9', search: 'https://u9a9.com/search?q={code}', icon: '🦊' },
      { id: 'btsow', name: 'BTSOW', search: 'https://btsow.com/search?q={code}', icon: '🐦' }
    ];
    // 「全部聚合」：并发拉所有源后合并去重（原先一次只能选一个源，谈不上"聚合"）
    const MAG_ALL_SITE = { id: 'all', name: '全部聚合', icon: '🌐' };`,
  '源列表新增 btdig/u9a9/btsow + 全部聚合'
);

/* 2) 缓存：per-key 存储 */
rep(
  `    function magPanelCacheRead() {
      try { return JSON.parse(GM_getValue('jf_magpanel_cache', '{}') || '{}'); } catch (e) { return {}; }
    }
    function magPanelCacheGet(key) {
      const c = magPanelCacheRead()[key];
      if (c && (Date.now() - c.ts) < MAG_PANEL_TTL && Array.isArray(c.rows)) return c.rows;
      return null;
    }
    function magPanelCacheSet(key, rows) {
      try {
        const c = magPanelCacheRead();
        // 简单 LRU：超过 60 个键时清最旧
        const keys = Object.keys(c);
        if (keys.length > 60) {
          keys.sort(function (a, b) { return (c[a].ts || 0) - (c[b].ts || 0); });
          keys.slice(0, keys.length - 60).forEach(function (k) { delete c[k]; });
        }
        c[key] = { ts: Date.now(), rows: rows.slice(0, 50) };
        GM_setValue('jf_magpanel_cache', JSON.stringify(c));
      } catch (e) {}
    }`,
  `    /* 缓存改为 per-key 存储。
     * 原实现把整块缓存塞进一个 GM 键（jf_magpanel_cache），
     * 每读一次都要 JSON.parse 全量、每写一次都要 JSON.stringify 全量 ——
     * 60 键 × 50 行时单次读写就是几百 KB 的序列化开销，
     * 而磁力面板在 SPA 切换番号时会连续读写多次。
     * 现在：jf_magpanel_<site>_<code> 单键存一份，jf_magpanel_index 存索引用于淘汰。 */
    const MAG_CACHE_PREFIX = 'jf_magpanel_';
    const MAG_CACHE_INDEX = 'jf_magpanel_index';
    function magPanelCacheGet(key) {
      try {
        const raw = GM_getValue(MAG_CACHE_PREFIX + key, '');
        if (!raw) return null;
        const c = JSON.parse(raw);
        if (c && (Date.now() - c.ts) < MAG_PANEL_TTL && Array.isArray(c.rows)) return c.rows;
        return null;
      } catch (e) { return null; }
    }
    function magPanelCacheSet(key, rows) {
      try {
        const payload = { ts: Date.now(), rows: rows.slice(0, 50) };
        GM_setValue(MAG_CACHE_PREFIX + key, JSON.stringify(payload));
        let idx = [];
        try { idx = JSON.parse(GM_getValue(MAG_CACHE_INDEX, '[]') || '[]'); } catch (e) { idx = []; }
        idx = idx.filter(function (k) { return k !== key; });
        idx.push(key);
        // 简单 LRU：超过 80 个键时清最旧
        while (idx.length > 80) {
          const oldest = idx.shift();
          GM_setValue(MAG_CACHE_PREFIX + oldest, '');
        }
        GM_setValue(MAG_CACHE_INDEX, JSON.stringify(idx));
      } catch (e) {}
    }`,
  '缓存改为 per-key 存储（避免全量 JSON 序列化）'
);

/* 3) fetch：支持全部聚合 */
rep(
  `    async function fetchMagnetResults(code, siteId, signal) {
      const site = MAG_SEARCH_SITES.find(function (s) { return s.id === siteId; }) || MAG_SEARCH_SITES[0];
      const cacheKey = site.id + ':' + code.toUpperCase();
      const cached = magPanelCacheGet(cacheKey);
      if (cached) return { rows: cached, fromCache: true };
      const url = site.search.replace('{code}', encodeURIComponent(code));
      const r = await gmReq({ url: url, timeout: 20000, headers: { 'Accept': 'text/html' }, signal: signal });
      const html = r.responseText || '';
      let rows = [];
      if (site.id === 'sukebei') rows = parseSukebei(html);
      else if (site.id === 'bt4g') rows = await parseBt4g(html, signal);
      magPanelCacheSet(cacheKey, rows);
      return { rows: rows, fromCache: false };
    }`,
  `    async function fetchMagnetResults(code, siteId, signal) {
      // 全部聚合：并发拉所有源，各自独立失败不影响其它源
      if (siteId === 'all') {
        const cacheKey = 'all:' + code.toUpperCase();
        const cachedAll = magPanelCacheGet(cacheKey);
        if (cachedAll) return { rows: cachedAll, fromCache: true };
        const parts = await Promise.all(MAG_SEARCH_SITES.map(function (site) {
          return fetchMagnetResults(code, site.id, signal).then(function (r) {
            return (r.rows || []).map(function (row) {
              return Object.assign({}, row, { src: site.name });
            });
          }).catch(function () { return []; });
        }));
        const merged = [];
        parts.forEach(function (p) { p.forEach(function (row) { merged.push(row); }); });
        magPanelCacheSet(cacheKey, merged);
        return { rows: merged, fromCache: false };
      }
      const site = MAG_SEARCH_SITES.find(function (s) { return s.id === siteId; }) || MAG_SEARCH_SITES[0];
      const cacheKey = site.id + ':' + code.toUpperCase();
      const cached = magPanelCacheGet(cacheKey);
      if (cached) return { rows: cached, fromCache: true };
      const url = site.search.replace('{code}', encodeURIComponent(code));
      const r = await gmReq({ url: url, timeout: 20000, headers: { 'Accept': 'text/html' }, signal: signal });
      const html = r.responseText || '';
      let rows = [];
      if (site.id === 'sukebei') rows = parseSukebei(html);
      else if (site.id === 'bt4g') rows = await parseBt4g(html, signal);
      else if (site.id === 'btdig') rows = parseBtdig(html);
      else if (site.id === 'u9a9') rows = parseU9a9(html);
      else if (site.id === 'btsow') rows = parseBtsow(html);
      magPanelCacheSet(cacheKey, rows);
      return { rows: rows, fromCache: false };
    }
    // BTDigg：表格结构与 nyaa 系接近
    function parseBtdig(html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const out = [];
      doc.querySelectorAll('tr').forEach(function (tr) {
        const a = tr.querySelector('a[href^="magnet:"]');
        if (!a) return;
        const tds = tr.querySelectorAll('td');
        const cell = function (n) { const td = tds[n]; return td ? (td.textContent || '').replace(/\\s+/g, ' ').trim() : ''; };
        out.push({ title: (a.textContent || '').trim() || cell(1), magnet: a.getAttribute('href'), size: cell(2), date: cell(3), seeds: cell(4), sizeBytes: parseSizeBytes(cell(2)), seedNum: parseInt(cell(4), 10) || 0 });
      });
      return out;
    }
    // U9A9：磁力链接在 <a class="magnet-link"> 或 a[href^="magnet:"]
    function parseU9a9(html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const out = [];
      doc.querySelectorAll('a[href^="magnet:"]').forEach(function (a) {
        const row = a.closest('tr, .row, li') || a.parentElement;
        const txt = (row && row.textContent || '').replace(/\\s+/g, ' ').trim();
        const sizeM = txt.match(/([\\d.]+\\s*(?:B|KB|MB|GB|TB))/i);
        const seedM = txt.match(/(\\d+)\\s*(?:种子|做种|seeds)/i);
        out.push({ title: txt.slice(0, 90), magnet: a.getAttribute('href'), size: sizeM ? sizeM[1] : '', date: '', seeds: seedM ? seedM[1] : '', sizeBytes: sizeM ? parseSizeBytes(sizeM[1]) : 0, seedNum: seedM ? parseInt(seedM[1], 10) || 0 : 0 });
      });
      return out;
    }
    // BTSOW：磁力链接在 <a class="b magnet-link">
    function parseBtsow(html) {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const out = [];
      doc.querySelectorAll('a[href^="magnet:"]').forEach(function (a) {
        const row = a.closest('tr') || a.parentElement;
        const tds = row ? row.querySelectorAll('td') : [];
        const cell = function (n) { const td = tds[n]; return td ? (td.textContent || '').replace(/\\s+/g, ' ').trim() : ''; };
        const size = cell(2), seeds = cell(4);
        out.push({ title: (a.textContent || '').trim() || cell(1), magnet: a.getAttribute('href'), size: size, date: cell(3), seeds: seeds, sizeBytes: parseSizeBytes(size), seedNum: parseInt(seeds, 10) || 0 });
      });
      return out;
    }`,
  'fetchMagnetResults 支持全部聚合 + 三个新源解析器'
);

/* 4) 下拉加入「全部聚合」并设为默认 */
repx(
  /(\n {12})MAG_SEARCH_SITES\.map\(function \(s\) \{/,
  `\n$1[MAG_ALL_SITE].concat(MAG_SEARCH_SITES).map(function (s) {`,
  '下拉加入「全部聚合」'
);
repx(
  /GM_getValue\('jf_mag_panel_site', 'sukebei'\)/,
  `GM_getValue('jf_mag_panel_site', 'all')`,
  '默认源改为「全部聚合」'
);
rep(
  `      function preparedRows() {
        var seen = {}, uniq = [];
        lastRows.forEach(function (r) {
          if (!r || !r.magnet) return;`,
  `      function preparedRows() {
        var seen = {}, uniq = [];
        lastRows.forEach(function (r) {
          if (!r || !r.magnet) return;
          // 聚合模式下给标题加来源前缀，让用户知道每条来自哪个站
          if (r.src && r.__tagged !== 1) {
            r.title = '[' + r.src + '] ' + r.title;
            r.__tagged = 1;
          }`,
  '聚合模式给标题加来源前缀'
);


console.log('\napplied=' + applied + '  skipped=' + skipped);
if (skipped) { console.error('⚠ 有未应用项（其余改动仍会写入）: ' + skipped); }
try { new Function(src); console.log('syntax check: OK'); } catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }
fs.writeFileSync(file, src, 'utf8');


