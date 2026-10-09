/* 把 tools/avatar-216.b64.txt 注入 index.html 的 __AVATAR_B64__ 占位符（一次性） */
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'index.html');
const b64 = fs.readFileSync(path.join(__dirname, 'avatar-216.b64.txt'), 'utf8').trim();
let html = fs.readFileSync(htmlPath, 'utf8');
if (!html.includes('__AVATAR_B64__')) {
  console.log(html.includes('data:image/jpeg;base64,') ? 'ALREADY-INJECTED' : 'PLACEHOLDER-NOT-FOUND');
  process.exit(html.includes('data:image/jpeg;base64,') ? 0 : 1);
}
html = html.replace('__AVATAR_B64__', b64);
fs.writeFileSync(htmlPath, html);
console.log('INJECTED bytes=' + b64.length);
