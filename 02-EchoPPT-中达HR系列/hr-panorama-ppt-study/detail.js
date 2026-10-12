const fs = require('fs');
for (const f of ['slide5.xml', 'slide9.xml']) {
  const s = fs.readFileSync('x/ppt/slides/' + f, 'utf8');
  const gs = [...s.matchAll(/<a:gradFill[\s\S]*?<\/a:gradFill>/g)];
  console.log('---', f, 'gradients:', gs.length);
  gs.slice(0, 4).forEach(g => {
    const cols = [...g[0].matchAll(/srgbClr val="([0-9A-F]{6})"(?:\/?><?a?:?a?l?p?h?a?[^>]*val="(\d+)")?/g)].map(m => m[1] + (m[2] ? '@' + Math.round(m[2] / 1000) + '%' : ''));
    const ang = (g[0].match(/ang="(\d+)"/) || [])[1];
    console.log('  colors:', cols.join(' | '), 'ang:', ang);
  });
}
const s7 = fs.readFileSync('x/ppt/slides/slide7.xml', 'utf8');
const m = s7.match(/name="\u00ef[\s\S]{0,600}?prst="(\w+)"/);
console.log('--- slide7 odd shape prst:', m ? m[1] : 'not found');
const pic = s7.match(/<p:pic>[\s\S]*?<\/p:pic>/);
console.log('--- slide7 has pic?', !!pic);
// check slide9 image usage and slide10/11 logo pics
for (const f of ['slide9.xml', 'slide11.xml']) {
  const s = fs.readFileSync('x/ppt/slides/' + f, 'utf8');
  const blips = [...s.matchAll(/r:embed="(rId\d+)"/g)].map(x => x[1]);
  console.log('---', f, 'embed rIds:', blips.join(','));
}
