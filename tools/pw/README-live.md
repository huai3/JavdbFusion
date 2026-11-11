# JavdbFusion 动态自检（Playwright + GM 垫片）

这套脚本用于**真实浏览器里跑用户脚本**，验证你反馈的四类问题，而不是只看代码：

| 文件 | 作用 |
|---|---|
| `gm-shim-live.js` | 在页面里实现 `GM_getValue/GM_setValue/GM_xmlhttpRequest/...`；网络请求通过 Playwright binding 走 Node `fetch`，绕过页面 CORS，行为接近 Tampermonkey |
| `browser.js` | 自动寻找本机 Chromium：优先 `CHROME_PATH`，其次 Playwright 自带浏览器，最后找 `ms-playwright` 缓存里最新版 |
| `live-check.js` | 详情页全链路自检：5 个页签、磁力聚合首条耗时/每源状态/刷新、预告片多线路/默认暂停/关闭重开、可读性实测、JS 报错 |
| `review-mock.js` | 不依赖登录的短评/相关清单页签测试：注入 16 条 mock 短评，验证页签内容、字号/行高、滚动定位 |
| `trailer-repeat.js` | 同一番号「首次打开 vs 关闭重开」对比：验证验证源后到时会自动切源，不用手动重试 |

## 安装

```bash
cd tools/pw
npm init -y
npm i playwright
npx playwright install chromium
```

> 如果本机已经装过 Chrome / Chromium，也可以直接指定：
> `CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node live-check.js ...`

## 运行

```bash
# 完整详情页自检（默认 https://javdb.com/v/xJqp6）
node tools/pw/live-check.js
node tools/pw/live-check.js https://javdb.com/v/xxxxxx

# 短评/相关清单页签（不登录也能跑）
node tools/pw/review-mock.js

# 预告片首次打开 vs 重开（参数格式 CODE=javdb_id）
node tools/pw/trailer-repeat.js SSIS-457=xJqp6 IPZZ-123=eK117r
```

输出：

- `tools/pw/out/live-check.json`、`overview.png`、`tab-*.png`、`agg.png`、`trailer.png`
- `tools/pw/out/review-mock.json`、`review-mock.png`、`list-mock.png`
- 终端 JSON 里可直接看到：
  - `initial.scrollY` 必须为 `0`（旧版会因 `#emby-dtab-*` 锚点自动跳到内容中间）
  - `tabs.review.paneTextLen > 0` 且 `nativeInPane: true`（旧版短评页是空面板）
  - `reviewSort.*`：短评排序工具栏、条数、首条、ed2k 按钮数量、原站是否被隐藏、115 推送 toast
  - `magnet.firstRowMs`（首条结果出现时间）和 `magnet.allSourcesSettledMs`（最慢源结束时间）
  - `magnet.refreshErrors` 必须为空（旧版 ⟳ 会抛 `ReferenceError: magPanelCacheRead is not defined`）
  - `trailer.open.paused === true`（默认暂停）、`routes.length > 1`（多线路平铺）
  - `trailer.reopenMs` 很小说明关闭后解析仍在后台继续、重开命中缓存
  - `readability[].ratio` 用于核对对比度（≥4.5 为 WCAG AA）
  - `errors` 为空；非空时脚本以退出码 2 结束

## 局限性

- 未登录时 JAVDB 的短评/相关清单只返回登录提示，`live-check.js` 会显示「短評請登入後查看」，这是站点行为，不是脚本 bug；`review-mock.js` 用 mock 数据覆盖排版测试。
- DMM / 磁力源站有地区与 Cloudflare 限制，某些网络下会返回 403 / DNS 失败，脚本会把这些显示为「失败」而不是卡死。
- 视频能否真正播放取决于当前网络能否访问 DMM CDN；自检只验证「默认暂停、线路已加载、元数据就绪」。

## 带登录态测试（JAVDB / 115）

未登录时短评/相关清单只能看到登录提示，115 推送也只会返回「登录失效」。要测登录态：

```bash
# 1. 打开真实浏览器窗口（有界面），手动登录 JAVDB；要测 115 就切到 115 标签页登录
node tools/pw/login-capture.js

# 2. 登录完成后，点页面右上角「已登录，保存」
#    生成 tools/pw/auth/storage.json（内含 Cookie，等同账号凭据，不要提交/外发）

# 3. 带登录态跑全链路
node tools/pw/live-check.js --auth=tools/pw/auth/storage.json

# 4. 可选：真的往 115 创建一个离线任务（会实际下载，确认后再加 --push115）
node tools/pw/live-check.js --auth=tools/pw/auth/storage.json --push115
```

说明：

- `live-check.js` 里的 GM 请求改为走 Playwright `ctx.request`，与浏览器上下文**共享 Cookie**；所以 JAVDB 登录后短评 API/原生短评、115 推送都会带上登录态。
- `tools/pw/auth/` 已在 `.gitignore` 中；测完可删除整个目录。
- `--push115` 默认关闭，只有显式传入才会点「推送 115」按钮（否则只统计 ed2k 按钮数量）。

## 静态检查（no-undef）

```bash
cd tools/pw
npm i -D eslint globals
npx eslint --no-ignore eslint.config.mjs ../../JavdbFusion.user.js
```

> 2026-11 这轮静态检查抓到过：`magPanelCacheRead`、`gmReq`（字幕搜索）、`switchMode`（TOP250 按钮）、`newMovieRecord`（状态标记）等未定义引用，均已修复。
