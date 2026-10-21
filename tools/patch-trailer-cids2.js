/* 预告片 cid 候选：排序按位数分级 + 上限 4 → 7 */
const fs = require('fs');
const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');

const OLD = [
  '      cids.sort(function (a, b) {',
  '        const sa = /^[a-z]+\\d{5}$/.test(a) ? 0 : 1;',
  '        const sb = /^[a-z]+\\d{5}$/.test(b) ? 0 : 1;',
  '        return sa - sb;',
  '      });',
  '      return cids.slice(0, 4).map(function (cid) {'
].join('\n');

const NEW = [
  '      // 排序：位数 5 → 6 → 7 → 其它（5 位补零命中率最高，保持优先）；',
  '      // 同位数内保留生成顺序（5 位形态优先于 6 位，以命中率高者先试）。',
  '      const rank = function (cid) {',
  "        const digits = (cid.match(/\\d+$/) || [''])[0].length;",
  '        if (digits === 5) return 0;',
  '        if (digits === 6) return 1;',
  '        if (digits === 7) return 2;',
  '        return 3;',
  '      };',
  '      cids.sort(function (a, b) { return rank(a) - rank(b); });',
  '      // 候选上限 4 → 7：并发试探同一个端点，耗时几乎不变，但命中率显著提升。',
  '      return cids.slice(0, 7).map(function (cid) {'
].join('\n');

if (src.split(OLD).length - 1 !== 1) { console.log('MISS count=' + (src.split(OLD).length - 1)); process.exit(1); }
src = src.replace(OLD, NEW);
try { new Function(src); console.log('syntax check: OK'); } catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }
fs.writeFileSync(file, src, 'utf8');
console.log('ok    候选排序按位数分级 + 上限 4 → 7');
