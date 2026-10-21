# 第二阶段：预告片 / 详情页 UI / 磁力聚合 / 115 整理

> 基线：`7.364-top250-dedupe` → 现在：`7.366-tabs-magnet-pan115`
> 全部改动都有对应的补丁脚本（`tools/patch-*.js`），可复现、可 review。

---

## 一、预告片：根因与修复

### 根因（实测定位）

原实现里画质有两条完全不同的来源：

| 路径 | 代码位置 | 标签 | 前置条件 |
|---|---|---|---|
| 正规 | `L27042` `'DMM/FANZA ' + getDmmQualityText(q)` | 720p / 1080p / 4K ✅ | 需要 `hit.serviceCode` **且** `hit.floorCode` |
| 兜底 | `L26860` `'DMM 直链候选 ' + suffix` | `_dm_w` / `_sm_w`… ❌ | 只需要 cid |

而 `serviceCode` / `floorCode` **只有 ItemList 搜索接口能给**：

```
HMHI-401  kw=HMHI00401  ERR Unexpected token '<', "<!doctype "... is not valid JSON
HMHI-401  kw=HMHI-401   ERR Unexpected token '<', "<!doctype "... is not valid JSON
```

`api.dmm.com/affiliate/v3/ItemList` 在部分网络下**直接返回 HTML 错误页** →
`searchDmmContentIds()` 必然失败 → 正规画质路径永远拿不到东西 →
用户 90% 的场景都在看那条丑陋的「DMM 直链候选」阶梯（8 条、含 4 组重复、
标签是内部键名、串行盲试）。

**关键发现**：`html5_player` 端点在**只有 cid** 时同样能返回 bitrates：

```
media ssis00457 status=200 qualities=["4k","mhb_w","dmb_w"]
```

也就是说 `inferDmmHitsFromCode` 猜出来的 cid 本来就能产出真实画质，
只是被 `if (!hit.serviceCode || !hit.floorCode) return null;` 挡在了门外。

### 修复

1. `extractDmmTrailerLinks()`：`service/floor` 改为**可选**，只有 cid 也去查
   `html5_player` → 猜到的 cid 立刻产出真实画质表
2. `buildDmmDirectCandidates()`：同画质的 `.com` / `.co.jp` **合并为一条**
   （另一域名降级为 `alt` 备用），标签改成人类可读分辨率
3. 播放失败时**先试 `alt` 再换下一条**，少一轮无谓切换
4. 记住上次选择的画质（`jf_tr_quality`），下次自动选中

### 实测对比

| | 修改前 | 修改后 |
|---|---|---|
| 下拉内容 | `DMM 直链候选_dm_w` ×4（重复）+ ×4 | `DMM/FANZA 404p 宽` / `DMM/FANZA 404p 高` / `DMM 直链 480p` / `360p` / `720p` / `1080p` / `DMM HLS 多码率 (m3u8)` |
| 视频 | `0×0`，`error=4`（打不开） | **720×404，readyState=1，正常起播** |

> 顺带说明：音量记忆原本就有（`jf_tr_volume`），之前报告里说的「音量不记忆」是误判，
> 已更正。下载功能按你的要求**不做**（Jellyfin 刮削会自动下载预告片）。

---

## 二、详情页选项卡面板 + 锚点导航

JAVDB 原生详情页其实**已经有一个 movie-tab 组件**（`.columns[data-controller="movie-tab"]`，
含 磁链 / 短評 / 相關清單），脚本一直保留它但放在页面最底下。

新实现不拆解 DOM，而是**驱动原生组件**：

```
#emby-detail-root
└─ .emby-detail-body
   ├─ .emby-dtabbar        ← 吸顶页签栏
   │   概览 / 磁力 / 短评 / 相关清单 / 磁力聚合
   ├─ .emby-detail-hero    ← 仅「概览」显示
   ├─ .emby-dpane-overview ← 脚本自己的区块 + 字幕搜索
   ├─ .emby-dpane-magnet   ← 原生 movie-tab 组件（搬进来）
   ├─ .emby-dpane-review
   ├─ .emby-dpane-list
   └─ .emby-dpane-agg      ← 磁力搜索条（搬进来）
```

- 磁力 / 短评 / 相关清单 → 点击原生 `a` / `a.review-tab` / `a.list-tab`，不与 Stimulus 打架
- 磁力聚合 → 把 `#jf-magnet-panel` 搬进独立面板，离开时搬回 `#magnets-content`
- **页签栏位置**：融合模式下 hero 高达 900px，页签若放 hero 后面首屏根本看不到 →
  放在 hero **上方**，并 `position:sticky` 吸顶
- **吸顶踩坑**：`body { overflow-x:hidden }` 会让 body 变成滚动容器，
  `position:sticky` 相对 body 而非视口定位 → 吸顶失效。
  改用 `overflow-x:clip`（同样裁横向溢出，但不创建滚动容器）→ 实测吸顶位置 y=69，正好贴顶栏下沿

### 锚点导航

右侧边缘 30px 窄轨（图标式，悬停展开文字），当前页签高亮，点击切换页签。

### 字幕搜索

按你的要求合并进「概览」：SubtitleCat + 迅雷字幕双源，搜当前番号。

---

## 三、状态优先级统一

优先级：**已入库 > 已收藏 > 已观看 > 想看 > 有评分**（按你说的，不搞复杂）

卡片封面左上角**只挂一枚角标**，不再让各模块各挂各的：

| 优先级 | 状态 | 视觉 |
|---|---|---|
| 1 | 已入库 | 绿 + 影片图标 |
| 2 | 已收藏 | 红 + 爱心 |
| 3 | 已观看 | 蓝 + 对勾 |
| 4 | 想看 | 琥珀 + 书签 |
| 5 | 有评分 | 紫 + 星 |

识别来源：`.jf-lib-chips`（媒体库）/ `.efav-award-badge`（收藏夹）/ 
`.csb-status-container.show-watched|.show-wanted`（评审标记）/ `.star-arc-container`（评分）。

---

## 四、磁力面板：实测与优化

### 实测（真实请求，1440×900，详情页）

| 指标 | 值 |
|---|---|
| 磁力搜索本身 | **930ms** 完成（不慢） |
| 详情页总 GM 请求 | **40 个 / 26 个主机 / 累计 26.3s 网络时间** |
| 重复请求 | **7 个 URL 被重复请求**（`sukebei` ×3、`123av search` ×2、`njavtv` ×2、`www.njav.com` ×2、`123av favicon` ×2、`JAV_info index.json` ×2、translate ×2） |
| 单文件最大下载 | `testingcf.jsdelivr.net` 的 `JAV_info/dist/index.json` = **4,750 KB（4.6MB）**，每个详情页都重下一次 |

### 与两个竞品对比

| | 本脚本（改前） | JAV-JHS | JAV老司机 |
|---|---|---|---|
| 磁力源 | 2（Sukebei / BT4G） | 5+（u9a9/sukebei/btsow/btdig/磁力帝）+ 自定义 | 磁力帝 + 聚合 |
| **是否真聚合** | ❌ 下拉一次只能选一个源 | ✅ 多源合并去重 | ✅ 多源合并 |
| 排序 | 智能/大小/做种 | 标签优先 + 二级排序 | 标签正则 + 权重 |
| 缓存 | **整块 JSON 塞一个 GM 键**，每次读写全量 parse/stringify | IndexedDB | 分层缓存 + 持久化前缀 |

**结论：磁力面板本身不慢（930ms），问题在两点 —— 不是聚合（功能弱），缓存设计差。**

### 优化

1. 源扩到 **5 个**：Sukebei / BT4G / **BTDigg / U9A9 / BTSOW**
2. 新增「**全部聚合**」为默认：并发拉全部源后合并去重，标题加 `[来源]` 前缀
3. 缓存改 **per-key 存储**（`jf_magpanel_<site>_<code>` + 索引键做 LRU 淘汰），
   不再每次读写全量 JSON
4. 刷新按钮清理改为清对应的单键

---

## 五、115 整理改名

参考 **JAV老司机 2.9.4.4** 的 115 模块（对方 850 处 115 相关代码，`rename` 109 处、
`整理` 30 处）。本脚本原先只有「把一条磁力推给 115 离线」，没有整理/改名/目录归集。

### 新增

**① `Pan115` API 封装**

| 用途 | 接口 |
|---|---|
| 签名 | `GET https://115.com/?ct=offline&ac=space&_=<ts>` |
| 列目录 | `GET https://webapi.115.com/files?aid=1&cid=…&show_file_size=1` |
| 新建目录 | `POST https://webapi.115.com/files/add`（`pid`+`cname`） |
| 改名 | `POST https://webapi.115.com/files/edit`（`fid`+`file_name`） |
| 移动 | `POST https://webapi.115.com/files/move`（`fids[]`+`cid`） |
| 删除 | `POST https://webapi.115.com/rb/delete`（`ids[]`） |
| 搜索 | `GET https://webapi.115.com/files/search?search_value=…` |

**② 模板引擎**（与老司机一致）

| 模板 | 变量 | 默认 |
|---|---|---|
| 离线目录 | `${code}` `${actor}` `${maker}` `${series}` | `云下载/${actor}` |
| 文件名 | `${code}` `${suffix}` `${crack}` `${res}` `${title}` | `${code} ${title}` |
| 文件夹名 | `${code}` `${suffix}` `${title}` | `${code}` |

`suffix` 自动保留 `-U` / `-UC` / `-4K` 之类的后缀；
`crack` 识别「无码/uncensored」；`res` 识别 4K / HD。

**③ 整理面板**（115 目录下拉或推送离线后自动弹出）
- 列出目标目录
- **一键清理**：0 字节 / 样片 / 广告 / readme / nfo
- **一键规范改名**：按文件名模板批量改名
- **归入模板目录**：按文件夹名模板建目录并移动

**④ 设置项**（融合设置 → 磁力工具箱）
- 离线后自动打开整理面板
- 一键清理垃圾文件
- 离线目录模板 / 文件名模板 / 文件夹名模板

> ⚠️ 本沙箱无法登录 115，整理面板的**端到端行为未实测**；
> API 路径与参数是照老司机的实现对齐的，需要你在本机登录 115 后验证一次。

---

## 六、性能复测（加完所有新功能后）

| 指标 | `7.364` | `7.366` | 变化 |
|---|---|---|---|
| task | 616 ms | **444 ms** | **−28%** |
| layout | 109 ms | **40 ms** | **−63%** |
| recalcStyle | 236 ms | **110 ms** | **−53%** |
| layoutCount | 28 | **13** | −54% |
| 顶栏→列表 | 243 px | **177 px** | −27% |

加上「低特效模式」后：task **−39%**、recalcStyle **−77%**（见第一阶段报告）。

6 个页面冒烟（首页/详情/搜索/演员/榜单/收藏夹）：**零 JS 报错**、无横向溢出。
