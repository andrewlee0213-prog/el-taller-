/* One information board, retaining each source's original nodes, actions and cached content. */
(function (root) {
  'use strict';
  function create({ document:doc = root.document, Observer = root.MutationObserver } = {}) {
    const board=doc.getElementById('aiInfoBoard'),stack=doc.getElementById('ai-feed-stack');
    const search=doc.getElementById('aiInfoSearch'),count=doc.getElementById('aiInfoCount'),empty=doc.getElementById('aiInfoEmpty');
    const clear=doc.getElementById('aiInfoSearchClear');
    const buttons=Array.from(board.querySelectorAll('[data-info-filter]'));
    const definitions=[['bili','card-bili','biliBody'],['anth','card-anth','anthBody'],['arxiv','card-arxiv','arxivBody'],['hw','card-hw','hwBody'],['github','card-github','githubBody']];
    const sources=definitions.map(([key,id,bodyId])=>({key,node:doc.getElementById(id),body:doc.getElementById(bodyId)})).filter(source=>source.node&&source.body);
    let selected='all',disposed=false,observer=null;
    const normalize=value=>String(value||'').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
    function rows(source) { return Array.from(source.body.querySelectorAll(source.key==='hw'?'.hw-link':'.item')); }
    function searchable(node) {
      const copy=node.cloneNode(true);
      copy.querySelectorAll('button,input,textarea,select,.cbox').forEach(item=>item.remove());
      return normalize(copy.textContent);
    }
    function render() {
      if(disposed)return;
      const query=normalize(search.value);let all=0,shown=0,hasSummary=false;
      if(clear)clear.hidden=!search.value;
      sources.forEach(source=>{
        source.node.dataset.infoSource=source.key;
        const items=rows(source);all+=items.length;
        const badge=board.querySelector('[data-info-count="'+source.key+'"]');if(badge)badge.textContent=String(items.length);
        let matches=0;
        items.forEach(item=>{
          const match=!query||searchable(item).includes(query);
          item.hidden=!match;if(match)matches++;
        });
        const summary=source.key==='hw'&&source.body.querySelector('.hw-sum');
        const summaryMatch=!!(summary&&searchable(summary)&&(!query||searchable(summary).includes(query)));
        const sourceMatches=!query||matches>0||summaryMatch;
        source.node.hidden=(selected!=='all'&&selected!==source.key)||!sourceMatches;
        if(!source.node.hidden){shown+=matches;hasSummary=hasSummary||summaryMatch;}
      });
      const allBadge=board.querySelector('[data-info-count="all"]');if(allBadge)allBadge.textContent=String(all);
      count.textContent=query?'匹配 '+shown+' / '+all+' 条':selected==='all'?'五类来源 · '+all+' 条':'当前 '+shown+' / '+all+' 条';
      empty.hidden=shown>0||hasSummary;
      empty.textContent=query?'没有匹配的资讯，可切换来源或清空搜索。':all===0?'暂无资讯，等待工作台数据更新。':'当前来源暂无资讯，可查看其他来源。';
      stack.dataset.filter=selected;
      buttons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.infoFilter===selected)));
    }
    const filters=board.querySelector('.ai-info-filters');
    function filter(event) {
      const button=event.target.closest('[data-info-filter]');
      if(!button||!filters.contains(button))return;
      selected=button.dataset.infoFilter;
      if(!['all',...sources.map(source=>source.key)].includes(selected))selected='all';
      render();
    }
    function clearSearch(){search.value='';render();search.focus();}
    filters.addEventListener('click',filter);search.addEventListener('input',render);clear?.addEventListener('click',clearSearch);
    if(Observer){observer=new Observer(render);sources.forEach(source=>observer.observe(source.body,{childList:true,subtree:true,characterData:true}));}
    render();
    function destroy(){disposed=true;observer?.disconnect();filters.removeEventListener('click',filter);search.removeEventListener('input',render);clear?.removeEventListener('click',clearSearch);sources.forEach(source=>{source.node.hidden=false;rows(source).forEach(item=>{item.hidden=false;});});}
    return Object.freeze({ render,destroy });
  }
  root.AiInfoBoard=Object.freeze({create});
  if(typeof module==='object'&&module.exports)module.exports=root.AiInfoBoard;
})(typeof globalThis!=='undefined'?globalThis:this);
