#!/usr/bin/env node
/**
 * AI 底图产线:调 GLM CogView 出"无字底图"(方案甲)。
 * 前置:环境变量 GLM_API_KEY(open.bigmodel.cn 的 API Key)。
 * 用法: node gen-illustration.js "<画面描述>" [输出.png] [--size 1344x768] [--palette "墨绿#1F6F6B、深棕#3E2B1C"] [--model cogview-4]
 * 两种用途:
 *   1) S3 主视觉底图 → 产出后把文件名填进 poster.json 的 s3.image
 *   2) 系列共用纸纹背景 → --size 1024x1280,产出后填进 base.json 的 theme.bgImage
 * 提示词铁律:画面中不要出现任何文字(文字由模板后期排版)。
 */
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const argv = process.argv.slice(2);
const argOf = name => { const i = argv.indexOf(name); return i > -1 ? argv[i + 1] : null; };
const size = argOf('--size') || '1344x768';
const palette = argOf('--palette');
const model = argOf('--model') || 'cogview-4';
const rest = argv.filter((a, i) => !a.startsWith('--') && (i === 0 || argv[i - 1] !== '--size' && argv[i - 1] !== '--palette' && argv[i - 1] !== '--model'));
const [prompt, outArg] = rest;
if (!prompt) {
  console.log('用法: node gen-illustration.js "<画面描述>" [输出.png] [--size 1344x768] [--palette "色名#色值、…"] [--model cogview-4]');
  process.exit(1);
}
const out = path.resolve(outArg || 's3-illustration.png');
const key = process.env.GLM_API_KEY;
if (!key) { console.error('未设置 GLM_API_KEY 环境变量;无法走 AI 底图产线,将退回内置 SVG 场景。'); process.exit(2); }

const paletteTxt = palette ? `配色仅限${palette}，` : '配色仅限深棕#3E2B1C、蓝#1E6FE0、橙#F08C3C、绿#8FCB4A，';
const guard = `，画面中绝对不要出现任何文字、字母、数字、伪文字、乱码符号、水印。手绘贴纸拼贴风格，复古纸张质感，米黄色纸纹底#F7EEDC，${paletteTxt}` +
  '白色贴纸描边，柔和投影，元素饱满铺满画布，扁平插画。注意:贴纸上只能画图案和色块,不能画字母或字符涂鸦。';

const body = JSON.stringify({ model, prompt: prompt + guard, size });
const res = cp.spawnSync('node', ['-e', `
  const http=require('http'),https=require('https');
  const req=(${JSON.stringify('https://open.bigmodel.cn/api/paas/v4/images/generations')});
  https.request(req,{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+process.env.K}},
  r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>console.log(b))}).on('error',e=>{console.error(e);process.exit(1)}).end(process.env.B);
`], { env: { ...process.env, K: key, B: body }, encoding: 'utf8', timeout: 120000 });

let data;
try { data = JSON.parse(res.stdout); } catch { console.error('响应异常:', res.stdout, res.stderr); process.exit(1); }
const url = data?.data?.[0]?.url;
if (!url) { console.error('生成失败:', JSON.stringify(data)); process.exit(1); }
cp.spawnSync('node', ['-e', `
  const fs=require('fs'),https=require('https');
  https.get(${JSON.stringify(url)}, r=>{
    if(r.statusCode>=300&&r.headers.location) return https.get(r.headers.location, r2=>r2.pipe(fs.createWriteStream(process.argv[1])));
    r.pipe(fs.createWriteStream(process.argv[1]));
  });
`, out], { timeout: 120000 });
console.log('OK', out, '\n把 s3.image 填为:', path.basename(out));
