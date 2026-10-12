/* 手机视口 CDP 仿真：390x844 DSF2，取布局数值 + 截图
   用法: node tools/cdp-mobile.cjs [url] [outPng]   （需服务已启动） */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const URL_TO_OPEN = process.argv[2] || 'http://localhost:8891/';
const OUT = process.argv[3] || path.join(__dirname, 'shots', 'mobile-390-v2.png');
const VH = parseInt(process.argv[4] || '844', 10);   // 视口高，传大值可截全页
const PORT = 9223;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const udd = path.join(process.env.TEMP, 'edge-cdp-mobile');
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
  let id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const d = JSON.parse(ev.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  };
  const send = (method, params = {}) => new Promise(res => {
    const mid = ++id; pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });

  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: VH, deviceScaleFactor: 2, mobile: true,
  });
  await send('Page.enable');
  await send('Page.navigate', { url: URL_TO_OPEN });
  await sleep(2500);

  const metrics = await send('Runtime.evaluate', { expression: `JSON.stringify({
    innerWidth, innerHeight, dpr: devicePixelRatio,
    docClientWidth: document.documentElement.clientWidth,
    docScrollWidth: document.documentElement.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    wrap: (w => w && { w: w.offsetWidth, left: w.getBoundingClientRect().left, right: w.getBoundingClientRect().right })(document.querySelector('.wrap')),
    top: (t => t && { sw: t.scrollWidth, cw: t.clientWidth })(document.querySelector('.top')),
    heroMain: (h => h && { w: h.offsetWidth })(document.querySelector('.hero-main')),
    wide: [...document.querySelectorAll('*')].filter(e => e.getBoundingClientRect().right > innerWidth + 1)
      .slice(0, 8).map(e => e.tagName + '.' + (e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className) + ' r=' + Math.round(e.getBoundingClientRect().right)),
  })`, returnByValue: true });
  console.log(metrics.result.result.value);

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT, Buffer.from(shot.result.data, 'base64'));
  console.log('SHOT ' + OUT);
  ws.close();
  edge.kill();
}
main().catch(e => { console.error('ERR', e.message); process.exit(1); });
