/* 紫微日历三层 UI 验收截图：隔离数据目录起临时服务 + 临时 admin + 预置生辰，
   CDP 真实登录流进工作台，截「月历打点+流月主题」「周运势条+流日卡」两张图。
   用法: node tools/cdp-zw-shot.cjs   （产物在 tools/shots/zw-month.png / zw-day.png）*/
const { spawn } = require('child_process');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
const CDP_PORT = 9227;
const EDGE = [process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean).find(p => fs.existsSync(p));
const USER = 'zwtest-admin', PASS = 'zwtest-pass-2026';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const freePort = () => new Promise((ok, no) => {
  const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); s.on('error', no);
});

async function cdp(url) {
  return await new Promise((ok, no) => {
    const w = new WebSocket(url);
    const conn = { ws: w, id: 0, pending: new Map() };
    w.addEventListener('open', () => ok(conn));
    w.addEventListener('error', no);
    w.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.id && conn.pending.has(m.id)) { conn.pending.get(m.id)(m); conn.pending.delete(m.id); }
    });
    conn.send = (method, params = {}) => new Promise((res, rej) => {
      const id = ++conn.id;
      conn.pending.set(id, m => m.error ? rej(new Error(method + ': ' + JSON.stringify(m.error))) : res(m.result));
      w.send(JSON.stringify({ id, method, params }));
    });
  });
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const PORT = await freePort();
  const BASE = `http://localhost:${PORT}`;
  const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'taller-zw-shot-'));
  const server = spawn('node', ['server.js'], {
    cwd: ROOT, env: Object.assign({}, process.env, { TALLER_PORT: String(PORT), TALLER_DATA_DIR: tmpData }),
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  try {
    for (let i = 0; i < 40; i++) { try { await fetch(BASE + '/api/me'); break; } catch { await sleep(250); } }
    /* 临时 admin + 预置生辰（金标准盘 1988-10-08 未时男） */
    const { DatabaseSync } = await import('node:sqlite');
    const crypto = await import('node:crypto');
    const db = new DatabaseSync(path.join(tmpData, 'users.db'));
    const salt = crypto.randomBytes(16).toString('hex');
    db.prepare('INSERT INTO users(username,pwhash,salt,role,must_change) VALUES(?,?,?,?,0)')
      .run(USER, crypto.scryptSync(PASS, salt, 64).toString('hex'), salt, 'admin');
    db.close();
    let cookie = '';
    const login = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: USER, password: PASS }) });
    cookie = login.headers.get('set-cookie').split(';')[0];
    await fetch(BASE + '/api/workbench/ziwei', { method: 'PUT', headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ birth: { y: 1988, m: 10, d: 8, hour: 7, gender: '男' } }) });

    /* 无头浏览器 */
    const udd = path.join(os.tmpdir(), 'edge-cdp-zw');
    fs.rmSync(udd, { recursive: true, force: true });
    const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      `--remote-debugging-port=${CDP_PORT}`, `--user-data-dir=${udd}`, 'about:blank'], { stdio: 'ignore' });
    let target = null;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      try {
        const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json`)).json();
        target = list.find(t => t.type === 'page'); if (target) break;
      } catch {}
    }
    if (!target) throw new Error('CDP 页面目标未出现');
    const c = await cdp(target.webSocketDebuggerUrl);
    const { sessionId } = await c.send('Target.attachToTarget', { targetId: target.id, flatten: true });
    const send = (m, p) => c.send(m, Object.assign({ sessionId }, p));
    await send('Page.enable'); await send('Runtime.enable');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 2, mobile: false });

    /* 登录 → 工作台 */
    await send('Page.navigate', { url: BASE + '/login.html?next=%2Fworkbench.html' });
    await sleep(900);
    await send('Runtime.evaluate', { expression:
      `document.getElementById('username').value='${USER}';document.getElementById('password').value='${PASS}';document.getElementById('loginForm')?.requestSubmit?.()||document.getElementById('submitBtn').click()` });
    for (let i = 0; i < 40; i++) { await sleep(500); try {
      const r = await send('Runtime.evaluate', { expression: 'location.pathname', returnByValue: true });
      if (r.result.value.includes('workbench')) break;
    } catch {} }
    /* 等日历与紫微三层渲染 */
    for (let i = 0; i < 40; i++) { await sleep(500); const r = await send('Runtime.evaluate', { expression:
      "!!document.querySelector('.calday') && !!document.querySelector('.zwmonth b') && !!document.querySelector('.zwcell')", returnByValue: true });
      if (r.result.value) break; }

    const shot = async (sel, out) => {
      const r = await send('Runtime.evaluate', { returnByValue: true, expression:
        `(() => { const el = document.querySelector('${sel}'); if (!el) return null;
          const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, width: b.width, height: Math.min(b.height, 2200) }; })()` });
      if (!r.result.value) throw new Error('找不到 ' + sel);
      const img = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true,
        clip: Object.assign({ scale: 2 }, r.result.value) });
      fs.writeFileSync(out, Buffer.from(img.data, 'base64'));
      console.log('已截 ' + out);
    };
    await shot('.calpanel', path.join(SHOTS, 'zw-month.png'));

    /* 点今天（或任意带运势点的日子）→ 流日卡 */
    await send('Runtime.evaluate', { expression:
      "document.querySelector('[data-calday] .cdot.zw')?.closest('.calday')?.click()" });
    await sleep(700);
    await shot('.calpanel', path.join(SHOTS, 'zw-day.png'));

    edge.kill(); console.log('验收截图完成');
  } finally {
    server.kill();
    fs.rmSync(tmpData, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e.message); process.exit(1); });
