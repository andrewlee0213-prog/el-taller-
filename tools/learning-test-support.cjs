"use strict";

// Shared only by the isolated learning tests. Never opens the repository's data/.
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

const ROOT = path.resolve(__dirname, "..");
const NODE24 = process.execPath;
const ARTICLE_URL = "https://www.anthropic.com/research/learning-local-fixture";
const UNCACHED_URL = "https://www.anthropic.com/research/learning-uncached-fixture";
const RAG_REF = Object.freeze({ kind: "kb", bookId: "agent-handbook", chapterId: "ch4" });
const DALA_REF = Object.freeze({ kind: "dala" });
const ARTICLE_REF = Object.freeze({ kind: "article", url: ARTICLE_URL });
const SESSIONS = Object.freeze({
  admin: { u: "lt-admin", r: "admin", mc: false },
  user: { u: "lt-user", r: "user", mc: false },
  family: { u: "lt-family", r: "family", mc: false },
  mustChange: { u: "lt-must-change", r: "admin", mc: true },
});
const ACCOUNTS = Object.freeze({
  admin: { username: "lt-admin", password: "LocalLearning-admin-2026!", role: "admin", mustChange: false },
  user: { username: "lt-user", password: "LocalLearning-user-2026!", role: "user", mustChange: false },
  family: { username: "lt-family", password: "LocalLearning-family-2026!", role: "family", mustChange: false },
  mustChange: { username: "lt-must-change", password: "LocalLearning-change-2026!", role: "admin", mustChange: true },
});

function assertNode24() {
  assert.equal(Number(process.versions.node.split(".")[0]), 24,
    "Run this test with Node 24; child processes use exactly process.execPath.");
}

function clone(value) { return structuredClone(value); }
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function writeJson(filename, data) {
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(filename, JSON.stringify(data, null, 2), { mode: 0o600 });
}
function tempDir(prefix = "taller-learning-") {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}
function removeTemp(dir) {
  assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep));
  assert.ok(path.basename(dir).startsWith("taller-learning-"));
  fs.rmSync(dir, { recursive: true, force: true });
}
function fixtures() {
  // Stable cache identity is required when a killed worker reconstructs the same fixture.
  const now = Date.UTC(2026, 9, 1, 12, 0, 0);
  const devices = [
    { name: "Fixture Air Glass", cat: "AR眼镜", lens: 1, brand: "Fixture", collects: "头部方向", shows: "导航提示", status: "已发布", heat: 3,
      firstSeen: "2026-10-01", lastSeen: "2026-10-28", url: "https://example.test/glass", src: "本地测试夹具", prices: [] },
    { name: "Fixture Health Ring", cat: "健康穿戴", lens: 2, brand: "Fixture", collects: "心率趋势", shows: "训练摘要", status: "已发布", heat: 2,
      firstSeen: "2026-10-01", lastSeen: "2026-10-28", url: "https://example.test/ring", src: "本地测试夹具", prices: [] },
    { name: "Fixture Desk Sensor", cat: "环境传感器", lens: 3, brand: "Fixture", collects: "空气温度", shows: "环境趋势", status: "研发中", heat: 1,
      firstSeen: "2026-10-01", lastSeen: "2026-10-28", url: "https://example.test/sensor", src: "本地测试夹具", prices: [] },
  ];
  const paragraphs = [
    "RAG retrieves relevant knowledge before an answer is generated.",
    "A source document is split into chunks that preserve meaning.",
    "Embeddings make semantic retrieval possible.",
    "Retrieve a small set of relevant chunks rather than the whole corpus.",
    "Keep references so a reader can verify every explanation.",
    "A model can still make a mistake when the retrieval is weak.",
    "Evaluate retrieval quality separately from generated answer quality.",
    "Update the index and invalidate a lesson when its source changes.",
  ];
  const ragParagraphs = [
    "RAG 让回答使用新鲜、私有且可引用的知识，而不是依赖模型记忆。",
    "1 解析清洗：提取文档文字，保留标题和来源位置，去掉重复噪声。",
    "2 切块：按语义边界分段，记录块与原文的对应关系。",
    "3 向量化：把文本块编码成可检索的向量表示。",
    "4 检索：根据用户问题召回少量相关文本块。",
    "5 重排：按问题相关性重新排序召回结果，保留有效证据。",
    "6 生成：将问题与检索证据交给模型，要求注明依据。",
    "7 拒答约束：证据不足时说明边界，不补造结论。",
    "黄金问答集用于分别评测检索命中、证据支持与回答准确度。",
  ];
  const chapter = {
    id: "ch4", title: "RAG · 检索增强生成",
    text: ragParagraphs.join("\n\n"),
    html: ragParagraphs.map(p => "<p>" + p + "</p>").join(""),
  };
  const books = [
    { id: "agent-handbook", title: "Agent Handbook · 本地测试", chapters: [chapter] },
    { id: "dala-design", title: "Dala · 本地设计夹具", chapters: [
      { id: "ch0", title: "Tokens — Colors", html: "<table><tr><td>Iris</td><td>#6655cc</td><td>Use warm surfaces and a single accent.</td></tr></table>" },
      { id: "ch1", title: "Tokens — Typography", html: "<table><tr><td>Body</td><td>16px</td><td>Use a legible type scale and clear hierarchy.</td></tr></table>" },
      { id: "ch2", title: "Tokens — Spacing & Shapes", html: "<table><tr><td>Base</td><td>8px</td><td>--spacing-8</td><td>Use consistent spacing and small corner radii.</td></tr><tr><td>Pill</td><td>9999px</td><td>Border Radius</td><td>Not a spacing token.</td></tr></table>" },
      { id: "ch3", title: "Components", html: "<p>A button has an accessible label and focus state. This synthetic component description explains visual hierarchy, clear primary actions, generous spacing, and a visible keyboard focus indicator without running any source style or code.</p>" },
      { id: "ch4", title: "Outside selected coverage", text: "OUTSIDE_DALA_CH0_TO_CH3_SENTINEL", html: "<p>OUTSIDE_DALA_CH0_TO_CH3_SENTINEL</p>" },
    ] },
  ];
  const reader = {
    [ARTICLE_URL]: { url: ARTICLE_URL, source: "anth", title: "Local retrieval research fixture", pub: "2026-10-01",
      paras: paragraphs.map((p, i) => [p + " In this synthetic research excerpt, document retrieval is evaluated against a fixed collection of invented questions. The evidence is limited to these cached paragraphs. Retrieval quality and answer support are distinct measurements. No benchmark numbers, external claims, medical advice, private notes, or real account information are present in this local fixture.", "本地去敏段落 " + (i + 1)]),
      firstAt: now, fetchedAt: now, full: 1, needZh: false },
  };
  return { devices, books, reader };
}
function seedServerData(dataDir) {
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(path.join(dataDir, "users.db"));
  try {
    db.exec(`CREATE TABLE users(
      id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL,
      pwhash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user',
      must_change INTEGER NOT NULL DEFAULT 0, created TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    for (const account of Object.values(ACCOUNTS)) {
      const salt = crypto.randomBytes(16).toString("hex");
      const pwhash = crypto.scryptSync(account.password, salt, 64).toString("hex");
      db.prepare("INSERT INTO users(username,pwhash,salt,role,must_change) VALUES(?,?,?,?,?)")
        .run(account.username, pwhash, salt, account.role, Number(account.mustChange));
    }
  } finally { db.close(); }
  const f = fixtures();
  writeJson(path.join(dataDir, "server-config.json"), { glmKey: "", qwKey: "", dingtalk: {} });
  writeJson(path.join(dataDir, "hw-devices.json"), { devices: f.devices });
  writeJson(path.join(dataDir, "workbench-reader.json"), f.reader);
  writeJson(path.join(dataDir, "workbench-cache.json"), {});
  return f;
}
function cleanEnv(dataDir, overrides = {}) {
  // Do not inherit real provider credentials, proxy settings, NODE_OPTIONS or account HOME.
  return {
    PATH: path.dirname(NODE24) + path.delimiter + "/usr/bin:/bin:/usr/sbin:/sbin",
    HOME: dataDir, TMPDIR: dataDir, LANG: "en_US.UTF-8", TZ: "UTC",
    TALLER_DATA_DIR: dataDir, TALLER_HOST: "127.0.0.1", TALLER_OFFLINE: "1",
    TALLER_LEARNING_TEST_GUARD: "1", ...overrides,
  };
}
function suite(label) {
  const stats = { assertions: 0, passed: 0, failed: 0, tests: 0, testFailures: 0, skipped: 0 };
  const perform = fn => (...args) => {
    stats.assertions++;
    try { fn(...args); stats.passed++; }
    catch (error) { stats.failed++; throw error; }
  };
  const t = {
    ok: perform(assert.ok), equal: perform(assert.equal), deepEqual: perform(assert.deepEqual),
    match: perform(assert.match), notEqual: perform(assert.notEqual),
    throws: perform(assert.throws),
    async rejects(...args) {
      stats.assertions++;
      try { await assert.rejects(...args); stats.passed++; }
      catch (error) { stats.failed++; throw error; }
    },
    async test(name, fn) {
      stats.tests++;
      const failures = stats.failed;
      try { await fn(t); console.log("  PASS  " + name); }
      catch (error) {
        stats.testFailures++;
        if (stats.failed === failures) { stats.assertions++; stats.failed++; }
        console.error("  FAIL  " + name + " — " + String(error.stack || error));
      }
    },
    skip(name, reason) { stats.skipped++; console.log("  SKIP  " + name + " — " + reason); },
    finish() {
      console.log(`\n${label}: ${stats.assertions} assertions; ${stats.passed} passed / ${stats.failed} failed; ` +
        `${stats.tests} cases, ${stats.testFailures} failed, ${stats.skipped} skipped.`);
      if (stats.failed || stats.testFailures) process.exitCode = 1;
      return { ...stats };
    },
    stats,
  };
  return t;
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function request(base, method, pathname, { body, raw, cookie = "", headers = {}, timeout = 5000 } = {}) {
  const response = await fetch(base + pathname, {
    method, redirect: "manual", signal: AbortSignal.timeout(timeout),
    headers: { ...(body !== undefined || raw !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: response.status, json, text, headers: response.headers,
    cookie: (response.headers.get("set-cookie") || "").split(";")[0], location: response.headers.get("location") };
}
async function stopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.kill("SIGTERM");
  const done = await Promise.race([exited.then(() => true), delay(2500).then(() => false)]);
  if (!done) { child.kill("SIGKILL"); await exited; }
}
async function startServer(dataDir) {
  // Refuse to start an old server that does not implement the approved offline switch.
  const serverSource = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
  assert.match(serverSource, /TALLER_OFFLINE/, "server.js must implement TALLER_OFFLINE before integration tests run");
  assert.match(serverSource, /TALLER_HOST/, "server.js must bind the requested loopback host");
  const port = await freePort();
  const base = "http://127.0.0.1:" + port;
  const child = spawn(NODE24, ["--require", __filename, path.join(ROOT, "server.js")], {
    cwd: ROOT, env: cleanEnv(dataDir, { TALLER_PORT: String(port) }), stdio: ["ignore", "pipe", "pipe"],
  });
  let log = "", startError;
  child.on("error", error => { startError = error; });
  for (const stream of [child.stdout, child.stderr]) stream.on("data", data => { log = (log + data.toString()).slice(-100000); });
  try {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
      if (startError) throw startError;
      if (child.exitCode !== null) throw new Error("temporary server exited: " + log);
      try {
        const r = await request(base, "GET", "/api/me", { timeout: 500 });
        if (r.status === 200 && r.json?.authenticated === false) return { base, port, child, get log() { return log; }, stop: () => stopChild(child) };
      } catch {}
      await delay(75);
    }
    throw new Error("temporary server did not become ready: " + log);
  } catch (error) { await stopChild(child); throw error; }
}
async function startModuleServer({ dataDir, state = fixtures(), chat = async () => { throw new Error("UNEXPECTED_MODEL_CALL"); } } = {}) {
  const { createLearning } = require(path.join(ROOT, "learning.js"));
  assert.equal(typeof createLearning, "function", "learning.js must export createLearning");
  const json = (res, status, body, headers = {}) => {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
    res.end(JSON.stringify(body));
  };
  const readJson = async req => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const text = Buffer.concat(chunks).toString("utf8");
    try { return text ? JSON.parse(text) : {}; } catch { return {}; }
  };
  const learning = createLearning({
    dataDir, getBooks: () => state.books,
    getReader: () => state.reader,
    getDevices: () => state.devices,
    chat, json, readJson,
  });
  assert.equal(typeof learning.handle, "function");
  const errors = [];
  const server = http.createServer(async (req, res) => {
    const name = req.headers["x-test-role"] || "admin";
    const session = name === "anonymous" ? null : SESSIONS[name];
    try {
      const handled = await learning.handle(req, res, new URL(req.url, "http://127.0.0.1"), session);
      if (!handled && !res.writableEnded) json(res, 404, { ok: false, error: "fixture route not handled" });
    } catch (error) {
      errors.push(error);
      if (!res.headersSent) json(res, 500, { ok: false, error: "UNCAUGHT_TEST_HANDLER", message: error.message });
      else res.end();
    }
  });
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const base = "http://127.0.0.1:" + server.address().port;
  return {
    learning, state, errors, base,
    call: (method, pathname, body, role = "admin", headers = {}) => request(base, method, pathname, {
      body, headers: { "X-Test-Role": role, Origin: base, ...headers },
    }),
    async stop() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
function sourceQuery(ref) { return "/api/learning/status?source=" + encodeURIComponent(JSON.stringify(ref)); }
async function pollJob(call, jobId, target = "draft", timeout = 7000) {
  assert.equal(typeof jobId, "string", "generation must return a job id");
  const deadline = Date.now() + timeout;
  let last;
  while (Date.now() < deadline) {
    last = await call("GET", "/api/learning/jobs/" + encodeURIComponent(jobId));
    assert.equal(last.status, 200, "job polling must return 200: " + last.text);
    const state = last.json?.job?.state;
    if (["draft", "failed", "interrupted"].includes(state)) {
      assert.equal(state, target, "unexpected terminal job state: " + JSON.stringify(last.json));
      return last;
    }
    assert.ok(["queued", "running"].includes(state), "unknown job state: " + JSON.stringify(last.json));
    await delay(15);
  }
  throw new Error("job polling deadline: " + JSON.stringify(last?.json));
}

// A second, independent, fail-closed guard for the child server. It logs attempted
// outbound I/O so an offline implementation that merely swallows errors still fails.
function installNetworkGuard() {
  const allowed = host => ["127.0.0.1", "::1", "[::1]", "localhost"].includes(String(host || "").toLowerCase());
  const deny = () => {
    process.stderr.write("LEARNING_TEST_EXTERNAL_IO_BLOCKED\n");
    const error = new Error("Learning tests prohibit external network I/O");
    error.code = "ERR_LEARNING_TEST_NETWORK";
    throw error;
  };
  const fetchOriginal = globalThis.fetch;
  globalThis.fetch = function(input, ...rest) {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    if (!["http:", "https:"].includes(url.protocol) || !allowed(url.hostname)) return deny();
    return fetchOriginal.call(this, input, ...rest);
  };
  for (const protocol of [require("node:http"), require("node:https")]) {
    for (const method of ["request", "get"]) {
      const original = protocol[method];
      protocol[method] = function(input, ...rest) {
        let host;
        if (typeof input === "string" || input instanceof URL) host = new URL(input).hostname;
        else host = input?.hostname || input?.host || "localhost";
        if (!allowed(host)) return deny();
        return original.call(this, input, ...rest);
      };
    }
  }
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function(...args) {
    const first = args[0];
    if (first && typeof first === "object") {
      // net normalizes calls to [options, callback] before dispatching internally.
      const options = Array.isArray(first) ? first[0] : first;
      if (options.path || (options.host && !allowed(options.host))) return deny();
    } else if (typeof first === "string") return deny();
    else if (typeof args[1] === "string" && !allowed(args[1])) return deny();
    return connect.apply(this, args);
  };
}
if (process.env.TALLER_LEARNING_TEST_GUARD === "1") installNetworkGuard();

module.exports = {
  ROOT, NODE24, ARTICLE_URL, UNCACHED_URL, RAG_REF, DALA_REF, ARTICLE_REF, SESSIONS, ACCOUNTS,
  assertNode24, clone, delay, writeJson, tempDir, removeTemp, fixtures, seedServerData,
  cleanEnv, suite, freePort, request, stopChild, startServer, startModuleServer, sourceQuery, pollJob,
};
