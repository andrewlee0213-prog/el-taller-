const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, '..', '05.1-AI Agent构建知识手册-白话版.html');
let t = fs.readFileSync(f, 'utf8');
for (const n of ['44', '54', '38']) {
  const token = '__IMG' + n + '__';
  if (!t.includes(token)) throw new Error('missing token ' + token);
  const b = fs.readFileSync(path.join(__dirname, 'imgs', 'img_' + n + '.jpg'));
  t = t.split(token).join('data:image/jpeg;base64,' + b.toString('base64'));
}
fs.writeFileSync(f, t, 'utf8');
console.log('written:', f, '| size:', Math.round(t.length / 1024), 'KB');
