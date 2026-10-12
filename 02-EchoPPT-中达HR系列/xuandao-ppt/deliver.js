const fs = require('fs');
const src = 'C:/Users/XC/.zcode/workspace/default/xuandao-ppt/out/deck.pptx';
const dst = 'C:/Users/XC/Desktop/中达集团绩效型薪酬管理宣导_岗位指标分解篇.pptx';
fs.copyFileSync(src, dst);
const st = fs.statSync(dst);
console.log('delivered:', dst, st.size, 'bytes');
