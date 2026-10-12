const fs = require('fs');
const path = require('path');
const X = 'C:/Users/XC/.zcode/workspace/default/xuandao-ppt/x';
function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    const st = fs.statSync(fp);
    if (st.isDirectory()) { walk(fp); continue; }
    if (!/\.(xml|rels)$/.test(f)) continue;
    const s = fs.readFileSync(fp, 'utf8');
    if (s.includes('张辛辛') || s.includes('0353')) {
      const i = Math.max(s.indexOf('张辛辛'), s.indexOf('0353'));
      console.log(fp.replace(X, ''), '->', JSON.stringify(s.slice(Math.max(0, i - 300), i + 120)));
    }
  }
}
walk(X);
console.log('scan done');
