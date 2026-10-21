/*
 * JavdbFusion 115 整理改名增强补丁
 *
 * 参考实现：JAV老司机-新（2.9.4.4）的 115 模块。对方做到 850 处 115 相关代码，
 * 核心是「离线后整理」：推送离线任务后自动（或手动）清理垃圾文件、按模板规范改名、
 * 并把结果归入按模板生成的目录。
 * 本脚本原先只有「把一条磁力推给 115 离线」，没有整理/改名/目录归集。
 *
 * 本补丁新增：
 *   ① Pan115 API 封装（签名 / 列目录 / 新建目录 / 改名 / 移动 / 删除 / 搜索）
 *   ② 模板引擎：${code} ${actor} ${maker} ${series} ${title} ${suffix} ${crack} ${res}
 *   ③ 整理面板：列出目标目录 → 一键清理（0 字节 / 样片 / 广告）→ 一键规范改名
 *   ④ 设置项：离线后整理开关、离线目录模板、文件名模板、文件夹名模板
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
console.log('== 115 整理改名增强补丁 ==');

const PAN115 = `
    /* =======================================================================
     * 115 网盘整理模块（参考 JAV老司机 的「离线后整理 / 自动清理并改名」）
     * ===================================================================== */
    const Pan115 = (function () {
      const CONF = {
        dirTpl: 'jf_115_dir_tpl',
        fileTpl: 'jf_115_file_tpl',
        folderTpl: 'jf_115_folder_tpl',
        autoOrganize: 'jf_115_offline_organize',
        autoClean: 'jf_115_auto_clean'
      };
      const DEF_DIR_TPL = '云下载/\${actor}';
      const DEF_FILE_TPL = '\${code} \${title}';
      const DEF_FOLDER_TPL = '\${code}';

      function conf() {
        return {
          dirTpl: GM_getValue(CONF.dirTpl, DEF_DIR_TPL) || DEF_DIR_TPL,
          fileTpl: GM_getValue(CONF.fileTpl, DEF_FILE_TPL) || DEF_FILE_TPL,
          folderTpl: GM_getValue(CONF.folderTpl, DEF_FOLDER_TPL) || DEF_FOLDER_TPL,
          autoOrganize: GM_getValue(CONF.autoOrganize, false) === true,
          autoClean: GM_getValue(CONF.autoClean, false) === true
        };
      }
      function setConf(k, v) { GM_setValue(k, v); }

      // 115 签名（离线接口与部分 webapi 都需要）
      async function sign() {
        const r = await gmReq({
          url: 'https://115.com/?ct=offline&ac=space&_=' + Date.now(), timeout: 12000,
          headers: { 'Accept': 'application/json, text/plain, */*', 'Referer': 'https://115.com/?tab=offline&mode=wangpan' }
        });
        const txt = r.responseText || '';
        if (txt.indexOf('<') === 0) { const e = new Error('请先登录 115 账户'); e.code = 'PAN115_AUTH'; throw e; }
        const j = JSON.parse(txt);
        if (!j || !j.sign || !j.time) throw new Error('115 签名获取失败');
        return { sign: j.sign, time: j.time, uid: j.user_id };
      }

      function postForm(url, params, label) {
        return gmReq({
          url: url, method: 'POST', timeout: 15000,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          data: Object.keys(params).map(function (k) {
            return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]);
          }).join('&')
        }).then(function (r) {
          const j = JSON.parse(r.responseText || '{}');
          if (j.state === false) throw new Error((label || '115') + '失败: ' + (j.error_msg || j.msg || '未知'));
          return j.data !== undefined ? j.data : j;
        });
      }

      // 列目录
      async function listDir(cid) {
        const url = 'https://webapi.115.com/files?aid=1&cid=' + encodeURIComponent(cid || '0') +
          '&offset=0&limit=500&show_file_size=1&o=file_name&asc=1&fc=0';
        const r = await gmReq({ url: url, timeout: 15000, headers: { 'Accept': 'application/json' } });
        const j = JSON.parse(r.responseText || '{}');
        if (j.state === false) throw new Error(j.error_msg || '列目录失败');
        return (j.data || []).map(function (it) {
          return { id: String(it.cid || it.file_id || ''), name: it.file_name || '', dir: it.file_category === 1, size: it.sha1 ? (it.size || 0) : (it.size || 0), isFile: it.file_category !== 1 };
        });
      }

      // 新建目录
      async function mkdir(parentCid, name) {
        return postForm('https://webapi.115.com/files/add', { pid: parentCid || '0', cname: name }, '新建目录');
      }
      // 改名
      async function rename(fid, name) {
        return postForm('https://webapi.115.com/files/edit', { fid: fid, file_name: name }, '改名');
      }
      // 移动
      async function move(fids, cid) {
        return postForm('https://webapi.115.com/files/move', { 'fids[]': fids.join(','), cid: cid }, '移动');
      }
      // 删除
      async function remove(fids) {
        return postForm('https://webapi.115.com/rb/delete', { 'ids[]': fids.join(',') }, '删除');
      }
      // 搜索（按番号找已下载的文件）
      async function search(kw) {
        const r = await gmReq({ url: 'https://webapi.115.com/files/search?search_value=' + encodeURIComponent(kw) + '&offset=0&limit=50', timeout: 15000, headers: { 'Accept': 'application/json' } });
        const j = JSON.parse(r.responseText || '{}');
        if (j.state === false) throw new Error(j.error_msg || '搜索失败');
        return (j.data || []).map(function (it) {
          return { id: String(it.cid || it.file_id || ''), name: it.file_name || '', pickcode: it.video_id || '', size: it.size || 0, isFile: true };
        });
      }

      /* ---- 模板引擎 ---- */
      function pickTpl(tpl, vars) {
        return String(tpl || '').replace(/\\$\\{(\\w+)\\}/g, function (all, k) {
          const v = vars[k];
          return (v === undefined || v === null || v === '') ? '' : String(v);
        }).replace(/[\\\\/:*?"<>|]/g, ' ').replace(/\\s+/g, ' ').trim();
      }
      // 从文件名里抽番号
      function codeOf(name) {
        const m = String(name || '').match(/([A-Za-z0-9]{2,})[-_]?(\\d{2,6})/);
        return m ? (m[1].toUpperCase() + '-' + m[2]) : '';
      }
      // 保留 -U / -4K 之类的后缀
      function suffixOf(name) {
        const m = String(name || '').match(/((?:-|_)(?:U|UC|UW|4K|2K|HEVC|X264|X265|FHD|HD|1080|720)[A-Za-z0-9]*)/i);
        return m ? m[1] : '';
      }
      function varsFor(code, name, extra) {
        const v = {
          code: code || codeOf(name),
          title: String(name || '').replace(/\\.[a-z0-9]{2,4}$/i, ''),
          suffix: suffixOf(name),
          crack: /破解|无码|uncensored/i.test(name) ? '无码' : '',
          res: /4k|2160/i.test(name) ? '4K' : (/1080|720|hd/i.test(name) ? 'HD' : '')
        };
        if (extra) Object.keys(extra).forEach(function (k) { v[k] = extra[k]; });
        return v;
      }
      // 垃圾文件判定：0 字节 / 样片 / 广告 / 预览图
      function isJunk(it) {
        const n = String(it.name || '').toLowerCase();
        if (it.size === 0) return true;
        if (/sample|preview|广告|ad[-_. ]?ver|readme|nfo|txt$|\\.url$|\\.rar$/.test(n)) return true;
        return false;
      }

      /* ---- 整理面板 ---- */
      function openOrganizePanel(code, targetCid) {
        const old = document.getElementById('jf-pan115-panel');
        if (old) old.remove();
        const cid = (targetCid || (MagConf.u115Cid || '').trim() || '0');
        const mask = document.createElement('div');
        mask.id = 'jf-pan115-panel';
        mask.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;';
        mask.innerHTML =
          '<div class="jf-pan115-card" style="width:min(860px,92vw);max-height:84vh;overflow:auto;background:#16181d;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:1.1em 1.2em;box-shadow:0 20px 60px rgba(0,0,0,.6)">' +
          '<div style="display:flex;align-items:center;gap:.6em;margin-bottom:.8em">' +
          '<span class="material-symbols-outlined" style="color:var(--e-accent,#00a4dc)">drive_file_move</span>' +
          '<b style="font-size:1.05em">115 整理面板</b>' +
          '<span style="font-size:.82em;color:var(--e-text3)">目录 CID ' + escapeHtml(cid) + '</span>' +
          '<button type="button" class="jf-magtool-btn" data-pan-close style="margin-left:auto">关闭</button></div>' +
          '<div style="display:flex;gap:.5em;flex-wrap:wrap;margin-bottom:.8em">' +
          '<input class="jhs-input-text" data-pan-cid placeholder="目标目录 CID（留空=根目录）" value="' + escapeAttr(cid) + '" style="flex:1;min-width:200px">' +
          '<button type="button" class="jf-magtool-btn" data-pan-load>列出文件</button>' +
          '<button type="button" class="jf-magtool-btn" data-pan-clean>一键清理</button>' +
          '<button type="button" class="jf-magtool-btn" data-pan-rename>一键规范改名</button>' +
          '<button type="button" class="jf-magtool-btn" data-pan-move>归入模板目录</button>' +
          '</div>' +
          '<div data-pan-log style="font-size:.82em;color:var(--e-text3);margin-bottom:.6em">就绪。番号：' + escapeHtml(code || '') + '</div>' +
          '<div data-pan-list style="font-size:.86em"></div>' +
          '</div>';
        document.body.appendChild(mask);
        const logEl = mask.querySelector('[data-pan-log]');
        const listEl = mask.querySelector('[data-pan-list]');
        let files = [];
        const say = function (m, bad) { logEl.textContent = m; logEl.style.color = bad ? '#ff8080' : 'var(--e-text3)'; };
        mask.querySelector('[data-pan-close]').addEventListener('click', function () { mask.remove(); });
        mask.addEventListener('click', function (e) { if (e.target === mask) mask.remove(); });

        function draw() {
          if (!files.length) { listEl.innerHTML = '<div style="color:var(--e-text3);padding:.6em 0">（无文件）</div>'; return; }
          listEl.innerHTML = files.map(function (f) {
            return '<div style="display:flex;gap:.6em;padding:.35em 0;border-bottom:1px solid rgba(255,255,255,.06)">' +
              '<span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(f.name) + '</span>' +
              '<span style="color:var(--e-text3);font-size:.86em">' + (f.isFile ? (Math.round((f.size || 0) / 1048576) + ' MB') : '目录') + '</span>' +
              (f.isJunk ? '<span style="color:#ffb703;font-size:.8em">垃圾</span>' : '') +
              '</div>';
          }).join('');
        }
        async function load() {
          const c = (mask.querySelector('[data-pan-cid]').value || '0').trim();
          say('正在列出…');
          try {
            files = await listDir(c);
            files.forEach(function (f) { f.isJunk = f.isFile && isJunk(f); });
            draw();
            say('共 ' + files.length + ' 个条目');
          } catch (e) { say('列出失败: ' + e.message, true); }
        }
        mask.querySelector('[data-pan-load]').addEventListener('click', load);

        mask.querySelector('[data-pan-clean]').addEventListener('click', async function () {
          const junk = files.filter(function (f) { return f.isJunk; });
          if (!junk.length) { say('没有需要清理的垃圾文件'); return; }
          say('正在清理 ' + junk.length + ' 个…');
          try {
            await remove(junk.map(function (f) { return f.id; }));
            say('已清理 ' + junk.length + ' 个垃圾文件');
            await load();
          } catch (e) { say('清理失败: ' + e.message, true); }
        });

        mask.querySelector('[data-pan-rename]').addEventListener('click', async function () {
          const c = conf();
          const targets = files.filter(function (f) { return f.isFile && !f.isJunk; });
          if (!targets.length) { say('没有可改名的文件'); return; }
          say('正在按模板改名 ' + targets.length + ' 个…');
          let ok = 0, fail = 0;
          for (const f of targets) {
            const code2 = code || codeOf(f.name);
            const nv = pickTpl(c.fileTpl, varsFor(code2, f.name));
            if (!nv || nv === f.name) { continue; }
            try { await rename(f.id, nv); ok++; f.name = nv; } catch (e) { fail++; }
          }
          draw();
          say('改名完成：成功 ' + ok + '，失败 ' + fail + '（模板：' + c.fileTpl + '）', fail > 0);
        });

        mask.querySelector('[data-pan-move]').addEventListener('click', async function () {
          const c = conf();
          const parentCid = (mask.querySelector('[data-pan-cid]').value || '0').trim();
          const targets = files.filter(function (f) { return f.isFile && !f.isJunk; });
          if (!targets.length) { say('没有可归集的文件'); return; }
          const vars = varsFor(code, targets[0].name, { actor: '', maker: '', series: '' });
          const folder = pickTpl(c.folderTpl, vars) || (code || 'JAVDB');
          say('正在归入目录「' + folder + '」…');
          try {
            const mk = await mkdir(parentCid, folder);
            const dirCid = (mk && (mk.cid || mk.file_id || mk.id)) || '';
            if (!dirCid) { say('目录创建失败', true); return; }
            await move(targets.map(function (f) { return f.id; }), dirCid);
            say('已归入目录「' + folder + '」');
            await load();
          } catch (e) { say('归集失败: ' + e.message, true); }
        });

        load();
      }

      return {
        conf: conf, setConf: setConf, sign: sign, listDir: listDir, mkdir: mkdir,
        rename: rename, move: move, remove: remove, search: search,
        pickTpl: pickTpl, codeOf: codeOf, suffixOf: suffixOf, isJunk: isJunk,
        openPanel: openOrganizePanel,
        DEF: { dirTpl: DEF_DIR_TPL, fileTpl: DEF_FILE_TPL, folderTpl: DEF_FOLDER_TPL }
      };
    })();
`;

/* 1) 插入 Pan115 模块（放在 pushTo115 之前） */
rep(
  `    function pushTo115(link) {`,
  PAN115 + `
    function pushTo115(link) {`,
  '插入 Pan115 模块（API + 模板 + 整理面板）'
);

/* 2) pushTo115 成功后按开关弹出整理面板 */
rep(
  `                if (res.state) magToast(cid ? '✅ 已发送到 115 指定目录' : '✅ 已发送到 115');`,
  `                if (res.state) {
                  magToast(cid ? '✅ 已发送到 115 指定目录' : '✅ 已发送到 115');
                  // 离线后整理：推送成功后打开整理面板（可一键清理 / 规范改名 / 归入目录）
                  if (Pan115.conf().autoOrganize) {
                    setTimeout(function () {
                      try { Pan115.openPanel(currentPageCode ? currentPageCode() : '', cid); } catch (e) {}
                    }, 400);
                  }
                }`,
  'pushTo115 成功后弹出整理面板'
);

/* 3) 设置项：离线后整理 + 三个模板 */
rep(
  `          '<input class="jf-inp" id="jf115Cid" type="text" placeholder="可选：115 目录 CID / wp_path_id，留空保存到默认目录" value="' + escapeAttr(MagConf.u115Cid) + '">' +
          '<div class="jf-set-sec" style="margin-top:12px;opacity:.6;">保存后自动生效，无需刷新页面。</div>';`,
  `          '<input class="jf-inp" id="jf115Cid" type="text" placeholder="可选：115 目录 CID / wp_path_id，留空保存到默认目录" value="' + escapeAttr(MagConf.u115Cid) + '">' +
          '<div class="jf-set-sub">离线后整理（参考 JAV老司机）</div>' +
          '<label class="jf-set-row"><input type="checkbox" id="jf115AutoOrganize" ' + (Pan115.conf().autoOrganize ? 'checked' : '') + '> 离线后自动打开整理面板</label>' +
          '<label class="jf-set-row"><input type="checkbox" id="jf115AutoClean" ' + (Pan115.conf().autoClean ? 'checked' : '') + '> 一键清理垃圾文件（0字节 / 样片 / 广告）</label>' +
          '<div class="jf-set-sub">离线目录模板</div>' +
          '<input class="jf-inp" id="jf115DirTpl" type="text" placeholder="' + escapeAttr(Pan115.DEF.dirTpl) + '" value="' + escapeAttr(Pan115.conf().dirTpl) + '">' +
          '<div class="jf-set-sub">文件名模板</div>' +
          '<input class="jf-inp" id="jf115FileTpl" type="text" placeholder="' + escapeAttr(Pan115.DEF.fileTpl) + '" value="' + escapeAttr(Pan115.conf().fileTpl) + '">' +
          '<div class="jf-set-sub">文件夹名模板</div>' +
          '<input class="jf-inp" id="jf115FolderTpl" type="text" placeholder="' + escapeAttr(Pan115.DEF.folderTpl) + '" value="' + escapeAttr(Pan115.conf().folderTpl) + '">' +
          '<div class="jf-set-sec" style="margin-top:8px;opacity:.75;">模板变量：<code>\${code}</code> 番号 · <code>\${actor}</code> 演员 · <code>\${maker}</code> 厂商 · <code>\${series}</code> 系列 · <code>\${title}</code> 原名 · <code>\${suffix}</code> 后缀(-U/-4K) · <code>\${crack}</code> 无码 · <code>\${res}</code> 画质</div>' +
          '<div class="jf-set-sec" style="margin-top:12px;opacity:.6;">保存后自动生效，无需刷新页面。</div>';`,
  '设置项：离线后整理开关 + 三个模板'
);

/* 4) 绑定新的设置控件 */
rep(
  `        body.querySelector('#jf115Cid').addEventListener('change', function (e) { GM_setValue('jf_115_cid', e.target.value.trim()); });`,
  `        body.querySelector('#jf115Cid').addEventListener('change', function (e) { GM_setValue('jf_115_cid', e.target.value.trim()); });
        ['jf115AutoOrganize', 'jf115AutoClean'].forEach(function (id) {
          const el = body.querySelector('#' + id);
          if (!el) return;
          el.addEventListener('change', function () {
            Pan115.setConf(id === 'jf115AutoOrganize' ? 'jf_115_offline_organize' : 'jf_115_auto_clean', el.checked);
          });
        });
        [['jf115DirTpl', 'jf_115_dir_tpl'], ['jf115FileTpl', 'jf_115_file_tpl'], ['jf115FolderTpl', 'jf_115_folder_tpl']].forEach(function (pair) {
          const el = body.querySelector('#' + pair[0]);
          if (!el) return;
          el.addEventListener('change', function () { Pan115.setConf(pair[1], el.value); });
        });`,
  '绑定 115 整理相关设置项'
);

console.log('\napplied=' + applied + '  skipped=' + skipped);
if (skipped) { console.error('⚠ 有未应用项（其余改动仍会写入）: ' + skipped); }
try { new Function(src); console.log('syntax check: OK'); } catch (e) { console.error('SYNTAX ERROR:', e.message); process.exit(1); }
fs.writeFileSync(file, src, 'utf8');
