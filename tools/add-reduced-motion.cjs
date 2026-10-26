/* A1 codemod：给缺 prefers-reduced-motion 的 14 页补关停规则（对齐 index 现有范式）
   - 只关「无限循环的环境动画」（.g-blob 漂移 + 各页特例），不动 hover 过渡与一次性反馈（shake/kbflash）
   - 幂等：页面已含 prefers-reduced-motion 即跳过
   用法: node tools/add-reduced-motion.cjs          （跑前自动备份到 .backup-el-taller-uiux-a1/） */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const PAGES = [
  'workbench.html', 'kb.html', 'reader.html', 'video-scripts.html', 'about-site.html',
  'openclaw.html', 'kids-english.html', 'kindle-dashboard.html', 'poster-six.html',
  'login.html', 'posts/trace-as-state.html', 'posts/kb-engineering.html',
  'posts/poster-agent-spec.html', 'posts/poster-methodology.html',
];
/* 页内无限循环动画特例（index 之外的） */
const EXTRA = {
  'workbench.html': ['.rfbtn.spin svg'],
  'reader.html': ['.rfbtn.spin svg'],
  'login.html': ['.card .halo'],
};

const BK = path.join(ROOT, '.backup-el-taller-uiux-a1');
fs.mkdirSync(BK, { recursive: true });

let changed = 0, skipped = 0;
for (const f of PAGES) {
  const p = path.join(ROOT, f);
  let src = fs.readFileSync(p, 'utf8');
  if (src.includes('prefers-reduced-motion')) { skipped++; console.log('  跳过(已有) ' + f); continue; }
  const extras = EXTRA[f] || [];
  const sels = ['.g-blob', ...extras].join(',');
  const block = `
/* 动效无障碍：用户系统开启「减弱动态」时，关停环境漂移/循环动画（对齐 index 范式） */
@media (prefers-reduced-motion:reduce){
  html{scroll-behavior:auto}
  ${sels}{animation:none}
}
`;
  const idx = src.lastIndexOf('</style>');
  if (idx < 0) { console.log('  !! 无 </style>，跳过 ' + f); continue; }
  fs.copyFileSync(p, path.join(BK, f.replace(/\//g, '_')));
  src = src.slice(0, idx) + block + src.slice(idx);
  fs.writeFileSync(p, src);
  changed++; console.log('  ✓ ' + f + (extras.length ? '  特例: ' + extras.join(',') : ''));
}
console.log(`\n完成：${changed} 页补齐，${skipped} 页跳过；备份在 ${BK}`);
