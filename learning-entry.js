(function () {
  'use strict';
  var labels = {
    queued: '等待处理', running: '正在整理', draft: '学习稿待核对', approved: '图解学习',
    stale: '原内容已更新', failed: '整理未完成', interrupted: '处理已中断', empty: '生成学习稿'
  };
  function mount(container, query, options) {
    if (!container) return function () {};
    var controller = new AbortController();
    var stopped = false;
    container.replaceChildren();
    container.hidden = true;
    function get(url) {
      return fetch(url, { signal: controller.signal }).then(function (res) {
        if (!res.ok) throw new Error('unavailable');
        return res.json();
      });
    }
    function addLink(text, href, hint) {
      if (stopped) return;
      var row = document.createElement('div');
      row.className = 'learning-entry-row';
      var a = document.createElement('a');
      a.className = 'learning-entry-link';
      a.textContent = text + ' →';
      a.href = href;
      row.appendChild(a);
      if (hint) {
        var detail = document.createElement('span');
        detail.className = 'learning-entry-hint';
        detail.textContent = hint;
        row.appendChild(detail);
      }
      container.appendChild(row);
      container.hidden = false;
    }
    if (options && options.hardware) {
      addLink('比较学习', '/learning.html?hardware=1', '选择图鉴中的设备，按同一维度比较');
    } else {
      get('/api/learning/sources?' + new URLSearchParams(query).toString()).then(async function (data) {
        if (!data.ok || stopped) return;
        for (var source of data.sources || []) {
          if (!source.sourceRef) continue;
          if (source.sourceRef.kind === 'hardware') {
            addLink('比较学习', '/learning.html?hardware=1', '按能力与使用部位筛选，不做无依据排名');
            continue;
          }
          var encoded = encodeURIComponent(JSON.stringify(source.sourceRef));
          var status = await get('/api/learning/status?source=' + encoded);
          if (!status.ok || stopped) continue;
          var state = status.state || 'empty';
          if (!data.admin && state !== 'approved') continue;
          var doc = status.document;
          var href = state === 'approved' && doc && doc.id
            ? '/learning.html?id=' + encodeURIComponent(doc.id)
            : '/learning.html?source=' + encoded;
          addLink(labels[state] || '查看学习稿', href,
            state === 'approved' ? '图解、分步理解与原文证据' : '手动整理，确认前仅管理员可见');
        }
      }).catch(function () {});
    }
    return function () {
      stopped = true;
      controller.abort();
      container.replaceChildren();
      container.hidden = true;
    };
  }
  window.TallerLearningEntry = { mount: mount };
})();
