/* 检查 index.html 重复 id */
const path = require('path');
const t = require('fs').readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const ids = [...t.matchAll(/id="([^"]+)"/g)].map(m => m[1]);
const dup = ids.filter((v, i) => ids.indexOf(v) !== i);
console.log('id 总数:', ids.length, '| 重复:', dup.length ? dup.join(',') : '无');
