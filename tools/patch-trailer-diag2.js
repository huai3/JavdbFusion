/* 预告片诊断提示的渲染函数 */
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
console.log('== 预告片诊断提示渲染 ==');

const FN = `    /* 根据诊断结果渲染「为什么没有预告片」的可对症提示 + 可展开明细 */
    function renderTrailerDiagHtml(kind, srcList) {
      const s = TrailerDiag.summary();
      const items = TrailerDiag.items || [];
      let title = '😔 未找到可用预告片源';
      let desc = '已尝试：官方预告片 / DMM 商品与画质接口 / 厂商直链 / javspyl。';
      let tip = '';
      if (kind === 'play-failed') {
        title = '😔 已找到片源，但全部播放失败';
        desc = '片源地址本身是对的 —— 通常是防盗链（Referer）或地区限制导致 DMM 拒绝回源。可以点下面的源在源站打开再试。';
      } else if (kind === 'timeout') {
        title = '⏱ 解析超时';
        desc = '已停止等待，关闭后重新点预告片可重试。';
      } else if (s.rate > 0) {
        const st = items.filter(function (i) { return i.stage === 'dmm-search'; }).map(function (i) { return i.status; })[0] || 0;
        title = '😔 DMM 拒绝了请求（HTTP ' + (st || '?') + '）';
        desc = 'DMM/FANZA 的商品搜索接口被限流或拦截了 —— 这是网络侧的问题，不是这个番号没有片源。';
        tip = '建议：等几分钟再试；或检查网络出口/代理；也可以直接用磁力聚合里的资源。';
      } else if (s.geo > 0) {
        title = '😔 DMM 判定为地区限制';
        desc = '该内容在 DMM 属于地区限制作品，当前网络出口拿不到预览视频。';
        tip = '建议：换个网络出口（代理）再试。';
      } else if (s.nosrc > 0) {
        title = '😔 该番号在 DMM/FANZA 没有对应商品';
        desc = '商品搜索正常返回、但搜不到这个番号，因此没有可用的 DMM 预告片源。';
        tip = '建议：换个番号试试；或用磁力聚合 / 外部播放站。';
      } else if (s.cid403 > 0) {
        title = '😔 DMM 没有该作品的预览视频';
        desc = '商品能搜到，但 DMM 没给它提供预览（bitrates 为空），所以拿不到片源。';
        tip = '建议：这类番号普遍无预告片，属正常现象。';
      } else if (s.net > 0) {
        title = '😔 网络错误';
        desc = '请求没能送达 DMM，请检查网络连接或代理设置。';
      }
      // 明细
      let detail = '';
      if (items.length) {
        detail = items.map(function (i) {
          const st = i.status ? ('HTTP ' + i.status) : (i.detail || 'network');
          return '<div style="display:flex;gap:.5em;padding:.18em 0;color:#8d8fa3;font-size:11.5px;">' +
            '<span style="flex:0 0 92px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(i.source || i.stage) + '</span>' +
            '<span style="flex:0 0 60px;">' + escapeHtml(st) + '</span>' +
            '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + escapeHtml(i.detail || '') + '</span>' +
            '</div>';
        }).join('');
      }
      let srcHtml = '';
      if (kind === 'play-failed' && srcList && srcList.length) {
        srcHtml = '<div style="margin-top:.6em;font-size:11.5px;color:#8d8fa3;">已试片源：' +
          srcList.map(function (x) { return escapeHtml(x.label || x.url || ''); }).join('、') + '</div>';
      }
      return '<div style="font-size:15px;opacity:.92;line-height:1.5;">' + title + '</div>' +
        '<div style="font-size:12.5px;opacity:.72;margin-top:.5em;line-height:1.55;">' + desc + '</div>' +
        (tip ? '<div style="font-size:12.5px;opacity:.86;margin-top:.45em;color:#9fdcf5;line-height:1.5;">' + tip + '</div>' : '') +
        srcHtml +
        (detail ? '<details style="margin-top:.7em;font-size:11.5px;color:#8d8fa3;"><summary style="cursor:pointer;user-select:none;">诊断明细（' + items.length + ' 条）</summary>' +
          '<div style="margin-top:.35em;padding:.4em .5em;background:rgba(0,0,0,.28);border-radius:7px;max-height:180px;overflow:auto;">' + detail + '</div></details>' : '');
    }

`;

rep(
  `    const dmmQualityOptions = [`,
  FN + `    const dmmQualityOptions = [`,
  '新增 renderTrailerDiagHtml 渲染函数'
);

/* 把已找到的片源也传给渲染函数 */
rep(
  `          loading.innerHTML = renderTrailerDiagHtml('play-failed');`,
  `          loading.innerHTML = renderTrailerDiagHtml('play-failed', sources);`,
  'play-failed 分支传入片源列表'
);

console.log('\napplied=' + applied + '  skipped=' + skipped);
if (skipped) { console.error('⚠ 有未应用项（其余改动仍会写入）: ' + skipped); }
try { new Function(src); console.log('syntax check: OK'); } catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }
fs.writeFileSync(file, src, 'utf8');
