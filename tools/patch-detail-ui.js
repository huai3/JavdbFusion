/*
 * JavdbFusion 详情页 UI 增强补丁
 *   ① 详情页选项卡面板：概览 / 磁力 / 短评 / 相关清单 / 磁力聚合
 *   ② 右侧锚点导航（随页签联动）
 *   ③ 状态优先级统一：已入库 > 已收藏 > 已观看 > 想看 > 有评分（卡片左上角单枚角标）
 *   ④ 字幕搜索（合并进「概览」页签）
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
function repx(re, newStr, label) {
  const before = src;
  src = src.replace(re, newStr);
  if (before === src) { console.log('  MISS  ' + label); skipped++; return; }
  applied++; console.log('  ok    ' + label);
}

console.log('== 详情页 UI 增强补丁 ==');

/* ---------------------------------------------------------------- */
/* 插入新的模块代码（放在 restructureGrid 之前，作用域与详情页函数一致）  */
/* ---------------------------------------------------------------- */
const MODULE = `
    /* =======================================================================
     * 详情页选项卡面板 + 锚点导航 + 状态优先级 + 字幕搜索
     * ===================================================================== */
    const DETAIL_TAB_DEFS = [
      { key: 'overview', label: '概览', icon: 'dashboard' },
      { key: 'magnet', label: '磁力', icon: 'link' },
      { key: 'review', label: '短评', icon: 'rate_review' },
      { key: 'list', label: '相关清单', icon: 'playlist_play' },
      { key: 'agg', label: '磁力聚合', icon: 'hub' }
    ];
    // 原生磁链/短评/相关清单页签的选择器：脚本保留原生 movie-tab 组件
    // （不隐藏 .columns[data-controller="movie-tab"]），这里直接驱动它，
    // 不做 DOM 拆解，避免与 JAVDB 自身的 Stimulus 控制器打架。
    const NATIVE_TAB_SEL = { magnet: null, review: 'a.review-tab', list: 'a.list-tab' };

    function injectDetailUiCss() {
      if (document.getElementById('emby-detail-ui-css')) return;
      const st = document.createElement('style');
      st.id = 'emby-detail-ui-css';
      st.textContent = [
        '.emby-dtabbar{display:flex;gap:.55em;align-items:center;padding:.5em 0 .45em;',
        'position:sticky;top:var(--e-header-h,4.327em);z-index:40;',
        'background:linear-gradient(to bottom,rgba(22,24,29,.98) 68%,rgba(22,24,29,0));',
        'backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);}',
        '.emby-dtab{display:inline-flex;align-items:center;gap:.4em;padding:.5em 1.15em;border-radius:999px;',
        'font-size:.88em;font-weight:600;cursor:pointer;white-space:nowrap;text-decoration:none;',
        'color:#b9a7e8;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);',
        'transition:background-color .2s ease,color .2s ease,border-color .2s ease,transform .2s ease;}',
        '.emby-dtab:hover{background:rgba(255,255,255,.12);color:#fff;transform:translateY(-1px);}',
        '.emby-dtab.active{background:var(--e-accent,#00a4dc);color:#04121a;border-color:var(--e-accent,#00a4dc);',
        'box-shadow:0 3px 14px rgba(0,164,220,.35);}',
        '.emby-dtab .emby-dtab-count{font-size:.78em;opacity:.75;font-weight:700;}',
        '.emby-dpane[hidden]{display:none !important;}',
        '.emby-anchor{position:fixed;right:8px;top:50%;transform:translateY(-50%);z-index:2147483500;',
        'display:flex;flex-direction:column;gap:1px;padding:7px 5px;border-radius:12px;',
        'background:rgba(20,23,29,.86);border:1px solid rgba(255,255,255,.1);',
        'backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);',
        'box-shadow:0 10px 30px rgba(0,0,0,.5);width:30px;}',
        '.emby-anchor-title{font-size:9.5px;letter-spacing:.04em;color:#8d7cb3;padding:1px 0 5px;',
        'border-bottom:1px solid rgba(255,255,255,.1);margin-bottom:3px;font-weight:700;text-align:center;}',
        '.emby-anchor a{display:flex;align-items:center;justify-content:center;gap:.35em;',
        'padding:6px 4px;border-radius:7px;font-size:11px;line-height:1.2;',
        'color:#b9a7e8;text-decoration:none;white-space:nowrap;',
        'border-left:2px solid transparent;',
        'transition:background-color .18s ease,color .18s ease,border-color .18s ease;}',
        '.emby-anchor a .emby-anchor-t{display:none;}',
        '.emby-anchor:hover{width:auto;padding-right:9px;}',
        '.emby-anchor:hover a .emby-anchor-t{display:inline;}',
        '.emby-anchor a:hover{background:rgba(255,255,255,.1);color:#fff;}',
        '.emby-anchor a.current{background:rgba(0,164,220,.18);color:#fff;border-left-color:var(--e-accent,#00a4dc);font-weight:700;}',
        'html.emby-has-anchor .emby-detail-body{padding-right:3.4em;}',
        '.emby-status-pill{position:absolute;left:6px;top:6px;z-index:6;display:inline-flex;',
        'align-items:center;gap:3px;padding:2px 7px;border-radius:999px;font-size:10.5px;',
        'font-weight:800;letter-spacing:.02em;color:#fff;box-shadow:0 2px 8px rgba(0,0,0,.55);',
        'pointer-events:none;line-height:1.6;}',
        '.emby-status-pill.s-inlib{background:linear-gradient(135deg,#2bb673,#0f8f52);}',
        '.emby-status-pill.s-fav{background:linear-gradient(135deg,#ff5f7e,#c9184a);}',
        '.emby-status-pill.s-watched{background:linear-gradient(135deg,#4d8bff,#2451c9);}',
        '.emby-status-pill.s-want{background:linear-gradient(135deg,#ffb703,#f08c00);color:#241a00;}',
        '.emby-status-pill.s-rating{background:linear-gradient(135deg,#b58cff,#7b4fd6);}',
        '.emby-sub-block{margin-top:1.4em;background:rgba(20,23,29,.8);border:1px solid rgba(255,255,255,.08);',
        'border-radius:12px;padding:1em 1.1em;}',
        '.emby-sub-head{display:flex;align-items:center;gap:.5em;font-size:.95em;font-weight:600;',
        'color:var(--e-text);margin-bottom:.7em;}',
        '.emby-sub-head .material-symbols-outlined{color:var(--e-accent,#00a4dc);}',
        '.emby-sub-list{display:flex;flex-direction:column;gap:.35em;max-height:260px;overflow:auto;}',
        '.emby-sub-item{display:block;padding:.45em .6em;border-radius:8px;font-size:.82em;',
        'background:rgba(255,255,255,.05);color:var(--e-text2);text-decoration:none;',
        'border:1px solid rgba(255,255,255,.06);}',
        '.emby-sub-item:hover{background:rgba(255,255,255,.11);color:var(--e-text);}',
        '.emby-sub-empty{font-size:.82em;color:var(--e-text3);padding:.5em 0;}'
      ].join('\\n');
      (document.head || document.documentElement).appendChild(st);
    }

    function buildDetailUi() {
      const dr = document.getElementById('emby-detail-root');
      if (!dr) return;
      injectDetailUiCss();
      const body = dr.querySelector('.emby-detail-body');
      if (!body) return;
      const hero = body.querySelector('.emby-detail-hero');
      if (!hero) return;

      // 已被脚本接管的内容块（预览图 / TA(们)还出演过 / 你可能也喜欢）
      const ownSecs = [];
      body.querySelectorAll(':scope > .emby-sec').forEach(function (s) { ownSecs.push(s); });
      dr.querySelectorAll(':scope > .emby-sec').forEach(function (s) { ownSecs.push(s); });
      // 原生 movie-tab 组件（磁链/短评/相关清单）—— 保留并搬进「原生内容」面板
      const nativeCol = document.querySelector('.columns[data-controller="movie-tab"]');

      let bar = dr.querySelector('.emby-dtabbar');
      if (!bar) {
        bar = document.createElement('div');
        bar.className = 'emby-dtabbar';
        body.insertBefore(bar, hero);
      }
      bar.innerHTML = '';
      const panes = {};
      DETAIL_TAB_DEFS.forEach(function (def) {
        const a = document.createElement('a');
        a.className = 'emby-dtab';
        a.href = '#emby-dtab-' + def.key;
        a.dataset.dtab = def.key;
        a.innerHTML = '<span class="material-symbols-outlined" style="font-size:1em;">' + def.icon + '</span>' + def.label;
        bar.appendChild(a);
        const pane = document.createElement('div');
        pane.className = 'emby-dpane';
        pane.id = 'emby-dtab-' + def.key;
        pane.hidden = true;
        body.appendChild(pane);
        panes[def.key] = pane;
      });

      // 概览面板：脚本自己的内容块 + 字幕搜索
      ownSecs.forEach(function (s) { panes.overview.appendChild(s); });
      panes.overview.appendChild(buildSubtitleBlock());

      // 原生内容面板：把原生 movie-tab 搬进来（Stimulus 控制器跟随元素走，不受影响）
      if (nativeCol) panes.magnet.appendChild(nativeCol);

      // 磁力聚合面板：脚本的磁力搜索条（默认挂在 #magnets-content 里，这里搬进独立面板）
      const aggPane = panes.agg;
      const magHome = document.getElementById('magnets-content');
      let magPanel = document.getElementById('jf-magnet-panel');

      function switchTab(key) {
        DETAIL_TAB_DEFS.forEach(function (def) {
          const on = def.key === key;
          const pane = panes[def.key];
          if (pane) pane.hidden = !on;
          const t = bar.querySelector('[data-dtab="' + def.key + '"]');
          if (t) t.classList.toggle('active', on);
        });
        // 概览之外的页签隐藏 hero（把内容顶上来，避免大片空白封面挡住内容）
        hero.style.display = (key === 'overview') ? '' : 'none';
        // 磁力聚合：把磁力条搬进独立面板；其它页签搬回原位
        if (key === 'agg') {
          magPanel = document.getElementById('jf-magnet-panel');
          if (magPanel && magPanel.parentNode !== aggPane) aggPane.appendChild(magPanel);
        } else if (magPanel && magPanel.parentNode === aggPane) {
          const back = magHome || panes.magnet;
          if (back) back.insertBefore(magPanel, back.firstChild);
        }
        // 驱动原生页签
        const sel = NATIVE_TAB_SEL[key];
        if (sel) {
          const link = nativeCol ? nativeCol.querySelector(sel) : null;
          if (link) { try { link.click(); } catch (e) {} }
        } else if (key === 'magnet' && nativeCol) {
          const first = nativeCol.querySelector('.tabs li a');
          if (first) { try { first.click(); } catch (e) {} }
        }
        // 锚点高亮
        document.querySelectorAll('.emby-anchor a').forEach(function (a) {
          a.classList.toggle('current', a.dataset.dtab === key);
        });
        try { history.replaceState(null, '', '#emby-dtab-' + key); } catch (e) {}
      }

      bar.addEventListener('click', function (e) {
        const t = e.target.closest('[data-dtab]');
        if (!t) return;
        e.preventDefault();
        switchTab(t.dataset.dtab);
      });

      // 锚点导航
      let anchor = document.querySelector('.emby-anchor');
      if (!anchor) {
        anchor = document.createElement('div');
        anchor.className = 'emby-anchor';
        anchor.innerHTML = '<div class="emby-anchor-title">导航</div>';
        DETAIL_TAB_DEFS.forEach(function (def) {
          const a = document.createElement('a');
          a.href = '#emby-dtab-' + def.key;
          a.dataset.dtab = def.key;
          a.title = def.label;
          a.innerHTML = '<span class="material-symbols-outlined" style="font-size:15px;">' + def.icon + '</span><span class="emby-anchor-t">' + def.label + '</span>';
          anchor.appendChild(a);
        });
        document.body.appendChild(anchor);
        anchor.addEventListener('click', function (e) {
          const a = e.target.closest('[data-dtab]');
          if (!a) return;
          e.preventDefault();
          const t = bar.querySelector('[data-dtab="' + a.dataset.dtab + '"]');
          if (t) t.click();
        });
        document.documentElement.classList.add('emby-has-anchor');
      }

      const initial = (location.hash || '').replace('#emby-dtab-', '');
      switchTab(DETAIL_TAB_DEFS.some(function (d) { return d.key === initial; }) ? initial : 'overview');
    }

    /* ---------- 字幕搜索（合并进「概览」） ---------- */
    function buildSubtitleBlock() {
      const block = document.createElement('div');
      block.className = 'emby-sub-block';
      block.innerHTML =
        '<div class="emby-sub-head"><span class="material-symbols-outlined">subtitles</span>' +
        '字幕搜索<span class="emby-dtab-count" data-sub-count></span></div>' +
        '<div class="emby-sub-tools" style="display:flex;gap:.5em;align-items:center;margin-bottom:.6em;">' +
        '<input type="text" class="jhs-input-text" data-sub-input placeholder="字幕关键词（默认取番号）" style="flex:1;min-width:0;">' +
        '<button type="button" class="jf-magtool-btn" data-sub-go>搜索</button>' +
        '</div><div class="emby-sub-list" data-sub-list><div class="emby-sub-empty">输入关键词后点「搜索」，' +
        '将从 SubtitleCat 与迅雷字幕检索当前作品。</div></div>';
      const list = block.querySelector('[data-sub-list]');
      const input = block.querySelector('[data-sub-input]');
      const countEl = block.querySelector('[data-sub-count]');
      block.querySelector('[data-sub-go]').addEventListener('click', async function () {
        const kw = (input.value || '').trim() || (currentPageCode ? currentPageCode() : '');
        if (!kw) return;
        list.innerHTML = '<div class="emby-sub-empty">搜索中…</div>';
        const hits = [];
        try {
          const r = await gmReq({ url: 'https://subtitlecat.com/index.php?search=' + encodeURIComponent(kw), timeout: 9000, headers: { 'Accept': 'text/html' } });
          const doc = new DOMParser().parseFromString(r.responseText || '', 'text/html');
          doc.querySelectorAll('a[href*="/subtitles/"]').forEach(function (a) {
            const t = (a.textContent || '').replace(/\\s+/g, ' ').trim();
            if (t && hits.length < 30) hits.push({ title: t, url: a.href });
          });
        } catch (e) {}
        try {
          const r2 = await gmReq({ url: 'https://api-shoulei-ssl.xunlei.com/oracle/subtitle?name=' + encodeURIComponent(kw), timeout: 9000, headers: { 'Accept': 'application/json' } });
          const j = JSON.parse(r2.responseText || '{}');
          (j.data || []).forEach(function (it) {
            if (it && hits.length < 40) hits.push({ title: (it.title || it.filename || it.subtitle_name || '字幕') + (it.lang ? ' · ' + it.lang : ''), url: it.url || it.subtitle_url || '' });
          });
        } catch (e) {}
        countEl.textContent = hits.length ? '（' + hits.length + '）' : '';
        if (!hits.length) { list.innerHTML = '<div class="emby-sub-empty">未找到字幕。</div>'; return; }
        list.innerHTML = hits.map(function (h) {
          return '<a class="emby-sub-item" href="' + escapeAttr(h.url) + '" target="_blank" rel="noopener">' + escapeHtml(h.title) + '</a>';
        }).join('');
      });
      return block;
    }

    /* ---------- 状态优先级统一 ---------- */
    const STATUS_PRIORITY = [
      { key: 'inlib', cls: 's-inlib', icon: 'local_movies', label: '已入库' },
      { key: 'fav', cls: 's-fav', icon: 'favorite', label: '已收藏' },
      { key: 'watched', cls: 's-watched', icon: 'check_circle', label: '已观看' },
      { key: 'want', cls: 's-want', icon: 'bookmark', label: '想看' },
      { key: 'rating', cls: 's-rating', icon: 'star', label: '有评分' }
    ];
    function detectItemStatus(item) {
      const st = {};
      if (item.querySelector('.jf-lib-chips, .jf-lib-dot, .jf-lib-badge, .emby-lib-badge')) st.inlib = 1;
      if (item.querySelector('.efav-award-badge, .emby-trophy-tag, .efav-fav-flag, [data-efav-fav="1"]')) st.fav = 1;
      const c = item.querySelector('.cover-status-buttons .csb-status-container');
      const cls = c ? c.className : '';
      if (/show-watched/.test(cls)) st.watched = 1;
      if (/show-wanted/.test(cls)) st.want = 1;
      if (item.querySelector('.cover-status-buttons .star-arc-container')) st.rating = 1;
      return st;
    }
    function applyStatusPriority(item) {
      if (!item || item.querySelector('.emby-status-pill')) return;
      const box = item.querySelector('.box');
      if (!box) return;
      const st = detectItemStatus(item);
      const hit = STATUS_PRIORITY.find(function (p) { return st[p.key]; });
      if (!hit) return;
      const pill = document.createElement('span');
      pill.className = 'emby-status-pill ' + hit.cls;
      pill.innerHTML = '<span class="material-symbols-outlined" style="font-size:1.05em;vertical-align:-2px;">' + hit.icon + '</span>' + hit.label;
      const cover = box.querySelector('.cover') || box;
      cover.appendChild(pill);
    }
`;

repx(
  /\n {2}function restructureDetail\(force\) \{/,
  '\n' + MODULE.replace(/^ {2}/gm, '') + '\n  function restructureDetail(force) {',
  '插入详情页 UI 模块（选项卡/锚点/状态优先级/字幕搜索）'
);

/* 卡片循环里加状态角标 */
repx(
  /(\n {4}items\.forEach\(function \(item\) \{\n {6}item\.dataset\.gridDone = '1';\n {6}const box = item\.querySelector\('\.box'\);\n {6}if \(!box\) return;)/,
  `$1\n      try { applyStatusPriority(item); } catch (e) {}`,
  '网格卡片注入状态优先级角标'
);

repx(
  /(  overflow-x:hidden !important;)/,
  `  /* overflow-x:clip 取代 hidden：hidden 会让 body 变成滚动容器，
   * 导致页内 position:sticky（详情页选项卡栏）相对 body 而非视口定位 → 吸顶失效。
   * clip 同样能裁掉横向溢出，但不会创建滚动容器。 */
  overflow-x:clip !important;`,
  'body overflow-x:hidden -> clip（修复 sticky 吸顶）'
);

/* 详情页构建完成后调用 buildDetailUi
 * 注意：必须等 dr 真正挂进 document 之后再调用 —— buildDetailUi 依赖
 * document.getElementById('emby-detail-root')，而 dr 是在下面
 * root.parentNode.insertBefore(dr, root) 那一刻才进文档的。 */
repx(
  /(    else \{ document\.body\.appendChild\(dr\); \})/,
  `$1
    try { buildDetailUi(); } catch (e) { log('详情页选项卡构建失败: ' + e.message); }`,
  'restructureDetail 挂载后调用 buildDetailUi'
);

console.log('\napplied=' + applied + '  skipped=' + skipped);
if (skipped) { console.error('⚠ 有未应用项（其余改动仍会写入）: ' + skipped); }
try { new Function(src); console.log('syntax check: OK'); } catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }
fs.writeFileSync(file, src, 'utf8');

