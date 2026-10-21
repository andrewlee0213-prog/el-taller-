#!/usr/bin/env node
/* 一次性改造脚本（2026-10-21）：全站新增两个「大漆流光」主题 ——
 *   laca  朱漆鎏金（参考「朱漆朝霞/栗漆秋叶」：朱漆暖底 + 鎏金强调 + 米白文字）
 *   perla 螺钿青黑（参考「黑漆嵌钿」：近黑漆底 + 螺钿青强调 + 螺钿粉彩点缀）
 * 配色取样自站主提供的东方漆色研究参考图（PIL 逐像素采样）。
 * 做法：以每页自己的 crepusculo 主题块为模板（变量集合逐页可能不同，如 workbench 无 blob），
 *       按变量名映射替换取值；CSS 块插在 crepusculo 块后，圆点插在 crepusculo 圆点后。
 * 幂等：文件已含 data-theme="laca" 则跳过。用法：node tools/add-lacquer-themes.cjs */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname + '/..';

const FILES = ['index.html', 'about-site.html', 'kindle-dashboard.html', 'poster-six.html',
  'video-scripts.html', 'kids-english.html', 'openclaw.html', 'reader.html', 'kb.html',
  'login.html', 'workbench.html', 'posts/kb-engineering.html', 'posts/poster-methodology.html',
  'posts/poster-agent-spec.html', 'posts/trace-as-state.html'];

const LACA = {
  'g-accent': '#d9a44e', 'g-accent-soft': '#f3d9a8', 'g-accent-deep': '#9a6b22', 'g-accent-mid': '#c08a32', 'g-on-accent': '#2a1b05',
  'g-text': '#f7efe3', 'g-dim': 'rgba(247,239,227,.60)',
  'g-glass-hi': 'rgba(166,92,62,.38)', 'g-glass-lo': 'rgba(88,44,29,.34)',
  'g-card-hi': 'rgba(255,232,200,.13)', 'g-card-lo': 'rgba(240,205,160,.06)',
  'g-pillactive': 'rgba(52,24,12,.68)', 'g-tint': '#f5e3c6',
  'g-glow-a': 'rgba(217,164,78,.24)', 'g-glow-b': 'rgba(150,55,35,.30)', 'g-glow-c': 'rgba(112,80,144,.10)',
  'g-bg-1': '#4a2417', 'g-bg-2': '#33150c', 'g-bg-3': '#1b0b05', 'g-bg-base': '#220e07',
  'g-blob1': 'rgba(217,140,60,.30)', 'g-blob2': 'rgba(164,69,51,.22)',
};
const PERLA = {
  'g-accent': '#74c7b8', 'g-accent-soft': '#c2eae2', 'g-accent-deep': '#2e7a6e', 'g-accent-mid': '#4aa393', 'g-on-accent': '#06231e',
  'g-text': '#edf4f0', 'g-dim': 'rgba(233,243,239,.60)',
  'g-glass-hi': 'rgba(92,140,132,.34)', 'g-glass-lo': 'rgba(34,60,56,.34)',
  'g-card-hi': 'rgba(220,245,238,.12)', 'g-card-lo': 'rgba(180,225,212,.05)',
  'g-pillactive': 'rgba(14,32,29,.68)', 'g-tint': '#dcf0ea',
  'g-glow-a': 'rgba(110,200,182,.20)', 'g-glow-b': 'rgba(30,90,80,.28)', 'g-glow-c': 'rgba(200,140,170,.12)',
  'g-bg-1': '#1c2a27', 'g-bg-2': '#12201c', 'g-bg-3': '#08110f', 'g-bg-base': '#0d1815',
  'g-blob1': 'rgba(110,200,182,.24)', 'g-blob2': 'rgba(220,150,180,.16)',
};

/* 按模板块行结构生成新主题块：保留模板的分组换行，只换值 */
function buildBlock(name, values, tmplBody) {
  return tmplBody.split('\n').map(line => {
    const out = [];
    for (const part of line.split(';')) {
      const m = /^\s*--([\w-]+)\s*:\s*(.*?)\s*$/.exec(part);
      if (!m) continue;
      const v = m[1];
      out.push('--' + v + ':' + (values[v] != null ? values[v] : m[2]));
      if (values[v] == null) console.warn('  ⚠ 模板变量无映射，沿用 crepusculo 值: --' + v);
    }
    if (!out.length) return '';
    return '  ' + out.join('; ') + ';';
  }).filter(Boolean).join('\n');
}

for (const f of FILES) {
  const p = path.join(ROOT, f);
  let html = fs.readFileSync(p, 'utf8');
  if (html.includes('data-theme="laca"')) { console.log('跳过（已有 laca）: ' + f); continue; }
  const start = html.indexOf('html[data-theme="crepusculo"]{');
  if (start < 0) { console.warn('✗ 未找到 crepusculo 块: ' + f); continue; }
  const end = html.indexOf('}', start);
  const tmplBody = html.slice(start + 'html[data-theme="crepusculo"]{'.length, end);

  const css = 'html[data-theme="laca"]{\n' + buildBlock('laca', LACA, tmplBody) + '\n}\n' +
    'html[data-theme="perla"]{\n' + buildBlock('perla', PERLA, tmplBody) + '\n}\n';
  html = html.slice(0, end + 1) + '\n' + css + html.slice(end + 1);

  const dotRe = /( *<button class="tdot"[^\n]*data-theme-dot="crepusculo"[^\n]*>\s*<\/button>\n)/;
  if (!dotRe.test(html)) { console.warn('✗ 未找到 crepusculo 圆点: ' + f); continue; }
  const dots = '$1' +
    '        <button class="tdot" type="button" data-theme-dot="laca" style="--dot:#d9a44e" title="朱漆金 · Laca" aria-label="朱漆金主题"></button>\n' +
    '        <button class="tdot" type="button" data-theme-dot="perla" style="--dot:#74c7b8" title="螺钿青 · Perla" aria-label="螺钿青主题"></button>\n';
  html = html.replace(dotRe, dots);

  fs.writeFileSync(p, html);
  console.log('✓ ' + f);
}
