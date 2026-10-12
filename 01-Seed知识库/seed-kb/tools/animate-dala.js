// 给 Dala 风格的 05/05.1 注入动效与过渡：滚动渐显、进度条、氛围粒子、hero 入场、悬停微过渡
const fs = require('fs');
const path = require('path');
const KB = path.join(__dirname, '..');
const FILES = [
  path.join(KB, '05-AI Agent构建知识手册-完整版.template.html'),
  path.join(KB, '05.1-AI Agent构建知识手册-白话版.html'),
];

const CSS_ADD = `
/* ---- Dala 动效层 ---- */
#pbar{position:fixed;top:0;left:0;height:2px;width:0;background:var(--iris);z-index:80}
#ambient{position:fixed;inset:0;z-index:0;pointer-events:none;opacity:.55}
main{position:relative;z-index:1}
.rv{opacity:0;transform:translateY(26px);transition:opacity .9s cubic-bezier(.16,1,.3,1),transform .9s cubic-bezier(.16,1,.3,1)}
.rv.in{opacity:1;transform:none}
@keyframes rise{from{opacity:0;transform:translateY(26px)}to{opacity:1;transform:none}}
.kick,.hero h1,.lede,.cta,.meta,#cosmos{opacity:0;animation:rise 1s cubic-bezier(.16,1,.3,1) forwards}
.kick{animation-delay:.05s}
.hero h1{animation-delay:.15s}
.lede{animation-delay:.28s}
.cta{animation-delay:.4s}
.meta{animation-delay:.5s}
#cosmos{animation-delay:.35s;animation-duration:1.5s}
aside nav a,.ghost,.pill,td,a.top{transition:all .3s ease}
.pill:hover{background:#916bff;transform:translateY(-1px)}
tbody tr{transition:background .25s}
tbody tr:hover td{color:var(--bone)}
tbody tr:hover{background:rgba(255,255,255,.04)}
.topbtn{transition:transform .3s ease,background .3s ease}
.topbtn:hover{transform:scale(1.08)}
@media (prefers-reduced-motion: reduce){
  .rv{opacity:1;transform:none;transition:none}
  .kick,.hero h1,.lede,.cta,.meta,#cosmos{animation:none;opacity:1}
  #ambient{display:none}
}
@media print{.rv{opacity:1!important;transform:none!important}#ambient,#pbar{display:none}}`;

const ANIM_JS = `<div id="pbar"></div>
<canvas id="ambient"></canvas>
<script>
(function(){
  var reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var pb = document.getElementById('pbar');
  function pbUpd(){ var h=document.documentElement; var p=h.scrollTop/((h.scrollHeight-h.clientHeight)||1); pb.style.width=(p*100).toFixed(2)+'%'; }
  addEventListener('scroll', pbUpd, {passive:true}); pbUpd();
  var sel = 'section>h2,section>h3,section>p,section>ul,section>ol,section>pre,section>.tw,section>blockquote,section>figure,section>.ana,section>.case';
  var els = [].slice.call(document.querySelectorAll(sel));
  els.forEach(function(e){ e.classList.add('rv'); });
  if (reduced || !('IntersectionObserver' in window)) {
    els.forEach(function(e){ e.classList.add('in'); });
  } else {
    var io = new IntersectionObserver(function(es){
      var n = 0;
      es.forEach(function(en){
        if (en.isIntersecting) {
          en.target.style.transitionDelay = Math.min(n*70,350)+'ms';
          en.target.classList.add('in'); n++;
          io.unobserve(en.target);
        }
      });
    }, {threshold:.05, rootMargin:'0px 0px -6% 0px'});
    els.forEach(function(e){ io.observe(e); });
  }
  var c = document.getElementById('ambient'); if(!c) return;
  var x = c.getContext('2d');
  function size(){ c.width = innerWidth; c.height = innerHeight; }
  size(); addEventListener('resize', size);
  var cols=['#8052ff','#ffb829','#15846e','#c084fc','#7dd3fc'];
  var ps=[];
  for(var i=0;i<34;i++){ ps.push({x:Math.random()*innerWidth,y:Math.random()*innerHeight,s:1+Math.random()*2,a:Math.random()*6.28,v:(Math.random()*.1+.02)*(Math.random()<.5?-1:1),tw:Math.random()*6.28,c:cols[i%cols.length]}); }
  if(!reduced){
    (function draw(t){
      x.clearRect(0,0,c.width,c.height);
      for(var i=0;i<ps.length;i++){var p=ps[i];
        p.a+=p.v*.008;p.x+=Math.cos(p.a)*.1;p.y+=Math.sin(p.a)*.08;
        if(p.x<-12)p.x=c.width+12; if(p.x>c.width+12)p.x=-12;
        if(p.y<-12)p.y=c.height+12; if(p.y>c.height+12)p.y=-12;
        x.globalAlpha=.1+.1*Math.abs(Math.sin(t/1600+p.tw));
        x.strokeStyle=p.c;x.lineWidth=1;
        x.beginPath();var s=p.s+1.5;
        x.moveTo(p.x,p.y-s);x.lineTo(p.x+s*.87,p.y+s*.5);x.lineTo(p.x-s*.87,p.y+s*.5);x.closePath();x.stroke();
      }
      x.globalAlpha=1;requestAnimationFrame(draw);
    })(0);
  }
})();
</script>
<script>`;

let bad = 0;
for (const file of FILES) {
  let t = fs.readFileSync(file, 'utf8');
  const name = path.basename(file);
  if (!t.includes('</style>')) { console.log('FAIL style anchor:', name); bad++; continue; }
  t = t.replace('</style>', CSS_ADD + '\n</style>');
  if (!t.includes('<body>')) { console.log('FAIL body anchor:', name); bad++; continue; }
  t = t.replace('<body>', '<body>\n<div id="pbar"></div>\n<canvas id="ambient"></canvas>');
  const sa = t.indexOf('<script>');
  if (sa < 0) { console.log('FAIL script anchor:', name); bad++; continue; }
  // ANIM_JS 以 <script> 开头、以 <script> 结尾（衔接原有脚本），插入到首个脚本之前
  t = t.slice(0, sa) + ANIM_JS + t.slice(sa + '<script>'.length);
  // 防重复注入
  if (t.split('id="pbar"').length > 2) { console.log('WARN duplicate pbar:', name); }
  fs.writeFileSync(file, t, 'utf8');
  console.log(name, 'animated OK');
}
if (bad) process.exitCode = 1;
