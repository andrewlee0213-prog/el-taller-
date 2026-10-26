/* A3 codemod：全站加「跳到正文」skip-link + 统一 :focus-visible 键盘焦点环
   - 14 页（login 无导航不加）；锚点=</header> 后第一个 section/div，有 id 复用，无 id 注入 id="main"
   - 焦点环用 --g-accent，十主题自适应；skiplink 只动 transform（合规红线）
   - 幂等：已含 class="skiplink" 即跳过
   用法: node tools/add-skiplink.cjs   （跑前备份到 .backup-el-taller-uiux-a3/） */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const PAGES = [
  'index.html', 'workbench.html', 'kb.html', 'reader.html', 'video-scripts.html',
  'about-site.html', 'openclaw.html', 'kids-english.html', 'kindle-dashboard.html',
  'poster-six.html', 'posts/trace-as-state.html', 'posts/kb-engineering.html',
  'posts/poster-agent-spec.html', 'posts/poster-methodology.html',
];

const CSS = `
/* 键盘可达：Tab 第一站「跳到正文」+ 统一键盘焦点环（十主题用 --g-accent 自适应） */
.skiplink{position:fixed;left:14px;top:14px;z-index:400;padding:9px 16px;border-radius:12px;
  background:var(--g-accent);color:var(--g-on-accent);font-weight:600;font-size:13.5px;text-decoration:none;
  transform:translateY(-160%);transition:transform .18s ease}
.skiplink:focus{transform:translateY(0)}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{
  outline:2px solid var(--g-accent);outline-offset:2px}
`;

const BK = path.join(ROOT, '.backup-el-taller-uiux-a3');
fs.mkdirSync(BK, { recursive: true });

let changed = 0, skipped = 0;
for (const f of PAGES) {
  const p = path.join(ROOT, f);
  let src = fs.readFileSync(p, 'utf8');
  if (src.includes('class="skiplink"')) { skipped++; console.log('  跳过(已有) ' + f); continue; }

  /* 1. 定位 </header> 后第一个 <section 或 <div 开标签 */
  const hdrEnd = src.indexOf('</header>');
  if (hdrEnd < 0) { console.log('  !! 无 </header>，跳过 ' + f); continue; }
  const after = src.slice(hdrEnd);
  const m = after.match(/<(section|div)(\s[^>]*)?>/);
  if (!m) { console.log('  !! header 后无 section/div，跳过 ' + f); continue; }
  const tagAbs = hdrEnd + m.index;
  let anchorId = 'main';
  let openTag = m[0];
  if (/\sid="[^"]+"/.test(openTag)) {
    anchorId = openTag.match(/\sid="([^"]+)"/)[1];
  } else {
    openTag = `<${m[1]} id="main"${m[2] || ''}>`;
  }
  src = src.slice(0, tagAbs) + openTag + src.slice(tagAbs + m[0].length);

  /* 2. body 后插 skip link */
  const bIdx = src.indexOf('<body>');
  if (bIdx < 0) { console.log('  !! 无 <body>，跳过 ' + f); continue; }
  const link = `<a class="skiplink" href="#${anchorId}">Saltar al contenido · 跳到正文</a>\n`;
  src = src.slice(0, bIdx + 6) + '\n' + link + src.slice(bIdx + 6);

  /* 3. </style> 前插 CSS */
  const sIdx = src.lastIndexOf('</style>');
  src = src.slice(0, sIdx) + CSS + src.slice(sIdx);

  fs.copyFileSync(p, path.join(BK, f.replace(/\//g, '_')));
  fs.writeFileSync(p, src);
  changed++; console.log(`  ✓ ${f}  锚点=#${anchorId}`);
}
console.log(`\n完成：${changed} 页，${skipped} 页跳过；备份在 ${BK}`);
