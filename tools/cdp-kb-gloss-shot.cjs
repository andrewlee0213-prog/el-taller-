/* KB · gloss 式验收截图：临时账号登录 → API 建划线 + 真实问AI → 深链进章截页边卡 →
   回顾闪卡截图 → 手机宽行内卡截图 → （可选）清理
   用法: node tools/cdp-kb-gloss-shot.cjs [keep]   （keep=保留数据不删划线） */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = 9225;
const EDGE = [process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean).find(p => fs.existsSync(p));
const USER = 'kbtest-tmp', PASS = 'kbtest-pass-2026';
const OUT_DIR = path.join(__dirname, 'shots');
const KEEP = process.argv[2] === 'keep';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const { DatabaseSync } = await import('node:sqlite');
  const crypto = await import('node:crypto');
  const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'users.db'));
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT OR REPLACE INTO users(username,pwhash,salt,role,must_change) VALUES(?,?,?,?,0)')
    .run(USER, crypto.scryptSync(PASS, salt, 64).toString('hex'), salt, 'user');

  const udd = path.join(require('os').tmpdir(), 'edge-cdp-kb-gloss');
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
  let id = 0; const pending = new Map(); const errs = [];
  ws.onmessage = ev => {
    const d = JSON.parse(ev.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(d.params.type))
      errs.push(d.params.type + ': ' + (d.params.args || []).map(a => a.value || a.description || '').join(' ').slice(0, 200));
    if (d.method === 'Runtime.exceptionThrown')
      errs.push('exception: ' + JSON.stringify(d.params.exceptionDetails || {}).slice(0, 200));
  };
  const send = (method, params = {}) => new Promise(res => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });
  const evalJs = async expr => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result?.value;

  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1500, deviceScaleFactor: 1, mobile: false });
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: 'http://localhost:8891/login.html?next=%2Fkb.html' });
  await sleep(1200);
  await evalJs(`document.querySelector('#username').value='${USER}';document.querySelector('#password').value='${PASS}';document.querySelector('#submitBtn').click();'ok'`);
  await sleep(2000);
  console.log('登录后落在: ' + await evalJs('location.href'));

  /* 章内取一段真实文字做划线（quote+pre+suf 从正文来，锚定必中） */
  const mk = await evalJs(`(async () => {
    const r = await fetch('/api/kb/chapter?b=agent-handbook&c=0'); const j = await r.json();
    const text = j.html.replace(/<[^>]+>/g, ' ').replace(/\\s+/g, ' ').trim();
    const mid = Math.floor(text.length * 0.45);
    const quote = text.slice(mid, mid + 46);
    const pre = text.slice(mid - 30, mid), suf = text.slice(mid + 46, mid + 76);
    const r2 = await fetch('/api/kb/marks', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ b: 'agent-handbook', c: 0, quote, pre, suf, note: '这条划线是自动验收生成的：页边卡应与高亮对齐。' }) });
    const j2 = await r2.json();
    return j2.ok ? j2.mark.id + '|' + quote : 'FAIL:' + r2.status;
  })()`);
  console.log('建划线: ' + String(mk).slice(0, 90));
  const [midId, quote] = String(mk).split('|');

  /* 真实问 AI（glm-4-flash；一次调用验证端到端） */
  const ask = await evalJs(`(async () => {
    const r = await fetch('/api/kb/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ b: 'agent-handbook', c: 0, quote: ${JSON.stringify(quote)}, pre: '', suf: '', question: '用一句话解释这段文字讲了什么' }) });
    const j = await r.json();
    return j.ok ? 'OK: ' + j.mark.answer.slice(0, 120) : 'ERR ' + r.status + ' ' + (j.error || '');
  })()`);
  console.log('问AI: ' + ask);

  /* 深链直达划线 → 桌面页边卡截图 */
  await send('Page.navigate', { url: 'http://localhost:8891/kb.html#b=agent-handbook&c=0&m=' + midId });
  await sleep(2800);
  const anchored = await evalJs("!!document.querySelector('mark.kb-hl[data-mid=\"" + midId + "\"]')");
  const cards = await evalJs("document.querySelectorAll('.kb-notecard').length");
  const abs = await evalJs("document.querySelectorAll('.kb-notecard.abs').length");
  console.log(`高亮锚定: ${anchored} · 卡片: ${cards} 张（页边 ${abs}）`);
  await evalJs("document.querySelector('mark.kb-hl')?.scrollIntoView({block:'center'}); 'ok'");
  await sleep(700);
  let shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, 'kb-gloss-desktop.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('SHOT kb-gloss-desktop.png');

  /* 回顾闪卡 */
  await evalJs("document.getElementById('kbRevBtn').click(); 'ok'");
  await sleep(1500);
  const flipped = await evalJs("(function(){ document.querySelector('.kb-rev .card')?.click(); return document.querySelectorAll('.kb-rev .grades button').length; })()");
  await sleep(300);
  console.log('回顾浮层翻面后评分键: ' + flipped + ' 个');
  shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, 'kb-gloss-review.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('SHOT kb-gloss-review.png');
  await evalJs("document.querySelector('.kb-rev .cl')?.click(); 'ok'");
  await sleep(300);

  /* 手机宽：行内卡 */
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 2, mobile: true });
  await send('Page.navigate', { url: 'http://localhost:8891/kb.html#b=agent-handbook&c=0&m=' + midId });
  await sleep(2800);
  await evalJs("document.querySelector('mark.kb-hl')?.scrollIntoView({block:'center'}); 'ok'");
  await sleep(700);
  const inline = await evalJs("document.querySelectorAll('.kb-notecard.inline').length");
  console.log('手机行内卡: ' + inline + ' 张');
  shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(OUT_DIR, 'kb-gloss-mobile.png'), Buffer.from(shot.result.data, 'base64'));
  console.log('SHOT kb-gloss-mobile.png');

  /* 清理：删两条划线 + 删账号（keep 模式保留现场供人工查看） */
  if (!KEEP) {
    const ids = await evalJs("(async () => { const r = await fetch('/api/kb/marks?b=agent-handbook&c=0'); const j = await r.json(); return (j.marks||[]).map(m=>m.id).join(','); })()");
    for (const i of String(ids).split(',').filter(Boolean))
      await evalJs(`fetch('/api/kb/marks?id=${i}', { method: 'DELETE' }).then(()=>'ok')`);
    console.log('划线已清理');
  } else console.log('KEEP 模式：划线保留，深链 http://localhost:8891/kb.html#b=agent-handbook&c=0&m=' + midId);
  console.log(errs.length ? '⚠ 控制台告警:\n  ' + errs.slice(0, 8).join('\n  ') : '✓ 无控制台错误');
  db.prepare('DELETE FROM users WHERE username=?').run(USER);
  console.log('临时账号已删除');
  ws.close(); edge.kill();
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
