# JavdbFusion.user.js 修改备忘

> 脚本：`D:/Downloads/JavdbFusion.user.js`（约 26012 行 / 1.48MB）
> 备份：`D:/Downloads/JavdbFusion.user.js.bak`（动刀前原样拷贝）
> 日期：2026-10-08
> 行号说明：审计时记录的行号以**修改前**为准；修改后整体下移约 100~300 行，定位请以函数名为准。

---

## 一、测试过程（怎么发现问题的）

1. **静态审计**：全文件 grep + 分段精读，覆盖守卫逻辑、GM API、定时器/观察器、CSS、磁力/预告片模块。
2. **Performance 实测**：用户录制的 Chrome trace（61MB gz，解压后 651MB，4688 个 JS 采样块、420053 个采样）。自写流式脚本分析，
   不一次全载入。关键数据：
   - 本脚本占 JS 采样约 1.2%（5253 采样），具名函数无热点（`restructureGrid 6`、`doResolveTrailer 5` 等）——无单点性能炸弹。
   - 但 DOM 开销是散的：`innerHTML 2265`、`textContent 1686`、`querySelector 1473`、`appendChild 1009`，即全量重建写法摊出来的。
   - 布局抖动：`pageYOffset 1467 + scrollY 856 + getBoundingClientRect 563 + elementFromPoint 998`。
   - 启动：`ScriptCompiled 272 次共 3.4s，单次最大 560ms`（1.48MB document-start 解析代价）。
   - 掉帧：`DroppedFrame 1817`、`UpdateLayer 456922 次`、`RunTask 最大 997ms`、`>50ms 长任务 366 个`。
   - 干扰项：用户浏览器里别的扩展比本脚本还重（某注入脚本 `iterateCSSDeclarations 750` 采样），复测需无痕+单开本脚本。
   - Console 过滤 `[JAVDB→Emby]` 干净**不代表没 bug**：脚本内十几处空 `catch(e){}` 把错全吞了。
3. **Live DOM 校验**（本机 HK 网络可直连，云端浏览器出口被 Cloudflare 墙）：
   - 未登录首页/详情页：`nav.navbar / movie-list / video-detail / h2.title / video-cover / #magnets-content / save-list-button` 全存在，核心选择器假设成立。
   - 登录态（用户 cookie，仅内存传递、用完即焚）：详情页 `#magnets-content` 下 22 行 `.magnet-name` + 44 个 magnet 链接；演员页 h2 为"名+别名+N 部影片"结构，
     `.button-collect/.button-uncollect` 双按钮 + 父级 `.control` 都在——`ensureDetailFilterBtn` 注入点与 `extractEntityNames` 拆名假设成立。
   - `#magnet-table / #jav-nong-table` 真实页面不存在，是备用分支；`button-collect` 只在登录态出现。
   - 附带发现：连续快速请求会被 JavDB 掐（一次详情页直接 ERR），证实需要请求并发控制。

---

## 二、发现的 Bug 清单

### 致命/严重

| # | 位置（修改前） | 问题 | 后果 |
|---|---|---|---|
| 1 | `gmReq`（25743）、`pushToQb/pushTo115`（26865/26871/26887/26898）、`GM_getValue/SetValue`（25771 起约 40 处）、`GM_setClipboard`（27058/27273） | **裸调 GM_*，无 `typeof` 守卫**。同文件 8861/9238/12752 处都有回退写法，这里漏了 | 无油猴/grant 被禁时首次调用即 `ReferenceError`，媒体库+预告片+磁力全灭 |
| 2 | `/plans` 拦截（280-287）+ `isJavdbVipUser`（172-219） | 按徽章/图标启发式判 VIP，假阴性高；误判即 `location.replace` 踢出计费页，破坏后退 | VIP 用户被强制跳转（无死循环，但误杀） |
| 3 | `VERSION` 兜底（116） | fallback 写死 `'7.343'`，与头部 `@version 7.353-fusion-probetop` 脱节 | 非油猴环境显示旧版本号 |

### 中等

| # | 位置 | 问题 |
|---|---|---|
| 4 | `bindNoteTips` mouseover/mouseout（663/675） | 无节流，划过卡片网格高频触发 `showNoteTip/hideNoteTip`（trace 实锤 elementFromPoint 998 次） |
| 5 | `__embyScrollHandler`（7150） | 每次 scroll 直接读 `scrollY/pageYOffset` 调 `updateBackTop`，同文件 8084/8651 都有 rAF 模板、这里漏网 |
| 6 | `attachCompactPoster3D` mousemove（8243） | 每卡每次 mousemove 都 `getBoundingClientRect`，大网格下 layout thrashing |
| 7 | `history`（25401/25696） | 每次切 tab 写 hash + 劫持 push/replaceState，与 Turbolinks 打架，后退/hash 分享丢失 |
| 8 | CSS id（10558/10954/8928/9043） | 跨列表 `append` 未去重，与原生 `#save-list-button` 等同名即取错 |
| 9 | 十几处空 `catch(e){}`（48/55/78/113/460…） | IDB/鉴权失败静默，Console 干净是假象，难定位 |
| 10 | `GM_registerMenuCommand`（28267） | 裸调（虽被外层 try 接住，仍应显式守卫） |

### 性能（trace + 静态双证）

- 5+ 全子树 `MutationObserver` 叠加（25582/7757/8389/23261/28259），列表滚动/懒加载高频重排。
- `querySelectorAll('body *')` 嵌套全扫（15350），O(N²）。
- scroll 期写 `backdrop-filter`（7765-7791）+ 顶栏/抽屉常驻大 blur（991/1004/1116）+ `will-change:backdrop-filter` → `UpdateLayer` 45 万次。
- 首屏 `visibility:hidden` + 10s 兜底（65-77），异常即白屏 10s；CSS 内 `@import Google Fonts` 串行阻塞。
- 存储：每次全量 `JSON.parse/stringify` 收藏库（11475/11508），热路径逐卡 `localStorage.getItem`，TOP250 循环内逐条 `await dbPutMovie`。
- 网络：TOP250 并发 3-4、BT4G 1+8 并行无全局队列，易 429（live 验证遇到掐请求，佐证）。

### 设计（磁力面板，用户原话"不是很合理"，审计确认）

1. 三套 UI 数据源分裂：站内表 vs 右侧 `fixed` 聚合面板（Sukebei/BT4G），用户不知看哪边；fixed 盖 Emby hero，移动端只缩到 330px。
2. 首次使用至少 2 点击（展开 + ⟳），切源在未 loaded 时无反馈。
3. 行内 14px 纯图标靠 title，触屏不可读；面板标题 `a[href=magnet]` 点了却是复制，反直觉。
4. 无 btih 去重、无中字/高清标签、无"一键推最佳"；`simplifyMagnetLink` 丢 tracker 又无"复制完整"选项。
5. 空结果只有一行"未找到"，无源站兜底；BT4G 8 并行无 Abort，切番号请求继续跑。
6. 预告片小瑕疵：4 个入口行为不一、unverified 猜测源先推送致画质菜单闪变、"Chrome 原生支持 HLS"注释过时。

---

## 三、修改明细（已落地，均验证）

### R1. GM_* 安全垫片 + 版本号（对应 Bug #1、#3、#10）

- **位置**：`toAbsUrl` 之后（文件头部工具区），`__gmHost` + `__gmShim`。
- **做法**：只向 `globalThis` 挂载、**绝不在本作用域声明同名 `var`**（否则会遮蔽油猴真实实现）。
  缺啥补啥：`GM_xmlhttpRequest`→fetch（含 abort/timeout/`anonymous`→credentials 映射，返回可 abort 的 task 对象，
  回调形状与 TM 一致：`{status, statusText, responseText, response, finalUrl}`）；
  `GM_getValue/SetValue`→localStorage（`gm:` 前缀，JSON 回环）；`GM_setClipboard`→clipboard API→textarea 降级；
  `GM_registerMenuCommand`→空函数。有真 GM 时 `typeof` 直接跳过，零行为变化。
- **版本**：`VERSION` 兜底改为 `'7.353-fusion-probetop'`，与头部一致。
- **验证**：`node --check` exit 0；垫片单测 11/11（安装、读写回环、onload/abort/timeout、**真 GM 不被遮蔽**）。
- **已知降级代价**：垫片模式下 qB 本地推送（`http://127.0.0.1` 混合内容）与 115 跨域会失败，表现为失败 toast 而非抛错——
  真跨域仍需油猴，这是设计取舍。

### R2. 三处 rAF 节流（对应 Bug #4、#5、#6）

- `bindNoteTips` mouseover：rAF 合并一帧一次（`tipHoverQueued`），mouseout 原样不动。
- `__embyScrollHandler`：rAF ticking（`backTopTicking`），与文件内既有模板一致。
- `attachCompactPoster3D`：mouseenter 测一次 rect（`cachedRect`），mousemove 复用，mouseleave 清掉；transform 输出逐字不变。
- **验证**：`node --check` 过；行为保持，仅降频。需用户本地复验：演员悬停卡片、滚动回顶、紧凑条 3D 倾斜。

### R3. 磁力面板重构（对应全部 6 条设计问题）

- **去 fixed**：面板改嵌到 `#magnets-content` 顶部（无此节点则退到 `.emby-detail-body`），随文档流；CSS `position:fixed/right:18px/72vh` 改为
  静态块（`width:100%`，列表 `max-height:430px`）；折叠改为只收起工具+列表（删掉边缘小 tab 的 fixed 残留）；移动端 330px 特例改为工具条自动换行。
- **0 点击**：详情页打开即 `load(false)` 自动搜；切源无条件 `load()`；⟳ 保留为强制刷新。
- **标题行为**：去掉 `preventDefault`+复制，恢复默认磁力链接行为。
- **行操作**：`复制`（左键精简、右键完整）+ `验车` 文字按钮；qB/115 收进 `⋯` 二级菜单（含点外关闭），115 未设目录时该项变为"设置 115 目录…"直跳设置磁力页。
- **工具条新增**：`复制Top3` / `推最佳→qB` / `推最佳→115`（跟随原有开关）/ `源站搜↗`。
- **排序**：`preparedRows()`——btih 去重（大小写不敏感，保留做种最高）→ 智能排序（做种优先，同分 1~10GB 优先），
  原 size/seeds 排序保留；标题正则提 chips（无码/中字/4K/高清）；meta 缺段整段隐藏（BT4G 空行不再留白）。
- **空结果**：给出去源站搜索的直达链接。
- **并发/取消**：BT4G 详情 `slice(0,8)`→`slice(0,4)`，`signal` 从 `load()` 经 `fetchMagnetResults`（`gmReq` 原生支持 `opt.signal`）
  一路透传；`loadGen` 代际计数丢弃旧回包；切番号/切源/关面板/关开关四处 abort。
- **验证**：`node --check` exit 0；聚合纯逻辑单测 9/9（去重数量与取最大、三种排序、三种标签、key 大小写与非 btih 区分）；
  站内原生磁力行按钮组**未动**（窄表格里文字按钮会撑版，留待下次）。
- 另：设置页文案"详情页右侧磁力搜索框"改为"详情页磁力聚合（站外搜索条）"，名副其实。

---

## 四、待办（未动）

1. **1.48MB 按路由懒加载**：启动 `ScriptCompiled` 单次 560ms，`document-start` 全量解析；拆详情页/列表页/榜单页按需初始化。
2. **站内磁力行按钮文字化**：与聚合行统一（复制/验车文字 + ⋯），需处理窄表格布局。
3. **Observer 合并**：5+ 全子树观察器合并为路由级单个；`body *` 全扫换候选容器；毛玻璃降级开关；存储内存 Map + debounce 落盘；全局请求令牌桶。
4. **`/plans` 误杀与 history 劫持**（Bug #2、#7）：改法涉及产品取舍（是否保留 VIP 绕过、hash 路由是否保留），需用户拍板。
5. **预告片收口**：统一详情页单个播放入口、首帧锁定已验证源、HLS 无原生支持时降级提示。
6. **VIP 启发式**：静态 HTML 验不全（图标型徽章需渲染后看），`jf_force_web_top` 手动开关保留。
