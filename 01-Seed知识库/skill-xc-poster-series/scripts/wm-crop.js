#!/usr/bin/env node
/**
 * CogView 水印去除:右下角"AI生成"水印位置固定,用"放大裁切"确定性裁掉。
 * 用法: node wm-crop.js <in.png> [out.png] [zoom=1.12]
 * 原理: PNG 按 zoom 放大显示在 k×k 视口里,水印被推出视口外,Edge 截图即得裁切图。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const [inArg, outArg, zoomArg] = process.argv.slice(2);
if (!inArg) { console.log('用法: node wm-crop.js <in.png> [out.png] [zoom=1.12]'); process.exit(1); }
const inFile = path.resolve(inArg);
const outFile = path.resolve(outArg || inArg.replace(/\.png$/i, '-c.png'));
const k = parseFloat(zoomArg || '1.12');

const buf = fs.readFileSync(inFile);
function pngSize(b) {
  const sig = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
  if (!b.subarray(0, 8).equals(sig)) return null;
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}
function jpegSize(b) {
  if (b[0] !== 0xFF || b[1] !== 0xD8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xFF) { i++; continue; }
    const marker = b[i + 1];
    if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
      return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    }
    const len = b.readUInt16BE(i + 2);
    i += 2 + len;
  }
  return null;
}
const dim = pngSize(buf) || jpegSize(buf);
if (!dim) { console.error('无法识别图片尺寸(非 PNG/JPEG):', inFile); process.exit(1); }
const { w, h } = dim;
const W = Math.round(w / k), H = Math.round(h / k);

const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0}html,body{width:${W}px;height:${H}px;overflow:hidden}img{position:absolute;width:${Math.round(w * k)}px;left:${Math.round((W - w * k) / 2)}px;top:${Math.round((H - h * k) / 2)}px}</style></head><body><img src="${'file:///' + inFile.replace(/\\/g, '/')}"></body></html>`;
const htmlPath = path.join(os.tmpdir(), 'wm-crop-' + Date.now() + '.html');
fs.writeFileSync(htmlPath, html, 'utf8');

const cands = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const edge = cands.find(c => fs.existsSync(c));
if (!edge) { console.error('未找到 msedge.exe'); process.exit(1); }
const r = cp.spawnSync(edge, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars',
  `--window-size=${W},${H}`, '--virtual-time-budget=5000', `--screenshot=${outFile}`,
  'file:///' + htmlPath.replace(/\\/g, '/'),
], { timeout: 90000, stdio: 'ignore' });
fs.unlinkSync(htmlPath);
if (!fs.existsSync(outFile)) { console.error('裁切失败'); process.exit(1); }
console.log('OK', path.basename(outFile), `${w}x${h} → ${W}x${H}`);
