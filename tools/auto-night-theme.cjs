#!/usr/bin/env node
/* 一次性改造脚本（2026-10-23）：日落自动切玄黑 · 日出回朱漆红。
 * 算法：上海纬度 31.23N/121.47E，太阳赤纬（Spencer 近似）+ 时角（-0.833° 大气折射）+ 均时差，
 *       分钟级精度（与节气模块同哲学，零依赖）。规则：仅对「从未手动选过主题」的访客自动切换
 *       （localStorage taller-theme 存在 = 手动选择，永久优先）；页面停留期间每分钟复查，
 *       日落/日出时刻跨过时自动切换（boot 抢先渲染防闪白，刷新时同样生效）。
 * 幂等：已含 __tallerSunFn 则跳过。用法：node tools/auto-night-theme.cjs */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname + '/..';

const FILES = ['index.html', 'about-site.html', 'kindle-dashboard.html', 'poster-six.html',
  'video-scripts.html', 'kids-english.html', 'openclaw.html', 'reader.html', 'kb.html',
  'login.html', 'workbench.html', 'posts/kb-engineering.html', 'posts/poster-methodology.html',
  'posts/poster-agent-spec.html', 'posts/trace-as-state.html'];

/* 新 boot：日出日落计算 + 无手动选择时按昼夜自动落主题（渲染前执行防闪） */
const OLD_BOOT = `<script>try{var __t=localStorage.getItem('taller-theme')||'bermellon';if(__t!=='naranja')document.documentElement.dataset.theme=__t}catch(_){}</script>`;
const NEW_BOOT = `<script>try{(function(){
var L=31.23,LG=121.47,r=Math.PI/180;
function sun(){var d=new Date(),N=Math.floor((d-new Date(d.getFullYear(),0,0))/864e5),
dec=r*23.44*Math.sin(r*(360/365)*(N-81)),
c=(Math.sin(-.833*r)-Math.sin(L*r)*Math.sin(dec))/(Math.cos(L*r)*Math.cos(dec)),
now=d.getHours()*60+d.getMinutes();
if(c>1)return{night:true};if(c<-1)return{night:false};
var H=Math.acos(c)/r,B=r*(360/365)*(N-81),
E=9.87*Math.sin(2*B)-7.53*Math.cos(B)-1.5*Math.sin(B),
n=720-4*(LG+d.getTimezoneOffset()/4)-E,  /* 太阳正午（当地钟表分钟）：标准经线差 + 均时差 */
fm=function(m){m=((m%1440)+1440)%1440;var h=Math.floor(m/60),mi=Math.floor(m%60);return(h<10?"0":"")+h+":"+(mi<10?"0":"")+mi};
return{night:now<n-H*4||now>n+H*4,rise:fm(n-H*4),set:fm(n+H*4)}}
window.__tallerSunFn=sun;window.__tallerSun=sun();
var __t=localStorage.getItem('taller-theme')||(window.__tallerSun.night?'negro':'bermellon');
if(__t!=='naranja')document.documentElement.dataset.theme=__t;
})()}catch(_){}</script>`;

/* 逗留期间的昼夜复查：跨过日落/日出自动切换（手动选择者跳过） */
const WATCHER = `
<script>/* 日落自动玄黑 · 日出回朱漆红：仅未手动选过主题的访客；每分钟复查 */
setInterval(function(){try{
if(localStorage.getItem('taller-theme'))return;
var S=window.__tallerSunFn&&window.__tallerSunFn();if(!S)return;window.__tallerSun=S;
var t=S.night?'negro':'bermellon';
if(document.documentElement.dataset.theme!==t){document.documentElement.dataset.theme=t;
document.querySelectorAll('.tdot').forEach(function(d){d.classList.toggle('on',d.dataset.themeDot===t)})}
}catch(_){}},60000);
</script>`;

for (const f of FILES) {
  const p = path.join(ROOT, f);
  let html = fs.readFileSync(p, 'utf8');
  if (html.includes('window.__tallerSunFn=sun')) { console.log('跳过（已注入）: ' + f); continue; }
  if (!html.includes(OLD_BOOT)) { console.warn('✗ boot 串不匹配: ' + f); continue; }
  html = html.replace(OLD_BOOT, NEW_BOOT);

  /* 切换器初始值对齐自动结果（单双引号两种变体；apply(cur) 会同步 dataset 与圆点高亮） */
  const AUTO = `(window.__tallerSun&&window.__tallerSun.night?'negro':'bermellon')`;
  html = html.replace(/var cur = 'bermellon';/g, `var cur = 'bermellon'; try{if(!localStorage.getItem('taller-theme')&&window.__tallerSun&&window.__tallerSun.night)cur='negro'}catch(_){}`);
  html = html.replace(/var cur = "bermellon";/g, `var cur = "bermellon"; try{if(!localStorage.getItem('taller-theme')&&window.__tallerSun&&window.__tallerSun.night)cur='negro'}catch(_){}`);
  html = html.replace(/localStorage\.getItem\('taller-theme'\) \|\| 'bermellon'/g, `localStorage.getItem('taller-theme') || ${AUTO}`);
  html = html.replace(/localStorage\.getItem\("taller-theme"\) \|\| "bermellon"/g, `localStorage.getItem("taller-theme") || ${AUTO}`);

  if (!html.includes(WATCHER.trim())) html = html.replace(/<\/body>/, WATCHER + '</body>');

  fs.writeFileSync(p, html);
  console.log('✓ ' + f);
}
