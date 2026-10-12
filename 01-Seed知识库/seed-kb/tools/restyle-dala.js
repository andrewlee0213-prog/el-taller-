// Seed HTML 换装 Dala 风格（纯黑 void + 紫罗兰/琥珀 + 400字重大标题 + 200轻正文 + 无卡片 + 粒子星图）
const fs = require('fs');
const path = require('path');
const KB = path.join(__dirname, '..');
const F05 = path.join(KB, '05-AI Agent构建知识手册-完整版.template.html');
const F051 = path.join(KB, '05.1-AI Agent构建知识手册-白话版.html');

const CSS = `:root{
  --void:#000000;--bone:#ffffff;--ash:#9a9a9a;--mist:#bdbdbd;--iris:#8052ff;--spark:#ffb829;--verdant:#15846e;
  --hair:rgba(255,255,255,.08);
  /* 旧变量别名（兼容正文内联样式） */
  --ink:#ffffff;--sub:#9a9a9a;--acc:#8052ff;--line:rgba(255,255,255,.08);--card:transparent;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--void);color:var(--bone);font-family:Inter,"Microsoft YaHei UI","Microsoft YaHei","PingFang SC",system-ui,sans-serif;font-weight:300;font-size:17px;line-height:1.95;-webkit-font-smoothing:antialiased}
aside{position:fixed;top:0;left:0;bottom:0;width:264px;background:transparent;padding:36px 0 40px;z-index:50}
aside .brand{padding:0 26px 22px;margin-bottom:18px}
aside .brand b{display:block;color:var(--bone);font-size:15px;font-weight:600;letter-spacing:.05em;line-height:1.6}
aside .brand span{display:block;margin-top:8px;font-size:11px;font-weight:600;letter-spacing:.22em;text-transform:uppercase;color:var(--spark)}
aside nav a{display:block;padding:8px 26px;color:var(--ash);text-decoration:none;font-size:13px;font-weight:600;letter-spacing:.05em;border-left:2px solid transparent}
aside nav a:hover{color:var(--bone)}
aside nav a.on{color:var(--bone);border-left-color:var(--iris)}
aside .tip{margin:24px 26px 0;padding-top:18px;border-top:1px solid var(--hair);font-size:12px;font-weight:300;color:var(--ash);line-height:1.9}
main{margin-left:264px}
.page{max-width:1280px;margin:0 auto;padding:56px 56px 120px}
header.hero{display:grid;grid-template-columns:1.15fr .85fr;gap:56px;align-items:center;max-width:1280px;margin:0 auto 40px;padding:24px 56px 0}
.kick{font-size:12px;font-weight:600;letter-spacing:.32em;text-transform:uppercase;color:var(--spark);margin:0 0 6px}
header.hero h1{font-size:clamp(44px,5.2vw,82px);font-weight:400;letter-spacing:-.03em;line-height:1.1;margin:12px 0 24px;color:var(--bone)}
.lede{font-size:18px;font-weight:200;color:var(--mist);max-width:520px;margin:0 0 34px}
.cta{margin:0 0 30px}
.pill{display:inline-block;background:var(--iris);color:#fff;text-decoration:none;font-size:13px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;padding:14px 32px;border-radius:999px}
.ghost{display:inline-block;margin-left:22px;color:var(--ash);text-decoration:none;font-size:13px;font-weight:400;letter-spacing:.06em;padding-bottom:3px}
.ghost:hover{color:var(--bone);border-bottom:1px solid var(--ash)}
.meta{margin:0;font-size:12px;font-weight:300;letter-spacing:.1em;color:var(--ash)}
#cosmos{width:100%;max-width:560px;height:auto;justify-self:end}
section{margin:0 0 110px}
h2{font-size:clamp(30px,3.4vw,44px);font-weight:400;letter-spacing:-.03em;line-height:1.18;margin:0 0 14px;color:var(--bone)}
h2 .no{color:var(--spark);margin-right:16px;font-size:.7em;vertical-align:3px;letter-spacing:0}
h2 .orig{display:inline-block;font-size:12px;font-weight:300;color:var(--ash);letter-spacing:.06em;margin:0 0 0 14px;vertical-align:6px}
h3{font-size:21px;font-weight:400;letter-spacing:-.01em;color:var(--bone);margin:48px 0 12px}
h4{font-size:17px;font-weight:600;color:var(--bone);margin:24px 0 8px}
p{margin:12px 0}
strong{color:#fff;font-weight:600}
ul,ol{padding-left:24px}
li{margin:8px 0}
.new{color:var(--spark);font-size:11px;font-weight:600;letter-spacing:.14em;margin-left:10px;vertical-align:2px}
blockquote{margin:30px 0;padding:0 0 0 22px}
blockquote::before{content:"要点";display:block;font-size:11px;font-weight:600;letter-spacing:.3em;text-transform:uppercase;color:var(--spark);margin-bottom:8px}
blockquote p{color:var(--mist);font-size:15.5px;margin:6px 0}
code{font-family:Consolas,Menlo,monospace;font-size:.85em;color:#fff;background:rgba(255,255,255,.07);padding:2px 7px;border-radius:6px}
pre{background:#0b0b0b;border-radius:24px;padding:28px 30px;overflow-x:auto;font-size:13.5px;line-height:1.7;color:var(--mist)}
pre code{background:none;border:none;color:inherit;padding:0}
.tw{overflow-x:auto;margin:28px 0}
table{width:100%;border-collapse:collapse;font-size:15px;background:transparent}
th{text-align:left;font-size:12px;font-weight:600;letter-spacing:.14em;text-transform:uppercase;color:var(--spark);padding:10px 16px 12px;border-bottom:1px solid var(--hair)}
td{padding:13px 16px;border-bottom:1px solid var(--hair);color:var(--mist);vertical-align:top}
tbody tr:last-child td{border-bottom:none}
figure{margin:38px 0;text-align:center}
figure img{max-width:100%;height:auto;border-radius:24px;display:block;margin:0 auto}
figure[style]{background:transparent!important;box-shadow:none!important;padding:0!important}
figcaption{font-size:13px;font-weight:300;color:var(--ash);margin-top:16px;text-align:left;padding:0 10px;line-height:1.9}
.ana,.case{margin:32px 0;padding:0 0 0 22px}
.ana::before{content:"生活类比";display:block;font-size:11px;font-weight:600;letter-spacing:.3em;text-transform:uppercase;color:var(--spark);margin-bottom:6px}
.case::before{content:"案例";display:block;font-size:11px;font-weight:600;letter-spacing:.3em;text-transform:uppercase;color:var(--spark);margin-bottom:6px}
.ana b,.case b{color:var(--spark);font-weight:600}
.foot{margin-top:90px;padding-top:28px;border-top:1px solid var(--hair);font-size:12px;letter-spacing:.1em;color:var(--ash)}
.topbtn{position:fixed;right:30px;bottom:30px;width:46px;height:46px;border-radius:999px;background:var(--iris);color:#fff;display:flex;align-items:center;justify-content:center;text-decoration:none;font-size:18px;z-index:60}
.mb{display:none}
@media (max-width:1020px){
  aside{transform:translateX(-100%);transition:transform .25s;background:#000;width:280px}
  aside.open{transform:none}
  main{margin-left:0}
  .mb{display:flex;position:fixed;top:0;left:0;right:0;height:50px;background:rgba(0,0,0,.88);color:#fff;align-items:center;padding:0 16px;z-index:55;font-size:14px;gap:14px}
  .mb button{background:none;border:1px solid rgba(255,255,255,.35);color:#fff;border-radius:999px;padding:3px 12px;cursor:pointer}
  .page{padding:80px 24px 80px}
  header.hero{grid-template-columns:1fr;padding:80px 24px 0;gap:28px}
  #cosmos{justify-self:start;max-width:420px}
}
@media print{aside,.topbtn,.mb{display:none}main{margin:0}}`;

const PARTICLE = `<script>
(function(){
  var c=document.getElementById('cosmos');if(!c)return;var x=c.getContext('2d');var W=c.width,H=c.height;
  var cols=['#8052ff','#ffb829','#15846e','#c084fc','#7dd3fc'];
  var ps=[];
  for(var i=0;i<96;i++){ps.push({x:W*.5+(Math.random()-.5)*W*.62,y:H*.5+(Math.random()-.5)*H*.68,s:1+Math.random()*2.4,a:Math.random()*6.28,v:(Math.random()*.14+.03)*(Math.random()<.5?-1:1),tw:Math.random()*6.28,c:cols[i%cols.length],cl:Math.random()<.62});}
  function frame(t){
    x.clearRect(0,0,W,H);
    var cx=W/2,cy=H/2,r=Math.min(W,H)*.36;
    for(var i=0;i<ps.length;i++){var p=ps[i];
      p.a+=p.v*.01;p.x+=Math.cos(p.a)*.16;p.y+=Math.sin(p.a)*.13;
      if(p.cl){var dx=cx-p.x,dy=cy-p.y,d=Math.sqrt(dx*dx+dy*dy);
        if(d>r){p.x+=dx/d*.3;p.y+=dy/d*.3;}}
      x.globalAlpha=.32+.3*Math.abs(Math.sin(t/1100+p.tw));
      x.strokeStyle=p.c;x.lineWidth=1.2;
      x.beginPath();var s=p.s+2.2;
      x.moveTo(p.x,p.y-s);x.lineTo(p.x+s*.87,p.y+s*.5);x.lineTo(p.x-s*.87,p.y+s*.5);x.closePath();x.stroke();
    }
    x.globalAlpha=1;requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
</script>
<script>`;

const HERO05 = `<header class="hero">
  <div>
    <p class="kick">Seed Knowledge Base · 完整版 05</p>
    <h1>AI Agent<br>构建知识手册</h1>
    <p class="lede">按构建一个 Agent 系统所需的组成部分组织知识，自成一体：内训讲课、新人工前预习、方案评审对照，读这一篇即可。文中数据为编写时的行业统计口径，正式对外引用前请先核实。</p>
    <div class="cta"><a class="pill" href="#s0">开始阅读</a><a class="ghost" href="05.1-AI%20Agent%E6%9E%84%E5%BB%BA%E7%9F%A5%E8%AF%86%E6%89%8B%E5%86%8C-%E7%99%BD%E8%AF%9D%E7%89%88.html">白话版 05.1 →</a></div>
    <p class="meta">配图 11 幅 · 进阶补全 6 块 NEW · 2026-09-09 · 单文件离线</p>
  </div>
  <canvas id="cosmos" width="560" height="440"></canvas>
</header>`;

const HERO051 = `<header class="hero">
  <div>
    <p class="kick">Seed Knowledge Base · 白话版 05.1</p>
    <h1>AI 助理<br>是怎么做出来的</h1>
    <p class="lede">不用任何技术背景：我们把"做一个靠谱的 AI 助理"想象成"调教一位全能管家"，每一章先讲生活里的道理，再告诉你这一行管它叫什么。读完就能听懂技术同事在说什么。</p>
    <div class="cta"><a class="pill" href="#s0">开始阅读</a><a class="ghost" href="05-AI%20Agent%E6%9E%84%E5%BB%BA%E7%9F%A5%E8%AF%86%E6%89%8B%E5%86%8C-%E5%AE%8C%E6%95%B4%E7%89%88.html">完整版 05 →</a></div>
    <p class="meta">黑话对照表 · 生活比喻贯穿 · 2026-09-09 · 单文件离线</p>
  </div>
  <canvas id="cosmos" width="560" height="440"></canvas>
</header>`;

let bad = 0;
function restyle(file, hero) {
  let t = fs.readFileSync(file, 'utf8');
  if (!/<style>[\s\S]*?<\/style>/.test(t)) { console.log('FAIL style:', path.basename(file)); bad++; return; }
  t = t.replace(/<style>[\s\S]*?<\/style>/, '<style>' + CSS + '</style>');
  if (!/<header class="hero">[\s\S]*?<\/header>/.test(t)) { console.log('FAIL hero:', path.basename(file)); bad++; return; }
  t = t.replace(/<header class="hero">[\s\S]*?<\/header>/, hero);
  const sa = '<script>\n  const links';
  if (!t.includes(sa)) { console.log('FAIL script anchor:', path.basename(file)); bad++; return; }
  t = t.replace(sa, PARTICLE + '\n  const links');
  fs.writeFileSync(file, t, 'utf8');
  console.log(path.basename(file), 'restyled OK');
}
restyle(F05, HERO05);
restyle(F051, HERO051);
if (bad) process.exitCode = 1;
