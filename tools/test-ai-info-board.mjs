// Node-only regression against the real CommonJS export; no packages, data files or network.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const script = new vm.Script(readFileSync(new URL('../ai-info-board.js', import.meta.url), 'utf8'), {
  filename: 'ai-info-board.js',
});
const dataKey = name => name.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());

class Element {
  constructor(tag, { id = '', className = '', text = '' } = {}) {
    Object.assign(this, { tagName: tag.toLowerCase(), id, className, children: [], parentNode: null,
      dataset: {}, attrs: {}, listeners: new Map(), hidden: false, value: '', text });
  }
  get textContent() { return this.text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) {
    this.children.forEach(child => { child.parentNode = null; });
    this.children = []; this.text = String(value);
  }
  append(...nodes) {
    for (const node of nodes) { node.remove(); node.parentNode = this; this.children.push(node); }
  }
  remove() {
    if (this.parentNode) this.parentNode.children.splice(this.parentNode.children.indexOf(this), 1);
    this.parentNode = null;
  }
  setAttribute(name, value) {
    if (name.startsWith('data-')) this.dataset[dataKey(name)] = String(value);
    else if (name === 'id' || name === 'class') this[name === 'id' ? 'id' : 'className'] = String(value);
    else this.attrs[name] = String(value);
  }
  getAttribute(name) {
    if (name.startsWith('data-')) return this.dataset[dataKey(name)] ?? null;
    if (name === 'id' || name === 'class') return this[name === 'id' ? 'id' : 'className'] || null;
    return this.attrs[name] ?? null;
  }
  matches(selector) {
    return selector.split(',').some(part => {
      const s = part.trim();
      if (s === '*') return true;
      if (/^\.[\w-]+$/.test(s)) return this.className.split(/\s+/).includes(s.slice(1));
      if (/^#[\w-]+$/.test(s)) return this.id === s.slice(1);
      const attr = s.match(/^\[([\w-]+)(?:="([^"]*)")?\]$/);
      if (attr) return attr[2] === undefined ? this.getAttribute(attr[1]) !== null
        : this.getAttribute(attr[1]) === attr[2];
      if (/^[a-z][\w-]*$/i.test(s)) return this.tagName === s.toLowerCase();
      throw new Error(`Unsupported mock selector: ${s}`);
    });
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [
      ...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector),
    ]);
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  contains(node) {
    for (let current = node; current; current = current.parentNode) if (current === this) return true;
    return false;
  }
  cloneNode(deep = false) {
    const copy = new Element(this.tagName, { id: this.id, className: this.className, text: this.text });
    Object.assign(copy, { dataset: { ...this.dataset }, attrs: { ...this.attrs }, hidden: this.hidden, value: this.value });
    if (deep) copy.append(...this.children.map(child => child.cloneNode(true)));
    return copy;
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(fn);
  }
  removeEventListener(type, fn) { this.listeners.get(type)?.delete(fn); }
  fire(type) {
    const event = { type, target: this };
    for (let node = this; node; node = node.parentNode) {
      event.currentTarget = node;
      for (const fn of [...(node.listeners.get(type) || [])]) fn.call(node, event);
    }
  }
}

function fixture({ populated = true } = {}) {
  const el = (tag, props = {}) => new Element(tag, props);
  const board = el('section', { id: 'aiInfoBoard' });
  const filters = el('nav', { className: 'ai-info-filters' });
  const search = el('input', { id: 'aiInfoSearch' });
  const count = el('span', { id: 'aiInfoCount' });
  const empty = el('p', { id: 'aiInfoEmpty', text: '暂无匹配内容' });
  const stack = el('div', { id: 'ai-feed-stack' });
  board.append(filters, search, count, empty, stack);
  const doc = { getElementById: id => [board, ...board.querySelectorAll('*')].find(node => node.id === id) || null };
  const keys = ['bili', 'anth', 'arxiv', 'hw', 'github'];
  const buttons = {}, badges = {}, sources = {};
  for (const key of ['all', ...keys]) {
    const button = el('button'), label = el('span', { text: key }), badge = el('b');
    button.dataset.infoFilter = key; badge.dataset.infoCount = key;
    button.append(label, badge); filters.append(button);
    buttons[key] = { button, label }; badges[key] = badge;
  }
  function addRow(key, title, summary) {
    const row = el(key === 'hw' ? 'a' : 'article', { className: key === 'hw' ? 'hw-link' : 'item' });
    const heading = el('h3', { text: title }), description = el('p', { text: summary });
    row.append(heading, description); sources[key].body.append(row);
    return { row, heading, description };
  }
  for (const key of keys) {
    const node = el('section', { id: `card-${key}` });
    const body = el('div', { id: `${key}Body` });
    node.append(body); stack.append(node); sources[key] = { node, body, rows: [] };
  }
  if (populated) {
    const contents = {
      bili: [['ＡＩ  Video Primer', 'Neural storytelling'], ['Robotics today', 'Embodied agents']],
      anth: [['Claude release', 'Reasoning breakthrough']],
      arxiv: [['Attention study', 'Sparse circuits'], ['Vision study', 'Diffusion benchmark']],
      hw: [['Hardware digest', 'Chip packaging']],
      github: [['Tool release', 'Offline workflow']],
    };
    for (const key of keys) sources[key].rows = contents[key].map(([title, summary]) => addRow(key, title, summary));
    sources.hw.body.append(el('p', { className: 'hw-sum', text: 'Weekly silicon overview' }));
  }
  const comment = el('div', { className: 'cbox', text: 'comment-only-marker' });
  const input = el('input'); input.value = 'input-only-marker';
  const textarea = el('textarea', { text: 'textarea-only-marker' }); textarea.value = textarea.textContent;
  const select = el('select'); select.append(el('option', { text: 'select-only-marker' }));
  const action = el('button', { text: 'button-only-marker' });
  let actionClicks = 0;
  action.addEventListener('click', () => actionClicks++);
  if (populated) sources.bili.rows[0].row.append(comment, input, textarea, select, action);
  const original = stack.querySelectorAll('*').map(node => ({ node, parent: node.parentNode, children: [...node.children] }));
  const observers = [];
  class Observer {
    constructor(callback) { this.callback = callback; this.targets = new Map(); this.connected = true; observers.push(this); }
    observe(target, options) { this.targets.set(target, options); }
    disconnect() { this.connected = false; this.targets.clear(); }
    deliver(records) { if (this.connected) this.callback(records, this); }
  }
  const module = { exports: {} }, context = { module, document: doc, MutationObserver: Observer };
  script.runInNewContext(context, { timeout: 1000 });
  assert.equal(context.AiInfoBoard, module.exports);
  const api = module.exports.create();
  function query(value) { search.value = value; search.fire('input'); }
  function selectSource(key) { buttons[key].label.fire('click'); }
  function retained() {
    for (const key of keys) {
      assert.equal(doc.getElementById(`card-${key}`), sources[key].node);
      assert.equal(sources[key].node.parentNode, stack);
      assert.equal(doc.getElementById(`${key}Body`), sources[key].body);
    }
    for (const { node, parent, children } of original) {
      assert.equal(node.parentNode, parent, 'original node was removed or moved');
      assert.deepEqual(node.children, children, 'original descendants were replaced');
    }
    if (populated) { const before = actionClicks; action.fire('click'); assert.equal(actionClicks, before + 1); }
  }
  function visibleSources() { return keys.filter(key => !sources[key].node.hidden); }
  function visibleRows() {
    return keys.flatMap(key => sources[key].node.hidden ? []
      : sources[key].body.querySelectorAll(key === 'hw' ? '.hw-link' : '.item').filter(row => !row.hidden));
  }
  function selected(key) {
    assert.equal(stack.dataset.filter, key);
    for (const candidate of ['all', ...keys]) {
      assert.equal(buttons[candidate].button.getAttribute('aria-pressed'), String(candidate === key));
    }
  }
  return { api, board, filters, stack, search, count, empty, sources, keys, badges, buttons,
    input, observer: observers[0], observers, addRow, query, selectSource, retained, visibleSources, visibleRows, selected };
}

const tests = [
  ['default combines five original sources and counts all seven rows', f => {
    assert.deepEqual(f.visibleSources(), f.keys);
    assert.equal(f.visibleRows().length, 7);
    assert.equal(f.count.textContent, '五类来源 · 7 条');
    assert.equal(f.empty.hidden, true); f.selected('all');
    for (const [key, expected] of Object.entries({ all: 7, bili: 2, anth: 1, arxiv: 2, hw: 1, github: 1 })) {
      assert.equal(f.badges[key].textContent, String(expected));
      if (key !== 'all') assert.equal(f.sources[key].node.dataset.infoSource, key);
    }
    f.retained();
  }],
  ['source filters retain original nodes, descendants and action listeners', f => {
    for (const key of [...f.keys, 'all']) {
      f.selectSource(key); f.selected(key);
      assert.deepEqual(f.visibleSources(), key === 'all' ? f.keys : [key]);
      const expected = key === 'all' ? 7 : f.sources[key].rows.length;
      assert.equal(f.visibleRows().length, expected);
      assert.equal(f.count.textContent, key === 'all' ? '五类来源 · 7 条' : `当前 ${expected} / 7 条`);
      assert.equal(f.empty.hidden, true); f.retained();
    }
  }],
  ['search matches normalized titles and summaries while excluding comments and controls', f => {
    f.query('  ai   VIDEO  ');
    assert.deepEqual(f.visibleRows(), [f.sources.bili.rows[0].row]);
    assert.equal(f.count.textContent, '匹配 1 / 7 条');
    f.query('SPARSE CIRCUITS');
    assert.deepEqual(f.visibleRows(), [f.sources.arxiv.rows[0].row]);
    f.input.value = 'unrelated edited comment'; f.input.fire('input');
    assert.equal(f.search.value, 'SPARSE CIRCUITS');
    assert.deepEqual(f.visibleRows(), [f.sources.arxiv.rows[0].row]);
    for (const marker of ['comment-only-marker', 'input-only-marker', 'textarea-only-marker', 'select-only-marker', 'button-only-marker']) {
      f.query(marker);
      assert.equal(f.visibleRows().length, 0, `${marker} leaked into search`);
      assert.deepEqual(f.visibleSources(), []); assert.equal(f.empty.hidden, false);
    }
    f.query('silicon overview');
    assert.deepEqual(f.visibleSources(), ['hw']); assert.equal(f.empty.hidden, true);
    assert.equal(f.visibleRows().length, 0); // Hardware summary can match without a matching link.
    f.query('   '); assert.equal(f.visibleRows().length, 7); f.retained();
  }],
  ['MutationObserver refresh reapplies the selected source and search to new rows', f => {
    assert.equal(f.observers.length, 1); assert.equal(f.observer.targets.size, 5);
    for (const key of f.keys) {
      const options = f.observer.targets.get(f.sources[key].body);
      assert(options); assert.equal(options.childList, true);
      assert.equal(options.subtree, true); assert.equal(options.characterData, true);
    }
    f.selectSource('arxiv'); f.query('sparse');
    const matching = f.addRow('arxiv', 'Sparse models', 'New paper');
    const unrelated = f.addRow('arxiv', 'Training report', 'Dense nets');
    const otherSource = f.addRow('bili', 'Sparse news', 'New video');
    f.observer.deliver([
      { type: 'childList', target: f.sources.arxiv.body, addedNodes: [matching.row, unrelated.row] },
      { type: 'childList', target: f.sources.bili.body, addedNodes: [otherSource.row] },
    ]);
    f.selected('arxiv'); assert.equal(f.search.value, 'sparse');
    assert.deepEqual(f.visibleSources(), ['arxiv']);
    assert.deepEqual(f.visibleRows(), [f.sources.arxiv.rows[0].row, matching.row]);
    assert.equal(unrelated.row.hidden, true); assert.equal(otherSource.row.hidden, false);
    assert.equal(f.sources.bili.node.hidden, true);
    assert.equal(f.badges.all.textContent, '10'); assert.equal(f.badges.arxiv.textContent, '4');
    assert.equal(f.badges.bili.textContent, '3'); assert.equal(f.count.textContent, '匹配 2 / 10 条');
    assert.equal(f.empty.hidden, true);
    for (const key of f.keys) assert.equal(f.sources[key].node.parentNode, f.stack);
  }],
  ['empty state covers no matches, recovery and initially empty source bodies', f => {
    f.query('no-such-title-or-summary');
    assert.equal(f.empty.hidden, false); assert.equal(f.count.textContent, '匹配 0 / 7 条');
    assert.deepEqual(f.visibleSources(), []);
    f.query(''); assert.equal(f.empty.hidden, true); assert.equal(f.visibleRows().length, 7);
    const blank = fixture({ populated: false });
    try {
      assert.equal(blank.visibleRows().length, 0); assert.equal(blank.count.textContent, '五类来源 · 0 条');
      assert.equal(blank.badges.all.textContent, '0');
      assert.equal(blank.empty.hidden, false, 'zero rows should display the empty state even with source wrappers present');
    } finally { blank.api.destroy(); }
  }],
  ['destroy restores hidden nodes and rows and removes observers and input handlers', f => {
    f.selectSource('bili'); f.query('ai video');
    assert.equal(f.sources.anth.node.hidden, true); assert.equal(f.sources.bili.rows[1].row.hidden, true);
    f.api.destroy();
    assert.equal(f.observer.connected, false);
    assert.equal(f.filters.listeners.get('click').size, 0); assert.equal(f.search.listeners.get('input').size, 0);
    for (const key of f.keys) {
      assert.equal(f.sources[key].node.hidden, false);
      for (const { row } of f.sources[key].rows) assert.equal(row.hidden, false);
    }
    const previousCount = f.count.textContent;
    f.query('no-such-content'); f.selectSource('github'); f.api.render();
    f.observer.callback([{ type: 'childList', target: f.sources.bili.body }], f.observer);
    assert.equal(f.count.textContent, previousCount); assert.equal(f.visibleRows().length, 7);
    f.api.destroy(); f.retained();
  }],
];

let failures = 0;
for (const [name, run] of tests) {
  let f;
  try { f = fixture(); run(f); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}\n${error.stack || error}`); }
  finally { f?.api.destroy(); }
}
console.log(`RESULT ${tests.length - failures}/${tests.length} passed`);
console.log('Node VM / lightweight DOM mock only, not GUI testing; MutationObserver records are delivered manually, without browser scheduling or layout.');
process.exitCode = failures ? 1 : 0;
