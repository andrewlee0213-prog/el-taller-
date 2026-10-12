const fs = require('fs');
const path = require('path');
const base = 'C:/Users/XC/.zcode/workspace/default/xuandao-ppt';
fs.mkdirSync(base, { recursive: true });
const dl = 'C:/Users/XC/Downloads';
const hit = fs.readdirSync(dl).find(f => f.endsWith('.pptx') && f.includes('中达') && f.includes('宣导'));
if (!hit) { console.error('SOURCE NOT FOUND'); process.exit(1); }
const src = path.join(dl, hit);
const dst = path.join(base, 'src.pptx');
fs.copyFileSync(src, dst);
console.log('copied:', hit, '->', dst, fs.statSync(dst).size, 'bytes');
