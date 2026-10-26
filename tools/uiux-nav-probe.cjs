/* 一次性探针：中屏(875/768)下导航几何测量——brand 文字 rect vs g-pill 盒、副标是否显示
   对照组：index/kids(有 1080 藏副标规则) vs workbench/kb(缺规则)
   用法: node tools/uiux-nav-probe.cjs  （需 8891 在跑；只量匿名可见页的头部） */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const BASE = 'http://localhost:8891';
const PORT = 9224;
const USER = 'uiux-probe-tmp', PASS = 'uiux-probe-2026';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const CASES = [
  { f: 'workbench.html', w: 875 }, { f: 'workbench.html', w: 768 },
  { f: 'kb.html', w: 875 }, { f: 'kb.html', w: 768 },
  { f: 'index.html', w: 875 }, { f: 'kids-english.html', w: 768 },
];

const EDGE = [process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean).find(p => fs.existsSync(p));

(async () => {
  const udd = path.join(require('os').tmpdir(), 'edge-cdp-navprobe');
  fs.rmSync(udd, { recursive: true, force: true });
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${udd}`, 'about:blank'], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(250);
    try { target = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).find(t => t.type === 'page'); } catch {}
  }
  const ws = new WebSocket(target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = ev => { const d = JSON.parse(ev.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (m, p = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
  await send('Page.enable');

  const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'users.db'));
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT OR REPLACE INTO users(username,pwhash,salt,role,must_change) VALUES(?,?,?,?,0)')
    .run(USER, crypto.scryptSync(PASS, salt, 64).toString('hex'), salt, 'admin');
  try {
    const lr = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASS }) });
    const cookie = (lr.headers.get('set-cookie') || '').split(';')[0];
    const [cn, cv] = cookie.split('=');
    await send('Network.enable');
    await send('Network.setCookie', { name: cn, value: cv, url: BASE });

  for (const c of CASES) {
    /* kb/workbench 匿名会 302 到 login——探针只量到 login 也要如实报告 */
    await send('Emulation.setDeviceMetricsOverride', { width: c.w, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: BASE + '/' + c.f });
    await sleep(1800);
    const r = await send('Runtime.evaluate', { expression: `(() => {
      const brand = document.querySelector('.brand b');
      const pill = document.querySelector('.g-pill');
      const dots = document.querySelector('.themedots');
      const small = document.querySelector('.g-pill a small');
      const url = location.pathname;
      if (!brand || !pill) return JSON.stringify({ url, note: '无 .top 头(或被 302)' });
      const b = brand.getBoundingClientRect(), p = pill.getBoundingClientRect();
      const d = dots ? dots.getBoundingClientRect() : null;
      return JSON.stringify({
        url, vw: innerWidth,
        brandText: { x: Math.round(b.x), r: Math.round(b.right), y: Math.round(b.y), w: Math.round(b.width) },
        pill: { x: Math.round(p.x), r: Math.round(p.right), y: Math.round(p.y), w: Math.round(p.width), display: getComputedStyle(pill).display },
        brandRight_vs_pillLeft: Math.round(p.x - b.right),
        sameRow: Math.abs(b.y - p.y) < 5,
        smallVisible: small ? getComputedStyle(small).display !== 'none' : null,
        dotsX: d ? Math.round(d.x) : null, pill_vs_dots_gap: d ? Math.round(d.x - p.right) : null,
        overlap: b.right > p.x && Math.abs(b.y - p.y) < 5,
      });
    })()`, returnByValue: true });
    console.log(c.f.padEnd(22) + ' @' + c.w + '  ' + (r.result && r.result.result ? r.result.result.value : JSON.stringify(r)));
  }
  ws.close(); edge.kill();
  } finally {
    db.prepare('DELETE FROM users WHERE username=?').run(USER);
    db.close(); console.log('临时账号已删：' + USER);
  }
})().catch(e => { console.error(e); process.exit(1); });
