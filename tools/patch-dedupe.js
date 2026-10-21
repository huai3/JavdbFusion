/*
 * JavdbFusion 重复请求 / 4.6MB 重复下载 优化补丁
 *
 * 【根因：cache stampede（缓存击穿）】
 * 脚本里所有「先查缓存 → 发请求 → 拿到结果再写缓存」的写法，在并发调用时
 * 两个调用都会查不到缓存 → 各发一次请求。实测一次详情页加载里：
 *   JAV_info 演员索引      ×2
 *   Gfriends Filetree.json ×1~2   （4.6MB！）
 *   12 个站点的可用性探测   各 ×2
 *   标题翻译              ×2
 *   站点 favicon          ×2
 * 其中站点探测走的是裸 GM_xmlhttpRequest（绕过了 gmReq 自带的去重），
 * 所以 embyNetRun 的在途去重根本没覆盖到它们。
 *
 * 【修法】
 *   ① 在 GM_xmlhttpRequest 这一层做统一的「同 method+url 的在途 GET 合并」：
 *      结果扇出给所有订阅者。一次请求解决全部重复。
 *   ② ActressService.getRepoIndex / GfriendsAvatarService.fetchIndex 补上
 *      在途 Promise 去重（各自声明了 _idxPromise / loadPromise 但没接上）。
 *   ③ 4.6MB 的 Gfriends 头像索引：IndexedDB 缓存不可用时（FAV 未就绪/被清）
 *      兜底写 GM 存储，避免每个详情页都重下一次 4.6MB。
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
console.log('== 重复请求 / 4.6MB 重复下载 优化补丁 ==');

/* ① 全局 GET 在途去重（装在所有请求发生之前） */
rep(
  `  function log(m) { try { console.log('[JAVDB→Emby] ' + m); } catch (e) {} }`,
  `  /* =======================================================================
   * 同一 GET 的在途请求合并（修掉详情页的一堆重复请求）
   * =======================================================================
   * 脚本里所有「先查缓存 → 发请求 → 拿到结果再写缓存」的写法，在并发调用时
   * 两个调用都会查不到缓存（缓存要等请求结束才写入）→ 各发一次请求。
   * 实测一次详情页加载：JAV_info 演员索引 x2、12 个站点的可用性探测各 x2、
   * 标题翻译 x2、站点 favicon x2，合计多打 15+ 个请求。
   * 站点探测走的是裸 GM_xmlhttpRequest（绕过了 gmReq 自带的 embyNetRun 去重），
   * 所以必须在 GM_xmlhttpRequest 这一层统一处理。
   * 实现：相同 method+url 的并发 GET 共享同一个底层请求，结果扇出给所有订阅者。 */
  const __gmGetInFlight = new Map();
  const __gmRawXhr = GM_xmlhttpRequest;
  GM_xmlhttpRequest = function (opt) {
    const method = String((opt && opt.method) || 'GET').toUpperCase();
    const key = (method === 'GET' && opt && opt.url) ? (method + ' ' + opt.url) : null;
    if (!key) return __gmRawXhr(opt);
    let entry = __gmGetInFlight.get(key);
    if (entry) {
      // 已有在途请求：订阅同一结果，不再发第二个请求
      entry.subs.push({
        load: opt.onload, error: opt.onerror, timeout: opt.ontimeout,
        abort: opt.onabort, loadend: opt.onloadend
      });
      return entry.raw;
    }
    entry = { subs: [], done: false, raw: null };
    __gmGetInFlight.set(key, entry);
    entry.subs.push({
      load: opt.onload, error: opt.onerror, timeout: opt.ontimeout,
      abort: opt.onabort, loadend: opt.onloadend
    });
    const finish = function (kind, resp) {
      if (entry.done) return;
      entry.done = true;
      __gmGetInFlight.delete(key);
      entry.subs.forEach(function (s) {
        try { if (s[kind]) s[kind](resp); } catch (e) {}
      });
      entry.subs.forEach(function (s) {
        try { if (s.loadend) s.loadend(resp); } catch (e) {}
      });
    };
    entry.raw = __gmRawXhr({
      method: opt.method, url: opt.url, headers: opt.headers, data: opt.data,
      timeout: opt.timeout, anonymous: opt.anonymous,
      onload: function (r) { finish('load', r); },
      onerror: function (r) { finish('error', r); },
      ontimeout: function (r) { finish('timeout', r); },
      onabort: function (r) { finish('abort', r); }
    });
    return entry.raw;
  };

  function log(m) { try { console.log('[JAVDB→Emby] ' + m); } catch (e) {} }`,
  '全局 GET 在途去重（GM_xmlhttpRequest 层）'
);

/* ② ActressService.getRepoIndex：在途 Promise 去重 + GM 存储兜底 */
rep(
  `    getRepoIndex: async function () {
      if (this._idxMem) return this._idxMem;
      const ck = 'jhs_repo_index_cache';
      try {
        const raw = localStorage.getItem(ck);
        if (raw) {
          const o = JSON.parse(raw);
          if (o && o.t && Date.now() - o.t < 6048e5 && o.d) {
            this._idxMem = o.d;
            return o.d;
          }
        }
      } catch (e) {}`,
  `    _idxPromise: null,
    getRepoIndex: async function () {
      if (this._idxMem) return this._idxMem;
      // 【去重 2026-10】缓存要等请求结束才写入，并发调用会同时查不到缓存 →
      // 重复下载同一份索引。这里用 _idxPromise 承接在途请求。
      if (this._idxPromise) return this._idxPromise;
      this._idxPromise = this._loadRepoIndex();
      try { return await this._idxPromise; } finally { this._idxPromise = null; }
    },
    _loadRepoIndex: async function () {
      const ck = 'jhs_repo_index_cache';
      // 优先读 GM 存储（无 5MB 配额限制，localStorage 写不下时会静默失败）
      try {
        const rawG = GM_getValue(ck, '');
        if (rawG) {
          const o = JSON.parse(rawG);
          if (o && o.t && Date.now() - o.t < 6048e5 && o.d) {
            this._idxMem = o.d;
            return o.d;
          }
        }
      } catch (e) {}
      try {
        const raw = localStorage.getItem(ck);
        if (raw) {
          const o = JSON.parse(raw);
          if (o && o.t && Date.now() - o.t < 6048e5 && o.d) {
            this._idxMem = o.d;
            return o.d;
          }
        }
      } catch (e) {}`,
  'ActressService.getRepoIndex：在途去重 + GM 存储兜底'
);

rep(
  `      try {
        const d = JSON.parse(txt);
        this._idxMem = d;
        try { localStorage.setItem(ck, JSON.stringify({ t: Date.now(), d: d })); } catch (e) {}
        return d;
      } catch (e) { return null; }
    },`,
  `      try {
        const d = JSON.parse(txt);
        this._idxMem = d;
        const payload = JSON.stringify({ t: Date.now(), d: d });
        // 先写 GM 存储（无配额限制）；localStorage 写不下时静默失败，改写 GM
        try { localStorage.setItem(ck, payload); } catch (e) {
          try { GM_setValue(ck, payload); } catch (e2) {}
        }
        return d;
      } catch (e) { return null; }
    },`,
  'ActressService 索引写缓存：localStorage 失败改写 GM'
);

/* ③ Gfriends 头像索引（4.6MB）：接上 loadPromise + GM 兜底 */
rep(
  `    async function fetchIndex() {
      // 1. 尝试从 IndexedDB meta 表读取有效缓存
      try {
        if (typeof FAV !== 'undefined' && typeof FAV.dbGetMeta === 'function') {
          const cached = await FAV.dbGetMeta(META_KEY);
          if (cached && cached.time && cached.map && (Date.now() - cached.time < TTL_MS)) {
            indexMap = new Map(Object.entries(cached.map));
            log('Gfriends 头像索引从 IndexedDB 恢复成功，收录女优: ' + indexMap.size + ' 位');
            return indexMap;
          }
        }
      } catch (e) {
        log('读取 Gfriends IndexedDB 缓存异常: ' + e.message);
      }`,
  `    async function fetchIndex() {
      // 【去重 2026-10】loadPromise 之前声明了却没接上：并发调用会各自下载一次
      // 4.6MB 的 Filetree.json。现在承接在途 Promise，只下一次。
      if (loadPromise) return loadPromise;
      loadPromise = fetchIndexInner();
      try { return await loadPromise; } finally { loadPromise = null; }
    }

    async function fetchIndexInner() {
      // 1. 尝试从 IndexedDB meta 表读取有效缓存
      try {
        if (typeof FAV !== 'undefined' && typeof FAV.dbGetMeta === 'function') {
          const cached = await FAV.dbGetMeta(META_KEY);
          if (cached && cached.time && cached.map && (Date.now() - cached.time < TTL_MS)) {
            indexMap = new Map(Object.entries(cached.map));
            log('Gfriends 头像索引从 IndexedDB 恢复成功，收录女优: ' + indexMap.size + ' 位');
            return indexMap;
          }
        }
      } catch (e) {
        log('读取 Gfriends IndexedDB 缓存异常: ' + e.message);
      }
      // 1b. GM 存储兜底：IndexedDB 不可用（FAV 未就绪 / 被清 / 隐私模式）时，
      //     避免每个详情页都重下一次 4.6MB
      try {
        const rawG = GM_getValue(META_KEY, '');
        if (rawG) {
          const o = JSON.parse(rawG);
          if (o && o.time && o.map && (Date.now() - o.time < TTL_MS)) {
            indexMap = new Map(Object.entries(o.map));
            log('Gfriends 头像索引从 GM 存储恢复成功，收录女优: ' + indexMap.size + ' 位');
            return indexMap;
          }
        }
      } catch (e) {}`,
  'Gfriends 头像索引：接上 loadPromise + GM 存储兜底'
);

console.log('\napplied=' + applied + '  skipped=' + skipped);
if (skipped) { console.error('⚠ 有未应用项（其余改动仍会写入）: ' + skipped); }
try { new Function(src); console.log('syntax check: OK'); } catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }
fs.writeFileSync(file, src, 'utf8');
