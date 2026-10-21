/*
 * JavdbFusion 预告片解析诊断反馈
 *
 * 问题：原来失败时只有一句「😔 未找到可用预告片源」/「😔 所有预告片源均播放失败」，
 * 用户分不清到底是「这个番号本来就没片源」「DMM 在限流/封了我」
 * 「地区限制」还是「我网络断了」—— 四种完全不同的情况给同一句提示。
 *
 * 做法：在预告片引擎里加一个诊断收集器，把每一阶段的 HTTP 状态 / 失败原因记下来，
 * 解析结束后按决策树归类，播放器里给用户看得懂、能对症下药���提示 + 可展开的明细。
 *
 * 决策树：
 *   DMM 商品搜索(ItemList) 403/429/503  → DMM 在拒绝我们（限流 / 需要 Cookie / 地区）
 *   DMM 商品搜索正常但 0 匹配            → 该番号在 DMM/FANZA 根本没有这个商品
 *   商品搜索正常、cid 探测全部 403       → cid 猜错或该商品没有预览视频
 *   html5_player 返回地区限制文案        → DMM 判定为地区限制
 *   请求异常(status 0)                   → 网络错误
 *   找到了源但全部播不了                 → 防盗链 / 地区限制（源本身是对的）
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
console.log('== 预告片解析诊断反馈 ==');

/* ① 诊断收集器 */
rep(
  `    const dmmQualityOptions = [`,
  `    /* 预告片解析诊断：把「为什么没源」记录下来，供播放器给出可对症的提示 */
    const TrailerDiag = {
      items: [],
      reset: function () { this.items.length = 0; },
      note: function (stage, source, status, detail) {
        this.items.push({ stage: stage, source: source || '', status: status || 0, detail: detail || '' });
        if (this.items.length > 40) this.items.shift();
      },
      // 归类：rate=DMM 拒绝/限流  nosrc=该番号无商品/无预览  geo=地区限制  net=网络错误
      summary: function () {
        const c = { rate: 0, nosrc: 0, geo: 0, net: 0, other: 0, cid403: 0, found: 0 };
        this.items.forEach(function (it) {
          if (it.stage === 'dmm-search') {
            if (it.status === 403 || it.status === 429 || it.status === 503) c.rate++;
            else if (it.status === 0) c.net++;
            else if (it.detail === 'no-match') c.nosrc++;
            else c.other++;
          } else if (it.stage === 'dmm-cid') {
            if (it.status === 403 || it.status === 429) c.cid403++;
            else if (it.status === 0) c.net++;
            else if (it.detail === 'geo') c.geo++;
            else c.other++;
          } else if (it.stage === 'dmm-geo') c.geo++;
          else if (it.stage === 'found') c.found++;
        });
        return c;
      }
    };

    const dmmQualityOptions = [`,
  '新增 TrailerDiag 诊断收集器'
);

/* ② ItemList 搜索：记录状态 */
rep(
  `          const r = await gmReq({
            url: 'https://api.dmm.com/affiliate/v3/ItemList?' + params.toString(),
            headers: { Accept: 'application/json,text/plain,*/*' }, timeout: 4500, signal: signal
          });
          let data;
          try { data = JSON.parse(r.responseText); } catch (e) { return []; }`,
  `          let r;
          try {
            r = await gmReq({
              url: 'https://api.dmm.com/affiliate/v3/ItemList?' + params.toString(),
              headers: { Accept: 'application/json,text/plain,*/*' }, timeout: 4500, signal: signal
            });
          } catch (e) {
            TrailerDiag.note('dmm-search', 'DMM ItemList', 0, 'network:' + (e && e.message ? e.message : 'error'));
            return [];
          }
          let data;
          try { data = JSON.parse(r.responseText); } catch (e) {
            // 返回的不是 JSON —— 多半是被 Cloudflare / 限流挡了（HTML 错误页）
            TrailerDiag.note('dmm-search', 'DMM ItemList', r && r.status ? r.status : 0, 'not-json');
            return [];
          }
          if (!data || !data.result) {
            TrailerDiag.note('dmm-search', 'DMM ItemList', r && r.status ? r.status : 0, 'no-result');
            return [];
          }`,
  'ItemList 搜索：记录 HTTP 状态 / 非 JSON / 网络异常'
);

/* ③ ItemList 无匹配：记录 no-match */
rep(
  `          const items = (data && data.result && data.result.items) || [];
          const matched = [];`,
  `          const items = (data && data.result && data.result.items) || [];
          if (!items.length) TrailerDiag.note('dmm-search', 'DMM ItemList', r && r.status ? r.status : 0, 'no-match');
          const matched = [];`,
  'ItemList 无匹配：记录 no-match'
);

/* ④ html5_player 探测：记录状态 / 地区限制 */
rep(
  `        const r = await gmReq({
          url: playerUrl, timeout: timeoutMs || 5000, signal: signal,
          headers: { 'accept-language': 'ja-JP,ja;q=0.9', Cookie: 'age_check_done=1' }
        });
        const txt = r.responseText || '';
        if (txt.indexOf('このサービスはお住まいの地域からは') >= 0) return null;
        const argsMatch = txt.match(/const\\s+args\\s*=\\s*({[\\s\\S]*?});/);
        if (!argsMatch) return null;`,
  `        let r;
        try {
          r = await gmReq({
            url: playerUrl, timeout: timeoutMs || 5000, signal: signal,
            headers: { 'accept-language': 'ja-JP,ja;q=0.9', Cookie: 'age_check_done=1' }
          });
        } catch (e) {
          TrailerDiag.note('dmm-cid', hit.contentId, 0, 'network');
          return null;
        }
        const txt = r.responseText || '';
        if (txt.indexOf('このサービスはお住まいの地域からは') >= 0) {
          TrailerDiag.note('dmm-cid', hit.contentId, r.status ? r.status : 0, 'geo');
          return null;
        }
        const argsMatch = txt.match(/const\\s+args\\s*=\\s*({[\\s\\S]*?});/);
        if (!argsMatch) {
          // 没有 bitrates：cid 不存在（该商品没有预览）或被 DMM 拒绝
          TrailerDiag.note('dmm-cid', hit.contentId, r.status ? r.status : 0, 'no-bitrates');
          return null;
        }`,
  'html5_player 探测：记录状态 / 地区限制 / 无 bitrates'
);

/* ⑤ doResolveTrailer：开始时重置诊断 */
rep(
  `    async function doResolveTrailer(code, cacheKey, onUpdate, signal) {
      const sources = [];`,
  `    async function doResolveTrailer(code, cacheKey, onUpdate, signal) {
      TrailerDiag.reset();
      const sources = [];`,
  'doResolveTrailer 开始时重置诊断'
);

/* ⑥ 播放器：分类渲染失败原因 */
rep(
  `        if (!sources.length) {
          if (resolveTimedOut) return;
          loading.innerHTML = '<div style="font-size:15px;opacity:.85;">😔 未找到可用预告片源</div>' +
            '<div style="font-size:12px;opacity:.5;margin-top:8px;">已尝试：官方预告片 / DMM API / 厂商直链 / javspyl</div>';
          srcTag.textContent = '无源';
        } else if (awaitingMoreSources) {`,
  `        if (!sources.length) {
          if (resolveTimedOut) return;
          loading.innerHTML = renderTrailerDiagHtml('no-source');
          srcTag.textContent = '无源';
        } else if (awaitingMoreSources) {`,
  '播放器：解析无源时改用分类诊断提示'
);

rep(
  `        else {
          awaitingMoreSources = false;
          loading.style.display = '';
          loading.innerHTML = '<div style="opacity:.85;">😔 所有预告片源均播放失败（可能受地区/防盗链限制）</div>';
          video.style.display = 'none';
        }`,
  `        else {
          awaitingMoreSources = false;
          loading.style.display = '';
          loading.innerHTML = renderTrailerDiagHtml('play-failed');
          video.style.display = 'none';
        }`,
  '播放器：全部播放失败时改用分类诊断提示'
);

rep(
  `        if (!sources.length) {
          loading.innerHTML = '<div style="opacity:.85;">⏱ 解析超时，已停止等待。关闭后重新点预告片可重试。</div>';
          srcTag.textContent = '超时';
        } else {`,
  `        if (!sources.length) {
          loading.innerHTML = renderTrailerDiagHtml('timeout');
          srcTag.textContent = '超时';
        } else {`,
  '播放器：超时也走统一诊断渲染'
);

console.log('\napplied=' + applied + '  skipped=' + skipped);
if (skipped) { console.error('⚠ 有未应用项（其余改动仍会写入）: ' + skipped); }
try { new Function(src); console.log('syntax check: OK'); } catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }
fs.writeFileSync(file, src, 'utf8');
