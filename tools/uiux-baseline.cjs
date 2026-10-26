/* UI/UX 基线截图：15 页 × 多尺寸，viewport 顶部截图（默认主题 bermellon）
   用法: node tools/uiux-baseline.cjs [标签]   （需 8891 dev 在跑；产物 tools/shots/uiux-<标签>/）
   会建临时 admin（uiux-base-tmp）截 kb/workbench/reader，结束后立即删号。
   尺寸集：1440×900 / 1024×768 / 875×900 / 768×1024 / 390×844 / 375×812 / 844×390(横屏) */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');

const TAG = process.argv[2] || 'baseline';
const BASE = 'http://localhost:8891';
const OUTDIR = path.join(__dirname, 'shots', 'uiux-' + TAG);
const PORT = 9223;
const USER = 'uiux-base-tmp', PASS = 'uiux-base-pass-2026';

const SIZES = [
  { w: 1440, h: 900, dsf: 1, mob: false, tag: 'd1440' },
  { w: 1024, h: 768, dsf: 1, mob: false, tag: 'd1024' },
  { w: 875,  h: 900, dsf: 1, mob: false, tag: 'd875' },
  { w: 768,  h: 1024, dsf: 1, mob: false, tag: 't768' },
  { w: 390,  h: 844, dsf: 2, mob: true,  tag: 'm390' },
  { w: 375,  h: 812, dsf: 2, mob: true,  tag: 'm375' },
  { w: 844,  h: 390, dsf: 2, mob: true,  tag: 'l844' },   // 横屏
];
const PAGES = [
  { f: 'index.html', auth: false },
  { f: 'workbench.html', auth: true, wait: 3200 },
  { f: 'kb.html', auth: true, wait: 3000 },
  { f: 'reader.html', auth: true },
  { f: 'video-scripts.html', auth: false },
  { f: 'about-site.html', auth: false },
  { f: 'openclaw.html', auth: false },
  { f: 'kids-english.html', auth: false },
  { f: 'kindle-dashboard.html', auth: false },
  { f: 'poster-six.html', auth: false },
  { f: 'login.html', auth: false },
  { f: 'posts/trace-as-state.html', auth: false },
  { f: 'posts/kb-engineering.html', auth: false },
  { f: 'posts/poster-agent-spec.html', auth: false },
  { f: 'posts/poster-methodology.html', auth: false },
];

const EDGE = [process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean).find(p => fs.existsSync(p));
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  /* 1. 临时 admin + 登录拿 cookie */
  const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'users.db'));
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT OR REPLACE INTO users(username,pwhash,salt,role,must_change) VALUES(?,?,?,?,0)')
    .run(USER, crypto.scryptSync(PASS, salt, 64).toString('hex'), salt, 'admin');
  let cookie = '';
  try {
    const lr = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASS }) });
    const sc = lr.headers.get('set-cookie');
    if (!sc) throw new Error('login no set-cookie: ' + await lr.text());
    cookie = sc.split(';')[0];
    const [cn, cv] = cookie.split('=');

    /* 2. 页重审计（顺手，D 批输入） */
    console.log('— 页重审计（HTML 字节）—');
    const audit = [];
    for (const p of PAGES) {
      const r = await fetch(BASE + '/' + p.f, { headers: { Cookie: cookie } });
      const t = await r.text();
      audit.push({ f: p.f, kb: Math.round(t.length / 1024) });
    }
    for (const js of ['works.js', 'notes.js', 'kb-data.js']) {
      const r = await fetch(BASE + '/' + js, { headers: { Cookie: cookie } });
      const t = await r.text();
      audit.push({ f: js, kb: Math.round(t.length / 1024) });
    }
    audit.sort((a, b) => b.kb - a.kb).forEach(a => console.log('  ' + String(a.kb).padStart(4) + ' KB  ' + a.f));

    /* 3. 冷启浏览器 */
    fs.mkdirSync(OUTDIR, { recursive: true });
    const udd = path.join(require('os').tmpdir(), 'edge-cdp-uiux-' + TAG);
    fs.rmSync(udd, { recursive: true, force: true });
    const edge = spawn(EDGE, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      `--remote-debugging-port=${PORT}`, `--user-data-dir=${udd}`, 'about:blank',
    ], { stdio: 'ignore' });
    let target = null;
    for (let i = 0; i < 40 && !target; i++) {
      await sleep(250);
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        target = list.find(t => t.type === 'page');
      } catch {}
    }
    if (!target) throw new Error('CDP not ready');

    const ws = new WebSocket(target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pending = new Map();
    ws.onmessage = ev => {
      const d = JSON.parse(ev.data);
      if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    };
    const send = (method, params = {}) => new Promise(res => {
      const mid = ++id; pending.set(mid, res);
      ws.send(JSON.stringify({ id: mid, method, params }));
    });

    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setCookie', { name: cn, value: cv, url: BASE });

    /* 4. 页 × 尺寸循环截图 */
    let n = 0;
    for (const page of PAGES) {
      const name = page.f.replace(/\//g, '_').replace(/\.html$/, '');
      for (const s of SIZES) {
        await send('Emulation.setDeviceMetricsOverride', { width: s.w, height: s.h, deviceScaleFactor: s.dsf, mobile: s.mob });
        await send('Page.navigate', { url: BASE + '/' + page.f });
        await sleep(page.wait || 2200);
        const shot = await send('Page.captureScreenshot', { format: 'png' });
        fs.writeFileSync(path.join(OUTDIR, `${name}_${s.tag}.png`), Buffer.from(shot.result.data, 'base64'));
        n++;
      }
      console.log('  ✓ ' + page.f);
    }
    ws.close(); edge.kill();
    console.log(`完成：${n} 张 → ${OUTDIR}`);
  } finally {
    db.prepare('DELETE FROM users WHERE username=?').run(USER);
    db.close();
    console.log('临时账号已删：' + USER);
  }
}
main().catch(e => { console.error(e); process.exitCode = 1; });
