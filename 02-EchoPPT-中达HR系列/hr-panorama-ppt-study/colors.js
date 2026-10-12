const fs = require('fs');
for (let i = 1; i <= 11; i++) {
  const s = fs.readFileSync('x/ppt/slides/slide' + i + '.xml', 'utf8');
  const cnt = {};
  for (const m of s.matchAll(/srgbClr val="([0-9A-Fa-f]{6})"/g)) {
    const c = m[1].toUpperCase();
    cnt[c] = (cnt[c] || 0) + 1;
  }
  const sorted = Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([c, n]) => c + '(' + n + ')').join(' ');
  console.log('slide' + i + ': ' + sorted);
}
// slide4: fills of the shapes behind pillar headers (inside groups) - list all solidFill in doc order with nearby names
const s4 = fs.readFileSync('x/ppt/slides/slide4.xml', 'utf8');
const shapes = [...s4.matchAll(/<p:cNvPr id="\d+" name="([^"]*)"[\s\S]{0,80}?\/>[\s\S]*?<p:spPr>([\s\S]*?)<\/p:spPr>/g)];
console.log('\nslide4 named shapes with fills:');
for (const m of shapes) {
  const fill = m[2].match(/<a:solidFill>\s*<a:srgbClr val="([0-9A-Fa-f]{6})"/);
  const grad = m[2].includes('gradFill');
  if (fill || grad) console.log('  ' + m[1] + ' -> ' + (grad ? 'GRAD' : fill[1].toUpperCase()));
}
