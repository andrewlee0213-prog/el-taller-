// 一次性 runner:优先读 GLM_API_KEY 环境变量 → 生成 Seed 系列 S3 底图与系列纸纹背景
const fs = require('fs');
const cp = require('child_process');
const path = require('path');

let key = process.env.GLM_API_KEY;
if (!key) {
  const widget = fs.readFileSync('C:\\Users\\XC\\.zcode\\workspace\\default\\glm-widget\\glm-widget.ps1', 'utf8');
  const m = widget.match(/[0-9a-f]{16}\.[A-Za-z0-9]{8,}/);
  if (m) key = m[0];
}
if (!key) { console.error('NOKEY: 设置 GLM_API_KEY 环境变量后重试'); process.exit(1); }
console.log('key loaded (masked):', key.slice(0, 6) + '...');

const GEN = 'C:\\Users\\XC\\.zcode\\skills\\xc-poster-series\\scripts\\gen-illustration.js';
const DIR = __dirname;
const PAL = '墨绿#1F6F6B、深棕#3E2B1C、米黄#F7EEDC、橙#F08C3C、蓝#2B7DE9、草绿#8FCB4A';

function run(args) {
  const r = cp.spawnSync('node', [GEN, ...args], {
    env: { ...process.env, GLM_API_KEY: key }, encoding: 'utf8', timeout: 240000,
  });
  console.log('[gen]', args[1], '→ exit', r.status, '\n', (r.stdout || '') + (r.stderr || ''));
  return r.status === 0 && fs.existsSync(args[1]);
}

run([
  '一个可爱的白色圆角小机器人，站在一张巨大的米黄色索引卡片上，索引卡左上角有深棕色标签耳，卡面有浅色横线；机器人左手边漂浮着揉皱的纸团、旧文件夹、放大镜、歪斜的对话气泡和红色问号贴纸，右手边是整齐排列的知识卡片、绿色对勾、书签和闪闪星光，一条虚线箭头从左穿过机器人指向右侧，构图饱满，四周贴纸簇拥',
  path.join(DIR, 's3-01.png'), '--size', '1344x768', '--palette', PAL,
]);

const bgPrompt = '复古纸张纹理背景，米黄色纸面带细微颗粒噪点与轻微水彩晕染，四角散落少量手绘小贴纸：索引卡、书签、星星、虚线、胶带贴角，画面正中央与上部为大面积干净留白，边缘轻微暗角，没有任何主体物';
if (!run([bgPrompt, path.join(DIR, 'bg-texture.png'), '--size', '1024x1280', '--palette', PAL])) {
  run([bgPrompt, path.join(DIR, 'bg-texture.png'), '--size', '864x1152', '--palette', PAL]);
}
console.log('ALLDONE');
