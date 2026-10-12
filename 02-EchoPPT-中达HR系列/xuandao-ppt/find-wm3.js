const fs = require('fs');
const path = require('path');
const X = 'C:/Users/XC/.zcode/workspace/default/xuandao-ppt/x';
const KEEP = [1, 20, 24, 23, 25, 26, 28, 14, 19, 29];
for (const n of KEEP) {
  const xml = fs.readFileSync(`${X}/ppt/slides/slide${n}.xml`, 'utf8');
  const rels = fs.readFileSync(`${X}/ppt/slides/_rels/slide${n}.xml.rels`, 'utf8');
  const rid2img = {};
  for (const m of rels.matchAll(/Id="(rId\d+)"[^>]*Target="[^"]*media\/(image[^"]+)"/g)) rid2img[m[1]] = m[2];
  // every blip embed with surrounding shape context
  for (const m of xml.matchAll(/<a:blip r:embed="(rId\d+)"/g)) {
    const i = m.index;
    const before = xml.slice(Math.max(0, i - 600), i);
    const nameM = [...before.matchAll(/name="([^"]*)"/g)];
    const offM = before.match(/<a:off x="(-?\d+)" y="(-?\d+)"\/><a:ext cx="(\d+)" cy="(\d+)"\/>/);
    const pos = offM ? `${(offM[1] / 914400).toFixed(2)},${(offM[2] / 914400).toFixed(2)} ${(offM[3] / 914400).toFixed(2)}x${(offM[4] / 914400).toFixed(2)}in` : '?';
    console.log(`slide${n}: ${rid2img[m[1]]} via ${m[1]} shape[${nameM.length ? nameM[nameM.length - 1][1] : '?'}] @ ${pos}`);
  }
}
