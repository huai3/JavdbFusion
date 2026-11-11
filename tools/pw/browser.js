// Resolve a Chromium binary for Playwright in a portable way.
// Order: CHROME_PATH env -> Playwright's bundled browser -> newest ms-playwright cache.
const fs = require('fs');
const path = require('path');
const os = require('os');

function newestCachedChromium() {
  const roots = [
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'ms-playwright'),
    path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    path.join(os.homedir(), '.cache', 'ms-playwright')
  ].filter(Boolean);
  const candidates = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root)) {
      if (!/^chromium-\d+$/.test(dir)) continue;
      const base = path.join(root, dir);
      const rels = [
        ['chrome-mac-arm64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
        ['chrome-mac-x64', 'Google Chrome for Testing.app', 'Contents', 'MacOS', 'Google Chrome for Testing'],
        ['chrome-linux', 'chrome'],
        ['chrome-win', 'chrome.exe']
      ];
      for (const rel of rels) {
        const p = path.join(base, ...rel);
        if (fs.existsSync(p)) candidates.push({ p, v: Number(dir.split('-')[1]) || 0 });
      }
    }
  }
  candidates.sort((a, b) => b.v - a.v);
  return candidates.length ? candidates[0].p : '';
}

function launchOptions() {
  const explicit = process.env.CHROME_PATH;
  const p = explicit || newestCachedChromium();
  return p ? { headless: true, executablePath: p, args: ['--no-sandbox'] } : { headless: true, args: ['--no-sandbox'] };
}

module.exports = { launchOptions };
