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
          responseType: opt.responseType || '',
          anonymous: opt.anonymous === true
        });
      })
      .then(function (r) {
        if (ctl.signal.aborted) return;
        clearTimeout(timer);
        const hdrStr = typeof r.headers === 'string'
          ? r.headers
          : Object.entries(r.headers || {}).map(function (kv) { return kv[0] + ': ' + kv[1]; }).join('\r\n');
        if (typeof opt.onreadystatechange === 'function') {
          try {
            opt.onreadystatechange({
              readyState: 2,
              status: r.status,
              statusText: r.statusText || '',
              finalUrl: r.url || opt.url,
              responseHeaders: hdrStr
            });
          } catch (e) {}
        }
        if (ctl.signal.aborted) return;
        const wantType = String(opt.responseType || '').toLowerCase();
        let responseVal = r.text || '';
        let responseTextVal = r.text || '';
        if ((wantType === 'blob' || wantType === 'arraybuffer') && r.bodyBase64 != null) {
          const bin = atob(r.bodyBase64 || '');
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
          responseVal = wantType === 'blob'
            ? new Blob([bytes], { type: r.contentType || 'application/octet-stream' })
            : bytes.buffer;
          responseTextVal = '';
        } else if (wantType === 'json') {
          try { responseVal = JSON.parse(r.text || 'null'); } catch (e) { responseVal = null; }
        }
        const payload = {
          readyState: 4,
          status: r.status,
          statusText: r.statusText || '',
          responseText: responseTextVal,
          response: responseVal,
          finalUrl: r.url || opt.url,
          responseHeaders: hdrStr
        };
        if (typeof opt.onreadystatechange === 'function') {
          try { opt.onreadystatechange(payload); } catch (e) {}
        }
        if (ctl.signal.aborted) return;
        try {
          opt.onload && opt.onload(payload);
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
