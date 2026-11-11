// GM_* shim injected into the page before JavdbFusion.user.js.
// Network goes through the exposed __gmFetch binding so CORS/Cloudflare behave
// closer to Tampermonkey (cross-origin, custom headers, no page CORS).
(function () {
  const store = (window.__gmStore = window.__gmStore || Object.assign({}, window.__gmPrefs || {}));
  const listeners = new Map();
  let seq = 0;

  window.GM_getValue = function (k, d) {
    return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : d;
  };
  window.GM_setValue = function (k, v) { store[k] = v; };
  window.GM_deleteValue = function (k) { delete store[k]; };
  window.GM_listValues = function () { return Object.keys(store); };
  window.GM_setClipboard = function (text) {
    (window.__clipboard = window.__clipboard || []).push(String(text));
    try { navigator.clipboard && navigator.clipboard.writeText(String(text)); } catch (e) {}
  };
  window.GM_registerMenuCommand = function () {};
  window.GM_notification = function () {};
  window.GM_getResourceText = function () { return ''; };
  window.GM_addStyle = function (css) {
    const s = document.createElement('style');
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
    return s;
  };
  window.GM_openInTab = function (u) { window.open(u, '_blank'); };
  window.unsafeWindow = window;

  window.GM_xmlhttpRequest = function (opt) {
    const id = 'r' + (++seq);
    const ctl = new AbortController();
    listeners.set(id, ctl);
    const timer = opt.timeout ? setTimeout(function () {
      try { ctl.abort(); } catch (e) {}
      try { opt.ontimeout && opt.ontimeout({ status: 0 }); } catch (e) {}
    }, opt.timeout) : null;

    Promise.resolve()
      .then(function () {
        return window.__gmFetch({
          id: id,
          method: opt.method || 'GET',
          url: opt.url,
          headers: opt.headers || {},
          data: opt.data != null ? opt.data : null,
          anonymous: opt.anonymous === true
        });
      })
      .then(function (r) {
        if (ctl.signal.aborted) return;
        clearTimeout(timer);
        try {
          opt.onload && opt.onload({
            status: r.status,
            statusText: r.statusText || '',
            responseText: r.text || '',
            response: r.text || '',
            finalUrl: r.url || opt.url,
            responseHeaders: r.headers || ''
          });
        } catch (e) { console.error('[shim] onload threw', e); }
      })
      .catch(function (e) {
        clearTimeout(timer);
        if (ctl.signal.aborted) {
          try { opt.onabort && opt.onabort({ status: 0, error: 'aborted' }); } catch (x) {}
          return;
        }
        try { opt.onerror && opt.onerror({ status: 0, error: String(e && e.message || e) }); } catch (x) {}
      });

    const task = {
      abort: function () {
        try { ctl.abort(); } catch (e) {}
        listeners.delete(id);
      }
    };
    window.__gmTasks = window.__gmTasks || {};
    window.__gmTasks[id] = task;
    return task;
  };
})();
