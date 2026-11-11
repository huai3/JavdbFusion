# JavdbFusion 静态审计 + 动态复现报告（2026-11）

> 基线：`f8cca10` / `7.369-trailer-diag`
> 本轮：`fix/ui-trailer-magnet` → `7.370-ui-trailer-magnet`
> 目标：你反馈的 ①短评导航栏 ②预告片多路 / 后台获取 / 默认停止播放 ③磁力聚合不流畅 ④界面可读性

---

## 一、结论摘要

四个问题里有三个不是「手感」问题，而是能稳定复现的代码缺陷：

| 你反馈的问题 | 实际根因 | 动态证据 |
|---|---|---|
| 短评导航栏有问题 | ①原生 movie-tab 被固定挂在「磁力」页签里 → 短评/相关清单页签是**空面板**；②`hero.style.display='none'` 被 `cover-full` 的 `display:block!important` 压过 → 切到短评仍显示整张封面；③每次切页签 `history.replaceState('#emby-dtab-*')` → Chrome 按锚点自动滚动，页面跳到内容中间 | 修复前：`#emby-dtab-review` 的 `innerText` 为空、原生组件 `width=0`；`scrollY=1735`（页面一打开就跳） |
| 预告片应支持多路 / 后台获取 / 默认停止播放 | ①只有 `sources.length>1` 时显示一个 `<select>`，没有「线路」概念；②打开即 `play()` 自动播放；③`close()` 里 `controller.abort()` 把解析一并取消，后台拿不到片源 | 修复前：`paused=false`（自动播放）、下拉 7 项、关闭即中断；修复后：7 条线路平铺、`paused=true`、`preload=auto` 后台缓冲、关闭后重开 1.2s 内命中缓存 |
| 磁力聚合面板不流畅 | ①点 ⟳ 调用了**不存在**的 `magPanelCacheRead()` → `ReferenceError`；②空结果时 `aggSrcUrl()` 对「全部聚合」取 `site.search.replace`（无 search）→ 抛错被显示成「搜索失败：网络错误」；③5 个源用 `Promise.all` 等最慢的源（Sukebei 10s+）才一次性渲染；④详情页一打开就并发打 5 个站外源 | 修复前：点 ⟳ 页面报 `magPanelCacheRead is not defined`，列表停在「搜索中…」；修复后：首源 668ms 出状态、逐源增量渲染、刷新正常 |
| 界面可读性 | 原生磁力标题深蓝压深色卡、短评正文 12px 级别、页签栏渐变透出内容、移动端页签被裁切且不可滚动、顶部推广条把内容顶下去 100+px | 修复后：短评正文实测 `14.5px / 25.81px`、磁力标题 `13.5px`、页签栏实色、移动端横向可滚动 |

---

## 二、静态审计（`eslint no-undef` + 人工）

用 `tools/pw/eslint.config.mjs` 对整文件跑 `no-undef`，抓到的每一条都是真问题：

| 位置（修复前） | 问题 | 后果 |
|---|---|---|
| `magPanelCacheRead`（磁力聚合 `load(true)`） | 函数从未定义 | 点 ⟳ 抛 `ReferenceError`，刷新完全失效 |
| `aggSrcUrl()` | 「全部聚合」的 `MAG_ALL_SITE` 没有 `search` 字段 | 空结果时抛 `TypeError: ... reading 'replace'`，被 catch 成「搜索失败：网络错误」，掩盖真实原因 |
| `buildSubtitleBlock()` 里的 `gmReq` | `gmReq` 是 FUSION 模块内私有函数，字幕搜索在模块外 | 字幕搜索按钮 100% `ReferenceError`，被空 `catch` 吞掉 → 永远「未找到字幕」 |
| TOP250 错误态按钮里的 `switchMode` | 方法实际挂在 `Top250ViewManager` 上 | 「切到免登录热播榜」按钮点了没反应 |
| `newMovieRecord`（封面快捷标记） | 定义在 FAV 模块内，调用处只导出到 `FAV.newMovieRecord` | 对尚未入库的影片打「想看/看过」时抛错 |
| `tryAutoHealCustomMeta` | 同样跨模块，`typeof ... === 'function'` 恒为 false | 自动纠错静默失效（不崩） |
| `preparedRows()` | 同一段「加来源前缀」代码重复两遍，且直接改缓存行 | 标题会叠加 `[Sukebei] [Sukebei]` 并写回缓存 |
| `fetchMagnetResults('all')` | 被 abort 时仍把空/半截结果写缓存 30 分钟 | 切番号后一直显示「未找到」 |
| `buildDetailUi` / `switchTab` | 原生 movie-tab 固定挂在磁力页签；其他页签是空 div | 短评/相关清单空白 |
| `hero.style.display` | 被 `cover-full` 的 `!important` 覆盖 | 短评页仍显示整张封面，内容被推到屏幕外 |
| `history.replaceState('#emby-dtab-*')` | Chrome 对 fragment 做自动滚动 | 打开详情页/切页签时页面跳到内容中间 |
| `buildDmmDirectCandidates` 文案 | `mhb_w` 标成「404p 高」、`dmb_w` 标成「404p 宽」 | 画质菜单误导用户 |

> 说明：本轮还顺手修了 `parseBtdig/parseU9a9/parseBtsow` 的作用域（重构 `fetchMagnetResults` 时一度被误删，已按原实现恢复并回归）。

---

## 三、动态测试：方法与工具

### 为什么不用「打开 javdb 点一点」

- 未登录时短评/相关清单只返回登录提示，覆盖不到真实列表；
- JAVDB 有年龄门、Cloudflare、登录态，人工点击不可复现；
- 需要拿到 `console/pageerror`、网络请求、元素尺寸、视频 `paused/readyState` 这类可断言的证据。

### 方案：Playwright + GM 垫片（`tools/pw/`）

```
Playwright Chromium
  ├─ addInitScript(gm-shim.js)          # 实现 GM_getValue/GM_setValue/GM_xmlhttpRequest...
  ├─ exposeBinding('__gmFetch')         # 页面里的 GM 请求 → Node fetch（绕 CORS，接近 Tampermonkey）
  ├─ addInitScript(JavdbFusion.user.js) # 以 document-start 注入，和油猴一致
  └─ page.evaluate(...)                 # 断言 DOM/样式/视频状态，截图留证
```

关键点：

1. **GM 垫片**：`GM_xmlhttpRequest` 返回可 abort 的 task，回调形状与 TM 一致；`GM_getValue` 用内存 Map（每次跑都是干净配置）。
2. **真实网络**：Node `fetch` 走本机出口，能真实触发 DMM / Sukebei / 磁力源站；失败也按真实失败记录。
3. **不依赖登录**：`window.openAuthModal=function(){}` 抑制登录弹窗；短评排版用 `review-mock.js` 注入 16 条 mock 数据。
4. **证据可读**：输出 `out/live-check.json` + `overview/tab-*/agg/trailer` 截图。

### 复现命令

```bash
cd tools/pw
npm i playwright && npx playwright install chromium

node live-check.js https://javdb.com/v/xJqp6   # 全链路
node review-mock.js                            # 短评/相关清单排版
```

---

## 四、动态复现数据（修复前 → 修复后）

| 检查项 | 修复前（`orig.user.js`） | 修复后 |
|---|---|---|
| 详情页打开时 `scrollY` | **1735**（自动跳到内容中间） | **0** |
| 地址栏 | `#emby-dtab-overview` | `?dtab=overview`（无锚点、无滚动） |
| 短评页签 `innerText` | **空**，原生组件 `width=0` | 非空、原生组件在页签内（`nativeInPane=true`） |
| 相关清单页签 | 空 | mock 数据 1 条，正常渲染 |
| 磁力聚合 ⟳ | `ReferenceError: magPanelCacheRead is not defined`，列表卡在「搜索中…」 | 正常刷新、`aria-busy` 正确、无报错 |
| 磁力聚合首源反馈 | 无（旧 UI 只有整块「搜索中…」） | **668ms** 出第一个源状态；逐源增量渲染 |
| 打开详情页即打的磁力源请求 | **2 个**（且还在排队） | **0 个**（进入页签才加载） |
| 预告片打开时 `video.paused` | **false（自动播放）** | **true（默认暂停）** |
| 预告片线路 UI | 一个 `<select>`，7 项 | 7 条平铺「线路」按钮 + 可用性圆点 |
| 关闭播放器 | `AbortController.abort()` 取消解析 | 不取消，后台继续解析；重开 **~1.2s** 命中缓存 |
| 短评正文实测 | 未进入页签，无法测量 | `14.5px / 25.81px / rgba(255,255,255,.86)` |
| 移动端 390px 页签栏 | 超出裁切、不可滚动 | `overflow-x:auto` 可横向滑动，侧边导航隐藏 |
| `no-undef` | 10 条 | **0 条** |

截图见 `tools/pw/out/`：`tab-review.png`、`tab-agg.png`、`trailer.png`、`review-mock.png`、`edge-mobile.png`。

---

## 五、修改清单（全部在 `JavdbFusion.user.js`）

### 1. 详情页页签 / 短评

- `buildDetailUi()`（L24986）
  - 原生 movie-tab 改为**跟随当前页签挂载**（磁力/短评/相关清单共用），不再固定挂在磁力页签；
  - 隐藏重复的原生页签条，把「短評(16)」计数搬到 Emby 页签；
  - 页签状态改用 `?dtab=`，不再写 `#hash`；支持 `ArrowLeft/ArrowRight` 键盘切换；
  - 切页签时若页面已滚过页签栏，回到页面顶部（不再用 hero 矩形计算，避免过渡期过冲）。
- `switchTab()`：hero 用 `style.setProperty('display','none','important')`，覆盖 `cover-full` 的 `!important`。
- `updateRelatedSections()`：推荐行收进「概览」面板，不再常驻所有页签。
- `removeDetailDom()`：重建/换页前把原生 movie-tab 搬回原位，避免随根节点被销毁。
- 页签栏实色化、短评正文 14.5px/1.78、原生磁力标题 `#9ecbff`、原生面板统一深色卡片。

### 2. 预告片（L27864 起）

- `openTrailerPlayer()` 重写：
  - **默认暂停**：只 `preload="auto"` 预载 + 大播放按钮，用户点才 `play()`；
  - **多线路平铺**：每条线路显示 label/来源/可用性圆点，点击即切；
  - **后台解析**：关闭弹窗不再 abort；`prefetchTrailerInBackground()` 在详情页空闲 1.5s 预热；
  - `probeTrailerUrl()` 对每条线路发 1 字节 Range 请求，后台标出可用/失效；
  - 自动换线：播放失败自动试下一条；全部失败才显示诊断；
  - 记住上次线路；「自动播放」勾选持久化（`jf_tr_autoplay`，默认 false）。
- 设置页新增：自动播放 / 后台预热 / 后台探测三个开关。
- 修正 DMM 画质文案：`mhb_w → 720p 宽`、`dmb_w → 480p 宽`。

### 3. 磁力聚合（L28868 起）

- `fetchMagnetResults(code, siteId, signal, onPart)`：新增逐源回调；空结果/被 abort 不写缓存。
- `injectMagnetPanel()`：
  - 懒加载：只有进入「磁力 / 磁力聚合」页签才 `load()`；
  - 逐源增量渲染 + 顶部每源状态条（成功数量 / 失败原因 / pending 转圈）；
  - 修复 `magPanelCacheRead`、`aggSrcUrl` 空源崩溃；
  - ⟳ 真正清掉所有源的 per-key 缓存，按钮加载态 + `aria-busy`；
  - 来源前缀只在渲染层加，不再污染缓存；去重保留做种最高。
- 删除 `preparedRows()` 重复代码。

### 4. 可读性 / 移动端

- 页签栏实色 + 分隔线 + 更大点击区；锚点导航 36px/12px；
- 原生磁力行标题/日期/标签提亮放大；短评标题 flex 布局、时间右对齐；
- 隐藏 `nav.sub-header` 与 `.site-announce` 推广条（原来把内容往下顶 100+px）；
- 移动端页签栏横向滚动、隐藏侧边锚点、原生面板内边距收紧。

---

## 六、仍建议后续处理（本轮未动）

1. **真实登录态回归**：短评 16 条、相关清单的「加载更多」需要你的账号复验；mock 只覆盖排版。
2. **DMM 探测命中率**：部分网络下 `cc3001` 的 Range 探测会被防盗链拒绝，圆点可能显示红；不影响手动切线路。
3. **115 整理面板**：仍无法在沙箱登录 115，端到端未验。
4. **`hasAnyVerifiedSource` / javspyl**：javspyl 目前连接层失败，已压缩到 1.2s 超时，不再拖慢整体。

---

## 七、第二轮：短评排序 / ed2k→115 / 概览下方区块（7.371）

### 1. 短评「最新 / 最热」

- 数据源：JAVDB 短评接口 `https://jdforrepam.com/api/v1/movies/:id/reviews?page=1&limit=20&sort_by=recently|hotly`，复用 `ReviewListInfiniteManager.fetchData` 的 `jdSignature`，**不需要登录、不需要 Token**（实测本机直接返回 20 条）。
- 页面内新增工具栏：`最新 / 最热 / 原站`。
  - 默认仍显示 JAVDB 原站短评，保留点赞 / 举报；
  - 点「最新」或「最热」切到 API 列表，加载更多每页 20 条；
  - 点「原站」恢复原生列表。
- 实测（SSIS-457）：
  - 最新第 1 条 `2025-12-02 · 👍7 · ed2k://...ssis-457.restored.mp4`
  - 最热第 1 条 `2022-06-14 · 👍54`
  - 排序结果与接口一致，20 条/页。

### 2. 短评 ed2k 一键推送 115

- 渲染短评时自动识别 `ed2k://|file|...|`，在链接后挂「推送 115」按钮；
- 点击复用现有 `pushTo115()`（115 离线签名 + `add_task_url`），使用「磁力工具箱」里配置的 115 目录 CID；
- 原站短评里的 ed2k 也会在切到短评页 / 无限加载后自动补按钮；
- 未登录 115 时按原有逻辑提示「115 登录失效」，不会静默失败。

### 3. 设置开关：短评 / 磁力放到概览下方

「融合扩展设置 → 界面」新增：

| 开关 | 默认 | 行为 |
|---|---|---|
| 短评放在概览下方 | 关 | 隐藏「短评」页签，在概览末尾渲染短评区块（排序 + 加载更多 + ed2k 推送） |
| 磁力放在概览下方 | 关 | 隐藏「磁力 / 磁力聚合」页签，把原生磁力列表和聚合面板整块搬到概览末尾 |
| 短评默认展开 | 开 | 概览下方短评默认展开；关闭则先显示「展开」按钮，展开时才请求接口 |
| 磁力区块默认展开 | 开 | 同上，折叠时不发起磁力源请求 |

开关修改后立即 `restructureDetail(true)` 重建详情页，无需刷新；布局顺序为「字幕 → 概览下方区块 → TA还出演过 / 你可能喜欢」。

### 4. 顺带修掉的一个新问题

页签状态改用 `?dtab=` 后，路由检测 `pageKey()` 把查询参数也算进路由，导致**每次点页签都整页重建**（短评列表被清空、页面闪一下）。已在 `pageKey()` 中剔除 `dtab` 参数，页签切换不再触发重建。

### 5. 动态验证

`tools/pw/live-check.js` 已加入短评排序 / ed2k 检查；本轮实测：

```
reviewSort: toolbar=true, items=20, activeSort=hotly,
            first="2708752029 ★★★★★ 2022-06-14 👍 54 ...",
            ed2kButtons=1, nativeHidden=true
```

内联模式（`jf_inline_review=true` + `jf_inline_magnet=true`）：

```
hiddenTabs=[magnet, review, agg]
magnetRows=17, reviewItems=20
overview order=[字幕, jf-inline-sections, TA还出演过, 你可能喜欢]
```

折叠模式（两个默认展开都关）：短评 / 磁力初始均为 0 请求，点「展开」后短评加载 20 条。

---

## 八、第三轮：预告片「明明有源却要手动重试」（7.372）

### 现象

点预告片第一次显示「未找到 / 当前线路不可用」，关掉重新点一次就有了。

### 根因（时序 + 状态复用，不是单纯「速度太快」）

1. **后台预热抢跑，播放器拿不到渐进结果**
   详情页 1.5s 后自动 `resolveTrailer()` 预热。用户很快点开播放器时，`resolveTrailer` 命中 in-flight 任务，
   旧实现**只把最终结果**回调给第二个调用方；而预热先跑的那次负责接收「猜测直链」渐进批次。
   于是播放器要空等 DMM 全部探测完（6~8s）才看到第一条线路；若 DMM 慢/超时，就表现为「无源」。

2. **验证源后到，但播放器不会自动切过去**
   首批「猜测直链」先到并 `selectSource()`，即使全部 404 失败，`sourceLoaded` 仍为 true；
   之后真正的 DMM 验证源到达时，旧逻辑只在 `!sourceLoaded` 时选源 → 播放器一直停在失败线路上，
   用户只能关掉重开（重开时 `sourceLoaded=false`，才会选到验证源）。

3. **后台 1 字节探测会误杀验证源**
   探测用 `Range` + `anonymous`，部分 CDN 对 Range 返回 403；旧逻辑把「探测失败」直接标成 `_dead`，
   验证源被排除后自动跳线跳过它。

4. **运行期状态被写进缓存**
   `_dead / _probe / _altTried` 挂在源对象上；缓存/in-flight 复用时原样返回，第二次打开会继承上次的失败状态。

### 修复

- `resolveTrailer` 的 in-flight 任务支持多个 `onUpdate` 监听器：预热在跑时，播放器也能立即收到猜测批次。
- `receiveSources()`：当前线路失效、或尚未开播且出现了验证源时，自动切到最佳验证源（`resetFail`），不再要求重开。
- 后台探测只允许把「未验证的猜测直链」标死；验证源只显示探测圆点，不参与判死。
- `cleanTrailerSource()`：缓存/in-flight 只保留 url/label/quality/source/unverified/alt，运行期标志不落缓存。
- 未开播时若从猜测源升级到验证源，静默切换；已开播则不打断。

### 实测

- 快速点击（详情页 1.2s 就点开，预热还在跑）：0.7s 内出 7 条线路，`readyState=4`，验证源自动选中，点播放 `currentTime` 正常推进。
- SSIS-457 / IPZZ-123 / STARS-531：首次打开与关闭重开最终 `src` 一致，都是 DMM `cc3001` 验证源，无 JS 报错。

---

## 九、第四轮：LTX 标签高亮 / 筛选（7.373）

### 需求

有的影片在详情页带「LTX破解」類別，希望列表能高亮或只看 LTX。

### 实现

- **详情页**：`類別` 里文本含 LTX 的 chip 加 `.jf-ltx-cat`，红色高亮（截图里被红框圈出的那个位置）。
- **列表页**：JAVDB 卡片本身不带類別，所以从「LTX破解」标签页 `/tags?c7=390` 同步 `/v/` id + 番号做本地索引（GM 存储，7 天有效）。
  - 命中卡片：红色描边 + 右上角 `LTX` 角标。
  - 顶栏 `LTX` 按钮：无索引时先同步；有索引时切换「只看 LTX」。
  - 标签页需要登录 JAVDB；未登录会提示「请先登录 JAVDB 再同步 LTX」。
- **设置**：融合扩展设置 → 界面 →「LTX 影片高亮 / 只看 LTX 按钮」可整体关闭。

### 验证（无登录、mock 索引）

搜索 SSIS-457 页注入 `xJqp6` 索引：

```
before: btn=LTX, badges=1, hits=1, total=20
after : btn=LTX ✓, visible=1, only=1
```

详情页 MNGS-079：`.jf-ltx-cat` = `['LTX破解']`，无 JS 报错。

---

## 十、登录态实测（JAVDB + 115）

使用 `tools/pw/login-capture.js` 弹出真实 Chromium，手动登录 JAVDB 与 115 后保存 `storageState`；
`live-check.js --auth=...` 的 GM 请求改走 Playwright `ctx.request`（与浏览器共享 Cookie）。

结果：

| 检查 | 结果 |
|---|---|
| Cookie | 44 个；JAVDB 已登录、115 已登录 |
| 原生短评 | `nativeItems=10`（不再是登录提示） |
| API 短评 | `items=20`，最新第 1 条带 ed2k |
| 相关清单 | 页签有内容（非登录提示） |
| 115 推送 | 第一次点击成功创建任务 `www.98T.la@ssis-457.restored.mp4`；再次点击返回「任务已存在，请勿输入重复的链接地址」 |
| 115 任务列表 | 已出现该文件，status=2（完成） |
| LTX 索引同步 | 37 页、1450 个 `/v/` id、1449 个番号 |
| 女优作品页筛选 | 彩月七緒 108 部中筛出 LTX 影片，红框 + 角标 |
| TOP250 筛选 | 自定义 TOP250 面板应用筛选后仍保留 78 部 LTX 影片 |

> 115 任务由用户显式授权创建一条；`storage.json` 含登录 Cookie，已 `.gitignore`，测试后可删。
