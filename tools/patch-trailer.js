/*
 * JavdbFusion 预告片增强补丁
 *
 * 根因（实测）：extractDmmTrailerLinks() 要求 hit.serviceCode && hit.floorCode 才返回画质表，
 * 而这两个字段只有 ItemList 搜索接口能给 —— 也就是说「按番号猜 cid」这条路径
 * 永远拿不到真实画质，只能退化成 buildDmmDirectCandidates() 的 8 条「直链候选」盲试阶梯。
 * 而实测 api.dmm.com/affiliate/v3/ItemList 在部分网络下直接返回 HTML 错误页，
 * 于是用户 90% 的场景都在看一条丑陋的候选阶梯，而不是 1080p/4K。
 *
 * 修复：
 *   1) html5_player 端点在只有 cid 时同样能返回 bitrates（实测 ssis00457 → 4k/mhb_w/dmb_w），
 *      故 service/floor 改为可选 —— 猜到的 cid 立刻能产出真实画质表。
 *   2) 直链候选阶梯：同画质 .com/.co.jp 合并为一条（另一域名降级为 alt 备用），
 *      标签改成人类可读分辨率（360p/480p/720p/1080p），不再显示 _dm_w 这种内部键名。
 *   3) 播放失败时先试 alt（另一域名）再换下一条，减少无效切换。
 *   4) 记住上次选择的画质，下次自动选中。
 */
const fs = require('fs');
const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');
let applied = 0, skipped = 0;
function rep(oldStr, newStr, label) {
  const n = src.split(oldStr).length - 1;
  if (n === 0) { console.log('  MISS  ' + label); skipped++; return; }
  if (n > 1) { console.log('  AMBIG(' + n + ')  ' + label); skipped++; return; }
  src = src.replace(oldStr, newStr); applied++; console.log('  ok    ' + label);
}

console.log('== 预告片增强补丁 ==');

/* 1) html5_player：service/floor 可选 --------------------------- */
rep(
  `    async function extractDmmTrailerLinks(hit, signal, timeoutMs) {
      if (!hit || !hit.contentId || !hit.serviceCode || !hit.floorCode) return null;
      try {
        const playerUrl = 'https://www.dmm.co.jp/service/digitalapi/-/html5_player/=/cid=' + hit.contentId +
          '/mtype=AhRVShI_/service=' + hit.serviceCode + '/floor=' + hit.floorCode + '/mode=/';`,
  `    async function extractDmmTrailerLinks(hit, signal, timeoutMs) {
      if (!hit || !hit.contentId) return null;
      try {
        // serviceCode / floorCode 只有 ItemList 搜索接口能给，而该接口在部分网络下
        // 直接返回 HTML 错误页（实测 api.dmm.com/affiliate/v3/ItemList 返回 <!doctype ...），
        // 于是「按番号猜 cid」这条路径永远拿不到真实画质。
        // 实测 html5_player 端点在只有 cid 时同样返回 bitrates
        // （ssis00457 → 4k / mhb_w / dmb_w），故这两个参数改为可选。
        const playerUrl = (hit.serviceCode && hit.floorCode)
          ? ('https://www.dmm.co.jp/service/digitalapi/-/html5_player/=/cid=' + hit.contentId +
             '/mtype=AhRVShI_/service=' + hit.serviceCode + '/floor=' + hit.floorCode + '/mode=/')
          : ('https://www.dmm.co.jp/service/digitalapi/-/html5_player/=/cid=' + hit.contentId +
             '/v=' + Math.floor(Date.now() / 1000));`,
  'html5_player：service/floor 改为可选（猜到的 cid 也能拿到真实画质）'
);

/* 2) 直链候选：同画质合并 + 可读标签 --------------------------- */
rep(
  `      const prefix = cid.slice(0, 3);
      const out = [];
      ['cc3001.dmm.com', 'cc3001.dmm.co.jp'].forEach(function (host) {
        const base = 'https://' + host + '/litevideo/freepv/' + cid[0] + '/' + prefix + '/' + cid + '/';
        // 多个画质后缀依次回退；不做 HEAD 探测，避免每个番号额外并发请求。
        // 实测并非所有画质都存在（如 lulu00095 仅 sm_w/dm_w/dmb_w/mhb_w，hhb 返回 404），
        // 因此按「低画质优先」排列，让播放器尽快命中可用的那一档。
        ['_dm_w', '_sm_w', '_dmb_w', '_mhb_w'].forEach(function (suffix) {
          out.push({
            url: base + cid + suffix + '.mp4',
            label: 'DMM 直链候选 ' + suffix,
            quality: '',
            source: 'dmm',
            unverified: true
          });
        });
      });
      return out;`,
  `      const prefix = cid.slice(0, 3);
      const out = [];
      // 画质后缀 → 人类可读分辨率。原来的 '_dm_w' 这类内部键名直接出现在下拉里，
      // 用户根本看不出是多少画质。
      const SUFFIX_TEXT = { '_dm_w': '480p', '_sm_w': '360p', '_dmb_w': '720p', '_mhb_w': '1080p' };
      // 多个画质后缀依次回退；不做 HEAD 探测，避免每个番号额外并发请求。
      // 实测并非所有画质都存在（如 lulu00095 仅 sm_w/dm_w/dmb_w/mhb_w，hhb 返回 404），
      // 因此按「低画质优先」排列，让播放器尽快命中可用的那一档。
      // 同画质的 .com / .co.jp 合并成一条（另一域名作为 alt 备用），
      // 否则下拉里会出现两份一模一样的 480p/360p/720p/1080p。
      ['_dm_w', '_sm_w', '_dmb_w', '_mhb_w'].forEach(function (suffix) {
        const q = SUFFIX_TEXT[suffix] || suffix.replace('_', '');
        const mk = function (host) {
          return 'https://' + host + '/litevideo/freepv/' + cid[0] + '/' + prefix + '/' + cid + '/' + cid + suffix + '.mp4';
        };
        out.push({
          url: mk('cc3001.dmm.com'),
          alt: mk('cc3001.dmm.co.jp'),
          label: 'DMM 直链 ' + q,
          quality: '',
          source: 'dmm',
          unverified: true
        });
      });
      return out;`,
  '直链候选：同画质合并 + 标签改为可读分辨率'
);

/* 3) 播放失败先试 alt ------------------------------------------- */
rep(
  `      video.addEventListener('error', function () {
        if (closed || !sources.length) return;
        failCount++;
        if (idx + 1 < sources.length && failCount <= sources.length) playAt(idx + 1);`,
  `      video.addEventListener('error', function () {
        if (closed || !sources.length) return;
        // 同画质的备用域名先试一次（.com 挂了就换 .co.jp），
        // 再考虑切下一条片源 —— 避免两条内容其实相同却要来回闪。
        const cur = sources[idx];
        if (cur && cur.alt && !cur.__altTried && !/\\.m3u8(\\?|#|$)/i.test(cur.url)) {
          cur.__altTried = true;
          video.referrerPolicy = 'no-referrer';
          video.src = cur.alt;
          video.load();
          const pp = video.play();
          if (pp && pp.catch) pp.catch(function () {});
          return;
        }
        failCount++;
        if (idx + 1 < sources.length && failCount <= sources.length) playAt(idx + 1);`,
  '播放失败时先试备用域名 alt'
);

/* 4) 记住上次选择的画质 ------------------------------------------ */
rep(
  `          qSelect.innerHTML = sources.map(function (s, i) {
            return '<option value="' + i + '">' + escapeHtml(s.label) + '</option>';
          }).join('');
          qSelect.value = String(selected);`,
  `          qSelect.innerHTML = sources.map(function (s, i) {
            return '<option value="' + i + '">' + escapeHtml(s.label) + '</option>';
          }).join('');
          // 记住上次选择的画质，下次打开自动选中（源列表顺序可能变化，按 label 匹配更稳）
          const lastQ = GM_getValue('jf_tr_quality', '');
          let restored = -1;
          if (lastQ) {
            for (let i = 0; i < sources.length; i++) {
              if (sources[i].label === lastQ) { restored = i; break; }
            }
          }
          qSelect.value = String(restored >= 0 ? restored : selected);`,
  '下拉：记住上次选择的画质'
);
rep(
  `      qSelect.addEventListener('change', function () { failCount = 0; playAt(Number(qSelect.value) || 0); });`,
  `      qSelect.addEventListener('change', function () {
        failCount = 0;
        const i = Number(qSelect.value) || 0;
        if (sources[i]) { try { GM_setValue('jf_tr_quality', sources[i].label); } catch (e) {} }
        playAt(i);
      });`,
  '切换画质时持久化选择'
);

console.log('\napplied=' + applied + '  skipped=' + skipped);
if (skipped) { console.error('⚠ 有未应用项（其余改动仍会写入）: ' + skipped); }
try { new Function(src); console.log('syntax check: OK'); } catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }
fs.writeFileSync(file, src, 'utf8');

