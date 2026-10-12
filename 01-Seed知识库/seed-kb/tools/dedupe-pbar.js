const fs = require('fs');
const path = require('path');
const KB = path.join(__dirname, '..');
const FILES = [
  path.join(KB, '05-AI Agent构建知识手册-完整版.template.html'),
  path.join(KB, '05.1-AI Agent构建知识手册-白话版.html'),
];
// ANIM_JS 注入块自带的一对 DOM 元素（紧跟 <script> 前）与 body 后那对重复，删掉脚本块前这份
const dup = /<div id="pbar"><\/div>\n<canvas id="ambient"><\/canvas>\n<script>/g;
for (const f of FILES) {
  let t = fs.readFileSync(f, 'utf8');
  const before = (t.match(/id="pbar"/g) || []).length;
  t = t.replace(dup, '<script>');
  const after = (t.match(/id="pbar"/g) || []).length;
  fs.writeFileSync(f, t, 'utf8');
  console.log(path.basename(f), 'pbar refs:', before, '->', after);
}
console.log('cleanup done');
