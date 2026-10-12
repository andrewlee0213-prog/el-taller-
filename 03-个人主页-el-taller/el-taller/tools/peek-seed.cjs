/* 临时探查：03手册与02题库结构 */
const fs = require('fs');
const dir = 'C:/Users/XC/.zcode/workspace/default/seed-kb';
const find = kw => fs.readdirSync(dir).find(x => x.includes(kw));
const read = kw => fs.readFileSync(dir + '/' + find(kw), 'utf8');

const m = read('03-AI');
const lines = m.split('\n');
console.log('== 03手册 总行数', lines.length);
console.log('== 前60行 ==');
console.log(lines.slice(0, 60).join('\n'));
console.log('== 标题结构(前70条) ==');
lines.filter(l => /^#{1,4} /.test(l)).slice(0, 70).forEach(l => console.log(l));

const q = read('02-面');
const qlines = q.split('\n');
console.log('\n== 02题库 总行数', qlines.length);
console.log('== 前50行 ==');
console.log(qlines.slice(0, 50).join('\n'));
