/* Fixed teaching scene; no model text is executed and no retrieval/model call is made. */
(function (root) {
  'use strict';
  const LINES = Object.freeze([
    '工作日 10:00–20:00 开放。', '周末 09:00–18:00 开放。',
    '预约请在前一日提交。', '每次预约最多两小时。',
    '前台可借用棋盘与桌游。', '出门时请归还门禁卡。'
  ]);
  const CHUNKS = Object.freeze([
    { id:'a', title:'开放时间', lines:[0,1,2], kind:'time' },
    { id:'b', title:'预约方式', lines:[2,3,4], kind:'booking' },
    { id:'c', title:'前台与门禁', lines:[4,5], kind:'other' }
  ]);
  const QUESTIONS = Object.freeze([
    { id:'closing', label:'周六几点关门？', order:['a','b','c'], evidence:['a'], answers:[{ text:'周六 18:00 关门。', chunk:'a', line:1 }], reason:'A 直接给出周末开放时间。C 虽然含“门”，却没有关门时间。' },
    { id:'booking', label:'周末几点开放、怎么预约？', order:['a','b','c'], evidence:['a','b'], answers:[{ text:'周末 09:00–18:00 开放。', chunk:'a', line:1 },{ text:'请在前一日预约，单次最多两小时。', chunk:'b', line:2 }], reason:'这个问题要两类证据：A 的开放时间，以及 B 的预约条件。' },
    { id:'refund', label:'取消后退多少钱？', order:['b','a','c'], evidence:[], answers:[], reason:'出现“预约”不等于写了“退费”。三张片段都没有金额或退费条件。' }
  ]);
  const STAGES = Object.freeze([
    { label:'看原文', title:'先有一份具体资料，不是一堆术语。', note:'左边是完整教学文件；右边的答案还没有依据，先不作答。' },
    { label:'看切块', title:'一份文档切成三张卡，边界处留住上下文。', note:'同色句子同时保留在相邻卡片中。重叠不是多写一遍结论，而是让片段独立阅读时不容易断意。' },
    { label:'看检索', title:'先找回候选，但“看起来相似”还不是答案。', note:'候选顺序是手工预设的教学反例，不是向量检索结果，也没有编造相似度分数。' },
    { label:'看重排', title:'按“能不能回答这个问题”，重新放好卡片。', note:'看前后排名，而不只看“重排”两个字。实际系统的排序由具体模型与数据决定。' },
    { label:'看依据', title:'每一句回答，都能沿连线回到证据。', note:'点击答案句子看它依赖哪张卡。换成退费问题，观察为什么没有可连接的依据。' }
  ]);
  function sceneState(stage, questionId) {
    const safeStage = Number.isInteger(stage) ? Math.max(0, Math.min(4, stage)) : 1;
    const question = QUESTIONS.find(q => q.id === questionId) || QUESTIONS[0];
    return { stage:safeStage, question, order:safeStage >= 3 ? [...question.order] : ['c','a','b'],
      hasEvidence:question.evidence.length > 0, answering:safeStage === 4 && question.evidence.length > 0 };
  }
  function mount(host, options = {}) {
    const doc = host.ownerDocument || root.document;
    const source = options.source || {};
    let stage = 1, questionId = 'closing', activeChunk = '', overlap = true, disposed = false;
    let resizeObserver = null, frame = 0;
    const els = {}, chunkNodes = new Map(), sourceLineNodes = [], sentenceNodes = [];
    function el(tag, cls, value) {
      const node = doc.createElement(tag);
      if (cls) node.className = cls;
      if (value !== undefined) node.textContent = value;
      return node;
    }
    function button(label, cls, handler) {
      const node = el('button', cls, label); node.type = 'button';
      node.addEventListener('click', handler); return node;
    }
    function svgNode(tag, attributes) {
      const node = doc.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attributes || {})) node.setAttribute(key, String(value));
      return node;
    }
    function textLine(index, cls) {
      const span = el('span', cls, LINES[index]);
      span.dataset.line = String(index);
      if (index === 2 || index === 4) span.classList.add(index === 2 ? 'rv-overlap-mint' : 'rv-overlap-gold');
      return span;
    }
    function stageCites() {
      const patterns = [/解析|清洗/,/切块|重叠/,/检索|TopK/,/重排|Cross-Encoder/,/生成|出处|拒答/];
      return (source.blocks || []).filter(b => patterns[stage].test(b.text || '')).slice(0, 3).map(b => b.id);
    }
    function sourceButton() {
      const node = button('这一步对应的章节证据 ↗', 'rv-evidence-link', () => {
        if (typeof options.onEvidence === 'function') options.onEvidence(stageCites());
      });
      node.hidden = !(source.blocks && source.blocks.length && typeof options.onEvidence === 'function');
      return node;
    }
    host.replaceChildren();
    host.classList.add('rag-visual');
    host.dataset.testid = 'rag-visual';
    host.setAttribute('aria-label', 'RAG 视觉实验台');
    const heading = el('header', 'rv-header');
    const titleBox = el('div');
    titleBox.append(el('span', 'rv-eyebrow', 'VER PARA ENTENDER · 看见，再理解'), el('h2', '', '一句答案，怎样找到它的依据？'));
    const badge = el('span', 'rv-demo-badge', '虚构教学场景 · 非模型运行');
    heading.append(titleBox, badge);
    const questions = el('div', 'rv-questions');
    questions.setAttribute('role', 'group'); questions.setAttribute('aria-label', '选择一个问题');
    questions.append(el('span', 'rv-question-label', '换个问题试试'));
    const questionButtons = QUESTIONS.map(q => {
      const node = button(q.label, 'rv-question', () => { questionId = q.id; stage = 4; activeChunk = ''; render(); });
      questions.append(node); return node;
    });
    const stageNav = el('div', 'rv-stage-nav');
    stageNav.setAttribute('role', 'group'); stageNav.setAttribute('aria-label', '观察资料变化');
    const stageButtons = STAGES.map((entry, i) => {
      const node = button('', 'rv-stage', () => { stage = i; activeChunk = ''; render(); });
      node.append(el('span', '', String(i + 1).padStart(2, '0')), el('b', '', entry.label));
      stageNav.append(node); return node;
    });
    const observation = el('div', 'rv-observation');
    els.stageTitle = el('h3'); els.stageNote = el('p');
    observation.append(els.stageTitle, els.stageNote);
    const board = el('div', 'rv-board'); els.board = board;
    const wires = svgNode('svg', { class:'rv-wires', 'aria-hidden':'true', focusable:'false' }); els.wires = wires;
    const sheetColumn = el('section', 'rv-sheet-column');
    const sheetLabel = el('div', 'rv-column-label');
    sheetLabel.append(el('span', '', '01 / 资料'), el('b', '', '整页文档'));
    const sheet = el('div', 'rv-paper');
    const paperIcon = svgNode('svg', { viewBox:'0 0 36 44', width:30, height:36, 'aria-hidden':'true' });
    paperIcon.append(svgNode('path', { d:'M3 1h20l10 10v31H3z M23 1v11h10 M9 20h18 M9 26h18 M9 32h12', fill:'none', stroke:'currentColor', 'stroke-width':1.7 }));
    const paperHead = el('div', 'rv-paper-head');
    paperHead.append(paperIcon, el('span', '', 'FILE 01 · 教学文件'));
    sheet.append(paperHead, el('h4', '', '活动室使用说明'), el('p', 'rv-paper-sub', '示意资料，不是真实场馆制度'));
    const paperLines = el('div', 'rv-paper-lines');
    LINES.forEach((line, i) => {
      const row = el('div', 'rv-paper-row');
      row.append(el('span', 'rv-line-number', String(i + 1).padStart(2, '0')), textLine(i, 'rv-source-line'));
      sourceLineNodes.push(row); paperLines.append(row);
    });
    sheet.append(paperLines, el('div', 'rv-paper-footer', '6 句资料 · 1 个源文件'));
    els.overlapLegend = el('p', 'rv-overlap-legend');
    els.overlapLegend.append(el('span', 'rv-legend-mint', '预约句：A ↔ B'), el('span', 'rv-legend-gold', '借用句：B ↔ C'));
    els.overlapToggle = button('对比：去掉重叠句', 'rv-overlap-toggle', () => { overlap = !overlap; render(); });
    sheetColumn.append(sheetLabel, sheet, els.overlapLegend, els.overlapToggle);
    const fragments = el('section', 'rv-fragments');
    const fragmentsLabel = el('div', 'rv-column-label');
    els.fragmentTitle = el('b', '', '三张片段卡');
    fragmentsLabel.append(el('span', '', '02 / 片段'), els.fragmentTitle);
    els.ranking = el('div', 'rv-ranking');
    els.chunkList = el('div', 'rv-chunk-list');
    els.chunkList.setAttribute('role', 'list'); els.chunkList.setAttribute('aria-label', '当前片段顺序');
    CHUNKS.forEach(chunk => {
      const card = el('div', 'rv-chunk rv-chunk-' + chunk.id);
      card.dataset.chunk = chunk.id; card.setAttribute('role', 'listitem');
      const header = el('div', 'rv-chunk-head');
      const id = el('span', 'rv-chunk-id', chunk.id.toUpperCase());
      const rank = el('span', 'rv-rank');
      header.append(id, el('strong', '', chunk.title), rank);
      const body = el('div', 'rv-chunk-lines');
      chunk.lines.forEach(i => {
        const line = textLine(i, 'rv-chunk-line');
        if (chunk.id === 'b' && i === 2 || chunk.id === 'c' && i === 4) line.classList.add('rv-shared-copy');
        body.append(line);
      });
      const verdict = el('span', 'rv-chunk-verdict');
      card.append(header, body, verdict);
      chunkNodes.set(chunk.id, { card, rank, verdict });
      els.chunkList.append(card);
    });
    els.reorderButton = button('按能否回答重排 ↓', 'rv-reorder-button', () => { stage = stage >= 3 ? 2 : 3; activeChunk = ''; render(); });
    fragments.append(fragmentsLabel, els.ranking, els.chunkList, els.reorderButton);
    const answerColumn = el('section', 'rv-answer-column');
    const answerLabel = el('div', 'rv-column-label');
    answerLabel.append(el('span', '', '03 / 回答'), el('b', '', '每句都要有依据'));
    els.answerBox = el('div', 'rv-answer-box');
    els.answerBox.setAttribute('aria-live', 'polite');
    answerColumn.append(answerLabel, els.answerBox);
    board.append(wires, sheetColumn, fragments, answerColumn);
    const controls = el('div', 'rv-controls');
    els.previous = button('← 前一步', 'rv-control', () => { stage = Math.max(0, stage - 1); activeChunk = ''; render(); });
    els.next = button('下一步 →', 'rv-control rv-control-primary', () => { stage = Math.min(4, stage + 1); activeChunk = ''; render(); });
    els.count = el('output', 'rv-count');
    controls.append(els.previous, els.count, els.next, button('重置场景', 'rv-reset', () => { stage = 1; questionId = 'closing'; activeChunk = ''; overlap = true; render(); }));
    const footer = el('div', 'rv-footer');
    footer.append(el('p', '', '文档、片段和候选顺序均为教学预设；不代表原章中的实验，也未执行真实检索。'), sourceButton());
    const equivalent = el('details', 'rv-equivalent');
    equivalent.append(el('summary', '', '阅读图中信息的文字说明'));
    const equivalentText = el('div');
    equivalentText.append(el('p', '', '原文件含开放时间、预约方式和门禁说明。A、B、C 三张卡在边界处重复保留预约句或借用句，让上下文不因切块完全丢失。'),
      el('p', '', '检索阶段预设候选为 C、A、B；重排后，能直接回答当前问题的卡优先。卡片顺序仅用于说明机制，不是实际算法输出。'),
      el('p', '', '周六关门时间由 A 支撑；周末预约问题由 A、B 共同支撑；退费问题没有对应条款，不生成金额结论。点击答案可看其来源连接。'));
    equivalent.append(equivalentText);
    host.append(heading, questions, stageNav, observation, board, controls, footer, equivalent);

    function drawWires() {
      if (disposed) return;
      wires.replaceChildren();
      if (stage !== 4 || !board.getBoundingClientRect || !sentenceNodes.length) return;
      const bounds = board.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      wires.setAttribute('viewBox', '0 0 ' + bounds.width + ' ' + bounds.height);
      sentenceNodes.forEach(({ node, chunk }) => {
        const sourceNode = chunkNodes.get(chunk).card;
        const a = sourceNode.getBoundingClientRect(), b = node.getBoundingClientRect();
        const desktop = b.left >= a.right - 2;
        const x1 = (desktop ? a.right : a.left + a.width * .5) - bounds.left;
        const y1 = (desktop ? a.top + a.height * .5 : a.bottom) - bounds.top;
        const x2 = (desktop ? b.left : b.left + b.width * .5) - bounds.left;
        const y2 = (desktop ? b.top + b.height * .5 : b.top) - bounds.top;
        const d = desktop ? 'M' + x1 + ' ' + y1 + ' C' + (x1 + 35) + ' ' + y1 + ',' + (x2 - 35) + ' ' + y2 + ',' + x2 + ' ' + y2
          : 'M' + x1 + ' ' + y1 + ' C' + (x1 - 18) + ' ' + (y1 + 22) + ',' + (x2 - 18) + ' ' + (y2 - 22) + ',' + x2 + ' ' + y2;
        wires.append(svgNode('path', { d, class:'rv-wire rv-wire-' + chunk + (activeChunk && activeChunk !== chunk ? ' rv-wire-dim' : '') }));
        wires.append(svgNode('circle', { cx:x2, cy:y2, r:3.5, class:'rv-wire-dot rv-wire-' + chunk }));
      });
    }
    function scheduleWires() {
      if (frame && root.cancelAnimationFrame) root.cancelAnimationFrame(frame);
      if (root.requestAnimationFrame) frame = root.requestAnimationFrame(drawWires);
      else drawWires();
    }
    function highlight(chunk) {
      activeChunk = chunk;
      chunkNodes.forEach((entry, id) => {
        entry.card.classList.toggle('rv-linked', !!chunk && id === chunk);
        entry.card.classList.toggle('rv-muted-link', !!chunk && id !== chunk);
      });
      sourceLineNodes.forEach((row, i) => row.classList.toggle('rv-line-linked', !!chunk && QUESTIONS.find(q => q.id === questionId).answers.some(a => a.chunk === chunk && (a.line === i || chunk === 'b' && i === 3))));
      sentenceNodes.forEach(entry => entry.node.classList.toggle('rv-sentence-active', entry.chunk === chunk));
      scheduleWires();
    }
    function renderAnswer(state) {
      sentenceNodes.splice(0);
      els.answerBox.replaceChildren();
      els.answerBox.classList.toggle('rv-answer-refused', stage === 4 && !state.hasEvidence);
      const question = el('div', 'rv-question-bubble');
      question.append(el('span', '', '你问'), el('strong', '', state.question.label));
      els.answerBox.append(question);
      if (stage < 4) {
        const pending = el('div', 'rv-pending');
        const icon = svgNode('svg', { viewBox:'0 0 80 80', width:76, height:76, 'aria-hidden':'true' });
        icon.append(svgNode('rect', { x:14, y:12, width:50, height:56, rx:9, fill:'none', stroke:'currentColor', 'stroke-width':1.7, 'stroke-dasharray':'4 5' }));
        icon.append(svgNode('path', { d:'M26 29h26 M26 39h21 M26 49h15', fill:'none', stroke:'currentColor', 'stroke-width':2.4, 'stroke-linecap':'round' }));
        pending.append(icon, el('b', '', stage < 2 ? '先准备资料，不急着回答' : stage === 2 ? '候选已到，还要核对依据' : '证据已排好，下一步连到答案'), el('span', '', '答案不会因为文字流畅，就自动有依据。'));
        els.answerBox.append(pending);
      } else if (!state.hasEvidence) {
        const missing = el('div', 'rv-missing');
        const icon = svgNode('svg', { viewBox:'0 0 100 66', width:100, height:66, 'aria-hidden':'true' });
        icon.append(svgNode('path', { d:'M4 33h32 M65 33h30', fill:'none', stroke:'currentColor', 'stroke-width':2, 'stroke-dasharray':'5 5' }));
        icon.append(svgNode('path', { d:'M44 24l13 18 M57 24L44 42', fill:'none', stroke:'currentColor', 'stroke-width':2.5 }));
        missing.append(icon, el('strong', '', '没有退费条款'), el('p', '', '资料没有说明退费金额或条件，无法据此回答。'), el('span', 'rv-no-claim', '不编一个金额 · 请求补充对应条款'));
        els.answerBox.append(missing);
      } else {
        els.answerBox.append(el('span', 'rv-answer-kicker', '有依据的回答 · 点句子看连线'));
        state.question.answers.forEach(answer => {
          const sentence = button('', 'rv-answer-sentence rv-answer-' + answer.chunk, () => highlight(activeChunk === answer.chunk ? '' : answer.chunk));
          const q = el('span', 'rv-answer-text', answer.text);
          sentence.append(q, el('span', 'rv-answer-ref', '依据 ' + answer.chunk.toUpperCase()));
          sentence.setAttribute('aria-label', answer.text + ' 查看依据片段 ' + answer.chunk.toUpperCase());
          sentence.addEventListener('focus', () => highlight(answer.chunk));
          sentence.addEventListener('pointerenter', () => highlight(answer.chunk));
          sentenceNodes.push({ node:sentence, chunk:answer.chunk }); els.answerBox.append(sentence);
        });
        els.answerBox.append(el('p', 'rv-answer-foot', '连线表示：这一句由哪条教学资料支持。不是模型的隐藏思考过程。'));
      }
    }
    function render() {
      if (disposed) return;
      const state = sceneState(stage, questionId);
      host.dataset.stage = String(stage); host.dataset.question = questionId;
      host.dataset.evidence = String(state.hasEvidence);
      host.dataset.overlap = String(overlap);
      stageButtons.forEach((node, i) => node.setAttribute('aria-pressed', String(i === stage)));
      questionButtons.forEach((node, i) => node.setAttribute('aria-pressed', String(QUESTIONS[i].id === questionId)));
      els.stageTitle.textContent = STAGES[stage].title;
      els.stageNote.textContent = stage >= 3 ? state.question.reason : STAGES[stage].note;
      els.fragmentTitle.textContent = stage < 2 ? '三张相邻片段' : stage === 2 ? '先找回候选' : '按问题核对证据';
      els.overlapLegend.hidden = stage !== 1;
      els.overlapToggle.hidden = stage !== 1;
      els.overlapToggle.setAttribute('aria-pressed', String(overlap));
      els.overlapToggle.textContent = overlap ? '对比：去掉重叠句' : '对比：保留重叠句';
      chunkNodes.forEach(entry => entry.card.querySelectorAll('.rv-shared-copy').forEach(node => { node.hidden = stage === 1 && !overlap; }));
      els.ranking.replaceChildren();
      if (stage >= 2) {
        els.ranking.append(el('span', '', '原候选 C → A → B'), el('b', '', stage >= 3 ? '核对后 ' + state.order.map(id => id.toUpperCase()).join(' → ') : '尚未重排'));
      }
      els.ranking.hidden = stage < 2;
      els.chunkList.style.setProperty('--rv-pitch', stage >= 3 ? '184px' : '166px');
      CHUNKS.forEach((chunk, i) => {
        const entry = chunkNodes.get(chunk.id);
        const position = stage < 2 ? i : state.order.indexOf(chunk.id);
        entry.card.style.setProperty('--rv-position', String(position));
        entry.card.classList.toggle('rv-candidate', stage >= 2);
        entry.card.classList.toggle('rv-supports', stage >= 3 && state.question.evidence.includes(chunk.id));
        entry.card.classList.toggle('rv-no-support', stage >= 3 && !state.question.evidence.includes(chunk.id));
        entry.rank.textContent = stage < 2 ? '片段 ' + chunk.id.toUpperCase() : '#' + (position + 1);
        entry.verdict.textContent = stage < 3 ? '' : state.question.evidence.includes(chunk.id) ? '✓ 直接支持这次回答' : '没有这次问题所需的条款';
        entry.verdict.hidden = stage < 3;
        // DOM reading order matches the visual ranking as well as the animated positions.
        entry.card.setAttribute('aria-posinset', String(position + 1)); entry.card.setAttribute('aria-setsize', '3');
      });
      const domOrder = stage < 2 ? CHUNKS.map(c => c.id) : state.order;
      domOrder.forEach(id => els.chunkList.append(chunkNodes.get(id).card));
      els.reorderButton.hidden = stage < 2 || stage === 4;
      els.reorderButton.textContent = stage >= 3 ? '还原候选顺序 ↑' : '按能否回答重排 ↓';
      els.previous.disabled = stage === 0; els.next.disabled = stage === 4;
      els.count.textContent = (stage + 1) + ' / 5';
      renderAnswer(state); highlight(activeChunk); scheduleWires();
    }
    stageNav.addEventListener('keydown', event => {
      let next = stage;
      if (event.key === 'ArrowRight') next = Math.min(4, stage + 1);
      else if (event.key === 'ArrowLeft') next = Math.max(0, stage - 1);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = 4;
      else return;
      event.preventDefault(); stage = next; activeChunk = ''; render(); stageButtons[next].focus();
    });
    els.chunkList.addEventListener('transitionend', event => { if (event.propertyName === 'transform') scheduleWires(); });
    if (root.ResizeObserver) { resizeObserver = new root.ResizeObserver(scheduleWires); resizeObserver.observe(board); }
    if (root.addEventListener) root.addEventListener('resize', scheduleWires);
    render();
    return function destroy() {
      disposed = true;
      if (resizeObserver) resizeObserver.disconnect();
      if (frame && root.cancelAnimationFrame) root.cancelAnimationFrame(frame);
      if (root.removeEventListener) root.removeEventListener('resize', scheduleWires);
      host.replaceChildren();
    };
  }
  const api = { mount, sceneState, LINES, CHUNKS, QUESTIONS, STAGES };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TallerRagVisual = api;
})(typeof window !== 'undefined' ? window : globalThis);
