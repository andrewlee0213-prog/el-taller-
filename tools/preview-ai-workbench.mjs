/* Isolated UI preview. Fixtures are fictional, external requests and generation stay disabled. */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'taller-ai-preview-'));
const port = Number(process.env.TALLER_PREVIEW_PORT || 8952);
const password = crypto.randomBytes(12).toString('base64url');
const db = new DatabaseSync(path.join(data, 'users.db'));
db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE NOT NULL,pwhash TEXT NOT NULL,salt TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'user',must_change INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL DEFAULT (datetime('now')))`);
for (const [username, role] of [['ai-preview','admin'],['reader-preview','user']]) {
  const salt=crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO users(username,pwhash,salt,role,must_change) VALUES(?,?,?,?,0)').run(username,crypto.scryptSync(password,salt,64).toString('hex'),salt,role);
}
db.close();
const seed = (name,value) => fs.writeFileSync(path.join(data,name),JSON.stringify(value,null,2),{mode:0o600});
const at=Date.now(),date=new Date(at+8*3600e3).toISOString().slice(0,10),tomorrow=new Date(at+8*3600e3+864e5).toISOString().slice(0,10);
seed('server-config.json',{glmKey:'isolated-preview-no-network-not-a-real-key',biliUps:[{uid:'100',name:'公开教程示例'}]});
seed('workbench-cache.json',{
  glm:{ok:true,at,level:'预览数据',limits:[{type:'TOKENS_LIMIT',unit:3,number:5,usage:4000,currentValue:1280,remaining:2720,reset:at+2*3600e3},{type:'TOKENS_LIMIT',unit:6,number:1,usage:20000,currentValue:6200,remaining:13800,reset:at+3*864e5}],history:[{t:at-864e5,uW:1400},{t:at-72000e3,uW:1800},{t:at-36000e3,uW:3600},{t:at,uW:6200}]},
  oil:{ok:true,at,price:'9.41',prices:[{g:'92#',v:'8.84'},{g:'95#',v:'9.41'},{g:'98#',v:'10.68'},{g:'0#',v:'8.56'}],forecastVersion:2,adj:tomorrow,adjustAt:Date.parse(tomorrow+'T00:00:00+08:00')+864e5,cycleSource:'https://energy.cngold.org/c/'+date+'/c10000000.html',calendar:[{adj:tomorrow,sourceUrl:'https://energy.cngold.org/c/'+date+'/c10000000.html'}],forecast:null,next:'本轮预测待更新',hist:[]},
  bili:{ok:true,at,ups:[{uid:'100',name:'公开教程示例',items:[]}],items:[{title:'把知识做成可以探索的模型 · 示例',url:'https://www.bilibili.com',name:'公开教程示例',bv:'preview-only',created:Math.floor(at/1000),pub:date}]},
  anth:{ok:true,at,items:[{title:'Understanding model behavior',zh:'理解模型行为：从观察走向解释',url:'https://www.anthropic.com/research',date,pub:date}]},
  arxiv:{ok:true,at,items:[{title:'Learning representations for embodied agents',zh:'为具身 agent 学习可复用的表示',url:'https://arxiv.org',pub:date,why:'预览示例：关注环境、表示与决策的联系。'}]},
  github:{ok:true,at,items:[{repo:'example/agent-lab',url:'https://github.com',stars:4260,delta:318,fresh:true,lang:'Python',zh:'构建可追踪的 agent 实验，比较任务执行与证据。'}],weekly:[{repo:'example/visual-learning',url:'https://github.com',stars:10820,delta:1706,lang:'TypeScript',zh:'把知识机制做成可操作的分步演示。'}]},f1:{ok:true,at,races:[]}
});
seed('workbench-log.json',[{id:'preview-log',date,project:'El Taller',text:'AI 工作台隔离预览：顶部数据、资讯、日历和全息对话布局联调。',createdAt:at}]);
seed('workbench-memos.json',[{id:'preview-memo',date:tomorrow,text:'复核新工作台的手机布局与键盘操作。',done:false,cat:'work',createdAt:at}]);
seed('workbench-hw.json',{days:[{date,at,summary:'预览示例：持续采集身体指标的设备，与让环境数据可见的显示终端，分别对应两类硬件透镜。',links:[{t:'连续指标：从数据到理解',u:'https://www.example.com',s:'预览示例',cat:'测评口碑',lens:2}],sources:{review:'示例 · 未采集'},prices:[]}],watch:[]});
fs.mkdirSync(path.join(data,'kb-uploads'));
fs.writeFileSync(path.join(data,'kb-uploads','preview-reading.md'),'# 预览阅读材料\n\n## 说明\n\n这是隔离样例，不是真实藏书或工作记录。');
seed('kb-uploads.json',{'preview-reading':{id:'preview-reading',title:'视觉学习研究 · 预览样例',file:'preview-reading.md',type:'md',at,state:'new'}});
const credentials=path.join(data,'preview-login.json');fs.writeFileSync(credentials,JSON.stringify({username:'ai-preview',password,reader:'reader-preview',port,data}),{mode:0o600});
console.log('Preview: http://127.0.0.1:'+port+'/ai-workbench.html');
console.log('Credentials file: '+credentials);
const child=spawn(process.execPath,[path.join(root,'server.js')],{cwd:root,env:{PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,LANG:process.env.LANG,TALLER_PORT:String(port),TALLER_HOST:'127.0.0.1',TALLER_DATA_DIR:data,TALLER_OFFLINE:'1'},stdio:'inherit'});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>{process.exitCode=code||0;});
