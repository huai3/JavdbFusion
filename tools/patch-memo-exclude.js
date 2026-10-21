/* 备忘缓存排除表：可变状态的 GET 接口不能被 5 分钟的短期备忘复用。
 * 115 的 webapi 全部是 GET，但改名/移动/删除后列表必须立刻反映，
 * 否则整理面板会出现「改了但列表不变」的错觉。 */
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
console.log('== 备忘缓存排除表 ==');

rep(
  `  const __gmMemoCool = 300000; // 5 分钟，与站点可用性缓存 TTL 一致`,
  `  const __gmMemoCool = 300000; // 5 分钟，与站点可用性缓存 TTL 一致
  // 排除表：这些 GET 接口会改状态（115 改名/移动/删除），不能复用旧响应，
  // 否则「改名完成 → 重新列目录」会显示旧数据。
  const __gmMemoExclude = ['webapi.115.com', '115.com/proapi', 'proapi.115.com'];`,
  '新增排除表常量'
);

rep(
  `    const memo = __gmMemo.get(key);
    if (memo && (Date.now() - memo.t) < __gmMemoCool) {`,
  `    const excluded = __gmMemoExclude.some(function (h) { return opt.url.indexOf(h) >= 0; });
    const memo = excluded ? null : __gmMemo.get(key);
    if (memo && (Date.now() - memo.t) < __gmMemoCool) {`,
  '排除表生效：115 接口不进入备忘'
);

console.log('\napplied=' + applied + '  skipped=' + skipped);
if (skipped) { console.error('⚠ 有未应用项（其余改动仍会写入）: ' + skipped); }
try { new Function(src); console.log('syntax check: OK'); } catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }
fs.writeFileSync(file, src, 'utf8');
