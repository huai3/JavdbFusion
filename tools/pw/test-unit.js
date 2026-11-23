/*
 * 零依赖回归单元测试套件（Node 内置 vm 沙箱 + 真实脚本源码校验）
 * 运行方式：node tools/pw/test-unit.js
 * 覆盖 JavdbFusion.user.js 与 115Fusion.user.js 的安全红线、/plans 路由守卫、
 * 缓存去重隔离、115 自动归档与批量分片、番号提取、CF 避让、IINA 命令转义等核心逻辑。
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const repoRoot = path.resolve(__dirname, '../..');
const javdbSrc = fs.readFileSync(path.join(repoRoot, 'JavdbFusion.user.js'), 'utf8');
const f115Src = fs.readFileSync(path.join(repoRoot, '115Fusion.user.js'), 'utf8');

let passed = 0;
function test(name, fn) {
  try {
    const res = fn();
    if (res && typeof res.then === 'function') {
      return res.then(() => { passed++; console.log('  PASS:', name); });
    }
    passed++;
    console.log('  PASS:', name);
    return Promise.resolve();
  } catch (e) {
    console.error('  FAIL:', name);
    console.error(e);
    process.exit(1);
  }
}

function createMockEnv(opts = {}) {
  const lsMap = new Map(Object.entries(opts.localStorage || {}));
  const gmMap = new Map(Object.entries(opts.gmStorage || {}));
  const xhrCalls = [];
  const listeners = { doc: {}, win: {} };
  const styleAppends = [];
  const classSet = new Set();
  const location = {
    hostname: opts.hostname || 'javdb.com',
    pathname: opts.pathname || '/',
    search: opts.search || '',
    hash: opts.hash || '',
    href: opts.href || ('https://javdb.com' + (opts.pathname || '/')),
    origin: 'https://javdb.com',
    replacedWith: null,
    replace(u) { this.replacedWith = u; }
  };
  const makeEl = (tag) => ({
    tagName: String(tag || 'DIV').toUpperCase(),
    nodeType: 1,
    style: {},
    dataset: {},
    textContent: '',
    innerHTML: '',
    children: [],
    classList: { add() {}, remove() {}, contains() { return false; }, toggle() {} },
    setAttribute() {},
    getAttribute() { return null; },
    remove() {},
    appendChild(c) {
      this.children.push(c);
      if (tag === 'head' && c && c.id === 'javdb-emby-skin') styleAppends.push(c);
    },
    insertBefore() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    matches() { return false; }
  });
  const docEl = {
    nodeType: 1,
    classList: {
      add(c) { classSet.add(c); },
      remove(c) { classSet.delete(c); },
      contains(c) { return classSet.has(c); }
    },
    appendChild() {},
    matches() { return false; },
    querySelectorAll() { return []; }
  };
  const document = {
    nodeType: 9,
    readyState: opts.readyState || 'loading',
    title: opts.title || 'JavDB',
    documentElement: docEl,
    head: makeEl('head'),
    body: makeEl('body'),
    referrer: opts.referrer || '',
    cookie: '',
    images: [],
    getElementById() { return null; },
    querySelector(sel) { return opts.querySelector ? opts.querySelector(sel) : null; },
    querySelectorAll(sel) { return opts.querySelectorAll ? opts.querySelectorAll(sel) : []; },
    createElement: makeEl,
    addEventListener(ev, fn) { (listeners.doc[ev] = listeners.doc[ev] || []).push(fn); },
    removeEventListener() {}
  };
  const localStorage = {
    getItem(k) { return lsMap.has(k) ? lsMap.get(k) : null; },
    setItem(k, v) { lsMap.set(k, String(v)); },
    removeItem(k) { lsMap.delete(k); }
  };
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout,
    clearTimeout,
    setInterval: () => 0,
    clearInterval() {},
    URL,
    URLSearchParams,
    AbortController,
    MutationObserver: class { observe() {} disconnect() {} },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    ResizeObserver: class { observe() {} disconnect() {} },
    DOMParser: class { parseFromString() { return document; } },
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } },
    Event: class { constructor(t) { this.type = t; } },
    addEventListener(ev, fn) { (listeners.win[ev] = listeners.win[ev] || []).push(fn); },
    removeEventListener() {},
    dispatchEvent() {},
    innerWidth: 1440,
    innerHeight: 900,
    scrollY: 0,
    pageYOffset: 0,
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    requestAnimationFrame: (fn) => setTimeout(fn, 0),
    cancelAnimationFrame: clearTimeout,
    navigator: { userAgent: 'MockChrome/120' },
    history: { state: null, pushState() {}, replaceState() {} },
    location,
    document,
    localStorage,
    sessionStorage: localStorage,
    GM_info: { script: { version: '7.421-appletv-pro' } },
    GM_getValue: (k, def) => gmMap.has(k) ? gmMap.get(k) : def,
    GM_setValue: (k, v) => { gmMap.set(k, v); },
    GM_setClipboard() {},
    GM_registerMenuCommand() {},
    GM_xmlhttpRequest: (opt) => {
      xhrCalls.push(opt);
      if (opts.xhrHandler) return opts.xhrHandler(opt);
      const timer = setTimeout(() => {
        if (opt.onload) opt.onload({ status: 200, statusText: 'OK', responseText: '{"ok":true}', finalUrl: opt.url });
      }, 2);
      return { abort() { clearTimeout(timer); if (opt.onabort) opt.onabort(); } };
    },
    indexedDB: {
      open() {
        const req = {};
        const mockStore = {
          getAll() { const r = {}; setTimeout(() => { r.result = []; r.onsuccess && r.onsuccess({ target: r }); }, 0); return r; },
          get() { const r = {}; setTimeout(() => { r.result = null; r.onsuccess && r.onsuccess({ target: r }); }, 0); return r; },
          put() { return {}; },
          clear() { return {}; }
        };
        const mockDb = {
          objectStoreNames: { contains: () => true },
          transaction() { const tx = { objectStore: () => mockStore }; setTimeout(() => tx.oncomplete && tx.oncomplete(), 0); return tx; }
        };
        setTimeout(() => { req.result = mockDb; req.onsuccess && req.onsuccess({ target: req }); }, 0);
        return req;
      }
    },
    unsafeWindow: {}
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  return { sandbox, lsMap, gmMap, xhrCalls, listeners, location, styleAppends, classSet };
}

function instrumentJavdb(hookCode) {
  const tailPos = javdbSrc.lastIndexOf('})();');
  return javdbSrc.slice(0, tailPos) + '\n  ' + hookCode + '\n' + javdbSrc.slice(tailPos);
}

async function runAll() {
  console.log('Running JavdbFusion & 115Fusion unit tests...');

  // === JavdbFusion P0 ===
  await test('[JavdbFusion/P0] /plans loads without TDZ crash and migrates secrets out of localStorage', () => {
    const env = createMockEnv({
      pathname: '/plans',
      readyState: 'loading',
      localStorage: {
        javdb_git_token: 'ghp_legacy_secret_token',
        javdb_webdav_pass: 'wd_legacy_pass',
        jhs_appAuthorization: 'jwt_legacy_token'
      }
    });
    vm.runInNewContext(javdbSrc, env.sandbox);
    assert.strictEqual(env.location.replacedWith, null);
    assert.strictEqual(env.gmMap.get('jf_sec_javdb_git_token'), 'ghp_legacy_secret_token');
    assert.strictEqual(env.gmMap.get('jf_sec_javdb_webdav_pass'), 'wd_legacy_pass');
    assert.strictEqual(env.gmMap.get('jf_sec_jhs_appAuthorization'), 'jwt_legacy_token');
    assert.strictEqual(env.lsMap.has('javdb_git_token'), false);
    assert.strictEqual(env.lsMap.has('javdb_webdav_pass'), false);
    assert.strictEqual(env.lsMap.has('jhs_appAuthorization'), false);
    assert.strictEqual(env.sandbox.unsafeWindow.FAV, undefined);
    assert.strictEqual(env.sandbox.unsafeWindow.FAVUI, undefined);
    (env.listeners.doc['DOMContentLoaded'] || []).forEach(fn => fn());
    assert.strictEqual(env.location.replacedWith, null);
    assert.strictEqual(env.classSet.has('emby-skin-pending'), false);
  });

  await test('[JavdbFusion/P0] /plans redirect fires only post-DOMContentLoaded for non-VIP from rankings, spares VIP', () => {
    const env1 = createMockEnv({
      pathname: '/plans/ypay',
      referrer: 'https://javdb.com/rankings/top',
      localStorage: { javdb_plugin_reviewListInfinite: '1' }
    });
    vm.runInNewContext(javdbSrc, env1.sandbox);
    assert.strictEqual(env1.location.replacedWith, null);
    (env1.listeners.doc['DOMContentLoaded'] || []).forEach(fn => fn());
    assert.strictEqual(env1.location.replacedWith, '/advanced_search?handleTop=1&handleType=all&type_value=&page=1');

    const env2 = createMockEnv({
      pathname: '/plans/ypay',
      referrer: 'https://javdb.com/rankings/top',
      localStorage: { javdb_plugin_reviewListInfinite: '1', jf_force_web_top: '1' }
    });
    vm.runInNewContext(javdbSrc, env2.sandbox);
    (env2.listeners.doc['DOMContentLoaded'] || []).forEach(fn => fn());
    assert.strictEqual(env2.location.replacedWith, null);
  });

  await test('[JavdbFusion/P0] FAV.exportJson(undefined, { excludeGitToken: true }) strips Git PAT', async () => {
    const env = createMockEnv({
      localStorage: {
        javdb_backup_include_auth: 'true',
        javdb_git_repo: 'huai3/my-backup',
        javdb_git_token: 'ghp_SUPER_SECRET_PAT',
        javdb_webdav_pass: 'wd_pass_123'
      }
    });
    vm.runInNewContext(javdbSrc, env.sandbox);
    const out = JSON.parse(await env.sandbox.FAV.exportJson(undefined, { excludeGitToken: true }));
    assert.strictEqual(out.__config.git.repo, 'huai3/my-backup');
    assert.strictEqual(out.__config.git.token, '');
    assert.strictEqual(out.__config.webdav.pass, 'wd_pass_123');
  });

  await test('[JavdbFusion/P0] __gmWrapped excludes 115 lixian/M3U8 from cache and separates UA & anonymous keys', async () => {
    const env = createMockEnv({ pathname: '/v/abc' });
    vm.runInNewContext(javdbSrc, env.sandbox);
    const callXhr = (opt) => new Promise(resolve => env.sandbox.GM_xmlhttpRequest(Object.assign({}, opt, { onload: resolve })));

    await callXhr({ method: 'GET', url: 'https://115.com/web/lixian/?ct=lixian&ac=task_lists&page=1' });
    await callXhr({ method: 'GET', url: 'https://115.com/web/lixian/?ct=lixian&ac=task_lists&page=1' });
    assert.strictEqual(env.xhrCalls.filter(c => c.url.includes('ct=lixian')).length, 2);

    await callXhr({ method: 'GET', url: 'https://115.com/api/video/m3u8/pick1.m3u8', headers: { 'User-Agent': 'libmpv' } });
    await callXhr({ method: 'GET', url: 'https://115.com/api/video/m3u8/pick1.m3u8', headers: { 'User-Agent': 'Lavf/60.16.100' } });
    const m3u8 = env.xhrCalls.filter(c => c.url.includes('pick1.m3u8'));
    assert.strictEqual(m3u8.length, 2);
    assert.strictEqual(m3u8[0].headers['User-Agent'], 'libmpv');
    assert.strictEqual(m3u8[1].headers['User-Agent'], 'Lavf/60.16.100');

    await callXhr({ method: 'GET', url: 'https://example.com/anon-test', anonymous: true });
    await callXhr({ method: 'GET', url: 'https://example.com/anon-test', anonymous: false });
    assert.strictEqual(env.xhrCalls.filter(c => c.url === 'https://example.com/anon-test').length, 2);
  });

  await test('[JavdbFusion/P0] Pan115.executeAutoArchive spares unrelated single video in shared dir, archives matched subfolder', async () => {
    const apiOps = [];
    const env = createMockEnv({
      pathname: '/v/test1',
      gmStorage: { jf_115_dir_tpl: '云下载/${actor}', jf_115_folder_tpl: '${code}', jf_115_file_tpl: '${code}' },
      xhrHandler(opt) {
        apiOps.push({ method: opt.method || 'GET', url: opt.url });
        let body = '{"state":true,"data":[]}';
        if (opt.url.includes('webapi.115.com/files?') && opt.url.includes('cid=100&')) {
          body = JSON.stringify({ state: true, data: [{ fid: 'f_other', cid: '100', n: 'IPZZ-999.mp4', s: 2e9, pc: 'pc1', iv: 1 }] });
        } else if (opt.url.includes('webapi.115.com/files?') && opt.url.includes('cid=300&')) {
          body = JSON.stringify({ state: true, data: [{ cid: '301', pid: '300', n: 'SSIS-858-LTX' }] });
        } else if (opt.url.includes('webapi.115.com/files?') && opt.url.includes('cid=301&')) {
          body = JSON.stringify({ state: true, data: [
            { fid: 'f_vid', cid: '301', n: 'main_video.mp4', s: 3e9, pc: 'pc2', iv: 1 },
            { fid: 'f_sub', cid: '301', n: 'chinese.zh.srt', s: 5e4, pc: 'pc3', iv: 0 }
          ] });
        } else if (opt.url.includes('webapi.115.com/files?') && opt.url.includes('cid=0&')) {
          body = JSON.stringify({ state: true, data: [{ cid: '10', pid: '0', n: '云下载' }] });
        } else if (opt.url.includes('webapi.115.com/files?') && opt.url.includes('cid=10&')) {
          body = JSON.stringify({ state: true, data: [{ cid: '11', pid: '10', n: 'TestActor' }] });
        } else if (opt.url.includes('webapi.115.com/files?') && opt.url.includes('cid=11&')) {
          body = JSON.stringify({ state: true, data: [{ cid: '12', pid: '11', n: 'SSIS-858' }] });
        } else if (opt.url.includes('/files/edit') || opt.url.includes('/files/move')) {
          body = '{"state":true,"data":{}}';
        }
        setTimeout(() => opt.onload && opt.onload({ status: 200, responseText: body }), 1);
        return { abort() {} };
      }
    });
    vm.runInNewContext(instrumentJavdb('window.__F = FUSION;'), env.sandbox);
    const Pan115 = env.sandbox.__F.pan115;

    apiOps.length = 0;
    const resA = await Pan115.executeAutoArchive('100', 'SSIS-858', { actor: 'TestActor', hasFemaleActor: true });
    assert.strictEqual(resA.ok, false);
    assert.strictEqual(apiOps.some(op => op.url.includes('/files/edit') || op.url.includes('/files/move')), false);

    apiOps.length = 0;
    const resB = await Pan115.executeAutoArchive('300', 'SSIS-858', { actor: 'TestActor', hasFemaleActor: true });
    assert.strictEqual(resB.ok, true);
    assert.strictEqual(resB.renamed, 2);
    assert.strictEqual(resB.moved, 2);
  });

  await test('[JavdbFusion/P0] escapeHtml handles null/undefined safely', () => {
    const fnMatch = javdbSrc.match(/function escapeHtml\(s\)\s*\{[\s\S]*?\n  \}/);
    const escapeHtml = vm.runInNewContext(`(${fnMatch[0]})`);
    assert.strictEqual(escapeHtml(null), '');
    assert.strictEqual(escapeHtml(undefined), '');
    assert.strictEqual(escapeHtml('<script>"\'&'), '&lt;script&gt;&quot;&#39;&amp;');
  });

  // === JavdbFusion P1 & P2 ===
  await test('[JavdbFusion/P1] getServers preserves serverId, syncIndex rejects HTTP 401 safely, buildJumpUrl replaces all {code}', async () => {
    const gmMap = new Map([
      ['jf_servers', JSON.stringify([{
        id: 's1', name: 'JF', type: 'jellyfin', baseUrl: 'https://jf.local', apiKey: 'k1',
        serverId: 'SRV_XYZ_99', jumpMode: 'custom', customTemplate: 'https://jf.local/find?a={code}&b={code}', enabled: true
      }])],
      ['jf_index_s1', JSON.stringify({ ts: Date.now(), entries: { 'SSIS-858': { id: 'it1', sid: 'SRV_XYZ_99' } } })]
    ]);
    const getServersSrc = javdbSrc.match(/function getServers\(\)\s*\{[\s\S]*?\n    \}/)[0];
    const buildJumpSrc = javdbSrc.match(/function buildJumpUrl\(s, code, item\)\s*\{[\s\S]*?\n    \}/)[0];
    const safeHrefSrc = javdbSrc.match(/function safeHref\(url, fallback\)\s*\{[\s\S]*?\n  \}/)[0];
    const ctx = vm.createContext({ GM_getValue: (k, d) => gmMap.has(k) ? gmMap.get(k) : d });
    vm.runInContext(safeHrefSrc + '\n' + getServersSrc + '\n' + buildJumpSrc, ctx);
    const srvs = ctx.getServers();
    assert.strictEqual(srvs[0].serverId, 'SRV_XYZ_99');
    assert.strictEqual(ctx.buildJumpUrl(srvs[0], 'SSIS-858', null), 'https://jf.local/find?a=SSIS-858&b=SSIS-858');
    assert.ok(ctx.buildJumpUrl(srvs[0], 'SSIS-858', { Id: 'it1' }).includes('serverId=SRV_XYZ_99'));

    const syncSrc = javdbSrc.match(/async function syncIndex\(s, onProgress\)\s*\{[\s\S]*?\n    \}/)[0];
    const apiUrlSrc = javdbSrc.match(/function apiUrl\(s, path\)\s*\{[\s\S]*?\n    \}/)[0];
    const hdrSrc = javdbSrc.match(/function serverHeaders\(s\)\s*\{[\s\S]*?\n    \}/)[0];
    const sctx = vm.createContext({
      gmReq: async () => ({ status: 401, responseText: '{"Message":"Unauthorized"}' }),
      GM_setValue: (k, v) => gmMap.set(k, v),
      indexKey: s => 'jf_index_' + s.id,
      listIndexLookups: new Map(),
      listCacheLookups: new Map()
    });
    vm.runInContext(apiUrlSrc + '\n' + hdrSrc + '\n' + syncSrc, sctx);
    let threw = false;
    try { await sctx.syncIndex(srvs[0]); } catch (e) { threw = true; }
    assert.strictEqual(threw, true);
    assert.ok(JSON.parse(gmMap.get('jf_index_s1')).entries['SSIS-858']);
  });

  await test('[JavdbFusion/P1] Pan115.conf allows empty folderTpl/dirTpl and listDir paginates past 500 items', async () => {
    let pageCalls = 0;
    const env = createMockEnv({
      gmStorage: { jf_115_folder_tpl: '', jf_115_dir_tpl: '' },
      xhrHandler(opt) {
        if (opt.url.includes('webapi.115.com/files?')) {
          pageCalls++;
          const off = Number((opt.url.match(/offset=(\d+)/) || [0, 0])[1]);
          const data = Array.from({ length: off === 0 ? 500 : 150 }, (_, i) => ({
            fid: String(off + i + 1), cid: '10', n: `ITEM-${off + i + 1}.mp4`, s: 1e8, pc: `pc${off + i}`, iv: 1
          }));
          setTimeout(() => opt.onload && opt.onload({ status: 200, responseText: JSON.stringify({ state: true, count: 650, data }) }), 1);
          return { abort() {} };
        }
        setTimeout(() => opt.onload && opt.onload({ status: 200, responseText: '{}' }), 1);
        return { abort() {} };
      }
    });
    vm.runInNewContext(instrumentJavdb('window.__F = FUSION;'), env.sandbox);
    const Pan115 = env.sandbox.__F.pan115;
    assert.strictEqual(Pan115.conf().folderTpl, '');
    assert.strictEqual(Pan115.conf().dirTpl, '');
    const items = await Pan115.listDir('10');
    assert.strictEqual(pageCalls, 2);
    assert.strictEqual(items.length, 650);
  });

  await test('[JavdbFusion/P1] Ranking interceptor bound on startup, tryAgeGate scoped to modal, CF challenge bails out', () => {
    const env = createMockEnv({ pathname: '/' });
    vm.runInNewContext(instrumentJavdb('window.__tryAgeGate = tryAgeGate;'), env.sandbox);
    (env.listeners.doc['DOMContentLoaded'] || []).forEach(fn => fn());
    assert.strictEqual(env.sandbox.__rankingClickBound, true);
    assert.strictEqual(env.sandbox.__efavActorDelegateBound, true);

    let movieClicked = false, modalClicked = false;
    const movieLink = { textContent: '18歲 18+', closest: s => s.includes('.movie-list') ? {} : null, click() { movieClicked = true; } };
    env.sandbox.document.querySelectorAll = sel => sel.includes('.modal.is-active') ? [] : [movieLink];
    assert.strictEqual(env.sandbox.__tryAgeGate(), false);
    assert.strictEqual(movieClicked, false);

    const modalBtn = { textContent: '我已滿18歲', closest: () => null, click() { modalClicked = true; } };
    env.sandbox.document.querySelectorAll = sel => sel.includes('.modal.is-active') ? [{ querySelectorAll: () => [modalBtn] }] : [];
    assert.strictEqual(env.sandbox.__tryAgeGate(), true);
    assert.strictEqual(modalClicked, true);

    const cfEnv = createMockEnv({
      title: 'Just a moment...',
      querySelector: sel => sel.includes('.cf-turnstile') ? { id: 'cf' } : null
    });
    vm.runInNewContext(javdbSrc, cfEnv.sandbox);
    (cfEnv.listeners.doc['DOMContentLoaded'] || []).forEach(fn => fn());
    assert.strictEqual(cfEnv.classSet.has('emby-skin-pending'), false);
    assert.strictEqual(cfEnv.classSet.has('emby-skin'), false);
    assert.strictEqual(cfEnv.styleAppends.length, 0);
  });

  await test('[JavdbFusion/P1+P2] embyNetRun skips 403 retry, PurityFilter g-flag safe, writeCache caps 1500, no double CSS build', async () => {
    const env = createMockEnv({
      gmStorage: { jf_purity_rules_v1: JSON.stringify({ enabled: true, mode: 'hide', actors: [], prefixes: [], tags: [], keywords: ['/VR|総集編/gi'], minScore: 0 }) }
    });
    vm.runInNewContext(instrumentJavdb('window.__T = { embyNetRun, FUSION };'), env.sandbox);

    let attempts = 0;
    try {
      await env.sandbox.__T.embyNetRun(null, () => { attempts++; return Promise.reject(new Error('HTTP 403')); });
    } catch (e) {}
    assert.strictEqual(attempts, 1);

    const makeCard = () => ({
      dataset: { code: 'SSIS-001' },
      classList: { add() {}, remove() {}, contains() { return false; } },
      querySelector: s => s === '.video-title' ? { textContent: 'SSIS-001 総集編' } : null,
      querySelectorAll: () => []
    });
    env.sandbox.document.querySelectorAll = s => s.includes('.movie-list .item') ? [makeCard(), makeCard()] : [];
    assert.strictEqual(env.sandbox.__T.FUSION.purity.scan(), 2);

    const applyBlock = javdbSrc.match(/function applySkin\(on\)\s*\{[\s\S]*?document\.documentElement\.classList\.add\('emby-skin'\);/)[0];
    assert.strictEqual(applyBlock.includes('refreshSkinCss'), false);

    const writeCacheSrc = javdbSrc.match(/function writeCache\(s, c\)\s*\{[\s\S]*?\n    \}/)[0];
    let saved = '';
    const wctx = vm.createContext({ CACHE_TTL: 10000, cacheKey: () => 'k', GM_setValue: (_, v) => { saved = v; } });
    vm.runInContext(writeCacheSrc, wctx);
    const big = { EXPIRED: { id: 'x', ts: Date.now() - 999999 } };
    for (let i = 0; i < 1600; i++) big['C-' + i] = { id: String(i), ts: Date.now() - i };
    wctx.writeCache({ id: 's1' }, big);
    const parsed = JSON.parse(saved);
    assert.strictEqual(parsed.EXPIRED, undefined);
    assert.strictEqual(Object.keys(parsed).length, 1500);
  });

  // === 115Fusion P0, P1 & P2 ===
  await test('[115Fusion/P0] extractCode handles 3-digit amateur codes, 6-digit uncensored, and noise prefixes', () => {
    const fnMatch = f115Src.match(/function extractCode\(rawName\)\s*\{[\s\S]*?\n  \}/);
    const extractCode = vm.runInNewContext(`(${fnMatch[0]})`);
    const cases = [
      ['300MIUM-1024.mp4', '300MIUM-1024'],
      ['200GANA-2890.mp4', '200GANA-2890'],
      ['259LUXU-1720.mp4', '259LUXU-1720'],
      ['300MAAN-912.mp4', '300MAAN-912'],
      ['261ARA-555.mp4', '261ARA-555'],
      ['390JAC-188.mp4', '390JAC-188'],
      ['420HOI-256.mp4', '420HOI-256'],
      ['1000GIRI-012.mp4', '1000GIRI-012'],
      ['hhd800.com@300MIUM-1024.mp4', '300MIUM-1024'],
      ['012324-001.mp4', '012324-001'],
      ['123456_001.mkv', '123456_001'],
      ['CD-01_SSIS-858.mp4', 'SSIS-858'],
      ['FHD-1080_259LUXU-1720.mp4', '259LUXU-1720'],
      ['T28-555.mp4', 'T28-555'],
      ['FC2-PPV-1234567.mp4', 'FC2-1234567'],
      ['HEYZO-1234.mp4', 'HEYZO-1234'],
      ['CARIB-010124-001.mp4', 'CARIB-010124-001'],
      ['1PONDO-010124_001.mp4', '1PONDO-010124_001']
    ];
    for (const [input, expected] of cases) {
      assert.strictEqual(extractCode(input), expected, `extractCode(${input})`);
    }
  });

  await test('[115Fusion/P0] disambiguateBatchPlans preserves subtitle lang tags and chunks move/removeJunk <=50', async () => {
    const fn1 = f115Src.match(/function appendSeqBeforeExt\([\s\S]*?\n  \}/)[0];
    const fn2 = f115Src.match(/function disambiguateBatchPlans\([\s\S]*?\n  \}/)[0];
    const ctx = vm.createContext({});
    vm.runInContext(fn1 + '\n' + fn2, ctx);

    assert.strictEqual(ctx.appendSeqBeforeExt('SSIS-001.zh.srt', 2), 'SSIS-001-2.zh.srt');
    assert.strictEqual(ctx.appendSeqBeforeExt('SSIS-001', 2), 'SSIS-001-2');

    const rows = [
      { file: { fid: '1', name: 'a.zh.srt' }, plan: { targetRelPath: '云下载/A/SSIS-001', newFileName: 'SSIS-001.zh.srt' } },
      { file: { fid: '2', name: 'b.zh.srt' }, plan: { targetRelPath: '云下载/A/SSIS-001', newFileName: 'SSIS-001.zh.srt' } },
      { file: { fid: '3', name: 'raw@IPZZ-100.mp4' }, plan: { targetRelPath: '', newFileName: 'IPZZ-100.mp4' } }
    ];
    const allItems = [
      { fid: '1', isFile: true, name: 'a.zh.srt' },
      { fid: '2', isFile: true, name: 'b.zh.srt' },
      { fid: '3', isFile: true, name: 'raw@IPZZ-100.mp4' },
      { fid: '99', isFile: true, name: 'IPZZ-100.mp4' }
    ];
    ctx.disambiguateBatchPlans(rows, allItems);
    assert.strictEqual(rows[1].plan.newFileName, 'SSIS-001-2.zh.srt');
    assert.strictEqual(rows[2].plan.newFileName, 'IPZZ-100-2.mp4');

    const moveSrc = f115Src.match(/async function move\(fids, destCid\)\s*\{[\s\S]*?\n    \}/)[0];
    const remSrc = f115Src.match(/async function removeJunk\(fids, parentCid\)\s*\{[\s\S]*?\n    \}/)[0];
    const posts = [];
    const mctx = vm.createContext({ sleep: async () => {}, postForm: async (u, b) => { posts.push({ u, b }); return {}; } });
    vm.runInContext(moveSrc + '\n' + remSrc, mctx);
    await mctx.move(Array.from({ length: 120 }, (_, i) => String(i + 1)), '999');
    assert.strictEqual(posts.length, 3);
    posts.length = 0;
    await mctx.removeJunk(Array.from({ length: 105 }, (_, i) => String(i + 1)), '123');
    assert.strictEqual(posts.length, 3);
  });

  await test('[115Fusion/P1+P2] DMM_PREFIX_MAP, ensureDirPath >600 + cache, safeJsonParse, and safe IINA shell command', async () => {
    const mapSrc = f115Src.match(/const DMM_PREFIX_MAP = \{[\s\S]*?\};/)[0];
    const mctx = vm.createContext({});
    vm.runInContext(mapSrc + '\nthis.M = DMM_PREFIX_MAP;', mctx);
    assert.strictEqual(mctx.M['HABA'], '1haba');
    assert.strictEqual(mctx.M[' HABA'], undefined);

    const ensureSrc = f115Src.match(/async function ensureDirPath\([\s\S]*?\n    \}/)[0];
    let listCalls = 0;
    const ectx = vm.createContext({
      sleep: async () => {},
      mkdir: async () => { throw new Error('unexpected mkdir'); },
      listDirAll: async (cid, cap) => {
        listCalls++;
        assert.ok(cap >= 5000);
        if (cid === '0') return { items: [{ dir: true, cid: '10', name: '云下载' }] };
        return { items: Array.from({ length: 700 }, (_, i) => ({ dir: true, cid: String(1000 + i), name: 'Actor_' + i })) };
      }
    });
    vm.runInContext(ensureSrc, ectx);
    const cache = new Map();
    assert.strictEqual(await ectx.ensureDirPath('0', '云下载/Actor_650', cache), '1650');
    assert.strictEqual(await ectx.ensureDirPath('0', '云下载/Actor_651', cache), '1651');
    assert.strictEqual(listCalls, 2);

    const jsonSrc = f115Src.match(/function safeJsonParse\([\s\S]*?\n    \}/)[0];
    const jctx = vm.createContext({});
    vm.runInContext(jsonSrc, jctx);
    assert.throws(() => jctx.safeJsonParse('<html>login</html>', '读取目录'), /非 JSON 页面/);
    assert.strictEqual(jctx.safeJsonParse('{"state":true}').state, true);

    const cmdSrc = f115Src.match(/function buildSafeIinaUaCmd\([\s\S]*?\n    \}/)[0];
    const cctx = vm.createContext({});
    vm.runInContext(cmdSrc, cctx);
    const hostileUa = `Mozilla/5.0 (Mac; 'quoted' | & %s $HOME \`id\` "dbl")`;
    const cmd = cctx.buildSafeIinaUaCmd(hostileUa);
    if (process.platform !== 'win32') {
      const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'f115-ua-'));
      try {
        const confDir = path.join(tmpHome, 'Library', 'Application Support', 'com.colliderli.iina');
        fs.mkdirSync(confDir, { recursive: true });
        const confPath = path.join(confDir, 'mpv.conf');
        fs.writeFileSync(confPath, 'keep-open=yes\nuser-agent="OLD"\n');
        execFileSync('/bin/sh', ['-c', cmd], { env: { ...process.env, HOME: tmpHome } });
        const res = fs.readFileSync(confPath, 'utf8');
        assert.ok(res.includes('keep-open=yes'));
        assert.strictEqual(res.includes('OLD'), false);
        assert.strictEqual(res.includes('uid='), false);
        assert.ok(res.includes(`user-agent="Mozilla/5.0 (Mac; 'quoted' | & %s $HOME \`id\` \\"dbl\\")"`));
      } finally {
        fs.rmSync(tmpHome, { recursive: true, force: true });
      }
    }
    assert.ok(f115Src.includes('mask._close = close;'));
    assert.ok(f115Src.includes('card._loadScrubThumbs = function ()'));
  });

  console.log(`\nALL ${passed} UNIT TESTS PASSED!`);
  process.exit(0);
}

runAll();
