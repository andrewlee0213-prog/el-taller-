#!/usr/bin/env node
// v2：在 v1（flex-wrap + flex:none + ≤1080 隐藏副标）基础上，让详情页头部突破
// 正文 860px 专栏：.top 加宽到 min(1240px,96vw) 并相对父容器居中（正文阅读宽度不变）。
// 头部五件套自然宽 951px > 860px，这正是「站名被导航胶囊盖住」的容器级根因。
// 幂等：已含 translateX(-50%) 标记的文件跳过。
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const FILES = ['about-site.html', 'kids-english.html', 'openclaw.html',
  'kindle-dashboard.html', 'poster-six.html', 'video-scripts.html',
  'posts/kb-engineering.html', 'posts/poster-methodology.html',
  'posts/poster-agent-spec.html', 'posts/trace-as-state.html'];
const MARK = 'transform:translateX(-50%)';
let changed = 0;
for (const f of FILES) {
  const p = path.join(ROOT, f);
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes(MARK)) { console.log('跳过(已修)', f); continue; }
  const m = s.match(/\.top\{[^}]*flex-wrap:wrap[^}]*\}/);
  if (!m) { console.log('!! 未找到 v1 补丁行', f); continue; }
  const line = m[0];
  const nw = line.replace(/\}$/, ';width:min(1240px,96vw);position:relative;left:50%;transform:translateX(-50%)}');
  s = s.replace(line, nw);
  fs.writeFileSync(p, s);
  console.log('已修', f);
  changed++;
}
console.log('完成', changed, '个文件');
