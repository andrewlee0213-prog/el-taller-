const fs = require('fs');
const base = 'C:/Users/XC/.zcode/workspace/default/';
console.log('=== 独立知识库 gbt48000-kb/ ===');
for (const f of fs.readdirSync(base + 'gbt48000-kb')) {
  const s = fs.statSync(base + 'gbt48000-kb/' + f);
  console.log('  ' + f + ' | ' + Math.round(s.size / 1024) + ' KB');
}
console.log('=== 原始逐字稿 gbt48000/ ===');
for (const f of fs.readdirSync(base + 'gbt48000')) {
  const s = fs.statSync(base + 'gbt48000/' + f);
  console.log('  ' + f + ' | ' + (s.isDirectory() ? '<目录>' : Math.round(s.size / 1024) + ' KB'));
}
console.log('=== 融入 seed-kb 手册的检查 ===');
const files = [
  'seed-kb/03-AI Agent构建知识手册.md',
  'seed-kb/04-AI Agent构建知识手册-便携版.html',
  'seed-kb/05-AI Agent构建知识手册-完整版.html',
  'seed-kb/05.1-AI Agent构建知识手册-白话版.html',
  'seed-kb/02-面试题库-见习AI应用工程师-含三档评分.md',
];
for (const f of files) {
  const t = fs.readFileSync(base + f, 'utf8');
  console.log('  ' + f.slice(8, 32) + ' | 4.4知识形态第三阶: ' + t.includes('知识形态的第三阶') + ' | GB/T 48000 提及: ' + (t.split('GB/T 48000').length - 1) + ' | gbt48000-kb 引用: ' + t.includes('gbt48000-kb'));
}
