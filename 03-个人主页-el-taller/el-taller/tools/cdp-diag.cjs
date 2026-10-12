/* 布局诊断：任意视口下量关键区块坐标
   用法: node tools/cdp-diag.cjs <宽> <高> */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const W = parseInt(process.argv[2] || '2000', 10);
const H = parseInt(process.argv[3] || '1050', 10);
const PORT = 9225;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const udd = path.join(process.env.TEMP, 'edge-cdp-diag');
  fs.rmSync(udd, { recursive: true, force: true });
  const edge = spawn(EDGE, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${udd}`, 'about:blank'], { stdio: 'ignore' });
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

  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  await send('Page.enable');
  await send('Page.navigate', { url: 'http://localhost:8891/' });
  await sleep(2500);
  const r = await evalJs(`JSON.stringify({
    innerWidth, docScrollWidth: document.documentElement.scrollWidth,
    grid: (g=>g&&{top:g.getBoundingClientRect().top+scrollY, bottom:g.getBoundingClientRect().bottom+scrollY, h:g.offsetHeight, cols:getComputedStyle(g).gridTemplateColumns.split(' ').length})(document.querySelector('.workgrid')),
    cards: [...document.querySelectorAll('.workcard')].map(c=>({t:Math.round(c.getBoundingClientRect().top+scrollY),b:Math.round(c.getBoundingClientRect().bottom+scrollY)})),
    enlacesSection: (s=>s&&{top:Math.round(s.getBoundingClientRect().top+scrollY)})(document.querySelector('#enlaces')),
    enlacesHead: (s=>s&&{display:getComputedStyle(s).display, top:Math.round(s.getBoundingClientRect().top+scrollY), text:s.textContent.trim().slice(0,20)})(document.querySelector('#enlaces .section-head')),
    pills: (p=>p&&{top:Math.round(p.getBoundingClientRect().top+scrollY), bottom:Math.round(p.getBoundingClientRect().bottom+scrollY)})(document.querySelector('.enlaces')),
    footer: (f=>f&&{top:Math.round(f.getBoundingClientRect().top+scrollY)})(document.querySelector('.footer'))
  })`);
  console.log(r);
  ws.close(); edge.kill();
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
