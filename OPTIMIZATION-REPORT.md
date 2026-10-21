# JavdbFusion 优化报告

> 目标：参考 [JAV-JHS](https://sleazyfork.org/zh-CN/scripts/558525-jav-jhs) 与
> [JAV老司机](https://sleazyfork.org/scripts/576375) 两个脚本的做法，
> 对 `JavdbFusion.user.js` 做界面排布、可读性、性能三方面的实测与优化。
>
> 基线版本：`7.364-top250-dedupe`（28,894 行 / 1.51 MB）

---

## 一、怎么测的（可复现）

沙箱环境直连 `javdb.com` 会被 Cloudflare 拦（PowerShell 403、CDN 404），
所以改用 **Playwright + 真实 Chromium** 打开线上 JAVDB，并用
`context.addInitScript()` 在 `document-start` 注入用户脚本 —— 等价于
Tampermonkey 的 `@run-at document-start`，GM_* API 用 Node 侧 binding 实现
（`GM_xmlhttpRequest` 走真实跨域请求，`GM_getValue/GM_setValue` 落盘）。

性能用 CDP `Performance.getMetrics` + `Profiler` 采样，场景固定为
**1440×900 视口 / 滚动 8 屏 / 取 58 次采样**。

```powershell
tools\install-node.ps1     # 装便携版 Node 24（免管理员）
tools\install-pw.ps1       # 装 Playwright + Chromium
node tools\pw\compare.js https://javdb.com/ JavdbFusion.user.js.orig JavdbFusion.user.js
node tools\pw\verify.js   JavdbFusion.user.js opt-list https://javdb.com/
node tools\pw\smoke.js     # 6 个页面冒烟
```

> 注：本沙箱 DNS 把 `javdb.com` 解析到了代理 IP，Chromium 需要
> `ignoreHTTPSErrors: true`；你本机直连不需要这个选项。

---

## 二、实测发现的问题

### 2.1 性能：样式重算比原生页面贵 30 倍

先做了一次「拆解式」消融实验，确认瓶颈到底在 CSS 还是 JS：

| 模式 | task | script | layout | **recalcStyle** | 样式表 | DOM 节点 |
|---|---|---|---|---|---|---|
| 原生 JAVDB | 86 ms | 15 ms | 8 ms | **6 ms** | 0 KB | 1066 |
| 只注入皮肤 CSS（不跑 JS） | 97 ms | 25 ms | 9 ms | **10 ms** | 239 KB | 1067 |
| 只跑脚本 JS（不注入 CSS） | 260 ms | 109 ms | 25 ms | **20 ms** | 25 KB | 1769 |
| 完整（当前线上版本） | 604 ms | 107 ms | 104 ms | **193 ms** | 265 KB | 1763 |

结论很清楚：**CSS 单独很便宜，JS 单独也不贵，两者叠加起来样式重算飙到 193 ms。**
进一步做「属性消融」定位到真凶：

| 消融项 | task | layout | recalcStyle |
|---|---|---|---|
| 原始 | 609 | 105 | 213 |
| 去掉全部 `transition` 声明 | **241** | 33 | **25** |
| 只把 `transition: all` 换成显式属性 | 533 | **39** | 225 |
| 去掉 `html.emby-skin body` 的常驻过渡 | 512 | 128 | **122** |

**根因 1：`transition: all`（46 处）**
`transition: all` 会把全部可动画属性（含 `width/height/margin/padding/top/font-size`）
登记为可过渡项，Blink 每次样式重算都要对这些属性逐一 diff，布局属性一旦被登记
就会走「脏布局属性」路径 → **布局耗时直接砍掉 63%**。

**根因 2：常驻过渡规则挂在 `body` 上**
`html.emby-skin body { transition: ... }` —— `body` 是页面上每一个元素的祖先，
它一旦有 color/background 变化，整棵 DOM 树的继承样式都要重算。

**根因 3：JAVDB 原生卡片标签是「白字 + 亮绿」**
`rgb(72,199,142)` 配白字只有 **2.14:1**，`rgb(62,142,208)` 蓝字也只有 **3.51:1**，
都低于 WCAG AA 的 4.5:1，而标签字号只有 10.88px。

### 2.2 排布

1. **顶栏与内容之间有 52px 纯空白** —— JAVDB 的 `<html>` 带 Bulma 的
   `has-navbar-fixed-top`，Bulma 因此给 html 加了 `padding-top:3.25rem` 给原生
   导航栏让位；皮肤把原生导航栏隐藏了，这 52px 就变成了没人用的留白。
   1440×900 下首屏因此白白少掉一行卡片。
2. **一级导航被压在二级导航下面** —— 「主页/收藏夹/预览画廊/TOP250」是脚本的
   一级视图切换，却排在 JAVDB 原生的分类栏 + 筛选工具条**下面**。
   根因：`buildHomeTabs` 用 `querySelector('.tabs, .main-tabs, .toolbar')` 找锚点，
   而 JAVDB 的 `.tabs` 是嵌在 `.main-tabs-wrap` 里的（非直接子节点），
   父子校验失败后回退到 `movieListEl`，标签栏就被挤到工具条后面了。
3. **两条对齐轴** —— 标签栏 `justify-content:center`，同列的分类栏/筛选条左对齐，
   一屏之内像两套 UI 拼在一起。
4. **浮动开关压住卡片标题** —— 56px 圆形按钮在 `left:26px`，横跨 26~82px，
   而内容列从 x=48 开始，直接盖住第一列的番号/标题（见 `screenshots/02-*.png`）。
5. **卡片底部 26px 空洞** —— Bulma 的 `.content .tags:not(:last-child){margin-bottom:1.5rem}`。
6. **顶栏→列表总间距 243px**，而卡片区第一行在 y=312，900px 高的视口只放得下 2 行。

### 2.3 可读性

| 元素 | 原色 | 原对比度 | 现对比度 | WCAG AA |
|---|---|---|---|---|
| 卡片标题 | `#b39ddb` | 6.88:1 | 6.88:1 | ✅ |
| 评分 / 日期 | `#8d7cb3` | **4.45:1** | **5.53:1** | 原 ✗ → 现 ✅ |
| 标签（绿） | 白字 / `rgb(72,199,142)` | **2.14:1** | **6.45:1** | 原 ✗ → 现 ✅ |
| 标签（蓝） | 白字 / `rgb(62,142,208)` | **3.51:1** | **8.5:1** | 原 ✗ → 现 ✅ |

字号也偏小（1440px 桌面）：标题 13.12px / 评分 12.16px / 日期 11.52px / 标签 10.88px，
已分别提到 13.76 / 12.8 / 12.16 / 11.52px。

### 2.4 详情页（最严重的一处）

`screenshots/06-before-skin-detail-sections.png` 里，「TA(們)還出演過」「你可能也喜歡」
两个区块的 `background` 是**完全透明**的，直接压在模糊大图上 —— 标题与条目文字
几乎读不出来。原因是遮罩 `#emby-detail-scrim` 是 `position:fixed`，中段只有
`rgba(0,0,0,.12)` 的黑色，等于什么都没遮。

---

## 三、做了什么

### 3.1 性能

| 改动 | 位置 | 说明 |
|---|---|---|
| `transition: all` → 显式属性列表 | 46 处 | 保留全部动效，删掉对几何属性的过渡登记 |
| 常驻过渡规则移除 `html.emby-skin body` | `buildEmbyCSS` | `body` 是全页元素的祖先 |
| 新增「低特效模式」 | 设置 → 外观与显示 | 见下 |

**「低特效模式」的实现方式有个坑，值得记一笔：**
第一版用 `html.emby-skin.reduce-motion * { transition-duration:.001ms !important }`，
结果**更慢了** —— recalcStyle 从 120ms 涨到 334ms。因为这条通配 + `!important`
等于强制 Blink 为整棵树重算「过渡定义」。
正确做法是**在生成皮肤 CSS 时把 `transition` / `animation` / `backdrop-filter`
声明整条剥掉**（见 `buildSkinCss()`），元素上根本没有过渡定义，自然不会触发重算。
系统开启 `prefers-reduced-motion` 时会自动生效（WCAG 2.3.3 / 前庭障碍友好）。

### 3.2 排布

- 清掉 `html` 的 52px 冗余留白 → 顶栏到列表 **243px → 177px**
- 视图切换栏改用「容器第一个直接子元素」作锚点 → 稳定排在内容列**最上方**
- 视图切换栏改为左对齐 → 与分类栏/筛选条同一基线
- 浮动开关 56px → 46px、`left:26px` → `left:10px`、静止时 `opacity:.5`
  → 压在卡片上的数量 **N → 0**
- 卡片标签 `margin-bottom` 清零 → 卡片底部空洞 **26px → 10px**

### 3.3 可读性

- `--e-text2` .70→.72、`--e-text3` .45→.58（全局次要文字 3.0:1 → 6.4:1）
- 评分/日期 `#8d7cb3` → `#9d8bd0`
- 卡片标签三种底色整体压暗，白字对比度 2.14/3.51 → 6.45/8.5
- 卡片标题/评分/日期/标签字号各上调一档
- 详情页遮罩中段 `rgba(0,0,0,.12)` → `.45`、底部 `.8`
- 详情页内容区块补 `rgba(18,21,27,.72)` 深色面板（水平内边距与 hero 对齐）

---

## 四、结果

**性能**（1440×900，滚动 8 屏，CDP Performance 指标）

| 指标 | 优化前 | 优化后 | 变化 |
|---|---|---|---|
| 主线程总耗时 task | 492 ms | **416 ms** | −15% |
| 样式重算 recalcStyle | 193 ms | **107 ms** | **−45%** |
| 布局 layout | 64 ms | **39 ms** | **−39%** |
| 布局次数 layoutCount | 18 | **14** | −22% |
| 顶栏→列表间距 | 243 px | **177 px** | −27% |
| 浮动开关压住卡片数 | N | **0** | — |

**开启「低特效模式」后**（同一场景）

| 指标 | 常规 | 低特效 | 变化 |
|---|---|---|---|
| task | 409 ms | **248 ms** | **−39%** |
| recalcStyle | 103 ms | **24 ms** | **−77%** |
| recalcCount | 59 | **22** | −63% |

**可读性**：所有正文/标签对比度 **≥ 4.5:1**（WCAG AA），字号各上调一档。

**冒烟**：首页 / 详情页 / 搜索页 / 演员页 / 榜单页 / 收藏夹页 —— 全部
`emby-skin` 正常挂载、**零 JS 报错**、无横向溢出。

---

## 五、两个参考脚本里值得继续吸收的东西

以下是我**没有**动的部分，因为改动面大、风险高，建议单独排期：

**来自 JAV-JHS**
1. **详情页选项卡面板**（磁力｜短评｜相关清单｜磁力聚合｜字幕搜索）——
   你的详情页区块已经不少（原生预览 + 两个 `.emby-sec`），做成分页签能明显降低滚动长度。
2. **详情页侧边锚点导航** —— 区块变多后这个几乎必须配。
3. **状态优先级**（收藏｜下载中｜已下载｜已观看 > 黑名单 > 鉴定屏蔽 > 关键词屏蔽 >
   低评分 > 低评价人数）—— 你的状态标记目前是分散的，可以统一成一套优先级。
4. **状态数据从 localStorage 迁到 IndexedDB** —— 你现在有 28 个 localStorage 键、
   221 处调用，收藏夹数据多了会顶到 5MB 配额。

**来自 JAV老司机**
5. **页面缩放 / 自适应布局比例** —— 你已有「封面框架大小」滑块，可以再补一个全局缩放。
6. **按评分 / 评价人数排序** —— 你已有「评分热度」工具条（原生顺序/综合热度/评分/评价数），
   已经覆盖。
7. **JAVDB 无水印封面 / 2K 封面下载** —— 预告片模块可以顺带做。
8. **跨站搜索跳转**（JavBus / JavLibrary / 番号站点）—— 你的「外部网站」面板已有雏形。

---

## 六、改动清单（67 个 hunk，+198 / −70）

- `JavdbFusion.optimize.patch` —— unified diff，可直接 review
- `JavdbFusion.user.js.orig` —— 改动前的原始文件
- `tools/patch-transition-all.js` —— `transition: all` 批量替换
- `tools/patch-optimize.js` —— CSS/排布/可读性 12 处改动（每处带断言）
- `tools/patch-optimize-js.js` —— JS 侧 11 处改动（低特效模式、标签栏位置）
- `tools/pw/lint-userscript.js` —— **静态体检**：检查模板字符串内是否混入了反引号
  （这会静默让整段皮肤 CSS 失效），并实际 eval 一遍 `buildEmbyCSS`
- `tools/pw/compare.js` / `verify.js` / `smoke.js` / `detail-walk.js` —— 性能对比、
  布局与对比度体检、冒烟、详情页逐屏截图

### 一个必须注意的坑

`buildEmbyCSS()` 的 CSS 全部在一个**模板字符串**里。往这段 CSS 里写注释时
**绝对不能出现反引号** —— 它会提前终止模板，后面的 CSS 变成 JS，运行时抛
`SyntaxError: Unexpected identifier 'html'`，整段皮肤**静默失效**（页面看着像
"脚本没生效"，但控制台只有一条报错）。我在本次优化中踩了两次，已把
`tools/pw/lint-userscript.js` 加进流程，每次改完都跑一遍。
