const fs = require('fs');
const path = require('path');
const base = 'C:/Users/XC/.zcode/workspace/default/xuandao-ppt/x/ppt/slides';
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function inspect(file) {
  const xml = fs.readFileSync(path.join(base, file), 'utf8');
  console.log('\n================ ' + file + ' ================');
  // top-level shapes: sp, pic, graphicFrame, grpSp — walk by scanning <p:sp>...</p:sp> etc. Nested groups handled by recursion-lite: just list all blocks incl. inside groups, with indent guess.
  const blocks = [];
  const re = /<p:(sp|pic|graphicFrame|grpSp)>[\s\S]*?<\/p:\1>/g;
  let m;
  while ((m = re.exec(xml))) blocks.push({ tag: m[1], xml: m[2] = m[0], start: m.index });
  for (const b of blocks) {
    if (b.tag === 'grpSp') {
      // group: list name + children roughly
      const nm = (b.xml.match(/name="([^"]*)"/) || [])[1] || '?';
      const off = b.xml.match(/<a:off x="(\d+)" y="(\d+)"\/>/);
      const ext = b.xml.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
      console.log(`[GROUP ${nm}] off=${off ? off.slice(1).join(',') : '?'} ext=${ext ? ext.slice(1).join(',') : '?'}`);
      const inner = b.xml.match(/<p:(sp|pic|graphicFrame)>[\s\S]*?<\/p:\1>/g) || [];
      for (const s of inner) printShape(s, '  ');
      continue;
    }
    printShape(b.xml, '');
  }
  // paragraphs scan (whole file, catches table cells too)
}
function printShape(s, ind) {
  const nm = (s.match(/name="([^"]*)"/) || [])[1] || '?';
  const id = (s.match(/<p:cNvPr id="(\d+)"/) || [])[1] || '?';
  const off = s.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/>/);
  const ext = s.match(/<a:ext cx="(\d+)" cy="(\d+)"\/>/);
  const pos = off && ext ? `x=${(off[1]/914400).toFixed(2)} y=${(off[2]/914400).toFixed(2)} w=${(ext[1]/914400).toFixed(2)} h=${(ext[2]/914400).toFixed(2)}in` : 'no-xfrm';
  if (s.includes('<a:tbl>')) {
    console.log(`${ind}[TABLE id=${id} ${nm}] ${pos}`);
    const trs = s.match(/<a:tr h="(\d+)"[^>]*>[\s\S]*?<\/a:tr>/g) || [];
    trs.forEach((tr, i) => {
      const h = (parseInt(tr.match(/h="(\d+)"/)[1]) / 914400).toFixed(2);
      const cells = tr.match(/<a:tc[ >][\s\S]*?<\/a:tc>/g) || [];
      const cellTxt = cells.map(c => (c.match(/<a:t>([\s\S]*?)<\/a:t>/) || []).map(x => x[1]).join('') || '·');
      console.log(`${ind}  row${i} h=${h}in | ${cellTxt.join(' ‖ ')}`);
    });
    return;
  }
  const isPic = s.includes('<p:blipFill');
  console.log(`${ind}[${isPic ? 'PIC' : 'SP'} id=${id} ${nm}] ${pos}`);
  if (isPic) return;
  const paras = s.match(/<a:p>[\s\S]*?<\/a:p>/g) || [];
  paras.forEach((p, i) => {
    const runs = p.match(/<a:r>[\s\S]*?<\/a:r>/g) || [];
    const brs = (p.match(/<a:br\/>/g) || []).length;
    const parts = runs.map(r => {
      const t = (r.match(/<a:t>([\s\S]*?)<\/a:t>/) || [, ''])[1];
      const clr = (r.match(/<a:srgbClr val="([0-9A-Fa-f]{6})"/) || [])[1] || '';
      const sz = (r.match(/sz="(\d+)"/) || [])[1] || '';
      const b = /b="1"/.test(r) ? 'B' : '';
      return `<${sz || '?'}${b}${clr ? '#' + clr : ''}>${esc(t)}`;
    });
    console.log(`${ind}  p${i}${brs ? '(+' + brs + 'br)' : ''}: ${parts.join(' + ')}`);
  });
}
['slide1.xml','slide14.xml','slide19.xml','slide20.xml','slide23.xml','slide24.xml','slide25.xml','slide26.xml','slide28.xml','slide29.xml'].forEach(inspect);
