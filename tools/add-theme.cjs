#!/usr/bin/env node
/* 一次性改造脚本（2026-10-09）：全站主题系统 + 液态玻璃。
 * 用法：node tools/add-theme.cjs   （在 el-taller/ 目录下执行）
 * 幂等性：不保证重复执行安全，只在改造前跑一次。原始文件见 ../.backup-el-taller-20261009-theme/ */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname + '/..';
const FILES = {
  index: ['index.html'],
  detail: ['about-site.html','kindle-dashboard.html','poster-six.html','video-scripts.html',
           'kids-english.html','posts/kb-engineering.html','posts/poster-methodology.html','posts/poster-agent-spec.html'],
  kb: ['kb.html'],
  login: ['login.html'],
};

/* ---------- 通用片段 ---------- */
const HEAD_BOOT = `<script>try{var __t=localStorage.getItem('taller-theme');if(__t&&__t!=='naranja')document.documentElement.dataset.theme=__t}catch(_){}</script>`;

const ROOT_EXTRA = `  --g-accent-deep:#c96a12; --g-accent-mid:#d97c14; --g-on-accent:#2a1505; --g-tint:#ffecd8;
  --g-glow-a:rgba(255,150,45,.26); --g-glow-b:rgba(150,80,28,.30); --g-glow-c:rgba(120,60,140,.16);
  --g-bg-1:#4a290f; --g-bg-2:#331a0a; --g-bg-3:#1d0d05; --g-bg-base:#241006;`;

const THEME_CSS = `
/* ================= 主题系统：访客可选配色（圆点切换，localStorage 记忆） ================= */
html[data-theme="oceano"]{
  --g-accent:#4fb3ff; --g-accent-soft:#a9ddff; --g-accent-deep:#1f6fb2; --g-accent-mid:#2b8ad4; --g-on-accent:#052540;
  --g-text:#edf6ff; --g-dim:rgba(226,241,255,.60);
  --g-glass-hi:rgba(105,150,198,.36); --g-glass-lo:rgba(38,74,112,.32);
  --g-card-hi:rgba(212,237,255,.13); --g-card-lo:rgba(168,214,250,.06);
  --g-pillactive:rgba(12,36,58,.68); --g-tint:#d4edff;
  --g-glow-a:rgba(80,170,255,.24); --g-glow-b:rgba(28,88,148,.30); --g-glow-c:rgba(64,190,190,.14);
  --g-bg-1:#0d2f4e; --g-bg-2:#0a2136; --g-bg-3:#050f1c; --g-bg-base:#081826;
  --g-blob1:rgba(80,170,255,.30); --g-blob2:rgba(120,220,255,.18);
}
html[data-theme="bosque"]{
  --g-accent:#4ed08a; --g-accent-soft:#b6eeca; --g-accent-deep:#1e8a50; --g-accent-mid:#2aa765; --g-on-accent:#042614;
  --g-text:#eefff4; --g-dim:rgba(226,246,236,.60);
  --g-glass-hi:rgba(105,160,125,.36); --g-glass-lo:rgba(40,88,60,.32);
  --g-card-hi:rgba(214,245,226,.13); --g-card-lo:rgba(176,234,204,.06);
  --g-pillactive:rgba(14,42,27,.68); --g-tint:#d6f5e2;
  --g-glow-a:rgba(90,215,140,.20); --g-glow-b:rgba(26,105,60,.28); --g-glow-c:rgba(210,180,70,.10);
  --g-bg-1:#123524; --g-bg-2:#0d2418; --g-bg-3:#06120b; --g-bg-base:#081a10;
  --g-blob1:rgba(90,215,140,.26); --g-blob2:rgba(230,200,90,.14);
}
html[data-theme="crepusculo"]{
  --g-accent:#b18cff; --g-accent-soft:#ddc9ff; --g-accent-deep:#7a52d6; --g-accent-mid:#9268e8; --g-on-accent:#1a0e38;
  --g-text:#f5f1ff; --g-dim:rgba(238,232,255,.60);
  --g-glass-hi:rgba(150,125,195,.38); --g-glass-lo:rgba(72,52,115,.32);
  --g-card-hi:rgba(230,222,255,.13); --g-card-lo:rgba(205,185,250,.06);
  --g-pillactive:rgba(36,20,60,.68); --g-tint:#e6deff;
  --g-glow-a:rgba(170,120,255,.22); --g-glow-b:rgba(88,52,150,.30); --g-glow-c:rgba(220,90,170,.12);
  --g-bg-1:#2c1546; --g-bg-2:#1f0f33; --g-bg-3:#0e0619; --g-bg-base:#170a28;
  --g-blob1:rgba(170,120,255,.26); --g-blob2:rgba(255,120,200,.16);
}
body{transition:background-color .35s}

/* ---- 液态玻璃（Apple Liquid Glass 质感）：镜面高光 + 内缘光 + 高饱和折射 ---- */
.g-glass,.g-card,.enlace{position:relative}
.g-glass{background:linear-gradient(150deg,var(--g-glass-hi),var(--g-glass-lo));
  -webkit-backdrop-filter:blur(var(--g-blur)) saturate(1.8) brightness(1.05);
  backdrop-filter:blur(var(--g-blur)) saturate(1.8) brightness(1.05);
  border:1px solid color-mix(in srgb,var(--g-text) 20%,transparent);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.34),inset 0 -1px 0 rgba(0,0,0,.14),
    inset 0 18px 34px -26px rgba(255,255,255,.30),0 34px 90px rgba(0,0,0,.45)}
.g-card,.workcard,.notecard,.enlace{-webkit-backdrop-filter:blur(18px) saturate(1.7) brightness(1.04);
  backdrop-filter:blur(18px) saturate(1.7) brightness(1.04)}
.g-glass::before,.g-card::before,.workcard::before,.notecard::before,.enlace::before,.card::before{
  content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:radial-gradient(120% 62% at 16% 0%,rgba(255,255,255,.16),transparent 55%),
    linear-gradient(115deg,rgba(255,255,255,.08),transparent 30%,transparent 72%,rgba(255,255,255,.05));
  mix-blend-mode:screen}
.g-glass>*,.g-card>*,.workcard>*,.notecard>*,.enlace>*,.card>*{position:relative;z-index:1}

/* ---- 主题切换圆点 ---- */
.themedots{display:flex;align-items:center;gap:7px;padding:8px 12px;border-radius:999px;flex:none;
  background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14)}
.tdot{width:17px;height:17px;border-radius:50%;border:0;cursor:pointer;padding:0;
  background:radial-gradient(circle at 32% 28%,rgba(255,255,255,.8),var(--dot) 60%);
  box-shadow:0 2px 8px rgba(0,0,0,.35),inset 0 1px 1px rgba(255,255,255,.5);transition:.25s}
.tdot:hover{transform:scale(1.18)}
.tdot.on{box-shadow:0 0 0 2px var(--g-bg-base),0 0 0 3.5px var(--dot),0 2px 8px rgba(0,0,0,.35)}
@media (max-width:680px){ .themedots{display:none} }
`;

const DOTS = `<div class="themedots" role="group" aria-label="配色 · Tema">
        <button class="tdot" type="button" data-theme-dot="naranja" style="--dot:#ff9d2e" title="日落橙 · Naranja" aria-label="日落橙主题"></button>
        <button class="tdot" type="button" data-theme-dot="oceano" style="--dot:#4fb3ff" title="海洋蓝 · Océano" aria-label="海洋蓝主题"></button>
        <button class="tdot" type="button" data-theme-dot="bosque" style="--dot:#4ed08a" title="森林绿 · Bosque" aria-label="森林绿主题"></button>
        <button class="tdot" type="button" data-theme-dot="crepusculo" style="--dot:#b18cff" title="暮光紫 · Crepúsculo" aria-label="暮光紫主题"></button>
      </div>`;

const DOTS_LOGIN = `  <div class="themedots" role="group" aria-label="配色 · Tema" style="position:absolute;top:20px;right:22px;z-index:5">
    <button class="tdot" type="button" data-theme-dot="naranja" style="--dot:#ff9d2e" title="日落橙 · Naranja" aria-label="日落橙主题"></button>
    <button class="tdot" type="button" data-theme-dot="oceano" style="--dot:#4fb3ff" title="海洋蓝 · Océano" aria-label="海洋蓝主题"></button>
    <button class="tdot" type="button" data-theme-dot="bosque" style="--dot:#4ed08a" title="森林绿 · Bosque" aria-label="森林绿主题"></button>
    <button class="tdot" type="button" data-theme-dot="crepusculo" style="--dot:#b18cff" title="暮光紫 · Crepúsculo" aria-label="暮光紫主题"></button>
  </div>`;

const THEME_JS = `<script>
/* ================= 主题切换：访客可选配色，选择记忆在本机 ================= */
(function(){
  var dots = Array.prototype.slice.call(document.querySelectorAll('.tdot'));
  function apply(t){
    if (t === 'naranja') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    dots.forEach(function(d){ d.classList.toggle('on', d.dataset.themeDot === t); });
  }
  var cur = 'naranja';
  try { cur = localStorage.getItem('taller-theme') || 'naranja'; } catch(_){}
  apply(cur);
  dots.forEach(function(d){ d.addEventListener('click', function(){
    cur = d.dataset.themeDot;
    try { localStorage.setItem('taller-theme', cur); } catch(_){}
    apply(cur);
  }); });
})();
</script>
</body>`;

/* ---------- 工具 ---------- */
function pct(alpha){
  const p = Math.round(parseFloat(alpha) * 1000) / 10;
  return String(p);
}
/* 把 :root{...} 块挖出来，其余部分才做颜色替换（:root 里是主题定义本身，不能动） */
function splitRoot(css){
  const start = css.indexOf(':root{');
  if (start < 0) return { before: css, root: '', after: '' };
  let depth = 0, i = start;
  for (; i < css.length; i++){
    if (css[i] === '{') depth++;
    else if (css[i] === '}'){ depth--; if (depth === 0){ i++; break; } }
  }
  return { before: css.slice(0, start), root: css.slice(start, i), after: css.slice(i) };
}
function swapColors(css){
  const rgb = (r,g,b,varName) => new RegExp(`rgba\\(${r},${g},${b},(\\d*\\.?\\d+)\\)`,'g');
  const rules = [
    [rgb(255,157,46), (m, a) => `color-mix(in srgb,var(--g-accent) ${pct(a)}%,transparent)`],
    [rgb(255,217,163), (m, a) => `color-mix(in srgb,var(--g-accent-soft) ${pct(a)}%,transparent)`],
    [rgb(255,240,228), (m, a) => `color-mix(in srgb,var(--g-text) ${pct(a)}%,transparent)`],
    [rgb(255,244,232), (m, a) => `color-mix(in srgb,var(--g-text) ${pct(a)}%,transparent)`],
    [rgb(255,236,216), (m, a) => `color-mix(in srgb,var(--g-tint) ${pct(a)}%,transparent)`],
    [rgb(255,214,180), (m, a) => `color-mix(in srgb,var(--g-tint) ${pct(a)}%,transparent)`],
    [rgb(255,200,120), (m, a) => `color-mix(in srgb,var(--g-accent-soft) ${pct(a)}%,transparent)`],
    [rgb(255,170,70), (m, a) => `color-mix(in srgb,var(--g-accent) ${pct(a)}%,transparent)`],
    [rgb(255,150,45), (m, a) => `color-mix(in srgb,var(--g-accent) ${pct(a)}%,transparent)`],
  ];
  for (const [re, fn] of rules) css = css.replace(re, fn);
  return css;
}
function swapHex(css){
  const pairs = [
    ['background:#241006', 'background:var(--g-bg-base)'],
    ['#c96a12', 'var(--g-accent-deep)'],
    ['#d97c14', 'var(--g-accent-mid)'],
    ['#2a1505', 'var(--g-on-accent)'],
    ['#ff9d2e', 'var(--g-accent)'],
    ['#ffd9a3', 'var(--g-accent-soft)'],
    ['(140deg,#7a4514,#4a290f)', '(140deg,var(--g-bg-1),var(--g-bg-3))'],
    ['#3a2210', 'var(--g-bg-2)'],
    ['color:#ffe9cf', 'color:var(--g-accent-soft)'],
    ['#4a290f', 'var(--g-bg-1)'],
    ['#331a0a', 'var(--g-bg-2)'],
    ['#1d0d05', 'var(--g-bg-3)'],
  ];
  for (const [a, b] of pairs) css = css.split(a).join(b);
  return css;
}

/* ---------- 页面背景渐变 → 主题变量（三种版式） ---------- */
function replaceStageBg(css){
  const variants = [
    [/radial-gradient\(90% 70% at 72% 6%,rgba\(255,150,45,\.26\),transparent 60%\),\s*\n\s*radial-gradient\(60% 55% at 6% 88%,rgba\(150,80,28,\.30\),transparent 62%\),\s*\n\s*radial-gradient\(45% 40% at 92% 74%,rgba\(120,60,140,\.16\),transparent 65%\),\s*\n\s*linear-gradient\(155deg,#4a290f 0%,#331a0a 48%,#1d0d05 100%\)/,
     'radial-gradient(90% 70% at 72% 6%,var(--g-glow-a),transparent 60%),\n    radial-gradient(60% 55% at 6% 88%,var(--g-glow-b),transparent 62%),\n    radial-gradient(45% 40% at 92% 74%,var(--g-glow-c),transparent 65%),\n    linear-gradient(155deg,var(--g-bg-1) 0%,var(--g-bg-2) 48%,var(--g-bg-3) 100%)'],
    [/radial-gradient\(90% 70% at 72% 6%,rgba\(255,150,45,\.24\),transparent 60%\),\s*\n\s*radial-gradient\(60% 55% at 6% 90%,rgba\(150,80,28,\.30\),transparent 62%\),\s*\n\s*radial-gradient\(45% 40% at 92% 74%,rgba\(120,60,140,\.14\),transparent 65%\),\s*\n\s*linear-gradient\(155deg,#4a290f 0%,#331a0a 48%,#1d0d05 100%\)/,
     'radial-gradient(90% 70% at 72% 6%,var(--g-glow-a),transparent 60%),\n    radial-gradient(60% 55% at 6% 90%,var(--g-glow-b),transparent 62%),\n    radial-gradient(45% 40% at 92% 74%,var(--g-glow-c),transparent 65%),\n    linear-gradient(155deg,var(--g-bg-1) 0%,var(--g-bg-2) 48%,var(--g-bg-3) 100%)'],
    [/radial-gradient\(90% 70% at 70% 8%,rgba\(255,150,45,\.26\),transparent 60%\),\s*\n\s*radial-gradient\(60% 55% at 8% 90%,rgba\(150,80,28,\.30\),transparent 62%\),\s*\n\s*linear-gradient\(155deg,#4a290f 0%,#331a0a 48%,#1d0d05 100%\)/,
     'radial-gradient(90% 70% at 70% 8%,var(--g-glow-a),transparent 60%),\n    radial-gradient(60% 55% at 8% 90%,var(--g-glow-b),transparent 62%),\n    linear-gradient(155deg,var(--g-bg-1) 0%,var(--g-bg-2) 48%,var(--g-bg-3) 100%)'],
  ];
  let hit = false;
  for (const [re, to] of variants){
    if (re.test(css)){ css = css.replace(re, to); hit = true; break; }
  }
  return { css, hit };
}

/* ---------- 单文件处理 ---------- */
function process(file, mode){
  const p = path.join(ROOT, file);
  let html = fs.readFileSync(p, 'utf8');
  const log = [file];

  /* 1. head 防闪烁 bootstrap */
  if (!html.includes('taller-theme')){
    html = html.replace(/(<meta name="viewport"[^>]*>\n)/, `$1${HEAD_BOOT}\n`);
  }

  /* 2. :root 扩展主题变量 */
  const anchorRe = /^.*--g-radius:24px;.*$|^.*--g-blur:46px;.*$/m;
  const m = html.match(anchorRe);
  if (!m){ throw new Error('root anchor not found'); }
  let extra = ROOT_EXTRA;
  if (mode === 'index' || mode === 'login') extra += '\n  --g-blob1:rgba(255,150,45,.34); --g-blob2:rgba(180,140,255,.22);';
  if (mode === 'index') extra = extra.replace('rgba(255,150,45,.26)', 'rgba(255,150,45,.26)');
  html = html.replace(anchorRe, line => line + '\n' + extra);

  /* 3. CSS 尾部插入：主题块 + 液态玻璃 + 切换点样式 */
  html = html.replace('</style>', THEME_CSS + '</style>');

  /* 4. 颜色替换（:root 之外） */
  const parts = splitRoot(html);
  let body = parts.after;
  const bg = replaceStageBg(body);
  body = bg.css;
  log.push(bg.hit ? 'stagebg✓' : 'stagebg✗(no exact match)');
  body = swapColors(body);
  body = swapHex(body);
  if (mode === 'index'){
    body = body.split('--c:rgba(255,150,45,.34)').join('--c:var(--g-blob1)');
    body = body.split('--c:rgba(180,140,255,.22)').join('--c:var(--g-blob2)');
  }
  if (mode === 'login'){
    body = body.split('--c:rgba(255,150,45,.32)').join('--c:var(--g-blob1)');
    body = body.split('--c:rgba(180,140,255,.20)').join('--c:var(--g-blob2)');
  }
  html = parts.before + parts.root + body;

  /* 5. 切换点 markup */
  if (mode === 'index'){
    html = html.replace('      <button class="btn btn-ghost" id="loginBtn"', DOTS + '\n      <button class="btn btn-ghost" id="loginBtn"');
  } else if (mode === 'kb'){
    html = html.replace('      <label class="search">', DOTS + '\n      <label class="search">');
  } else if (mode === 'login'){
    html = html.replace('  <div class="noise"></div>', '  <div class="noise"></div>\n' + DOTS_LOGIN);
  } else {
    const re = /^(\s*)(<a class="btn-ghost[^"]*" href="(?:\.\.\/)?index\.html">← 回工坊<\/a>)/m;
    if (!re.test(html)) throw new Error('back anchor not found');
    html = html.replace(re, (mm, sp, anchor) => sp + DOTS + '\n' + sp + anchor);
  }

  /* 6. 主题切换 JS */
  html = html.replace('</body>', THEME_JS);

  fs.writeFileSync(p, html);
  console.log('OK', log.join(' | '));
}

let n = 0;
for (const [mode, files] of Object.entries(FILES)){
  for (const f of files){ process(f, mode); n++; }
}
console.log(`\n完成：${n} 个文件已改造。`);
