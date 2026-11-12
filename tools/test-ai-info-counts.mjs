/* Source quantity regression from the shared runtime; no data directory, browser or network. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../workbench-runtime.js',import.meta.url),'utf8');
function between(start,end){const a=source.indexOf(start),b=source.indexOf(end,a+start.length);assert(a>=0&&b>a);return source.slice(a,b);}
const bodies=new Map();
const node=id=>{if(!bodies.has(id))bodies.set(id,{innerHTML:'',textContent:'',classList:{toggle(){}}});return bodies.get(id);};
const context=vm.createContext({AI_WORKBENCH:true,CFG:{ups:[]},SCHED:{arxiv:{busy:false}},WB:{},HW:null,
  Date,Map,Set,Math,Number,String,console,document:{querySelectorAll:()=>[]},$:node,esc:value=>String(value??''),hm:()=> '12:00',dstr:()=> '2026-11-12',
  isNewDay:()=>false,itemRowHtml:(url,href,title,meta,src)=>'<row data-source="'+src+'">'+title+' '+meta+'</row>',ghTab:'d',HW_CATS:[['测评口碑','']]});
vm.runInContext(between('function renderBili()','function renderAnth()')+between('function renderAnth()','function renderArxiv()')+
  between('function renderArxiv()','/* ================= GitHub')+between('function renderGithub()','/* ================= Biblioteca')+
  between('function renderHw()','/* ================= 小红书'),context);
const items=Array.from({length:12},(_,i)=>({title:'Item '+i,zh:'标题 '+i,name:'UP '+i,bv:'sample'+i,url:'https://public.example.org/'+i,pub:'2026-11-12',created:1,repo:'repo/'+i,stars:100+i,delta:i,why:'原因 '+i}));
const data=()=>({ok:true,at:1,items:items.slice(),weekly:items.slice(0,10)});
let passed=0;
function check(name,fn){fn();passed++;console.log('PASS '+name);}
function rowCount(id){return(node(id).innerHTML.match(/<row /g)||[]).length;}
check('AI board caps B站 at five, Anthropic and arXiv at three',()=>{
  context.WB={bili:data(),anth:data(),arxiv:data()};context.renderBili();context.renderAnth();context.renderArxiv();
  assert.equal(rowCount('#biliBody'),5);assert.equal(rowCount('#anthBody'),3);assert.equal(rowCount('#arxivBody'),3);
  assert.match(node('#biliUpd').textContent,/展示 5 \/ 12/);assert.match(node('#anthUpd').textContent,/展示 3 \/ 12/);assert.match(node('#arxivUpd').textContent,/展示 3 \/ 12/);
});
check('source order and full cached arrays are preserved',()=>{
  assert.match(node('#biliBody').innerHTML,/Item 0/);assert.match(node('#biliBody').innerHTML,/Item 4/);assert.doesNotMatch(node('#biliBody').innerHTML,/Item 5/);
  for(const key of ['bili','anth','arxiv'])assert.equal(context.WB[key].items.length,12);
});
check('short source lists show available counts without padding',()=>{
  for(const key of ['bili','anth','arxiv'])context.WB[key].items=items.slice(0,1);
  context.renderBili();context.renderAnth();context.renderArxiv();
  for(const id of ['#biliBody','#anthBody','#arxivBody'])assert.equal(rowCount(id),1);
});
check('GitHub daily and weekly retain their complete cached rankings',()=>{
  context.WB.github=data();context.ghTab='d';context.renderGithub();assert.equal((node('#githubBody').innerHTML.match(/class="item"/g)||[]).length,12);assert.match(node('#githubBody').innerHTML,/repo\/11/);
  context.ghTab='w';context.renderGithub();assert.equal((node('#githubBody').innerHTML.match(/class="item"/g)||[]).length,10);assert.match(node('#githubBody').innerHTML,/repo\/9/);
});
check('hardware retains the complete single latest snapshot passed by the API',()=>{
  context.HW={date:'2026-11-12',summary:'最新一期摘要',links:items.slice(0,8).map((it,i)=>({cat:'测评口碑',s:'来源',t:'硬件 '+i,u:it.url})),prices:[],sources:{}};
  context.renderHw();assert.match(node('#hwUpd').textContent,/2026-11-12 · 8 条/);assert.equal((node('#hwBody').innerHTML.match(/class="hw-link"/g)||[]).length,8);assert.match(node('#hwBody').innerHTML,/最新一期摘要/);
});
check('classic workbench keeps its previous counts',()=>{
  context.AI_WORKBENCH=false;context.WB={bili:data(),anth:data(),arxiv:data()};context.renderBili();context.renderAnth();context.renderArxiv();
  assert.equal(rowCount('#biliBody'),12);assert.equal(rowCount('#anthBody'),12);assert.equal(rowCount('#arxivBody'),6);
});
console.log('RESULT '+passed+' source quantity checks passed; no real network or model calls.');
