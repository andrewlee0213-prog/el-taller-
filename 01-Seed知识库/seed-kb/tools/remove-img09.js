const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');
const files = [
  path.join(DIR, '04-AI Agent构建知识手册-便携版.template.html'),
  path.join(DIR, '05-AI Agent构建知识手册-完整版.template.html'),
];
for (const f of files) {
  let t = fs.readFileSync(f, 'utf8');
  const before = t.length;
  // 1. 删除 IMG09 的整个 figure 块
  const figRe = /<figure><img src="@@IMG09@@"[\s\S]*?<\/figure>\s*/;
  if (!figRe.test(t)) throw new Error('IMG09 figure not found in ' + path.basename(f));
  t = t.replace(figRe, '');
  // 2. 删除案例框里对下方图片的指引句（两种措辞兼容）
  t = t.replace(/下方为该项目[使反]*用的检索对象示例图。/, '');
  // 3. 图片计数 12 -> 11
  t = t.split('含原文案例插图 12 幅').join('含原文案例插图 11 幅');
  t = t.split('含原文插图 12 幅').join('含原文插图 11 幅');
  t = t.split('知识图 10 幅已按章节嵌入').join('知识图 9 幅已按章节嵌入');
  fs.writeFileSync(f, t, 'utf8');
  console.log(path.basename(f), ':', before, '->', t.length, 'chars');
}
// 4. 构建脚本的注入映射去掉 09
for (const s of ['build-html.js', 'build-desktop.js']) {
  const p = path.join(DIR, 'tools', s);
  let t = fs.readFileSync(p, 'utf8');
  t = t.replace("['00', '04', '05', '06', '07', '08', '09', '33', '38', '44', '53', '54']", "['00', '04', '05', '06', '07', '08', '33', '38', '44', '53', '54']");
  fs.writeFileSync(p, t, 'utf8');
  console.log(s, 'map updated');
}
console.log('OK');
