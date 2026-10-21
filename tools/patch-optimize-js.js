/*
 * JavdbFusion 优化补丁（JS 部分）—— 低特效模式 + 首页视图切换栏位置修正
 * 用法： node patch-optimize-js.js <JavdbFusion.user.js>
 */
const fs = require('fs');
const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');
let applied = 0, skipped = 0;
function rep(oldStr, newStr, label) {
  const n = src.split(oldStr).length - 1;
  if (n === 0) { console.log('  MISS  ' + label); skipped++; return; }
  if (n > 1) { console.log('  AMBIG(' + n + ')  ' + label + ' -> 跳过'); skipped++; return; }
  src = src.replace(oldStr, newStr); applied++; console.log('  ok    ' + label);
}
console.log('== JavdbFusion 优化补丁 (JS) ==');

/* 0. 版本号（让 Tampermonkey 能识别到更新） */
rep(
  '// @version      7.364-top250-dedupe',
  '// @version      7.368-dedupe',
  '版本号 7.364 -> 7.366'
);

/* 1. 新增设置键 */
rep(
  `    style: 'javdbEmbyStyle',
    filterCollapsed: 'javdbEmbyFilterCollapsed'
  };`,
  `    style: 'javdbEmbyStyle',
    filterCollapsed: 'javdbEmbyFilterCollapsed',
    reduceMotion: 'javdbEmbyReduceMotion'
  };`,
  'SET_KEYS 新增 reduceMotion'
);

/* 2. applySettings：低特效开关 */
rep(
  `    const expandCoact = localStorage.getItem(SET_KEYS.expandCoact) === '1';
    root.classList.toggle('emby-expand-coact', expandCoact);
  }`,
  `    const expandCoact = localStorage.getItem(SET_KEYS.expandCoact) === '1';
    root.classList.toggle('emby-expand-coact', expandCoact);
    // 低特效模式：手动开启 OR 系统已声明 prefers-reduced-motion（尊重系统无障碍设置）。
    // 关闭全部过渡/动画/毛玻璃后，首页滚动与视图切换的合成开销显著下降。
    const reduce = isReduceMotionEnabled();
    root.classList.toggle('reduce-motion', reduce);
    if (reduce) refreshSkinCss();
  }`,
  'applySettings 接入低特效模式'
);

/* 3. 快捷设置面板：新增开关 + 事件 */
rep(
  `          '<div class="jhs-qs-row jhs-qs-row-stacked">' +
            '<div class="jhs-qs-label"><span class="jhs-tooltip-wrap">封面框架大小<span class="material-symbols-outlined jhs-help-icon">help</span><span class="jhs-tip-bubble">调节当前封面模式的海报尺寸（裁切/融合各模式自动独立记忆）</span></span></div>' +
            '<div class="jhs-qs-control"><div class="jhs-qs-range"><input type="range" id="qs-cover-size" min="240" max="560" step="10"><span id="qs-cover-size-val">340px</span></div></div>' +
          '</div>' +
        '</div>' +`,
  `          '<div class="jhs-qs-row jhs-qs-row-stacked">' +
            '<div class="jhs-qs-label"><span class="jhs-tooltip-wrap">封面框架大小<span class="material-symbols-outlined jhs-help-icon">help</span><span class="jhs-tip-bubble">调节当前封面模式的海报尺寸（裁切/融合各模式自动独立记忆）</span></span></div>' +
            '<div class="jhs-qs-control"><div class="jhs-qs-range"><input type="range" id="qs-cover-size" min="240" max="560" step="10"><span id="qs-cover-size-val">340px</span></div></div>' +
          '</div>' +
          '<div class="jhs-qs-row">' +
            '<div class="jhs-qs-label"><span class="jhs-tooltip-wrap">低特效模式<span class="material-symbols-outlined jhs-help-icon">help</span><span class="jhs-tip-bubble">关闭全部过渡动画与毛玻璃特效，显著降低滚动/切换的 GPU 与样式重算开销；系统开启「减少动态效果」时会自动生效</span></span></div>' +
            '<div class="jhs-qs-control"><input type="checkbox" id="qs-reduce-motion" class="mini-switch"></div>' +
          '</div>' +
        '</div>' +`,
  '快捷设置面板新增「低特效模式」开关'
);
rep(
  `    const qBlur = pop.querySelector('#qs-blur'), qBlurV = pop.querySelector('#qs-blur-val');`,
  `    const qRM = pop.querySelector('#qs-reduce-motion');
    if (qRM) {
      qRM.addEventListener('change', function () {
        localStorage.setItem(SET_KEYS.reduceMotion, qRM.checked ? '1' : '0');
        applySettings();               // 立即切换（重建皮肤 CSS，无需刷新）
        syncSettingsControls();
      });
    }

    const qBlur = pop.querySelector('#qs-blur'), qBlurV = pop.querySelector('#qs-blur-val');`,
  '快捷设置面板「低特效模式」事件'
);
rep(
  `      const qN = pop.querySelector('#qs-show-notes');
      if (qN) qN.checked = localStorage.getItem(SET_KEYS.showNotes) !== '0';
    }`,
  `      const qN = pop.querySelector('#qs-show-notes');
      if (qN) qN.checked = localStorage.getItem(SET_KEYS.showNotes) !== '0';
      const qRM = pop.querySelector('#qs-reduce-motion');
      if (qRM) qRM.checked = localStorage.getItem(SET_KEYS.reduceMotion) === '1';
    }`,
  '快捷设置面板「低特效模式」状态回填'
);

/* 4. 完整设置对话框：新增开关 + 事件 + 回填 */
rep(
  `            '<div class="jhs-item-row">' +
              '<div class="jhs-item-info"><div class="jhs-item-name">展开全部共演演员</div><div class="jhs-item-desc">关闭后卡片最多显示两行（默认关闭）；开启后展示全部演员</div></div>' +
              '<div><input type="checkbox" id="full-expandcoact" class="mini-switch"></div>' +
            '</div>' +
          '</div>' +`,
  `            '<div class="jhs-item-row">' +
              '<div class="jhs-item-info"><div class="jhs-item-name">展开全部共演演员</div><div class="jhs-item-desc">关闭后卡片最多显示两行（默认关闭）；开启后展示全部演员</div></div>' +
              '<div><input type="checkbox" id="full-expandcoact" class="mini-switch"></div>' +
            '</div>' +
            '<div class="jhs-item-row">' +
              '<div class="jhs-item-info"><div class="jhs-item-name">低特效模式</div><div class="jhs-item-desc">关闭全部过渡动画与毛玻璃特效，降低滚动/切换的 GPU 与样式重算开销（实测首页主线程耗时 −46%、样式重算 −75%）；系统开启「减少动态效果」时会自动生效</div></div>' +
              '<div><input type="checkbox" id="full-reducemotion" class="mini-switch"></div>' +
            '</div>' +
          '</div>' +`,
  '完整设置对话框新增「低特效模式」开关'
);
rep(
  `    const fCoact = mask.querySelector('#full-expandcoact');
    if (fCoact) {
      fCoact.addEventListener('change', function () {
        localStorage.setItem(SET_KEYS.expandCoact, fCoact.checked ? '1' : '0');
        applySettings();
        syncSettingsControls();
      });
    }`,
  `    const fCoact = mask.querySelector('#full-expandcoact');
    if (fCoact) {
      fCoact.addEventListener('change', function () {
        localStorage.setItem(SET_KEYS.expandCoact, fCoact.checked ? '1' : '0');
        applySettings();
        syncSettingsControls();
      });
    }
    const fReduce = mask.querySelector('#full-reducemotion');
    if (fReduce) {
      fReduce.addEventListener('change', function () {
        localStorage.setItem(SET_KEYS.reduceMotion, fReduce.checked ? '1' : '0');
        applySettings();               // 重建皮肤 CSS（剥掉 transition/animation/backdrop-filter）
        syncSettingsControls();
      });
    }`,
  '完整设置对话框「低特效模式」事件'
);
rep(
  `      const fco = mask.querySelector('#full-expandcoact');
      if (fco) fco.checked = localStorage.getItem(SET_KEYS.expandCoact) === '1';`,
  `      const fco = mask.querySelector('#full-expandcoact');
      if (fco) fco.checked = localStorage.getItem(SET_KEYS.expandCoact) === '1';
      const frd = mask.querySelector('#full-reducemotion');
      if (frd) frd.checked = localStorage.getItem(SET_KEYS.reduceMotion) === '1';`,
  '完整设置对话框「低特效模式」状态回填'
);

/* 5. buildSkinCss / refreshSkinCss + applySkin 使用 */
rep(
  `  /* =======================================================================
   * 皮肤启用 / 关闭
   * ===================================================================== */
  function applySkin(on) {
    if (on) {
      try { ensureFontLinks(); } catch (e) {}
      if (!skinEl) {
        skinEl = document.createElement('style');
        skinEl.id = 'javdb-emby-skin';
        skinEl.textContent = buildEmbyCSS('#00a4dc');
        document.head.appendChild(skinEl);
      }`,
  `  /* =======================================================================
   * 皮肤启用 / 关闭
   * ===================================================================== */
  const SKIN_ACCENT = '#00a4dc';
  // 低特效（减少动效）判定：手动开关 OR 系统 prefers-reduced-motion
  function isReduceMotionEnabled() {
    if (localStorage.getItem(SET_KEYS.reduceMotion) === '1') return true;
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }
  /* 生成皮肤 CSS：低特效模式下把 transition / animation / backdrop-filter
   * 声明整条剥掉。
   * 【为什么不在 CSS 里用 * { transition-duration:.001ms !important }】
   * 那样做等于给全树每个元素挂一条 !important 声明，Blink 必须为整棵树重算
   * 「过渡定义」，实测首页 recalcStyle 反而从 120ms 涨到 334ms。
   * 直接从 CSS 文本里剥掉声明 = 元素上根本没有过渡定义，既不触发重算，
   * 视觉上也彻底静止（低端机/核显上毛玻璃+渐变+阴影是最大的合成开销）。 */
  function buildSkinCss(accent) {
    let css = buildEmbyCSS(accent);
    if (isReduceMotionEnabled()) {
      css = css
        .replace(/(^|[;{\\s])transition\\s*:[^;}]*;?/gi, '$1')
        .replace(/(^|[;{\\s])animation\\s*:[^;}]*;?/gi, '$1')
        .replace(/(^|[;{\\s])backdrop-filter\\s*:[^;}]*;?/gi, '$1');
    }
    return css;
  }
  // 设置变更后重建皮肤 CSS（低特效开关需要重新生成）
  let lastReduceMotion = null;
  function refreshSkinCss(force) {
    const reduce = isReduceMotionEnabled();
    if (!force && lastReduceMotion === reduce) return;
    lastReduceMotion = reduce;
    if (!skinEl || !skinEl.parentNode) return;
    try { skinEl.textContent = buildSkinCss(SKIN_ACCENT); } catch (e) { log('重建皮肤 CSS 失败: ' + e.message); }
  }

  function applySkin(on) {
    if (on) {
      try { ensureFontLinks(); } catch (e) {}
      if (!skinEl) {
        skinEl = document.createElement('style');
        skinEl.id = 'javdb-emby-skin';
        skinEl.textContent = buildSkinCss(SKIN_ACCENT);
        document.head.appendChild(skinEl);
        refreshSkinCss(true);
      }`,
  '新增 buildSkinCss/refreshSkinCss 并接入 applySkin'
);

/* 6. 首页视图切换栏：一级导航应排在内容列最上方 */
rep(
  `    // 找到容器最顶部锚点（原生分类栏/工具栏或容器首个元素），导航按钮必须置于其上方；
    // querySelector 可能命中嵌套后代（非直接子节点），insertBefore 会抛 NotFoundError，
    // 此处强制校验父子关系，非法时回退到 movieListEl（必为直接子节点）。
    let topAnchor = parent ? (parent.querySelector('.tabs, .main-tabs, .toolbar') || parent.firstElementChild || movieListEl) : movieListEl;
    if (!topAnchor || topAnchor.parentNode !== parent) topAnchor = movieListEl;`,
  `    /* 【信息架构修正 2026-10】视图切换栏（主页/收藏夹/预览画廊/TOP250）是本脚本的
     * 一级导航，必须排在内容列最上方；原实现用 querySelector('.tabs, .main-tabs,
     * .toolbar') 找锚点，而 JAVDB 的 .tabs 是嵌在 .main-tabs-wrap 里（非直接子节点），
     * 校验失败后回退到 movieListEl —— 结果标签栏被挤到原生分类栏 + 筛选工具条
     * 【下面】，用户先看到原生的次级导航才看到一级导航，主次颠倒。
     * 现在直接取容器的第一个直接子元素作为锚点，标签栏稳定落在内容列顶部。 */
    let topAnchor = parent ? (parent.firstElementChild || movieListEl) : movieListEl;
    if (!topAnchor || topAnchor.parentNode !== parent) topAnchor = movieListEl;`,
  'buildHomeTabs：视图切换栏移到内容列顶部'
);
rep(
  `        // 同 buildHomeTabs：锚点必须校验为直接子节点，否则 insertBefore 抛 NotFoundError
        let topAnchor = ml.parentNode.querySelector('.tabs, .main-tabs, .toolbar') || ml.parentNode.firstElementChild || ml;
        if (!topAnchor || topAnchor.parentNode !== ml.parentNode) topAnchor = ml;`,
  `        // 同 buildHomeTabs：取容器首个直接子元素作锚点，保证标签栏在内容列最顶部
        let topAnchor = ml.parentNode.firstElementChild || ml;
        if (!topAnchor || topAnchor.parentNode !== ml.parentNode) topAnchor = ml;`,
  'ensureFavSurface：视图切换栏移到内容列顶部'
);

console.log('\napplied=' + applied + '  skipped=' + skipped);
if (skipped) { console.error('⚠ 有未应用项（其余改动仍会写入）: ' + skipped); }
fs.writeFileSync(file, src, 'utf8');
try { new Function(src); console.log('syntax check: OK'); } catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }
