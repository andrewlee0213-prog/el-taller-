const fs = require('fs');
const path = require('path');
const DIR = __dirname;
const tpl = fs.readFileSync(path.join(DIR, '..', '05-AI Agent构建知识手册-完整版.template.html'), 'utf8');
const map = ['00', '04', '05', '06', '07', '08', '33', '38', '44', '53', '54'];
let out = tpl;
let totalImg = 0;
for (const n of map) {
  const f = path.join(DIR, 'imgs', `img_${n}.jpg`);
  const b = fs.readFileSync(f);
  const uri = 'data:image/jpeg;base64,' + b.toString('base64');
  const token = '@@IMG' + n + '@@';
  if (!out.includes(token)) throw new Error('token not found: ' + token);
  out = out.split(token).join(uri);
  totalImg += b.length;
}
if (/@@IMG\d+@@/.test(out)) throw new Error('unresolved tokens remain');
const dest = path.join(DIR, '..', '05-AI Agent构建知识手册-完整版.html');
fs.writeFileSync(dest, out, 'utf8');
console.log('written:', dest);
console.log('html size:', Math.round(out.length / 1024), 'KB; images total:', Math.round(totalImg / 1024), 'KB');
