/* C 批 v2：10 主题 × 5 代表页对比度体检——**像素采样法**
   背景=全页截图在元素矩形内的众数色（涵盖渐变玻璃/backdrop-filter/光斑的真实合成），
   前景=computed color（color-mix 的 alpha 先合成到采样背景再算对比度）。
   WCAG：正文 ≥4.5:1；大字(≥24px 或 ≥18.66px 粗体) ≥3:1
   用法: node tools/contrast-audit.cjs [报告路径]  （需 8891 在跑；默认 ../uiux-对比度报告.md 仓库外） */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const BASE = 'http://localhost:8891';
const PORT = 9226;
const USER = 'uiux-ca-tmp', PASS = 'uiux-ca-2026';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const THEMES = ['naranja', 'oceano', 'bosque', 'crepusculo', 'bermellon', 'castana', 'jaspe', 'perla', 'blanco', 'negro'];
const PAGES = [
  { f: 'index.html', wait: 2600 },
  { f: 'kb.html#b=agent-handbook&c=0', wait: 3600 },   // 深链直进书内，TOC/正文才渲染
  { f: 'workbench.html', wait: 3600 },
  { f: 'login.html', wait: 2400 },
  { f: 'posts/kb-engineering.html', wait: 2600 },
];
const PROBES = {
  'index.html': [
    { sel: '.g-pill a b', k: '导航主字' }, { sel: '.g-pill a small', k: '导航副标' },
    { sel: '.hero-main h1', k: '大标题(大字)' }, { sel: '.hero-main .intro', k: 'Hero正文' },
    { sel: '.cap-card b', k: '能力卡标题' }, { sel: '.cap-card p', k: '能力卡正文' },
    { sel: '.notecard h3', k: '日志卡标题' }, { sel: '.footer .motto', k: '页脚motto' },
  ],
  'kb.html#b=agent-handbook&c=0': [
    { sel: '.toc button', k: '目录章节钮' }, { sel: '.article .body h2, .article .body h3', k: '章标题(大字)' },
    { sel: '.article .body p', k: '阅读正文' }, { sel: 'input[type=text], .search input', k: '搜索框', pseudo: '::placeholder' },
  ],
  'workbench.html': [
    { sel: '.chead b', k: '卡片标题' }, { sel: '.chead .upd', k: '更新时间(次要)' },
    { sel: '.cbody', k: '卡片正文' }, { sel: '.section-head h2', k: '区块标题(大字)' },
  ],
  'login.html': [
    { sel: '.card h1', k: '大标题(大字)' }, { sel: '.field label', k: '表单标签' },
    { sel: '.field input', k: '输入框占位', pseudo: '::placeholder' }, { sel: '.card .sub, .card p', k: '说明文字' },
  ],
  'posts/kb-engineering.html': [
    { sel: '.article h2', k: '章标题(大字)' }, { sel: '.article p', k: '长文正文' },
    { sel: '.article blockquote p', k: '引用块' }, { sel: '.ahead .meta', k: '日期行(次要)' },
  ],
};
const EDGE = [process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
].filter(Boolean).find(p => fs.existsSync(p));

const srgb = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const contrast = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

(async () => {
  const db = new DatabaseSync(path.join(__dirname, '..', 'data', 'users.db'));
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT OR REPLACE INTO users(username,pwhash,salt,role,must_change) VALUES(?,?,?,?,0)')
    .run(USER, crypto.scryptSync(PASS, salt, 64).toString('hex'), salt, 'admin');
  let edge;
  const rows = [];
  try {
    const lr = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: USER, password: PASS }) });
    const [cn, cv] = (lr.headers.get('set-cookie') || '').split(';')[0].split('=');
    const udd = path.join(require('os').tmpdir(), 'edge-cdp-ca');
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
    const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result.value;
    await send('Page.enable');
    await send('Network.enable');
    await send('Network.setCookie', { name: cn, value: cv, url: BASE });
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

    /* 页内工具：颜色解析（含 color(srgb)）+ 截图采样（众数背景） */
    const COLLECT = `(probes) => {
      const _cv = document.createElement('canvas').getContext('2d');
      const toRGBA = str => {
        if (!str || str === 'none' || str === 'transparent') return null;
        let m = str.match(/color\\(srgb ([\\d.]+) ([\\d.]+) ([\\d.]+)(?:\\s*\\/\\s*([\\d.%]+))?\\)/);
        if (m) { const a = m[4] === undefined ? 1 : (m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]);
          return [Math.round(+m[1] * 255), Math.round(+m[2] * 255), Math.round(+m[3] * 255), a]; }
        _cv.fillStyle = '#000'; _cv.fillStyle = str; const v = _cv.fillStyle;
        if (typeof v === 'string' && v.startsWith('color(')) return null;
        if (typeof v === 'string' && v[0] === '#')
          return [parseInt(v.slice(1, 3), 16), parseInt(v.slice(3, 5), 16), parseInt(v.slice(5, 7), 16), 1];
        m = (v || '').match(/rgba?\\(([\\d.]+),\\s*([\\d.]+),\\s*([\\d.]+)(?:,\\s*([\\d.]+))?\\)/);
        return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null;
      };
      const out = [];
      for (const p of probes) {
        const el = document.querySelector(p.sel);
        if (!el) { out.push({ k: p.k, note: '未找到' }); continue; }
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) { out.push({ k: p.k, note: '不可见(w' + Math.round(r.width) + '×h' + Math.round(r.height) + ')' }); continue; }
        const cs = getComputedStyle(el, p.pseudo || null);
        const fg = toRGBA(cs.color);
        if (!fg) { out.push({ k: p.k, note: '前景无法解析:' + cs.color }); continue; }
        out.push({ k: p.k,
          x: Math.round(r.x + scrollX), y: Math.round(r.y + scrollY),
          w: Math.round(r.width), h: Math.round(r.height),
          fg: fg.join(','), raw: cs.color, attr: document.documentElement.dataset.theme || '(root)',
          fs: parseFloat(cs.fontSize), fw: parseInt(cs.fontWeight) });
      }
      return out;
    }`;
    const SAMPLE = `(dataUrl, boxes) => new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        const ctx = cv.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const res = boxes.map(b => {
          const x0 = Math.max(0, b.x), y0 = Math.max(0, b.y);
          const x1 = Math.min(img.width, b.x + b.w), y1 = Math.min(img.height, b.y + b.h);
          if (x1 - x0 < 2 || y1 - y0 < 2) return { k: b.k, note: '矩形出画面' };
          /* 众数色：量化 4bit/通道，取最大桶的均值 —— 抗细笔画文字 */
          const buckets = new Map();
          const step = Math.max(1, Math.floor((x1 - x0) / 60));
          const stepY = Math.max(1, Math.floor((y1 - y0) / 20));
          for (let y = y0; y < y1; y += stepY) for (let x = x0; x < x1; x += step) {
            const d = ctx.getImageData(x, y, 1, 1).data;
            const key = (d[0] >> 4) + ',' + (d[1] >> 4) + ',' + (d[2] >> 4);
            const bk = buckets.get(key) || [0, 0, 0, 0];
            bk[0]++; bk[1] += d[0]; bk[2] += d[1]; bk[3] += d[2];
            buckets.set(key, bk);
          }
          let best = null, bn = 0;
          for (const [, v] of buckets) if (v[0] > bn) { bn = v[0]; best = v; }
          return { k: b.k, bg: [Math.round(best[1] / bn), Math.round(best[2] / bn), Math.round(best[3] / bn)] };
        });
        resolve(res);
      };
      img.onerror = () => resolve(boxes.map(b => ({ k: b.k, note: '截图载入失败' })));
      img.src = dataUrl;
    })`;

    for (const page of PAGES) {
      await send('Page.navigate', { url: BASE + '/' + page.f });
      await sleep(page.wait);
      await ev(`localStorage.setItem('taller-theme','naranja')`);  // 压制自动夜间主题
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });  // 冻结光斑：可复现
      /* 真实 900 视口逐探针滚动采样：整页高视口会拉伸 body 渐变、beyondViewport 会重排——都失真 */
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      await sleep(300);
      for (const theme of THEMES) {
        await ev(`document.documentElement.setAttribute('data-theme','${theme}')`);
        await sleep(500);  // 等颜色/背景过渡(.25s/.35s)完成，防止量到插值中间色
        const probes = PROBES[page.f].map(p => ({ sel: p.sel, k: p.k, pseudo: p.pseudo }));
        const info = await ev(`(${COLLECT})(${JSON.stringify(probes)})`);
        for (const d of info) {
          if (!d.fg) { rows.push({ page: page.f.split('#')[0], theme, k: d.k, ratio: null, note: d.note }); continue; }
          /* 滚到元素居中 → 视口截图 → 矩形众数采样 */
          await ev(`(() => { const el = document.querySelector(${JSON.stringify(PROBES[page.f].find(p => p.k === d.k).sel)}); if (el) el.scrollIntoView({ block: 'center' }); })()`);
          await sleep(120);
          const rect = await ev(`(() => { const el = document.querySelector(${JSON.stringify(PROBES[page.f].find(p => p.k === d.k).sel)}); const r = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }); })()`);
          const rc = JSON.parse(rect);
          if (rc.y < 0 || rc.y + rc.h > 900 || rc.w < 4) { rows.push({ page: page.f.split('#')[0], theme, k: d.k, ratio: null, note: '滚动后仍不可见' }); continue; }
          const shot = await send('Page.captureScreenshot', { format: 'png' });
          const bg = (await ev(`(${SAMPLE})(${JSON.stringify('data:image/png;base64,' + shot.result.data)}, ${JSON.stringify([{ k: d.k, x: rc.x, y: rc.y, w: rc.w, h: rc.h }])})`))[0];
          if (!bg || !bg.bg) { rows.push({ page: page.f.split('#')[0], theme, k: d.k, ratio: null, note: (bg && bg.note) || '采样失败' }); continue; }
          const fgv = d.fg.split(',').map(Number);
          let eff = fgv.slice(0, 3);
          if (fgv[3] < 1) eff = [0, 1, 2].map(i => Math.round(fgv[i] * fgv[3] + bg.bg[i] * (1 - fgv[3])));
          const large = d.fs >= 24 || (d.fs >= 18.66 && d.fw >= 700);
          const need = large ? 3 : 4.5;
          const r = contrast(eff, bg.bg);
          rows.push({ page: page.f.split('#')[0], theme, k: d.k, ratio: Math.round(r * 100) / 100, need, fail: r < need,
            fg: eff.join(','), bg: bg.bg.join(','), fs: d.fs, note: d.raw + ' @' + d.attr });
        }
      }
      console.log('  ✓ ' + page.f.split('#')[0]);
    }
    ws.close(); edge.kill();
  } finally {
    db.prepare('DELETE FROM users WHERE username=?').run(USER);
    db.close();
  }

  /* 报告 */
  const fails = rows.filter(r => r.fail);
  const misses = rows.filter(r => r.ratio === null);
  const out = process.argv[2] || path.join(__dirname, '..', '..', 'uiux-对比度报告.md');
  let md = `# El Taller 10 主题对比度体检（${new Date().toISOString().slice(0, 16).replace('T', ' ')}）\n\n`;
  md += `- 采样：${PAGES.length} 页 × ${THEMES.length} 主题，前景=computed color（alpha 先合成），背景=**全页截图在元素矩形内的众数色**（涵盖渐变玻璃/backdrop-filter/光斑的真实渲染合成）\n`;
  md += `- 阈值：正文 ≥4.5:1；大字(≥24px 或 ≥18.66px 粗体) ≥3:1（WCAG AA / Skill Common Rules）\n\n`;
  md += `## 不达标 ${fails.length} 条\n\n| 页面 | 主题 | 元素 | 实测 | 需 | 前景 | 背景 |\n|---|---|---|---|---|---|---|\n`;
  for (const f of fails) md += `| ${f.page} | ${f.theme} | ${f.k} | **${f.ratio}** | ${f.need} | rgb(${f.fg}) | rgb(${f.bg}) | ${f.note || ''} |\n`;
  if (misses.length) {
    md += `\n## 未测得 ${misses.length} 条\n`;
    const seen = new Set();
    for (const m of misses) { const key = m.page + m.k; if (!seen.has(key)) { seen.add(key); md += `- ${m.page} ${m.k}：${m.note}（各主题同）\n`; } }
  }
  md += `\n## 按主题最差值\n\n| 主题 | 最差元素 | 最差实测 | 需 |\n|---|---|---|---|\n`;
  for (const t of THEMES) {
    const tr = rows.filter(r => r.theme === t && r.ratio !== null).sort((a, b) => a.ratio - b.ratio);
    if (tr.length) md += `| ${t} | ${tr[0].page}·${tr[0].k} | ${tr[0].ratio} | ${tr[0].need} |\n`;
  }
  fs.writeFileSync(out, md);
  console.log(`\n采样 ${rows.length} 条；不达标 ${fails.length}；未测得 ${misses.length}`);
  console.log('报告 → ' + out);
  const byTheme = {};
  for (const f of fails) byTheme[f.theme] = (byTheme[f.theme] || 0) + 1;
  console.log('不达标分布:', JSON.stringify(byTheme));
})().catch(e => { console.error(e); process.exit(1); });
