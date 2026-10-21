/* 磁力面板补丁的最后一项：聚合模式下给标题加来源前缀。
 * 单独成文件是为了避开 PowerShell 的引号转义地狱。 */
const fs = require('fs');
const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');
const OLD = [
  '      function preparedRows() {',
  '        var seen = {}, uniq = [];',
  '        lastRows.forEach(function (r) {',
  '          if (!r || !r.magnet) return;'
].join('\n');
const NEW = [
  '      function preparedRows() {',
  '        var seen = {}, uniq = [];',
  '        lastRows.forEach(function (r) {',
  '          if (!r || !r.magnet) return;',
  '          // 聚合模式下给标题加来源前缀，让用户知道每条来自哪个站',
  '          if (r.src && r.__tagged !== 1) {',
  "            r.title = '[' + r.src + '] ' + r.title;",
  '            r.__tagged = 1;',
  '          }'
].join('\n');
const n = src.split(OLD).length - 1;
if (n === 0) { console.log('MISS: preparedRows 锚点未找到'); process.exit(1); }
if (n > 1) { console.log('AMBIG(' + n + ')'); process.exit(1); }
src = src.replace(OLD, NEW);
try { new Function(src); } catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }
fs.writeFileSync(file, src, 'utf8');
console.log('ok    聚合模式给标题加来源前缀');
