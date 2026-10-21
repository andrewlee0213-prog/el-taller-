#!/usr/bin/env node
/* 一次性改造脚本（2026-10-21 三轮）：配色圆点折叠化 —— 主题圆点已到 10 个占满顶栏，
 * 平时折叠只露「当前主题」一颗 + ▾ 提示，鼠标悬浮 / 键盘聚焦时整排滑开。
 * 纯 CSS 追加（在 .tdot.on 规则后插入覆盖块），切换 JS 零改动；<680px 本就整组隐藏不受影响。
 * 幂等：已含折叠标记则跳过。用法：node tools/collapse-themedots.cjs */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname + '/..';

const FILES = ['index.html', 'about-site.html', 'kindle-dashboard.html', 'poster-six.html',
  'video-scripts.html', 'kids-english.html', 'openclaw.html', 'reader.html', 'kb.html',
  'login.html', 'workbench.html', 'posts/kb-engineering.html', 'posts/poster-methodology.html',
  'posts/poster-agent-spec.html', 'posts/trace-as-state.html'];

const CSS = `
/* ---- 配色折叠：平时只露当前色一颗 + ▾，悬浮/聚焦展开整排（间距由 gap 改为两侧 margin 以便收拢） ---- */
.themedots{gap:0}
.themedots .tdot{margin:0 3.5px;transition:width .28s,opacity .28s,margin .28s,transform .25s}
.themedots:has(.tdot.on) .tdot:not(.on){width:0;opacity:0;margin:0;pointer-events:none}
.themedots:hover .tdot,.themedots:focus-within .tdot{width:17px;opacity:1;margin:0 3.5px;pointer-events:auto}
.themedots::after{content:"▾";font-size:10px;line-height:1;color:var(--g-dim);margin-left:4px;transition:transform .28s;pointer-events:none}
.themedots:hover::after,.themedots:focus-within::after{transform:rotate(180deg)}
`;

for (const f of FILES) {
  const p = path.join(ROOT, f);
  let html = fs.readFileSync(p, 'utf8');
  if (html.includes('.themedots:has(.tdot.on)')) { console.log('跳过（已折叠化）: ' + f); continue; }
  const anchor = '.tdot.on{box-shadow:0 0 0 2px var(--g-bg-base)';
  const at = html.indexOf(anchor);
  if (at < 0) { console.warn('✗ 未找到锚点: ' + f); continue; }
  const lineEnd = html.indexOf('\n', at);
  html = html.slice(0, lineEnd + 1) + CSS + html.slice(lineEnd + 1);
  fs.writeFileSync(p, html);
  console.log('✓ ' + f);
}
