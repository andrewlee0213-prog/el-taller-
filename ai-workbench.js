/* AI Studio owns layout and conversation; the original workbench owns its data and actions. */
(function () {
  'use strict';
  const byId = id => document.getElementById(id);
  let view = null, frame = 0, elapsed = 0, previous = 0, state = 'idle', userPaused = false, centerVisible = true;
  let controller = null, requestId = 0, configured = false, conversation = [], moduleOpen = false;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const coreLabels = { idle:'核心待命', thinking:'正在思考', speaking:'回答已就绪', error:'请求未完成' };
  function status(message, failed) {
    byId('aiChatStatus').textContent = message;
    byId('aiChatStatus').classList.toggle('error', !!failed);
    byId('aiChatStatus').hidden = !failed;
  }
  function draw() {
    if (view) view.render(null, [], { time:elapsed, coreOnly:true, coreZoom:.8, reducedMotion:motion.matches || userPaused });
  }
  function animate(at) {
    frame = 0;
    if (document.hidden || !centerVisible || motion.matches || userPaused || moduleOpen) { previous = 0; return; }
    if (previous) elapsed += Math.min((at - previous) / 1000, .1);
    previous = at; draw(); frame = requestAnimationFrame(animate);
  }
  function schedule() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0; previous = 0; draw();
    if (!document.hidden && centerVisible && !motion.matches && !userPaused && !moduleOpen && view) frame = requestAnimationFrame(animate);
  }
  function core(next) {
    state = next; document.body.dataset.coreState = next;
    byId('aiCoreStatus').textContent = coreLabels[next];
    if (view) view.setCoreState(next);
    draw();
  }
  function setupCore() {
    try {
      view = window.Studio3D.create(byId('aiRenderHost'));
      view.setCoreState(state);
      const resize = new ResizeObserver(() => { draw(); }); resize.observe(byId('aiRenderHost'));
      const visible = new IntersectionObserver(entries => { centerVisible = entries[0].isIntersecting; schedule(); }); visible.observe(byId('ai-main'));
      document.addEventListener('visibilitychange', schedule);
      motion.addEventListener('change', schedule);
      byId('aiMotion').addEventListener('click', () => {
        userPaused = !userPaused;
        byId('aiMotion').setAttribute('aria-pressed', String(userPaused));
        byId('aiMotion').textContent = userPaused ? '继续动态' : '暂停动态'; schedule();
      });
      window.addEventListener('pagehide', () => { if (frame) cancelAnimationFrame(frame); resize.disconnect(); visible.disconnect(); view.dispose(); }, { once:true });
      schedule();
    } catch (_) {
      byId('aiCoreFallback').hidden = false;
      byId('aiCoreHint').textContent = '3D 核心不可用；AI 对话不受影响';
      byId('aiMotion').disabled = true;
    }
  }
  function move(id, target) { const node = byId(id); if (node) byId(target).append(node); }
  function layout() {
    move('card-glm', 'ai-glm-slot'); move('card-oil', 'ai-oil-slot');
    ['card-bili','card-anth','card-arxiv','card-hw','card-github'].forEach(id => move(id, 'ai-feed-stack'));
    const calendar = document.querySelector('#aiLegacy .calpanel');
    if (calendar) byId('ai-calendar-slot').append(calendar);
    const duo = document.querySelector('#aiLegacy .duo');
    if (duo) {
      const columns = Array.from(duo.children);
      if (columns[0]) Array.from(columns[0].children).forEach(node => byId('ai-log-slot').append(node));
      if (columns[1]) byId('ai-weekly-slot').append(columns[1]);
    }
    const settings = byId('settings');
    if (settings) { settings.open = true; byId('aiSettingsSlot').append(settings); }
    ['atlMask','kbinMask','toast'].forEach(id => { const node = byId(id); if (node) document.body.append(node); });
    move('logoutBtn', 'aiAccountSlot');
    byId('logoutBtn').setAttribute('aria-label', '退出管理员登录');
    [['logText','工作记录内容'],['logDate','记录日期'],['logProject','记录所属项目'],['memoDate','备忘日期'],['memoText','备忘内容'],['wkStart','总结开始日期'],['wkEnd','总结结束日期']].forEach(([id,label]) => { const node=byId(id); if(node)node.setAttribute('aria-label',label); });
    byId('ai-shell').hidden = false; byId('aiGate').hidden = true;
    const hiddenBanner = byId('cfgBanner');
    if (hiddenBanner) {
      const hasKey = hiddenBanner.classList.contains('on');
      if (hasKey) status('工作台配置未完成，可在右上角设置中填写。');
    }
    document.querySelectorAll('[data-pane]').forEach(button => button.addEventListener('click', () => {
      const pane = button.dataset.pane;
      document.querySelector('.ai-cockpit').dataset.pane = pane;
      document.querySelectorAll('[data-pane]').forEach(item => item.setAttribute('aria-selected', String(item === button)));
      centerVisible = pane === 'core'; schedule();
    }));
    byId('aiSettings').addEventListener('click', () => byId('aiSettingsDialog').showModal());
    byId('aiSettingsClose').addEventListener('click', () => byId('aiSettingsDialog').close());
    byId('aiSettingsDialog').addEventListener('click', event => { if (event.target === byId('aiSettingsDialog')) byId('aiSettingsDialog').close(); });
    setupInfoBoard();window.dispatchEvent(new CustomEvent('workbench:layout'));setupModuleFocus();setupCore(); tick(); loadWeather(); checkModel();
    setInterval(tick, 1000); setInterval(() => { if (!document.hidden) loadWeather(); }, 15 * 60e3);
  }
  function setupInfoBoard() {
    const board = window.AiInfoBoard.create();
    window.addEventListener('pagehide', () => board.destroy(), { once:true });
  }
  function setupModuleFocus() {
    const focus = window.AiModuleFocus.create({
      onOpen: () => { moduleOpen = true;schedule(); },
      onClose: () => { moduleOpen = false;schedule(); },
    });
    const modules = [
      ['identity',document.querySelector('.ai-identity'),'个人信息与工坊入口'],
      ['weather',document.querySelector('.ai-clock'),'时钟与上海天气'],
      ['glm',byId('card-glm'),'GLM Coding Plan'],['oil',byId('card-oil'),'上海油价'],
      ['info',byId('aiInfoBoard'),'信息看板 · 五类资讯'],
      ['calendar',byId('ai-calendar-slot').querySelector('.calpanel'),'日历与当天详情'],
      ['logs',byId('ai-log-slot').querySelectorAll('.panel')[0],'工作记录'],
      ['memos',byId('ai-log-slot').querySelectorAll('.panel')[1],'备忘记事'],
      ['weekly',byId('ai-weekly-slot').querySelector('.panel'),'工作总结与周计划'],
    ];
    modules.forEach(([key,node,label]) => focus.register(key,node,label));
  }
  const TERM_NAMES = ['小寒','大寒','立春','雨水','惊蛰','春分','清明','谷雨','立夏','小满','芒种','夏至','小暑','大暑','立秋','处暑','白露','秋分','寒露','霜降','立冬','小雪','大雪','冬至'];
  function longitude(jde) {
    const t=(jde-2451545)/36525,l=280.46646+36000.76983*t+.0003032*t*t,m=(357.52911+35999.05029*t-.0001537*t*t)*Math.PI/180;
    const c=(1.914602-.004817*t-.000014*t*t)*Math.sin(m)+(.019993-.000101*t)*Math.sin(2*m)+.000289*Math.sin(3*m);
    return ((l+c-.00569-.00478*Math.sin((125.04-1934.136*t)*Math.PI/180))%360+360)%360;
  }
  function termTime(year,n) {
    let j=(Date.UTC(year,0,5)+n*15.2184*864e5)/864e5+2440587.5;
    for (let i=0;i<6;i++) j-=((longitude(j)-(285+15*n)+540)%360-180)/.98565;
    return (j-2440587.5)*864e5;
  }
  let termDay = '', termText = '';
  function season(now) {
    const key = new Date(now + 8*3600e3).toISOString().slice(0,10);
    if (key === termDay) return termText;
    const year = Number(key.slice(0,4)); let current = null, next = null;
    for (let y=year-1;y<=year+1;y++) for(let n=0;n<24;n++) {
      const at=termTime(y,n);
      if(at<=now){if(!current||at>current.at)current={at,name:TERM_NAMES[n]};}
      else if(!next||at<next.at)next={at,name:TERM_NAMES[n]};
    }
    const day = at => Math.floor((at+8*3600e3)/864e5);
    termDay = key; termText = current.name+' 第 '+(day(now)-day(current.at)+1)+' 天 · '+next.name+' 还有 '+(day(next.at)-day(now))+' 天';
    return termText;
  }
  function sun(now) {
    const date = new Date(now + 8*3600e3), year=date.getUTCFullYear(), n=Math.floor((Date.UTC(year,date.getUTCMonth(),date.getUTCDate())-Date.UTC(year,0,0))/864e5);
    const r=Math.PI/180, dec=r*23.44*Math.sin(r*(360/365)*(n-81));
    const cosine=(Math.sin(-.833*r)-Math.sin(31.23*r)*Math.sin(dec))/(Math.cos(31.23*r)*Math.cos(dec));
    const h=Math.acos(Math.max(-1,Math.min(1,cosine)))/r,b=r*(360/365)*(n-81),e=9.87*Math.sin(2*b)-7.53*Math.cos(b)-1.5*Math.sin(b),noon=720-4*(121.47-120)-e;
    const fmt = m => String(Math.floor(m/60)).padStart(2,'0')+':'+String(Math.floor(m%60)).padStart(2,'0');
    return '日出 '+fmt(noon-h*4)+' · 日落 '+fmt(noon+h*4);
  }
  function tick() {
    const now=Date.now(), date=new Date(now+8*3600e3),pad=n=>String(n).padStart(2,'0'),hour=date.getUTCHours();
    byId('aiClock').textContent=pad(hour)+':'+pad(date.getUTCMinutes())+':'+pad(date.getUTCSeconds());
    byId('aiDate').textContent=date.getUTCFullYear()+' 年 '+(date.getUTCMonth()+1)+' 月 '+date.getUTCDate()+' 日 · 周'+['日','一','二','三','四','五','六'][date.getUTCDay()];
    byId('aiGreet').textContent=(hour>=5&&hour<12?'Buenos días':hour<19?'Buenas tardes':'Buenas noches')+', Andres · '+(hour>=5&&hour<12?'早上好':hour<19?'下午好':'晚上好');
    byId('aiTerm').textContent=season(now);byId('aiSun').textContent=sun(now);
  }
  async function loadWeather() {
    try {
      const response=await fetch('/api/weather'), result=await response.json();
      if(!response.ok||!result.ok)throw new Error('unavailable');
      byId('aiTemp').textContent=result.data.temp+'°';byId('aiWeather').textContent=result.data.text+' · 体感 '+result.data.feelsLike+'°';
      byId('aiPlace').textContent='上海\n'+result.data.windDir+' '+result.data.windScale+' 级';
    }catch{byId('aiWeather').textContent='天气暂不可用';}
  }
  async function checkModel() {
    try {
      const response=await fetch('/api/workbench/ai/status'), data=await response.json();
      if(data.preview)byId('aiPreviewNote').textContent='本地隔离预览 · 数据为样例';
      if(!response.ok)throw new Error(response.status===401?'登录已失效，请重新登录。':'无法读取模型配置。');
      configured=!!data.configured;
      byId('aiConnection').classList.toggle('ready',configured && !data.preview);
      byId('aiConnection').lastChild.textContent=data.preview?'隔离预览':configured?'模型已配置':'未配置模型';
      status(data.preview?'隔离预览 · 对话接口已接入，真实模型调用和外部抓取已禁用。':configured?'已配置 '+data.model+' · 发送后由模型作答，未发送前不会调用。':'未配置对话模型。可在工作台设置 GLM Key，或由操作者配置独立服务端 AI 端点。');
      byId('aiChatSend').disabled=!configured;
    }catch(error){status(error.message,true);byId('aiChatSend').disabled=true;}
  }
  function message(role,text,failed) {
    byId('aiChatEmpty').hidden=true;
    const article=document.createElement('article'),name=document.createElement('div'),copy=document.createElement('p');
    article.className='ai-message '+role+(failed?' failed':'');name.className='byline';name.textContent=role==='user'?'TÚ · 你':'EL TALLER · AI';copy.textContent=text;
    article.append(name,copy);byId('aiTranscript').append(article);byId('aiTranscript').classList.add('has-messages');
    byId('aiTranscript').scrollTop=byId('aiTranscript').scrollHeight;
    document.body.classList.add('ai-has-chat');
  }
  function splitScheduleDraft(replyText) {
    const text=String(replyText||'');
    const match=text.match(/```json\s*(\{[\s\S]*?\})\s*```/);
    if(!match)return{display:text,draft:null};
    let draft=null;
    try{
      const parsed=JSON.parse(match[1]).schedule;
      if(parsed&&typeof parsed.title==='string'&&parsed.title.trim()&&/^\d{4}-\d{2}-\d{2}$/.test(parsed.date||''))
        draft={date:parsed.date,time:/^\d{1,2}:\d{2}$/.test(parsed.time||'')?parsed.time:'',title:parsed.title.trim().slice(0,200),cat:parsed.cat==='work'?'work':'life'};
    }catch(_){}
    return{display:(text.slice(0,match.index)+text.slice(match.index+match[0].length)).trim(),draft};
  }
  function scheduleCard(draft) {
    const card=document.createElement('div');card.className='ai-schedule-card';
    const label=document.createElement('span');label.className='ai-schedule-label';
    label.textContent='📅 草稿 · '+draft.date+(draft.time?' '+draft.time:'')+' · '+draft.title;
    const add=document.createElement('button');add.type='button';add.className='ai-schedule-add';add.textContent='添加到日历';
    const drop=document.createElement('button');drop.type='button';drop.className='ai-schedule-drop';drop.textContent='忽略';
    add.addEventListener('click',async()=>{
      add.disabled=true;add.textContent='正在添加…';
      try{
        const r=await fetch('/api/workbench/memos',{method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({text:(draft.time?draft.time+' ':'')+draft.title,date:draft.date,cat:draft.cat})});
        const data=await r.json();
        if(!r.ok||!data.ok)throw new Error(data.error||'HTTP '+r.status);
        label.textContent='📅 已加入日历 · '+draft.date+(draft.time?' '+draft.time:'')+' · '+draft.title;
        drop.hidden=true;add.hidden=true;window.dispatchEvent(new CustomEvent('workbench:memos-sync'));
      }catch(error){add.disabled=false;add.textContent='添加到日历';label.textContent='添加失败（'+error.message+'）· 📅 '+draft.date+(draft.time?' '+draft.time:'')+' · '+draft.title;}
    });
    drop.addEventListener('click',()=>card.remove());
    card.append(label,add,drop);
    return card;
  }
  async function send(event) {
    event.preventDefault();if(controller||!configured)return;
    const input=byId('aiChatInput'),question=input.value.trim();if(!question)return;
    if(question.length>8000){status('问题最多 8000 字。',true);return;}
    const sent=[...conversation,{role:'user',content:question}].slice(-12);
    message('user',question);input.value='';controller=new AbortController();const current=++requestId;
    byId('aiChatSend').disabled=true;byId('aiChatStop').hidden=false;core('thinking');status('正在等待真实模型回答…');
    try {
      const response=await fetch('/api/workbench/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,
        body:JSON.stringify({messages:sent,context:{dashboard:byId('aiContextDashboard').checked,work:byId('aiContextWork').checked}})});
      const data=await response.json();if(current!==requestId)return;
      if(!response.ok||!data.ok)throw new Error(data.error||'模型请求失败（HTTP '+response.status+'）');
      if(typeof data.reply!=='string'||!data.reply.trim())throw new Error('模型没有返回可显示的回答。');
      const {display,draft}=splitScheduleDraft(data.reply);
      conversation=[...sent,{role:'assistant',content:data.reply}].slice(-12);message('assistant',display||data.reply);core('speaking');
      if(draft){byId('aiTranscript').append(scheduleCard(draft));byId('aiTranscript').scrollTop=byId('aiTranscript').scrollHeight;}
      status('回答来自 '+data.model+' · 仅供参考；日程草稿需你确认后才会写入日历。');
      setTimeout(()=>{if(!controller&&current===requestId)core('idle');},2200);
    }catch(error){
      if(current!==requestId)return;
      if(error.name==='AbortError'){status('已停止等待，本次内容未写入对话上下文。');core('idle');}
      else{message('assistant',error.message,true);status(error.message,true);core('error');}
      if(!input.value)input.value=question;
    }finally{
      if(current===requestId){controller=null;byId('aiChatSend').disabled=!configured;byId('aiChatStop').hidden=true;}
    }
  }
  byId('aiChatForm').addEventListener('submit',send);
  byId('aiChatInput').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.isComposing){event.preventDefault();byId('aiChatForm').requestSubmit();}});
  byId('aiChatStop').addEventListener('click',()=>{if(controller)controller.abort();});
  byId('aiChatClear').addEventListener('click',()=>{
    if(controller)controller.abort();requestId++;controller=null;conversation=[];
    byId('aiTranscript').querySelectorAll('.ai-message,.ai-schedule-card').forEach(node=>node.remove());byId('aiChatEmpty').hidden=false;byId('aiTranscript').classList.remove('has-messages');
    byId('aiChatInput').value='';document.body.classList.remove('ai-has-chat');byId('aiChatSend').disabled=!configured;byId('aiChatStop').hidden=true;core('idle');status('本页对话已清空；本站不保存聊天记录，模型服务方的数据政策另行适用。');
  });
  window.addEventListener('workbench:config-saved',checkModel);
  window.addEventListener('pagehide',()=>{if(controller)controller.abort();},{once:true});
  window.addEventListener('workbench:load-error',event=>{
    const detail=event.detail||{};
    byId('aiGate').hidden=false;byId('aiGate').replaceChildren();
    const title=document.createElement('h1'),copy=document.createElement('p'),retry=document.createElement('button'),login=document.createElement('a');
    title.textContent='工作台暂未载入';copy.textContent=detail.message||'数据载入失败，请重试。';
    retry.type='button';retry.className='ai-retry-button';retry.textContent='重新载入';
    retry.addEventListener('click',()=>{retry.disabled=true;retry.textContent='正在重试…';window.dispatchEvent(new CustomEvent('workbench:retry'));});
    login.href='/login.html?next=%2Fai-workbench.html';login.textContent='重新登录';
    byId('aiGate').append(title,copy,retry);if(detail.status===401||detail.status===403)byId('aiGate').append(login);
  });
  window.addEventListener('workbench:ready',layout,{once:true});
  window.addEventListener('workbench:denied',event=>{
    byId('aiGate').innerHTML='';const title=document.createElement('h1'),copy=document.createElement('p'),link=document.createElement('a');
    title.textContent='AI 工作台仅管理员可用';copy.textContent=event.detail||'请使用管理员账号登录。';link.href='/login.html?next=%2Fai-workbench.html';link.textContent='前往登录';byId('aiGate').append(title,copy,link);
  },{once:true});
  window.addEventListener('workbench:boot-fail',event=>{
    const detail=event.detail||{};
    byId('aiConnection').lastChild.textContent='连接失败';
    byId('aiGate').hidden=false;byId('aiGate').replaceChildren();
    const title=document.createElement('h1'),copy=document.createElement('p'),retry=document.createElement('button');
    title.textContent='连接工坊失败';copy.textContent=detail.message||'启动请求超时或失败，请重试。';
    retry.type='button';retry.className='ai-retry-button';retry.textContent='刷新重试';
    retry.addEventListener('click',()=>location.reload());
    byId('aiGate').append(title,copy,retry);
  });
})();
