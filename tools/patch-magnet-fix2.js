/* 磁力面板补丁第三项：
 *  ① 刷新按钮要清的是新的 per-key 缓存，不是旧的整块 JSON 键
 *  ② 「全部聚合」时「源站搜↗」按钮的兜底站点
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
console.log('== 磁力面板补丁(3) ==');

rep(
  "        delete c[siteSel.value + ':' + code.toUpperCase()];",
  "        // 新缓存是 per-key（jf_magpanel_<site>_<code>），这里要清对应的单键\n        try { GM_setValue(MAG_CACHE_PREFIX + siteSel.value + ':' + code.toUpperCase(), ''); } catch (e) {}",
  '刷新按钮清理 per-key 缓存'
);
rep(
  "      var site = MAG_SEARCH_SITES.find(function (s) { return s.id === siteSel.value; }) || MAG_SEARCH_SITES[0];",
  "      var site = MAG_SEARCH_SITES.find(function (s) { return s.id === siteSel.value; }) || (siteSel.value === 'all' ? MAG_ALL_SITE : MAG_SEARCH_SITES[0]);",
  'aggSrcUrl 支持「全部聚合」'
);

console.log('\napplied=' + applied + '  skipped=' + skipped);
if (skipped) { console.error('有未应用项，请检查'); process.exit(1); }
try { new Function(src); console.log('syntax check: OK'); } catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }
fs.writeFileSync(file, src, 'utf8');
