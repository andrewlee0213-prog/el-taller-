/* El Aula: no dependencies, no automatic generation, no model text interpreted as markup. */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const asText = (value, max = 12000) => (typeof value === 'string' || typeof value === 'number') ? String(value).slice(0, max) : '';
  const list = (value, max = 160) => Array.isArray(value) ? value.slice(0, max) : [];
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const pad = n => String(n).padStart(2, '0');
  const kindNames = { kb:'RAG · 知识层', dala:'Dala · 设计标本', hardware:'Equipo · 设备对照', article:'Investigación · 研究摘录' };
  const coverageNames = { chapter:'所选章节', 'selected-chapters':'所选 4 章 · 非全书', 'selected-devices':'手动选择的设备', excerpt:'缓存原文摘录 · 非全文' };
  const stateNames = { empty:'尚未整理', queued:'已排队', running:'整理中', draft:'草稿 · 待确认', approved:'已确认', stale:'来源已变化', failed:'生成失败', interrupted:'任务中断', unverified:'状态待核对' };
  const componentNames = { flow:'Mapa · 流程', steps:'Paso a paso · 分步', quiz:'Comprueba · 自测', tokens:'Muestras · 标本', contrast:'Contraste · 对照', comparison:'Comparar · 比较', cards:'Notas · 要点' };
  const activeStates = new Set(['queued', 'running']);
  const themes = ['naranja','oceano','bosque','crepusculo','bermellon','castana','jaspe','perla','blanco','negro'];
  const S = {
    target:null, source:null, document:null, job:null, state:'empty', currentSourceHash:'',
    catalog:[], devices:[], selected:new Set(), catalogLoaded:false, catalogError:'', inputError:'', managementKey:'',
    meAdmin:false, apiAdmin:null, authenticated:null, epoch:0, statusSequence:0, renderedKey:'',
    writing:false, loading:false, disposed:false, pollTimer:0, pollPaused:false, pollFailures:0,
    pollInFlight:false, themeTimer:0, requestGroups:new Map(), dialogFocus:new Map(),
    pendingHardware:false
  };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = asText(text);
    return node;
  }
  function button(text, className, handler) {
    const node = el('button', className, text);
    node.type = 'button';
    if (handler) node.addEventListener('click', handler);
    return node;
  }
  function setText(id, text) { $(id).textContent = asText(text); }
  function show(id, visible) { $(id).hidden = !visible; }
  function isAdmin() { return S.apiAdmin === null ? S.meAdmin : S.apiAdmin; }
  function processing() { return activeStates.has(S.state); }
  function learnError(message, status, code) {
    const error = new Error(asText(message || '读取失败，请稍后重试。', 800));
    error.status = status || 0;
    error.code = code || '';
    return error;
  }
  function messageOf(error) {
    if (typeof error === 'string') return asText(error, 800);
    if (object(error)) return asText(error.message || error.error, 800) || '操作失败，请稍后重试。';
    return '操作失败，请稍后重试。';
  }
  function notice(text) {
    setText('pageMessage', text);
    show('pageMessage', !!text);
  }
  function abortGroup(group) {
    const controllers = S.requestGroups.get(group);
    if (controllers) controllers.forEach(controller => controller.abort());
  }
  function abortAll() { S.requestGroups.forEach(controllers => controllers.forEach(controller => controller.abort())); }
  async function api(path, options = {}, group = 'read') {
    const controller = new AbortController();
    if (!S.requestGroups.has(group)) S.requestGroups.set(group, new Set());
    S.requestGroups.get(group).add(controller);
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, options.method === 'POST' ? 30000 : 20000);
    try {
      const response = await fetch(path, {
        credentials:'same-origin', cache:'no-store', redirect:'error', ...options,
        headers:{ Accept:'application/json', ...(options.body ? { 'Content-Type':'application/json' } : {}), ...(options.headers || {}) },
        signal:controller.signal
      });
      let data;
      try { data = await response.json(); }
      catch (_) { throw learnError('接口没有返回可读取的资料，可能登录已过期或服务尚未就绪。', response.status); }
      if (!response.ok || !object(data) || data.ok === false) {
        const detail = object(data) ? data.error : '';
        throw learnError(messageOf(detail || (response.status === 401 ? '请先登录。' : '读取失败，请稍后重试。')), response.status, object(data) ? data.code || (object(detail) && detail.code) : '');
      }
      return data;
    } catch (error) {
      if (error.name === 'AbortError' && !timedOut) throw error;
      if (timedOut) throw learnError('请求超时。请刷新状态确认结果，不会自动重发生成请求。', 0, 'timeout');
      if (error instanceof TypeError) throw learnError('连接暂时不可用，请稍后刷新状态。');
      throw error;
    } finally {
      clearTimeout(timer);
      S.requestGroups.get(group).delete(controller);
    }
  }
  function acceptAdmin(data) {
    if (typeof data.admin === 'boolean') S.apiAdmin = data.admin;
    show('roleBadge', isAdmin());
  }
  function validId(value) { return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value); }
  function safeHref(value, sameOrigin = false) {
    if (typeof value !== 'string' || !value.trim() || value.length > 2400 || /[\u0000-\u001f\u007f]/.test(value)) return '';
    try {
      const url = new URL(value, location.href);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || (sameOrigin && url.origin !== location.origin)) return '';
      return url.href;
    } catch (_) { return ''; }
  }
  function normalizeRef(value) {
    if (!object(value)) return null;
    if (value.kind === 'kb' && value.bookId === 'agent-handbook' && value.chapterId === 'ch4') {
      return { kind:'kb', bookId:'agent-handbook', chapterId:'ch4' };
    }
    if (value.kind === 'dala') return { kind:'dala' };
    if (value.kind === 'hardware' && Array.isArray(value.deviceIds) && value.deviceIds.length <= 3 && value.deviceIds.every(validId) && new Set(value.deviceIds).size === value.deviceIds.length) {
      return { kind:'hardware', deviceIds:[...value.deviceIds].sort() };
    }
    if (value.kind === 'article') {
      const url = safeHref(value.url);
      if (url) return { kind:'article', url };
    }
    return null;
  }
  function readTarget() {
    const params = new URLSearchParams(location.search);
    if (params.has('source')) {
      const raw = params.get('source');
      if (!raw || raw.length > 10000) throw learnError('来源参数无效。请重新从材料入口进入。');
      let value;
      try { value = JSON.parse(raw); } catch (_) { throw learnError('来源参数不是有效的 JSON。请重新选择材料。'); }
      const ref = normalizeRef(value);
      if (!ref) throw learnError('当前来源不在可用范围，请从下方材料中选择。');
      return { sourceRef:ref };
    }
    if (params.has('id')) {
      const id = params.get('id');
      if (!validId(id)) throw learnError('学习稿编号无效，请从材料入口重新打开。');
      return { docId:id };
    }
    if (params.get('hardware') === '1') return { hardware:true };
    // The explicit source contract is preferred; these are safe conveniences for original-page links.
    if (params.has('url')) {
      const ref = normalizeRef({ kind:'article', url:params.get('url') });
      if (!ref) throw learnError('文章地址无效，只支持安全的 HTTP / HTTPS 来源。');
      return { sourceRef:ref };
    }
    if (params.get('b') === 'agent-handbook' && ['4', 'ch4'].includes(params.get('c'))) return { sourceRef:{ kind:'kb', bookId:'agent-handbook', chapterId:'ch4' } };
    if (params.get('b') === 'dala-design') return { sourceRef:{ kind:'dala' } };
    return null;
  }
  function historyTarget(target, replace = false) {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    if (target && target.docId) url.searchParams.set('id', target.docId);
    else if (target && target.sourceRef) url.searchParams.set('source', JSON.stringify(target.sourceRef));
    else if (target && target.hardware) url.searchParams.set('hardware', '1');
    history[replace ? 'replaceState' : 'pushState'](null, '', url.pathname + url.search);
  }
  function sourceRef() { return normalizeRef(S.source && S.source.sourceRef) || (S.target && S.target.sourceRef) || null; }
  function coverageText(source) {
    if (!source) return '';
    if (source.kind === 'article') return '缓存原文摘录 · 完整性未验证，非全文';
    return coverageNames[source.coverage] || '来源摘录 · 覆盖范围未说明';
  }
  function defaultTitle(ref) {
    return ref ? ({ kb:'RAG：从文档到有依据的回答', dala:'Dala · 设计语言标本', hardware:'设备观察 · 同源对照', article:'研究阅读 · 证据与边界' }[ref.kind] || '图解学习') : '把知识，展开来看。';
  }
  function sourceReturnUrl() {
    const href = safeHref(S.source && S.source.returnUrl, true);
    if (href) return href;
    const ref = sourceRef();
    if (!ref) return 'kb.html';
    if (ref.kind === 'kb') return 'kb.html#b=agent-handbook&c=4';
    if (ref.kind === 'dala') return 'kb.html#b=dala-design&c=0';
    if (ref.kind === 'hardware') return 'kb.html#b=hw-devices&c=0';
    return 'reader.html?url=' + encodeURIComponent(ref.url);
  }
  function fact(term, value) {
    if (!value) return;
    $('sourceFacts').append(el('dt', '', term), el('dd', '', value));
  }
  function formatDate(value) {
    if (!value) return '';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString('zh-CN', { year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
  }
  function renderSource() {
    const source = S.source, ref = sourceRef();
    setText('sourceTitle', source ? source.title : defaultTitle(ref));
    const count = list(source && source.blocks).length;
    setText('sourceCoverage', source ? coverageText(source) + ' · ' + count + ' 个证据片段' : '仅在当前原文范围内学习，不会主动生成。');
    $('returnSource').href = sourceReturnUrl();
    $('openEvidence').disabled = !count;
    $('sourceFacts').replaceChildren();
    fact('覆盖范围', coverageText(source));
    fact('覆盖说明', source && source.coverageDetail);
    if (source && source.completeness === 'unverified') fact('完整性', '未验证；不把缓存 full 标记视作全文证明');
    fact('原文 hash', source && source.hash);
    if (S.currentSourceHash && S.currentSourceHash !== (source && source.hash)) fact('当前来源 hash', S.currentSourceHash);
    fact('获取时间', formatDate(source && (source.capturedAt || source.cachedAt)));
    fact('学习稿来源 hash', S.document && S.document.sourceHash);
    fact('学习稿 ID', S.document && S.document.id);
    $('changeSource').disabled = S.writing;
  }
  function canApprove() {
    const doc = S.document, source = S.source;
    return !!(isAdmin() && doc && source && S.state === 'draft' && doc.state === 'draft' &&
      typeof doc.sourceHash === 'string' && /^[a-f0-9]{64}$/i.test(doc.sourceHash) &&
      doc.sourceHash === source.hash && (!S.currentSourceHash || S.currentSourceHash === doc.sourceHash));
  }
  function generatorLabel(generator) {
    if (!object(generator)) return '生成方式未说明';
    if (generator.type === 'curated') return '人工整理模板 · 非 AI 生成';
    if (generator.type === 'deterministic') return '确定性来源整理 · 非 AI 生成';
    if (generator.type === 'model') return '模型生成' + (generator.model ? ' · ' + asText(generator.model, 100) : '');
    return '生成方式未说明';
  }
  function renderStatus() {
    const state = S.state, admin = isAdmin(), ref = sourceRef();
    const kind = S.source && S.source.kind || ref && ref.kind;
    const badge = $('stateBadge');
    badge.className = 'badge badge-' + (Object.hasOwn(stateNames, state) ? state : 'empty');
    badge.textContent = S.loading && !S.source ? '读取中' : stateNames[state] || '状态待核对';
    setText('statusSourceKind', kindNames[kind] || 'Aprender con evidencia');
    const copy = {
      empty:admin ? ['材料已就绪，从整理开始', '原文与学习稿分开保存。首次进入可以没有学习稿；请手动选择下方整理方式。'] : ['还没有可公开阅读的学习稿', '普通读者只会看到已确认且与当前原文一致的学习稿。你仍可回到原文阅读。'],
      queued:['已加入手动整理队列', '任务由你刚才的操作提交。页面只刷新状态，不会额外调用模型。'],
      running:['正在整理这份材料', '生成结果会先保存为草稿。完成后请对照证据核查，不会自动发布。'],
      draft:['待确认的学习草稿', '仅管理员可预览。原文摘录、来源释义和教学示例需要分别核查，草稿不等于已审核。'],
      approved:['已确认的学习页', '这份学习稿已由管理员确认。图解帮助理解，引用让你随时回到原文。'],
      stale:['原文已变化，请重新整理', '下方若仍展示旧稿及旧证据，均为历史快照，不代表当前原文。当前稿件不能批准，也不会自动重新生成。'],
      failed:['本次整理没有完成', '未把失败结果替换成已审核内容。可先核对错误与来源，再手动重试。'],
      interrupted:['任务中断，等待手动恢复', '可能发生服务重启。系统不会自行再次调用模型；管理员可明确选择重试。']
    };
    const chosen = S.loading && !S.source ? ['正在打开学习材料', '核对原文和学习稿状态，不会自动生成。'] : copy[state] || ['正在核对学习稿状态', '状态暂不明确，请手动刷新，不会自动生成。'];
    setText('statusTitle', chosen[0]);
    setText('statusText', chosen[1]);
    $('statusPanel').setAttribute('aria-busy', String(S.loading || processing() || S.writing));
    const compact = !!(S.document && ['draft', 'approved'].includes(state));
    $('statusPanel').classList.toggle('status-compact', compact);
    const managementKey = (S.document && S.document.id || '') + '|' + compact;
    if (S.managementKey !== managementKey) {
      S.managementKey = managementKey;
      $('managementControls').open = !compact;
    }
    show('managementControls', admin);
    const jobError = S.job && S.job.error;
    const jobText = jobError ? messageOf(jobError) : S.job && !compact ? '任务 ' + asText(S.job.id, 100) + (S.job.attempt ? ' · 第 ' + asText(S.job.attempt, 8) + ' 次尝试' : '') : '';
    setText('jobMessage', jobText);
    show('jobMessage', !!jobText);
    const hasSource = !!(ref && S.source && !S.source.needsSelection && S.source.generationAllowed !== false);
    const allowActions = admin && hasSource;
    // Only the server can offer a reviewed case bound to this exact source version.
    const curated = allowActions && kind === 'kb';
    const reviewedCase = allowActions && kind === 'article' && object(S.source.curatedCase) &&
      S.source.curatedCase.sourceHash === S.source.hash;
    const deterministic = allowActions && ['dala', 'hardware'].includes(kind);
    const model = allowActions && ['kb', 'article'].includes(kind);
    show('generateCurated', curated);
    show('generateCase', reviewedCase);
    show('generateDeterministic', deterministic);
    show('generateModel', model);
    show('retryJob', admin && !!S.job && validId(S.job.id) && ['failed', 'interrupted'].includes(state));
    show('generationActions', curated || reviewedCase || deterministic || model || (!$('retryJob').hidden));
    ['generateCurated', 'generateCase', 'generateDeterministic', 'generateModel', 'retryJob'].forEach(id => { $(id).disabled = S.writing || S.loading || processing(); });
    let generationNote = '';
    if (admin && S.source && S.source.generationAllowed === false) generationNote = '当前缓存原文不足以可靠整理。请先在原文入口补充材料，本页不自动抓取或补写。';
    else if (reviewedCase) generationNote = '真实研究案例由人工核验数字与引句，仅这版缓存可创建；不调用模型、不自动批准。其他文章不会套用这套研究结果。';
    else if (curated) generationNote = '“查看整理样板”仅按原文模板整理，不调用模型；“AI生成学习稿”需你确认后才按需调用本站现有 GLM。两者均先保存为草稿。';
    else if (deterministic) generationNote = '按已有来源字段确定性整理，不调用模型，不补写缺失的规格或设计值。结果仍需管理员确认。';
    else if (model) generationNote = '只基于可用缓存摘录生成，不宣称全文解读；点击后需再次确认调用现有 GLM，结果为待核查草稿。';
    setText('generationNote', generationNote);
    show('generationNote', !!generationNote);
    show('approvalBox', canApprove());
    $('approveDocument').disabled = S.writing || S.loading || !$('reviewConfirm').checked || !canApprove();
    $('reviewConfirm').disabled = S.writing || S.loading;
    setText('approvalHint', S.writing ? '正在提交确认，请勿重复点击。' : '确认前，普通读者不可见。');
    $('refreshStatus').disabled = S.writing || S.loading;
    show('togglePolling', processing());
    setText('togglePolling', S.pollPaused ? '继续刷新' : '暂停刷新');
    show('loginLink', S.authenticated === false);
    const next = location.pathname + location.search;
    $('loginLink').href = 'login.html?next=' + encodeURIComponent(next);
    show('roleBadge', admin);
  }

  function renderPicker() {
    const target = sourceRef();
    $('sourceChoices').replaceChildren();
    list(S.catalog, 20).forEach((candidate, index) => {
      const ref = normalizeRef(candidate.sourceRef);
      if (!ref) return;
      const choice = button('', 'source-choice', () => {
        if (S.writing) return;
        if (ref.kind === 'hardware' && !ref.deviceIds.length) openHardware(true);
        else activate({ sourceRef:ref }, true);
      });
      choice.disabled = S.writing;
      choice.append(el('span', 'choice-no', pad(index + 1) + ' / ' + (kindNames[ref.kind] || 'ORIGEN')),
        el('strong', '', candidate.label || defaultTitle(ref)),
        el('small', '', candidate.coverageDetail || coverageText(candidate)),
        el('span', 'choice-foot', ref.kind === 'hardware' ? '手动选择 1–3 台 →' : '打开学习页 →'));
      $('sourceChoices').append(choice);
    });
    let message = S.inputError || S.catalogError;
    if (!message) message = S.catalogLoaded ? (S.catalog.length ? '选择只读取材料；已有的已确认学习稿可直接阅读。' : '当前没有可用材料。可先回书库查看原文。') : '正在读取可用材料…';
    setText('catalogMessage', message);
    show('reloadCatalog', !!S.catalogError);
    show('closePicker', !!S.target && !S.pendingHardware);
    if (target && target.kind === 'hardware' && !S.selected.size) refIdsIntoSelection(target);
    renderDevices();
  }
  function refIdsIntoSelection(ref) {
    if (ref && ref.kind === 'hardware') S.selected = new Set(ref.deviceIds);
  }
  function renderDevices() {
    const host = $('deviceList');
    host.replaceChildren();
    list(S.devices, 500).forEach(device => {
      if (!object(device) || !validId(device.id)) return;
      const label = el('label', 'device-option');
      const input = el('input');
      input.type = 'checkbox';
      input.value = device.id;
      input.checked = S.selected.has(device.id);
      input.disabled = S.writing || (S.selected.size >= 3 && !input.checked);
      input.addEventListener('change', () => {
        if (input.checked && S.selected.size < 3) S.selected.add(device.id);
        else { S.selected.delete(device.id); input.checked = false; }
        updateDeviceControls();
      });
      const text = el('span');
      text.append(el('strong', '', device.name || '未命名设备'), el('small', '', device.cat || '未分类'));
      label.append(input, text);
      host.append(label);
    });
    updateDeviceControls();
  }
  function updateDeviceControls() {
    const count = S.selected.size;
    setText('deviceCount', count + ' / 3');
    setText('deviceHint', !S.devices.length ? '暂无可选设备，请先在图鉴中维护设备记录。' : count === 3 ? '已选 3 台，可取消后替换。不会自动挑选或排序推荐。' : count ? '已选 ' + count + ' 台；查看只读取状态，不会自动生成。' : '至少选 1 台，最多 3 台。');
    $('applyDevices').disabled = S.writing || count < 1 || count > 3;
    $('deviceList').querySelectorAll('input').forEach(input => { input.disabled = S.writing || (count >= 3 && !input.checked); });
  }
  async function loadCatalog() {
    abortGroup('catalog');
    S.catalogError = '';
    S.catalogLoaded = false;
    renderPicker();
    try {
      const data = await api('/api/learning/sources', {}, 'catalog');
      if (S.disposed) return;
      acceptAdmin(data);
      S.catalog = list(data.sources, 20).filter(row => object(row) && normalizeRef(row.sourceRef));
      S.devices = list(data.devices, 500).filter(row => object(row) && validId(row.id));
      S.catalogLoaded = true;
      renderPicker();
      renderStatus();
    } catch (error) {
      if (error.name === 'AbortError' || S.disposed) return;
      S.catalogLoaded = true;
      S.catalogError = messageOf(error);
      if (error.status === 401) S.authenticated = false;
      renderPicker();
      renderStatus();
    }
  }
  function showPicker() {
    if (S.writing) return;
    show('sourcePicker', true);
    show('closePicker', !!S.target);
    renderPicker();
    $('pickerTitle').tabIndex = -1;
    $('pickerTitle').focus({ preventScroll:true });
    $('sourcePicker').scrollIntoView({ block:'start' });
  }
  function openHardware(updateHistory) {
    if (S.writing) return;
    if (updateHistory) historyTarget({ hardware:true });
    resetSession();
    S.target = null;
    S.pendingHardware = true;
    show('lessonShell', false);
    show('sourcePicker', true);
    show('hardwarePicker', true);
    setText('lessonTitle', '把设备放在一起看。');
    setText('lessonGoal', '从图鉴已有记录出发，手动选择最多 3 台；不把未记录当作不具备。');
    document.title = '设备对照 · El Aula · El Taller';
    renderPicker();
    $('hardwareTitle').tabIndex = -1;
    if (updateHistory) { $('hardwareTitle').focus({ preventScroll:true }); $('hardwarePicker').scrollIntoView({ block:'start' }); }
  }
  const researchDisposers = [];
  function clearResearchVisuals() {
    researchDisposers.splice(0).forEach(dispose => dispose());
    document.documentElement.classList.remove('lesson-study-visual');
  }
  let disposeRagVisual = null;
  function clearRagVisual() {
    if (disposeRagVisual) disposeRagVisual();
    disposeRagVisual = null;
    $('ragVisual').replaceChildren();
    show('ragVisual', false);
    document.documentElement.classList.remove('lesson-rag-visual');
  }
  function resetSession() {
    clearRagVisual();
    clearResearchVisuals();
    S.epoch++;
    clearPoll();
    abortGroup('status');
    abortGroup('job');
    S.source = null;
    S.document = null;
    S.job = null;
    S.state = 'empty';
    S.currentSourceHash = '';
    S.renderedKey = '';
    S.managementKey = '';
    S.loading = false;
    S.pollPaused = false;
    S.pollFailures = 0;
    S.pendingHardware = false;
    $('reviewConfirm').checked = false;
    $('components').replaceChildren();
    show('lessonDocument', false);
    notice('');
    closeDialog($('evidenceDialog'));
    closeDialog($('modelDialog'));
  }
  async function activate(target, push = false) {
    if (S.writing) return;
    if (target && (target.hardware || (target.sourceRef && target.sourceRef.kind === 'hardware' && !target.sourceRef.deviceIds.length))) {
      openHardware(push);
      return;
    }
    if (push) historyTarget(target);
    resetSession();
    S.target = target;
    show('sourcePicker', !target);
    show('hardwarePicker', false);
    show('lessonShell', !!target);
    const ref = target && target.sourceRef;
    refIdsIntoSelection(ref);
    setText('lessonTitle', defaultTitle(ref));
    setText('lessonGoal', target ? '读取原文与学习稿状态；所有生成都需要你明确点击。' : '从原文出发，看清关系、逐步推演，再用一道小题检查理解。');
    document.title = 'El Aula · 图解学习 · El Taller';
    renderPicker();
    if (!target) return;
    renderSource();
    await loadStatus();
    if (push && !S.disposed) { $('lessonTitle').tabIndex = -1; $('lessonTitle').focus({ preventScroll:true }); }
  }
  function statusPath() {
    if (!S.target) return '';
    if (S.target.docId) return '/api/learning/' + encodeURIComponent(S.target.docId);
    const ref = sourceRef();
    return ref ? '/api/learning/status?source=' + encodeURIComponent(JSON.stringify(ref)) : '';
  }
  async function loadStatus({ quiet = false } = {}) {
    if (!S.target || S.disposed || document.hidden) return;
    const epoch = S.epoch, sequence = ++S.statusSequence;
    const path = statusPath();
    if (!path) return;
    abortGroup('status');
    S.loading = true;
    if (!quiet) notice('');
    renderStatus();
    try {
      const data = await api(path, {}, 'status');
      if (epoch !== S.epoch || sequence !== S.statusSequence || S.disposed) return;
      S.loading = false;
      applyStatus(data);
      return true;
    } catch (error) {
      if (epoch !== S.epoch || sequence !== S.statusSequence || S.disposed || error.name === 'AbortError') return;
      S.loading = false;
      if (error.status === 401) S.authenticated = false;
      // Fail closed: a failed fresh read is not proof that approval is still safe.
      $('reviewConfirm').checked = false;
      if (S.state === 'draft') S.state = 'unverified';
      clearPoll();
      notice(messageOf(error));
      renderStatus();
      return false;
    } finally {
      if (epoch === S.epoch && sequence === S.statusSequence && !S.disposed) {
        S.loading = false;
        renderStatus();
      }
    }
  }
  function applyStatus(data) {
    acceptAdmin(data);
    if (!object(data.source)) throw learnError('接口缺少原文来源，未展示学习稿。');
    const previousIdentity = S.document && S.document.id;
    S.source = data.source;
    S.document = object(data.document) ? data.document : null;
    S.job = object(data.job) ? data.job : null;
    S.currentSourceHash = asText(data.currentSourceHash, 128);
    S.state = asText(data.state, 32) || 'empty';
    if (previousIdentity !== (S.document && S.document.id)) $('reviewConfirm').checked = false;
    if (S.currentSourceHash && S.currentSourceHash !== S.source.hash) S.state = 'stale';
    if (S.document && S.document.sourceHash !== S.source.hash) S.state = 'stale';
    if (!isAdmin() && S.document && (S.document.state !== 'approved' || S.state !== 'approved')) S.document = null;
    const displayDoc = S.document && (isAdmin() || S.document.state === 'approved');
    setText('lessonTitle', displayDoc ? S.document.title : S.source.title || defaultTitle(sourceRef()));
    setText('lessonGoal', displayDoc ? S.document.goal : '先读原文，再看图解；学习稿只在明确操作后整理。');
    document.title = asText((displayDoc ? S.document.title : S.source.title) || '图解学习', 65) + ' · El Aula · El Taller';
    renderSource();
    renderStatus();
    renderDocument();
    if (processing()) schedulePoll(); else clearPoll();
  }
  function clearPoll() {
    clearTimeout(S.pollTimer);
    S.pollTimer = 0;
  }
  function schedulePoll() {
    clearPoll();
    if (S.disposed || document.hidden || S.pollPaused || !processing() || S.writing || S.pollInFlight) return;
    S.pollTimer = setTimeout(pollTick, S.pollFailures ? 4500 : 1800);
  }
  async function pollTick() {
    S.pollTimer = 0;
    if (S.disposed || document.hidden || S.pollPaused || S.writing || !processing()) return;
    const epoch = S.epoch;
    S.pollInFlight = true;
    try {
      if (S.job && validId(S.job.id)) {
        const data = await api('/api/learning/jobs/' + encodeURIComponent(S.job.id), {}, 'job');
        if (epoch !== S.epoch || S.disposed) return;
        acceptAdmin(data);
        if (!object(data.job)) throw learnError('没有取得任务状态，请手动刷新。');
        S.job = data.job;
        const nextState = asText(data.job.state || data.job.status, 32);
        S.state = nextState || S.state;
        if (!activeStates.has(nextState)) {
          if (validId(data.job.documentId) && ['draft', 'approved'].includes(nextState)) {
            S.target = { docId:data.job.documentId };
            historyTarget(S.target, true);
          }
          const loaded = await loadStatus({ quiet:true });
          if (loaded === false) return;
        } else renderStatus();
      } else {
        const loaded = await loadStatus({ quiet:true });
        if (loaded === false) return;
      }
      if (epoch === S.epoch) { S.pollFailures = 0; notice(''); }
    } catch (error) {
      if (epoch !== S.epoch || S.disposed || error.name === 'AbortError') return;
      S.pollFailures++;
      if (S.pollFailures >= 3 || [401, 403, 404].includes(error.status)) {
        S.pollPaused = true;
        notice(messageOf(error) + ' 自动刷新已暂停；可手动刷新状态或继续刷新，不会重新生成。');
      }
      renderStatus();
    } finally {
      S.pollInFlight = false;
      // A previous route's aborted poll must not leave the new route without a timer.
      schedulePoll();
    }
  }

  async function generate(mode, reviewed = false) {
    if (!isAdmin() || S.writing || S.loading || processing()) return;
    const ref = sourceRef();
    if (!ref || !S.source || S.source.generationAllowed === false || S.source.needsSelection) return;
    const selectedCase = reviewed && ref.kind === 'article' && object(S.source.curatedCase) &&
      S.source.curatedCase.sourceHash === S.source.hash ? S.source.curatedCase : null;
    if (mode === 'curated' && ref.kind !== 'kb' && !selectedCase) return;
    if (mode === 'deterministic' && !['dala', 'hardware'].includes(ref.kind)) return;
    if (mode === 'model' && !['kb', 'article'].includes(ref.kind)) return;
    const epoch = S.epoch;
    S.writing = true;
    clearPoll();
    notice('');
    renderStatus();
    renderSource();
    renderPicker();
    try {
      const body = { sourceRef:ref, mode, ...(selectedCase ? { caseId:selectedCase.id, sourceHash:selectedCase.sourceHash } : {}) };
      const data = await api('/api/learning/generate', { method:'POST', body:JSON.stringify(body) }, 'write');
      if (epoch !== S.epoch || S.disposed) return;
      acceptAdmin(data);
      S.target = { sourceRef:ref };
      S.job = object(data.job) ? data.job : null;
      S.state = S.job && (S.job.state || S.job.status) || 'queued';
      S.document = null;
      S.renderedKey = '';
      $('reviewConfirm').checked = false;
      S.pollPaused = false;
      S.pollFailures = 0;
      historyTarget(S.target, true);
      if (validId(data.documentId || (S.job && S.job.documentId)) && ['draft','approved'].includes(S.state)) {
        S.target = { docId:data.documentId || S.job.documentId };
        historyTarget(S.target, true);
      }
      await loadStatus({ quiet:true });
    } catch (error) {
      if (epoch !== S.epoch || S.disposed || error.name === 'AbortError') return;
      notice(messageOf(error));
      if (error.code === 'source_changed' || error.status === 409) { S.state = 'stale'; $('reviewConfirm').checked = false; }
    } finally {
      if (epoch === S.epoch && !S.disposed) {
        S.writing = false;
        renderSource(); renderStatus(); renderPicker(); renderDocument();
        schedulePoll();
      }
    }
  }
  async function retryJob() {
    if (!isAdmin() || S.writing || S.loading || !S.job || !validId(S.job.id) || !['failed','interrupted'].includes(S.state)) return;
    if (S.job.mode === 'model') {
      S.dialogRetry = true;
      setText('modelTitle', '手动重试模型生成');
      setText('modelSource', S.source && S.source.title || '当前学习材料');
      setText('modelWarning', '重试将再次调用本站现有 GLM，可能消耗配额。不会自动重试，也不会把未完成内容当成已审核学习稿。');
      openDialog($('modelDialog'));
      return;
    }
    await performRetry();
  }
  async function performRetry() {
    if (!isAdmin() || S.writing || !S.job || !validId(S.job.id) || !['failed','interrupted'].includes(S.state)) return;
    const epoch = S.epoch, id = S.job.id, ref = sourceRef();
    S.writing = true;
    notice('');
    renderStatus(); renderSource(); renderPicker();
    try {
      const data = await api('/api/learning/jobs/' + encodeURIComponent(id) + '/retry', { method:'POST', body:JSON.stringify({}) }, 'write');
      if (epoch !== S.epoch || S.disposed) return;
      S.job = object(data.job) ? data.job : S.job;
      S.state = S.job.state || 'queued';
      S.pollPaused = false;
      S.pollFailures = 0;
      if (ref) { S.target = { sourceRef:ref }; historyTarget(S.target, true); }
      await loadStatus({ quiet:true });
    } catch (error) {
      if (epoch !== S.epoch || S.disposed || error.name === 'AbortError') return;
      notice(messageOf(error));
      if (error.code === 'source_changed') S.state = 'stale';
    } finally {
      if (epoch === S.epoch && !S.disposed) { S.writing = false; renderSource(); renderStatus(); renderPicker(); schedulePoll(); }
    }
  }
  async function approve() {
    if (!canApprove() || S.writing || S.loading || !$('reviewConfirm').checked) return;
    const epoch = S.epoch, id = S.document.id, hash = S.document.sourceHash;
    if (!validId(id)) return;
    S.writing = true;
    notice('');
    renderSource(); renderStatus(); renderPicker();
    try {
      const data = await api('/api/learning/' + encodeURIComponent(id) + '/approve', { method:'POST', body:JSON.stringify({ sourceHash:hash }) }, 'write');
      if (epoch !== S.epoch || S.disposed) return;
      $('reviewConfirm').checked = false;
      S.target = { docId:id };
      historyTarget(S.target, true);
      if (object(data.source)) applyStatus(data); else await loadStatus({ quiet:true });
      notice('学习稿已确认。普通读者仍仅能读取与当前原文一致的已确认版本。');
    } catch (error) {
      if (epoch !== S.epoch || S.disposed || error.name === 'AbortError') return;
      $('reviewConfirm').checked = false;
      if (error.status === 409 || error.code === 'source_changed') S.state = 'stale';
      else S.state = 'unverified';
      notice(messageOf(error));
    } finally {
      if (epoch === S.epoch && !S.disposed) { S.writing = false; renderSource(); renderStatus(); renderPicker(); }
    }
  }

  function citationIds(cites) { return [...new Set(list(cites, 16).filter(id => typeof id === 'string' && id.length <= 160))]; }
  function blockMap() { return new Map(list(S.source && S.source.blocks).filter(block => object(block) && typeof block.id === 'string').map(block => [block.id, block])); }
  function citations(cites) {
    const host = el('div', 'citations');
    const ids = citationIds(cites), blocks = blockMap();
    if (!ids.length) { host.append(el('span', 'cite-empty', '未标注逐条证据 · 需回原文核查')); return host; }
    ids.forEach(id => {
      const block = blocks.get(id);
      const node = button(block ? '证据 · ' + id : '引用待核对 · ' + id, 'cite' + (block ? '' : ' cite-missing'), () => openEvidence([id]));
      node.setAttribute('aria-haspopup', 'dialog');
      node.setAttribute('aria-label', (block ? '查看原文证据，' : '缺失的引用，') + id + (block ? '，' + asText(block.location, 300) : ''));
      host.append(node);
    });
    return host;
  }
  function componentHeader(component, index) {
    const head = el('header', 'component-head');
    const title = el('div');
    title.append(el('span', 'component-number', pad(index + 1) + ' / ' + componentNames[component.type]), el('h2', '', component.title || componentNames[component.type]));
    const forcedExample = ['quiz','contrast'].includes(component.type);
    const origin = forcedExample ? 'example' : component.origin;
    const originText = { source:'原文摘录', explanation:'来源释义', example:'教学示例 · 非原文事实' }[origin] || '来源关系待核查';
    head.append(title, el('span', 'origin origin-' + (['source','explanation','example'].includes(origin) ? origin : 'unknown'), originText));
    return head;
  }
  function equivalent(title, items) {
    const details = el('details', 'equivalent');
    details.append(el('summary', '', title));
    const ordered = el('ol');
    items.forEach(item => {
      const row = el('li');
      row.append(el('strong', '', item.title), el('p', '', item.text), citations(item.cites));
      ordered.append(row);
    });
    details.append(ordered);
    return details;
  }
  function controls(previous, next, reset) {
    const host = el('div', 'step-controls');
    const prev = button('← 上一步', 'btn btn-ghost', previous);
    const count = el('span', 'step-count');
    const following = button('下一步 →', 'btn btn-ghost', next);
    host.append(prev, count, following);
    if (reset) host.append(button('从头看', 'text-button', reset));
    return { host, prev, next:following, count };
  }
  function keyNavigation(event, index, length, select) {
    let next = index;
    if (['ArrowRight','ArrowDown'].includes(event.key)) next = Math.min(length - 1, index + 1);
    else if (['ArrowLeft','ArrowUp'].includes(event.key)) next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = length - 1;
    else return;
    event.preventDefault();
    select(next, true);
  }
  function renderFlow(component, host, index) {
    const lanes = list(component.lanes, 3).filter(object);
    const all = [];
    const figure = el('figure');
    figure.append(el('figcaption', 'flow-intro', '两色区分泳道；点击节点查看含义与证据。键盘可用 Tab 选节点，方向键或 Home / End 逐步查看。'));
    const diagram = el('div', 'flow-lanes');
    const nodes = [];
    const detail = el('div', 'flow-detail');
    detail.id = 'flow-detail-' + index;
    detail.setAttribute('role', 'region');
    detail.setAttribute('aria-label', '当前流程步骤');
    detail.setAttribute('aria-live', 'polite');
    detail.setAttribute('aria-atomic', 'true');
    let current = 0;
    const ctrl = controls(() => select(current - 1), () => select(current + 1), () => select(0));
    lanes.forEach((lane, laneIndex) => {
      const laneNode = el('section', 'flow-lane');
      const heading = el('div', 'lane-heading');
      heading.append(el('span', 'lane-marker', String.fromCharCode(65 + laneIndex)), el('h3', '', lane.title));
      const ordered = el('ol', 'lane-steps');
      const steps = list(lane.steps, 8).filter(object);
      if (steps.length > 4) ordered.classList.add('lane-many');
      steps.forEach(step => {
        if (all.length >= 16) return;
        const position = all.length;
        all.push({ ...step, laneTitle:lane.title });
        const row = el('li');
        const node = button('', 'flow-node', () => select(position));
        node.setAttribute('aria-controls', detail.id);
        node.setAttribute('aria-pressed', 'false');
        node.addEventListener('keydown', event => keyNavigation(event, position, all.length, select));
        node.append(el('span', 'node-number', pad(position + 1)), el('strong', '', step.title));
        nodes.push(node);
        row.append(node);
        ordered.append(row);
      });
      laneNode.append(heading, ordered);
      diagram.append(laneNode);
    });
    if (!all.length) { host.append(el('p', 'component-warning', '流程图没有可读取的步骤，请核查学习稿。')); return; }
    figure.append(diagram);
    if (object(component.branch)) {
      const branch = component.branch;
      const from = all.find(step => step.id === branch.from);
      const branchNode = el('aside', 'flow-branch');
      branchNode.append(el('span', 'origin origin-example', from ? '从「' + asText(from.title, 140) + '」分支' : '分支起点待核查'), el('h3', '', branch.title), el('p', '', branch.text), citations(branch.cites));
      figure.append(branchNode);
    }
    host.append(figure, detail, ctrl.host);
    host.append(equivalent('文字等价说明 · 按泳道和顺序阅读全文', all.map(step => ({ ...step, title:asText(step.laneTitle) + ' · ' + asText(step.title) }))));
    select(0);
    function select(value, focus) {
      current = Math.max(0, Math.min(all.length - 1, value));
      const step = all[current];
      nodes.forEach((node, i) => node.setAttribute('aria-pressed', String(i === current)));
      detail.replaceChildren(el('span', 'detail-kicker', asText(step.laneTitle) + ' / ' + pad(current + 1)), el('h3', '', step.title), el('p', '', step.text), citations(step.cites));
      ctrl.count.textContent = (current + 1) + ' / ' + all.length;
      ctrl.prev.disabled = current === 0;
      ctrl.next.disabled = current === all.length - 1;
      if (focus) nodes[current].focus();
    }
  }
  function renderSteps(component, host, index) {
    const items = list(component.items, 12).filter(object);
    if (!items.length) { host.append(el('p', 'component-warning', '没有可演示的步骤。')); return; }
    const demo = el('div', 'step-demo');
    const ordered = el('ol', 'step-list');
    ordered.setAttribute('aria-label', '选择演示步骤');
    const scene = el('div', 'step-scene');
    scene.id = 'step-scene-' + index;
    const content = el('div');
    content.setAttribute('aria-live', 'polite');
    content.setAttribute('aria-atomic', 'true');
    const progress = el('progress', 'step-progress');
    progress.max = items.length;
    progress.setAttribute('aria-label', '当前手动步骤');
    let current = 0;
    const ctrl = controls(() => select(current - 1), () => select(current + 1), () => select(0));
    const nodes = items.map((item, i) => {
      const row = el('li');
      const node = button('', 'step-select', () => select(i));
      node.append(el('span', '', pad(i + 1)), el('strong', '', item.title));
      node.setAttribute('aria-pressed', 'false');
      node.setAttribute('aria-controls', scene.id);
      node.addEventListener('keydown', event => keyNavigation(event, i, items.length, select));
      row.append(node); ordered.append(row);
      return node;
    });
    scene.append(progress, content, ctrl.host);
    demo.append(ordered, scene);
    host.append(demo, equivalent('不切换步骤，直接阅读全部文字', items));
    select(0);
    function select(value, focus) {
      current = Math.max(0, Math.min(items.length - 1, value));
      const item = items[current];
      progress.value = current + 1;
      nodes.forEach((node, i) => node.setAttribute('aria-pressed', String(i === current)));
      content.replaceChildren(el('span', 'detail-kicker', 'PASO ' + pad(current + 1) + ' / ' + pad(items.length) + ' · 手动推演'), el('h3', '', item.title), el('p', '', item.text), citations(item.cites));
      ctrl.count.textContent = (current + 1) + ' / ' + items.length;
      ctrl.prev.disabled = current === 0;
      ctrl.next.disabled = current === items.length - 1;
      if (focus) nodes[current].focus();
    }
  }
  function renderQuiz(component, host, index) {
    const options = list(component.options, 5);
    if (options.length < 2 || !Number.isInteger(component.answerIndex) || component.answerIndex < 0 || component.answerIndex >= options.length) {
      host.append(el('p', 'component-warning', '这道题缺少有效答案，暂不作为可验证的小测。'));
      return;
    }
    const form = el('form', 'quiz-form');
    const fieldset = el('fieldset');
    fieldset.append(el('legend', '', component.question));
    const choices = el('div', 'quiz-options');
    const radios = [], labels = [];
    const result = el('div', 'quiz-result');
    result.hidden = true;
    result.setAttribute('role', 'status');
    options.forEach((option, i) => {
      const label = el('label', 'quiz-option');
      const input = el('input');
      input.type = 'radio'; input.name = 'quiz-' + index; input.value = String(i); input.required = true;
      input.addEventListener('change', () => { result.hidden = true; labels.forEach(row => row.classList.remove('is-correct')); });
      label.append(input, el('span', '', String.fromCharCode(65 + i) + '. ' + asText(option)));
      choices.append(label); radios.push(input); labels.push(label);
    });
    fieldset.append(choices);
    const row = el('div', 'action-row');
    const check = el('button', 'btn btn-hot', '核对答案'); check.type = 'submit';
    const reset = button('重新作答', 'btn btn-ghost', () => { form.reset(); result.hidden = true; labels.forEach(label => label.classList.remove('is-correct')); radios[0].focus(); });
    row.append(check, reset, el('span', 'small-note', '只在本页练习，不上传答题记录。'));
    form.append(fieldset, row, result);
    form.addEventListener('submit', event => {
      event.preventDefault();
      const selected = radios.findIndex(radio => radio.checked);
      if (selected < 0) { radios[0].focus(); return; }
      const correct = selected === component.answerIndex;
      labels.forEach((label, i) => label.classList.toggle('is-correct', i === component.answerIndex));
      result.classList.toggle('correct', correct);
      result.replaceChildren(el('strong', '', correct ? '理解正确。回到证据，再确认一次。' : '再看一眼证据，不急着记住答案。'),
        el('p', '', '可支持的选择：' + String.fromCharCode(65 + component.answerIndex) + '. ' + asText(options[component.answerIndex])),
        el('p', '', component.explanation), citations(component.cites));
      result.hidden = false;
    });
    host.append(form);
  }
  function safeDimension(value, type) {
    if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,2})(?:\.[0-9]{1,3})?(?:px|rem|em|%)$/.test(value)) return null;
    const numeric = Number.parseFloat(value);
    const unit = /(?:px|rem|em|%)$/.exec(value)[0];
    const pixels = numeric * (unit === 'rem' || unit === 'em' ? 16 : unit === '%' ? .76 : 1);
    return type === 'size' ? Math.max(8, Math.min(56, pixels)) : Math.max(0, Math.min(120, pixels));
  }
  function renderTokens(component, host) {
    const grid = el('div', 'token-grid');
    list(component.items, 16).filter(object).forEach(item => {
      const card = el('section', 'token-card');
      const sample = el('div', 'token-sample');
      sample.setAttribute('aria-hidden', 'true');
      let valid = false;
      if (item.tokenType === 'color' && typeof item.value === 'string' && /^#[0-9a-f]{6}$/i.test(item.value)) {
        const color = el('div', 'token-color');
        color.style.backgroundColor = item.value;
        sample.append(color); valid = true;
      } else if (['size','space'].includes(item.tokenType)) {
        const dimension = safeDimension(item.value, item.tokenType);
        if (dimension !== null) {
          const preview = el('span', item.tokenType === 'size' ? 'token-size' : 'token-space', item.tokenType === 'size' ? 'Aa 字' : '');
          if (item.tokenType === 'size') preview.style.fontSize = dimension + 'px';
          else preview.style.width = dimension + 'px';
          sample.append(preview); valid = true;
        }
      }
      if (!valid) sample.append(el('span', 'token-invalid', '仅保留原值，不执行样式'));
      card.append(sample, el('h3', '', item.label), el('code', 'token-value', item.value), el('p', '', item.text), citations(item.cites));
      grid.append(card);
    });
    host.append(grid, el('p', 'small-note', '标本只用于观察。预览字号限制为 8–56px、间距为 0–120px，原始值保留在标签中；不会把来源样式应用到本站。'));
  }
  function renderContrast(component, host) {
    const grid = el('div', 'contrast-grid');
    const isSpecimen = sourceRef()?.kind === 'dala';
    ['bad','good'].forEach((key, i) => {
      const side = object(component[key]) ? component[key] : {};
      const panel = el('section', 'contrast-side' + (i ? ' contrast-good' : ''));
      panel.append(el('span', 'eyebrow', i ? 'Después · 改进示意' : 'Antes · 反例示意'));
      if (isSpecimen) {
        // Fixed page-owned DOM: no generated selectors, markup, token styles or executable source CSS.
        const specimen = el('div', 'hierarchy-demo ' + (i ? 'hierarchy-good' : 'hierarchy-bad'));
        specimen.dataset.source = i ? 'good' : 'bad';
        specimen.setAttribute('aria-label', i ? '教学示意：留白与一个主操作' : '教学反例：过多强调和拥挤层级');
        specimen.append(el('span', 'demo-eyebrow', 'MI CUADERNO'), el('strong', 'demo-title', '专注这一件事'), el('span', 'demo-copy', '把主次分开，留一点呼吸。'));
        const actions = el('div', 'demo-actions');
        actions.append(el('span', 'demo-primary', '开始阅读'), el('span', 'demo-secondary', '稍后再看'));
        specimen.append(actions, el('small', 'demo-caption', '固定组件示意 · 非 Dala 原始代码'));
        panel.append(specimen);
      }
      panel.append(el('h3', '', side.title), el('p', '', side.text));
      grid.append(panel);
    });
    host.append(grid, citations(component.cites));
  }
  function renderComparison(component, host) {
    const columns = list(component.columns, 3).filter(object);
    if (!columns.length) { host.append(el('p', 'component-warning', '比较对象未提供。')); return; }
    const key = el('div', 'comparison-key');
    columns.forEach(column => key.append(el('span', '', column.title)));
    const rows = el('div', 'comparison-rows');
    list(component.rows, 12).filter(object).forEach(row => {
      const section = el('section', 'comparison-row');
      const heading = el('div', 'comparison-row-head');
      heading.append(el('h3', '', row.label), citations(row.cites));
      const values = el('div', 'comparison-values');
      values.style.setProperty('--comparison-columns', String(columns.length)); // Own bounded count, never model CSS.
      columns.forEach((column, i) => {
        const cell = el('div', 'comparison-cell');
        cell.append(el('h4', '', column.title), el('p', '', asText(list(row.values, 3)[i]) || '未记录'));
        values.append(cell);
      });
      section.append(heading, values); rows.append(section);
    });
    host.append(key, rows);
  }
  function renderCards(component, host) {
    const cards = el('div', 'learning-cards');
    list(component.items, 12).filter(object).forEach((item, i) => {
      const card = el('section', 'learning-card');
      card.append(el('span', 'eyebrow', pad(i + 1)), el('h3', '', item.title), el('p', '', item.text), citations(item.cites));
      cards.append(card);
    });
    host.append(cards);
  }
  function renderResearchStudy(component, host) {
    const ref = S.source && S.source.sourceRef;
    const validSource = ref && ref.kind === 'article' && ref.url === 'https://www.anthropic.com/research/agents-judgment-calls';
    const current = S.document && S.source && S.document.sourceHash === S.source.hash && S.state !== 'stale' &&
      (!S.currentSourceHash || S.currentSourceHash === S.source.hash);
    if (!isAdmin() || !validSource || !current || !window.TallerResearchVisual) {
      host.append(el('p', 'component-warning', '这份研究图解缺少当前可核对的案例来源。历史稿请对照原文证据，不作为当前研究结果展示。'));
      return;
    }
    try {
      const dispose = window.TallerResearchVisual.mount(host, component, { source:S.source, onEvidence:openEvidence });
      if (typeof dispose === 'function') researchDisposers.push(dispose);
    } catch (_) {
      host.replaceChildren(el('p', 'component-warning', '研究数值或引用未通过展示校验，请回到原文核查。'));
    }
  }
  function renderDocument() {
    const doc = S.document;
    const readable = !!(doc && (isAdmin() || (doc.state === 'approved' && S.state === 'approved')));
    show('lessonDocument', readable);
    show('lessonContents', readable);
    if (!readable) { S.renderedKey = ''; $('components').replaceChildren(); clearRagVisual(); clearResearchVisuals(); return; }
    const key = [doc.id, doc.state, S.state, S.source && S.source.hash, S.currentSourceHash].join('|');
    if (S.renderedKey === key) return; // Preserve manual step and quiz state across a status refresh.
    S.renderedKey = key;
    clearRagVisual();
    clearResearchVisuals();
    const ref = S.source && S.source.sourceRef;
    const visual = !!(ref && ref.kind === 'kb' && ref.bookId === 'agent-handbook' && ref.chapterId === 'ch4' && window.TallerRagVisual);
    const study = ref && ref.kind === 'article' && list(doc.components).some(c => c && c.type === 'research-study');
    document.documentElement.classList.toggle('lesson-rag-visual', visual);
    document.documentElement.classList.toggle('lesson-study-visual', !!study);
    show('referenceSummary', visual);
    $('referenceDetails').open = !visual;
    if (visual) {
      show('ragVisual', true);
      disposeRagVisual = window.TallerRagVisual.mount($('ragVisual'), { source:S.source, onEvidence:openEvidence });
    }
    $('documentMeta').replaceChildren();
    [generatorLabel(doc.generator), formatDate(doc.createdAt) && '整理于 ' + formatDate(doc.createdAt), doc.state === 'approved' ? '确认于 ' + (formatDate(doc.approvedAt) || '时间未记录') : '管理员预览 · 未审核', doc.generator && doc.generator.promptVersion, doc.generator && doc.generator.templateVersion]
      .filter(Boolean).forEach(text => $('documentMeta').append(el('span', '', text)));
    setText('documentSummary', doc.summary);
    if (citationIds(doc.cites).length) $('documentMeta').append(citations(doc.cites));
    const host = $('components'), toc = $('contentsList');
    host.replaceChildren(); toc.replaceChildren();
    const renderers = { flow:renderFlow, steps:renderSteps, quiz:renderQuiz, tokens:renderTokens, contrast:renderContrast, comparison:renderComparison, cards:renderCards, 'research-study':renderResearchStudy };
    list(doc.components, 8).forEach((component, index) => {
      if (!object(component) || !Object.hasOwn(renderers, component.type)) {
        host.append(el('p', 'component-warning', '有一个不在白名单中的组件未展示，请管理员核查学习稿。'));
        return;
      }
      const section = el('section', 'learning-component g-glass' + (component.type === 'research-study' ? ' research-study-component' : ''));
      section.id = 'component-' + (index + 1);
      section.tabIndex = -1;
      section.append(componentHeader(component, index));
      const body = el('div', 'component-body');
      renderers[component.type](component, body, index);
      section.append(body); host.append(section);
      const link = el('a', '', component.title || componentNames[component.type]);
      link.href = '#' + section.id;
      link.addEventListener('click', () => { $('referenceDetails').open = true; });
      const row = el('li'); row.append(link); toc.append(row);
    });
    if (!host.children.length) host.append(el('p', 'component-warning', '学习稿尚无可读取的组件。'));
    const limitations = list(doc.limitations, 12).filter(value => typeof value === 'string');
    if (S.source && S.source.kind === 'article') limitations.unshift('仅基于缓存段落摘录；未验证全文、图表、代码与文末的完整性。');
    if (S.state === 'stale') limitations.unshift('此学习稿与证据是历史快照，原文已变化；不可批准当前稿件。');
    $('limitationsList').replaceChildren();
    limitations.forEach(text => $('limitationsList').append(el('li', '', text)));
    show('limitationsSection', limitations.length > 0);
  }

  function openDialog(dialog) {
    if (dialog.open) return;
    S.dialogFocus.set(dialog, document.activeElement);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else { dialog.setAttribute('open', ''); dialog.setAttribute('role', 'dialog'); dialog.setAttribute('aria-modal', 'true'); }
    const target = dialog.querySelector('[autofocus],button');
    if (target) target.focus({ preventScroll:true });
  }
  function closeDialog(dialog) {
    if (!dialog.open && !dialog.hasAttribute('open')) return;
    if (typeof dialog.close === 'function') dialog.close();
    else { dialog.removeAttribute('open'); restoreDialogFocus(dialog); }
  }
  function restoreDialogFocus(dialog) {
    const previous = S.dialogFocus.get(dialog);
    S.dialogFocus.delete(dialog);
    if (!S.disposed && previous && previous.isConnected) previous.focus({ preventScroll:true });
  }
  function bindDialog(dialog) {
    dialog.addEventListener('close', () => restoreDialogFocus(dialog));
    dialog.addEventListener('click', event => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeDialog(dialog);
    });
    dialog.addEventListener('keydown', event => {
      if (event.key === 'Escape') { event.preventDefault(); closeDialog(dialog); return; }
      if (event.key !== 'Tab') return;
      const nodes = [...dialog.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),summary,[tabindex="0"]')].filter(node => !node.hidden && !node.closest('[hidden]'));
      if (!nodes.length) return;
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    });
  }
  function locationText(value) {
    if (typeof value === 'string' || typeof value === 'number') return asText(value, 400);
    if (object(value)) return ['label','chapter','paragraph','page'].map(key => asText(value[key], 120)).filter(Boolean).join(' · ');
    return '';
  }
  function openEvidence(ids) {
    const map = blockMap(), all = !ids || !ids.length;
    const selected = all ? [...map.keys()] : citationIds(ids);
    $('evidenceBlocks').replaceChildren();
    const context = (S.source && S.source.title || '当前材料') + ' · ' + coverageText(S.source) + (S.state === 'stale' ? ' · 旧稿原文快照' : '') + '。引用只表示来源关联，不代替事实核查。';
    setText('evidenceContext', context);
    selected.forEach(id => {
      const block = map.get(id);
      const section = el('section', 'evidence-block');
      section.append(el('h3', '', id + (block ? ' · ' + locationText(block.location) : ' · 引用未找到')));
      if (!block) section.append(el('p', 'component-warning', '当前来源中没有此片段。请勿把该引用当成有效证据。'));
      else {
        section.append(el('blockquote', '', block.text));
        if (block.translation) {
          const translation = el('div', 'evidence-translation');
          translation.append(el('span', 'detail-kicker', '缓存译文 · 与原文核对'), el('p', '', block.translation));
          section.append(translation);
        }
      }
      $('evidenceBlocks').append(section);
    });
    if (!selected.length) $('evidenceBlocks').append(el('p', 'small-note', '当前没有可展示的原文片段，请返回原文入口。'));
    show('showAllEvidence', !all && map.size > selected.length);
    openDialog($('evidenceDialog'));
    const body = $('evidenceDialog').querySelector('.drawer-body');
    body.scrollTop = 0;
  }

  function applyTheme(theme) {
    if (!themes.includes(theme)) theme = 'bermellon';
    if (theme === 'naranja') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    document.querySelectorAll('[data-theme-dot]').forEach(node => {
      const active = node.dataset.themeDot === theme;
      node.classList.toggle('on', active);
      node.setAttribute('aria-pressed', String(active));
    });
  }
  function automaticTheme() {
    clearTimeout(S.themeTimer);
    if (S.disposed || document.hidden) return;
    try {
      const saved = localStorage.getItem('taller-theme');
      if (!saved) {
        const sun = window.__tallerSunFn && window.__tallerSunFn();
        if (sun) { window.__tallerSun = sun; applyTheme(sun.night ? 'negro' : 'bermellon'); }
      }
    } catch (_) { /* Existing site allows storage-disabled reading. */ }
    S.themeTimer = setTimeout(automaticTheme, 60000);
  }
  function setupThemes() {
    let theme = document.documentElement.dataset.theme || 'naranja';
    try { theme = localStorage.getItem('taller-theme') || theme; } catch (_) { /* no persistence */ }
    applyTheme(theme);
    document.querySelectorAll('[data-theme-dot]').forEach(node => node.addEventListener('click', () => {
      const value = node.dataset.themeDot;
      if (!themes.includes(value)) return;
      applyTheme(value);
      try { localStorage.setItem('taller-theme', value); } catch (_) { /* no persistence */ }
    }));
    window.addEventListener('storage', event => {
      if (event.key === 'taller-theme') {
        if (event.newValue) applyTheme(event.newValue); else automaticTheme();
      }
    });
    document.querySelectorAll('.theme-picker,.mobile-menu').forEach(details => details.addEventListener('keydown', event => {
      if (event.key === 'Escape') { details.open = false; details.querySelector('summary').focus(); }
    }));
    automaticTheme();
  }
  async function loadMe() {
    try {
      const data = await api('/api/me', {}, 'auth');
      if (S.disposed) return;
      S.authenticated = data.authenticated === true;
      S.meAdmin = data.authenticated === true && data.role === 'admin';
      if (data.authenticated && data.mustChangePassword) notice('请先在账户入口修改初始密码，再使用学习页。');
      renderStatus(); renderDocument();
    } catch (error) { if (error.name !== 'AbortError' && !S.disposed) renderStatus(); }
  }
  function bindUI() {
    $('changeSource').addEventListener('click', showPicker);
    $('closePicker').addEventListener('click', () => { show('sourcePicker', false); $('changeSource').focus(); });
    $('reloadCatalog').addEventListener('click', loadCatalog);
    $('applyDevices').addEventListener('click', () => {
      if (S.selected.size < 1 || S.selected.size > 3 || S.writing) return;
      activate({ sourceRef:{ kind:'hardware', deviceIds:[...S.selected].sort() } }, true);
    });
    $('refreshStatus').addEventListener('click', () => { S.pollFailures = 0; loadStatus(); });
    $('togglePolling').addEventListener('click', () => {
      S.pollPaused = !S.pollPaused;
      if (S.pollPaused) { clearPoll(); abortGroup('job'); }
      else { S.pollFailures = 0; notice(''); schedulePoll(); }
      renderStatus();
    });
    $('generateCurated').addEventListener('click', () => generate('curated'));
    $('generateCase').addEventListener('click', () => generate('curated', true));
    $('generateDeterministic').addEventListener('click', () => generate('deterministic'));
    $('generateModel').addEventListener('click', () => {
      if (!isAdmin() || S.writing || S.loading || processing()) return;
      S.dialogRetry = false;
      setText('modelTitle', '按需调用一次模型');
      setText('modelSource', S.source && S.source.title || '当前学习材料');
      setText('modelWarning', '将调用本站现有 GLM 服务，可能消耗现有配额。仅使用当前可用来源；结果只是待核查的学习草稿，不会自动确认为已审核内容。');
      openDialog($('modelDialog'));
    });
    $('cancelModel').addEventListener('click', () => closeDialog($('modelDialog')));
    $('confirmModel').addEventListener('click', () => {
      const retry = S.dialogRetry;
      closeDialog($('modelDialog'));
      if (retry) performRetry(); else generate('model');
    });
    $('retryJob').addEventListener('click', retryJob);
    $('reviewConfirm').addEventListener('change', renderStatus);
    $('approveDocument').addEventListener('click', approve);
    $('openEvidence').addEventListener('click', () => openEvidence());
    $('closeEvidence').addEventListener('click', () => closeDialog($('evidenceDialog')));
    $('showAllEvidence').addEventListener('click', () => openEvidence());
    bindDialog($('evidenceDialog')); bindDialog($('modelDialog'));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearPoll(); clearTimeout(S.themeTimer); abortGroup('status'); abortGroup('job');
      } else {
        automaticTheme();
        if (S.target && !S.writing) loadStatus({ quiet:true });
      }
    });
    window.addEventListener('pagehide', () => { S.disposed = true; clearPoll(); clearTimeout(S.themeTimer); abortAll(); });
    window.addEventListener('pageshow', event => {
      if (!event.persisted) return;
      S.disposed = false; S.writing = false; S.loading = false;
      automaticTheme();
      if (S.target) loadStatus({ quiet:true });
      if (!S.catalogLoaded) loadCatalog();
    });
    window.addEventListener('popstate', () => {
      // Do not replay writes on back / forward. Their result will be recovered from status.
      S.writing = false;
      abortGroup('write');
      route();
    });
  }
  function route() {
    S.inputError = '';
    let target;
    try { target = readTarget(); }
    catch (error) { S.inputError = messageOf(error); target = null; }
    if (target && target.hardware) openHardware(false);
    else activate(target);
  }

  setupThemes();
  bindUI();
  route();
  loadMe();
  loadCatalog();
})();
