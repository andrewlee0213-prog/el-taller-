#!/usr/bin/env node
/* 一次性改造脚本（2026-10-21 二轮）：「大漆流光」四主题全套 —— 一页参考图一套完整配色。
 *   bermellon 朱漆红 · Bermellón  ← 参考「朱漆朝霞」（朱漆暖红底 + 鎏金强调）
 *   castana   栗漆棕 · Castaña    ← 参考「栗漆秋叶」（栗漆深棕底 + 琥珀金强调 + 奶油光泽）
 *   jaspe     犀皮彩 · Jaspé      ← 参考「犀皮流霞」（琥珀底 + 紫/玫红三彩光斑——犀皮漆斑纹）
 *   perla     螺钿青 · Perla      ← 参考「黑漆嵌钿」（近黑漆底 + 螺钿青强调 + 螺钿粉彩）
 * 同时把全站默认主题从 naranja 改为 bermellon（打开即见大漆配色；原日落橙仍可点选）。
 * 本脚本替换上一轮注入的 laca/perla（laca 是朱漆+栗漆的混合，按站主「一页一色」要求拆开重做）。
 * 幂等：已含 data-theme="bermellon" 则跳过。用法：node tools/add-dacii-themes.cjs */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname + '/..';

const FILES = ['index.html', 'about-site.html', 'kindle-dashboard.html', 'poster-six.html',
  'video-scripts.html', 'kids-english.html', 'openclaw.html', 'reader.html', 'kb.html',
  'login.html', 'workbench.html', 'posts/kb-engineering.html', 'posts/poster-methodology.html',
  'posts/poster-agent-spec.html', 'posts/trace-as-state.html'];

/* 取值全部来自参考图 PIL 逐像素采样（背景/中心/色卡），按站点暗底可读性压深 */
const THEMES = {
  bermellon: {
    id: 'bermellon', dot: '#c05a46', title: '朱漆红 · Bermellón', aria: '朱漆红主题',
    v: {
      'g-accent': '#d9a44e', 'g-accent-soft': '#f3d9a8', 'g-accent-deep': '#9a6b22', 'g-accent-mid': '#c08a32', 'g-on-accent': '#2a1b05',
      'g-text': '#f8efe2', 'g-dim': 'rgba(248,239,226,.60)',
      'g-glass-hi': 'rgba(164,75,62,.36)', 'g-glass-lo': 'rgba(88,38,26,.34)',
      'g-card-hi': 'rgba(255,228,200,.13)', 'g-card-lo': 'rgba(242,203,164,.06)',
      'g-pillactive': 'rgba(54,20,12,.68)', 'g-tint': '#f5e2c8',
      'g-glow-a': 'rgba(217,164,78,.24)', 'g-glow-b': 'rgba(164,75,62,.30)', 'g-glow-c': 'rgba(60,30,20,.22)',
      'g-bg-1': '#4a2317', 'g-bg-2': '#33140c', 'g-bg-3': '#1d0906', 'g-bg-base': '#230d07',
      'g-blob1': 'rgba(217,164,78,.28)', 'g-blob2': 'rgba(164,69,51,.24)',
    },
  },
  castana: {
    id: 'castana', dot: '#c98a4b', title: '栗漆棕 · Castaña', aria: '栗漆棕主题',
    v: {
      'g-accent': '#c98a4b', 'g-accent-soft': '#ebd3ac', 'g-accent-deep': '#8f5e28', 'g-accent-mid': '#b0763a', 'g-on-accent': '#2a1b07',
      'g-text': '#f6efe4', 'g-dim': 'rgba(246,239,228,.58)',
      'g-glass-hi': 'rgba(122,88,60,.38)', 'g-glass-lo': 'rgba(66,44,26,.34)',
      'g-card-hi': 'rgba(244,226,196,.12)', 'g-card-lo': 'rgba(226,196,156,.06)',
      'g-pillactive': 'rgba(46,30,16,.68)', 'g-tint': '#f2e2c4',
      'g-glow-a': 'rgba(197,110,60,.22)', 'g-glow-b': 'rgba(122,82,50,.30)', 'g-glow-c': 'rgba(208,192,176,.08)',
      'g-bg-1': '#42301e', 'g-bg-2': '#2e1e10', 'g-bg-3': '#180f07', 'g-bg-base': '#1f130a',
      'g-blob1': 'rgba(197,140,76,.26)', 'g-blob2': 'rgba(122,82,50,.22)',
    },
  },
  jaspe: {
    id: 'jaspe', dot: '#b56580', title: '犀皮彩 · Jaspé', aria: '犀皮彩主题',
    v: {
      'g-accent': '#d9a45c', 'g-accent-soft': '#f2d8ae', 'g-accent-deep': '#96702c', 'g-accent-mid': '#c08e44', 'g-on-accent': '#2a1b06',
      'g-text': '#f8f0e2', 'g-dim': 'rgba(248,240,226,.60)',
      'g-glass-hi': 'rgba(150,96,60,.36)', 'g-glass-lo': 'rgba(84,48,36,.34)',
      'g-card-hi': 'rgba(255,232,204,.13)', 'g-card-lo': 'rgba(238,204,168,.06)',
      'g-pillactive': 'rgba(50,26,16,.68)', 'g-tint': '#f4e0be',
      /* 犀皮三彩：琥珀 + 紫 + 玫红（参考图主导色 #C08040/#705070/#B05050） */
      'g-glow-a': 'rgba(199,140,66,.24)', 'g-glow-b': 'rgba(112,80,112,.26)', 'g-glow-c': 'rgba(176,80,80,.20)',
      'g-bg-1': '#5c3a22', 'g-bg-2': '#3f2314', 'g-bg-3': '#22110a', 'g-bg-base': '#2a160c',
      'g-blob1': 'rgba(112,80,112,.26)', 'g-blob2': 'rgba(176,80,80,.22)',
    },
  },
  perla: {
    id: 'perla', dot: '#74c7b8', title: '螺钿青 · Perla', aria: '螺钿青主题',
    v: {
      'g-accent': '#74c7b8', 'g-accent-soft': '#c2eae2', 'g-accent-deep': '#2e7a6e', 'g-accent-mid': '#4aa393', 'g-on-accent': '#06231e',
      'g-text': '#edf4f0', 'g-dim': 'rgba(233,243,239,.60)',
      'g-glass-hi': 'rgba(92,140,132,.34)', 'g-glass-lo': 'rgba(34,60,56,.34)',
      'g-card-hi': 'rgba(220,245,238,.12)', 'g-card-lo': 'rgba(180,225,212,.05)',
      'g-pillactive': 'rgba(14,32,29,.68)', 'g-tint': '#dcf0ea',
      'g-glow-a': 'rgba(110,200,182,.20)', 'g-glow-b': 'rgba(30,90,80,.28)', 'g-glow-c': 'rgba(200,140,170,.12)',
      'g-bg-1': '#1c2a27', 'g-bg-2': '#12201c', 'g-bg-3': '#08110f', 'g-bg-base': '#0d1815',
      'g-blob1': 'rgba(110,200,182,.24)', 'g-blob2': 'rgba(220,150,180,.16)',
    },
  },
};

function buildBlock(t, tmplBody) {
  return tmplBody.split('\n').map(line => {
    const out = [];
    for (const part of line.split(';')) {
      const m = /^\s*--([\w-]+)\s*:\s*(.*?)\s*$/.exec(part);
      if (!m) continue;
      const val = t.v[m[1]] != null ? t.v[m[1]] : m[2];
      if (t.v[m[1]] == null) console.warn('  ⚠ 变量无映射沿用模板: --' + m[1]);
      out.push('--' + m[1] + ':' + val);
    }
    return out.length ? '  ' + out.join('; ') + ';' : '';
  }).filter(Boolean).join('\n');
}

for (const f of FILES) {
  const p = path.join(ROOT, f);
  let html = fs.readFileSync(p, 'utf8');
  if (html.includes('data-theme="bermellon"')) { console.log('跳过（已有 bermellon）: ' + f); continue; }

  /* 1) 摘除上一轮的 laca/perla 块与圆点 */
  html = html.replace(/html\[data-theme="laca"\]\{[^}]*\}\nhtml\[data-theme="perla"\]\{[^}]*\}\n/, '');
  html = html.replace(/ *<button class="tdot"[^\n]*data-theme-dot="(?:laca|perla)"[^\n]*>\s*<\/button>\n/g, '');

  /* 2) 以本页 crepusculo 块为模板注入四主题 */
  const start = html.indexOf('html[data-theme="crepusculo"]{');
  if (start < 0) { console.warn('✗ 未找到 crepusculo 块: ' + f); continue; }
  const end = html.indexOf('}', start);
  const tmplBody = html.slice(start + 'html[data-theme="crepusculo"]{'.length, end);
  const css = Object.values(THEMES).map(t => 'html[data-theme="' + t.id + '"]{\n' + buildBlock(t, tmplBody) + '\n}').join('\n') + '\n';
  html = html.slice(0, end + 1) + '\n' + css + html.slice(end + 1);

  /* 3) 四个圆点插在 crepusculo 圆点后 */
  const dotRe = /( *<button class="tdot"[^\n]*data-theme-dot="crepusculo"[^\n]*>\s*<\/button>\n)/;
  if (!dotRe.test(html)) { console.warn('✗ 未找到 crepusculo 圆点: ' + f); continue; }
  const dots = '$1' + Object.values(THEMES).map(t =>
    '        <button class="tdot" type="button" data-theme-dot="' + t.id + '" style="--dot:' + t.dot + '" title="' + t.title + '" aria-label="' + t.aria + '"></button>'
  ).join('\n') + '\n';
  html = html.replace(dotRe, dots);

  /* 4) 默认主题改为 bermellon：boot 脚本 + 切换器兜底 */
  html = html.replace(
    "localStorage.getItem('taller-theme');if(__t&&__t!=='naranja')",
    "localStorage.getItem('taller-theme')||'bermellon';if(__t!=='naranja')");
  html = html.replace(/(getItem\(['"]taller-theme['"]\)\s*\|\|\s*)['"]naranja['"]/g, "$1'bermellon'");

  fs.writeFileSync(p, html);
  console.log('✓ ' + f);
}
