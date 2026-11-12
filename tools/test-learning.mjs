/* Local-only integration acceptance. Run with Node 24; no account/data/key from data/ is read.
   The child uses process.execPath, an already populated temporary users.db,
   TALLER_DATA_DIR, TALLER_HOST=127.0.0.1 and TALLER_OFFLINE=1. */
import fs from "node:fs";
import path from "node:path";
import support from "./learning-test-support.cjs";

const {
  ROOT, ARTICLE_URL, UNCACHED_URL, RAG_REF, DALA_REF, ARTICLE_REF, ACCOUNTS,
  assertNode24, suite, seedServerData, tempDir, removeTemp, request, startServer,
  sourceQuery, pollJob,
} = support;
assertNode24();
const t = suite("learning integration (Node 24, offline, temporary data)");
const dataDir = tempDir("taller-learning-integration-");
const fixture = seedServerData(dataDir);
const cookies = {};
let service;
const call = (role, method, url, body, headers = {}) => request(service.base, method, url, {
  body, cookie: cookies[role] || "", headers: { Origin: service.base, ...headers },
});
const admin = (method, url, body) => call("admin", method, url, body);
const has = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
function sourceShape(source, expectedKind) {
  t.equal(source?.kind, expectedKind);
  t.equal(source?.sourceRef?.kind, expectedKind);
  t.equal(typeof source?.title, "string");
  t.match(source?.hash || "", /^[a-f0-9]{64}$/);
  t.ok(["chapter", "selected-chapters", "selected-devices", "excerpt"].includes(source?.coverage));
  t.ok(typeof source?.returnUrl === "string" && source.returnUrl.startsWith("/") && !source.returnUrl.startsWith("//"));
  t.ok(Array.isArray(source?.blocks) && source.blocks.length > 0);
  const ids = source.blocks.map(block => block.id);
  t.equal(new Set(ids).size, ids.length);
  for (const block of source.blocks) {
    t.equal(typeof block.id, "string");
    t.equal(typeof block.text, "string");
    t.ok(block.text.length > 0);
    t.ok(has(block, "location"));
  }
}
function envelope(response, { state, kind, admin: isAdmin = true } = {}) {
  t.equal(response.status, 200, response.text);
  t.equal(response.json?.ok, true);
  t.equal(response.json?.admin, isAdmin);
  if (state !== undefined) t.equal(response.json?.state, state);
  if (kind) sourceShape(response.json?.source, kind);
}
function denied(response, status = 403) {
  t.equal(response.status, status, response.text);
  t.equal(response.json?.ok, false);
  t.ok(!response.json?.document && !response.json?.job, "denial must not expose learning material");
}
async function generate(ref, mode) {
  const body = { sourceRef: ref, ...(mode ? { mode } : {}) };
  const generated = await admin("POST", "/api/learning/generate", body);
  t.equal(generated.status, 202, generated.text);
  t.equal(generated.json?.ok, true);
  t.equal(typeof generated.json?.job?.id, "string");
  t.ok(["queued", "running", "draft"].includes(generated.json?.job?.state));
  const terminal = await pollJob(admin, generated.json.job.id);
  t.equal(terminal.json?.job?.state, "draft");
  t.equal(typeof terminal.json?.job?.documentId, "string");
  return { job: terminal.json.job, id: terminal.json.job.documentId };
}

try {
  await t.test("offline integration preflight and local server start", async () => {
    t.ok(fs.existsSync(path.join(ROOT, "learning.js")), "learning.js not ready");
    service = await startServer(dataDir);
    t.ok(service.base.startsWith("http://127.0.0.1:"));
    t.ok(!fs.existsSync(path.join(dataDir, "admin-initial-password.txt")), "seed credentials must never be generated");
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(dataDir, "users.db"));
    try {
      t.equal(db.prepare("SELECT COUNT(*) n FROM users").get().n, 4);
      t.equal(db.prepare("SELECT COUNT(*) n FROM users WHERE username='admin'").get().n, 0);
    } finally { db.close(); }
  });

  if (!service) {
    t.skip("remaining HTTP cases", "offline learning server failed its explicit preflight; no real server was used");
  } else {
    await t.test("anonymous learning APIs require an account", async () => {
      for (const url of ["/api/learning/sources", sourceQuery(RAG_REF), "/api/learning/jobs"]) {
        denied(await call("anonymous", "GET", url), 401);
      }
      denied(await call("anonymous", "POST", "/api/learning/generate", { sourceRef: RAG_REF, mode: "curated" }), 401);
    });

    await t.test("all four temporary roles login without seed passwords or real accounts", async () => {
      for (const [role, account] of Object.entries(ACCOUNTS)) {
        const r = await call("anonymous", "POST", "/api/login", { username: account.username, password: account.password });
        t.equal(r.status, 200, r.text);
        t.equal(r.json?.ok, true);
        t.equal(r.json?.role, account.role);
        t.equal(r.json?.mustChangePassword, account.mustChange);
        t.match(r.cookie, /^taller_sid=.+/);
        cookies[role] = r.cookie;
        const me = await call(role, "GET", "/api/me");
        t.equal(me.status, 200);
        t.deepEqual(me.json, { authenticated: true, username: account.username, role: account.role, mustChangePassword: account.mustChange });
      }
    });

    await t.test("must-change account cannot inspect or generate learning material", async () => {
      for (const url of ["/api/learning/sources", sourceQuery(RAG_REF), "/api/learning/jobs"]) {
        denied(await call("mustChange", "GET", url));
      }
      denied(await call("mustChange", "POST", "/api/learning/generate", { sourceRef: RAG_REF, mode: "curated" }));
    });

    await t.test("RAG source uses canonical chapter id and read-only source envelope", async () => {
      const r = await admin("GET", "/api/learning/sources?b=agent-handbook&c=ch4");
      t.equal(r.status, 200, r.text);
      t.equal(r.json?.ok, true);
      t.equal(r.json?.sources?.length, 1);
      t.deepEqual(r.json.sources[0].sourceRef, RAG_REF);
      t.equal(r.json.sources[0].coverage, "chapter");
      t.equal(r.json.sources[0].canGenerate, true);
      const before = await admin("GET", sourceQuery(RAG_REF));
      envelope(before, { state: "empty", kind: "kb" });
      t.ok(!before.json?.job && !before.json?.document);
    });

    let curated;
    await t.test("curated RAG generates a draft locally with no model key", async () => {
      curated = await generate(RAG_REF, "curated");
      const r = await admin("GET", "/api/learning/" + curated.id);
      envelope(r, { state: "draft", kind: "kb" });
      t.equal(r.json.document?.id, curated.id);
      t.equal(r.json.document?.state, "draft");
      t.equal(r.json.document?.sourceHash, r.json.source.hash);
      t.ok(!/LEARNING_TEST_EXTERNAL_IO_BLOCKED/.test(service.log), "curated generation attempted outbound I/O");
    });

    if (curated) {
      await t.test("user/family see no draft/job before approval, but public status remains empty", async () => {
        for (const role of ["user", "family"]) {
          denied(await call(role, "GET", "/api/learning/" + curated.id), 404);
          denied(await call(role, "GET", "/api/learning/jobs/" + curated.job.id));
          denied(await call(role, "GET", "/api/learning/jobs"));
          const r = await call(role, "GET", sourceQuery(RAG_REF));
          envelope(r, { state: "empty", admin: false, kind: "kb" });
          t.ok(!r.json.job && !r.json.document);
        }
      });

      await t.test("generate/approve/retry are admin-only, including must-change admin", async () => {
        for (const role of ["user", "family", "mustChange"]) {
          denied(await call(role, "POST", "/api/learning/generate", { sourceRef: RAG_REF, mode: "curated" }));
          denied(await call(role, "POST", "/api/learning/" + curated.id + "/approve", { sourceHash: "0".repeat(64) }));
          denied(await call(role, "POST", "/api/learning/jobs/" + curated.job.id + "/retry", {}));
        }
      });

      await t.test("cross-site Origin cannot generate, approve or retry an otherwise valid admin request", async () => {
        const status = await admin("GET", sourceQuery(RAG_REF));
        const mutations = [
          ["/api/learning/generate", { sourceRef: RAG_REF, mode: "curated" }],
          ["/api/learning/" + curated.id + "/approve", { sourceHash: status.json.source.hash }],
          ["/api/learning/jobs/" + curated.job.id + "/retry", {}],
        ];
        for (const [url, body] of mutations) {
          denied(await call("admin", "POST", url, body, { Origin: "https://cross-site.invalid", "Sec-Fetch-Site": "cross-site" }));
        }
        const after = await admin("GET", sourceQuery(RAG_REF));
        envelope(after, { state: "draft" });
        t.equal(after.json.document?.id, curated.id);
      });

      await t.test("approval is bound to the current source hash, not an arbitrary version", async () => {
        const bad = await admin("POST", "/api/learning/" + curated.id + "/approve", { sourceHash: "0".repeat(64) });
        denied(bad, 409);
        const draft = await admin("GET", "/api/learning/" + curated.id);
        envelope(draft, { state: "draft" });
        const approved = await admin("POST", "/api/learning/" + curated.id + "/approve", { sourceHash: draft.json.source.hash });
        envelope(approved, { state: "approved", kind: "kb" });
        t.equal(approved.json.document?.id, curated.id);
        t.equal(approved.json.document?.state, "approved");
      });

      await t.test("approved RAG is readable by user/family, without exposing job controls", async () => {
        for (const role of ["user", "family"]) {
          for (const url of ["/api/learning/" + curated.id, sourceQuery(RAG_REF)]) {
            const r = await call(role, "GET", url);
            envelope(r, { state: "approved", admin: false, kind: "kb" });
            t.equal(r.json.document?.id, curated.id);
            t.equal(r.json.document?.state, "approved");
            t.ok(!r.json.job);
          }
        }
      });
    }

    await t.test("Dala and selected hardware generate deterministic drafts with no model configuration", async () => {
      const dala = await generate(DALA_REF);
      const dalaDoc = await admin("GET", "/api/learning/" + dala.id);
      envelope(dalaDoc, { state: "draft", kind: "dala" });
      t.equal(dalaDoc.json.source.coverage, "selected-chapters");
      const available = await admin("GET", "/api/learning/sources");
      t.equal(available.status, 200, available.text);
      t.equal(available.json?.ok, true);
      t.ok(Array.isArray(available.json?.devices));
      t.equal(available.json.devices.length, fixture.devices.length);
      const ids = available.json.devices.map(device => device.id);
      t.equal(new Set(ids).size, fixture.devices.length);
      t.ok(ids.every(id => typeof id === "string" && !fixture.devices.some(d => id === d.name)));
      const selection = { kind: "hardware", deviceIds: ids.slice(0, 2) };
      const hw = await generate(selection);
      const hwDoc = await admin("GET", "/api/learning/" + hw.id);
      envelope(hwDoc, { state: "draft", kind: "hardware" });
      t.equal(hwDoc.json.source.coverage, "selected-devices");
      t.deepEqual([...hwDoc.json.source.sourceRef.deviceIds].sort(), [...selection.deviceIds].sort());
      t.ok(!/LEARNING_TEST_EXTERNAL_IO_BLOCKED/.test(service.log));
    });

    await t.test("article source is admin-only and reads the seeded cache without starting a fetch", async () => {
      const beforeBytes = fs.readFileSync(path.join(dataDir, "workbench-reader.json"), "utf8");
      const r = await admin("GET", sourceQuery(ARTICLE_REF));
      envelope(r, { state: "empty", kind: "article" });
      t.equal(r.json.source.coverage, "excerpt");
      t.equal(r.json.source.sourceRef.url, ARTICLE_URL);
      t.ok(r.json.source.blocks.some(b => b.text.includes("RAG retrieves")));
      for (const role of ["user", "family"]) denied(await call(role, "GET", sourceQuery(ARTICLE_REF)));
      const uncached = await admin("GET", sourceQuery({ kind: "article", url: UNCACHED_URL }));
      denied(uncached, 404);
      t.equal(fs.readFileSync(path.join(dataDir, "workbench-reader.json"), "utf8"), beforeBytes);
      t.ok(!/LEARNING_TEST_EXTERNAL_IO_BLOCKED/.test(service.log), "cache-only lookup attempted an external request");
    });

    await t.test("learning module and private learning files are never served as static files", async () => {
      for (const role of ["anonymous", "user", "family", "admin"]) {
        for (const url of ["/learning.js", "/data/learning/state.json", "/data/learning/index.json", "/data/learning/jobs.json", "/tools/learning-test-support.cjs"]) {
          const r = await call(role, "GET", url);
          t.equal(r.status, 404, r.text.slice(0, 100));
          t.equal(r.json?.error, "not found");
          t.ok(!r.text.includes('"sourceRef"') && !r.text.includes("createLearning"));
        }
      }
    });

    await t.test("existing chapter entry and per-user mark APIs still work using only temporary data", async () => {
      const chapter = await call("user", "GET", "/api/kb/chapter?b=agent-handbook&c=4");
      t.equal(chapter.status, 200, chapter.text);
      t.equal(chapter.json?.ok, true);
      t.match(chapter.json?.title || "", /RAG/i);
      t.ok(typeof chapter.json?.html === "string" && chapter.json.html.length > 0);
      const created = await call("user", "POST", "/api/kb/marks", {
        b: "agent-handbook", c: 4, quote: "RAG", note: "local learning regression fixture", pre: "", suf: "",
      });
      t.equal(created.status, 200, created.text);
      t.equal(created.json?.ok, true);
      const id = created.json?.mark?.id;
      t.equal(typeof id, "string");
      t.equal(created.json.mark.ask, "");
      t.equal(created.json.mark.answer, "");
      const own = await call("user", "GET", "/api/kb/marks?b=agent-handbook&c=4");
      t.equal(own.status, 200);
      t.ok(own.json?.marks?.some(mark => mark.id === id));
      const other = await call("family", "GET", "/api/kb/marks?b=agent-handbook&c=4");
      t.equal(other.status, 200);
      t.deepEqual(other.json?.marks, []);
      const removed = await call("user", "DELETE", "/api/kb/marks?id=" + encodeURIComponent(id));
      t.equal(removed.status, 200, removed.text);
      t.equal(removed.json?.ok, true);
      // Intentionally do not call /api/kb/ask: that is the real model route.
    });

    await t.test("approved generation survives a temporary server restart", async () => {
      if (!curated) throw new Error("curated draft prerequisite failed");
      await service.stop();
      const oldLog = service.log;
      service = await startServer(dataDir);
      const r = await call("family", "GET", "/api/learning/" + curated.id);
      envelope(r, { state: "approved", admin: false, kind: "kb" });
      t.equal(r.json.document?.id, curated.id);
      t.ok(!/LEARNING_TEST_EXTERNAL_IO_BLOCKED/.test(oldLog + service.log));
    });

    await t.test("offline run emitted no external-I/O attempts or seed password file", async () => {
      t.ok(!/LEARNING_TEST_EXTERNAL_IO_BLOCKED/.test(service.log), service.log);
      t.ok(!fs.existsSync(path.join(dataDir, "admin-initial-password.txt")));
      t.ok(!/\[workbench\].*(开始抓取|抓取开始)/.test(service.log), "background network scheduling ran in offline mode");
    });
  }
} finally {
  if (service) await service.stop();
  if (t.stats.failed && service) console.error("Temporary server diagnostic log (no credentials):\n" + service.log);
  removeTemp(dataDir);
  t.finish();
}
