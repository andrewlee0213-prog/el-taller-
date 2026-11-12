// Offline Node VM regression tests; no browser/GUI, server, network, or data files.
// All production behavior below is extracted from the two current source files.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const runtime = readFileSync(new URL('../workbench-runtime.js', import.meta.url), 'utf8');
const ai = readFileSync(new URL('../ai-workbench.js', import.meta.url), 'utf8');
function extractFunction(source, name) {
  const match = source.match(new RegExp(`^([ \\t]*)(?:async )?function ${name}\\([^\\n]*\\) \\{[\\s\\S]*?^\\1\\}`, 'm'));
  assert.ok(match, `Cannot extract production function ${name}`);
  return match[0];
}
function extractBlock(source, start, end) {
  const from = source.indexOf(start);
  assert.notEqual(from, -1, `Missing source block: ${start}`);
  const to = source.indexOf(end, from + start.length);
  assert.notEqual(to, -1, `Missing source terminator: ${end}`);
  return source.slice(from, to + end.length);
}
const apiSource = extractFunction(runtime, 'api');
const loadSource = extractFunction(runtime, 'loadAll');
const saveSource = extractBlock(runtime, '$("#cfgSave").addEventListener("click", async () => {', '\n});');
const bootSource = extractBlock(runtime, '(async function boot() {', '\n})();');
const splitSource = extractFunction(ai, 'splitScheduleDraft');
const cardSource = extractFunction(ai, 'scheduleCard');
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const noTimers = () => { throw new Error('Unexpected timer: this test must not depend on a fixed delay'); };
class Target {
  listeners = new Map(); events = []; pending = [];
  addEventListener(type, fn, options = {}) {
    const entries = this.listeners.get(type) || [];
    entries.push({ fn, once: options.once }); this.listeners.set(type, entries);
  }
  dispatchEvent(event) {
    this.events.push(event);
    for (const entry of [...(this.listeners.get(event.type) || [])]) {
      if (entry.once) this.listeners.set(event.type, this.listeners.get(event.type).filter(item => item !== entry));
      const result = entry.fn(event);
      if (result?.then) this.pending.push(result);
    }
    return true;
  }
  async fire(type, detail) {
    const from = this.pending.length;
    this.dispatchEvent({ type, detail });
    await Promise.all(this.pending.slice(from));
  }
}
class Element extends Target {
  value = ''; textContent = ''; disabled = false; hidden = false;
  children = []; dataset = {}; lastChild = { textContent: '' };
  constructor(tagName = 'div') {
    super(); this.tagName = tagName;
    const classes = new Set();
    this.classList = {
      add: (...items) => items.forEach(item => classes.add(item)),
      remove: (...items) => items.forEach(item => classes.delete(item)),
      contains: item => classes.has(item),
      toggle: (item, force = !classes.has(item)) => { force ? classes.add(item) : classes.delete(item); return force; },
    };
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  set innerHTML(value) { assert.equal(value, ''); this.children = []; }
  setAttribute() {}
  remove() { this.removed = true; }
  querySelectorAll() { return []; }
}
function environment(fetch) {
  const nodes = new Map();
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Element()); return nodes.get(id); };
  const window = new Target();
  window.matchMedia = () => ({ matches: true, addEventListener() {} });
  const document = new Target();
  Object.assign(document, {
    hidden: true, body: new Element('body'), getElementById: node,
    querySelector: selector => node(selector.replace(/^#/, '')),
    querySelectorAll: () => [], createElement: tag => new Element(tag),
  });
  const context = vm.createContext({
    window, document, fetch, URLSearchParams,
    CustomEvent: class { constructor(type, options = {}) { this.type = type; this.detail = options.detail; } },
    setTimeout: noTimers, setInterval: noTimers, clearTimeout() {},
    location: { protocol: 'http:', search: '', pathname: '/ai-workbench.html' },
    history: { replaceState() {} },
  });
  return { context, window, document, node };
}
function runtimeEnvironment(fetch) {
  const env = environment(fetch);
  Object.assign(env.context, {
    previousCfg: { marker: 'existing config' }, previousWB: { marker: 'existing workbench' },
    toast() {}, hm: () => '12:00', renderBanner() {}, renderGLM() {},
  });
  vm.runInContext(`
    const $ = selector => document.querySelector(selector);
    let CFG = previousCfg, WB = previousWB, SCHED = null, DIS = {}, INBOX = [],
        HW = null, XHS = null, LOG = [], CMT = {}, MEMOS = [], WEEKLY = {};
    ${apiSource}\n${loadSource}\n${saveSource}
    globalThis.state = () => ({ CFG, WB });
  `, env.context, { filename: 'extracted-workbench-runtime.js' });
  return env;
}
const endpoints = ['data', 'log', 'comments', 'weekly', 'memos'];
const payload = name => name === 'data'
  ? { cfg: { ups: [] }, data: { marker: 'new workbench' } }
  : name === 'weekly' ? { current: {} } : { items: [] };

for (const [label, fetch, expectedStatus] of [
  ['fetch rejection', async () => { throw new Error('offline'); }, 0],
  ['HTTP 401 even with an ok:true body', async () => reply({ ok: true, error: 'unauthorized' }, 401), 401],
  ['invalid JSON', async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad JSON'); } }), 200],
]) {
  test(`api returns a failure object for ${label}`, async () => {
    const { context } = runtimeEnvironment(fetch);
    const result = await context.api('GET', '/api/workbench/data');
    assert.equal(result.ok, false); assert.equal(result.status, expectedStatus);
    assert.equal(typeof result.error, 'string'); assert.ok(result.error.length);
  });
}

test('loadAll throws and preserves existing CFG/WB when any of its five endpoints fails', async () => {
  for (const failed of endpoints) {
    const called = [];
    const { context } = runtimeEnvironment(async path => {
      const name = path.split('/').at(-1); called.push(name);
      assert.ok(endpoints.includes(name), `Unexpected request ${path}`);
      return name === failed ? reply({ error: `failed ${failed}` }, 401) : reply(payload(name));
    });
    await assert.rejects(context.loadAll(), { message: `failed ${failed}`, status: 401 });
    assert.equal(context.state().CFG, context.previousCfg, failed);
    assert.equal(context.state().WB, context.previousWB, failed);
    assert.deepEqual(called.sort(), [...endpoints].sort());
  }
});

test('loadAll rejects missing cfg/data atomically and accepts valid responses', async () => {
  for (const invalid of [{ cfg: {} }, { data: {} }]) {
    const { context } = runtimeEnvironment(async path => reply(path.endsWith('/data') ? invalid : payload(path.split('/').at(-1))));
    await assert.rejects(context.loadAll(), /数据格式无效/);
    assert.equal(context.state().CFG, context.previousCfg); assert.equal(context.state().WB, context.previousWB);
  }
  const data = payload('data');
  const { context } = runtimeEnvironment(async path => reply(path.endsWith('/data') ? data : payload(path.split('/').at(-1))));
  await context.loadAll();
  assert.equal(context.state().CFG, data.cfg); assert.equal(context.state().WB, data.data);
});

test('config-saved waits for both the POST and its JSON body; a pending refresh does not delay the event', async () => {
  const post = deferred(), json = deferred(), refresh = deferred();
  const calls = [];
  const env = runtimeEnvironment((path, options) => {
    calls.push([path, options.method]);
    if (path.endsWith('/config')) return post.promise;
    if (path.endsWith('/data')) return refresh.promise;
    assert.equal(path, '/api/workbench/refresh'); return Promise.resolve(reply({ ok: true }));
  });
  const saved = () => env.window.events.filter(event => event.type === 'workbench:config-saved');
  env.node('cfgKey').value = 'test-key';
  const handler = env.node('cfgSave').listeners.get('click')[0].fn;
  const saving = handler();
  assert.equal(env.node('cfgSave').disabled, true); assert.equal(saved().length, 0);
  assert.deepEqual(calls, [['/api/workbench/config', 'POST']]);
  post.resolve({ ok: true, status: 200, json: () => json.promise });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(saved().length, 0, 'POST JSON still pending');
  json.resolve({ ok: true });
  // Await reaching the refresh request, not an arbitrary number of milliseconds.
  await new Promise(resolve => {
    const original = env.context.fetch;
    env.context.fetch = (...args) => { const result = original(...args); if (args[0].endsWith('/data')) resolve(); return result; };
  });
  assert.equal(saved().length, 1); assert.equal(env.node('cfgSave').disabled, false);
  assert.equal(env.node('cfgKey').value, '');
  refresh.resolve(reply(payload('data'))); await saving;
  assert.equal(saved().length, 1);
});

test('failed config saves never dispatch config-saved and re-enable the button', async () => {
  for (const failure of ['network', '401', 'json', 'application']) {
    const env = runtimeEnvironment(async (path, options) => {
      assert.equal(path, '/api/workbench/config'); assert.equal(options.method, 'POST');
      if (failure === 'network') throw new Error('offline');
      if (failure === 'json') return { ok: true, status: 200, json: async () => { throw new SyntaxError(); } };
      return reply({ ok: false, error: 'save failed' }, failure === '401' ? 401 : 200);
    });
    env.node('cfgKey').value = 'keep-on-failure';
    await env.node('cfgSave').fire('click');
    assert.equal(env.window.events.length, 0, failure);
    assert.equal(env.node('cfgSave').disabled, false, failure);
    assert.equal(env.node('cfgKey').value, 'keep-on-failure', failure);
  }
});

test('real AI config-saved listener calls checkModel immediately and updates mock DOM without timers', async () => {
  const requests = [];
  const env = environment(path => {
    assert.equal(path, '/api/workbench/ai/status');
    const request = deferred(); requests.push(request); return request.promise;
  });
  vm.runInContext(ai, env.context, { filename: 'ai-workbench.js' });
  for (const [response, enabled, ready, message] of [
    [reply({ configured: true, model: 'test-model' }), true, true, /test-model/],
    [reply({ configured: false }), false, false, /未配置/],
    [reply({ configured: true, preview: true }), true, false, /隔离预览/],
    [reply({}, 401), false, false, /登录已失效/],
    [{ ok: true, status: 200, json: async () => { throw new SyntaxError('invalid JSON'); } }, false, false, /invalid JSON/],
  ]) {
    const before = requests.length;
    const checking = env.window.fire('workbench:config-saved');
    assert.equal(requests.length, before + 1, 'Listener must fetch synchronously, without scheduling a timer');
    requests.at(-1).resolve(response); await checking;
    assert.equal(env.node('aiChatSend').disabled, !enabled);
    if (response.status === 200) assert.equal(env.node('aiConnection').classList.contains('ready'), ready);
    assert.match(env.node('aiChatStatus').textContent, message);
  }
});

test('real AI load-error/retry and denied handlers render actions in a lightweight DOM', async () => {
  const env = environment(() => { throw new Error('Unexpected fetch'); });
  vm.runInContext(ai, env.context, { filename: 'ai-workbench.js' });
  await env.window.fire('workbench:load-error', { message: 'try again', status: 401 });
  const gate = env.node('aiGate');
  assert.equal(gate.hidden, false); assert.equal(gate.children[1].textContent, 'try again');
  const retry = gate.children.find(child => child.tagName === 'button');
  assert.ok(retry); await retry.fire('click'); assert.equal(retry.disabled, true);
  assert.equal(env.window.events.filter(event => event.type === 'workbench:retry').length, 1);
  assert.equal(gate.children.at(-1).href, '/login.html?next=%2Fai-workbench.html');
  await env.window.fire('workbench:denied', 'admin required');
  assert.equal(gate.children.length, 3); assert.match(gate.children[0].textContent, /仅管理员/);
  assert.equal(gate.children[1].textContent, 'admin required');
  await env.window.fire('workbench:boot-fail', { message: '连接服务器超时或失败' });
  assert.equal(gate.hidden, false); assert.match(gate.children[0].textContent, /连接工坊失败/);
  assert.equal(gate.children[1].textContent, '连接服务器超时或失败');
  assert.equal(env.node('aiConnection').lastChild.textContent, '连接失败');
  let reloaded = 0; env.context.location = Object.assign({}, env.context.location, { reload: () => { reloaded++; } });
  const bootRetry = gate.children.find(child => child.tagName === 'button');
  await bootRetry.fire('click'); assert.equal(reloaded, 1);
});

test('extracted runtime boot recovers on retry; denied users never initialize', async () => {
  for (const role of ['admin', 'viewer']) {
    const env = environment(async path => {
      assert.equal(path, '/api/me'); return reply({ authenticated: true, role, username: 'test' });
    });
    let loads = 0, renders = 0;
    Object.assign(env.context, {
      AI_WORKBENCH: true, $: selector => env.document.querySelector(selector),
      loadAll: async () => { if (++loads === 1) throw Object.assign(new Error('temporary failure'), { status: 503 }); },
      renderBanner() {}, renderAll: () => { renders++; }, dtLoad() {}, toast() {},
    });
    await vm.runInContext(bootSource, env.context, { filename: 'extracted-workbench-boot.js' });
    if (role === 'viewer') {
      assert.equal(loads, 0); assert.equal(renders, 0);
      assert.deepEqual(env.window.events.map(event => event.type), ['workbench:denied']);
    } else {
      assert.equal(renders, 0);
      assert.deepEqual(env.window.events.map(event => event.type), ['workbench:load-error']);
      assert.equal(env.window.events[0].detail.status, 503);
      await env.window.fire('workbench:retry');
      assert.equal(loads, 2); assert.equal(renders, 1);
      assert.equal(env.window.events.filter(event => event.type === 'workbench:ready').length, 1);
    }
  }
});

test('boot never hangs silently: a failed or timed-out /api/me dispatches boot-fail', async () => {
  for (const failure of ['network rejection', 'invalid JSON body']) {
    const env = environment(async path => {
      assert.equal(path, '/api/me');
      if (failure === 'network rejection') throw new Error('offline');
      return { ok: true, status: 200, json: async () => { throw new SyntaxError('bad body'); } };
    });
    Object.assign(env.context, { AI_WORKBENCH: true, $: selector => env.document.querySelector(selector) });
    await vm.runInContext(bootSource, env.context, { filename: 'extracted-workbench-boot.js' });
    assert.deepEqual(env.window.events.map(event => event.type), ['workbench:boot-fail'], failure);
    assert.match(env.window.events[0].detail.message, /超时或失败/, failure);
  }
});

test('splitScheduleDraft extracts, validates and strips the schedule json block', () => {
  const env = environment(() => { throw new Error('no fetch'); });
  vm.runInContext(`globalThis.split=${splitSource};`, env.context);
  const good = '回答正文。\n```json\n{"schedule":{"date":"2026-11-14","time":"15:00","title":"牙医","cat":"life"}}\n```';
  const r1 = env.context.split(good);
  assert.equal(JSON.stringify(r1.draft), JSON.stringify({ date:'2026-11-14', time:'15:00', title:'牙医', cat:'life' }));
  assert.equal(r1.display, '回答正文。');
  const r2 = env.context.split('没有草稿的回答');
  assert.equal(r2.draft, null); assert.equal(r2.display, '没有草稿的回答');
  assert.equal(env.context.split('```json\n{"schedule":{"date":"14号","title":"x"}}\n```').draft, null, 'bad date');
  assert.equal(env.context.split('```json\n{"schedule":{"date":"2026-11-14","time":"9:5","title":"  "}}\n```').draft, null, 'bad time/title');
  const r5 = env.context.split('```json\n{"schedule":{"date":"2026-11-14","cat":"junk","title":"购物"}}\n```');
  assert.equal(JSON.stringify(r5.draft), JSON.stringify({ date:'2026-11-14', time:'', title:'购物', cat:'life' }));
});

test('schedule card posts the memo only on confirm and syncs the calendar', async () => {
  const posts = [];
  const env = environment(async (path, options) => {
    assert.equal(path, '/api/workbench/memos'); assert.equal(options.method, 'POST');
    posts.push(JSON.parse(options.body));
    return reply({ ok: true, memo: {} });
  });
  vm.runInContext(`globalThis.card=${cardSource};`, env.context);
  const card = env.context.card({ date:'2026-11-14', time:'15:00', title:'牙医', cat:'life' });
  const add = card.children.find(c => c.tagName === 'button' && c.textContent === '添加到日历');
  await add.fire('click');
  assert.deepEqual(posts, [{ text:'15:00 牙医', date:'2026-11-14', cat:'life' }]);
  assert.equal(env.window.events.filter(e => e.type === 'workbench:memos-sync').length, 1);
  assert.equal(add.hidden, true);
  assert.match(card.children[0].textContent, /已加入日历/);
});

test('schedule card keeps the confirm button on failure', async () => {
  const env = environment(async () => reply({ ok: false, error: '内容不能为空' }, 400));
  vm.runInContext(`globalThis.card=${cardSource};`, env.context);
  const card = env.context.card({ date:'2026-11-14', time:'', title:'采购', cat:'work' });
  const add = card.children.find(c => c.tagName === 'button' && c.textContent === '添加到日历');
  await add.fire('click');
  assert.equal(add.disabled, false); assert.equal(add.hidden, false);
  assert.match(card.children[0].textContent, /添加失败/);
  assert.equal(env.window.events.length, 0);
});

test('runtime keeps a memos-sync listener that refreshes memos and rerenders', () => {
  assert.match(runtime, /workbench:memos-sync/);
  assert.match(runtime, /MEMOS = d\.items; renderAll\(\)/);
});
