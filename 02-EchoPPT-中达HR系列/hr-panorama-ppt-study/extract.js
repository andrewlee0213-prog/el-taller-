// Extract structured inventory from unpacked pptx XML (regex-based, no deps)
const fs = require('fs');
const path = require('path');
const BASE = path.join(__dirname, 'x', 'ppt');
const read = f => fs.readFileSync(f, 'utf8');

const dec = s => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
  .replace(/&amp;/g, '&');

function emu2in(v) { return (parseInt(v, 10) / 914400).toFixed(2); }

// ---- presentation.xml: slide order + size ----
const pres = read(path.join(BASE, 'presentation.xml'));
const sldSz = pres.match(/<p:sldSz[^>]*>/)[0];
const slideOrder = [...pres.matchAll(/<p:sldId[^>]*r:id="(rId\d+)"/g)].map(m => m[1]);
const presRels = read(path.join(BASE, '_rels', 'presentation.xml.rels'));
const ridMap = {};
for (const m of presRels.matchAll(/Id="(rId\d+)"[^>]*Target="([^"]+)"/g)) ridMap[m[1]] = m[2];

console.log('=== CANVAS ===');
console.log(sldSz);
console.log('slide order (rId -> file):');
slideOrder.forEach((rid, i) => console.log(`  ${i + 1}. ${rid} -> ${ridMap[rid]}`));

// ---- themes ----
for (const t of ['theme1', 'theme2', 'theme3']) {
  const f = path.join(BASE, 'theme', t + '.xml');
  if (!fs.existsSync(f)) continue;
  const x = read(f);
  console.log(`\n=== ${t} ===`);
  const name = x.match(/<a:theme[^>]*name="([^"]*)"/);
  if (name) console.log('name: ' + name[1]);
  const cs = x.match(/<a:clrScheme[^>]*>[\s\S]*?<\/a:clrScheme>/);
  if (cs) {
    for (const m of cs[0].matchAll(/<a:(\w+)>\s*<a:(?:srgbClr val="([0-9A-Fa-f]{6})"|sysClr[^>]*lastClr="([0-9A-Fa-f]{6})")/g)) {
      console.log(`  ${m[1]}: ${m[2] || m[3]}`);
    }
  }
  const fsx = x.match(/<a:fontScheme[^>]*>[\s\S]*?<\/a:fontScheme>/);
  if (fsx) {
    for (const m of fsx[0].matchAll(/<a:(major|minor)Font>\s*<a:latin typeface="([^"]*)"[^>]*\/>\s*<a:ea typeface="([^"]*)"/g)) {
      console.log(`  ${m[1]}: latin=${m[2]} ea=${m[3]}`);
    }
  }
}

// ---- per-slide dump ----
function dumpTxBody(tx, indent) {
  const out = [];
  for (const p of tx.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)) {
    const para = p[1];
    const algn = (para.match(/<a:pPr[^>]*algn="(\w+)"/) || [])[1] || '';
    const lvl = (para.match(/<a:pPr[^>]*lvl="(\d+)"/) || [])[1] || '0';
    let runs = [];
    for (const r of para.matchAll(/<a:r>([\s\S]*?)<\/a:r>/g)) {
      const rx = r[1];
      const txt = dec((rx.match(/<a:t>([\s\S]*?)<\/a:t>/) || [])[1] || '');
      const sz = (rx.match(/sz="(\d+)"/) || [])[1];
      const b = / b="1"/.test(rx);
      const clr = (rx.match(/srgbClr val="([0-9A-Fa-f]{6})"/) || [])[1];
      const latin = (rx.match(/<a:latin typeface="([^"]*)"/) || [])[1];
      const ea = (rx.match(/<a:ea typeface="([^"]*)"/) || [])[1];
      if (txt) runs.push({ txt, sz: sz ? (+sz / 100) : '', b, clr, latin, ea });
    }
    // endParaRPr only paragraphs (empty)
    if (!runs.length) {
      const ePr = para.match(/<a:endParaRPr[^>]*sz="(\d+)"/);
      runs.push({ txt: '¶', sz: ePr ? (+ePr[1] / 100) : '', b: false, clr: '', latin: '', ea: '' });
    }
    out.push({ algn, lvl, runs });
  }
  return out;
}

function walkShapes(xml, depth, cb) {
  // split top-level sp/pic/grpSp/graphicFrame blocks (crude but works: match balanced by nesting of same tag)
  const tags = ['p:sp', 'p:pic', 'p:grpSp', 'p:graphicFrame', 'p:cxnSp'];
  for (const tag of tags) {
    const re = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
    for (const m of xml.matchAll(re)) cb(tag, m[0], m[1], depth);
  }
}

function shapeInfo(kind, inner, depth) {
  const name = (inner.match(/name="([^"]*)"/) || [])[1] || '';
  const off = inner.match(/<a:off x="(-?\d+)" y="(-?\d+)"/);
  const ext = inner.match(/<a:ext cx="(\d+)" cy="(\d+)"/);
  const geom = (inner.match(/<a:prstGeom prst="(\w+)"/) || [])[1] || (kind === 'p:pic' ? 'PIC' : '');
  const fill = [...inner.matchAll(/<p:spPr>[\s\S]*?<a:solidFill>\s*<a:(?:srgbClr val="([0-9A-Fa-f]{6})"|schemeClr val="(\w+)")[^>]*?(?:\/>|>\s*<a:alpha val="(\d+)")/g)];
  let fillInfo = '';
  const spPr = (inner.match(/<p:spPr>([\s\S]*?)<\/p:spPr>/) || [])[1] || '';
  const sf = spPr.match(/<a:solidFill>\s*<a:(?:srgbClr val="([0-9A-Fa-f]{6})"|schemeClr val="(\w+)")(?:\s*\/>|>\s*(?:<a:alpha val="(\d+)")?)/);
  if (sf) fillInfo = `${sf[1] || sf[2]}${sf[3] ? '@' + (+sf[3] / 1000) + '%' : ''}`;
  else if (/noFill/.test(spPr)) fillInfo = 'noFill';
  else if (spPr.includes('gradFill')) fillInfo = 'GRADIENT';
  const line = spPr.match(/<a:ln[^>]*>[\s\S]*?<a:solidFill>\s*<a:(?:srgbClr val="([0-9A-Fa-f]{6})"|schemeClr val="(\w+)")/);
  const lineInfo = line ? `line:${line[1] || line[2]}` : '';
  const pos = off && ext ? `x=${emu2in(off[1])} y=${emu2in(off[2])} w=${emu2in(ext[1])} h=${emu2in(ext[2])}` : 'no-xfrm';
  return { kind, name, pos, geom, fillInfo, lineInfo, inner, depth };
}

for (let i = 0; i < slideOrder.length; i++) {
  const rid = slideOrder[i];
  const file = ridMap[rid]; // e.g. slides/slide1.xml
  const f = path.join(BASE, file.replace('../', '').replace('/', path.sep));
  const x = read(f);
  console.log(`\n\n########## SLIDE ${i + 1} (${file}) ##########`);
  const relsF = path.join(BASE, 'slides', '_rels', path.basename(file) + '.rels');
  if (fs.existsSync(relsF)) {
    const rels = read(relsF);
    const lay = (rels.match(/Target="([^"]*slideLayout\d+\.xml)"/) || [])[1];
    const media = [...rels.matchAll(/Target="([^"]*media\/[^"]+)"/g)].map(m => m[1]);
    console.log(`layout: ${lay || '?'} | media: ${media.join(', ') || '-'}`);
  }
  // top-level: strip nested groups' children handled via recursion below
  const root = x.match(/<p:spTree>([\s\S]*)<\/p:spTree>/)[1];
  const items = [];
  (function parse(block, depth) {
    // find child sp/pic/grpSp at this level: match opening tags sequentially with balance
    const re = /<p:(sp|pic|grpSp|graphicFrame|cxnSp)>/g;
    let m;
    while ((m = re.exec(block)) !== null) {
      const tag = 'p:' + m[1];
      const start = m.index;
      // find matching close considering nesting of same tag
      let d = 0, idx = start, end = -1;
      const open = new RegExp(`<${tag}>|</${tag}>`, 'g');
      open.lastIndex = start;
      let mm;
      while ((mm = open.exec(block)) !== null) {
        if (mm[0] === `<${tag}>`) d++;
        else { d--; if (d === 0) { end = open.lastIndex; break; } }
      }
      if (end === -1) break;
      const inner = block.slice(start, end);
      const info = shapeInfo(tag, inner, depth);
      items.push(info);
      if (m[1] === 'grpSp' && depth < 6) {
        // recurse into children: strip the grpSp wrapper's own open/close tags
        parse(inner.slice(tag.length + 2, inner.length - tag.length - 3), depth + 1);
      }
      re.lastIndex = end;
    }
  })(root, 0);

  for (const it of items) {
    const pad = '  '.repeat(it.depth);
    const tx = it.inner.match(/<p:txBody>([\s\S]*?)<\/p:txBody>/);
    let paras = '';
    if (tx) {
      const pp = dumpTxBody(tx[1]);
      paras = pp.map(p => {
        const prefix = `${p.algn ? '[' + p.algn + ']' : ''}${p.lvl !== '0' ? 'L' + p.lvl : ''}`;
        const rs = p.runs.map(r => {
          const meta = [r.sz ? r.sz + 'pt' : '', r.b ? 'B' : '', r.clr ? '#' + r.clr : '', r.latin ? r.latin : (r.ea ? r.ea : '')].filter(Boolean).join('/');
          return `{${meta}}${r.txt}`;
        }).join('');
        return `${pad}    ${prefix}${rs}`;
      }).filter(s => s.trim().length > pad.length + 4 || s.includes('¶') === false).join('\n');
    }
    console.log(`${pad}- [${it.kind}] "${it.name}" ${it.geom} | ${it.pos} | ${it.fillInfo} ${it.lineInfo}`);
    if (paras) console.log(paras);
  }
  // notes
  const notesFile = path.join(BASE, 'notesSlides', `notesSlide${i + 1}.xml`);
  if (fs.existsSync(notesFile)) {
    const nx = read(notesFile);
    const texts = [...nx.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => dec(m[1])).join('');
    if (texts.trim()) console.log(`  NOTES: ${texts}`);
  }
}
