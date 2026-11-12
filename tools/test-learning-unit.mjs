/* Node 24 only. Exercises the actual learning module through a loopback-only
   DI harness. All books/devices/reader entries are synthetic and every write
   is inside a temporary directory. Never calls a real model. */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import support from "./learning-test-support.cjs";

const require = createRequire(import.meta.url);
const {
  ROOT, NODE24, RAG_REF, DALA_REF, ARTICLE_REF, ARTICLE_URL, UNCACHED_URL,
  assertNode24, clone, delay, suite, fixtures, tempDir, removeTemp, cleanEnv,
  startModuleServer, request, stopChild, sourceQuery, pollJob,
} = support;
assertNode24();

// An actual process is killed while its injected fake model is waiting, so
// recovery is tested from disk, not by mutating an in-memory job to interrupted.
if (process.argv[2] === "--restart-worker") {
  const rig = await startModuleServer({ dataDir: process.argv[3], chat: () => new Promise(() => {}) });
  console.log("LEARNING_UNIT_READY " + rig.base);
  process.on("SIGTERM", () => process.exit(0));
} else {
  const t = suite("learning unit (Node 24, injected fake model)");
  const has = (object, key) => Object.prototype.hasOwnProperty.call(object || {}, key);
  const resolveFixture = (state, ref = RAG_REF, role = "admin") => module.resolveSource(ref, {
    getBooks: () => state.books, getReader: () => state.reader, getDevices: () => state.devices,
  }, support.SESSIONS[role]);
  const candidateFor = source => {
    const cite = source.blocks[0].id;
    return {
      kind: ({ kb: "flow", dala: "specimen", hardware: "comparison", article: "research" })[source.kind],
      title: "Local evidence-bound component fixture", goal: "Distinguish evidence from an example.",
      summary: "A synthetic learning draft with explicit references and no external claims.", cites: [cite],
      limitations: ["Only the injected local source is covered; human review is required."],
      components: [
        { type: "flow", title: "Local evidence flow", origin: "explanation", lanes: [{ title: "Evidence", steps: [
          { id: "fixture_step", title: "Read", text: "Read the cited excerpt.", cites: [cite] },
        ] }], branch: { from: "fixture_step", title: "Insufficient evidence", text: "State the boundary rather than guessing.", cites: [cite] } },
        { type: "steps", title: "Reading steps", origin: "explanation", items: [{ title: "Verify", text: "Check the supporting excerpt.", cites: [cite] }] },
        { type: "quiz", title: "Example exercise", origin: "example", question: "Suppose evidence is missing. What should the reader do?",
          options: ["Guess a conclusion", "State the limitation"], answerIndex: 1, explanation: "This is a hypothetical teaching example.", cites: [cite] },
        { type: "tokens", title: "Illustrative tokens", origin: "example", items: [
          { label: "Accent", value: "#223344", tokenType: "color", text: "An illustrative color, not executable style.", cites: [cite] },
          { label: "Spacing", value: "8px", tokenType: "space", text: "An illustrative spacing value.", cites: [cite] },
        ] },
        { type: "contrast", title: "Hypothetical comparison", origin: "example", bad: { title: "Guess", text: "Suppose we invent a missing result." },
          good: { title: "Limit", text: "Suppose we instead describe what is missing." }, cites: [cite] },
        { type: "comparison", title: "Evidence comparison", origin: "explanation", columns: [{ id: "given", title: "Given evidence" }],
          rows: [{ label: "Scope", values: ["Local source only"], cites: [cite] }] },
        { type: "cards", title: "Evidence note", origin: "source", items: [{ title: "Source", text: "The source discusses retrieval and supporting evidence.", cites: [cite] }] },
      ],
    };
  };
  let module;
  const withRig = async (options, fn) => {
    if (typeof options === "function") { fn = options; options = {}; }
    const dir = tempDir("taller-learning-unit-");
    let rig;
    try {
      rig = await startModuleServer({ dataDir: dir, ...options });
      await fn(rig, dir);
      t.equal(rig.errors.length, 0, "module handle must contain expected failures, not throw: " + rig.errors.map(e => e.message).join("; "));
    } finally {
      if (rig) await rig.stop();
      removeTemp(dir);
    }
  };
  const denied = (r, status) => {
    t.equal(r.status, status, r.text);
    t.equal(r.json?.ok, false);
    t.ok(!r.json?.document && !r.json?.job, "rejected request must not reveal drafts");
  };
  const source = async (rig, ref = RAG_REF) => {
    const r = await rig.call("GET", sourceQuery(ref));
    t.equal(r.status, 200, r.text);
    t.equal(r.json?.ok, true);
    t.match(r.json?.source?.hash || "", /^[a-f0-9]{64}$/);
    return r.json.source;
  };
  const generate = async (rig, ref = RAG_REF, mode = ref.kind === "kb" ? "curated" : undefined, target = "draft") => {
    const r = await rig.call("POST", "/api/learning/generate", { sourceRef: ref, ...(mode ? { mode } : {}) });
    t.equal(r.status, 202, r.text);
    t.equal(r.json?.ok, true);
    t.equal(typeof r.json?.job?.id, "string");
    const terminal = await pollJob(rig.call, r.json.job.id, target);
    t.equal(terminal.json.job.state, target);
    return terminal.json.job;
  };
  const getDoc = async (rig, id, expected = "draft") => {
    const r = await rig.call("GET", "/api/learning/" + encodeURIComponent(id));
    t.equal(r.status, 200, r.text);
    t.equal(r.json?.state, expected);
    t.equal(r.json?.document?.id, id);
    return r.json;
  };

  try {
    await t.test("module exports createLearning and only handles learning API routes", async () => {
      module = require(path.join(ROOT, "learning.js"));
      t.equal(typeof module.createLearning, "function");
      await withRig(async rig => {
        const r = await rig.call("GET", "/api/unrelated");
        t.equal(r.status, 404);
        t.equal(r.json?.error, "fixture route not handled");
      });
    });
    if (!module) {
      t.skip("remaining DI module cases", "learning.js is not available; no substitute implementation was loaded");
    } else {
      await t.test("source normalization, RAG source blocks and hash are stable across repeated GETs", async () => {
        await withRig(async rig => {
          const a = await source(rig);
          const b = await source(rig);
          t.equal(a.hash, b.hash);
          t.deepEqual(a.sourceRef, b.sourceRef);
          t.deepEqual(a.blocks, b.blocks);
          t.match(a.capturedAt, /^\d{4}-\d\d-\d\dT/);
          t.deepEqual(a.sourceRef, RAG_REF);
          t.equal(a.kind, "kb");
          t.equal(a.coverage, "chapter");
          t.ok(a.returnUrl.startsWith("/kb.html"));
          t.ok(Array.isArray(a.blocks) && a.blocks.length > 0);
          t.equal(new Set(a.blocks.map(b => b.id)).size, a.blocks.length);
          for (const block of a.blocks) {
            t.equal(typeof block.id, "string");
            t.ok(typeof block.text === "string" && block.text.length > 0);
            t.ok(has(block, "location"));
          }
          const s = await rig.call("GET", "/api/learning/sources?b=agent-handbook&c=ch4");
          t.equal(s.status, 200, s.text);
          t.deepEqual(s.json?.sources?.[0]?.sourceRef, RAG_REF);
          t.equal(s.json.sources[0].coverage, "chapter");
          t.equal(s.json.sources[0].canGenerate, true);
        });
      });

      await t.test("Dala source covers only the explicitly selected ch0..ch3", async () => {
        await withRig(async rig => {
          const s = await source(rig, DALA_REF);
          t.equal(s.kind, "dala");
          t.equal(s.coverage, "selected-chapters");
          t.ok(s.blocks.some(b => b.text.includes("warm surfaces")));
          t.ok(s.blocks.some(b => b.text.includes("accessible label")));
          t.ok(!JSON.stringify(s).includes("OUTSIDE_DALA_CH0_TO_CH3_SENTINEL"));
        });
      });

      await t.test("hardware source requires 1..3 opaque ids, canonicalizes order and excludes unselected devices", async () => {
        await withRig(async rig => {
          const r = await rig.call("GET", "/api/learning/sources?b=hw-devices");
          t.equal(r.status, 200, r.text);
          t.equal(r.json?.devices?.length, 3);
          t.ok(!r.json.source, "opening hardware catalog must not choose every device automatically");
          const ids = r.json.devices.map(d => d.id);
          t.ok(ids.every(id => typeof id === "string" && !rig.state.devices.some(d => d.name === id)));
          const a = await source(rig, { kind: "hardware", deviceIds: ids.slice(0, 2) });
          const b = await source(rig, { kind: "hardware", deviceIds: ids.slice(0, 2).reverse() });
          t.equal(a.hash, b.hash);
          t.deepEqual(a.sourceRef, b.sourceRef);
          t.equal(a.coverage, "selected-devices");
          const selected = r.json.devices.slice(0, 2).map(d => d.name);
          const excluded = r.json.devices[2].name;
          t.ok(selected.every(name => JSON.stringify(a.blocks).includes(name)));
          t.ok(!JSON.stringify(a.blocks).includes(excluded));
          for (const deviceIds of [[...ids, "dev_" + "0".repeat(24)], [rig.state.devices[0].name], [ids[0], ids[0]]]) {
            const invalid = await rig.call("GET", sourceQuery({ kind: "hardware", deviceIds }));
            t.equal(invalid.status, 400, invalid.text);
            t.equal(invalid.json?.ok, false);
            t.equal(invalid.json?.code, "invalid_source");
          }
          const empty = await source(rig, { kind: "hardware", deviceIds: [] });
          t.equal(empty.needsSelection, true);
          t.deepEqual(empty.blocks, []);
          const selectionRequired = await rig.call("POST", "/api/learning/generate", { sourceRef: { kind: "hardware", deviceIds: [] } });
          denied(selectionRequired, 422);
          t.equal(selectionRequired.json.code, "needs_selection");
          const unknown = await rig.call("GET", sourceQuery({ kind: "hardware", deviceIds: ["dev_" + "0".repeat(24)] }));
          denied(unknown, 404);
          t.equal(unknown.json.code, "source_not_found");
        });
      });

      await t.test("strict refs reject unknown fields, HTML, traversal, unsafe URL and invalid JSON", async () => {
        await withRig(async rig => {
          const invalidRefs = [
            { ...RAG_REF, html: "<script>bad()</script>" },
            { ...RAG_REF, sourceHash: "0".repeat(64) },
            { kind: "kb", bookId: "../agent-handbook", chapterId: "ch4" },
            { kind: "kb", bookId: "agent-handbook", chapterId: "<img src=x onerror=bad()>" },
            { kind: "dala", chapterIds: ["ch4"] },
            { kind: "article", url: "http://127.0.0.1/private" },
            { kind: "article", url: "https://www.anthropic.com.evil.test/research/x" },
            { kind: "article", url: "javascript:alert(1)" },
            { kind: "hardware", deviceIds: ["<svg onload=bad()>"] },
            { kind: "unsupported" },
          ];
          for (const ref of invalidRefs) {
            const r = await rig.call("POST", "/api/learning/generate", { sourceRef: ref, mode: "curated" });
            denied(r, 400);
          }
          for (const raw of ["not json", "[]", "null", "{}"]) {
            const r = await request(rig.base, "POST", "/api/learning/generate", { raw, headers: { Origin: rig.base } });
            denied(r, 400);
          }
          const extra = await rig.call("POST", "/api/learning/generate", { sourceRef: RAG_REF, mode: "curated", html: "<b>client template</b>" });
          denied(extra, 400);
          const badMode = await rig.call("POST", "/api/learning/generate", { sourceRef: RAG_REF, mode: "shell" });
          denied(badMode, 400);
          const badQuery = await rig.call("GET", "/api/learning/status?source=%7B");
          denied(badQuery, 400);
          const unknown = await rig.call("GET", sourceQuery({ kind: "kb", bookId: "missing-book", chapterId: "ch4" }));
          denied(unknown, 400);
          t.equal(unknown.json.code, "invalid_source");
        });
      });

      await t.test("curated RAG and deterministic Dala/hardware never invoke injected chat", async () => {
        let modelCalls = 0;
        await withRig({ chat: async () => { modelCalls++; throw new Error("curated must not call chat"); } }, async rig => {
          const rag = await generate(rig);
          const draft = await getDoc(rig, rag.documentId);
          t.equal(draft.document.state, "draft");
          t.equal(draft.document.sourceHash, draft.source.hash);
          const dala = await generate(rig, DALA_REF, undefined);
          await getDoc(rig, dala.documentId);
          const catalog = await rig.call("GET", "/api/learning/sources");
          const hwRef = { kind: "hardware", deviceIds: catalog.json.devices.slice(0, 2).map(d => d.id) };
          const hardware = await generate(rig, hwRef, undefined);
          await getDoc(rig, hardware.documentId);
          t.equal(modelCalls, 0);
        });
      });

      await t.test("identical source hash and mode deduplicate jobs and document versions", async () => {
        await withRig(async rig => {
          const body = { sourceRef: RAG_REF, mode: "curated" };
          const [a, b] = await Promise.all([
            rig.call("POST", "/api/learning/generate", body),
            rig.call("POST", "/api/learning/generate", body),
          ]);
          t.equal(a.status, 202, a.text);
          t.equal(b.status, 202, b.text);
          t.equal(a.json?.job?.id, b.json?.job?.id);
          const done = await pollJob(rig.call, a.json.job.id);
          const c = await rig.call("POST", "/api/learning/generate", body);
          t.equal(c.status, 202, c.text);
          t.equal(c.json?.job?.id, done.json.job.id);
          t.equal(c.json?.job?.documentId, done.json.job.documentId);
        });
      });

      await t.test("approval version hash, empty public status and post-approval visibility are exact", async () => {
        await withRig(async rig => {
          const job = await generate(rig);
          for (const role of ["user", "family"]) {
            denied(await rig.call("GET", "/api/learning/" + job.documentId, undefined, role), 404);
            const publicStatus = await rig.call("GET", sourceQuery(RAG_REF), undefined, role);
            t.equal(publicStatus.status, 200, publicStatus.text);
            t.equal(publicStatus.json?.state, "empty");
            t.equal(publicStatus.json?.admin, false);
            t.ok(!publicStatus.json.document && !publicStatus.json.job);
          }
          const status = await rig.call("GET", sourceQuery(RAG_REF));
          const bad = await rig.call("POST", "/api/learning/" + job.documentId + "/approve", { sourceHash: "0".repeat(64) });
          denied(bad, 409);
          await getDoc(rig, job.documentId);
          const approved = await rig.call("POST", "/api/learning/" + job.documentId + "/approve", { sourceHash: status.json.source.hash });
          t.equal(approved.status, 200, approved.text);
          t.equal(approved.json?.state, "approved");
          t.equal(approved.json?.document?.sourceHash, status.json.source.hash);
          t.equal(approved.json?.job?.state, "approved");
          const approvedJob = await rig.call("GET", "/api/learning/jobs/" + job.id);
          t.equal(approvedJob.status, 200, approvedJob.text);
          t.equal(approvedJob.json?.job?.state, "approved");
          const dedup = await rig.call("POST", "/api/learning/generate", { sourceRef: RAG_REF, mode: "curated" });
          t.equal(dedup.status, 202, dedup.text);
          t.equal(dedup.json?.job?.state, "approved");
          t.equal(dedup.json?.job?.documentId, job.documentId);
          for (const role of ["user", "family"]) {
            const r = await rig.call("GET", "/api/learning/" + job.documentId, undefined, role);
            t.equal(r.status, 200, r.text);
            t.equal(r.json?.state, "approved");
            t.equal(r.json?.document?.id, job.documentId);
            t.ok(!r.json.job);
          }
        });
      });

      await t.test("live source hash changes mark the old version stale and reject stale approval", async () => {
        await withRig(async rig => {
          const before = await source(rig);
          const job = await generate(rig);
          const approved = await rig.call("POST", "/api/learning/" + job.documentId + "/approve", { sourceHash: before.hash });
          t.equal(approved.status, 200, approved.text);
          const chapter = rig.state.books[0].chapters[0];
          chapter.text += "\n\nA newly revised retrieval evaluation fixture.";
          chapter.html += "<p>A newly revised retrieval evaluation fixture.</p>";
          const after = resolveFixture(rig.state).source;
          t.notEqual(after.hash, before.hash);
          const stale = await getDoc(rig, job.documentId, "stale");
          t.equal(stale.document.state, "approved", "historical approval is retained while response is stale");
          t.equal(stale.document.sourceHash, before.hash);
          t.equal(stale.source.hash, before.hash, "stale content must keep its original evidence snapshot");
          t.equal(stale.currentSourceHash, after.hash);
          for (const role of ["user", "family"]) {
            denied(await rig.call("GET", "/api/learning/" + job.documentId, undefined, role), 404);
            const publicStatus = await rig.call("GET", sourceQuery(RAG_REF), undefined, role);
            t.equal(publicStatus.status, 200, publicStatus.text);
            t.equal(publicStatus.json?.state, "empty");
            t.ok(!publicStatus.json?.document && !publicStatus.json?.job);
          }
          denied(await rig.call("POST", "/api/learning/" + job.documentId + "/approve", { sourceHash: before.hash }), 409);
          denied(await rig.call("POST", "/api/learning/" + job.documentId + "/approve", { sourceHash: after.hash }), 409);
          const refreshed = await generate(rig);
          t.notEqual(refreshed.id, job.id);
          t.notEqual(refreshed.documentId, job.documentId);
          const current = await getDoc(rig, refreshed.documentId);
          t.equal(current.document.sourceHash, after.hash);
        });
      });

      await t.test("a removed book is re-resolved on GET, generate and approval instead of trusting an old source", async () => {
        await withRig(async rig => {
          const before = await source(rig);
          const job = await generate(rig);
          rig.state.books = rig.state.books.filter(b => b.id !== "agent-handbook");
          denied(await rig.call("GET", sourceQuery(RAG_REF)), 404);
          denied(await rig.call("GET", "/api/learning/" + job.documentId), 404);
          denied(await rig.call("POST", "/api/learning/generate", { sourceRef: RAG_REF, mode: "curated" }), 404);
          denied(await rig.call("POST", "/api/learning/" + job.documentId + "/approve", { sourceHash: before.hash }), 404);
        });
      });

      await t.test("article lookup is cache-only, excerpt-scoped and denied to non-admin roles", async () => {
        const state = fixtures();
        const before = JSON.stringify(state.reader);
        let modelCalls = 0;
        await withRig({ state, chat: async () => { modelCalls++; throw new Error("not a generation request"); } }, async rig => {
          const s = await source(rig, ARTICLE_REF);
          t.equal(s.coverage, "excerpt");
          t.equal(s.sourceRef.url, ARTICLE_URL);
          t.ok(s.blocks.some(b => b.text.includes("RAG retrieves")));
          for (const role of ["user", "family"]) denied(await rig.call("GET", sourceQuery(ARTICLE_REF), undefined, role), 403);
          denied(await rig.call("GET", sourceQuery({ kind: "article", url: UNCACHED_URL })), 404);
          t.equal(JSON.stringify(state.reader), before);
          t.equal(modelCalls, 0);
        });
      });

      await t.test("component schema admits all seven fixed component types and deterministic builders", async () => {
        const state = fixtures();
        const s = resolveFixture(state).source;
        const valid = candidateFor(s);
        const normalized = module.validateDocument(valid, s);
        t.deepEqual(normalized, valid);
        t.deepEqual(normalized.components.map(c => c.type), ["flow", "steps", "quiz", "tokens", "contrast", "comparison", "cards"]);
        const curated = module.validateDocument(module.buildCuratedRag(s), s);
        t.equal(curated.kind, "flow");
        const flow = curated.components.find(c => c.type === "flow");
        t.deepEqual(flow.lanes.flatMap(l => l.steps).map(step => step.title), ["解析清洗", "切块", "向量化", "检索", "重排", "生成"]);
        t.equal(flow.branch.from, "rag_step_5", "refusal must branch after reranking, before unsupported generation");
        t.match(flow.branch.title, /拒答/);
        t.deepEqual(flow.branch.cites, [s.blocks.find(b => b.text.startsWith("7 拒答约束")).id]);
        t.ok(flow.lanes.flatMap(l => l.steps).some(step => step.id === flow.branch.from));
        const dala = resolveFixture(state, DALA_REF).source;
        const specimen = module.validateDocument(module.buildDala(dala), dala);
        t.equal(specimen.kind, "specimen");
        t.deepEqual(specimen.components.find(c => c.type === "tokens" && c.items[0].tokenType === "space").items.map(x => x.value), ["8px"]);
        t.ok(!JSON.stringify(specimen).includes("9999px"), "border radius is not a spacing token");
        const ids = module.projectDevices(state.devices).slice(0, 2).map(d => d.id);
        const hardware = resolveFixture(state, { kind: "hardware", deviceIds: ids });
        t.equal(module.validateDocument(module.buildHardware(hardware.source, hardware.material), hardware.source).kind, "comparison");
      });

      await t.test("schema rejects unknown fields, executable content, forged citations and excessive structure by exact invalid_document code", async () => {
        const s = resolveFixture(fixtures()).source;
        const valid = candidateFor(s);
        const changes = [
          ["extra root html", d => { d.html = "<p>bad</p>"; }],
          ["server-owned id", d => { d.id = "forged"; }],
          ["server-owned approval", d => { d.state = "approved"; }],
          ["forged generator", d => { d.generator = { type: "curated" }; }],
          ["forged hash", d => { d.sourceHash = s.hash; }],
          ["prototype-named property", d => { Object.defineProperty(d, "__proto__", { value: {}, enumerable: true }); }],
          ["wrong source kind", d => { d.kind = "research"; }],
          ["html title", d => { d.title = "<img src=x onerror=bad()>"; }],
          ["script in text", d => { d.components[1].items[0].text = "<script>bad()</script>"; }],
          ["svg text", d => { d.components[1].items[0].text = "<svg onload=bad()>"; }],
          ["javascript URI", d => { d.summary = "javascript:bad()"; }],
          ["external link", d => { d.goal = "https://external.invalid/request"; }],
          ["control character", d => { d.title = "unsafe\u0000control"; }],
          ["bidi override", d => { d.title = "unsafe\u202ehidden"; }],
          ["long title", d => { d.title = "x".repeat(181); }],
          ["long summary", d => { d.summary = "x".repeat(1601); }],
          ["long node text", d => { d.components[1].items[0].text = "x".repeat(1001); }],
          ["unknown component", d => { d.components[0].type = "html"; }],
          ["unknown component field", d => { d.components[1].style = "color:red"; }],
          ["invalid origin", d => { d.components[1].origin = "trusted-model"; }],
          ["forged header cite", d => { d.cites = ["missing_block"]; }],
          ["forged node cite", d => { d.components[1].items[0].cites = ["missing_block"]; }],
          ["duplicate cite", d => { d.cites = [s.blocks[0].id, s.blocks[0].id]; }],
          ["empty cite", d => { d.components[1].items[0].cites = []; }],
          ["duplicate flow step id", d => { d.components[0].lanes[0].steps.push(clone(d.components[0].lanes[0].steps[0])); }],
          ["branch to missing step", d => { d.components[0].branch.from = "missing_step"; }],
          ["out-of-range quiz answer", d => { d.components[2].answerIndex = 2; }],
          ["fractional quiz answer", d => { d.components[2].answerIndex = 0.5; }],
          ["quiz as source", d => { d.components[2].origin = "source"; }],
          ["short color", d => { d.components[3].items[0].value = "#abc"; }],
          ["CSS injection", d => { d.components[3].items[1].value = "8px;display:none"; }],
          ["untyped CSS expression", d => { d.components[3].items[1].value = "calc(8px + 1rem)"; }],
          ["contrast as fact", d => { d.components[4].origin = "source"; }],
          ["wrong comparison cell count", d => { d.components[5].rows[0].values.push("extra"); }],
          ["duplicate comparison column", d => { d.components[5].columns.push(clone(d.components[5].columns[0])); }],
          ["no components", d => { d.components = []; }],
          ["over component cap", d => { d.components = Array.from({ length: 9 }, () => clone(d.components[6])); }],
          ["over item cap", d => { d.components[1].items = Array.from({ length: 13 }, () => clone(d.components[1].items[0])); }],
          ["over limitation cap", d => { d.limitations = Array(11).fill("A boundary."); }],
          ["over aggregate node cap", d => {
            const makeFlow = i => ({ type: "flow", title: "Dense fixture " + i, origin: "example", lanes: Array.from({ length: 3 }, (_, lane) => ({
              title: "Lane " + lane, steps: Array.from({ length: lane === 0 ? 6 : 5 }, (_, step) => ({
                id: "s_" + lane + "_" + step, title: "Step", text: "Hypothetical example.", cites: [s.blocks[0].id],
              })),
            })) });
            d.components = Array.from({ length: 8 }, (_, i) => makeFlow(i));
          }],
        ];
        for (const [name, change] of changes) {
          const invalid = clone(valid); change(invalid);
          t.throws(() => module.validateDocument(invalid, s), error => error instanceof module.LearningError && error.code === "invalid_document" && error.status === 400, name);
        }
        t.equal({}.polluted, undefined);
      });

      await t.test("strict model parser accepts only complete JSON or a complete JSON fence", async () => {
        const valid = candidateFor(resolveFixture(fixtures()).source);
        t.deepEqual(module.parseModelDocument(JSON.stringify(valid)), valid);
        t.deepEqual(module.parseModelDocument("```json\n" + JSON.stringify(valid) + "\n```"), valid);
        for (const raw of ["prefix " + JSON.stringify(valid), JSON.stringify(valid) + " trailing", "```json\n{}\n```\ntrailing", "not-json", "x".repeat(module.LIMITS.modelBytes + 1)]) {
          t.throws(() => module.parseModelDocument(raw), { code: "invalid_document", status: 400 });
        }
      });

      await t.test("source projection excludes note/comment/instruction containers and never reads article cache before authorization", async () => {
        const state = fixtures();
        const before = resolveFixture(state).source;
        state.books[0].note = "PRIVATE_BOOK_NOTE_SENTINEL";
        state.books[0].chapters[0].note = "PRIVATE_CHAPTER_NOTE_SENTINEL";
        state.books[0].chapters[0].html += '<!--PRIVATE_COMMENT_SENTINEL--><script>PRIVATE_SCRIPT_SENTINEL</script>' +
          '<aside>PRIVATE_ASIDE_SENTINEL</aside><div class="notes"><p>PRIVATE_NOTE_CONTAINER_SENTINEL</p></div>';
        const after = resolveFixture(state).source;
        t.equal(after.hash, before.hash);
        t.deepEqual(after.blocks, before.blocks);
        const prompt = module.buildPrompt(after);
        t.ok(!prompt.includes("PRIVATE_"));
        t.match(prompt, /不可信数据/);
        t.ok(!prompt.includes("PRIVATE_BOOK_NOTE_SENTINEL"));
        let reads = 0;
        const deps = { getBooks: () => { reads++; return state.books; }, getReader: () => { reads++; return state.reader; }, getDevices: () => { reads++; return state.devices; } };
        t.throws(() => module.resolveSource(ARTICLE_REF, deps, support.SESSIONS.user), { code: "forbidden", status: 403 });
        t.equal(reads, 0);
        t.throws(() => module.resolveSource(RAG_REF, deps, null), { code: "unauthorized", status: 401 });
        t.equal(reads, 0);
        const ambiguous = clone(state.devices[0]);
        const projected = module.projectDevices([...state.devices, ambiguous]);
        t.ok(!projected.some(d => d.id === module.deviceId(ambiguous)), "ambiguous device identity must not select an arbitrary duplicate");
      });

      await t.test("RAG and research model jobs use only injected valid component JSON", async () => {
        for (const ref of [RAG_REF, ARTICLE_REF]) {
          const state = fixtures();
          const s = resolveFixture(state, ref).source;
          const valid = candidateFor(s);
          const calls = [];
          await withRig({ state, chat: async (prompt, options) => { calls.push({ prompt, options }); return JSON.stringify(valid); } }, async (rig, dir) => {
            const job = await generate(rig, ref, "model");
            t.equal(calls.length, 1);
            t.equal(job.mode, "model");
            t.equal(job.attempt, 1);
            t.equal(calls[0].options.temperature, 0.1);
            t.equal(calls[0].options.maxTokens, 6000);
            t.match(calls[0].prompt, /不可信数据/);
            t.ok(calls[0].prompt.includes(s.blocks[0].id));
            const doc = await getDoc(rig, job.documentId);
            t.deepEqual(doc.document.components, valid.components);
            t.equal(doc.document.generator.type, "model");
            t.ok(doc.document.limitations.some(x => x.includes("AI 生成草稿")));
            const store = JSON.parse(fs.readFileSync(path.join(dir, "learning", "state.json"), "utf8"));
            t.equal(store.documents.length, 1);
            if (ref.kind === "article") {
              t.equal(doc.source.coverage, "excerpt");
              t.equal(doc.source.completeness, "unverified");
              t.ok(doc.document.limitations.some(x => x.includes("缓存摘录")));
            }
          });
        }
      });

      await t.test("model error has no automatic fallback/retry and explicit retry keeps job identity with attempt 2", async () => {
        const state = fixtures();
        const valid = candidateFor(resolveFixture(state, ARTICLE_REF).source);
        let calls = 0, succeed = false;
        await withRig({ state, chat: async () => { calls++; if (!succeed) throw new Error("PRIVATE_FAKE_PROVIDER_ERROR_SENTINEL"); return JSON.stringify(valid); } }, async (rig, dir) => {
          const failed = await generate(rig, ARTICLE_REF, "model", "failed");
          t.equal(failed.error?.code, "model_failed");
          t.equal(failed.documentId, null);
          t.equal(failed.attempt, 1);
          await delay(80);
          t.equal(calls, 1, "no automatic retry after failure");
          const store = JSON.parse(fs.readFileSync(path.join(dir, "learning", "state.json"), "utf8"));
          t.equal(store.documents.length, 0, "model failure must not synthesize curated content");
          t.ok(!JSON.stringify(store).includes("PRIVATE_FAKE_PROVIDER_ERROR_SENTINEL"));
          const duplicate = await rig.call("POST", "/api/learning/generate", { sourceRef: ARTICLE_REF, mode: "model" });
          t.equal(duplicate.status, 202);
          t.equal(duplicate.json?.job?.id, failed.id);
          t.equal(duplicate.json?.job?.state, "failed");
          t.equal(calls, 1, "generate is not an implicit retry");
          succeed = true;
          const retried = await rig.call("POST", "/api/learning/jobs/" + failed.id + "/retry", {});
          t.equal(retried.status, 202, retried.text);
          t.equal(retried.json?.job?.id, failed.id);
          t.equal(retried.json?.job?.attempt, 2);
          const done = await pollJob(rig.call, failed.id);
          t.equal(done.json.job.attempt, 2);
          t.equal(calls, 2);
          const doc = await getDoc(rig, done.json.job.documentId);
          t.equal(doc.document.generator.type, "model");
          denied(await rig.call("POST", "/api/learning/jobs/" + failed.id + "/retry", {}), 409);
        });
      });

      await t.test("malformed and executable model output fail invalid_document, not success or curated fallback", async () => {
        for (const makeRaw of [() => "not valid JSON", valid => JSON.stringify({ ...valid, html: "<img src=x onerror=bad()>" }), valid => {
          valid.components[1].items[0].cites = ["fabricated_reference"]; return JSON.stringify(valid);
        }]) {
          const state = fixtures();
          const valid = candidateFor(resolveFixture(state).source);
          let calls = 0;
          await withRig({ state, chat: async () => { calls++; return makeRaw(clone(valid)); } }, async (rig, dir) => {
            const job = await generate(rig, RAG_REF, "model", "failed");
            t.equal(job.error?.code, "invalid_document");
            t.equal(job.documentId, null);
            t.equal(calls, 1);
            const status = await rig.call("GET", sourceQuery(RAG_REF));
            t.equal(status.json?.state, "failed");
            t.ok(!status.json.document);
            t.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, "learning", "state.json"), "utf8")).documents, []);
          });
        }
      });

      await t.test("short article full=1 is not enough evidence and lookup/generation never fetches or calls chat", async () => {
        const state = fixtures();
        state.reader[ARTICLE_URL].paras = [["Only a short excerpt.", "只有短摘录。"]];
        state.reader[ARTICLE_URL].full = 1;
        let calls = 0;
        await withRig({ state, chat: async () => { calls++; return "{}"; } }, async rig => {
          const s = await source(rig, ARTICLE_REF);
          t.equal(s.coverage, "excerpt");
          t.equal(s.completeness, "unverified");
          t.equal(s.generationAllowed, false);
          const r = await rig.call("POST", "/api/learning/generate", { sourceRef: ARTICLE_REF, mode: "model" });
          denied(r, 422);
          t.equal(r.json?.code, "needs_source");
          t.equal(calls, 0);
        });
      });

      await t.test("source change while fake model is running cannot publish a draft with old evidence", async () => {
        const state = fixtures();
        const valid = candidateFor(resolveFixture(state).source);
        let release, started;
        const waiting = new Promise(resolve => { started = resolve; });
        const output = new Promise(resolve => { release = resolve; });
        await withRig({ state, chat: async () => { started(); return output; } }, async (rig, dir) => {
          const r = await rig.call("POST", "/api/learning/generate", { sourceRef: RAG_REF, mode: "model" });
          t.equal(r.status, 202, r.text);
          await Promise.race([waiting, delay(2000).then(() => { throw new Error("fake model never entered running state"); })]);
          state.books[0].chapters[0].html += "<p>Revision while the fake model is waiting.</p>";
          release(JSON.stringify(valid));
          const deadline = Date.now() + 5000;
          let disk;
          do {
            disk = JSON.parse(fs.readFileSync(path.join(dir, "learning", "state.json"), "utf8"));
            if (disk.jobs[0].state === "failed") break;
            await delay(15);
          } while (Date.now() < deadline);
          t.equal(disk.jobs[0].state, "failed");
          t.equal(disk.jobs[0].error?.code, "source_changed");
          t.deepEqual(disk.documents, []);
          const status = await rig.call("GET", sourceQuery(RAG_REF));
          t.equal(status.status, 200);
          t.equal(status.json?.state, "stale");
          t.equal(status.json?.job?.error?.code, "source_changed");
          t.ok(!status.json.document);
        });
      });

      await t.test("removing the article cache purges its research snapshot, job and document durably", async () => {
        const state = fixtures();
        const valid = candidateFor(resolveFixture(state, ARTICLE_REF).source);
        await withRig({ state, chat: async () => JSON.stringify(valid) }, async (rig, dir) => {
          const job = await generate(rig, ARTICLE_REF, "model");
          await getDoc(rig, job.documentId);
          delete state.reader[ARTICLE_URL];
          const r = await rig.call("GET", sourceQuery(ARTICLE_REF));
          denied(r, 404);
          t.equal(r.json?.code, "source_not_found");
          denied(await rig.call("GET", "/api/learning/jobs/" + job.id), 404);
          denied(await rig.call("GET", "/api/learning/" + job.documentId), 404);
          const store = JSON.parse(fs.readFileSync(path.join(dir, "learning", "state.json"), "utf8"));
          t.deepEqual(store.jobs, []);
          t.deepEqual(store.documents, []);
          t.deepEqual(store.snapshots, []);
          t.ok(!JSON.stringify(store).includes("retrieval"));
        });
      });

      await t.test("transaction write failure returns exact 503 storage_write_failed without false approval or corrupted prior state", async () => {
        await withRig(async (rig, dir) => {
          const job = await generate(rig);
          const current = await getDoc(rig, job.documentId);
          const storeFile = path.join(dir, "learning", "state.json");
          const before = fs.readFileSync(storeFile, "utf8");
          // A real filesystem obstruction, not chmod (which silently succeeds as root).
          const saved = path.join(dir, "learning-saved");
          fs.renameSync(path.join(dir, "learning"), saved);
          fs.writeFileSync(path.join(dir, "learning"), "local deliberate write obstruction");
          try {
            const r = await rig.call("POST", "/api/learning/" + job.documentId + "/approve", { sourceHash: current.source.hash });
            denied(r, 503);
            t.equal(r.json?.code, "storage_write_failed");
            t.equal(fs.readFileSync(path.join(saved, "state.json"), "utf8"), before);
          } finally {
            fs.unlinkSync(path.join(dir, "learning"));
            fs.renameSync(saved, path.join(dir, "learning"));
          }
          const persisted = JSON.parse(fs.readFileSync(storeFile, "utf8"));
          t.equal(persisted.documents[0].state, "draft");
          t.ok(!persisted.documents[0].approvedAt);
          t.deepEqual(fs.readdirSync(path.join(dir, "learning")), ["state.json"]);
          const failClosed = await rig.call("GET", sourceQuery(RAG_REF));
          denied(failClosed, 503);
          t.equal(failClosed.json.code, "storage_write_failed");
          const reloaded = await startModuleServer({ dataDir: dir });
          try { await getDoc(reloaded, job.documentId); } finally { await reloaded.stop(); }
        });
      });

      await t.test("corrupt stored JSON fails closed with exact storage_read_failed and is never overwritten", async () => {
        const dir = tempDir("taller-learning-corrupt-");
        let rig;
        try {
          const storeFile = path.join(dir, "learning", "state.json");
          fs.mkdirSync(path.dirname(storeFile));
          fs.writeFileSync(storeFile, "{ deliberately malformed local store");
          rig = await startModuleServer({ dataDir: dir });
          const r = await rig.call("GET", sourceQuery(RAG_REF));
          denied(r, 503);
          t.equal(r.json?.code, "storage_read_failed");
          denied(await rig.call("POST", "/api/learning/generate", { sourceRef: RAG_REF, mode: "curated" }), 503);
          t.equal(fs.readFileSync(storeFile, "utf8"), "{ deliberately malformed local store");
        } finally { if (rig) await rig.stop(); removeTemp(dir); }
      });

      await t.test("source discovery/status GETs are read-only and unsupported mutation methods return exact 405", async () => {
        await withRig(async (rig, dir) => {
          for (const url of ["/api/learning/sources", "/api/learning/sources?b=hw-devices", sourceQuery(RAG_REF), sourceQuery(DALA_REF), sourceQuery(ARTICLE_REF)]) {
            const r = await rig.call("GET", url);
            t.equal(r.status, 200, r.text);
            t.equal(r.json?.ok, true);
          }
          t.ok(!fs.existsSync(path.join(dir, "learning")), "GET must not materialize jobs or learning storage");
          for (const method of ["PUT", "PATCH", "DELETE"]) {
            const r = await rig.call(method, "/api/learning/generate", { sourceRef: RAG_REF, mode: "curated" });
            denied(r, 405);
            t.equal(r.json?.code, "method_not_allowed");
          }
          t.ok(!fs.existsSync(path.join(dir, "learning")));
        });
      });

      await t.test("a second draft version never silently replaces the exact approved version for public readers", async () => {
        const state = fixtures();
        const valid = candidateFor(resolveFixture(state).source);
        await withRig({ state, chat: async () => JSON.stringify(valid) }, async rig => {
          const first = await generate(rig);
          const current = await source(rig);
          const approval = await rig.call("POST", "/api/learning/" + first.documentId + "/approve", { sourceHash: current.hash });
          t.equal(approval.status, 200, approval.text);
          const second = await generate(rig, RAG_REF, "model");
          t.notEqual(second.documentId, first.documentId);
          for (const role of ["user", "family"]) {
            const publicStatus = await rig.call("GET", sourceQuery(RAG_REF), undefined, role);
            t.equal(publicStatus.status, 200);
            t.equal(publicStatus.json?.state, "approved");
            t.equal(publicStatus.json?.document?.id, first.documentId);
            denied(await rig.call("GET", "/api/learning/" + second.documentId, undefined, role), 404);
          }
          const adminStatus = await rig.call("GET", sourceQuery(RAG_REF));
          t.equal(adminStatus.json?.state, "draft");
          t.equal(adminStatus.json?.document?.id, second.documentId);
          t.equal(adminStatus.json?.approvedDocumentId, first.documentId);
          const secondApproval = await rig.call("POST", "/api/learning/" + second.documentId + "/approve", { sourceHash: current.hash });
          t.equal(secondApproval.status, 200, secondApproval.text);
          const published = await rig.call("GET", sourceQuery(RAG_REF), undefined, "family");
          t.equal(published.json?.document?.id, second.documentId);
          t.equal(published.json?.state, "approved");
        });
      });

      await t.test("write obstruction during enqueue yields 503 and never calls chat or acknowledges a queued job", async () => {
        let calls = 0;
        await withRig({ chat: async () => { calls++; return "{}"; } }, async (rig, dir) => {
          const ready = await rig.call("GET", sourceQuery(RAG_REF));
          t.equal(ready.status, 200);
          fs.writeFileSync(path.join(dir, "learning"), "real local filesystem obstruction");
          try {
            const r = await rig.call("POST", "/api/learning/generate", { sourceRef: RAG_REF, mode: "model" });
            denied(r, 503);
            t.equal(r.json?.code, "storage_write_failed");
            t.equal(calls, 0);
            t.equal(fs.readFileSync(path.join(dir, "learning"), "utf8"), "real local filesystem obstruction");
          } finally { fs.unlinkSync(path.join(dir, "learning")); }
          t.ok(!fs.existsSync(path.join(dir, "learning", "state.json")));
        });
      });

      await t.test("failed tasks stop at the explicit manual retry limit without extra model invocations", async () => {
        let calls = 0;
        await withRig({ chat: async () => { calls++; throw new Error("synthetic failure"); } }, async rig => {
          const job = await generate(rig, RAG_REF, "model", "failed");
          for (let attempt = 2; attempt <= module.LIMITS.retries; attempt++) {
            const r = await rig.call("POST", "/api/learning/jobs/" + job.id + "/retry", {});
            t.equal(r.status, 202, r.text);
            t.equal(r.json?.job?.attempt, attempt);
            const failed = await pollJob(rig.call, job.id, "failed");
            t.equal(failed.json.job.attempt, attempt);
            t.equal(failed.json.job.error?.code, "model_failed");
          }
          t.equal(calls, module.LIMITS.retries);
          const r = await rig.call("POST", "/api/learning/jobs/" + job.id + "/retry", {});
          denied(r, 409);
          t.equal(r.json?.code, "retry_limit");
          t.equal(calls, module.LIMITS.retries);
        });
      });

      await t.test("actual Node24 worker death recovers running and queued jobs as interrupted, only manual retry resumes", async () => {
        const dir = tempDir("taller-learning-restart-");
        let child, reloaded;
        let log = "";
        try {
          child = spawn(NODE24, ["--require", path.join(ROOT, "tools", "learning-test-support.cjs"), fileURLToPath(import.meta.url), "--restart-worker", dir], {
            cwd: ROOT, env: cleanEnv(dir), stdio: ["ignore", "pipe", "pipe"],
          });
          child.stdout.on("data", data => { log += data.toString(); });
          child.stderr.on("data", data => { log += data.toString(); });
          const readyDeadline = Date.now() + 6000;
          while (!/LEARNING_UNIT_READY (http:\/\/127\.0\.0\.1:\d+)/.test(log) && Date.now() < readyDeadline && child.exitCode === null) await delay(15);
          const base = /LEARNING_UNIT_READY (http:\/\/127\.0\.0\.1:\d+)/.exec(log)?.[1];
          t.ok(base, "worker did not start: " + log);
          const send = (method, url, body) => request(base, method, url, { body, headers: { Origin: base } });
          const first = await send("POST", "/api/learning/generate", { sourceRef: RAG_REF, mode: "model" });
          t.equal(first.status, 202, first.text);
          const firstId = first.json.job.id;
          const deadline = Date.now() + 4000;
          let running;
          do {
            running = await send("GET", "/api/learning/jobs/" + firstId);
            if (running.json?.job?.state === "running") break;
            await delay(15);
          } while (Date.now() < deadline);
          t.equal(running.status, 200);
          t.equal(running.json?.job?.state, "running");
          const second = await send("POST", "/api/learning/generate", { sourceRef: ARTICLE_REF, mode: "model" });
          t.equal(second.status, 202, second.text);
          t.equal(second.json?.job?.state, "queued");
          const before = JSON.parse(fs.readFileSync(path.join(dir, "learning", "state.json"), "utf8"));
          t.deepEqual(before.jobs.map(j => j.state), ["running", "queued"]);
          const killed = new Promise(resolve => child.once("exit", resolve));
          t.equal(child.kill("SIGKILL"), true);
          await killed;
          t.ok(!log.includes("LEARNING_TEST_EXTERNAL_IO_BLOCKED"));
          let modelCalls = 0;
          const state = fixtures();
          reloaded = await startModuleServer({ dataDir: dir, state, chat: async () => {
            modelCalls++; return JSON.stringify(candidateFor(resolveFixture(state).source));
          } });
          const all = await reloaded.call("GET", "/api/learning/jobs");
          t.equal(all.status, 200, all.text);
          t.equal(all.json?.jobs?.length, 2);
          t.ok(all.json.jobs.every(j => j.state === "interrupted" && j.error?.code === "interrupted" && j.documentId === null && j.attempt === 1));
          await delay(50);
          t.equal(modelCalls, 0, "restart must not auto-resume jobs");
          const recovered = JSON.parse(fs.readFileSync(path.join(dir, "learning", "state.json"), "utf8"));
          t.deepEqual(recovered.jobs.map(j => j.state), ["interrupted", "interrupted"]);
          t.deepEqual(recovered.documents, []);
          const retry = await reloaded.call("POST", "/api/learning/jobs/" + firstId + "/retry", {});
          t.equal(retry.status, 202, retry.text);
          t.equal(retry.json?.job?.id, firstId);
          t.equal(retry.json?.job?.attempt, 2);
          const done = await pollJob(reloaded.call, firstId);
          t.equal(done.json.job.state, "draft");
          t.equal(modelCalls, 1);
          const waiting = await reloaded.call("GET", "/api/learning/jobs/" + second.json.job.id);
          t.equal(waiting.json?.job?.state, "interrupted");
        } finally {
          if (child) await stopChild(child);
          if (reloaded) await reloaded.stop();
          removeTemp(dir);
        }
      });
    }
  } finally {
    t.finish();
  }
}
