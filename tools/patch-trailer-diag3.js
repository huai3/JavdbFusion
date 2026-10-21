/* 诊断提示的优先级：先按诊断结论定性，再看 kind。
 * 原因：未验证的「直链候选」阶梯始终存在 → sources 永远非空 →
 * 播放器永远走 play-failed 分支，真正的病因（DMM 拒绝/无预览）反而看不到。 */
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
console.log('== 诊断提示优先级修正 ==');

const OLD = `      if (kind === 'play-failed') {
        title = '😔 已找到片源，但全部播放失败';
        desc = '片源地址本身是对的 —— 通常是防盗链（Referer）或地区限制导致 DMM 拒绝回源。可以点下面的源在源站打开再试。';
      } else if (kind === 'timeout') {
        title = '⏱ 解析超时';
        desc = '已停止等待，关闭后重新点预告片可重试。';
      } else if (s.rate > 0) {`;

const NEW = `      if (kind === 'timeout') {
        title = '⏱ 解析超时';
        desc = '已停止等待，关闭后重新点预告片可重试。';
      } else if (s.rate > 0) {`;

rep(OLD, NEW, '把 timeout 提到最前、play-failed 降级为兜底');

// rate / geo / nosrc / cid403 之后补上 play-failed 分支
const OLD2 = `      } else if (s.net > 0) {
        title = '😔 网络错误';
        desc = '请求没能送达 DMM，请检查网络连接或代理设置。';
      }`;

const NEW2 = `      } else if (s.net > 0 && !srcList) {
        title = '😔 网络错误';
        desc = '请求没能送达 DMM，请检查网络连接或代理设置。';
      } else if (kind === 'play-failed') {
        title = '😔 已找到片源，但全部播放失败';
        desc = '片源地址本身是对的 —— 通常是防盗链（Referer）或地区限制导致 DMM 拒绝回源。可以点下面的源在源站打开再试。';
      } else if (s.net > 0) {
        title = '😔 网络错误';
        desc = '请求没能送达 DMM，请检查网络连接或代理设置。';
      }`;

rep(OLD2, NEW2, '在诊断结论之后补回 play-failed 兜底分支');

console.log('\napplied=' + applied + '  skipped=' + skipped);
if (skipped) { console.error('⚠ 有未应用项（其余改动仍会写入）: ' + skipped); }
try { new Function(src); console.log('syntax check: OK'); } catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }
fs.writeFileSync(file, src, 'utf8');
