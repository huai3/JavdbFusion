/*
 * 双脚本静态体检与安全门禁（零外部依赖，支持本地与 CI 直接运行）：
 *   node tools/pw/lint-userscript.js                 # 默认检查仓库根目录两份 .user.js
 *   node tools/pw/lint-userscript.js JavdbFusion.user.js
 *
 * 检查项：
 *   1. JS 语法合法性（vm.Script 编译检查）
 *   2. ==UserScript== 元数据完整性（@name/@version/@downloadURL/@updateURL/@match）
 *   3. 反引号平衡 + buildEmbyCSS 模板字符串真实求值（防止模板内未转义反引号导致整段皮肤静默失效）
 *   4. @version 与代码内 VERSION 兜底常量一致
 *   5. 顶层作用域重复 function 声明检测（防止函数提升静默覆盖，如重复 escapeHtml）
 *   6. 高危安全红线守卫（敏感凭据不落宿主 localStorage、不暴露 unsafeWindow.FAV、URL 不拼 access_token、无不安全内联事件、window.open 带 noopener）
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const repoRoot = path.resolve(__dirname, '../..');
const cliFiles = process.argv.slice(2);
const targets = cliFiles.length
  ? cliFiles.map(f => path.resolve(process.cwd(), f))
  : [
      path.join(repoRoot, 'JavdbFusion.user.js'),
      path.join(repoRoot, '115Fusion.user.js')
    ];

let failures = 0;
function fail(fileLabel, msg) {
  failures++;
  console.error(`  [FAIL] ${fileLabel}: ${msg}`);
}

function checkFile(filePath) {
  const label = path.basename(filePath);
  console.log(`\n=== Checking ${label} ===`);
  if (!fs.existsSync(filePath)) {
    fail(label, `file not found: ${filePath}`);
    return;
  }
  const src = fs.readFileSync(filePath, 'utf8');
  const lines = src.split(/\n/);

  // 1. JS syntax check via vm.Script
  try {
    new vm.Script(src, { filename: label });
    console.log('  [OK] syntax compile');
  } catch (e) {
    fail(label, `SyntaxError: ${e.message}`);
    return;
  }

  // 2. Metadata header check
  const headerMatch = src.match(/\/\/ ==UserScript==([\s\S]*?)\/\/ ==\/UserScript==/);
  if (!headerMatch) {
    fail(label, 'missing ==UserScript== metadata block');
  } else {
    const header = headerMatch[1];
    const reqTags = ['@name', '@version', '@downloadURL', '@updateURL', '@match'];
    const missing = reqTags.filter(t => !new RegExp(`^//\\s*${t}\\s+\\S+`, 'm').test(header));
    if (missing.length) fail(label, `missing metadata tag(s): ${missing.join(', ')}`);
    else console.log('  [OK] metadata header complete');

    // @version vs fallback VERSION constant check
    const vmMatch = header.match(/^\/\/\s*@version\s+(\S+)/m);
    const verConst = src.match(/var\s+VERSION\s*=.*:\s*'([^']+)'/);
    if (vmMatch && verConst && vmMatch[1] !== verConst[1]) {
      fail(label, `@version (${vmMatch[1]}) !== fallback VERSION (${verConst[1]})`);
    } else if (vmMatch && verConst) {
      console.log(`  [OK] version synced (${vmMatch[1]})`);
    }
  }

  // 3. Backtick parity & buildEmbyCSS template evaluation
  let tick = 0;
  const badTicks = [];
  lines.forEach((ln, i) => {
    const n = (ln.match(/(?<!\\)`/g) || []).length;
    const before = tick;
    const after = tick + n;
    if (before % 2 === 1 && n % 2 === 1) {
      badTicks.push({ line: i + 1, text: ln.trim().slice(0, 100) });
    }
    tick = after;
  });
  if (tick % 2 !== 0) {
    fail(label, 'backtick parity UNBALANCED');
  } else {
    console.log('  [OK] backtick parity balanced');
  }

  const cssFnIdx = src.indexOf('function buildEmbyCSS(accent)');
  if (cssFnIdx >= 0) {
    const start = src.indexOf('return `', cssFnIdx) + 'return `'.length;
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
      const rules = (css.match(/\{/g) || []).length;
      console.log(`  [OK] buildEmbyCSS eval (length=${css.length}, rules=${rules})`);
      if (css.length < 100000) {
        const stopLine = src.slice(0, start + out.length).split('\n').length;
        fail(label, `buildEmbyCSS template ended early at ~L${stopLine} (length=${css.length})`);
      }
    } catch (e) {
      fail(label, `buildEmbyCSS eval FAILED: ${e.message}`);
    }
  }

  // 4. Top-level (2-space indented IIFE scope) duplicate function declaration check
  const topFns = new Map();
  lines.forEach((ln, idx) => {
    const m = ln.match(/^  (?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/);
    if (m) {
      if (!topFns.has(m[1])) topFns.set(m[1], []);
      topFns.get(m[1]).push(idx + 1);
    }
  });
  const dupFns = [...topFns.entries()].filter(([, locs]) => locs.length > 1);
  if (dupFns.length) {
    dupFns.forEach(([name, locs]) => fail(label, `duplicate top-level function "${name}" at lines ${locs.join(', ')}`));
  } else {
    console.log('  [OK] no duplicate top-level functions');
  }

  // 5. Security & hygiene guardrails
  const badSecretLs = [];
  lines.forEach((ln, idx) => {
    if (/localStorage\.(?:get|set)Item\s*\([^)]*(?:javdb_git_token|javdb_webdav_pass|jhs_appAuthorization|APP_AUTH_KEY)/.test(ln)) {
      badSecretLs.push(`L${idx + 1}`);
    }
  });
  if (badSecretLs.length) fail(label, `direct localStorage secret access at ${badSecretLs.join(', ')}`);

  if (/unsafeWindow\.FAV(?:UI)?\s*=/.test(src)) {
    fail(label, 'exposing FAV/FAVUI onto unsafeWindow is forbidden');
  }
  if (src.includes("'access_token=' + encodeURIComponent")) {
    fail(label, 'appending access_token= into URL query string is forbidden');
  }
  if (/efav-actor-(?:stack|collapse)-badge[^>]*onclick=/.test(src)) {
    fail(label, 'inline onclick on FAVUI actor badges breaks Tampermonkey sandbox scope');
  }
  if (label === '115Fusion.user.js' && /\bonerror=/.test(src)) {
    fail(label, 'inline onerror= handler found in 115Fusion.user.js');
  }
  const unsafeOpen = [];
  lines.forEach((ln, idx) => {
    if (/\bwindow\.open\s*\([^)]*,\s*['"]_blank['"]\s*\)/.test(ln)) {
      unsafeOpen.push(`L${idx + 1}`);
    }
  });
  if (unsafeOpen.length) fail(label, `window.open(..., '_blank') without 'noopener' at ${unsafeOpen.join(', ')}`);

  if (failures === 0) console.log('  [OK] security & hygiene guardrails');
}

targets.forEach(checkFile);

if (failures > 0) {
  console.error(`\nStatic check FAILED with ${failures} issue(s).`);
  process.exit(1);
}
console.log(`\nAll static checks PASSED (${targets.length} file(s)).`);
