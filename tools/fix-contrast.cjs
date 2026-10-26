/* C 批 codemod：对比度修复——只调 alpha 不动色相（站主批准的修法边界）
   ① --g-dim 暗主题 9 变体 .58/.60 → .82；blanco rgba(74,56,32,.66) → .88
      （导航副标/引用块/说明文字/时间戳/motto/搜索占位全部受益）
   ② 正文色 --g-text 78%/80%/82% → 90%（.intro/.article p/能力卡正文等）
   ③ 20%/40% 装饰用法与 88%/92% 不动
   幂等：无匹配即跳过；跑前备份到 ../.backup-el-taller-uiux-c/
   用法: node tools/fix-contrast.cjs */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const PAGES = ['index.html', 'workbench.html', 'kb.html', 'reader.html', 'video-scripts.html',
  'about-site.html', 'openclaw.html', 'kids-english.html', 'kindle-dashboard.html',
  'poster-six.html', 'login.html', 'posts/trace-as-state.html', 'posts/kb-engineering.html',
  'posts/poster-agent-spec.html', 'posts/poster-methodology.html'];

const BK = path.join(ROOT, '..', '.backup-el-taller-uiux-c');
fs.mkdirSync(BK, { recursive: true });

let totalDim = 0, totalText = 0;
for (const f of PAGES) {
  const p = path.join(ROOT, f);
  let s = fs.readFileSync(p, 'utf8');
  const before = s;
  /* ① dim：亮色系（暗主题用）r,g,b ≥ 220 → alpha .82 */
  s = s.replace(/--g-dim:rgba\((\d{2,3}),(\d{2,3}),(\d{2,3}),\.(\d)\d?\)/g, (m, r, g, b) => {
    if (+r >= 220 && +g >= 220 && +b >= 210) return `--g-dim:rgba(${r},${g},${b},.87)`;
    return m;
  });
  /* ① dim：blanco 深棕 → .88 */
  s = s.replace(/--g-dim:rgba\(74,56,32,\.66\)/g, '--g-dim:rgba(74,56,32,.88)');
  /* ② 正文 78/80/82 → 90 */
  s = s.replace(/color-mix\(in srgb,var\(--g-text\) 7[88]%,transparent\)/g, 'color-mix(in srgb,var(--g-text) 90%,transparent)');
  s = s.replace(/color-mix\(in srgb,var\(--g-text\) 82%,transparent\)/g, 'color-mix(in srgb,var(--g-text) 90%,transparent)');
  if (s !== before) {
    fs.copyFileSync(p, path.join(BK, f.replace(/\//g, '_')));
    fs.writeFileSync(p, s);
    const dims = (before.match(/--g-dim:rgba/g) || []).length;
    const bumped = (s.match(/--g-dim:rgba\(\d+,\d+,\d+,\.(82|88)\)/g) || []).length;
    console.log(`  ✓ ${f}  dim 变体 ${dims} 个(已调 ${bumped})`);
    totalDim += bumped; totalText++;
  } else {
    console.log('  跳过(无匹配) ' + f);
  }
}
console.log(`\n完成：${totalText} 页调整；备份 ${BK}`);
