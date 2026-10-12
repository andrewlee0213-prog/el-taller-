const fs = require('fs');
const base = 'C:/Users/XC/.zcode/workspace/default/xuandao-ppt/x/ppt/slides/';
for (const f of ['slide25.xml', 'slide26.xml']) {
  const xml = fs.readFileSync(base + f, 'utf8');
  console.log('\n===== ' + f + ' =====');
  const cols = [...xml.matchAll(/<a:gridCol w="(\d+)"[^>]*\/?>/g)].map(m => (m[1] / 914400).toFixed(2));
  console.log('gridCols(in):', cols.join(', '));
  const tbl = xml.match(/<a:tbl>[\s\S]*?<\/a:tbl>/)[0];
  const rows = tbl.match(/<a:tr [^>]*>[\s\S]*?<\/a:tr>/g) || [];
  rows.forEach((tr, ri) => {
    const h = (parseInt(tr.match(/h="(\d+)"/)[1]) / 914400).toFixed(3);
    const cells = tr.match(/<a:tc[ >][\s\S]*?<\/a:tc>/g) || [];
    console.log(`-- row${ri} h=${h}`);
    cells.forEach((c, ci) => {
      const paras = c.match(/<a:p>[\s\S]*?<\/a:p>/g) || [];
      const ptxt = paras.map(p => {
        const runs = p.match(/<a:r>[\s\S]*?<\/a:r>/g) || [];
        return runs.map(r => (r.match(/<a:t>([\s\S]*?)<\/a:t>/) || [, ''])[1]).join('|');
      });
      console.log(`   c${ci}: ${ptxt.join(' // ')}`);
    });
  });
}
