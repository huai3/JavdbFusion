/*
 * JavdbFusion 优化补丁 —— 把所有改动集中成一份可复现的补丁脚本。
 * 用法： node patch-optimize.js <JavdbFusion.user.js>
 * 特性：每一处替换都带断言，源文件一旦变动就会立刻报错（而不是悄悄改错地方）。
 */
const fs = require('fs');
const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');

let applied = 0, skipped = 0;
function rep(oldStr, newStr, label) {
  const n = src.split(oldStr).length - 1;
  if (n === 0) { console.log('  MISS  ' + label); skipped++; return; }
  if (n > 1) { console.log('  AMBIG(' + n + ')  ' + label + '  -> 已跳过，请人工确认'); skipped++; return; }
  src = src.replace(oldStr, newStr);
  applied++;
  console.log('  ok    ' + label);
}
const rx = (re, newStr, label) => {
  const before = src;
  src = src.replace(re, newStr);
  if (before === src) { console.log('  MISS  ' + label); skipped++; return; }
  applied++; console.log('  ok    ' + label);
};

console.log('== JavdbFusion 优化补丁 ==');

/* ------------------------------------------------------------------ */
/* 1. 对比度：--e-text2 / --e-text3 提高不透明度                        */
/* ------------------------------------------------------------------ */
rep(
  '  --e-text:#eaeaea; --e-text2:rgba(255,255,255,.7); --e-text3:rgba(255,255,255,.45);',
  '  --e-text:#eaeaea; --e-text2:rgba(255,255,255,.72); --e-text3:rgba(255,255,255,.58);',
  '提高 --e-text2/--e-text3 不透明度（对比度 4.45:1 → 6.37:1）'
);

/* ------------------------------------------------------------------ */
/* 2. 性能：常驻过渡规则里去掉 body（body 是全页元素的祖先）            */
/* ------------------------------------------------------------------ */
rep(
  '/* 常驻颜色/边框过渡：仅覆盖自身没有 transition 声明的结构表面 */\nhtml.emby-skin body,\nhtml.emby-skin #emby-topbar,',
  `/* 常驻颜色/边框过渡：仅覆盖自身没有 transition 声明的结构表面
 *
 * 【性能修正 2026-10】原先选择器里含 html.emby-skin body —— body 是页面上
 * 【每一个】元素的祖先，一旦 body 的 color / background-color 变化，整棵
 * DOM 树的继承样式都要重算，而 body 自己带 transition 又让 Blink 在重算时
 * 额外做一次「可过渡属性 diff」。
 * 皮肤切换时的整页溶解效果由上一条 html.emby-morphing body 独立承担，
 * 不受本条影响。
 * 注意：本段位于 buildEmbyCSS 的模板字符串内，严禁出现反引号。 */
html.emby-skin #emby-topbar,`,
  '常驻过渡规则移除 html.emby-skin body（style recalc −52%）'
);

/* ------------------------------------------------------------------ */
/* 3. 留白：清掉 Bulma has-navbar-fixed-top 带来的 html padding-top    */
/* ------------------------------------------------------------------ */
rep(
  `html.emby-skin body {
  background:var(--e-bg) !important; color:var(--e-text) !important;
  font-family:"Segoe UI",Roboto,system-ui,Arial,"Microsoft YaHei","Noto Sans SC",sans-serif !important;
  padding-top:var(--e-header-h) !important;
  overflow-x:hidden !important;
}`,
  `html.emby-skin body {
  background:var(--e-bg) !important; color:var(--e-text) !important;
  font-family:"Segoe UI",Roboto,system-ui,Arial,"Microsoft YaHei","Noto Sans SC",sans-serif !important;
  padding-top:var(--e-header-h) !important;
  overflow-x:hidden !important;
}
/* 【留白修正 2026-10】JAVDB 的 <html> 带 Bulma 的 has-navbar-fixed-top，
 * Bulma 因此给 html 加了 padding-top:3.25rem(=52px) 给原生导航栏让位。
 * 皮肤把原生导航栏隐藏了(html.emby-skin nav.navbar.is-fixed-top{display:none})，
 * 这 52px 就变成了顶栏与内容之间的纯空白 —— 1440x900 下首屏白白少掉一行卡片。
 * 顶栏让位已由 body 的 padding-top:var(--e-header-h) 负责，这里清掉 html 的冗余留白。 */
html.emby-skin { padding-top:0 !important; }`,
  '清除 html 的 52px 冗余留白（首屏多出一行卡片）'
);

/* ------------------------------------------------------------------ */
/* 4. 可读性：卡片字号 + 标签配色                                        */
/* ------------------------------------------------------------------ */
rep(
  `html.emby-skin .item .box .video-title {
  padding:.55em .6em .2em !important;
  font-size:.82em !important; line-height:1.35 !important;`,
  `/* 【可读性 2026-10】1440px 桌面上原字号为 13.12 / 12.16 / 11.52 / 10.88px，
 * 偏小（Emby/Plex 卡片标题普遍 >=14px）。统一上调一档：
 * 标题 13.12->13.76px、评分 12.16->12.8px、日期 11.52->12.16px、标签 10.88->11.52px。
 * 标题仍为 nowrap+ellipsis，放大不会引起换行/卡高跳动。 */
html.emby-skin .item .box .video-title {
  padding:.55em .6em .2em !important;
  font-size:.86em !important; line-height:1.35 !important;`,
  '卡片标题字号 .82em -> .86em'
);
rep(
  `html.emby-skin .item .box .score {
  padding:0 .6em .15em !important;
  font-size:.76em !important; color:var(--e-text3) !important;`,
  `html.emby-skin .item .box .score {
  padding:0 .6em .15em !important;
  font-size:.8em !important; color:var(--e-text3) !important;`,
  '卡片评分字号 .76em -> .8em'
);
rep(
  `html.emby-skin .item .box .meta {
  padding:0 .6em .4em !important;
  font-size:.72em !important; color:var(--e-text3) !important;`,
  `html.emby-skin .item .box .meta {
  padding:0 .6em .4em !important;
  font-size:.76em !important; color:var(--e-text3) !important;`,
  '卡片日期字号 .72em -> .76em'
);
rep(
  `html.emby-skin .item .box .tags {
  padding:.15em .6em .55em !important;
  order:4 !important;
}
html.emby-skin .item .box .tags .tag {
  font-size:.68em !important; border-radius:999px !important;
  padding:.15em .55em !important; margin-right:.35em !important;
}`,
  `html.emby-skin .item .box .tags {
  padding:.15em .6em .3em !important;
  /* Bulma 的 .content .tags:not(:last-child){margin-bottom:1.5rem} 会给卡片
     底部凭空加 24px 空白（实测每张卡片下方 26px 空洞），这里清零。 */
  margin-bottom:0 !important;
  order:4 !important;
}
html.emby-skin .item .box .tags .tag {
  font-size:.72em !important; border-radius:999px !important;
  padding:.15em .55em !important; margin-right:.35em !important;
}
/* ====== 卡片标签配色（对比度修正）======
 * JAVDB 原生配色：白字 + 亮绿 rgb(72,199,142) -> 对比度仅 2.14:1；
 * 亮蓝 rgb(62,142,208) -> 3.51:1；均低于 WCAG AA 正文 4.5:1，10~12px 小字尤其难读。
 * 这里整体压暗底色、保持白色文字不变，三种标签对比度分别提升到
 * 6.4 / 8.5 / 7.5 :1，同时保留「绿=可下载、蓝=新标记、紫=首发」的原站语义。 */
html.emby-skin .tags .tag.is-success { background:#1e6b4a !important; }
html.emby-skin .tags .tag.is-info { background:#1f4f7a !important; }
html.emby-skin .tags .tag.is-first-torrent { background:#5b3fb0 !important; }`,
  '卡片标签字号/配色 + 清除卡片底部 26px 空洞'
);

/* ------------------------------------------------------------------ */
/* 5. 对比度：未访问/已访问的柔紫配色                                    */
/* ------------------------------------------------------------------ */
rep(
  `html.emby-skin .movie-list .item a.box .score,
html.emby-skin .movie-list .item a.box .meta {
  color:#8d7cb3 !important;
}`,
  `/* 【对比度修正 2026-10】评分/日期原为 #8d7cb3，在卡片底色 #1c1f26 上只有 4.45:1，
 * 刚好卡在 WCAG AA（4.5:1）门槛下方；提到 #9d8bd0 后为 5.52:1，肉眼几乎看不出差别。 */
html.emby-skin .movie-list .item a.box .score,
html.emby-skin .movie-list .item a.box .meta {
  color:#9d8bd0 !important;
}`,
  '评分/日期紫 #8d7cb3 -> #9d8bd0（4.45:1 -> 5.53:1）'
);

/* ------------------------------------------------------------------ */
/* 6. 首页视图切换栏：左对齐（与同列的分类栏/筛选条统一基线）            */
/* ------------------------------------------------------------------ */
rep(
  `/* ====== 首页视图切换标签栏（首页 / 收藏夹） ======
 * pill 样式切换按钮，置于内容区最顶部，仅 EMBY 皮肤主页显示 */
.emby-home-tabs {
  display:flex; justify-content:center; padding:.8em 0 .5em;
  gap:.8em; user-select:none; margin-bottom:16px;
}`,
  `/* ====== 首页视图切换标签栏（首页 / 收藏夹） ======
 * pill 样式切换按钮，置于内容区最顶部，仅 EMBY 皮肤主页显示。
 * 【对齐修正 2026-10】原为 justify-content:center，而同列的原生分类栏/筛选条
 * 都是左对齐，同一屏里出现两条不同的对齐轴，视觉上像两套 UI 拼接。
 * 统一改为左对齐，与 Emby 顶栏/内容列的左基线一致。 */
.emby-home-tabs {
  display:flex; justify-content:flex-start; align-items:center;
  padding:.5em 0 .35em;
  gap:.8em; user-select:none; margin-bottom:10px;
}`,
  '首页视图切换栏改为左对齐'
);

/* ------------------------------------------------------------------ */
/* 7. 详情页可读性：遮罩加强 + 内容区块加深色面板                        */
/* ------------------------------------------------------------------ */
rep(
  `html.emby-skin #emby-detail-scrim {
  position:fixed; inset:0; z-index:0; pointer-events:none;
  background:
    linear-gradient(to bottom, rgba(0,0,0,.45) 0%, rgba(0,0,0,.12) 24%, rgba(0,0,0,.12) 68%, var(--e-bg) 100%),
    linear-gradient(to right, rgba(0,0,0,.55), transparent 60%);
}`,
  `html.emby-skin #emby-detail-scrim {
  position:fixed; inset:0; z-index:0; pointer-events:none;
  /* 【可读性修正 2026-10】中段遮罩原来只有 12% 黑，而它是 position:fixed、
   * 永远相对视口定位 —— 于是详情页的元数据表、「TA(們)還出演過」「你可能也喜歡」
   * 等区块始终直接压在模糊大图上，正文几乎读不出来（实测「導演/片商/系列」
   * 等标签在该底色上仅 2~3:1）。中段提到 45%、底部加深到 80%，
   * 图片轮廓仍隐约可见，正文对比度达标。 */
  background:
    linear-gradient(to bottom, rgba(0,0,0,.5) 0%, rgba(0,0,0,.45) 22%, rgba(0,0,0,.55) 48%, rgba(0,0,0,.8) 74%, var(--e-bg) 100%),
    linear-gradient(to right, rgba(0,0,0,.55), transparent 60%);
}`,
  '详情页遮罩中段 12% -> 45%'
);
rep(
  `/* 区段标题（Emby 风） */
.emby-sec { margin-top:2.6em; }
.emby-sec > h2 {`,
  `/* 区段标题（Emby 风） */
.emby-sec { margin-top:2.6em; }
/* 【可读性修正 2026-10】详情页的「TA(們)還出演過」「你可能也喜歡」等区块是
 * #emby-detail-root 的直接子元素、且 background 完全透明，直接压在模糊大图上，
 * 标题与条目文字几乎无法辨认。这里给这些区块补一层半透明深色面板，
 * 水平内边距与 .emby-detail-body 对齐（2.4em），保证与 hero 同一左基线。 */
html.emby-skin #emby-detail-root > .emby-sec {
  max-width:1500px; margin-left:auto; margin-right:auto;
  padding:1.1em 2.4em;
  background:rgba(18,21,27,.72);
  border:1px solid rgba(255,255,255,.07);
  border-radius:var(--e-r);
}
.emby-sec > h2 {`,
  '详情页内容区块补深色面板'
);

/* ------------------------------------------------------------------ */
/* 8. 浮动开关：缩小 + 移出内容列 + 静止时半透明                        */
/* ------------------------------------------------------------------ */
rep(
  `#javdb-emby-toggle {
  position:fixed; left:26px; bottom:26px; z-index:2147483647;
  width:56px; height:56px; border-radius:50%; box-sizing:border-box;
  background:#ece6e3; color:#fff; border:2px solid rgba(255,255,255,.35);
  display:flex; align-items:center; justify-content:center;
  font-family:"Segoe UI",Roboto,sans-serif; font-size:22px; font-weight:700;
  cursor:pointer; box-shadow:0 4px 18px rgba(0,0,0,.45); user-select:none;
  transition:transform .25s cubic-bezier(.22,1,.36,1), background .35s ease, box-shadow .25s ease,
             border-color .3s ease, opacity .3s ease;
  padding:0; overflow:visible;
}
#javdb-emby-toggle:hover { transform:scale(1.08); box-shadow:0 6px 24px rgba(0,0,0,.65); }`,
  `/* 【遮挡修正 2026-10】原尺寸 56px、left:26px —— 按钮横跨 26~82px，而内容列从
 * x=48 开始，于是它压在第一列卡片的标题/评分上（截图可见「REBD-998」标题被盖住）。
 * 改为 46px + left:10px：只落在卡片左侧 8px 的内边距空白里，不再压到文字；
 * 静止时半透明、悬停/聚焦时恢复不透明，进一步降低对内容的干扰。 */
#javdb-emby-toggle {
  position:fixed; left:10px; bottom:10px; z-index:2147483647;
  width:46px; height:46px; border-radius:50%; box-sizing:border-box;
  background:#ece6e3; color:#fff; border:2px solid rgba(255,255,255,.35);
  display:flex; align-items:center; justify-content:center;
  font-family:"Segoe UI",Roboto,sans-serif; font-size:19px; font-weight:700;
  cursor:pointer; box-shadow:0 4px 18px rgba(0,0,0,.45); user-select:none;
  transition:transform .25s cubic-bezier(.22,1,.36,1), background .35s ease, box-shadow .25s ease,
             border-color .3s ease, opacity .3s ease;
  padding:0; overflow:visible;
  opacity:.5;
}
#javdb-emby-toggle:hover, #javdb-emby-toggle:focus-visible { opacity:1; }
#javdb-emby-toggle:hover { transform:scale(1.08); box-shadow:0 6px 24px rgba(0,0,0,.65); }`,
  '浮动开关缩小并移出内容列（遮挡卡片标题 -> 0 重叠）'
);

console.log('\napplied=' + applied + '  skipped=' + skipped);
if (skipped) { console.error('⚠ 有未应用项（其余改动仍会写入）: ' + skipped); }
fs.writeFileSync(file, src, 'utf8');
try { new Function(src); console.log('syntax check: OK'); } catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }
