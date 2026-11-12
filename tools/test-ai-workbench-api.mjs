/* Isolated API checks. Never reads the live data directory or calls a real model. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const data=fs.mkdtempSync(path.join(os.tmpdir(),'taller-ai-api-test-'));
const port=await new Promise(resolve=>{const server=net.createServer();server.listen(0,'127.0.0.1',()=>{const value=server.address().port;server.close(()=>resolve(value));});});
const db=new DatabaseSync(path.join(data,'users.db'));
db.exec(`CREATE TABLE users(id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT UNIQUE NOT NULL,pwhash TEXT NOT NULL,salt TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'user',must_change INTEGER NOT NULL DEFAULT 0,created TEXT NOT NULL DEFAULT (datetime('now')))`);
const password='isolated-api-test';
for(const [name,role,mc] of [['admin-test','admin',0],['reader-test','user',0],['initial-test','admin',1]]){const salt=crypto.randomBytes(16).toString('hex');db.prepare('INSERT INTO users(username,pwhash,salt,role,must_change) VALUES(?,?,?,?,?)').run(name,crypto.scryptSync(password,salt,64).toString('hex'),salt,role,mc);}
db.close();
fs.mkdirSync(path.join(data,'kb-uploads'));fs.writeFileSync(path.join(data,'kb-uploads','sample.md'),'# Test\n\n## One\n\nSample');
fs.writeFileSync(path.join(data,'kb-uploads.json'),JSON.stringify({sample:{id:'sample',title:'Test reading',file:'sample.md',type:'md',state:'new',at:1}}));
const env={PATH:process.env.PATH,HOME:process.env.HOME,TMPDIR:process.env.TMPDIR,LANG:process.env.LANG,TALLER_PORT:String(port),TALLER_HOST:'127.0.0.1',TALLER_DATA_DIR:data,TALLER_OFFLINE:'1'};
const child=spawn(process.execPath,[path.join(root,'server.js')],{cwd:root,env,stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
const base='http://127.0.0.1:'+port;let cookie='',passed=0;
async function req(url,body){const response=await fetch(base+url,{method:body===undefined?'GET':'POST',redirect:'manual',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});const text=await response.text();let json;try{json=JSON.parse(text);}catch{}return{response,text,json};}
function check(name,condition){assert.ok(condition,name);passed++;console.log('PASS '+name);}
async function login(name){cookie='';const r=await req('/api/login',{username:name,password});assert.equal(r.response.status,200);cookie=r.response.headers.get('set-cookie').split(';')[0];}
try{
  let ready=false;for(let i=0;i<80;i++){try{await fetch(base+'/api/me');ready=true;break;}catch{await new Promise(r=>setTimeout(r,100));}}assert.ok(ready,output);
  for(const url of ['/ai-workbench.html','/workbench-template.html','/%61i-workbench.html','/workbench-%74emplate.html','/%77orkbench.html','//ai-workbench.html','/constelacion-%64ata.js'])check('anonymous page guard '+url,(await req(url)).response.status===302);
  for(const url of ['/server.js','/ai-workbench-service.js','/safe-public-fetch.js','/%61i-workbench-service.js'])check('server source is not public '+url,(await req(url)).response.status===404);
  check('malformed encoding is rejected',(await req('/%zz')).response.status===400);
  for(const url of ['/api/workbench/ai/status','/api/kb/inbox','/api/workbench/ai/%73tatus','/api/kb/%69nbox'])check('anonymous API guard '+url,(await req(url)).response.status===401);
  await login('reader-test');
  for(const url of ['/ai-workbench.html','/workbench-template.html','/api/workbench/ai/status','/api/kb/inbox'])check('reader denied '+url,(await req(url)).response.status===403);
  await login('initial-test');check('must-change inbox guard',(await req('/api/kb/inbox')).response.status===403);check('must-change AI guard',(await req('/api/workbench/ai/status')).response.status===403);
  await login('admin-test');
  for(const url of ['/ai-workbench.html','/workbench-template.html','/workbench.html','/workbench-runtime.js','/ai-workbench.js','/ai-workbench.css'])check('admin serves '+url,(await req(url)).response.status===200);
  const model=await req('/api/workbench/ai/status');check('unconfigured model stays explicit',model.json.ok&&model.json.configured===false&&model.json.preview===true);
  check('unconfigured chat returns 503',(await req('/api/workbench/ai/chat',{messages:[{role:'user',content:'test'}]})).response.status===503);
  check('invalid model role rejected',(await req('/api/workbench/ai/chat',{messages:[{role:'system',content:'test'}]})).response.status===400);
  const inbox=await req('/api/kb/inbox');check('same upload queue',inbox.json.items.length===1&&inbox.json.items[0].id==='sample');
  const wb=await req('/api/workbench/data');check('classic workbench same queue',JSON.stringify(inbox.json.items)===JSON.stringify(wb.json.kbInbox));
  const triage=await req('/api/kb/triage',{id:'sample',act:'note',note:'Reviewed in isolated test'});check('inbox comment writes same record',triage.json.ok===true);check('comment exits queue',(await req('/api/kb/inbox')).json.items.length===0);
  const log=await req('/api/workbench/log',{text:'AI layout test record',date:'2026-11-11',project:'Test'});check('existing log API writes',log.json.ok===true);check('existing log API reads',(await req('/api/workbench/log')).json.items.some(item=>item.text==='AI layout test record'));
  check('private data never static',(await req('/data/users.db')).response.status===404);
  console.log('RESULT '+passed+' passed; isolated data only, no real model calls.');
}finally{child.kill('SIGTERM');await new Promise(resolve=>{child.once('exit',resolve);setTimeout(resolve,1000);});fs.rmSync(data,{recursive:true,force:true});}
