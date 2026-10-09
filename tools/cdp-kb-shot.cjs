/* KB 页视觉截图：CDP 真实登录流（临时账号登录 → 跳转 → 截图 → 账号自删）
   用法: node tools/cdp-kb-shot.cjs <宽> <高> <输出.png> [dsf]  */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const W = parseInt(process.argv[2] || '1440', 10);
const H = parseInt(process.argv[3] || '1750', 10);
const OUT = process.argv[4] || path.join(__dirname, 'shots', 'kb.png');
const DSF = parseFloat(process.argv[5] || '1');
const PORT = 9224;
const EDGE = [process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean).find(p => fs.existsSync(p));
const USER = 'kbtest-tmp', PASS = 'kbtest-pass-2026';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const { DatabaseSync } = await import('node:sqlite');
  const crypto = await import('node:crypto');
  const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'users.db'));
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT OR REPLACE INTO users(username,pwhash,salt,role,must_change) VALUES(?,?,?,?,0)')
    .run(USER, crypto.scryptSync(PASS, salt, 64).toString('hex'), salt, 'user');

  const udd = path.join(require('os').tmpdir(), 'edge-cdp-kb');
  fs.rmSync(udd, { recursive: true, force: true });
  const edge = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${udd}`, 'about:blank',
  ], { stdio: 'ignore' });

  let target = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
      target = list.find(t => t.type === 'page');
      if (target) break;
    } catch {}
  }
  if (!target) { edge.kill(); throw new Error('CDP not ready'); }
  const ws = new WebSocket(target.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'));
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0; const pending = new Map();
  ws.onmessage = ev => { const d = JSON.parse(ev.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const send = (method, params = {}) => new Promise(res => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evalJs = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.result?.value;

  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DSF, mobile: DSF > 1 });
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8891/login.html?next=%2Fkb.html' });
  await sleep(1200);
  await evalJs(`document.querySelector('#username').value='${USER}';document.querySelector('#password').value='${PASS}';document.querySelector('#submitBtn').click();'ok'`);
  await sleep(1800);
  const loc = await evalJs('location.href');
  console.log('登录后落在: ' + loc);
  await sleep(900);
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('SHOT ' + OUT);

  db.prepare('DELETE FROM users WHERE username=?').run(USER);
  console.log('临时账号已删除');
  ws.close(); edge.kill();
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
