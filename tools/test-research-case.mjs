/* Node 24 only. Research-case contract + loopback DI tests, not browser acceptance.
 * Default article paragraphs are SYNTHETIC TEST INPUT, never research results.
 * --reviewed-cache accepts an explicitly selected PUBLIC reader-cache fixture;
 * only its allowlisted article metadata/paragraphs are projected into memory.
 * The suite re-execs with an empty credential environment and a temporary HOME;
 * it never opens Key/DB files, runs server.js, or calls a real model.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import support from './learning-test-support.cjs';

const require = createRequire(import.meta.url);
const SELF = fileURLToPath(import.meta.url);
const { ROOT, assertNode24, cleanEnv, tempDir, removeTemp, suite, clone,
  fixtures, request, sourceQuery, pollJob, SESSIONS } = support;
const ARTICLE_URL = 'https://www.anthropic.com/research/agents-judgment-calls';
const ARTICLE_REF = Object.freeze({ kind: 'article', url: ARTICLE_URL });
const CASE_ID = 'agents-judgment-calls';
const CASE_VERSION = 1;
const cacheArg = process.argv.indexOf('--reviewed-cache');
const SELECTED_CACHE = cacheArg < 0 ? null : process.argv[cacheArg + 1];
if (cacheArg >= 0 && (!SELECTED_CACHE || !path.isAbsolute(SELECTED_CACHE))) {
  throw new TypeError('--reviewed-cache requires an explicitly selected absolute public fixture path');
}
assertNode24();

function articleState(entry) {
  const state = fixtures();
  // No model or display is allowed to mistake this label for research evidence.
  const synthetic = Array.from({ length: 7 }, (_, i) => [
    `SYNTHETIC TEST ONLY paragraph ${i + 1}. This fabricated cache is not Anthropic study evidence. ` +
    'It tests minimum excerpt length, exact provenance boundaries, and refusal of unreviewed data. '.repeat(6), ''
  ]);
  state.reader = { [ARTICLE_URL]: entry || { url: ARTICLE_URL, source: 'anth',
    title: 'SYNTHETIC TEST ONLY — not a study source', pub: '2026-10-01',
    fetchedAt: Date.UTC(2026, 9, 1), paras: synthetic } };
  return state;
}
function selectedPublicEntry(filename) {
  if (!filename) return null;
  const stat = fs.statSync(filename);
  assert.ok(stat.isFile() && stat.size < 1024 * 1024, 'Selected public fixture is a bounded JSON file');
  const record = JSON.parse(fs.readFileSync(filename, 'utf8'))[ARTICLE_URL];
  assert.ok(record && Array.isArray(record.paras), 'Selected fixture must contain the exact reviewed public article');
  // Intentionally do not retain comments, accounts, configuration, or other URLs.
  return { url: ARTICLE_URL, title: record.title, pub: record.pub, source: record.source,
    fetchedAt: record.fetchedAt, paras: record.paras.map(pair => Array.isArray(pair) ?
      [typeof pair[0] === 'string' ? pair[0] : '', typeof pair[1] === 'string' ? pair[1] : ''] : ['', '']) };
}
function resolve(backend, state, ref = ARTICLE_REF) {
  return backend.resolveSource(ref, { getBooks: () => state.books,
    getReader: () => state.reader, getDevices: () => state.devices }, SESSIONS.admin).source;
}
function generationBody(source, extra = {}) {
  return { sourceRef: clone(ARTICLE_REF), mode: 'curated', caseId: CASE_ID,
    sourceHash: source.hash, ...extra };
}

// Only these local loopback tests inherit a role. No authentication DB is opened.
async function startRig(backend, { state, registry, dataDir, chat } = {}) {
  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store', ...headers });
    res.end(JSON.stringify(body));
  };
  const readJson = async req => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
    catch { return {}; }
  };
  let calls = 0;
  const learning = backend.createLearning({ dataDir,
    getBooks: () => state.books, getReader: () => state.reader, getDevices: () => state.devices,
    chat: async (...args) => { calls++; if (chat) return chat(...args); throw new Error('UNEXPECTED_TEST_MODEL_CALL'); },
    json, readJson, ...(registry ? { reviewedCases: registry } : {}) });
  const errors = [];
  const server = http.createServer(async (req, res) => {
    const role = req.headers['x-test-role'] || 'admin';
    try {
      const handled = await learning.handle(req, res, new URL(req.url, 'http://127.0.0.1'),
        role === 'anonymous' ? null : SESSIONS[role]);
      if (!handled && !res.writableEnded) json(res, 404, { ok: false, error: 'TEST_UNHANDLED_ROUTE' });
    } catch (error) {
      errors.push(error);
      if (!res.headersSent) json(res, 500, { ok: false, error: 'UNCAUGHT_TEST_HANDLER' });
      else res.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  assert.notEqual(port, 8893, 'Tests must not use the preview service port');
  const base = 'http://127.0.0.1:' + port;
  return { state, errors, base, dataDir, get modelCalls() { return calls; },
    call: (method, url, body, role = 'admin') => request(base, method, url,
      { body, headers: { 'X-Test-Role': role, Origin: base } }),
    async stop() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    } };
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
function candidateOnly(doc) {
  return Object.fromEntries(['kind', 'title', 'goal', 'summary', 'components', 'limitations', 'cites']
    .filter(key => Object.hasOwn(doc, key)).map(key => [key, doc[key]]));
}
function descendants(node) { return node.children.flatMap(child => [child, ...descendants(child)]); }

// Small in-memory DOM only. It intentionally supplies no viewport geometry, web
// client, timer or layout engine: a mount must derive its numerical labels from
// the component, not a URL, viewport, or hard-coded article-specific diagram.
function makeDOM() {
  const matches = (node, selector) => {
    selector = selector.trim();
    if (selector.startsWith('.')) return node.className.split(/\s+/).includes(selector.slice(1));
    if (selector.startsWith('#')) return node.id === selector.slice(1);
    const attribute = /^\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]$/.exec(selector);
    if (attribute) return attribute[2] === undefined ? node.hasAttribute(attribute[1]) :
      node.getAttribute(attribute[1]) === attribute[2];
    return node.tagName === selector.toUpperCase();
  };
  class Node {
    constructor(tag, ownerDocument, namespaceURI = 'http://www.w3.org/1999/xhtml') {
      Object.assign(this, { tagName: tag.toUpperCase(), nodeName: tag.toUpperCase(), ownerDocument,
        namespaceURI, children: [], parentElement: null, attrs: {}, dataset: {}, events: {},
        className: '', _text: '', hidden: false, disabled: false, tabIndex: -1,
        style: { setProperty(key, value) { this[key] = String(value); }, removeProperty(key) { delete this[key]; } } });
      this.classList = {
        contains: name => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter(name => !names.includes(name)).join(' '); },
        toggle: (name, force) => {
          const next = force === undefined ? !this.classList.contains(name) : force;
          if (next) this.classList.add(name); else this.classList.remove(name);
          return next;
        }
      };
    }
    get parentNode() { return this.parentElement; }
    get childNodes() { return this.children; }
    get firstChild() { return this.children[0] || null; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set textContent(value) {
      this._text = String(value);
      this.children.forEach(child => { child.parentElement = null; });
      this.children = [];
    }
    append(...nodes) {
      for (let node of nodes) {
        if (!(node instanceof Node)) node = this.ownerDocument.createTextNode(String(node));
        assert.ok(!node.contains(this), 'No synthetic DOM cycle');
        if (node.parentElement) node.parentElement.removeChild(node);
        node.parentElement = this;
        this.children.push(node);
      }
    }
    appendChild(node) { this.append(node); return node; }
    removeChild(node) {
      const index = this.children.indexOf(node);
      assert.ok(index >= 0, 'Removed node must be a child');
      this.children.splice(index, 1);
      node.parentElement = null;
      return node;
    }
    remove() { if (this.parentElement) this.parentElement.removeChild(this); }
    replaceChildren(...nodes) { this.textContent = ''; this.append(...nodes); }
    contains(node) { return this === node || this.children.some(child => child.contains(node)); }
    setAttribute(key, value) {
      this.attrs[key] = String(value);
      if (key === 'class') this.className = String(value);
      if (key === 'id') this.id = String(value);
      if (key === 'hidden') this.hidden = true;
      if (key === 'tabindex') this.tabIndex = Number(value);
      if (key.startsWith('data-')) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(value);
    }
    getAttribute(key) {
      if (key === 'class') return this.className || null;
      if (key === 'id') return this.id || null;
      if (key.startsWith('data-')) return this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] ?? null;
      return this.attrs[key] ?? null;
    }
    hasAttribute(key) { return this.getAttribute(key) !== null; }
    removeAttribute(key) { delete this.attrs[key]; if (key === 'hidden') this.hidden = false; }
    addEventListener(type, handler) { (this.events[type] ||= []).push(handler); }
    removeEventListener(type, handler) { this.events[type] = (this.events[type] || []).filter(item => item !== handler); }
    fire(type, event = {}) { for (const fn of this.events[type] || []) fn({ target: this, preventDefault() {}, ...event }); }
    querySelectorAll(selector) { return descendants(this).filter(node => selector.split(',').some(part => matches(node, part))); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    closest(selector) { return matches(this, selector) ? this : this.parentElement?.closest(selector) || null; }
    focus() { this.ownerDocument.activeElement = this; }
  }
  const document = {
    activeElement: null,
    createElement(tag) { return new Node(tag, this); },
    createElementNS(namespace, tag) { return new Node(tag, this, namespace); },
    createTextNode(text) { const node = new Node('#text', this, null); node.textContent = text; return node; }
  };
  return { document, host: document.createElement('section') };
}

async function run() {
  const t = suite('research case (Node 24; ' + (SELECTED_CACHE ? 'explicit public + synthetic sources' : 'synthetic sources') + '; zero external I/O)');
  let backend, cases, visual;
  await t.test('actual backend, pure case API, and UMD renderer exports are present', () => {
    backend = require(path.join(ROOT, 'learning.js'));
    cases = require(path.join(ROOT, 'learning-cases.js'));
    visual = require(path.join(ROOT, 'research-visual.js'));
    t.equal(typeof backend.createLearning, 'function');
    t.equal(typeof cases.createReviewedCaseRegistry, 'function');
    t.equal(typeof cases.buildReviewedCase, 'function');
    t.equal(typeof cases.validateResearchStudy, 'function');
    t.equal(typeof visual.validate, 'function');
    t.equal(typeof visual.mount, 'function');
  });
  if (backend && cases && visual) await runResearchTests(t, backend, cases, visual);
  console.log('LIMIT: synthetic quote fixtures are test-only, not verified study evidence or a demo seed.');
  console.log('LIMIT: in-memory DOM is not browser layout, viewport, keyboard or screenshot acceptance.');
  t.finish();
}

async function runResearchTests(t, backend, cases, visual) {
  const syntheticState = articleState();
  const syntheticSource = resolve(backend, syntheticState);
  const denied = (response, code, status) => {
    t.equal(response.json?.ok, false, response.text);
    t.ok(response.status >= 400 && response.status < 500, response.text);
    if (status) t.equal(response.status, status, response.text);
    if (code) t.equal(response.json?.code, code, response.text);
    t.ok(!response.json?.document && !response.json?.job, 'Rejected request must not reveal or create a draft');
  };
  const withRig = async (options, body) => {
    const dir = tempDir('taller-learning-research-');
    const state = options.state || articleState();
    // A temporary publication sentinel, never the repository's public cache.
    const publication = path.join(dir, 'workbench-reader.json');
    fs.writeFileSync(publication, JSON.stringify(state.reader), { mode: 0o600 });
    const publicationBefore = fs.readFileSync(publication);
    const memoryBefore = JSON.stringify(state);
    let rig;
    try {
      rig = await startRig(backend, { ...options, state, dataDir: dir });
      await body(rig, dir);
      t.equal(rig.errors.length, 0, 'Expected rejections must not escape the HTTP module');
      t.deepEqual(fs.readFileSync(publication), publicationBefore, 'Original publication stays byte-for-byte read-only');
      if (!options.mutatesSource) t.equal(JSON.stringify(state), memoryBefore, 'DI source collections remain read-only');
    } finally {
      if (rig) await rig.stop();
      removeTemp(dir);
    }
  };

  await t.test('default article curated mode is disabled; a request cannot self-approve a case', async () => {
    await withRig({}, async rig => {
      const status = await rig.call('GET', sourceQuery(ARTICLE_REF));
      t.equal(status.status, 200, status.text);
      t.ok(!status.json?.source?.curatedCase, 'No reviewed capability is advertised by default');
      denied(await rig.call('POST', '/api/learning/generate', generationBody(syntheticSource)));
      denied(await rig.call('POST', '/api/learning/generate', generationBody(syntheticSource,
        { reviewedCases: { id: CASE_ID, version: CASE_VERSION } })), 'invalid_request', 400);
      t.equal(rig.modelCalls, 0);
    });
  });

  await t.test('unsupported or synthetic article hashes cannot enter the frozen reviewed registry', () => {
    const before = JSON.stringify(syntheticSource);
    const registry = cases.createReviewedCaseRegistry({ sources: [syntheticSource] });
    t.equal(Object.isFrozen(registry), true);
    t.equal(registry.get(syntheticSource), null);
    const otherURL = clone(syntheticSource);
    otherURL.sourceRef.url = 'https://www.anthropic.com/research/unreviewed-local-fixture';
    t.equal(registry.get(otherURL), null);
    t.throws(() => registry.build(syntheticSource, { caseId: CASE_ID,
      caseVersion: CASE_VERSION, sourceHash: syntheticSource.hash }));
    t.equal(JSON.stringify(syntheticSource), before, 'Registry registration must not mutate source evidence');
  });

  await t.test('synthetic source remains unreviewed even when an empty registry is injected', async () => {
    const registry = cases.createReviewedCaseRegistry({ sources: [syntheticSource] });
    await withRig({ registry }, async rig => {
      const status = await rig.call('GET', sourceQuery(ARTICLE_REF));
      t.equal(status.status, 200, status.text);
      t.ok(!status.json?.source?.curatedCase, 'An injected but empty registry grants no curated capability');
      denied(await rig.call('POST', '/api/learning/generate', generationBody(syntheticSource)), 'needs_source', 422);
      t.equal(rig.modelCalls, 0);
    });
  });

  await t.test('only the exact same-origin admin can request article generation', async () => {
    const registry = cases.createReviewedCaseRegistry({ sources: [syntheticSource] });
    await withRig({ registry }, async rig => {
      for (const role of ['user', 'family', 'mustChange', 'anonymous']) {
        denied(await rig.call('POST', '/api/learning/generate', generationBody(syntheticSource), role),
          role === 'anonymous' ? 'unauthorized' : role === 'mustChange' ? 'password_change_required' : 'forbidden',
          role === 'anonymous' ? 401 : 403);
        denied(await rig.call('GET', sourceQuery(ARTICLE_REF), undefined, role),
          role === 'anonymous' ? 'unauthorized' : role === 'mustChange' ? 'password_change_required' : 'forbidden',
          role === 'anonymous' ? 401 : 403);
      }
      const crossOrigin = await request(rig.base, 'POST', '/api/learning/generate', {
        body: generationBody(syntheticSource), headers: { 'X-Test-Role': 'admin', Origin: 'https://untrusted.example' }
      });
      denied(crossOrigin, 'invalid_origin', 403);
      t.equal(rig.modelCalls, 0);
    });
  });

  await t.test('insufficient cached article remains needs_source with no model or publication writes', async () => {
    const state = articleState();
    state.reader[ARTICLE_URL].paras = [['SYNTHETIC TEST ONLY: insufficient source.', '']];
    const shortSource = resolve(backend, state);
    await withRig({ state }, async rig => {
      denied(await rig.call('POST', '/api/learning/generate', { sourceRef: ARTICLE_REF, mode: 'model' }), 'needs_source', 422);
      const registry = cases.createReviewedCaseRegistry({ sources: [shortSource] });
      t.equal(registry.get(shortSource), null);
      t.equal(rig.modelCalls, 0);
    });
  });

  await testRendererSafety(t, visual);
  const publicEntry = selectedPublicEntry(SELECTED_CACHE);
  if (!publicEntry) {
    const syntheticComponent = makeSyntheticComponent();
    await testNumericMount(t, visual, syntheticComponent, {
      blocks: syntheticComponent.evidence.map(item => ({ id: item.blockId,
        text: item.quote, location: 'SYNTHETIC TEST ONLY' }))
    });
    t.skip('hash-pinned actual article schema, evidence and HTTP draft/approve/stale',
      'Pass --reviewed-cache /absolute/path/to/explicit-public-fixture.json; no implicit repository data read.');
    return;
  }
  const state = articleState(publicEntry);
  const source = resolve(backend, state);
  const registry = cases.createReviewedCaseRegistry({ sources: [source] });
  const descriptor = registry.get(source);
  await t.test('explicit public fixture matches the reviewed source hash and immutable case descriptor', () => {
    t.equal(descriptor?.id, CASE_ID, 'The selected fixture must be the audited version, not a synthetic substitute');
    t.equal(descriptor?.version, CASE_VERSION);
    t.equal(descriptor?.sourceHash, source.hash);
    t.equal(Object.isFrozen(registry), true);
  });
  if (!descriptor) return;
  const candidate = registry.build(source, { caseId: CASE_ID, caseVersion: CASE_VERSION, sourceHash: source.hash });
  const component = candidate.components.find(item => item.type === 'research-study');
  await testReviewedSchema(t, backend, cases, visual, source, candidate, component, registry);
  await testReviewedHTTP(t, { backend, cases, withRig, denied, source, publicEntry, candidate });
  await testNumericMount(t, visual, component, source);
}

async function testRendererSafety(t, visual) {
  await t.test('renderer is valid UMD, import-side-effect free, and never interprets markup or fetches', () => {
    const filename = path.join(ROOT, 'research-visual.js');
    const script = fs.readFileSync(filename, 'utf8');
    const context = vm.createContext({ console });
    context.window = context;
    new vm.Script(script, { filename }).runInContext(context, { timeout: 1500 });
    t.equal(typeof context.window.TallerResearchVisual?.mount, 'function');
    t.equal(typeof context.window.TallerResearchVisual?.validate, 'function');
    t.equal(/\b(?:innerHTML|outerHTML|insertAdjacentHTML|eval|fetch|XMLHttpRequest)\b|new\s+Function\b/.test(script), false,
      'All source and model text must be inert; no HTTP or interpreted markup');
    for (const invalid of [null, {}, [], { type: 'research-study' }]) {
      const result = visual.validate(invalid);
      t.equal(result?.ok, false);
      t.ok(Array.isArray(result?.errors) && result.errors.length > 0);
      const { host } = makeDOM();
      t.throws(() => visual.mount(host, invalid, {}), error =>
        error instanceof TypeError && Array.isArray(error.validationErrors));
      t.equal(host.children.length, 0, 'Invalid mount leaves no partial diagram');
    }
  });
}

async function testReviewedSchema(t, backend, cases, visual, source, candidate, component, registry) {
  const binding = { caseId: CASE_ID, caseVersion: CASE_VERSION, sourceHash: source.hash };
  const invalidCase = error => error instanceof cases.ReviewedCaseError &&
    ['invalid_document', 'needs_source'].includes(error.code);
  await t.test('case manifest, every expected evidence item and exact group provenance are bound to cached text', () => {
    const manifest = cases.reviewedCaseManifest(source);
    t.equal(manifest.id, CASE_ID);
    t.equal(manifest.version, CASE_VERSION);
    t.equal(manifest.sourceHash, source.hash);
    t.deepEqual(cases.buildReviewedCase(source, binding), candidate);
    t.equal(component?.type, 'research-study');
    t.equal(component?.caseId, CASE_ID);
    t.equal(component?.caseVersion, CASE_VERSION);
    t.equal(component?.origin, 'source');
    t.deepEqual(component.evidence.map(({ id, blockId }) => [id, blockId]), [
      ['recruited', 'article_p9'], ['participants', 'article_p15'],
      ['analytical_choices', 'article_p4'], ['randomization', 'article_p14'],
      ['alignment', 'article_p17'], ['baseline', 'article_p5'],
      ['switching_sample', 'article_p19'], ['switching_rates', 'article_p19'],
      ['switching_interval', 'article_p19'], ['switching_causality', 'article_p19'],
      ['strengthened_lean', 'article_p7'], ['comparability', 'article_p25'],
      ['task_model', 'article_p15']
    ], 'A valid case must carry every reviewed result AND caveat, not just convenient numbers');
    t.equal(new Set(component.evidence.map(item => item.id)).size, 13);
    t.deepEqual(component.evidence, manifest.evidence);
    const blocks = new Map(source.blocks.map(block => [block.id, block]));
    const normalize = text => text.replace(/\s+/gu, ' ').trim();
    for (const evidence of component.evidence) {
      t.ok(typeof evidence.quote === 'string' && evidence.quote.length > 0);
      t.ok(blocks.has(evidence.blockId));
      t.ok(normalize(blocks.get(evidence.blockId).text).includes(normalize(evidence.quote)),
        'Exact quote must exist in its own cited original block: ' + evidence.id);
    }
    for (const [group, expected] of [
      ['participants', ['article_p9', 'article_p15', 'article_p25']],
      ['randomization', ['article_p4', 'article_p14']],
      ['alignment', ['article_p15', 'article_p17', 'article_p5']],
      ['switching', ['article_p19']]
    ]) t.deepEqual(component[group].cites, expected);
    t.ok(component.limitations.length >= 5, 'No curated diagram without limitations');
    t.deepEqual(cases.validateResearchStudy(component, source), component);
    t.equal(visual.validate(component).ok, true);
    t.equal(JSON.stringify(registry.build(source, binding)), JSON.stringify(candidate),
      'Repeated pure construction is deterministic');
  });
  await t.test('reviewed case numbers preserve the exact denominator, allocation and uncertainty semantics', () => {
    t.deepEqual(component.participants, { recruited: 61, used: 50, declined: 11,
      allocation: 'self-selected', cites: ['article_p9', 'article_p15', 'article_p25'] });
    t.deepEqual(component.randomization, { unit: 'analyst-decision', decisions: 5,
      analyticalChoices: 4, cites: ['article_p4', 'article_p14'] });
    t.deepEqual(component.alignment, { value: 86, baseline: 50, unit: 'percent', baselineType: 'theoretical-null',
      population: '50名使用者的四项分析选择合并', denominator: null,
      cites: ['article_p15', 'article_p17', 'article_p5'] });
    t.deepEqual(component.switching, { against: 60, agrees: 6, totalCases: 38, caseUnit: 'decision-situations',
      unit: 'percent', groupSizes: null, delta: 54,
      ci: { level: 95, lower: 24, upper: 82, unit: 'percentage-points' }, cites: ['article_p19'] });
    t.ok(!Object.hasOwn(component.alignment, 'numerator'), 'Do not derive 172/200 or 43 people');
    t.ok(!Object.hasOwn(component.switching, 'counts'), 'Do not invent either switching subgroup count');
  });
  const schemaMutations = [
    ['participants fail conservation', c => { c.participants.recruited = 62; }],
    ['participants negative', c => { c.participants.declined = -1; }],
    ['participant allocation is not randomized', c => { c.participants.allocation = 'randomized'; }],
    ['wrong randomization unit', c => { c.randomization.unit = 'participant'; }],
    ['five includes final decision', c => { c.randomization.decisions = 4; }],
    ['analytical choice count invalid', c => { c.randomization.analyticalChoices = 5; }],
    ['alignment exceeds percentage range', c => { c.alignment.value = 101; }],
    ['alignment is finite', c => { c.alignment.value = Infinity; }],
    ['alignment must not be NaN', c => { c.alignment.value = NaN; }],
    ['theoretical baseline is not an observed control', c => { c.alignment.baselineType = 'observed-control'; }],
    ['alignment denominator remains unknown', c => { c.alignment.denominator = 200; }],
    ['38 are situations not people', c => { c.switching.caseUnit = 'participants'; }],
    ['switching unknown subgroup sizes', c => { c.switching.groupSizes = [19, 19]; }],
    ['switching rates out of range', c => { c.switching.against = -1; }],
    ['delta must equal rate difference', c => { c.switching.delta = 53; }],
    ['CI cannot be reversed', c => { c.switching.ci.lower = 82; c.switching.ci.upper = 24; }],
    ['CI must contain difference', c => { c.switching.ci.lower = 55; }],
    ['CI outside probability difference range', c => { c.switching.ci.upper = 101; }],
    ['CI is percentage points not percentage', c => { c.switching.ci.unit = 'percent'; }],
    ['missing quote', c => { delete c.evidence[0].quote; }],
    ['empty quote', c => { c.evidence[0].quote = ''; }],
    ['fabricated quote', c => { c.evidence[0].quote = 'SYNTHETIC fabricated statement absent from source.'; }],
    ['wrong evidence block', c => { c.evidence[0].blockId = 'article_p99'; }],
    ['duplicate evidence id', c => { c.evidence[1].id = c.evidence[0].id; }],
    ['missing expected caveat evidence', c => { c.evidence = c.evidence.filter(e => e.id !== 'comparability'); }],
    ['missing participants cites', c => { delete c.participants.cites; }],
    ['empty randomization cites', c => { c.randomization.cites = []; }],
    ['alignment cite not in evidence', c => { c.alignment.cites = ['article_p1']; }],
    ['duplicate switching cites', c => { c.switching.cites.push('article_p19'); }],
    ['missing limitations', c => { c.limitations = []; }],
    ['unsafe title markup', c => { c.title = '<img src=x onerror=alert(1)>'; }],
    ['case version number required', c => { c.caseVersion = '1'; }],
    ['unknown case id', c => { c.caseId = 'unreviewed-case'; }],
    ['invented count field', c => { c.alignment.numerator = 172; }]
  ];
  await t.test('pure backend schema rejects invalid conservation, evidence/cites, intervals and authority', () => {
    for (const [label, mutate] of schemaMutations) {
      const invalid = clone(component);
      mutate(invalid);
      t.throws(() => cases.validateResearchStudy(invalid, source), invalidCase, label);
    }
    // Structurally consistent counterfactuals are useful renderer input, but are
    // NOT reviewed facts for this case/version and must fail backend equality.
    const altered = numericalVariant(component);
    t.throws(() => cases.validateResearchStudy(altered, source), invalidCase,
      'Backend must reject plausible but unreviewed replacement facts');
  });
  await t.test('reviewed URL/hash cannot be forged; missing quotes/caveats break the independent text seal', () => {
    for (const [label, mutate] of [
      ['unsupported URL', s => { s.sourceRef.url = 'https://www.anthropic.com/research/unreviewed-case'; }],
      ['unsupported kind', s => { s.kind = 'kb'; }],
      ['stale hash', s => { s.hash = '0'.repeat(64); }],
      ['missing reviewed evidence block', s => { s.blocks = s.blocks.filter(b => b.id !== 'article_p19'); }],
      ['forged .hash after text change', s => { s.blocks.find(b => b.id === 'article_p19').text += ' SYNTHETIC TEST REVISION.'; }],
      ['duplicate block identity', s => { s.blocks.push(clone(s.blocks[0])); }],
      ['false completeness', s => { s.completeness = 'verified'; }]
    ]) {
      const invalid = clone(source); mutate(invalid);
      t.equal(registry.get(invalid), null, label);
      t.throws(() => cases.buildReviewedCase(invalid, binding), invalidCase, label);
    }
    for (const invalidBinding of [{ ...binding, caseId: 'unknown' }, { ...binding, caseVersion: 2 },
      { ...binding, sourceHash: '0'.repeat(64) }]) {
      t.throws(() => registry.build(source, invalidBinding), invalidCase);
    }
    t.deepEqual(backend.validateDocument(candidate, source), candidate,
      'Pure document validation round-trips a reviewed component; model authority is separately gated by HTTP generation');
  });
}
function numericalVariant(component) {
  const changed = clone(component);
  changed.participants.recruited = 73;
  changed.participants.used = 58;
  changed.participants.declined = 15;
  changed.randomization.decisions = 7;
  changed.randomization.analyticalChoices = 6;
  changed.alignment.value = 79;
  changed.alignment.baseline = 40;
  changed.alignment.population = 'SYNTHETIC TEST ONLY pooled decisions; no reviewed real-world claim';
  changed.switching.against = 67;
  changed.switching.agrees = 9;
  changed.switching.totalCases = 47;
  changed.switching.delta = 58;
  changed.switching.ci.lower = 23;
  changed.switching.ci.upper = 87;
  return changed;
}
async function testReviewedHTTP(t, { backend, cases, withRig, denied, source, publicEntry, candidate }) {
  const createState = () => articleState(clone(publicEntry));
  const createRegistry = () => cases.createReviewedCaseRegistry({ sources: [source] });
  const generate = async rig => {
    const response = await rig.call('POST', '/api/learning/generate', generationBody(source));
    t.equal(response.status, 202, response.text);
    t.equal(response.json?.ok, true);
    const terminal = await pollJob(rig.call, response.json.job.id);
    t.equal(terminal.json?.job?.state, 'draft');
    return terminal.json.job;
  };
  await t.test('unknown/stale curated requests fail closed before a job or model call', async () => {
    await withRig({ state: createState(), registry: createRegistry() }, async rig => {
      const before = await rig.call('GET', '/api/learning/jobs');
      for (const extra of [
        { caseId: 'unknown-reviewed-case' }, { sourceHash: '0'.repeat(64) },
        { sourceHash: '' }, { caseId: '' }, { caseVersion: 99 },
        { component: { type: 'research-study' } }
      ]) denied(await rig.call('POST', '/api/learning/generate', generationBody(source, extra)));
      const after = await rig.call('GET', '/api/learning/jobs');
      t.deepEqual(after.json?.jobs, before.json?.jobs, 'Rejected requests must not persist queue entries');
      t.equal(rig.modelCalls, 0);
    });
  });
  await t.test('curated actual article produces one deduplicated unapproved draft, with zero chat', async () => {
    await withRig({ state: createState(), registry: createRegistry() }, async (rig, dir) => {
      const status = await rig.call('GET', sourceQuery(ARTICLE_REF));
      t.equal(status.status, 200, status.text);
      t.equal(status.json?.source?.curatedCase?.id, CASE_ID);
      t.equal(status.json?.source?.curatedCase?.version, CASE_VERSION);
      const [a, b] = await Promise.all([
        rig.call('POST', '/api/learning/generate', generationBody(source)),
        rig.call('POST', '/api/learning/generate', generationBody(source))
      ]);
      t.equal(a.status, 202, a.text);
      t.equal(b.status, 202, b.text);
      t.equal(a.json?.job?.id, b.json?.job?.id);
      const terminal = await pollJob(rig.call, a.json.job.id);
      const job = terminal.json.job;
      t.equal(job.state, 'draft');
      const draft = await rig.call('GET', '/api/learning/' + job.documentId);
      t.equal(draft.status, 200, draft.text);
      t.equal(draft.json?.state, 'draft');
      t.equal(draft.json?.document?.state, 'draft', 'Generation never auto-approves');
      t.equal(draft.json?.document?.sourceHash, source.hash);
      t.equal(draft.json?.document?.generator?.type, 'curated');
      t.deepEqual(draft.json?.document?.components, candidate.components);
      t.ok(!draft.json?.document?.approvedAt);
      const again = await rig.call('POST', '/api/learning/generate', generationBody(source));
      t.equal(again.json?.job?.id, job.id);
      t.equal(again.json?.job?.documentId, job.documentId);
      const stored = JSON.parse(fs.readFileSync(path.join(dir, 'learning/state.json'), 'utf8'));
      t.equal(stored.documents.length, 1);
      t.equal(stored.jobs.length, 1);
      t.equal(stored.documents[0].state, 'draft');
      t.equal(rig.modelCalls, 0);
    });
  });
  await t.test('research approval remains explicit admin-only; original article stays private and read-only', async () => {
    await withRig({ state: createState(), registry: createRegistry() }, async rig => {
      const job = await generate(rig);
      for (const role of ['user', 'family', 'mustChange', 'anonymous']) {
        denied(await rig.call('POST', '/api/learning/' + job.documentId + '/approve', { sourceHash: source.hash }, role),
          role === 'anonymous' ? 'unauthorized' : role === 'mustChange' ? 'password_change_required' : 'forbidden',
          role === 'anonymous' ? 401 : 403);
      }
      for (const role of ['user', 'family']) {
        denied(await rig.call('GET', '/api/learning/' + job.documentId, undefined, role), 'not_found', 404);
        denied(await rig.call('GET', sourceQuery(ARTICLE_REF), undefined, role), 'forbidden', 403);
      }
      denied(await rig.call('POST', '/api/learning/' + job.documentId + '/approve', { sourceHash: '0'.repeat(64) }), 'source_changed', 409);
      const approved = await rig.call('POST', '/api/learning/' + job.documentId + '/approve', { sourceHash: source.hash });
      t.equal(approved.status, 200, approved.text);
      t.equal(approved.json?.state, 'approved');
      t.equal(approved.json?.document?.state, 'approved');
      for (const role of ['user', 'family']) {
        denied(await rig.call('GET', '/api/learning/' + job.documentId, undefined, role), 'not_found', 404);
      }
      t.equal(rig.modelCalls, 0);
    });
  });
  await t.test('changed public-cache bytes invalidate review pin, old draft and approval', async () => {
    await withRig({ state: createState(), registry: createRegistry(), mutatesSource: true }, async rig => {
      const job = await generate(rig);
      const entry = rig.state.reader[ARTICLE_URL];
      entry.paras[0][0] += ' SYNTHETIC TEST REVISION: invalidates the reviewed hash.';
      const changed = resolve(backend, rig.state);
      t.notEqual(changed.hash, source.hash);
      const status = await rig.call('GET', sourceQuery(ARTICLE_REF));
      t.equal(status.status, 200, status.text);
      t.equal(status.json?.state, 'stale');
      t.equal(status.json?.currentSourceHash, changed.hash);
      denied(await rig.call('POST', '/api/learning/' + job.documentId + '/approve', { sourceHash: source.hash }), 'source_changed', 409);
      denied(await rig.call('POST', '/api/learning/generate', generationBody(source)));
      denied(await rig.call('POST', '/api/learning/generate', generationBody(changed)));
      t.equal(createRegistry().get(changed), null);
      t.equal(rig.modelCalls, 0);
    });
  });
  await t.test('an injected model cannot forge reviewed research-study authority, even with valid-looking data', async () => {
    await withRig({ state: createState(), registry: createRegistry(),
      chat: async () => JSON.stringify(candidate) }, async rig => {
      const result = await rig.call('POST', '/api/learning/generate', { sourceRef: ARTICLE_REF, mode: 'model' });
      t.equal(result.status, 202, result.text);
      const terminal = await pollJob(rig.call, result.json.job.id, 'failed');
      t.equal(terminal.json?.job?.error?.code, 'invalid_document');
      t.ok(!terminal.json?.job?.documentId);
      t.equal(rig.modelCalls, 1, 'Only the explicitly injected fake model was called');
      const status = await rig.call('GET', sourceQuery(ARTICLE_REF));
      t.ok(!status.json?.document, 'Forged model component never becomes a draft');
    });
  });
}
function makeSyntheticComponent() {
  // A renderer-only counterfactual, intentionally rejected by the backend review
  // pin. Its label, evidence quotes, population and limitations are all fabricated.
  const ids = ['participants', 'randomization', 'alignment', 'switching'];
  const cite = key => ['synthetic_' + key];
  return { type: 'research-study', title: 'SYNTHETIC TEST ONLY — renderer input, not study results',
    origin: 'source', caseId: CASE_ID, caseVersion: CASE_VERSION,
    evidence: ids.map(key => ({ id: 'fixture_' + key, blockId: 'synthetic_' + key,
      quote: 'SYNTHETIC TEST ONLY: fabricated ' + key + ' evidence; not verified research.' })),
    participants: { recruited: 61, used: 50, declined: 11, allocation: 'self-selected', cites: cite('participants') },
    randomization: { unit: 'analyst-decision', decisions: 5, analyticalChoices: 4, cites: cite('randomization') },
    alignment: { value: 86, baseline: 50, unit: 'percent', baselineType: 'theoretical-null',
      population: 'SYNTHETIC TEST ONLY: pooled fixture decisions', denominator: null, cites: cite('alignment') },
    switching: { against: 60, agrees: 6, totalCases: 38, caseUnit: 'decision-situations', unit: 'percent',
      groupSizes: null, delta: 54, ci: { level: 95, lower: 24, upper: 82, unit: 'percentage-points' },
      cites: cite('switching') },
    limitations: ['SYNTHETIC TEST ONLY: invented numerical renderer fixture, not a reviewed research result.'] };
}
async function testNumericMount(t, visual, component, source) {
  await t.test('renderer numeric validation is independent of the article URL and viewport', () => {
    t.equal(visual.validate(component).ok, true);
    const altered = numericalVariant(component);
    t.equal(visual.validate(altered).ok, true,
      'Renderer accepts coherent changed numbers: exact reviewed facts are enforced only by the backend');
    for (const [label, mutate] of [
      ['conservation', c => { c.participants.used++; }],
      ['negative participant count', c => { c.participants.declined = -1; }],
      ['percent range', c => { c.alignment.value = 101; }],
      ['nonfinite value', c => { c.switching.against = Infinity; }],
      ['NaN', c => { c.alignment.baseline = NaN; }],
      ['invented denominator', c => { c.alignment.denominator = 200; }],
      ['invented group sizes', c => { c.switching.groupSizes = [19, 19]; }],
      ['difference mismatch', c => { c.switching.delta = 53; }],
      ['interval outside range', c => { c.switching.ci.upper = 101; }],
      ['interval reversed', c => { c.switching.ci.lower = 82; c.switching.ci.upper = 24; }],
      ['interval misses estimate', c => { c.switching.ci.lower = 55; }],
      ['missing evidence quote', c => { c.evidence[0].quote = ''; }],
      ['missing cites', c => { c.participants.cites = []; }],
      ['unknown cite', c => { c.switching.cites = ['unknown_fixture_block']; }]
    ]) {
      const invalid = clone(component); mutate(invalid);
      const result = visual.validate(invalid);
      t.equal(result?.ok, false, label);
      t.ok(Array.isArray(result?.errors) && result.errors.length > 0, label);
    }
  });
  await t.test('real renderer mounts changed data as labels/geometry and returns a disposable evidence interface', () => {
    const altered = numericalVariant(component);
    const frozenSource = freeze(clone(source));
    const frozenOriginal = freeze(clone(component));
    const frozenAltered = freeze(clone(altered));
    const mount = input => {
      const dom = makeDOM();
      const calls = [];
      const beforeSource = JSON.stringify(frozenSource), beforeInput = JSON.stringify(input);
      const mounted = visual.mount(dom.host, input, { source: frozenSource,
        onEvidence: (...args) => calls.push(args) });
      const destroy = typeof mounted === 'function' ? mounted : mounted?.destroy?.bind(mounted);
      t.equal(typeof destroy, 'function', 'mount returns destroy or an object with destroy()');
      t.ok(dom.host.querySelector('.research-study-visual') || dom.host.classList.contains('research-study-visual'));
      t.ok(dom.host.textContent.length > 0);
      t.equal(JSON.stringify(input), beforeInput, 'Renderer never rewrites the component');
      t.equal(JSON.stringify(frozenSource), beforeSource, 'Renderer never rewrites source evidence');
      return { ...dom, calls, destroy };
    };
    const original = mount(frozenOriginal), changed = mount(frozenAltered);
    try {
      const nodes = descendants(changed.host);
      const text = nodes.map(node => node._text).filter(Boolean).join('\n');
      for (const number of [73, 58, 15, 79, 40, 67, 9, 47, 23, 87]) {
        t.match(text, new RegExp('(?:^|[^0-9])' + number + '(?:[^0-9]|$)'),
          'Numerical label must come from the changed payload: ' + number);
      }
      t.notEqual(original.host.textContent, changed.host.textContent,
        'Mount cannot be a fixed scene selected only by case ID or URL');
      t.equal(changed.host.querySelectorAll('.rsv-dot-used').length, altered.participants.used);
      t.equal(changed.host.querySelectorAll('.rsv-dot-declined').length, altered.participants.declined);
      t.equal(changed.host.querySelectorAll('.rsv-lean').length, altered.randomization.decisions);
      const observedWidth = Number(changed.host.querySelector('.rsv-observed-bar').getAttribute('width'));
      const originalWidth = Number(original.host.querySelector('.rsv-observed-bar').getAttribute('width'));
      t.ok(Math.abs(observedWidth / originalWidth - altered.alignment.value / component.alignment.value) < 1e-10,
        'Observed bar length scales with the actual payload, not just text');
      const geometricKeys = ['x', 'y', 'width', 'height', 'cx', 'cy', 'r', 'x1', 'x2', 'y1', 'y2', 'd', 'viewBox'];
      const geometry = host => descendants(host).filter(node => node.namespaceURI === 'http://www.w3.org/2000/svg')
        .map(node => ({ tag: node.tagName, coordinates: Object.fromEntries(geometricKeys
          .filter(key => node.hasAttribute(key)).map(key => [key, node.getAttribute(key)])) }));
      t.notEqual(JSON.stringify(geometry(original.host)), JSON.stringify(geometry(changed.host)),
        'Chart geometry changes with input, independently of generated IDs and labels');
      const evidenceButton = nodes.find(node => node.tagName === 'BUTTON' && (node.events.click || []).length > 0);
      t.ok(evidenceButton, 'Evidence is an actual interactive button');
      evidenceButton.fire('click');
      t.ok(changed.calls.length > 0, 'Evidence click reaches the supplied callback');
      const known = new Set(component.evidence.flatMap(item => [item.id, item.blockId]));
      const selected = JSON.stringify(changed.calls[0]);
      t.ok([...known].some(id => selected.includes(id)), 'Callback retains source/evidence identifiers');
    } finally {
      original.destroy(); changed.destroy();
      original.destroy(); changed.destroy();
    }
    t.equal(original.host.children.length, 0, 'destroy clears mounted diagram');
    t.equal(changed.host.children.length, 0);
  });
}

if (process.argv.includes('--isolated-worker')) {
  await run();
} else {
  const dir = tempDir('taller-learning-research-run-');
  try {
    const child = spawn(process.execPath, ['--require', path.join(ROOT, 'tools/learning-test-support.cjs'),
      SELF, '--isolated-worker', ...(SELECTED_CACHE ? ['--reviewed-cache', SELECTED_CACHE] : [])],
      { cwd: dir, env: cleanEnv(dir), stdio: ['ignore', 'inherit', 'inherit'] });
    const exit = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', (code, signal) => resolve({ code, signal }));
    });
    process.exitCode = exit.code ?? 1;
    if (exit.signal) console.error('Research test child ended by signal ' + exit.signal);
  } finally { removeTemp(dir); }
}
