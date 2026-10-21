/*
 * 静态体检：JavdbFusion.user.js 里的 CSS 位于 buildEmbyCSS 的模板字符串中，
 * 模板内出现反引号会提前终止模板 → 后续 CSS 被当成 JS 解析 →
 * 运行时 SyntaxError: Unexpected identifier 'html'，整段皮肤静默失效。
 * 这个检查在每次改动后跑一次，避免再次踩坑。
 */
const fs = require('fs');
const path = require('path');
const file = process.argv[2];
const src = fs.readFileSync(file, 'utf8');
const lines = src.split(/\n/);

let tick = 0;
let bad = [];
lines.forEach((ln, i) => {
  // count unescaped backticks on this line
  const n = (ln.match(/(?<!\\)`/g) || []).length;
  const before = tick;
  const after = tick + n;
  if (before % 2 === 1 && n % 2 === 1) {
    // line starts inside a template literal and ends outside -> template closed here
    const idx = ln.indexOf('`');
    bad.push({ line: i + 1, text: ln.trim().slice(0, 120), at: idx });
  }
  tick = after;
});
console.log('backtick parity:', tick % 2 === 0 ? 'balanced' : 'UNBALANCED');
if (bad.length) {
  console.log('lines where a template literal closes mid-line:');
  bad.forEach(b => console.log(`  ${b.line}: ${b.text}`));
}

// stronger check: evaluate the buildEmbyCSS template exactly like the browser would
const idx = src.indexOf('function buildEmbyCSS(accent)');
if (idx >= 0) {
  const start = src.indexOf('return `', idx) + 'return `'.length;
  // find the matching closing backtick: scan with a tiny state machine that
  // understands ${ } interpolation
  let i = start;
  let out = '';
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') { out += src.slice(i, i + 2); i += 2; continue; }
    if (ch === '$' && src[i + 1] === '{') {
      let depth = 1; let j = i + 2;
      while (j < src.length && depth > 0) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}') depth--;
        if (depth === 0) break;
        j++;
      }
      out += src.slice(i, j + 1); i = j + 1; continue;
    }
    if (ch === '`') break;
    out += ch; i++;
  }
  try {
    const css = (new Function('accent', 'return `' + out + '`'))('#00a4dc');
    console.log('buildEmbyCSS eval OK, css length =', css.length);
    const rules = (css.match(/\{/g) || []).length;
    console.log('rule blocks =', rules);
    if (css.length < 100000) {
      const stopLine = src.slice(0, start + out.length).split('\n').length;
      console.log('!! template ended early at source line ~' + stopLine);
      console.log('!! context:', JSON.stringify(src.slice(start + out.length - 160, start + out.length + 160)));
    }
  } catch (e) {
    console.log('buildEmbyCSS eval FAILED:', e.message);
    process.exit(1);
  }
}
