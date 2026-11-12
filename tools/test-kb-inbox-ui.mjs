// In-memory regression checks for kb.html. No browser, server, packages, network or data writes.
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = fs.readFileSync(new URL('../kb.html', import.meta.url), 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]);
for (const [i, code] of scripts.entries()) new vm.Script(code, { filename: `kb.html script ${i}` });
const source = scripts.find(code => code.includes('const chapterCache = new Map()'));
assert.ok(source, 'Production controller found');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(ids.length, new Set(ids).size, 'Unique IDs');
assert.match(html, /<details[^>]+id="kbInbox"[^>]+hidden[^>]+open/);
assert.ok(html.indexOf('id="kbContinue"') < html.indexOf('id="kbInbox"') && html.indexOf('id="kbInbox"') < html.indexOf('id="kbChips"'));
assert.match(html, /id="kbInboxNoteText" maxlength="500" required/);
assert.ok(source.includes('cancelLearningEntry = window.TallerLearningEntry.mount'), 'Existing learning entry remains intact');
assert.match(source, /window\.KB_PENDING_MID = m\[3\] \|\| ""/);
assert.match(scripts.find(code => code.includes('gloss 式页边问读：划线')), /window\.KB_PENDING_MID = window\.KB_PENDING_MID \|\| ''/);
const inboxCode = source.slice(source.indexOf('const kbInbox ='), source.indexOf('const ICONS ='));
assert.equal(/localStorage|sessionStorage|new Function|\beval\(/.test(inboxCode), false, 'No duplicate persistent store or script evaluation');
assert.match(html, /href="workbench\.html"[\s\S]*?href="ai-workbench\.html"/);

const clone = value => JSON.parse(JSON.stringify(value));
const books = () => [
  { id: 'up-a', title: 'A', uploaded: true, chapters: [{ id: 'one', title: '第一章' }] },
  { id: 'up-b', title: 'B', uploaded: true, chapters: [{ id: 'one', title: '第二章' }] },
  { id: 'base', title: '普通书', chapters: [{ id: 'zero', title: '序章' }] }
];
const items = () => [
  { id: 'a', title: '<img src=x onerror="bad()"> & A.md', type: 'md', at: 1800000000000, chapters: 1 },
  { id: 'b', title: 'B.pdf', type: 'pdf', at: 1800000000000, chapters: 1 }
];
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => clone(body), text: async () => typeof body === 'string' ? body : JSON.stringify(body) });

function harness({ admin = true, hash = '', queue = items(), catalog = books() } = {}) {
  const registry = new Map(), docEvents = new Map(), winEvents = new Map(), requests = [], alerts = [], renders = [];
  const state = { admin, queue: clone(queue), catalog: clone(catalog), confirm: true, triageStatus: 200, inboxStatus: 200, authStatus: 200, catalogText: null, now: 2000000000000, intercept: null, mounts: 0 };
  function listen(map, name, fn) { const values = map.get(name) || []; values.push(fn); map.set(name, values); }
  class Node {
    constructor(id = '', tag = 'div') {
      Object.assign(this, { id, tagName: tag.toUpperCase(), events: new Map(), style: {}, dataset: {}, hidden: false, disabled: false, open: false, value: '', textContent: '', innerHTML: '', children: [], files: [] });
      const classes = new Set();
      this.classList = { toggle(name, value) { if (value) classes.add(name); else classes.delete(name); }, contains(name) { return classes.has(name); } };
    }
    addEventListener(name, fn) { listen(this.events, name, fn); }
    async fire(name, event = {}) { const e = { target: this, preventDefault() { this.defaultPrevented = true; }, ...event }; for (const fn of this.events.get(name) || []) await fn(e); return e; }
    closest(selector) {
      const key = { '[data-inbox-read]': 'inboxRead', '[data-inbox-act]': 'inboxAct' }[selector];
      return key ? this.dataset[key] == null ? null : this : selector === '#' + this.id ? this : null;
    }
    replaceChildren(...children) { this.children = children; this.innerHTML = ''; this.textContent = ''; }
    appendChild(node) { this.children.push(node); return node; }
    focus() { document.activeElement = this; }
    scrollIntoView() { this.scrolled = true; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    requestSubmit() { return this.id === 'kbInboxNoteForm' ? this.fire('submit') : undefined; }
  }
  const document = {
    visibilityState: 'visible', activeElement: null,
    getElementById: id => registry.get(id) || null,
    querySelector: selector => selector.startsWith('#') ? registry.get(selector.slice(1)) || null : null,
    createElement: tag => new Node('', tag),
    addEventListener: (name, fn) => listen(docEvents, name, fn)
  };
  document.body = new Node('body', 'body');
  for (const match of html.matchAll(/<([\w-]+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    const node = new Node(match[2], match[1]);
    node.hidden = /\bhidden\b/.test(match[0]);
    node.open = /\bopen\b/.test(match[0]);
    registry.set(node.id, node);
  }
  const location = { hash, pathname: '/kb.html', search: '', href: '/kb.html' };
  const history = { replaceState(_state, _title, path) { location.hash = path.includes('#') ? path.slice(path.indexOf('#')) : ''; } };
  const sandbox = { document, location, history, URLSearchParams, console, setTimeout, clearTimeout, Map, Set,
    Date: class extends Date { static now() { return state.now; } },
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    confirm() { state.confirmCalls = (state.confirmCalls || 0) + 1; return state.confirm; },
    alert: message => alerts.push(message), prompt: () => null,
    KB: { books: clone(catalog) },
    TallerLearningEntry: { mount() { state.mounts++; return () => {}; } },
    addEventListener: (name, fn) => listen(winEvents, name, fn), scrollTo() {},
    fetch: async (url, options = {}) => {
      const call = { url, options }; requests.push(call);
      assert.ok(!/^https?:/.test(url), 'All fetches stay mocked');
      if (state.intercept) { const reply = await state.intercept(call); if (reply) return reply; }
      if (url === '/api/me') return response(state.authStatus, { authenticated: state.admin, role: state.admin ? 'admin' : 'reader' });
      if (url === '/api/kb/collect') return response(200, { ok: true, items: [] });
      if (url === '/api/kb/inbox') return response(state.inboxStatus, { ok: state.inboxStatus === 200, items: state.queue });
      if (url === '/kb-data.js') return response(200, state.catalogText ?? 'window.KB = ' + JSON.stringify({ books: state.catalog }) + ';\n');
      if (url.startsWith('/api/kb/chapter?')) return response(200, { ok: true, title: 'mock 章节', total: 1, html: '<p>mock</p>' });
      if (url === '/api/kb/triage') {
        if (state.triageStatus !== 200) return response(state.triageStatus, { ok: false });
        const { id, act, note } = JSON.parse(options.body);
        assert.ok(['keep', 'discard', 'note'].includes(act));
        state.queue = state.queue.filter(item => item.id !== id);
        if (act === 'discard') state.catalog = state.catalog.filter(b => b.id !== 'up-' + id);
        if (act === 'note') state.catalog.find(b => b.id === 'up-' + id).note = note;
        return response(200, { ok: true });
      }
      if (url === '/api/kb/upload' && options.method === 'POST') {
        state.queue.push({ id: 'new', title: 'new.md', type: 'md', at: state.now, chapters: 1 });
        state.catalog.push({ id: 'up-new', title: 'new', uploaded: true, chapters: [{ id: 'ch0', title: '新章' }] });
        return response(200, { ok: true, id: 'new' });
      }
      throw new Error('Unmocked request ' + url);
    }
  };
  sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  vm.runInContext(source + '\nglobalThis.TEST = { kbInbox, refreshInbox, refreshCatalog, verifyInboxAdmin, setInboxAdmin, triageInbox, openInboxNote, closeInboxNote, hashState, chapterCache, loadChapter, renderInbox, getView: () => view, getBook: () => bookId, getPending: () => window.KB_PENDING_MID };', context);
  // Keep real startup, route, reader and UI handlers; avoid unrelated shelf HTML work in this mock DOM.
  vm.runInContext('renderShelf = () => {};', context);
  const api = context.TEST;
  const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
  const emit = async (map, name) => { for (const fn of map.get(name) || []) await fn(); await settle(); };
  const click = async dataset => { const target = new Node(); target.dataset = dataset; await registry.get('kbInboxList').fire('click', { target }); await settle(); };
  return { state, requests, alerts, renders, api, context, nodes: registry, document, location, settle, click,
    setHash: async value => { location.hash = value; await emit(winEvents, 'hashchange'); },
    visible: async () => { document.visibilityState = 'visible'; await emit(docEvents, 'visibilitychange'); },
    count: path => requests.filter(call => call.url === path).length };
}

let passed = 0;
async function test(name, run) { await run(); console.log('PASS', name); passed++; }
await test('admin-only requests and denied #inbox route', async () => {
  const h = harness({ admin: false, hash: '#inbox' }); await h.settle();
  assert.equal(h.count('/api/kb/inbox'), 0);
  assert.equal(h.nodes.get('kbInbox').hidden, true);
  assert.equal(h.nodes.get('kbInboxAccess').hidden, false);
  await h.visible(); await h.api.refreshInbox({ force: true });
  assert.equal(h.count('/api/kb/inbox'), 0);
  assert.equal(h.api.getView(), 'shelf');
});
await test('escaped full-width queue, fresh arrivals reopen collapsed panel', async () => {
  const h = harness({ hash: '#inbox' }); await h.settle();
  const list = h.nodes.get('kbInboxList').innerHTML;
  assert.ok(list.includes('&lt;img') && list.includes('&quot;bad()&quot;'));
  assert.equal(list.includes('<img'), false);
  assert.equal(h.nodes.get('kbInbox').hidden, false);
  assert.equal(h.nodes.get('kbInbox').scrolled, true);
  h.nodes.get('kbInbox').open = false;
  h.state.queue.push({ id: 'c', title: 'C', type: 'md', chapters: 0 });
  await h.api.refreshInbox({ force: true });
  assert.equal(h.nodes.get('kbInbox').open, true);
});
await test('chapter+mark deep links survive #inbox round trip and pending mark initialization', async () => {
  const h = harness({ hash: '#b=base&c=0&m=mark123' }); await h.settle();
  assert.equal(h.api.getView(), 'book'); assert.equal(h.api.getBook(), 'base'); assert.equal(h.api.getPending(), 'mark123');
  assert.ok(h.state.mounts > 0, 'Learning mount still executes');
  await h.setHash('#b=base&c=0&m=mark123&inbox'); assert.equal(h.api.getView(), 'shelf');
  await h.setHash('#b=base&c=0&m=mark456'); assert.equal(h.api.getView(), 'book'); assert.equal(h.api.getPending(), 'mark456');
  await h.setHash('#inbox'); await h.click({ inboxRead: 'a' });
  assert.equal(h.api.getBook(), 'up-a'); assert.equal(h.location.hash, '#b=up-a&c=0');
});
await test('keep/discard use raw upload id; confirm and per-book cache invalidation', async () => {
  const h = harness(); await h.settle();
  await h.click({ inboxId: 'a', inboxAct: 'keep' });
  assert.ok(h.context.KB.books.some(b => b.id === 'up-a'));
  assert.equal(h.api.kbInbox.items.some(item => item.id === 'a'), false);
  h.api.chapterCache.set('up-b|0', { ok: true }); h.api.chapterCache.set('base|0', { ok: true });
  h.state.confirm = false;
  await h.click({ inboxId: 'b', inboxAct: 'discard' });
  assert.equal(h.count('/api/kb/triage'), 1);
  h.state.confirm = true;
  await h.click({ inboxId: 'b', inboxAct: 'discard' });
  assert.equal(h.api.chapterCache.has('up-b|0'), false); assert.equal(h.api.chapterCache.has('base|0'), true);
  assert.equal(h.context.KB.books.some(b => b.id === 'up-b'), false);
  assert.equal(h.nodes.get('kbInboxEmpty').hidden, false);
  const bodies = h.requests.filter(call => call.url === '/api/kb/triage').map(call => JSON.parse(call.options.body));
  assert.deepEqual(bodies, [{ id: 'a', act: 'keep' }, { id: 'b', act: 'discard' }]);
});
await test('comment error preserves draft, limits 500, retries with keyboard, Escape cancels', async () => {
  const h = harness(); await h.settle();
  await h.click({ inboxId: 'a', inboxAct: 'note' });
  h.nodes.get('kbInboxNoteText').value = 'x'.repeat(501);
  await h.nodes.get('kbInboxNoteForm').fire('submit'); assert.equal(h.count('/api/kb/triage'), 0);
  h.nodes.get('kbInboxNoteText').value = '  评论 <script>仅作文字</script>  ';
  h.state.triageStatus = 500;
  await h.nodes.get('kbInboxNoteForm').fire('submit');
  assert.equal(h.nodes.get('kbInboxNote').open, true); assert.match(h.nodes.get('kbInboxNoteText').value, /评论/);
  assert.equal(h.nodes.get('kbInboxNoteError').hidden, false);
  h.state.triageStatus = 200;
  await h.nodes.get('kbInboxNote').fire('keydown', { key: 'Enter', ctrlKey: true }); await h.settle();
  assert.equal(h.nodes.get('kbInboxNote').open, false);
  assert.equal(h.context.KB.books.find(b => b.id === 'up-a').note, '评论 <script>仅作文字</script>');
  await h.click({ inboxId: 'b', inboxAct: 'note' });
  await h.nodes.get('kbInboxNote').fire('cancel'); assert.equal(h.nodes.get('kbInboxNote').open, false);
});
await test('401/403 hide private queue and keep failed comment for reauthentication', async () => {
  for (const status of [401, 403]) {
    const h = harness({ hash: '#inbox' }); await h.settle();
    await h.click({ inboxId: 'a', inboxAct: 'note' }); h.nodes.get('kbInboxNoteText').value = '不能丢的评论'; h.state.triageStatus = status;
    await h.nodes.get('kbInboxNoteForm').fire('submit');
    assert.equal(h.nodes.get('kbInbox').hidden, true); assert.equal(h.nodes.get('kbInboxList').innerHTML, '');
    assert.equal(h.nodes.get('kbInboxNoteText').value, '不能丢的评论'); assert.equal(h.nodes.get('kbInboxNoteAuth').hidden, false);
    assert.match(h.nodes.get('kbInboxNoteError').textContent, status === 401 ? /登录/ : /权限/);
    const count = h.count('/api/kb/inbox'); await h.visible(); assert.equal(h.count('/api/kb/inbox'), count);
    h.state.triageStatus = 200;
    await h.nodes.get('kbInboxNoteRetry').fire('click');
    assert.equal(h.nodes.get('kbInboxNoteText').value, '不能丢的评论'); assert.equal(h.nodes.get('kbInboxNoteSubmit').disabled, false);
    await h.nodes.get('kbInboxNoteForm').fire('submit'); assert.equal(h.nodes.get('kbInboxNote').open, false);
  }
});
await test('visibility throttle and logout detection prevent stale admin requests', async () => {
  const h = harness(); await h.settle(); const count = h.count('/api/kb/inbox');
  await h.visible(); await h.visible(); assert.equal(h.count('/api/kb/inbox'), count);
  h.state.now += 13000; await h.visible(); assert.equal(h.count('/api/kb/inbox'), count + 1);
  h.state.now += 13000; h.state.admin = false; await h.visible();
  assert.equal(h.count('/api/kb/inbox'), count + 1); assert.equal(h.nodes.get('kbInbox').hidden, true);
  assert.match(h.nodes.get('kbInboxAccessText').textContent, /登录/);
});
await test('upload refreshes queue+window.KB without reload; catalog refresh survives inbox failure', async () => {
  const h = harness(); await h.settle(); h.state.inboxStatus = 503;
  const input = h.document.body.children.find(node => node.type === 'file');
  input.files = [{ name: 'new.md', size: 4, arrayBuffer: async () => new ArrayBuffer(4) }];
  await input.fire('change'); await h.settle();
  assert.ok(h.context.KB.books.some(b => b.id === 'up-new'));
  assert.equal(h.nodes.get('kbUploadBtn').disabled, false); assert.match(h.nodes.get('kbInboxStatus').textContent, /HTTP 503/);
  h.state.inboxStatus = 200; await h.api.refreshInbox({ force: true }); assert.ok(h.api.kbInbox.items.some(item => item.id === 'new'));
});
await test('in-flight read cannot resurrect a discarded chapter or old catalog', async () => {
  const h = harness(); await h.settle();
  let releaseChapter;
  h.state.intercept = async call => call.url.startsWith('/api/kb/chapter?b=up-b') ? await new Promise(resolve => { releaseChapter = resolve; }) : undefined;
  await h.click({ inboxRead: 'b' });
  await h.click({ inboxId: 'b', inboxAct: 'discard' });
  releaseChapter(response(200, { ok: true, title: '旧章', total: 1, html: '旧正文' })); await h.settle();
  assert.equal(h.api.chapterCache.has('up-b|0'), false); assert.equal(h.api.getView(), 'shelf');
  const other = harness(); await other.settle();
  let releaseCatalog;
  const oldCatalog = 'window.KB = ' + JSON.stringify({ books: other.state.catalog }) + ';';
  other.state.intercept = async call => {
    if (call.url !== '/kb-data.js' || releaseCatalog) return;
    return await new Promise(resolve => { releaseCatalog = resolve; });
  };
  const oldRead = other.api.refreshCatalog(); await other.settle();
  await other.click({ inboxId: 'b', inboxAct: 'discard' });
  releaseCatalog(response(200, oldCatalog)); await oldRead;
  assert.equal(other.context.KB.books.some(b => b.id === 'up-b'), false, 'Earlier catalog cannot put a discarded book back');
});
await test('catalog is JSON-only; empty catalog remains on shelf', async () => {
  const h = harness({ queue: [], catalog: [] }); await h.settle();
  assert.equal(h.api.getView(), 'shelf'); assert.equal(h.location.href, '/kb.html'); assert.equal(h.nodes.get('kbInboxEmpty').hidden, false);
  h.state.catalogText = 'window.KB = {"books":[]}; globalThis.leaked = true;';
  await assert.rejects(h.api.refreshCatalog(), /目录响应无效/); assert.equal(h.context.leaked, undefined);
});
console.log(`OK: ${passed} mock UI regression groups; no real data/server/network accessed. Not a browser/layout test.`);
