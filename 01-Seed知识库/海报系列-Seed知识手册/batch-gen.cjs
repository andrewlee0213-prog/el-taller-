// Seed 系列批量:生成 02-06 的 S3 插画(吉祥物固定外形)→ 逐张去水印裁切
const fs = require('fs');
const cp = require('child_process');
const path = require('path');

let key = process.env.GLM_API_KEY;
if (!key) { console.error('NOKEY: 设置 GLM_API_KEY 后重试'); process.exit(1); }
console.log('key loaded (masked):', key.slice(0, 6) + '...');

const GEN = 'C:\\Users\\XC\\.zcode\\skills\\xc-poster-series\\scripts\\gen-illustration.js';
const CROP = 'C:\\Users\\XC\\.zcode\\skills\\xc-poster-series\\scripts\\wm-crop.js';
const DIR = __dirname;
const PAL = '墨绿#1F6F6B、深棕#3E2B1C、米黄#F7EEDC、橙#F08C3C、蓝#2B7DE9、草绿#8FCB4A';

// 吉祥物固定外形:全系列一字不差,只换场景
const MASCOT = '同一个白色圆头小机器人吉祥物，黑色屏幕脸，头顶细天线带红色小圆点，站在一张巨大的米黄色做旧索引卡片上，';

const CARDS = {
  '02': '机器人左手边飘着歪斜杂乱的深色对话气泡贴纸和红色问号，气泡里只有乱线条没有字；右手边同样的气泡变成了排列整齐的绿色对勾知识卡片，一条虚线箭头从乱侧穿过机器人指向净侧',
  '03': '机器人身前立着一张巨大的检查清单卡片，卡面上只画绿色对勾图案和浅色横线色块，不写字；脚边散落揉皱的纸团和歪斜文件夹，左侧飘着红色问号，右上方绿色对勾徽章和金色星星',
  '04': '机器人双手举起一块展示卡片，卡面只画上升的柱状图色块和一条上扬折线，不写字；脚边散落揉皱的纸团和歪斜的幻灯片贴纸，右侧排列整齐的图表卡片和闪闪金星',
  '05': '机器人张开双臂守护一座用索引卡片层层搭成的斜塔，塔上挂着一把挂锁图案；左边时钟贴纸、红色问号和深色乌云贴纸乱飞，右边塔顶发出金色光芒，绿色对勾和整齐卡片排成一列',
  '06': '机器人安坐在一摞整齐的书册和卡片旁，悠闲地捧着一个茶杯，四周安静散落书签贴纸、星星和温暖的光点，画面右上方一颗大的金色星星，整体氛围温暖安宁',
};

function run(cmd, args, timeout) {
  const r = cp.spawnSync(cmd, args, { env: { ...process.env, GLM_API_KEY: key }, encoding: 'utf8', timeout });
  console.log((r.stdout || '') + (r.stderr || ''));
  return r.status === 0;
}

let fail = [];
for (const no of Object.keys(CARDS)) {
  const raw = path.join(DIR, `s3-${no}.png`);
  const cropped = path.join(DIR, `s3-${no}-c.png`);
  const ok = run('node', [GEN, MASCOT + CARDS[no], raw, '--size', '1344x768', '--palette', PAL], 240000)
    && fs.existsSync(raw)
    && run('node', [CROP, raw, cropped], 120000)
    && fs.existsSync(cropped);
  if (!ok) fail.push(no);
  console.log(`--- card ${no}: ${ok ? 'OK' : 'FAIL'} ---`);
}
console.log(fail.length ? 'FAILED: ' + fail.join(',') : 'ALLDONE-ALL-OK');
process.exit(fail.length ? 1 : 0);
