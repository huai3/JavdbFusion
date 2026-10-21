/*
 * JavdbFusion 重复请求补丁（增强版）
 *
 * 【实测结论】
 * 只做「在途合并」不够：详情页里那 7 个重复请求（JAV_info 演员索引 ×2、
 * 12 个站点可用性探测各 ×2、标题翻译 ×2、站点 favicon ×2、磁力搜索 ×2）
 * 并不是严格并发，而是「紧挨着」——第一条刚好结束、第二条立刻发起，
 * 于是按 URL 合并的 in-flight 表刚被清掉，第二条又重新发了一次。
 * （给请求加个栈采样后时序被拉长，重复就消失了 —— 典型的竞态。）
 *
 * 【本补丁的方案】在 GM_xmlhttpRequest 这一层做「短期响应备忘」：
 *   · 相同 method+url 的并发请求 → 共享同一个底层请求（in-flight 合并）
 *   · 相同 method+url 的请求在 COOLDOWN_MS 内再次发起 → 直接复用上次的响应
 * 两条规则都在同一层实现，一次覆盖脚本里所有走 GM_xmlhttpRequest 的调用点
 * （站点探测、演员索引、头像索引树、标题翻译、磁力搜索……）。
 *
 * COOLDOWN_MS 默认 30s，且只缓存 2xx 的成功响应（失败不缓存，避免把
 * 「临时网络抖动」固化成 30s 的「该站不可用」）。
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
console.log('== 重复请求去重（in-flight 合并 + 短期响应备忘）==');

rep(
  `  const __gmGetInFlight = new Map();
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
  };`,
  `  const __gmGetInFlight = new Map();
  const __gmRawXhr = GM_xmlhttpRequest;
  // 短期响应备忘：同一 URL 在冷却窗口内再次请求直接复用上次结果。
  // 只缓存 2xx 成功响应；失败不缓存（避免把网络抖动固化成「不可用」）。
  const __gmMemo = new Map();
  const __gmMemoMax = 40;
  const __gmMemoCool = 30000;
  GM_xmlhttpRequest = function (opt) {
    const method = String((opt && opt.method) || 'GET').toUpperCase();
    const key = (method === 'GET' && opt && opt.url) ? (method + ' ' + opt.url) : null;
    if (!key) return __gmRawXhr(opt);
    // ① 冷却窗口内的重复请求 → 直接复用上次响应
    const memo = __gmMemo.get(key);
    if (memo && (Date.now() - memo.t) < __gmMemoCool) {
      const deliver = function () {
        try { if (opt.onload) opt.onload(memo.resp); } catch (e) {}
        try { if (opt.onloadend) opt.onloadend(memo.resp); } catch (e) {}
      };
      if (memo.settled) deliver();
      else memo.waiters.push(deliver);
      return { abort: function () {} };
    }
    // ② 并发中的同一请求 → 共享同一个底层请求
    let entry = __gmGetInFlight.get(key);
    if (entry) {
      entry.subs.push({
        load: opt.onload, error: opt.onerror, timeout: opt.ontimeout,
        abort: opt.onabort, loadend: opt.onloadend
      });
      return entry.raw;
    }
    entry = { subs: [], done: false, raw: null, waiters: [] };
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
      // 成功响应进入短期备忘，供冷却窗口内的后续请求复用
      if (kind === 'load' && resp && resp.status >= 200 && resp.status < 300) {
        __gmMemo.set(key, { t: Date.now(), resp: resp, settled: true, waiters: [] });
        if (__gmMemo.size > __gmMemoMax) {
          const oldest = __gmMemo.keys().next().value;
          __gmMemo.delete(oldest);
        }
      }
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
  };`,
  '去重层升级：in-flight 合并 + 30s 短期响应备忘'
);

console.log('\napplied=' + applied + '  skipped=' + skipped);
if (skipped) { console.error('⚠ 有未应用项（其余改动仍会写入）: ' + skipped); }
try { new Function(src); console.log('syntax check: OK'); } catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }
fs.writeFileSync(file, src, 'utf8');
