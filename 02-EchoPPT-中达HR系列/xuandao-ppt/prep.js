const fs = require('fs');
const path = require('path');
const base = 'C:/Users/XC/.zcode/workspace/default/xuandao-ppt';
fs.rmSync(path.join(base, 'x'), { recursive: true, force: true });
fs.mkdirSync(path.join(base, 'x'), { recursive: true });
console.log('x/ ready');
