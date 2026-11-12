import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { inspect } from "node:util";
import nodeTest from "node:test";

const require = createRequire(import.meta.url);
const { SafePublicFetchError, isPublicAddress, parsePublicHttpUrl, resolvePublicTarget, createSafePublicFetch } = require("../safe-public-fetch.js");
const { AiWorkbenchError, createAiWorkbenchService } = require("../ai-workbench-service.js");
const test = (name, fn) => nodeTest(name, { timeout: 2000 }, fn);

// Synthetic fixtures only. Every DNS/transport path receives an injected mock.
const KEY = "offline-unit-test-credential-not-a-real-key";
const BASE = "https://api.offline-check.net/v1";
const CONFIG = { key: KEY, baseUrl: BASE, model: "offline-model" };
const ANSWERS = [
  { address: "93.184.216.34", family: 4 },
  { address: "2606:4700:4700::1111", family: 6 },
];
const messages = content => [{ role: "user", content: content ?? "测试问题" }];
const body = content => ({ messages: messages(content) });
const response = (content = " 离线模拟回答 ") => ({
  ok: true, status: 200, redirected: false,
  text: async () => JSON.stringify({ choices: [{ message: { content } }] }),
});
const rawResponse = text => ({ ok: true, status: 200, text: async () => text });
const freshAnswers = () => ANSWERS.map(answer => ({ ...answer }));
const never = () => new Promise(() => {});
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
function noKey(value) {
  assert.ok(!inspect(value, { depth: 10 }).includes(KEY), "public result/error must not expose the configured key");
}
function safeError(code) {
  return error => {
    assert.ok(error instanceof SafePublicFetchError);
    assert.equal(error.code, code);
    noKey(error);
    return true;
  };
}
async function chatError(action, status, pattern) {
  await assert.rejects(action, error => {
    assert.ok(error instanceof AiWorkbenchError);
    assert.equal(error.status, status);
    if (pattern) assert.match(error.message, pattern);
    noKey(error);
    return true;
  });
}
function fixture(options = {}) {
  const calls = { lookup: [], fetch: [], context: [] };
  let clock = 10000;
  const service = createAiWorkbenchService({
    getConfig: options.getConfig ?? (() => Object.hasOwn(options, "config") ? options.config : { ...CONFIG }),
    getContext: flags => {
      calls.context.push({ ...flags });
      return options.getContext ? options.getContext(flags) : { snapshot: "OFFLINE_CONTEXT_SNAPSHOT" };
    },
    lookup: async (...args) => {
      calls.lookup.push(args);
      return options.lookup ? options.lookup(...args) : freshAnswers();
    },
    fetchImpl: async (url, request, target) => {
      calls.fetch.push({ url, request, target });
      return options.fetchImpl ? options.fetchImpl(url, request, target) : response();
    },
    now: () => clock,
    timeoutMs: options.timeoutMs ?? 500,
    cooldownMs: options.cooldownMs ?? 2500,
  });
  return { service, calls, advance: milliseconds => { clock += milliseconds; } };
}

for (const address of [
  "1.1.1.1", "8.8.8.8", "93.184.216.34", "100.63.255.255", "100.128.0.0",
  "172.15.255.255", "172.32.0.0", "192.0.1.1", "198.17.255.255", "198.20.0.0", "223.255.255.255",
  "2001:4860:4860::8888", "2606:4700:4700::1111", "2400:3200::1", "2a00:1450:4001::200e",
  "2001:200::1", "2620:4f:8001::1",
]) {
  test(`isPublicAddress accepts public address ${address}`, () => assert.equal(isPublicAddress(address), true));
}
for (const [first, last] of [
  ["0.0.0.0", "0.255.255.255"], ["10.0.0.0", "10.255.255.255"],
  ["100.64.0.0", "100.127.255.255"], ["127.0.0.0", "127.255.255.255"],
  ["169.254.0.0", "169.254.255.255"], ["172.16.0.0", "172.31.255.255"],
  ["192.0.0.0", "192.0.0.255"], ["192.0.2.0", "192.0.2.255"],
  ["192.31.196.0", "192.31.196.255"], ["192.52.193.0", "192.52.193.255"],
  ["192.88.99.0", "192.88.99.255"], ["192.168.0.0", "192.168.255.255"],
  ["192.175.48.0", "192.175.48.255"], ["198.18.0.0", "198.19.255.255"],
  ["198.51.100.0", "198.51.100.255"], ["203.0.113.0", "203.0.113.255"],
  ["224.0.0.0", "239.255.255.255"], ["240.0.0.0", "255.255.255.255"],
]) {
  for (const address of [first, last]) {
    test(`isPublicAddress rejects IPv4 range boundary ${address}`, () => assert.equal(isPublicAddress(address), false));
  }
}
for (const address of [
  "::", "::1", "::127.0.0.1", "::ffff:127.0.0.1", "::ffff:8.8.8.8", "::ffff:7f00:1",
  "64:ff9b::808:808", "64:ff9b:1::1", "100::1", "2001::1", "2001:2::1", "2001:20::1",
  "2001:1ff:ffff:ffff:ffff:ffff:ffff:ffff", "2001:db8::1", "2001:db8:ffff:ffff:ffff:ffff:ffff:ffff",
  "2002:0808:0808::1", "2620:4f:8000::1", "3fff::1", "3fff:fff:ffff:ffff:ffff:ffff:ffff:ffff",
  "4000::1", "fc00::1", "fdff::1", "fe80::1", "fec0::1", "ff02::1", "fe80::1%en0",
]) {
  test(`isPublicAddress rejects non-public IPv6 ${address}`, () => assert.equal(isPublicAddress(address), false));
}
for (const [name, value] of [
  ["undefined", undefined], ["null", null], ["number", 2130706433], ["object", {}], ["empty", ""],
  ["hostname", "example.com"], ["invalid IPv4", "999.1.1.1"], ["short IPv4", "127.1"],
  ["integer IPv4", "2130706433"], ["hex IPv4", "0x7f000001"], ["octal IPv4", "0177.0.0.1"],
  ["bracketed IPv6", "[2606:4700:4700::1111]"], ["malformed IPv6", "2001:4860::bad::1"],
]) {
  test(`isPublicAddress rejects ${name}`, () => assert.equal(isPublicAddress(value), false));
}

for (const [input, expected] of [
  ["https://API.OFFLINE-CHECK.NET/v1", "https://api.offline-check.net/v1"],
  ["http://api.offline-check.net:8080/path?q=1", "http://api.offline-check.net:8080/path?q=1"],
  ["https://api.offline-check.net./v1", "https://api.offline-check.net/v1"],
  ["https://8.8.8.8/v1", "https://8.8.8.8/v1"],
  ["https://[2606:4700:4700::1111]/v1", "https://[2606:4700:4700::1111]/v1"],
]) {
  test(`parsePublicHttpUrl accepts and normalizes ${input}`, () => assert.equal(parsePublicHttpUrl(input).href, expected));
}
for (const [name, input, code] of [
  ["non-string", null, "unsafe_url"], ["overlong URL", "https://api.offline-check.net/" + "x".repeat(2049), "unsafe_url"],
  ["FTP", "ftp://api.offline-check.net/", "unsafe_url"], ["file", "file:///etc/passwd", "unsafe_url"],
  ["protocol relative", "//api.offline-check.net/", "unsafe_url"], ["space", "https://api.offline-check.net/a b", "unsafe_url"],
  ["newline", "https://api.offline-check.net/\n", "unsafe_url"], ["NUL", "https://api.offline-check.net/\0", "unsafe_url"],
  ["backslash", "https://api.offline-check.net\\@127.0.0.1/", "unsafe_url"],
  ["credentials", "https://user:pass@api.offline-check.net/", "unsafe_url"],
  ["fragment", "https://api.offline-check.net/#secret", "unsafe_url"], ["zero port", "https://api.offline-check.net:0/", "unsafe_url"],
  ["single-label host", "https://printer/", "unsafe_host"], ["localhost", "https://localhost/", "unsafe_host"],
  ["localhost suffix", "https://api.localhost/", "unsafe_host"], ["local", "https://api.local/", "unsafe_host"],
  ["internal", "https://api.internal/", "unsafe_host"], ["intranet", "https://api.intranet/", "unsafe_host"],
  ["home", "https://api.home/", "unsafe_host"], ["LAN", "https://api.lan/", "unsafe_host"],
  ["home.arpa", "https://api.home.arpa/", "unsafe_host"], ["test suffix", "https://api.test/", "unsafe_host"],
  ["invalid suffix", "https://api.invalid/", "unsafe_host"], ["example suffix", "https://api.example/", "unsafe_host"],
  ["onion", "https://api.onion/", "unsafe_host"], ["invalid label", "https://bad_host.net/", "unsafe_host"],
  ["empty label", "https://api..net/", "unsafe_host"], ["long label", "https://" + "a".repeat(64) + ".net/", "unsafe_host"],
]) {
  test(`parsePublicHttpUrl rejects ${name}`, () => assert.throws(() => parsePublicHttpUrl(input), safeError(code)));
}
for (const host of [
  "127.0.0.1", "10.0.0.1", "192.168.1.1", "169.254.169.254", "198.51.100.1", "224.0.0.1",
  "2130706433", "0x7f000001", "0177.0.0.1", "127.1", "127.000.0.1", "0x7f.0.0.1", "3232235777",
  "0xa9fea9fe", "0251.0376.0251.0376", "[::1]", "[::ffff:127.0.0.1]", "[::ffff:7f00:1]",
  "[fc00::1]", "[fe80::1]", "[2001:db8::1]", "[2002:0808:0808::1]",
]) {
  test(`parsePublicHttpUrl rejects private/reserved/obfuscated host ${host}`, () => {
    assert.throws(() => parsePublicHttpUrl(`http://${host}/v1`), safeError("unsafe_address"));
  });
}

test("resolvePublicTarget validates all DNS answers and requests the complete answer set", async () => {
  const dns = freshAnswers();
  const target = await resolvePublicTarget(BASE, { lookup: async (host, options) => {
    assert.equal(host, "api.offline-check.net");
    assert.deepEqual(options, { all: true, verbatim: true });
    return dns;
  } });
  assert.equal(target.url.href, BASE);
  assert.deepEqual(target.addresses, ANSWERS);
  dns[0].address = "127.0.0.1";
  assert.equal(target.addresses[0].address, ANSWERS[0].address);
});
for (const answer of ANSWERS) {
  test(`resolvePublicTarget skips DNS for public IPv${answer.family} literals`, async () => {
    const host = answer.family === 6 ? `[${answer.address}]` : answer.address;
    const target = await resolvePublicTarget(`https://${host}/`, { lookup: () => assert.fail("literal must not use DNS") });
    assert.deepEqual(target.addresses, [answer]);
  });
}
for (const [name, answers] of [
  ["empty", []], ["null", null], ["non-array", {}], ["null record", [null]],
  ["invalid address", [{ address: "not-an-ip", family: 4 }]],
  ["family mismatch", [{ address: "8.8.8.8", family: 6 }]],
  ["string family", [{ address: "8.8.8.8", family: "4" }]],
  ["IPv6 family mismatch", [{ address: ANSWERS[1].address, family: 4 }]],
  ["mixed public/private", [ANSWERS[0], { address: "10.0.0.1", family: 4 }]],
  ["mixed private/public", [{ address: "127.0.0.1", family: 4 }, ANSWERS[0]]],
  ["mixed public/IPv6 loopback", [ANSWERS[0], { address: "::1", family: 6 }]],
  ["mixed public/mapped IPv4", [ANSWERS[1], { address: "::ffff:8.8.8.8", family: 6 }]],
  ["65 answers", Array.from({ length: 65 }, () => ({ ...ANSWERS[0] }))],
]) {
  test(`resolvePublicTarget rejects ${name} DNS answers`, async () => {
    await assert.rejects(() => resolvePublicTarget(BASE, { lookup: async () => answers }), safeError("unsafe_address"));
  });
}
test("resolvePublicTarget accepts exactly 64 validated answers", async () => {
  const target = await resolvePublicTarget(BASE, { lookup: async () => Array.from({ length: 64 }, () => ({ ...ANSWERS[0] })) });
  assert.equal(target.addresses.length, 64);
});
test("resolvePublicTarget sanitizes lookup errors", async () => {
  await assert.rejects(() => resolvePublicTarget(BASE, { lookup: async () => { throw new Error(KEY); } }), safeError("dns_failed"));
});
test("resolvePublicTarget aborts a pending lookup", async () => {
  const controller = new AbortController();
  const reason = new Error("offline DNS cancellation");
  const pending = resolvePublicTarget(BASE, { lookup: never, signal: controller.signal });
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
});

test("createSafePublicFetch passes validated targets/options and forces redirect rejection", async () => {
  const controller = new AbortController();
  const expected = response();
  const safeFetch = createSafePublicFetch({ lookup: async () => freshAnswers(), fetchImpl: async (url, options, target) => {
    assert.equal(url, BASE);
    assert.equal(target.url.hostname, "api.offline-check.net");
    assert.deepEqual(target.addresses, ANSWERS);
    assert.equal(options.redirect, "error");
    assert.equal(options.signal, controller.signal);
    assert.equal(options.method, "POST");
    assert.equal(options.body, "offline-body");
    assert.deepEqual(options.headers, { "X-Offline": "yes" });
    assert.equal(options.maxResponseBytes, 1234);
    return expected;
  } });
  assert.equal(await safeFetch(BASE, { method: "POST", body: "offline-body", headers: { "X-Offline": "yes" },
    signal: controller.signal, redirect: "follow", maxResponseBytes: 1234 }), expected);
});
test("createSafePublicFetch supplies a default timeout signal", async () => {
  const safeFetch = createSafePublicFetch({ lookup: async () => freshAnswers(), fetchImpl: async (_url, options) => {
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.signal.aborted, false);
    return response();
  } });
  await safeFetch(BASE);
});
for (const [name, status, redirected] of [
  ["301", 301, false], ["302", 302, false], ["303", 303, false],
  ["307", 307, false], ["308", 308, false], ["already-followed redirect", 200, true],
]) {
  test(`createSafePublicFetch rejects ${name} and cancels its body`, async () => {
    let fetched = 0, cancelled = 0;
    const safeFetch = createSafePublicFetch({ lookup: async () => freshAnswers(), fetchImpl: async () => {
      fetched++;
      return { status, redirected, body: { cancel: async () => { cancelled++; } } };
    } });
    await assert.rejects(() => safeFetch(BASE), safeError("redirect_blocked"));
    assert.equal(fetched, 1);
    assert.equal(cancelled, 1);
  });
}
test("createSafePublicFetch still rejects redirects if body cancellation rejects", async () => {
  const safeFetch = createSafePublicFetch({ lookup: async () => freshAnswers(), fetchImpl: async () => ({
    status: 302, body: { cancel: async () => { throw new Error(KEY); } },
  }) });
  await assert.rejects(() => safeFetch(BASE), safeError("redirect_blocked"));
});
test("createSafePublicFetch blocks unsafe DNS before invoking transport", async () => {
  let fetched = 0;
  const safeFetch = createSafePublicFetch({ lookup: async () => [ANSWERS[0], { address: "127.0.0.1", family: 4 }],
    fetchImpl: async () => { fetched++; return response(); } });
  await assert.rejects(() => safeFetch(BASE), safeError("unsafe_address"));
  assert.equal(fetched, 0);
});
test("createSafePublicFetch propagates cancellation of a stalled transport", async () => {
  const controller = new AbortController();
  const started = deferred();
  const reason = new Error("offline transport cancellation");
  const safeFetch = createSafePublicFetch({ lookup: async () => freshAnswers(), fetchImpl: () => { started.resolve(); return never(); } });
  const pending = safeFetch(BASE, { signal: controller.signal });
  await started.promise;
  controller.abort(reason);
  await assert.rejects(pending, error => error === reason);
});
test("createSafePublicFetch rejects a pre-aborted hostname request before transport", async () => {
  const controller = new AbortController();
  const reason = new Error("already cancelled");
  controller.abort(reason);
  let fetched = 0;
  const safeFetch = createSafePublicFetch({ lookup: async () => freshAnswers(), fetchImpl: async () => { fetched++; return response(); } });
  await assert.rejects(() => safeFetch(BASE, { signal: controller.signal }), error => error === reason);
  assert.equal(fetched, 0);
});

test("service status reports configured model/host without credentials or network calls", () => {
  const { service, calls } = fixture();
  assert.deepEqual(service.status(), { ok: true, configured: true, model: CONFIG.model, endpointHost: "api.offline-check.net" });
  noKey(service.status());
  assert.deepEqual(calls, { lookup: [], fetch: [], context: [] });
});
for (const [name, config] of [
  ["null", null], ["empty", {}], ["missing key", { ...CONFIG, key: "" }],
  ["missing base URL", { ...CONFIG, baseUrl: "" }], ["missing model", { ...CONFIG, model: "" }],
  ["non-string key", { ...CONFIG, key: 123 }], ["key CRLF", { ...CONFIG, key: KEY + "\r\nX: injected" }],
  ["model spaces", { ...CONFIG, model: "bad model" }], ["model over 100 characters", { ...CONFIG, model: "x".repeat(101) }],
  ["numeric model", { ...CONFIG, model: 42 }], ["array model", { ...CONFIG, model: ["offline-model"] }],
  ["public HTTP base URL", { ...CONFIG, baseUrl: "http://api.offline-check.net/v1" }],
  ["private base URL", { ...CONFIG, baseUrl: "http://127.0.0.1/v1" }],
  ["non-HTTP base URL", { ...CONFIG, baseUrl: "file:///tmp/model" }],
  ["query in base URL", { ...CONFIG, baseUrl: BASE + "?key=offline" }],
  ["credentials in base URL", { ...CONFIG, baseUrl: "https://user:pass@api.offline-check.net/v1" }],
]) {
  test(`service is unconfigured for ${name}`, async () => {
    const { service, calls } = fixture({ config });
    assert.deepEqual(service.status(), { ok: true, configured: false, model: "", endpointHost: "" });
    await chatError(() => service.chat("alice", body()), 503);
    assert.deepEqual(calls, { lookup: [], fetch: [], context: [] });
  });
}
test("service accepts a 100-character model name", () => {
  const { service } = fixture({ config: { ...CONFIG, model: "m".repeat(100) } });
  assert.equal(service.status().configured, true);
});
test("service re-reads configuration on each status/chat request", async () => {
  let config = null;
  const { service, calls } = fixture({ getConfig: () => config });
  assert.equal(service.status().configured, false);
  config = { ...CONFIG, model: "org/offline-model:v1.2_3-4" };
  assert.equal(service.status().configured, true);
  const result = await service.chat("alice", body());
  assert.equal(result.model, config.model);
  config = null;
  assert.equal(service.status().configured, false);
  assert.equal(calls.fetch.length, 1);
  noKey(result);
});
for (const baseUrl of [BASE, BASE + "/", BASE + "/chat/completions", BASE + "/chat/completions///"]) {
  test(`service normalizes the chat endpoint from ${baseUrl}`, async () => {
    const { service, calls } = fixture({ config: { ...CONFIG, baseUrl } });
    const result = await service.chat("alice", body());
    assert.equal(calls.fetch[0].url, BASE + "/chat/completions");
    assert.equal(result.reply, "离线模拟回答");
    noKey(result);
  });
}

test("service sends only validated messages and uses the key only in transport authorization", async () => {
  const { service, calls } = fixture();
  const input = { messages: [{ role: "assistant", content: "  previous  ", ignored: "discard" },
    { role: "user", content: "  question  ", ignored: "discard" }], ignored: "discard" };
  const original = JSON.stringify(input);
  const result = await service.chat("alice", input);
  const { request, target } = calls.fetch[0];
  const payload = JSON.parse(request.body);
  assert.equal(request.method, "POST");
  assert.equal(request.headers.Authorization, "Bearer " + KEY);
  assert.equal(request.headers["Content-Type"], "application/json");
  assert.equal(request.redirect, "error");
  assert.deepEqual(target.addresses, ANSWERS);
  assert.equal(payload.model, CONFIG.model);
  assert.equal(payload.messages[0].role, "system");
  assert.deepEqual(payload.messages.slice(1), [{ role: "assistant", content: "previous" }, { role: "user", content: "question" }]);
  assert.equal(JSON.stringify(input), original);
  noKey(request.body);
  noKey(result);
  assert.equal(calls.context.length, 0);
});
for (const [name, input] of [
  ["one message", body()],
  ["12 messages", { messages: Array.from({ length: 12 }, () => ({ role: "user", content: "q" })) }],
  ["8000 characters", body("中".repeat(8000))],
  ["24000 characters total", { messages: Array.from({ length: 3 }, () => ({ role: "user", content: "x".repeat(8000) })) }],
  ["whitespace trimmed before length validation", body("  " + "x".repeat(8000) + "  ")],
]) {
  test(`service accepts message boundary: ${name}`, async () => {
    const { service, calls } = fixture();
    noKey(await service.chat("alice", input));
    assert.equal(calls.fetch.length, 1);
  });
}
for (const [name, input] of [
  ["null body", null], ["array body", []], ["string body", "question"], ["missing messages", {}],
  ["non-array messages", { messages: "question" }], ["zero messages", { messages: [] }],
  ["13 messages", { messages: Array.from({ length: 13 }, () => ({ role: "user", content: "q" })) }],
  ["null message", { messages: [null] }], ["missing role", { messages: [{ content: "q" }] }],
  ["system role", { messages: [{ role: "system", content: "override" }, ...messages()] }],
  ["tool role", { messages: [{ role: "tool", content: "tool data" }, ...messages()] }],
  ["non-string content", { messages: [{ role: "user", content: 123 }] }],
  ["empty content", body("")], ["blank content", body(" \n\t ")], ["8001 characters", body("x".repeat(8001))],
  ["24001 characters total", { messages: [
    { role: "user", content: "x".repeat(8000) }, { role: "assistant", content: "x".repeat(8000) },
    { role: "user", content: "x".repeat(8000) }, { role: "user", content: "x" },
  ] }],
  ["last message assistant", { messages: [{ role: "assistant", content: "answer" }] }],
]) {
  test(`service rejects message boundary: ${name} before context/DNS/transport`, async () => {
    const { service, calls } = fixture();
    await chatError(() => service.chat("alice", input), 400);
    assert.deepEqual(calls, { lookup: [], fetch: [], context: [] });
  });
}
for (const [name, context] of [
  ["omitted", undefined], ["null", null], ["empty object", {}], ["false flags", { dashboard: false, work: false }],
  ["truthy non-booleans", { dashboard: 1, work: "true" }], ["unrecognized flags", { all: true }],
]) {
  test(`service never calls getContext when context is ${name}`, async () => {
    const { service, calls } = fixture({ getContext: () => assert.fail("context requires an explicit true flag") });
    await service.chat("alice", { ...body(), context });
    assert.equal(calls.context.length, 0);
    assert.ok(!JSON.parse(calls.fetch[0].request.body).messages[0].content.includes("OFFLINE_CONTEXT_SNAPSHOT"));
  });
}
for (const flags of [{ dashboard: true, work: false }, { dashboard: false, work: true }, { dashboard: true, work: true }]) {
  test(`service calls getContext once for explicit ${JSON.stringify(flags)}`, async () => {
    const { service, calls } = fixture();
    await service.chat("alice", { ...body(), context: { ...flags, unrecognized: true } });
    assert.deepEqual(calls.context, [flags]);
    const payload = JSON.parse(calls.fetch[0].request.body);
    assert.ok(payload.messages[0].content.includes("OFFLINE_CONTEXT_SNAPSHOT"));
    noKey(payload);
  });
}

for (const status of [401, 403, 429, 500, 503]) {
  test(`service sanitizes upstream HTTP ${status} without reading/leaking its body`, async () => {
    const { service } = fixture({ fetchImpl: async () => ({ ok: false, status,
      text: async () => assert.fail("upstream error body must not be read") }) });
    await chatError(() => service.chat("alice", body()), 502, new RegExp(String(status)));
  });
}
for (const [name, fetchImpl] of [
  ["transport exception", async () => { throw new Error("upstream failure " + KEY); }],
  ["null response", async () => null], ["undefined response", async () => undefined],
  ["empty body", async () => rawResponse("")], ["invalid JSON", async () => rawResponse(KEY)],
  ["body read failure", async () => ({ ok: true, status: 200, text: async () => { throw new Error(KEY); } })],
  ["JSON null", async () => rawResponse("null")], ["missing choices", async () => rawResponse("{}")],
  ["empty choices", async () => rawResponse('{"choices":[]}')],
  ["empty reply", async () => response("")], ["blank reply", async () => response(" \n\t ")],
  ["non-string reply", async () => response(42)],
]) {
  test(`service returns a sanitized 502 for ${name}`, async () => {
    const { service } = fixture({ fetchImpl });
    await chatError(() => service.chat("alice", body()), 502);
  });
}
test("service sanitizes DNS failures", async () => {
  const { service, calls } = fixture({ lookup: async () => { throw new Error(KEY); } });
  await chatError(() => service.chat("alice", body()), 502);
  assert.equal(calls.fetch.length, 0);
});
test("service rejects mixed DNS answers without sending its key to transport", async () => {
  const { service, calls } = fixture({ lookup: async () => [ANSWERS[0], { address: "::1", family: 6 }] });
  await chatError(() => service.chat("alice", body()), 400);
  assert.equal(calls.fetch.length, 0);
});
test("service maps redirect rejection to a sanitized 400", async () => {
  const { service, calls } = fixture({ fetchImpl: async () => ({ ok: false, status: 302, headers: { location: "http://127.0.0.1/" } }) });
  await chatError(() => service.chat("alice", body()), 400);
  assert.equal(calls.fetch.length, 1);
});
test("service sanitizes getContext exceptions before invoking transport", async () => {
  const { service, calls } = fixture({ getContext: () => { throw new Error(KEY); } });
  await chatError(() => service.chat("alice", { ...body(), context: { work: true } }), 502);
  assert.equal(calls.fetch.length, 0);
});
test("service trims and caps replies at 16000 characters", async () => {
  const { service } = fixture({ fetchImpl: async () => response("  " + "答".repeat(16001) + "  ") });
  const result = await service.chat("alice", body());
  assert.equal(result.reply, "答".repeat(16000));
  noKey(result);
});
for (const stage of ["DNS", "transport"]) {
  test(`service timeout during ${stage} returns sanitized 504 and releases inflight state`, async () => {
    let attempts = 0;
    const { service, calls, advance } = fixture({ timeoutMs: 25,
      ...(stage === "DNS" ? { lookup: () => ++attempts === 1 ? never() : freshAnswers() }
        : { fetchImpl: () => ++attempts === 1 ? never() : response() }),
    });
    await chatError(() => service.chat("alice", body()), 504, /超时/);
    if (stage === "DNS") assert.equal(calls.fetch.length, 0);
    else assert.equal(calls.fetch[0].request.signal.aborted, true);
    advance(2500);
    noKey(await service.chat("alice", body()));
  });
}
for (const stage of ["DNS", "transport"]) {
  test(`service caller abort during ${stage} returns sanitized 499 and releases inflight state`, async () => {
    const started = deferred();
    const controller = new AbortController();
    let attempts = 0;
    const stalled = () => {
      if (++attempts === 1) { started.resolve(); return never(); }
      return stage === "DNS" ? freshAnswers() : response();
    };
    const { service, calls, advance } = fixture(stage === "DNS" ? { lookup: stalled } : { fetchImpl: stalled });
    const pending = service.chat("alice", body(), { signal: controller.signal });
    await started.promise;
    controller.abort(new Error(KEY));
    await chatError(() => pending, 499, /取消/);
    if (stage === "DNS") assert.equal(calls.fetch.length, 0);
    else assert.equal(calls.fetch[0].request.signal.aborted, true);
    advance(2500);
    noKey(await service.chat("alice", body()));
  });
}
test("service handles a pre-aborted caller without invoking transport", async () => {
  const controller = new AbortController();
  controller.abort(new Error(KEY));
  const { service, calls } = fixture();
  await chatError(() => service.chat("alice", body(), { signal: controller.signal }), 499);
  assert.equal(calls.fetch.length, 0);
});
test("service enforces cooldown through 2499ms and accepts exactly 2500ms", async () => {
  const { service, calls, advance } = fixture();
  await service.chat("alice", body());
  await chatError(() => service.chat("alice", body()), 429, /稍等/);
  advance(2499);
  await chatError(() => service.chat("alice", body()), 429, /稍等/);
  assert.equal(calls.fetch.length, 1);
  advance(1);
  noKey(await service.chat("alice", body()));
  assert.equal(calls.fetch.length, 2);
});
test("service keeps users independent during cooldown", async () => {
  const { service, calls } = fixture();
  await service.chat("alice", body());
  noKey(await service.chat("bob", body()));
  assert.equal(calls.fetch.length, 2);
});
test("service rejects duplicate inflight requests, allows other users, and starts cooldown at completion", async () => {
  const gate = deferred(), started = deferred();
  const { service, calls, advance } = fixture({ fetchImpl: async (_url, request) => {
    const payload = JSON.parse(request.body);
    if (payload.messages.at(-1).content === "hold") { started.resolve(); return gate.promise; }
    return response();
  } });
  const first = service.chat("alice", body("hold"));
  try {
    await started.promise;
    advance(10000);
    await chatError(() => service.chat("alice", body("duplicate")), 429, /进行中/);
    noKey(await service.chat("bob", body("independent")));
    assert.equal(calls.fetch.length, 2);
  } finally {
    gate.resolve(response());
    await first;
  }
  await chatError(() => service.chat("alice", body()), 429, /稍等/);
  advance(2500);
  noKey(await service.chat("alice", body()));
  assert.equal(calls.fetch.length, 3);
});
test("service releases inflight state after errors while preserving cooldown", async () => {
  let attempts = 0;
  const { service, calls, advance } = fixture({ fetchImpl: async () => {
    if (++attempts === 1) throw new Error(KEY);
    return response();
  } });
  await chatError(() => service.chat("alice", body()), 502);
  await chatError(() => service.chat("alice", body()), 429, /稍等/);
  assert.equal(calls.fetch.length, 1);
  advance(2500);
  noKey(await service.chat("alice", body()));
  assert.equal(calls.fetch.length, 2);
});
