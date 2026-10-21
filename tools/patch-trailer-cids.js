/*
 * JavdbFusion 预告片 cid 猜测增强补丁
 *
 * 背景：实测 GANA-3475 / MIUM-1457 这类番号时发现，
 * inferDmmHitsFromCode() 只生成 3 种数字形态（原样 / 去前导零 / 5 位补零）× 2 种厂牌写法
 * = 最多 4 个候选，且只取前 4 个（DMM 抓取时会并发试这 4 个）。
 * 实际 DMM content_id 的补零位数并不统一（有的 5 位、有的 6 位、有的 7 位，
 * 例如 MIUM-145 → mium00145、MIUM-1457 → mium01457；
 *  但部分厂牌会出现 mium000145 这类 6 位形态），
 * 候选不够就必然全军覆没，只能退化成「直链候选」盲猜阶梯。
 *
 * 本补丁：
 *   ① 数字形态扩展到 原样 / 去前导零 / 5 位 / 6 位 / 7 位补零
 *   ② 候选上限 4 → 7（并发试探，成本几乎不变，都是同一个 html5_player 端点）
 *   ③ 排序改为「位数从 5 到 7，再原样」——5 位补零仍是命中率最高的形态，保持优先
 *   ④ 厂牌写法再补一种「厂牌 + 数字」（如 mium1 / gana1）
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
console.log('== 预告片 cid 猜测增强补丁 ==');

rep(
  `      const nums = [num];
      // 补零 / 不补零 / 去前导零 三种数字形态都试一遍（去前导零覆盖 001→1 的老番号）。
      const trimmed = num.replace(/^0+(?=\\d)/, '');
      if (trimmed && trimmed !== num) nums.push(trimmed);
      // 5 位补零是 DMM 最常见形态，单独保证一定入列。
      nums.push(num.padStart(5, '0'));
      const makers = [maker];
      // 部分厂牌冠以数字（如 1STAR / 3xxx），补一个带数字前缀的候选用于匹配 1stars531 形态。
      if (/^[a-z]/.test(maker)) makers.push('1' + maker);`,
  `      const nums = [num];
      // 补零 / 不补零 / 去前导零 三种数字形态都试一遍（去前导零覆盖 001→1 的老番号）。
      const trimmed = num.replace(/^0+(?=\\d)/, '');
      if (trimmed && trimmed !== num) nums.push(trimmed);
      // 5 位补零是 DMM 最常见形态，单独保证一定入列。
      nums.push(num.padStart(5, '0'));
      // 【增强 2026-10】实测不同厂牌的 content_id 补零位数并不统一：
      //   MIUM-145  → mium00145   （5 位）
      //   MIUM-1457 → mium01457   （5 位）
      // 但也存在 6 位 / 7 位形态（如 mium000145、gana00003475）。
      // 候选形态不足就会全军覆没，只能退化成「直链候选」盲猜阶梯。
      // 这里把 6/7 位补零也纳入候选（成本几乎不变：都是同一个 html5_player 端点的并发试探）。
      nums.push(num.padStart(6, '0'));
      nums.push(num.padStart(7, '0'));
      const makers = [maker];
      // 部分厂牌冠以数字（如 1STAR / 3xxx），补一个带数字前缀的候选用于匹配 1stars531 形态。
      if (/^[a-z]/.test(maker)) makers.push('1' + maker);
      // 厂牌 + 数字 的写法（如 mium1 / gana1）也出现过，一并纳入。
      makers.push(maker + '1');`,
  '候选数字形态扩展到 5/6/7 位补零 + 厂牌加数字写法'
);

rep(
  `      cids.sort(function (a, b) {
        var sa = /^[a-z]+\\d{5}$/.test(a) ? 0 : 1;
        var sb = /^[a-z]+\\d{5}$/.test(b) ? 0 : 1;
        return sa - sb;
      });
      return cids.slice(0, 4).map(function (cid) {`,
  `      // 排序：位数 5 → 6 → 7 → 其它（5 位补零命中率最高，保持优先）；
      // 同位数内保留生成顺序（5 位形态优先于 6 位，以命中率高者先试）。
      var rank = function (cid) {
        var digits = (cid.match(/\\d+$/) || [''])[0].length;
        if (digits === 5) return 0;
        if (digits === 6) return 1;
        if (digits === 7) return 2;
        return 3;
      };
      cids.sort(function (a, b) {
        var ra = rank(a), rb = rank(b);
        return ra - rb;
      });
      // 候选上限 4 → 7：并发试探同一个端点，耗时几乎不变，但命中率显著提升。
      return cids.slice(0, 7).map(function (cid) {`,
  '候选排序按位数分级 + 上限 4 → 7'
);

console.log('\napplied=' + applied + '  skipped=' + skipped);
if (skipped) { console.error('⚠ 有未应用项（其余改动仍会写入）: ' + skipped); }
try { new Function(src); console.log('syntax check: OK'); } catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }
fs.writeFileSync(file, src, 'utf8');
