// Node-only regression: execute the real CommonJS export in a VM with a small DOM mock.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../ai-module-focus.js', import.meta.url), 'utf8');

class Element {
  constructor(doc, tag) {
    Object.assign(this, { ownerDocument: doc, tagName: tag, children: [], parentNode: null,
      attrs: {}, dataset: {}, style: {}, listeners: {}, scrollTop: 0, open: false, height: 88 });
    this.classes = new Set();
    this.classList = { add: (...xs) => xs.forEach(x => this.classes.add(x)),
      remove: (...xs) => xs.forEach(x => this.classes.delete(x)), contains: x => this.classes.has(x) };
  }
  set className(value) { this.classes = new Set(value.split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classes].join(' '); }
  get nextSibling() { return this.parentNode?.children[this.parentNode.children.indexOf(this) + 1] || null; }
  get isConnected() { return this === this.ownerDocument.body || !!this.parentNode?.isConnected; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  insertBefore(node, next) {
    if (next && next.parentNode !== this) throw new Error('Invalid insertion reference');
    if (node.parentNode) node.parentNode.children.splice(node.parentNode.children.indexOf(node), 1);
    this.children.splice(next ? this.children.indexOf(next) : this.children.length, 0, node);
    node.parentNode = this;
    return node;
  }
  append(...nodes) { nodes.forEach(node => this.insertBefore(node, null)); }
  prepend(node) { this.insertBefore(node, this.children[0] || null); }
  before(node) { this.parentNode.insertBefore(node, this); }
  replaceWith(node) {
    const parent = this.parentNode;
    parent.insertBefore(node, this);
    parent.children.splice(parent.children.indexOf(this), 1);
    this.parentNode = null;
  }
  matches(selector) {
    return selector.split(',').some(s => s.startsWith('.') ? this.classes.has(s.slice(1))
      : s.startsWith('#') ? this.id === s.slice(1)
      : s.startsWith('[') ? Object.hasOwn(this.attrs, s.slice(1, -1)) : this.tagName === s);
  }
  closest(selector) { return this.matches(selector) ? this : this.parentNode?.closest(selector) || null; }
  contains(node) {
    for (let current = node; current; current = current.parentNode) if (current === this) return true;
    return false;
  }
  querySelectorAll(selector) {
    return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
  }
  addEventListener(type, fn, options = false) {
    const capture = typeof options === 'boolean' ? options : !!options.capture;
    (this.listeners[type] ||= []).push({ fn, capture });
  }
  dispatchEvent(event) {
    if (!event.target) event.target = this;
    const path = [];
    for (let node = this; node; node = node.parentNode) path.push(node);
    if (this.ownerDocument && this.isConnected) path.push(this.ownerDocument);
    const invoke = (node, capture) => {
      event.currentTarget = node;
      for (const listener of node.listeners[event.type] || []) {
        if (listener.capture === capture) listener.fn.call(node, event);
      }
    };
    // Snapshot the path before capture handlers can move a module back out of the dialog.
    for (const node of [...path].reverse()) {
      invoke(node, true);
      if (event.stopped) return !event.defaultPrevented;
    }
    for (const node of path) {
      invoke(node, false);
      if (event.stopped || !event.bubbles) break;
    }
    return !event.defaultPrevented;
  }
  fire(type, init = {}) {
    const event = { type, target: this, button: 0, defaultPrevented: false, bubbles: true,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...init };
    this.dispatchEvent(event);
    return event;
  }
  focus(options) { this.ownerDocument.activeElement = this; this.focusOptions = options; }
  getBoundingClientRect() { return { left: 0, right: 100, top: 0, bottom: this.height, height: this.height }; }
  cloneNode() { throw new Error('Cloning live module nodes is forbidden'); }
  showModal() { if (this.failure) throw this.failure; this.open = true; }
  // Native close queues an event; this mock delivers it synchronously.
  close() { if (this.open) { this.open = false; this.fire('close', { bubbles: false }); } }
}

function fixture() {
  const doc = {
    listeners: {},
    addEventListener: Element.prototype.addEventListener,
    dispatchEvent: Element.prototype.dispatchEvent,
    createElement: tag => new Element(doc, tag), getSelection: () => ({ isCollapsed: true }),
  };
  doc.body = doc.createElement('body');
  const ids = {};
  doc.getElementById = id => ids[id] || null;
  for (const [id, tag] of Object.entries({ aiModuleDialog: 'dialog', aiModuleBody: 'div',
    aiModuleTitle: 'h2', aiModuleSelect: 'select', aiModuleClose: 'button' })) {
    ids[id] = doc.createElement(tag); ids[id].id = id;
  }
  const { aiModuleDialog: dialog, aiModuleBody: body, aiModuleSelect: select,
    aiModuleClose: closeButton, aiModuleTitle: title } = ids;
  dialog.append(title, select, closeButton, body);
  const host = doc.createElement('main'); doc.body.append(host, dialog);
  const exported = { exports: {} };
  vm.runInNewContext(source, { module: exported, document: doc }, { filename: 'ai-module-focus.js', timeout: 1000 });
  const opened = [], closed = [];
  const api = exported.exports.create({ document: doc, onOpen: key => opened.push(key), onClose: () => closed.push(true) });
  function add(key) {
    const before = doc.createElement('aside'), node = doc.createElement('article'), after = doc.createElement('aside');
    const heading = doc.createElement('h3'), content = doc.createElement('p');
    const scrolls = ['cbody', 'ilist', 'loglist', 'memolist', 'caldetail'].map((cls, i) => {
      const child = doc.createElement('div'); child.className = cls; child.scrollTop = i + 10; return child;
    });
    node.scrollTop = 23; node.append(heading, content, ...scrolls); host.append(before, node, after);
    api.register(key, node, `Module ${key}`);
    return { key, node, before, after, heading, content, scrolls, opener: node.children[0] };
  }
  function restored(m) {
    assert.equal(m.node.parentNode, host);
    assert.equal(m.before.nextSibling, m.node); assert.equal(m.node.nextSibling, m.after);
    assert.equal(m.node.scrollTop, 23);
    m.scrolls.forEach((n, i) => assert.equal(n.scrollTop, i + 10));
    assert.equal(m.opener.getAttribute('aria-expanded'), 'false');
    assert.equal(m.node.classList.contains('ai-module-expanded'), false);
  }
  return { doc, dialog, body, host, api, select, title, closeButton, opened, closed, add, restored };
}

const tests = [
  ['register is idempotent; open moves the live node and leaves a placeholder', () => {
    const f = fixture(), m = f.add('a'); f.api.register('a', m.node, 'duplicate');
    assert.equal(m.node.querySelectorAll('.ai-module-expand').length, 1); assert.equal(f.select.children.length, 1);
    assert.equal(m.opener.getAttribute('aria-expanded'), 'false');
    let clicks = 0; m.content.addEventListener('click', () => clicks++);
    m.opener.fire('click');
    assert.equal(f.body.children[0], m.node); assert.equal(m.content.parentNode, m.node);
    const placeholder = m.before.nextSibling;
    assert.equal(placeholder.className, 'ai-module-placeholder'); assert.equal(placeholder.nextSibling, m.after);
    assert.equal(placeholder.style.height, '88px'); assert.equal(placeholder.getAttribute('aria-hidden'), 'true');
    assert.equal(m.opener.getAttribute('aria-expanded'), 'true'); assert.equal(f.api.activeKey, 'a');
    assert.equal(f.title.textContent, 'Module a'); assert.equal(f.select.value, 'a');
    m.content.fire('click'); assert.equal(clicks, 1); assert.equal(f.doc.activeElement, f.closeButton);
    assert.deepEqual(f.opened, ['a']);
  }],
  ['switch restores old position/scroll/ARIA and promotes the next module', () => {
    const f = fixture(), a = f.add('a'), b = f.add('b'); a.opener.fire('click');
    a.node.scrollTop = 100; a.scrolls.forEach(n => n.scrollTop = 99);
    f.select.value = 'b'; f.select.fire('change'); f.restored(a);
    assert.equal(f.body.children.length, 1); assert.equal(f.body.children[0], b.node);
    assert.equal(b.opener.getAttribute('aria-expanded'), 'true'); assert.equal(f.api.activeKey, 'b');
    f.api.close(); f.restored(b); assert.equal(f.doc.activeElement, a.opener);
  }],
  ['close button and Escape cancel restore position, scroll and opener focus', () => {
    for (const escape of [false, true]) {
      const f = fixture(), m = f.add('a'); m.opener.fire('click');
      m.node.scrollTop = 100; m.scrolls.forEach(n => n.scrollTop = 99);
      if (escape) assert.equal(f.dialog.fire('cancel', { bubbles: false }).defaultPrevented, true);
      else f.closeButton.fire('click');
      f.restored(m); assert.equal(f.host.querySelectorAll('.ai-module-placeholder').length, 0);
      assert.equal(f.dialog.open, false); assert.equal(f.api.activeKey, null);
      assert.equal(f.doc.body.classList.contains('ai-module-open'), false);
      assert.equal(f.doc.activeElement, m.opener); assert.equal(m.opener.focusOptions.preventScroll, true);
      assert.equal(f.closed.length, 1);
    }
  }],
  ['nested link/button/input/summary clicks do not expand', () => {
    const f = fixture(), m = f.add('a');
    for (const tag of ['a', 'button', 'input', 'summary']) {
      const control = f.doc.createElement(tag), nested = f.doc.createElement('span');
      control.append(nested); m.node.append(control); control.fire('click'); nested.fire('click');
      assert.equal(f.api.activeKey, null, `${tag} unexpectedly expanded`); assert.equal(f.dialog.open, false);
    }
  }],
  ['body and heading clicks expand', () => {
    const f = fixture(), m = f.add('a');
    for (const target of [m.content, m.heading]) {
      target.fire('click'); assert.equal(f.api.activeKey, 'a'); assert.equal(f.dialog.open, true); f.api.close();
    }
  }],
  ['atlas click closes focus in document capture before the original handler', () => {
    const f = fixture(), m = f.add('a');
    const atlas = f.doc.createElement('button'), icon = f.doc.createElement('span');
    atlas.id = 'hwAtlasBtn'; atlas.append(icon); m.node.append(atlas);
    let activations = 0;
    atlas.addEventListener('click', event => {
      assert.equal(f.dialog.open, false); assert.equal(f.api.activeKey, null);
      activations++; event.stopPropagation();
    });
    for (const target of [atlas, icon]) {
      m.opener.fire('click'); assert.equal(f.dialog.open, true);
      assert.equal(target.fire('click').defaultPrevented, false);
      f.restored(m); assert.equal(f.doc.activeElement, m.opener);
    }
    assert.equal(activations, 2); assert.equal(f.closed.length, 2);
  }],
  ['showModal failure restores node, scroll, placeholder and ARIA', () => {
    const f = fixture(), m = f.add('a'), failure = new Error('simulated showModal failure');
    f.dialog.failure = failure;
    assert.throws(() => f.api.open('a', m.opener), error => error === failure);
    f.restored(m); assert.equal(f.api.activeKey, null); assert.equal(f.dialog.open, false);
    assert.equal(f.body.children.length, 0); assert.equal(f.host.querySelectorAll('.ai-module-placeholder').length, 0);
    assert.equal(f.doc.body.classList.contains('ai-module-open'), false); assert.equal(f.opened.length, 0);
    f.dialog.failure = null; m.opener.fire('click'); f.api.close(); f.restored(m);
    assert.equal(f.doc.activeElement, m.opener);
  }],
];

let failures = 0;
for (const [name, run] of tests) {
  try { run(); console.log(`PASS ${name}`); }
  catch (error) { failures++; console.error(`FAIL ${name}\n${error.stack || error}`); }
}
console.log(`${tests.length - failures}/${tests.length} passed`);
console.log('Mock limits: no browser layout, native Escape generation or async dialog close timing; backdrop and missing-placeholder fallback are not covered.');
process.exitCode = failures ? 1 : 0;
