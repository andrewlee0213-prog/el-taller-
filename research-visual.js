/* Evidence-bound research charts. No packages, network, generated markup or model execution. */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory);
  else root.TallerResearchVisual = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const mounted = new WeakMap();
  let nextId = 0;
  const object = value => !!value && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
  const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value);
  const identifier = value => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,127}$/.test(value);
  const number = (value, min, max) => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
  const integer = (value, min, max) => number(value, min, max) && Number.isInteger(value);
  const fmt = value => String(Math.round(value * 100) / 100);
  const pct = value => fmt(value) + '%';
  const signed = value => (value > 0 ? '+' : value < 0 ? '−' : '') + fmt(Math.abs(value));

  /** Pure shape/semantic guard; never fills missing results with case constants. */
  function validate(component) {
    const errors = [];
    function check(ok, path) { if (!ok) errors.push(path); }
    if (!object(component)) return { ok:false, errors:['component'] };
    check(component.type === 'research-study', 'type');
    check(component.origin === 'source', 'origin');
    check(component.caseId === 'agents-judgment-calls', 'caseId');
    check(component.caseVersion === 1 || component.caseVersion === '1', 'caseVersion');
    check(text(component.title, 300), 'title');
    const evidence = Array.isArray(component.evidence) ? component.evidence : [];
    check(evidence.length > 0 && evidence.length <= 100, 'evidence');
    const ids = new Set(), blocks = new Set();
    evidence.slice(0, 100).forEach((entry, i) => {
      if (!object(entry)) { errors.push('evidence.' + i); return; }
      check(identifier(entry.id) && !ids.has(entry.id), 'evidence.' + i + '.id');
      check(identifier(entry.blockId), 'evidence.' + i + '.blockId');
      check(text(entry.quote, 6000), 'evidence.' + i + '.quote');
      ids.add(entry.id); blocks.add(entry.blockId);
    });
    function cites(metric, path) {
      const value = metric.cites;
      check(Array.isArray(value) && value.length > 0 && value.length <= 24 &&
        value.every(id => identifier(id) && blocks.has(id)) && new Set(value).size === value.length, path + '.cites');
    }
    const p = component.participants;
    if (!object(p)) errors.push('participants');
    else {
      check(integer(p.recruited, 1, 500), 'participants.recruited');
      check(integer(p.used, 1, 500), 'participants.used');
      check(integer(p.declined, 0, 500), 'participants.declined');
      check(integer(p.used, 1, 500) && integer(p.declined, 0, 500) && p.used + p.declined === p.recruited, 'participants.total');
      check(p.allocation === 'self-selected', 'participants.allocation'); cites(p, 'participants');
    }
    const r = component.randomization;
    if (!object(r)) errors.push('randomization');
    else {
      check(r.unit === 'analyst-decision', 'randomization.unit');
      check(integer(r.decisions, 1, 20), 'randomization.decisions');
      check(integer(r.decisions, 1, 20) && integer(r.analyticalChoices, 1, 20) &&
        r.analyticalChoices <= r.decisions, 'randomization.analyticalChoices'); cites(r, 'randomization');
    }
    const a = component.alignment;
    if (!object(a)) errors.push('alignment');
    else {
      check(number(a.value, 0, 100), 'alignment.value');
      check(number(a.baseline, 0, 100), 'alignment.baseline');
      check(a.unit === 'percent', 'alignment.unit');
      check(a.baselineType === 'theoretical-null', 'alignment.baselineType');
      check(text(a.population, 500), 'alignment.population');
      check(a.denominator === null, 'alignment.denominator'); cites(a, 'alignment');
    }
    const s = component.switching;
    if (!object(s)) errors.push('switching');
    else {
      check(number(s.against, 0, 100), 'switching.against');
      check(number(s.agrees, 0, 100), 'switching.agrees');
      check(integer(s.totalCases, 1, 10000), 'switching.totalCases');
      check(s.caseUnit === 'decision-situations', 'switching.caseUnit');
      check(s.unit === 'percent', 'switching.unit');
      check(s.groupSizes === null, 'switching.groupSizes');
      check(number(s.delta, -100, 100) && number(s.against, 0, 100) && number(s.agrees, 0, 100) &&
        Math.abs(s.against - s.agrees - s.delta) < 0.011, 'switching.delta');
      if (!object(s.ci)) errors.push('switching.ci');
      else {
        check(number(s.ci.level, 0.01, 100), 'switching.ci.level');
        check(number(s.ci.lower, -100, 100) && number(s.ci.upper, -100, 100) &&
          s.ci.lower <= s.delta && s.delta <= s.ci.upper, 'switching.ci.range');
        check(s.ci.unit === 'percentage-points', 'switching.ci.unit');
      }
      cites(s, 'switching');
    }
    check(Array.isArray(component.limitations) && component.limitations.length > 0 && component.limitations.length <= 16 &&
      component.limitations.every(value => text(value, 1500)), 'limitations');
    return { ok:errors.length === 0, errors };
  }

  /** mount(host, component, { onEvidence(blockIds), source? }) -> idempotent destroy(). */
  function mount(host, component, options) {
    if (!host || !host.ownerDocument || typeof host.append !== 'function') throw new TypeError('ResearchStudyVisual: invalid host');
    const result = validate(component);
    if (!result.ok) {
      const error = new TypeError('ResearchStudyVisual: invalid component (' + result.errors.join(', ') + ')');
      error.validationErrors = result.errors.slice(); throw error;
    }
    // Project only validated data. Payload styling, URLs, attributes and extra fields never enter DOM APIs.
    const p = { recruited:component.participants.recruited, used:component.participants.used,
      declined:component.participants.declined, cites:component.participants.cites.slice() };
    const r = { decisions:component.randomization.decisions, analyticalChoices:component.randomization.analyticalChoices,
      cites:component.randomization.cites.slice() };
    const a = { value:component.alignment.value, baseline:component.alignment.baseline, population:component.alignment.population,
      cites:component.alignment.cites.slice() };
    const s = { against:component.switching.against, agrees:component.switching.agrees,
      totalCases:component.switching.totalCases, delta:component.switching.delta, cites:component.switching.cites.slice(),
      ci:{ level:component.switching.ci.level, lower:component.switching.ci.lower, upper:component.switching.ci.upper } };
    const limitations = component.limitations.slice();
    const onEvidence = options && typeof options.onEvidence === 'function' ? options.onEvidence : null;
    const doc = host.ownerDocument, prefix = 'rsv-' + (++nextId) + '-';
    const listeners = [];
    let disposed = false;
    const previous = mounted.get(host); if (previous) previous();
    function el(tag, cls, value) {
      const node = doc.createElement(tag);
      if (cls) node.className = cls;
      if (value !== undefined) node.textContent = String(value);
      return node;
    }
    function svg(tag, attributes, value) {
      const node = doc.createElementNS(SVG_NS, tag);
      for (const key of Object.keys(attributes || {})) node.setAttribute(key, String(attributes[key]));
      if (value !== undefined) node.textContent = String(value);
      return node;
    }
    function button(label, cls, handler) {
      const node = el('button', cls, label); node.type = 'button';
      if (handler) { node.addEventListener('click', handler); listeners.push([node, handler]); }
      return node;
    }
    function evidence(citations, label) {
      const node = button('查看原文证据 ↗', 'rsv-evidence', () => {
        if (!disposed && onEvidence) onEvidence(citations.slice());
      });
      node.setAttribute('aria-label', label + '：查看原文证据');
      if (!onEvidence) { node.disabled = true; node.textContent = '原文引用已记录 · 抽屉未连接'; }
      return node;
    }
    function figure(key, index, title, subtitle, citations) {
      const node = el('figure', 'rsv-figure rsv-' + key);
      node.setAttribute('aria-labelledby', prefix + key);
      const caption = el('figcaption', 'rsv-caption');
      const heading = el('div', 'rsv-caption-copy');
      const h = el('h3', '', title); h.id = prefix + key;
      heading.append(el('span', 'rsv-section-no', index + ' / ' + subtitle), h);
      caption.append(heading, evidence(citations, title)); node.append(caption);
      return node;
    }
    function chart(width, height, cls) {
      return svg('svg', { viewBox:'0 0 ' + width + ' ' + height, class:'rsv-chart ' + cls, 'aria-hidden':'true', focusable:'false' });
    }
    function metric(value, unit, label, cls) {
      const node = el('div', 'rsv-metric ' + (cls || ''));
      const headline = el('div', 'rsv-metric-line'); headline.append(el('strong', '', value), el('span', '', unit));
      node.append(headline, el('span', 'rsv-metric-label', label)); return node;
    }
    function note(value, cls) { return el('p', 'rsv-note ' + (cls || ''), value); }
    function legend(value, cls) {
      const node = el('span', 'rsv-legend-item');
      node.append(el('i', 'rsv-swatch ' + cls), el('span', '', value)); return node;
    }
    const root = el('section', 'research-study-visual');
    root.setAttribute('aria-labelledby', prefix + 'title'); root.setAttribute('data-testid', 'research-study-visual');
    const header = el('header', 'rsv-header');
    const headerCopy = el('div', 'rsv-header-copy');
    const title = el('h2', '', component.title); title.id = prefix + 'title';
    headerCopy.append(el('span', 'rsv-eyebrow', 'EVIDENCIA · 从数字读懂研究'), title,
      el('p', 'rsv-deck', '把「谁参加」「随机了什么」「能说明什么」分开看。'));
    const provenance = el('div', 'rsv-provenance');
    provenance.append(el('span', 'rsv-case-badge', '真实案例 · 人工整理'), el('span', '', '原文摘录 · 完整性未确认'),
      el('span', '', onEvidence ? '数据引用可查 · 各图可回原文' : '数据附有引用 · 抽屉未连接'));
    header.append(headerCopy, provenance); root.append(header);

    // 01 — Each dot encodes one recruit, not a simulated decision or individual trajectory.
    const recruitment = figure('participants', '01', '先看参与者，再看随机化', '人 ≠ 决定', p.cites);
    const recruitmentBody = el('div', 'rsv-recruitment-body');
    const sample = el('div', 'rsv-sample');
    const sampleHead = el('div', 'rsv-sample-head');
    sampleHead.append(metric(fmt(p.recruited), '人', '招募的分析师'), el('span', 'rsv-mini-label', '每一点 = 1 名参与者'));
    const columns = 13, rows = Math.ceil(p.recruited / columns), pitch = 24;
    const dots = chart(336, rows * pitch + 10, 'rsv-dots');
    for (let i = 0; i < p.recruited; i++) dots.append(svg('circle', {
      cx:20 + (i % columns) * pitch, cy:16 + Math.floor(i / columns) * pitch, r:7,
      class:i < p.used ? 'rsv-dot-used' : 'rsv-dot-declined'
    }));
    const split = chart(336, 20, 'rsv-split');
    split.append(svg('rect', { x:0, y:3, width:336, height:14, rx:7, class:'rsv-track' }));
    split.append(svg('rect', { x:0, y:3, width:336 * p.used / p.recruited, height:14, rx:7, class:'rsv-fill-used' }));
    const sampleLegend = el('div', 'rsv-legend');
    sampleLegend.append(legend(fmt(p.used) + ' 人使用 · ' + pct(p.used / p.recruited * 100), 'rsv-used'),
      legend(fmt(p.declined) + ' 人未使用 · ' + pct(p.declined / p.recruited * 100), 'rsv-declined'));
    sample.append(sampleHead, dots, split, sampleLegend,
      note('是否使用 agent：自行选择，不是随机 AI 分组。', 'rsv-caution'));
    const randomized = el('div', 'rsv-randomized');
    const randomHead = el('div', 'rsv-random-head');
    const coin = chart(70, 70, 'rsv-coin');
    coin.append(svg('circle', { cx:35, cy:35, r:29, class:'rsv-coin-face' }),
      svg('line', { x1:35, x2:35, y1:14, y2:56, class:'rsv-coin-divider' }),
      svg('text', { x:23, y:42, 'text-anchor':'middle', class:'rsv-coin-text' }, '+'),
      svg('text', { x:48, y:42, 'text-anchor':'middle', class:'rsv-coin-text' }, '−'));
    randomHead.append(coin, metric('× ' + fmt(r.decisions), '项决定', '每名分析师 · 每项单独随机'));
    randomized.append(el('span', 'rsv-kicker', '随机的是 agent 的倾向'), randomHead);
    const leans = el('div', 'rsv-leans');
    for (let i = 0; i < r.decisions; i++) {
      const item = el('div', 'rsv-lean');
      item.append(el('span', 'rsv-lean-index', '决定 ' + (i + 1)), el('b', '', '+ / −'));
      leans.append(item);
    }
    const decisionNames = r.decisions === 5 && r.analyticalChoices === 4
      ? '结果指标 · 比较方法 · 估计覆盖范围 · 加权方式；另含最终建议。'
      : '其中 ' + fmt(r.analyticalChoices) + ' 项是分析选择，其余为其它决定。';
    randomized.append(leans, note(decisionNames),
      note('± 只示意两种倾向；不是本页重跑实验，也不是某个人的真实分配。', 'rsv-mechanism-note'),
      evidence(r.cites, 'agent 倾向的随机化'));
    recruitmentBody.append(sample, randomized); recruitment.append(recruitmentBody);
    recruitment.append(note('人数口径：招募 ' + fmt(p.recruited) + ' 人，' + fmt(p.used) + ' 人选择使用，' + fmt(p.declined) + ' 人未使用；随机化单位是「分析师 × 决定」。', 'rsv-equivalent'));
    root.append(recruitment);

    // 02 — Measured aggregate percentage versus a theoretical reference, never a control-group result.
    const alignment = figure('alignment', '02', '有多少分析选择，与 agent 倾向一致？', '选择 ≠ 人', a.cites);
    const alignmentBody = el('div', 'rsv-alignment-body');
    const readout = el('div', 'rsv-alignment-readout');
    readout.append(metric(fmt(a.value), '%', '实测：选择与 agent 倾向一致', 'rsv-observed-metric'),
      el('p', 'rsv-population', a.population), note('一致选择数 / 全部选择数：精确计数未披露。'));
    const alignmentPlot = el('div', 'rsv-alignment-plot');
    const bar = chart(600, 148, 'rsv-alignment-chart');
    const x = value => 18 + value * 5.64;
    bar.append(svg('rect', { x:18, y:43, width:564, height:40, rx:6, class:'rsv-track' }),
      svg('rect', { x:18, y:43, width:a.value * 5.64, height:40, rx:6, class:'rsv-fill-used rsv-observed-bar' }),
      svg('line', { x1:x(a.baseline), x2:x(a.baseline), y1:28, y2:91, class:'rsv-baseline' }),
      svg('text', { x:x(a.baseline), y:17, 'text-anchor':a.baseline < 15 ? 'start' : a.baseline > 85 ? 'end' : 'middle', class:'rsv-reference-label' }, pct(a.baseline) + ' 理论基线'));
    [0, 25, 50, 75, 100].forEach(value => {
      bar.append(svg('line', { x1:x(value), x2:x(value), y1:94, y2:99, class:'rsv-axis-tick' }),
        svg('text', { x:x(value), y:119, 'text-anchor':value === 0 ? 'start' : value === 100 ? 'end' : 'middle', class:'rsv-tick-text' }, String(value)));
    });
    bar.append(svg('text', { x:582, y:142, 'text-anchor':'end', class:'rsv-tick-text' }, '一致率（%）· 原点 0'));
    const comparisonLegend = el('div', 'rsv-legend rsv-alignment-legend');
    comparisonLegend.append(legend(pct(a.value) + ' 实测一致率', 'rsv-used'), legend(pct(a.baseline) + ' 理论零假设', 'rsv-reference'));
    alignmentPlot.append(bar, comparisonLegend, note('虚线不是「未使用 AI」组的观测结果。', 'rsv-caution'));
    alignmentBody.append(readout, alignmentPlot); alignment.append(alignmentBody);
    const interpretation = el('div', 'rsv-interpretation');
    const prompt = el('h4', '', '我该怎么理解 ' + pct(a.value) + '？');
    const choices = el('div', 'rsv-interpretation-choices'); choices.setAttribute('role', 'group'); choices.setAttribute('aria-label', '辨别一致率的口径');
    const feedback = el('p', 'rsv-feedback', '这是「选择的一致率」，不是「被改变的人占比」。');
    feedback.id = prefix + 'feedback'; feedback.setAttribute('aria-live', 'polite'); feedback.setAttribute('aria-atomic', 'true');
    const choiceButtons = [];
    function choose(index) {
      if (disposed) return;
      choiceButtons.forEach((node, i) => node.setAttribute('aria-pressed', String(i === index)));
      alignmentPlot.setAttribute('data-focus', index === 0 ? 'observed' : 'reference');
      feedback.textContent = index === 0
        ? '对，' + pct(a.value) + ' 是 ' + fmt(r.analyticalChoices) + ' 项分析选择合并后的一致率。没有给出多少人的立场被改变。'
        : '不能这样读：一致可能包括原本就同意；改变偏好要单独看下一图。' + pct(a.baseline) + ' 也只是理论参照，不是对照组实测值。';
    }
    const correct = button('分析选择与倾向的一致率', 'rsv-choice', () => choose(0));
    const incorrect = button(pct(a.value) + ' 的人被改变了？', 'rsv-choice', () => choose(1));
    [correct, incorrect].forEach(node => { node.setAttribute('aria-pressed', 'false'); node.setAttribute('aria-describedby', feedback.id); choiceButtons.push(node); choices.append(node); });
    interpretation.append(prompt, choices, feedback); alignment.append(interpretation,
      note('数字口径：' + a.population + '，实测一致率 ' + pct(a.value) + '；理论零假设参照 ' + pct(a.baseline) + '。精确分子、分母未披露，不能换算为人数。', 'rsv-equivalent'));
    root.append(alignment);

    // 03 — Conditional comparisons and a separate percentage-point confidence-interval plot.
    const switching = figure('switching', '03', '先表态之后，什么时候改变选择？', '决策情形 ≠ 人', s.cites);
    const scope = el('div', 'rsv-switch-scope');
    scope.append(el('strong', '', fmt(s.totalCases) + ' 个决策情形'),
      el('span', '', '分析师已先表达偏好 · 不是 ' + fmt(s.totalCases) + ' 人 · 两子组 n 未披露'));
    switching.append(scope);
    const switchingBody = el('div', 'rsv-switching-body');
    const rates = el('div', 'rsv-rates'); rates.append(el('h4', '', '改变原偏好的比例'));
    const rateLabels = ['agent 反对原偏好', 'agent 同意原偏好'];
    [s.against, s.agrees].forEach((value, i) => {
      const row = el('div', 'rsv-rate-row');
      const label = el('div', 'rsv-rate-label');
      label.append(el('span', '', rateLabels[i]), el('strong', '', pct(value)));
      const rowChart = chart(500, 28, 'rsv-rate-chart');
      rowChart.append(svg('rect', { x:12, y:2, width:476, height:24, rx:4, class:'rsv-track' }),
        svg('rect', { x:12, y:2, width:value * 4.76, height:24, rx:4, class:i === 0 ? 'rsv-fill-against' : 'rsv-fill-agrees' }));
      row.append(label, rowChart); rates.append(row);
    });
    const rateAxis = chart(500, 43, 'rsv-rate-axis');
    [0, 25, 50, 75, 100].forEach(value => rateAxis.append(svg('text', {
      x:value * 4.76 + 12, y:16, 'text-anchor':value === 0 ? 'start' : value === 100 ? 'end' : 'middle', class:'rsv-tick-text'
    }, String(value))));
    // The tick inset is mirrored by the padded rate frame, so both bars share an honest zero origin.
    rateAxis.append(svg('text', { x:488, y:39, 'text-anchor':'end', class:'rsv-tick-text' }, '改变比例（%）· 原点 0'));
    rates.append(rateAxis, note('两根条分别是条件比例，不是同一人的前后配对，也不代表两组等大。'));
    const interval = el('div', 'rsv-interval');
    interval.append(el('h4', '', '两比例之差 · 单独看不确定性'));
    const intervalReadout = el('div', 'rsv-interval-readout');
    intervalReadout.append(metric(signed(s.delta), 'pp', '反对时比例 − 同意时比例'),
      el('p', '', pct(s.ci.level) + ' CI：' + fmt(s.ci.lower) + '–' + fmt(s.ci.upper) + ' pp'));
    const ci = chart(500, 114, 'rsv-ci-chart');
    const ciX = value => 20 + (value + 100) * 2.3;
    ci.append(svg('line', { x1:20, x2:480, y1:60, y2:60, class:'rsv-ci-axis' }),
      svg('line', { x1:ciX(0), x2:ciX(0), y1:29, y2:73, class:'rsv-zero-line' }),
      svg('line', { x1:ciX(s.ci.lower), x2:ciX(s.ci.upper), y1:45, y2:45, class:'rsv-ci-range' }));
    [s.ci.lower, s.ci.upper].forEach(value => ci.append(svg('line', { x1:ciX(value), x2:ciX(value), y1:35, y2:55, class:'rsv-ci-cap' })));
    ci.append(svg('circle', { cx:ciX(s.delta), cy:45, r:7, class:'rsv-ci-point' }));
    [-100, -50, 0, 50, 100].forEach(value => {
      ci.append(svg('line', { x1:ciX(value), x2:ciX(value), y1:60, y2:67, class:'rsv-axis-tick' }),
        svg('text', { x:ciX(value), y:88, 'text-anchor':value === -100 ? 'start' : value === 100 ? 'end' : 'middle', class:'rsv-tick-text' }, signed(value)));
    });
    ci.append(svg('text', { x:480, y:111, 'text-anchor':'end', class:'rsv-tick-text' }, '比例差（百分点 / pp）· 0 = 无差异'));
    interval.append(intervalReadout, ci, note('点 = 比例差；线 = ' + pct(s.ci.level) + ' 置信区间。不是给两根条各加误差线。'));
    switchingBody.append(rates, interval); switching.append(switchingBody);
    const causal = el('p', 'rsv-causal');
    causal.append(el('strong', '', '相关比较，不是已确证因果。'),
      el('span', '', '先表态者可能存在系统性差异；样本少，区间较宽。'));
    switching.append(causal, note('数字口径：' + fmt(s.totalCases) + ' 个先表达偏好的决策情形中，agent 反对时改变比例为 ' + pct(s.against) +
      '，同意时为 ' + pct(s.agrees) + '；差 ' + fmt(s.delta) + ' 个百分点，' + pct(s.ci.level) + ' CI 为 ' + fmt(s.ci.lower) + '–' + fmt(s.ci.upper) +
      ' 个百分点。两子组人数及精确计数未披露，不能推算改变了多少人。', 'rsv-equivalent'));
    root.append(switching);
    const boundaries = el('footer', 'rsv-boundaries');
    boundaries.append(el('h3', '', '这份图解的边界'));
    const list = el('ul'); limitations.forEach(value => list.append(el('li', '', value)));
    boundaries.append(list, note('只呈现人工整理的研究数据；原文摘录未确认完整。图上引用可回查，不代表本页进行了实验或模型调用。'));
    root.append(boundaries); host.append(root);
    function destroy() {
      if (disposed) return;
      disposed = true;
      listeners.forEach(([node, handler]) => node.removeEventListener('click', handler));
      listeners.length = 0;
      if (root.parentNode === host) host.removeChild(root);
      if (mounted.get(host) === destroy) mounted.delete(host);
    }
    mounted.set(host, destroy);
    return destroy;
  }
  return Object.freeze({ mount, validate });
}));
