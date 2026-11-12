// Pure, in-memory DOM/fetch simulation. This is NOT a browser or layout test.
// Loads the real learning UI and RAG visual, kb-data and backend pure builders.
// No server, network, data writes or packages.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const html = fs.readFileSync(root + 'learning.html', 'utf8');
let script = fs.readFileSync(root + 'learning-ui.js', 'utf8');
const ragScript = fs.readFileSync(root + 'rag-visual.js', 'utf8');
const css = fs.readFileSync(root + 'learning.css', 'utf8');

new vm.Script(script, { filename:'learning-ui.js' });
new vm.Script(ragScript, { filename:'rag-visual.js' });
assert.ok(html.indexOf('src="rag-visual.js" defer') >= 0 &&
  html.indexOf('src="rag-visual.js" defer') < html.indexOf('src="learning-ui.js" defer'), 'Real visual module loads before the learning UI');
assert.match(html, /<link\b[^>]*href="rag-visual\.css"/, 'Real visual stylesheet is linked');
for (const [index, match] of [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].entries()) {
  new vm.Script(match[1], { filename:'learning.html inline ' + index });
}
assert.equal(/\b(?:innerHTML|outerHTML|insertAdjacentHTML|eval)\b|new\s+Function\b/.test(script), false, 'No interpreted model markup');
const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
assert.equal(new Set(htmlIds).size, htmlIds.length, 'Unique HTML IDs');
const referencedIds = [...script.matchAll(/(?:\$|show|setText)\('([^']+)'/g)].map(match => match[1]);
assert.deepEqual([...new Set(referencedIds)].filter(id => !htmlIds.includes(id)), [], 'All static DOM targets exist');
let braces = 0;
for (const char of css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '')) {
  if (char === '{') braces++;
  if (char === '}') braces--;
  assert.ok(braces >= 0, 'CSS brace order');
}
assert.equal(braces, 0, 'Balanced CSS braces');

// Replace startup only inside this VM. Keep real production render, state and event functions intact.
const bootstrap = '  setupThemes();\n  bindUI();\n  route();\n  loadMe();\n  loadCatalog();';
assert.ok(script.includes(bootstrap), 'Expected startup sequence for test-only instrumentation');
script = script.replace(bootstrap, `  globalThis.TEST = {
    S, applyStatus, renderStatus, renderDocument, renderPicker, renderDevices,
    safeHref, safeDimension, normalizeRef, canApprove, generate, approve,
    openEvidence, closeDialog, bindUI, activate, loadStatus, pollTick, schedulePoll
  };`);

const registry = new Map();
function matches(node, selector) {
  selector = selector.trim();
  if (selector.includes(':not(:disabled)') && node.disabled) return false;
  selector = selector.replace(':not(:disabled)', '');
  if (selector === '[hidden]') return node.hidden;
  if (selector === '[autofocus]') return node.autofocus;
  if (selector === '[tabindex="0"]') return node.tabIndex === 0;
  if (selector === '[data-theme-dot]') return !!node.dataset.themeDot;
  if (selector === 'a[href]') return node.tagName === 'A' && !!node.href;
  if (selector[0] === '#') return node.id === selector.slice(1);
  if (selector[0] === '.') return node.className.split(/\s+/).includes(selector.slice(1));
  return node.tagName === selector.toUpperCase();
}

class FakeNode {
  constructor(tag, ownerDocument = null, namespaceURI = 'http://www.w3.org/1999/xhtml') {
    Object.assign(this, {
      tagName:tag.toUpperCase(), ownerDocument, namespaceURI,
      children:[], parentElement:null, _text:'', className:'',
      attrs:{}, dataset:{}, style:{ setProperty(key, value) { this[key] = value; } },
      hidden:false, disabled:false, checked:false, value:'', open:false,
      events:{}, tabIndex:-1, root:false
    });
    this.classList = {
      add:(...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
      remove:name => { this.className = this.className.split(/\s+/).filter(value => value !== name).join(' '); },
      toggle:(name, force) => {
        const has = this.className.split(/\s+/).includes(name);
        const next = force === undefined ? !has : force;
        if (next) this.classList.add(name); else this.classList.remove(name);
        return next;
      },
      contains:name => this.className.split(/\s+/).includes(name)
    };
  }
  set id(value) {
    if (this._id && registry.get(this._id) === this) registry.delete(this._id);
    this._id = String(value);
    this.attrs.id = this._id;
    if (this._id) registry.set(this._id, this);
  }
  get id() { return this._id || ''; }
  get parentNode() { return this.parentElement; }
  set textContent(value) {
    this._text = String(value);
    this.children.forEach(child => { child.parentElement = null; });
    this.children = [];
  }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  append(...nodes) {
    for (let node of nodes) {
      if (!(node instanceof FakeNode)) {
        const text = this.ownerDocument.createTextNode(String(node));
        node = text;
      }
      assert.ok(node !== this && !node.contains(this), 'Cannot append an ancestor into its descendant');
      if (node.parentElement) node.parentElement.removeChild(node);
      node.root = false;
      node.parentElement = this;
      this.children.push(node);
    }
  }
  appendChild(node) { this.append(node); return node; }
  removeChild(node) {
    const index = this.children.indexOf(node);
    assert.notEqual(index, -1, 'Removed node must be a child');
    this.children.splice(index, 1);
    node.parentElement = null;
    return node;
  }
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  replaceChildren(...nodes) {
    this._text = '';
    this.children.forEach(child => { child.parentElement = null; });
    this.children = [];
    this.append(...nodes);
  }
  setAttribute(key, value) {
    this.attrs[key] = String(value);
    if (key === 'open') this.open = true;
    if (key === 'hidden') this.hidden = true;
    if (key === 'id') this.id = value;
    if (key === 'class') this.className = String(value);
    if (key === 'tabindex') this.tabIndex = Number(value);
    if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] = String(value);
  }
  getAttribute(key) {
    if (key === 'id') return this.id || null;
    if (key === 'class') return this.className || null;
    if (key.startsWith('data-')) return this.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())] ?? null;
    return this.attrs[key] ?? null;
  }
  hasAttribute(key) { return key === 'open' ? this.open : key === 'hidden' ? this.hidden : this.getAttribute(key) !== null; }
  removeAttribute(key) {
    delete this.attrs[key];
    if (key === 'open') this.open = false;
    if (key === 'hidden') this.hidden = false;
    if (key === 'id') this.id = '';
    if (key === 'class') this.className = '';
    if (key.startsWith('data-')) delete this.dataset[key.slice(5).replace(/-([a-z])/g, (_, char) => char.toUpperCase())];
  }
  addEventListener(type, handler) { (this.events[type] ??= []).push(handler); }
  removeEventListener(type, handler) { this.events[type] = (this.events[type] || []).filter(value => value !== handler); }
  async fire(type, event = {}) {
    event = { preventDefault() { this.prevented = true; }, target:this, ...event };
    for (const handler of this.events[type] || []) await handler(event);
    return event;
  }
  querySelectorAll(selector) {
    const result = [];
    for (const child of this.children) {
      if (selector.split(',').some(value => matches(child, value))) result.push(child);
      result.push(...child.querySelectorAll(selector));
    }
    return result;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) {
    let node = this;
    while (node) { if (matches(node, selector)) return node; node = node.parentElement; }
    return null;
  }
  focus() { this.ownerDocument.activeElement = this; }
  scrollIntoView() {}
  // No geometry is invented; SVG creation is real DOM work, wire layout is outside this suite.
  getBoundingClientRect() { return { x:0, y:0, left:0, top:0, right:0, bottom:0, width:0, height:0 }; }
  showModal() { this.open = true; }
  close() { this.open = false; this.fire('close'); }
  reset() { for (const node of this.querySelectorAll('input')) node.checked = false; }
  get isConnected() { return this.root || !!this.parentElement?.isConnected; }
}

const document = {
  hidden:false, activeElement:null, events:{}, title:'', documentElement:null,
  createElement(tag) { return new FakeNode(tag, this); },
  createElementNS(namespace, tag) { return new FakeNode(tag, this, namespace); },
  createTextNode(value) { const node = new FakeNode('#text', this, null); node.textContent = value; return node; },
  getElementById:id => { const node = registry.get(id); return node?.isConnected && node.id === id ? node : null; },
  querySelectorAll:selector => [...registry.values()].filter(node => node.isConnected && selector.split(',').some(value => matches(node, value))),
  addEventListener(type, handler) { (this.events[type] ??= []).push(handler); }
};
document.documentElement = document.createElement('html');
document.documentElement.root = true;
for (const match of html.matchAll(/<([\w-]+)\b([^>]*\bid="([^"]+)"[^>]*)>/g)) {
  const node = document.createElement(match[1]);
  node.id = match[3];
  node.root = true;
  node.hidden = /\bhidden(?:\s|>|$)/.test(match[2]);
  node.className = (/class="([^"]*)"/.exec(match[2]) || [])[1] || '';
  node.open = /\bopen(?:\s|>|$)/.test(match[2]);
}
// Relevant real-HTML relationships, not a complete HTML parser or a layout engine.
registry.get('evidenceDialog').append(document.createElement('div'));
registry.get('evidenceDialog').children[0].className = 'drawer-body';
for (const [parent, children] of [
  ['managementControls', ['generationActions', 'generationNote', 'approvalBox']],
  ['generationActions', ['generateCurated', 'generateDeterministic', 'generateModel', 'retryJob']],
  ['approvalBox', ['reviewConfirm', 'approveDocument']],
  ['evidenceDialog', ['closeEvidence', 'evidenceBlocks', 'showAllEvidence']],
  ['modelDialog', ['cancelModel', 'confirmModel']],
  ['lessonDocument', ['documentMeta', 'ragVisual', 'referenceDetails']],
  ['referenceDetails', ['referenceSummary', 'components']]
]) registry.get(parent).append(...children.map(id => registry.get(id)));
assert.match(html, /<section\b[^>]*id="ragVisual"[^>]*>\s*<\/section>\s*<details\b[^>]*id="referenceDetails"[\s\S]*?id="components"/, 'RAG host is a sibling of the existing-component details');

// Verify just the fake DOM primitives used by the real visual; no visual API is replaced.
{
  const first = document.createElement('div'), second = document.createElement('div');
  const a = document.createElement('span'), b = document.createElement('span');
  first.append(a, b); first.append(a);
  assert.deepEqual(first.children, [b, a], 'append moves an existing child to the end');
  second.append(a);
  assert.deepEqual(first.children, [b], 'append removes a moved child from its previous parent');
  assert.equal(a.parentElement, second);
  assert.equal(a.ownerDocument, document);
  second.replaceChildren(b);
  assert.equal(a.parentNode, null, 'replaceChildren detaches replaced nodes');
  assert.equal(first.children.length, 0);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'rv-test'); svg.setAttribute('aria-hidden', 'true');
  assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(svg.classList.contains('rv-test'), true, 'SVG class attribute is reflected');
  assert.equal(svg.getAttribute('aria-hidden'), 'true');
  assert.equal(svg.ownerDocument, document);
}

let location = new URL('http://localhost/learning.html');
const timers = new Map(), fetchCalls = [], responses = [];
let timerId = 0;
const window = {
  document, events:{},
  addEventListener(type, handler) { (this.events[type] ??= []).push(handler); },
  removeEventListener(type, handler) { this.events[type] = (this.events[type] || []).filter(value => value !== handler); }
};
const context = vm.createContext({
  document, window, location,
  history:{
    pushState(_, __, value) { location = new URL(value, location); context.location = location; },
    replaceState(_, __, value) { location = new URL(value, location); context.location = location; }
  },
  localStorage:{ getItem() { return null; }, setItem() {} }, URL, URLSearchParams, AbortController,
  setTimeout(handler, milliseconds) { timers.set(++timerId, { handler, milliseconds }); return timerId; },
  clearTimeout(id) { timers.delete(id); }, console,
  fetch:async (path, options) => {
    fetchCalls.push({ path, options });
    const response = responses.shift();
    if (!response) throw new Error('Unexpected simulated fetch: ' + path);
    return { ok:response.http !== false, status:response.status || 200, json:async () => response.body };
  }
});
window.fetch = context.fetch;
vm.runInContext(ragScript, context, { filename:'rag-visual.js' });
assert.equal(typeof window.TallerRagVisual?.mount, 'function', 'Real browser export exists before UI execution');
vm.runInContext(script, context, { filename:'learning-ui.js' });
const T = context.TEST, S = T.S, $ = id => registry.get(id);

const builders = require(root + 'learning.js');
const bookContext = { window:{} };
vm.runInNewContext(fs.readFileSync(root + 'kb-data.js', 'utf8'), bookContext);
// Explicit, fabricated test catalog: never reads or writes the user's live hardware records.
const deviceFixture = [
  { name:'Device A', brand:'A', cat:'watch', collects:'HR', shows:'screen' },
  { name:'Device B', brand:'B', cat:'ring', collects:'sleep' }
];
const deps = { getBooks:() => bookContext.window.KB.books, getReader:() => ({}), getDevices:() => deviceFixture };
const admin = { u:'admin', r:'admin', mc:false };
const fixtures = [
  ['rag', builders.resolveSource({ kind:'kb', bookId:'agent-handbook', chapterId:'ch4' }, deps, admin), builders.buildCuratedRag],
  ['dala', builders.resolveSource({ kind:'dala' }, deps, admin), builders.buildDala],
  ['hardware', builders.resolveSource({ kind:'hardware', deviceIds:builders.projectDevices(deviceFixture).map(device => device.id) }, deps, admin), builders.buildHardware]
];
function documentFor(name, source, build, material) {
  return {
    ...build(source, material), id:'learn_' + name, sourceHash:source.hash, state:'draft',
    createdAt:'2026-10-29T09:00:00Z',
    generator:{ type:name === 'rag' ? 'curated' : 'deterministic', promptVersion:'p1', templateVersion:'t1' }
  };
}
function descendants(node) { return node.children.flatMap(child => [child, ...descendants(child)]); }
function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
function assertVisualCleared(label) {
  assert.equal($('ragVisual').hidden, true, label + ': hide visual host');
  assert.equal($('ragVisual').children.length, 0, label + ': remove visual DOM');
  assert.equal($('ragVisual').textContent, '', label + ': remove visual text');
  assert.equal(document.documentElement.classList.contains('lesson-rag-visual'), false, label + ': clear page visual class');
  assert.equal((window.events.resize || []).length, 0, label + ': dispose the real visual resize listener');
}
async function exerciseRagVisual(doc, source) {
  const host = $('ragVisual'), board = host.querySelector('.rv-board');
  const fetches = fetchCalls.length, originalDoc = JSON.stringify(doc), originalSource = JSON.stringify(source);
  assert.equal(Object.hasOwn(doc, 'schemaVersion'), false, 'Existing draft has no new schema field');
  assert.ok(doc.components.every(component => ['flow','steps','quiz','tokens','contrast','comparison','cards'].includes(component.type)), 'Existing component schema stays sufficient');
  assert.equal(host.hidden, false, 'Existing RAG draft exposes the real visual to its admin');
  assert.ok(board && board.isConnected, 'Real visual module mounted a board');
  assert.equal(document.documentElement.classList.contains('lesson-rag-visual'), true);
  assert.equal(host.getAttribute('aria-label'), 'RAG 视觉实验台');
  assert.equal((window.events.resize || []).length, 1, 'One mounted visual resize listener');
  assert.equal($('components').parentElement, $('referenceDetails'));
  assert.equal($('referenceDetails').parentElement, $('lessonDocument'));
  assert.equal(host.parentElement, $('lessonDocument'));
  assert.equal(host.querySelector('#components'), null, 'Visual has a separate host');
  assert.equal($('referenceDetails').open, false, 'Existing RAG components default to a closed details');
  assert.equal($('referenceSummary').hidden, false);
  assert.equal($('components').children.length, doc.components.length, 'Collapsed original components still render');
  assert.match(host.querySelector('.rv-demo-badge').textContent, /虚构教学场景.*非模型运行/);
  const svg = host.querySelectorAll('svg');
  assert.ok(svg.length >= 2, 'Real SVG elements are created without substituting the visual');
  assert.ok(svg.every(node => node.ownerDocument === document && node.namespaceURI === 'http://www.w3.org/2000/svg'));
  assert.equal(host.querySelector('.rv-wires').getAttribute('aria-hidden'), 'true');

  const stages = host.querySelectorAll('.rv-stage');
  assert.deepEqual(stages.map(node => node.querySelector('b').textContent), ['看原文','看切块','看检索','看重排','看依据']);
  const questions = host.querySelectorAll('.rv-question');
  assert.deepEqual(questions.map(node => node.textContent), ['周六几点关门？','周末几点开放、怎么预约？','取消后退多少钱？']);
  assert.ok([...stages, ...questions].every(node => node.tagName === 'BUTTON' && node.type === 'button'));
  const chunks = host.querySelector('.rv-chunk-list');
  const cards = new Map(chunks.children.map(node => [node.dataset.chunk, node]));
  function assertOrder(expected, label) {
    assert.deepEqual(chunks.children.map(node => node.dataset.chunk), expected, label + ': DOM reading order');
    assert.equal(new Set(chunks.children).size, 3, label + ': no duplicate moved cards');
    assert.equal(host.querySelectorAll('.rv-chunk').length, 3, label + ': exactly three cards');
    chunks.children.forEach((node, index) => {
      assert.equal(node, cards.get(expected[index]), label + ': existing card is moved');
      assert.equal(node.style['--rv-position'], String(index), label + ': declared rank position');
      assert.equal(node.getAttribute('aria-posinset'), String(index + 1), label + ': accessible rank');
      assert.equal(node.getAttribute('aria-setsize'), '3');
      const rank = Number(host.dataset.stage) < 2 ? '片段 ' + expected[index].toUpperCase() : '#' + (index + 1);
      assert.equal(node.querySelector('.rv-rank').textContent, rank, label + ': visible rank label');
    });
  }
  assert.equal(host.dataset.stage, '1');
  assert.equal(host.dataset.question, 'closing');
  assertOrder(['a','b','c'], 'Initial chunks');
  const lines = host.querySelectorAll('.rv-source-line');
  assert.equal(lines.length, 6);
  for (const [id, indices] of [['a',[0,1,2]], ['b',[2,3,4]], ['c',[4,5]]]) {
    const copies = cards.get(id).querySelectorAll('.rv-chunk-line');
    assert.deepEqual(copies.map(node => Number(node.dataset.line)), indices, id + ': actual source slices');
    assert.deepEqual(copies.map(node => node.textContent), indices.map(index => lines[index].textContent));
  }
  for (const [index, color, ids] of [[2,'mint',['a','b']], [4,'gold',['b','c']]]) {
    assert.equal(lines[index].classList.contains('rv-overlap-' + color), true, 'Source boundary sentence is highlighted');
    for (const id of ids) {
      const copy = cards.get(id).querySelectorAll('.rv-chunk-line').find(node => node.dataset.line === String(index));
      assert.equal(copy.classList.contains('rv-overlap-' + color), true, 'Both neighboring cards retain the highlighted sentence');
      assert.equal(copy.textContent, lines[index].textContent, 'Shared sentence matches source exactly');
    }
  }
  assert.equal(lines[2].textContent, '预约请在前一日提交。');
  assert.equal(lines[4].textContent, '前台可借用棋盘与桌游。');
  const shared = host.querySelectorAll('.rv-shared-copy'), toggle = host.querySelector('.rv-overlap-toggle');
  assert.equal(shared.length, 2);
  assert.deepEqual(shared.map(node => [node.closest('.rv-chunk').dataset.chunk, node.dataset.line]), [['b','2'], ['c','4']]);
  assert.equal(host.dataset.overlap, 'true');
  assert.equal(toggle.hidden, false);
  assert.equal(toggle.getAttribute('aria-pressed'), 'true');
  assert.equal(toggle.textContent, '对比：去掉重叠句');
  assert.ok(shared.every(node => !node.hidden));
  await toggle.fire('click');
  assert.equal(host.dataset.overlap, 'false');
  assert.equal(toggle.getAttribute('aria-pressed'), 'false');
  assert.equal(toggle.textContent, '对比：保留重叠句');
  assert.ok(shared.every(node => node.hidden), 'Overlap-off hides only the later shared copies');
  assert.equal(host.querySelectorAll('.rv-chunk-line').filter(node => !node.hidden).length, 6);
  assert.ok(lines.every(node => !node.hidden), 'Overlap comparison retains the complete source');
  await toggle.fire('click');
  assert.equal(host.dataset.overlap, 'true');
  assert.ok(shared.every(node => !node.hidden), 'Overlap-on restores both shared copies');
  await toggle.fire('click');

  await stages[2].fire('click');
  assert.equal(host.dataset.stage, '2');
  assert.equal(stages[2].getAttribute('aria-pressed'), 'true');
  assert.equal(toggle.hidden, true);
  assert.equal(host.querySelector('.rv-overlap-legend').hidden, true);
  assert.ok(shared.every(node => !node.hidden), 'Retrieval restores full teaching chunks after overlap comparison');
  assert.equal(host.querySelectorAll('.rv-chunk-line').filter(node => !node.hidden).length, 8);
  assertOrder(['c','a','b'], 'Retrieve candidates');
  assert.equal(host.querySelectorAll('.rv-answer-sentence').length, 0, 'Retrieval is still pending an evidence check');
  const reorder = host.querySelector('.rv-reorder-button');
  assert.equal(reorder.hidden, false);
  await reorder.fire('click');
  assert.equal(host.dataset.stage, '3');
  assertOrder(['a','b','c'], 'Rerank closing evidence');
  assert.equal(cards.get('a').classList.contains('rv-supports'), true);
  assert.ok(['b','c'].every(id => cards.get(id).classList.contains('rv-no-support')));
  await reorder.fire('click');
  assertOrder(['c','a','b'], 'Restore candidates');
  await stages[3].fire('click');
  assertOrder(['a','b','c'], 'Rerank from stage navigation');
  await host.querySelector('.rv-control-primary').fire('click');
  assert.equal(host.dataset.stage, '4');
  assert.equal(host.querySelectorAll('.rv-answer-sentence').length, 1);
  assert.equal(host.querySelector('.rv-answer-ref').textContent, '依据 A');

  await questions[1].fire('click');
  assert.equal(host.dataset.stage, '4');
  assert.equal(host.dataset.question, 'booking');
  assert.equal(host.dataset.evidence, 'true');
  assert.equal(questions[1].getAttribute('aria-pressed'), 'true');
  const answers = host.querySelectorAll('.rv-answer-sentence');
  assert.equal(answers.length, 2, 'Booking has two supported answer sentences');
  assert.deepEqual(answers.map(node => node.querySelector('.rv-answer-text').textContent), ['周末 09:00–18:00 开放。','请在前一日预约，单次最多两小时。']);
  assert.deepEqual(answers.map(node => node.querySelector('.rv-answer-ref').textContent), ['依据 A','依据 B']);
  assert.ok(['a','b'].every(id => cards.get(id).classList.contains('rv-supports')));
  assert.equal(cards.get('c').classList.contains('rv-no-support'), true);
  const linkedSourceLines = () => host.querySelectorAll('.rv-line-linked').map(node => Number(node.querySelector('.rv-source-line').dataset.line));
  await answers[1].fire('click');
  assert.equal(cards.get('b').classList.contains('rv-linked'), true, 'Click booking sentence links to card B');
  assert.ok(['a','c'].every(id => cards.get(id).classList.contains('rv-muted-link')));
  assert.deepEqual(linkedSourceLines(), [2,3], 'Booking evidence highlights both source conditions');
  assert.equal(answers[1].classList.contains('rv-sentence-active'), true);
  assert.equal(answers[0].classList.contains('rv-sentence-active'), false);
  await answers[0].fire('click');
  assert.equal(cards.get('a').classList.contains('rv-linked'), true, 'Click opening sentence links to card A');
  assert.equal(cards.get('b').classList.contains('rv-linked'), false);
  assert.deepEqual(linkedSourceLines(), [1]);
  await answers[0].fire('click');
  assert.equal(host.querySelectorAll('.rv-linked').length, 0, 'Click active answer again clears selection');
  assert.equal(host.querySelectorAll('.rv-muted-link').length, 0);
  assert.deepEqual(linkedSourceLines(), []);
  await answers[1].fire('click');
  await $('contentsList').querySelector('a').fire('click');
  assert.equal($('referenceDetails').open, true, 'Contents link reveals original components');
  const refreshedDoc = deepFreeze(structuredClone(doc)), refreshedSource = deepFreeze(structuredClone(source));
  T.applyStatus({ ok:true, admin:true, state:'draft', source:refreshedSource, document:refreshedDoc });
  assert.equal(host.querySelector('.rv-board'), board, 'Same-hash status refresh retains scene DOM');
  assert.equal(host.dataset.stage, '4', 'Refresh retains manual evidence stage');
  assert.equal(host.dataset.question, 'booking', 'Refresh retains selected question');
  assert.equal(host.querySelectorAll('.rv-answer-sentence')[1], answers[1], 'Refresh retains answer nodes');
  assert.equal(answers[1].classList.contains('rv-sentence-active'), true, 'Refresh retains selected evidence');
  assert.equal($('referenceDetails').open, true, 'Refresh retains manually expanded reference');
  await stages[3].fire('click');
  T.applyStatus({ ok:true, admin:true, state:'draft', source:refreshedSource, document:refreshedDoc });
  assert.equal(host.dataset.stage, '3', 'Refresh also retains a non-answer stage');
  assert.equal(host.dataset.question, 'booking');
  assert.equal(host.querySelectorAll('.rv-answer-sentence').length, 0);
  assertOrder(['a','b','c'], 'Preserved booking rerank');

  await questions[2].fire('click');
  assert.equal(host.dataset.stage, '4');
  assert.equal(host.dataset.question, 'refund');
  assert.equal(host.dataset.evidence, 'false');
  assert.equal(host.querySelector('.rv-answer-box').classList.contains('rv-answer-refused'), true);
  assert.equal(host.querySelectorAll('.rv-answer-sentence').length, 0, 'No unsupported refund answer sentence');
  assert.equal(host.querySelectorAll('.rv-answer-ref').length, 0, 'No fabricated refund reference');
  assert.match(host.querySelector('.rv-missing').textContent, /没有退费条款.*无法据此回答/);
  assert.equal(host.querySelectorAll('.rv-supports').length, 0);
  assert.equal(host.querySelectorAll('.rv-no-support').length, 3);
  assert.equal(host.querySelectorAll('.rv-linked').length, 0, 'Question switch removes previous evidence highlight');
  assert.deepEqual(linkedSourceLines(), []);
  assertOrder(['b','a','c'], 'Refund has its own reranked candidate order');
  await stages[2].fire('click');
  assertOrder(['c','a','b'], 'Refund raw candidates');
  await stages[3].fire('click');
  assertOrder(['b','a','c'], 'Refund rerank moves the actual existing cards');
  await stages[1].fire('click');
  assert.ok(shared.every(node => node.hidden), 'Returning to overlap comparison remembers its toggle');
  await host.querySelector('.rv-reset').fire('click');
  assert.equal(host.dataset.stage, '1');
  assert.equal(host.dataset.question, 'closing');
  assert.equal(host.dataset.overlap, 'true', 'Reset restores overlap');
  assert.ok(shared.every(node => !node.hidden));
  assertOrder(['a','b','c'], 'Reset restores initial chunks');
  const nav = host.querySelector('.rv-stage-nav');
  await nav.fire('keydown', { key:'Home' });
  assert.equal(host.dataset.stage, '0');
  assert.equal(document.activeElement, stages[0]);
  assert.equal(host.querySelector('.rv-control').disabled, true);
  await nav.fire('keydown', { key:'End' });
  assert.equal(host.dataset.stage, '4');
  assert.equal(document.activeElement, stages[4]);
  assert.equal(host.querySelector('.rv-control-primary').disabled, true);
  await stages[2].fire('click');
  await host.querySelector('.rv-evidence-link').fire('click');
  assert.equal($('evidenceDialog').open, true, 'Visual chapter link opens the existing evidence drawer');
  assert.ok($('evidenceBlocks').children.length > 0);
  for (const node of $('evidenceBlocks').querySelectorAll('blockquote')) {
    assert.ok(source.blocks.some(block => block.text === node.textContent), 'Chapter evidence remains actual source text');
  }
  T.closeDialog($('evidenceDialog'));
  await host.querySelector('.rv-reset').fire('click');
  assert.equal(fetchCalls.length, fetches, 'Every visual interaction and local refresh is fetch-free');
  assert.equal(JSON.stringify(doc), originalDoc, 'Visual does not mutate the original document');
  assert.equal(JSON.stringify(source), originalSource, 'Visual does not mutate the original source');
  assert.equal(JSON.stringify(refreshedDoc), originalDoc, 'Refreshed document is unchanged');
  assert.equal(JSON.stringify(refreshedSource), originalSource, 'Refreshed source is unchanged');
  assert.equal(timers.size, 0, 'Scene creates no autoplay or request timers');
}

T.bindUI();
const renderedTypes = new Set();
for (const [name, { source, material }, build] of fixtures) {
  const doc = deepFreeze(documentFor(name, source, build, material));
  deepFreeze(source);
  const originalDoc = JSON.stringify(doc), originalSource = JSON.stringify(source);
  doc.components.forEach(component => renderedTypes.add(component.type));
  S.target = { sourceRef:source.sourceRef };
  T.applyStatus({ ok:true, admin:true, state:'draft', source, document:doc });
  assert.equal($('components').children.length, doc.components.length, name + ' component count');
  assert.equal(T.canApprove(), true, name + ' valid hash approval');
  assert.equal($('managementControls').open, false, 'Existing draft management defaults closed');
  assert.equal($('statusPanel').classList.contains('status-compact'), true);
  if (name === 'rag') {
    await exerciseRagVisual(doc, source);
    const flow = $('components').children[0];
    const nodes = descendants(flow).filter(node => node.className === 'flow-node');
    assert.equal(nodes.length, 6);
    await nodes[4].fire('click');
    assert.equal(nodes[4].getAttribute('aria-pressed'), 'true');
    const before = flow.querySelector('.flow-detail').textContent;
    T.applyStatus({ ok:true, admin:true, state:'draft', source, document:doc });
    assert.equal(flow.querySelector('.flow-detail').textContent, before, 'Refresh preserves manual flow position');
    await nodes[4].fire('keydown', { key:'Home' });
    assert.equal(nodes[0].getAttribute('aria-pressed'), 'true');
    assert.equal(document.activeElement, nodes[0]);
    const form = $('components').children.at(-1).querySelector('form');
    const radios = form.querySelectorAll('input');
    radios[1].checked = true;
    await form.fire('submit');
    assert.equal(form.querySelector('.quiz-result').hidden, false);
    assert.match(form.querySelector('.quiz-result').textContent, /理解正确/);
    T.openEvidence([source.blocks[0].id]);
    assert.equal($('evidenceDialog').open, true);
    assert.match($('evidenceBlocks').textContent, new RegExp(source.blocks[0].id));
    T.closeDialog($('evidenceDialog'));
    S.currentSourceHash = 'a'.repeat(64);
    assert.equal(T.canApprove(), false, 'Current-source hash mismatch blocks approval');
    S.currentSourceHash = '';
    S.state = 'stale';
    assert.equal(T.canApprove(), false, 'Stale state blocks approval');
    T.applyStatus({ ok:true, admin:false, state:'draft', source, document:doc });
    assert.equal($('lessonDocument').hidden, true, 'Ordinary user cannot view an accidentally returned draft');
    assert.equal($('components').children.length, 0, 'Ordinary draft clears original components');
    assertVisualCleared('Ordinary draft');
    T.applyStatus({ ok:true, admin:false, state:'approved', source, document:{ ...doc, state:'approved' } });
    assert.equal($('lessonDocument').hidden, false, 'Ordinary user can read approved document');
    assert.equal($('ragVisual').hidden, false, 'Approved RAG visual is visible to ordinary readers');
    assert.equal($('ragVisual').querySelectorAll('.rv-chunk').length, 3);
  } else {
    assertVisualCleared('Switch to ' + name);
    assert.equal($('referenceDetails').open, true, 'Non-RAG original components remain expanded');
    assert.equal($('referenceSummary').hidden, true);
  }
  if (name === 'dala') assert.equal(descendants($('components')).filter(node => node.className.includes('hierarchy-demo')).length, 2, 'Fixed-DOM Dala comparison');
  assert.equal(JSON.stringify(doc), originalDoc, name + ' document remains unchanged');
  assert.equal(JSON.stringify(source), originalSource, name + ' source remains unchanged');
}
assert.deepEqual([...renderedTypes].sort(), ['cards','comparison','contrast','flow','quiz','steps','tokens']);
// Exercise each non-RAG destination directly from a mounted RAG scene, rather than
// allowing the first destination's cleanup to mask a missing hardware cleanup.
for (const [name, { source:nextSource, material }, build] of fixtures.slice(1)) {
  const ragSource = fixtures[0][1].source;
  const ragDoc = deepFreeze(documentFor('rag_switch_' + name, ragSource, fixtures[0][2]));
  S.target = { sourceRef:ragSource.sourceRef };
  T.applyStatus({ ok:true, admin:true, state:'draft', source:ragSource, document:ragDoc });
  const oldBoard = $('ragVisual').querySelector('.rv-board');
  const oldStage = $('ragVisual').querySelectorAll('.rv-stage')[3];
  assert.ok(oldBoard?.isConnected, name + ' cleanup starts with a mounted RAG scene');
  assert.equal((window.events.resize || []).length, 1, 'Remount has exactly one resize listener');
  S.target = { sourceRef:nextSource.sourceRef };
  const nextDoc = deepFreeze(documentFor(name + '_switch', nextSource, build, material));
  T.applyStatus({ ok:true, admin:true, state:'draft', source:nextSource, document:nextDoc });
  assertVisualCleared('Direct RAG → ' + name);
  assert.equal(oldBoard.isConnected, false, 'Removed visual subtree detaches');
  await oldStage.fire('click');
  assertVisualCleared('Disposed RAG → ' + name);
  assert.equal($('components').children.length, nextDoc.components.length);
  assert.equal($('referenceDetails').open, true);
}
{
  const ragSource = fixtures[0][1].source;
  const ragDoc = deepFreeze(documentFor('rag_reset', ragSource, fixtures[0][2]));
  S.target = { sourceRef:ragSource.sourceRef };
  T.applyStatus({ ok:true, admin:true, state:'draft', source:ragSource, document:ragDoc });
  assert.equal($('ragVisual').hidden, false);
  await T.activate(null);
  assertVisualCleared('Return to source picker');
  assert.equal($('lessonDocument').hidden, true);
  assert.equal($('components').children.length, 0);
  assert.equal($('sourcePicker').hidden, false);
}
assert.equal(T.safeHref('javascript:alert(1)'), '');
assert.equal(T.safeHref('data:text/html,evil'), '');
assert.equal(T.safeHref('https://evil.test', true), '');
assert.equal(T.safeHref('https://a:secret@example.test'), '');
assert.equal(T.safeHref('/kb.html#b=x', true), 'http://localhost/kb.html#b=x');
assert.equal(T.safeDimension('calc(1px)', 'size'), null);
assert.equal(T.safeDimension('999px', 'size'), 56);
assert.equal(T.safeDimension('999rem', 'space'), 120);
assert.equal(T.safeDimension('-9px', 'space'), null);
assert.equal(T.safeDimension('12px;display:none', 'size'), null);
assert.equal(T.normalizeRef({ kind:'hardware', deviceIds:['a','b','c','d'] }), null);
assert.equal(T.normalizeRef({ kind:'hardware', deviceIds:['a','a'] }), null);

const { source } = fixtures[0][1];
const doc = documentFor('rag', source, fixtures[0][2]);
T.applyStatus({ ok:true, admin:true, state:'draft', source, document:doc });
S.target = { sourceRef:source.sourceRef };
T.openEvidence(['<img src=x onerror=alert(1)>']);
assert.match($('evidenceBlocks').textContent, /<img/);
assert.equal($('evidenceBlocks').querySelectorAll('img').length, 0);
const hostile = {
  ...doc, id:'learn_hostile', title:'<img src=x onerror=alert(1)>', components:[
    { type:'cards', origin:'explanation', title:'<script>bad()</script>', items:[{ title:'<img>', text:'<svg onload=alert(1)>', cites:[source.blocks[0].id] }] },
    { type:'evil', title:'evil' }
  ]
};
T.applyStatus({ ok:true, admin:true, state:'draft', source, document:hostile });
assert.match($('components').textContent, /<svg/);
assert.equal($('components').querySelectorAll('script,img,svg').length, 0);
assert.match($('components').textContent, /白名单/);
assert.equal(fetchCalls.length, 0, 'Rendering and manual exploration never submit generation');

T.applyStatus({ ok:true, admin:true, state:'empty', source });
S.target = { sourceRef:source.sourceRef };
responses.push(
  { body:{ ok:true, job:{ id:'job_1', state:'queued' } } },
  { body:{ ok:true, admin:true, state:'draft', source, document:doc, job:{ id:'job_1', state:'draft', documentId:doc.id } } }
);
await T.generate('curated');
assert.equal(fetchCalls.filter(call => call.options.method === 'POST').length, 1);
assert.equal(JSON.parse(fetchCalls[0].options.body).mode, 'curated');
assert.equal(S.state, 'draft');
assert.equal($('managementControls').open, false);
$('reviewConfirm').checked = true;
responses.push({ body:{ ok:true, admin:true, state:'approved', source, document:{ ...doc, state:'approved', approvedAt:'2026-10-29T10:00:00Z' } } });
await T.approve();
assert.equal(S.state, 'approved');
assert.equal(JSON.parse(fetchCalls.at(-1).options.body).sourceHash, source.hash);
assert.equal(responses.length, 0, 'All explicit simulated responses consumed');

S.state = 'running';
S.job = { id:'job_poll', state:'running' };
S.target = { sourceRef:source.sourceRef };
T.schedulePoll();
assert.ok([...timers.values()].some(timer => timer.milliseconds === 1800));
document.hidden = true;
for (const handler of document.events.visibilitychange) handler();
assert.equal([...timers.values()].some(timer => timer.milliseconds === 1800), false, 'Hidden page clears polling');
document.hidden = false;
T.applyStatus({ ok:true, admin:true, state:'stale', source, currentSourceHash:'b'.repeat(64), document:doc });
assert.equal(T.canApprove(), false);
assert.equal($('approvalBox').hidden, true);

console.log('PASS Node syntax, inline scripts, unique IDs, DOM targets, visual load order and static safe-render checks.');
console.log('PASS real RAG visual in VM: legacy draft without schema changes, independent host and folded originals, overlap/shared-copy toggle, actual moved-card ordering, booking sentences/refs and linked source highlights, refund refusal, same-hash scene retention, draft isolation, Dala/hardware/picker disposal, fetch-free interactions and immutable inputs.');
console.log('PASS existing simulated UI: real RAG/Dala builders, injected hardware fixture, all 7 renderers, manual steps/Home, quiz, evidence, hash/stale gates, explicit POSTs, hidden polling cleanup, hostile text/style rejection, compact controls and Dala fixed-DOM contrast.');
console.log('LIMIT: fake DOM with zero layout geometry; no browser, wire pixels, responsive layout or real-model claims. No network or data writes.');
