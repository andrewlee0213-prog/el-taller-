const fs = require('fs');
const path = require('path');
const X = 'C:/Users/XC/.zcode/workspace/default/xuandao-ppt/x';
const KEEP = [1, 20, 24, 23, 25, 26, 28, 14, 19, 29];
const label = { 1: 'P1封面', 20: 'P2章节', 24: 'P3五步', 23: 'P4四法', 25: 'P5案例3', 26: 'P6案例4', 28: 'P7职责', 14: 'P8转化', 19: 'P9清单', 29: 'P10结尾' };
for (const n of KEEP) {
  const rels = fs.readFileSync(`${X}/ppt/slides/_rels/slide${n}.xml.rels`, 'utf8');
  const lay = (rels.match(/slideLayout(\d+)\.xml/) || [])[1];
  const lrels = fs.readFileSync(`${X}/ppt/slideLayouts/_rels/slideLayout${lay}.xml.rels`, 'utf8');
  const master = (lrels.match(/slideMaster(\d+)\.xml/) || [])[1];
  const mrels = fs.readFileSync(`${X}/ppt/slideMasters/_rels/slideMaster${master}.xml.rels`, 'utf8');
  const limg = [...lrels.matchAll(/media\/(image[^"]+)"/g)].map(m => m[1]).join(',');
  const mimg = [...mrels.matchAll(/media\/(image[^"]+)"/g)].map(m => m[1]).join(',');
  console.log(`slide${n} (${label[n]}): layout${lay} img[${limg}] -> master${master} img[${mimg}]`);
}
