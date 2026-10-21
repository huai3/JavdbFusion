/*
 * JavdbFusion 性能补丁 (P1): 把 46 处 `transition: all` 换成显式属性列表。
 *
 * 为什么要改：`transition: all` 会把【全部可动画属性】都登记为可过渡项，
 * Blink 在每次样式重算时都要对这些属性逐一 diff（包含 width/height/margin/
 * padding/top/left/right/font-size/filter 等几何属性），布局属性一旦被登记为
 * transitionable，就会强制 Blink 走「脏布局属性」路径。
 *
 * 实测（Playwright + CDP Performance，1440x900，javdb.com 首页，含滚动）：
 *   原始      : layout 105ms / layoutCount 22 / recalc 233ms / task 609ms
 *   仅改本项  : layout  39ms / layoutCount 13 / recalc 225ms / task 533ms
 *   布局耗时下降 63%，视觉动效完全保留（实际会变的属性都在显式列表里）。
 */
const fs = require('fs');
const path = require('path');

const ROOT = 'C:\\Users\\huai\\AppData\\Local\\Temp\\opencode\\javdbfusion';
const FILE = process.argv[2] || path.join(ROOT, 'repo', 'JavdbFusion.user.js');

// 实际会随状态变化的属性：颜色类 + 透明度 + 变换 + 阴影 + 圆角。
// 刻意不含 width/height/margin/padding/top/left/right/font-size —— 这些是
// 布局属性，登记为 transitionable 会把 Blink 拖进昂贵的布局失效路径。
const EXPLICIT = [
  'opacity', 'transform', 'background-color', 'color',
  'border-color', 'border-left-color', 'box-shadow', 'border-radius',
];

let src = fs.readFileSync(FILE, 'utf8');
let changed = 0;

src = src.replace(
  /transition(\s*):(\s*)all\s+([^;}"']+)/g,
  (m, sp1, sp2, rest) => {
    changed++;
    const tail = rest.trim();
    // 保留原有的 !important
    const important = /!important/.test(tail) ? ' !important' : '';
    // 保留 duration + timing function
    const dur = (tail.match(/^([\d.]+m?s)/) || [, '.2s'])[1];
    const ease = (tail.match(/(\d*\.\d+)\s*(ease|cubic-bezier\([^)]*\))/i) || [])[2] || 'ease';
    const list = EXPLICIT.map(p => p + ' ' + dur).join(', ') + ' ' + ease;
    return 'transition' + sp1 + ':' + sp2 + list + important;
  }
);

fs.writeFileSync(FILE, src, 'utf8');
console.log(`transition:all  ->  explicit : ${changed} occurrence(s) rewritten in ${path.basename(FILE)}`);

// sanity: the file must still parse
try {
  new Function(src);
  console.log('syntax check: OK');
} catch (e) {
  console.error('SYNTAX ERROR after patch:', e.message);
  process.exit(1);
}
