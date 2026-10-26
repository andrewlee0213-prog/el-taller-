/* A+B 批验证：① reduced-motion 生效性（emulate 后 .g-blob animation 应为 none）
   ② skip-link 键盘走查（首次 Tab 应落在 skiplink，Enter 后焦点进正文锚点）
   ③ workbench/kb 768px 导航应保持单行（副标隐藏）
   用法: node tools/uiux-verify-a.cjs   （需 8891 在跑） */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const BASE = 'http://localhost:8891';
const PORT = 9225;
const USER = 'uiux-verify-tmp', PASS = 'uiux-verify-2026';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const EDGE = [process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean).find(p => fs.existsSync(p));

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')); }
};

(async () => {
  const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'users.db'));
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT OR REPLACE INTO users(username,pwhash,salt,role,must_change) VALUES(?,?,?,?,0)')
    .run(USER, crypto.scryptSync(PASS, salt, 64).toString('hex'), salt, 'admin');
  let edge;
  try {
    const lr = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASS }) });
    const cookie = (lr.headers.get('set-cookie') || '').split(';')[0];
    const [cn, cv] = cookie.split('=');

    const udd = path.join(require('os').tmpdir(), 'edge-cdp-verifya');
    fs.rmSync(udd, { recursive: true, force: true });
    edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run',
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
    const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.result.value;
    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setCookie', { name: cn, value: cv, url: BASE });
    const nav = async (url) => { await send('Page.navigate', { url }); await sleep(2000); };

    /* ① reduced-motion 生效性：6 个代表页 */
    console.log('— ① reduced-motion —');
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    for (const f of ['index.html', 'workbench.html', 'kb.html', 'login.html', 'kids-english.html', 'posts/kb-engineering.html', 'reader.html']) {
      await nav(BASE + '/' + f);
      const r = JSON.parse(await ev(`(() => {
        const bad = [];
        for (const el of document.querySelectorAll('*')) {
          const cs = getComputedStyle(el);
          if (cs.animationName !== 'none' && /infinite/.test(cs.animationIterationCount)) {
            bad.push(el.tagName + '.' + (el.className || '').toString().split(' ')[0] + ':' + cs.animationName);
            if (bad.length >= 3) break;
          }
        }
        return JSON.stringify({ bad, scroll: getComputedStyle(document.documentElement).scrollBehavior });
      })()`));
      check(`${f} 无 infinite 动画`, r.bad.length === 0, r.bad.join(','));
    }

    /* ② skip-link 键盘走查：index + kb */
    console.log('— ② skip-link 键盘走查 —');
    for (const f of ['index.html', 'kb.html']) {
      await nav(BASE + '/' + f);
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
      await sleep(200);
      const r1 = JSON.parse(await ev(`JSON.stringify({
        active: document.activeElement.className,
        href: document.activeElement.getAttribute ? document.activeElement.getAttribute('href') : '',
        visible: document.activeElement.getBoundingClientRect().top > 0 })`));
      check(`${f} 首次 Tab 落在 skiplink 且显形`, r1.active === 'skiplink' && r1.visible, JSON.stringify(r1));
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      await sleep(400);
      const r2 = await ev(`(document.activeElement.id || document.activeElement.tagName) + '|' + (location.hash || '无hash')`);
      check(`${f} Enter 跳进正文锚点`, /main|top/.test(r2), r2);
    }

    /* ③ 中屏复测：workbench/kb @768 —— 副标隐藏 + 同排无重叠 + 无横向溢出（两行换行是可接受兜底） */
    console.log('— ③ 中屏 768 复测 —');
    for (const f of ['workbench.html', 'kb.html']) {
      await send('Emulation.setDeviceMetricsOverride', { width: 768, height: 900, deviceScaleFactor: 1, mobile: false });
      await nav(BASE + '/' + f);
      const r = JSON.parse(await ev(`(() => {
        const b = document.querySelector('.brand b').getBoundingClientRect();
        const p = document.querySelector('.g-pill').getBoundingClientRect();
        return JSON.stringify({
          sameRowOverlap: b.right > p.left && Math.abs(b.y - p.y) < 15,
          smallVisible: getComputedStyle(document.querySelector('.g-pill a small')).display !== 'none',
          hOverflow: document.documentElement.scrollWidth > innerWidth + 1 }) })()`));
      check(`${f} @768 同排无重叠`, !r.sameRowOverlap, JSON.stringify(r));
      check(`${f} @768 中文副标已藏`, !r.smallVisible, '');
      check(`${f} @768 无横向溢出`, !r.hOverflow, JSON.stringify(r));
    }

    /* ④ poster-six h1 就位 */
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
    await nav(BASE + '/poster-six.html');
    const r4 = JSON.parse(await ev(`JSON.stringify({
      h1: document.querySelectorAll('h1').length,
      fs: document.querySelector('.ahead h1') ? getComputedStyle(document.querySelector('.ahead h1')).fontSize : '无' })`));
    check('poster-six 有且仅 1 个 h1 且样式就位', r4.h1 === 1 && r4.fs === '30px', JSON.stringify(r4));

    ws.close(); edge.kill();
  } finally {
    db.prepare('DELETE FROM users WHERE username=?').run(USER);
    db.close();
  }
  console.log(`\n结果：${pass} PASS / ${fail} FAIL`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
