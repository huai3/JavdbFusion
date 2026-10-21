/* 统一的 GM_* 垫片：用真实跨域请求（Node 侧 binding），
 * 与 Tampermonkey 的行为对齐。供所有测试脚本共用。 */
module.exports = function shimSource() {
  return `
  window.__gmStore = window.__gmStore || {};
  window.__gmCalls = window.__gmCalls || [];
  window.GM_getValue = function (k, d) { return (k in window.__gmStore) ? window.__gmStore[k] : d; };
  window.GM_setValue = function (k, v) { window.__gmStore[k] = v; };
  window.GM_deleteValue = function (k) { delete window.__gmStore[k]; };
  window.GM_listValues = function () { return Object.keys(window.__gmStore); };
  window.GM_setClipboard = function (t, cb) { try { navigator.clipboard.writeText(t); } catch (e) {} if (cb) cb(); };
  window.GM_registerMenuCommand = function () {};
  window.GM_addStyle = function (css) { var s = document.createElement('style'); s.textContent = css; (document.head || document.documentElement).appendChild(s); };
  window.GM_openInTab = function (u) { window.open(u, '_blank'); };
  window.GM_notification = function () {};
  window.GM_getResourceText = function () { return ''; };
  window.unsafeWindow = window;
  window.GM_xmlhttpRequest = function (o) {
    window.__gmCalls.push({ url: String(o.url).slice(0, 120), t: Date.now() });
    var done = false;
    try {
      if (typeof window.__gmXhr !== 'function') throw new Error('no binding');
      window.__gmXhr({
        url: o.url, method: o.method || 'GET', headers: o.headers || {},
        data: o.data || null, timeout: o.timeout || 30000
      }).then(function (res) {
        if (done) return; done = true;
        if (o.onload) o.onload({ status: res.status, responseText: res.text, response: res.text, finalUrl: res.url });
        if (o.onloadend) o.onloadend({ status: res.status });
      }).catch(function (e) {
        if (done) return; done = true;
        if (o.onerror) o.onerror({ status: 0, error: String(e) });
        if (o.onloadend) o.onloadend({ status: 0 });
      });
    } catch (e) {
      if (o.onerror) o.onerror({ status: 0, error: String(e) });
    }
    return { abort: function () { done = true; } };
  };
  window.__harnessErrors = [];
  window.addEventListener('error', function (e) { window.__harnessErrors.push(String(e.message).slice(0, 300)); });
  window.addEventListener('unhandledrejection', function (e) { window.__harnessErrors.push('promise: ' + String(e.reason).slice(0, 200)); });
  `;
};
