/* Node 24 acceptance: source/VM + isolated loopback HTTP, never browser/WebGL.
   Run: /path/to/node24 tools/test-atlas-body.mjs
   Only explicitly named source/assets and helper-created temporary DATA are read. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import vm from "node:vm";
import { spawn, spawnSync } from "node:child_process";
import support from "./learning-test-support.cjs";
import { DEMO_WEARS, createDemoDevices } from "./preview-atlas-body.mjs";

const {
  ROOT, NODE24, ACCOUNTS, assertNode24, suite, tempDir, seedServerData, writeJson,
  cleanEnv, startServer, request, stopChild, removeTemp,
} = support;
assertNode24();
const t = suite("atlas body (Node 24, static/VM + offline loopback HTTP; no WebGL)");
const MODEL = "assets/models/wearable-female-233ddd7a.glb";
const MODEL_SHA256 = "233ddd7abb5af07d7c4131b34f66fade79a5af733be42df5609fc8132d7476d3";
const VENDOR = "assets/vendor/three-r180/";
const VENDOR_FILES = ["three.module.js", "three.core.js", "GLTFLoader.js", "OrbitControls.js", "BufferGeometryUtils.js", "LICENSE.txt"];
const dataDir = tempDir("taller-learning-atlas-test-");
const devices = createDemoDevices();
const cookies = {};
let service;
const source = name => fs.readFileSync(path.join(ROOT, name), "utf8");
const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex");
const call = (role, method, url, body) => request(service.base, method, url, {
  body, cookie: cookies[role] || "", headers: { Origin: service.base },
});
const names = list => list.map(d => d.name);
const sortDevices = list => [...list].sort((a, b) => a.name.localeCompare(b.name));

function syntaxCheck(code, filename) {
  const result = spawnSync(NODE24, ["--input-type=module", "--check"], {
    input: code, encoding: "utf8", env: cleanEnv(dataDir), cwd: ROOT, timeout: 10000,
  });
  t.equal(result.error, undefined, filename + ": " + result.error);
  t.equal(result.status, 0, filename + ": " + result.stderr);
}
function arrayConstant(code, name) {
  const match = code.match(new RegExp("\\bconst\\s+" + name + "\\s*=\\s*(\\[[^;]*?\\])\\s*;"));
  t.ok(match, "Missing explicit " + name + " whitelist");
  return JSON.parse(vm.runInNewContext("JSON.stringify(" + match[1] + ")", {}, { timeout: 1000 }));
}
function functionSource(code, name) {
  const start = code.search(new RegExp("\\bfunction\\s+" + name + "\\s*\\("));
  t.ok(start >= 0, "Missing shared filter function " + name);
  // Parse candidates without executing any page code; braces in strings/comments
  // cannot prematurely terminate a successfully parsed function expression.
  let end = code.indexOf("}", start);
  while (end >= 0) {
    const candidate = code.slice(start, end + 1);
    try { new vm.Script("(" + candidate + ")"); return candidate; }
    catch { end = code.indexOf("}", end + 1); }
  }
  throw new Error("Cannot extract " + name);
}
function moduleSpecifiers(code) {
  const pattern = /(?:^|\n)[ \t]*(?:import|export)\s+(?:\*[\s\w,$]*|\{[^}]*\}|[\w$]+)\s+from\s*["']([^"']+)["']|(?:^|\n)[ \t]*import\s*["']([^"']+)["']/g;
  return [...code.matchAll(pattern)].map(m => m[1] || m[2]);
}
function validateModel(bytes) {
  t.equal(sha256(bytes), MODEL_SHA256, "Pinned GLB sha256");
  t.ok(bytes.length >= 20);
  t.equal(bytes.readUInt32LE(0), 0x46546c67, "glTF magic");
  t.equal(bytes.readUInt32LE(4), 2, "GLB version 2");
  t.equal(bytes.readUInt32LE(8), bytes.length, "Declared GLB length");
  const chunks = [];
  let offset = 12;
  while (offset < bytes.length) {
    t.ok(offset + 8 <= bytes.length, "Complete chunk header");
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4);
    t.equal(length % 4, 0, "4-byte aligned chunk");
    t.ok(length > 0 && offset + 8 + length <= bytes.length, "Chunk bounds");
    chunks.push({ type, data: bytes.subarray(offset + 8, offset + 8 + length) });
    offset += 8 + length;
  }
  t.equal(offset, bytes.length);
  t.deepEqual(chunks.map(c => c.type), [0x4e4f534a, 0x004e4942], "JSON then embedded BIN");
  const gltf = JSON.parse(chunks[0].data.toString("utf8"));
  t.equal(gltf.asset?.version, "2.0");
  t.equal(gltf.buffers?.length, 1);
  t.ok(!Object.hasOwn(gltf.buffers[0], "uri"), "Buffer is embedded, not a linked file");
  t.ok(gltf.buffers[0].byteLength > 0 && gltf.buffers[0].byteLength <= chunks[1].data.length);
  t.ok(chunks[1].data.length - gltf.buffers[0].byteLength <= 3, "Only legal BIN padding");
  t.ok(gltf.meshes?.length > 0 && gltf.nodes?.length > 0 && gltf.scenes?.length > 0);
  t.ok(gltf.scenes[gltf.scene ?? 0], "Default scene exists");
  for (const view of gltf.bufferViews || []) {
    t.equal(view.buffer, 0);
    t.ok(Number.isInteger(view.byteOffset ?? 0) && (view.byteOffset ?? 0) >= 0);
    t.ok(Number.isInteger(view.byteLength) && view.byteLength > 0);
    t.ok((view.byteOffset ?? 0) + view.byteLength <= gltf.buffers[0].byteLength, "bufferView fits BIN");
  }
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
  const componentBytes = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  for (const accessor of gltf.accessors || []) {
    const view = gltf.bufferViews[accessor.bufferView];
    const size = componentBytes[accessor.componentType];
    t.ok(view && size && components[accessor.type], "Accessor references valid data/type");
    t.ok(Number.isInteger(accessor.count) && accessor.count > 0);
    const start = accessor.byteOffset ?? 0, elementBytes = size * components[accessor.type];
    t.ok(Number.isInteger(start) && start >= 0 && start % size === 0);
    t.ok(start + (accessor.count - 1) * (view.byteStride || elementBytes) + elementBytes <= view.byteLength,
      "Accessor fits its bufferView");
  }
  for (const mesh of gltf.meshes) {
    for (const primitive of mesh.primitives || []) {
      const positions = gltf.accessors[primitive.attributes?.POSITION];
      t.ok(positions && positions.type === "VEC3" && positions.componentType === 5126);
      for (const index of Object.values(primitive.attributes || {})) t.ok(gltf.accessors[index], "Attribute accessor exists");
      if (primitive.indices !== undefined) {
        const indices = gltf.accessors[primitive.indices];
        t.ok(indices && indices.type === "SCALAR" && [5121, 5123, 5125].includes(indices.componentType));
        const view = gltf.bufferViews[indices.bufferView];
        const start = (view.byteOffset || 0) + (indices.byteOffset || 0), size = componentBytes[indices.componentType];
        const read = { 1: "readUInt8", 2: "readUInt16LE", 4: "readUInt32LE" }[size];
        let legal = true;
        for (let i = 0; i < indices.count; i++) {
          if (chunks[1].data[read](start + i * size) >= positions.count) { legal = false; break; }
        }
        t.ok(legal, "Triangle indices reference existing vertices");
      }
    }
  }
  for (const image of gltf.images || []) {
    t.ok(Number.isInteger(image.bufferView) && gltf.bufferViews[image.bufferView], "Image bytes embedded in BIN");
    t.match(image.mimeType || "", /^image\/(?:jpeg|png|webp)$/);
    t.ok(!Object.hasOwn(image, "uri"));
  }
  function noExternal(value) {
    if (typeof value === "string") t.ok(!/(?:https?:|file:|ftp:)\/\/|^\/\//i.test(value), "No external link in GLB JSON");
    else if (Array.isArray(value)) value.forEach(noExternal);
    else if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value)) {
        if (/^(?:uri|url|href)$/i.test(key)) t.match(String(child), /^data:/, "Only inline resource URIs allowed");
        noExternal(child);
      }
    }
  }
  noExternal(gltf);
  t.ok(!(gltf.extensionsRequired || []).some(name => /draco|meshopt|basisu/i.test(name)), "No missing external decoder dependency");
}

try {
  seedServerData(dataDir);
  writeJson(path.join(dataDir, "hw-devices.json"), { devices });

  await t.test("isolation: helper NODE24, clean env, offline, loopback and independent guard", () => {
    t.equal(NODE24, process.execPath);
    const env = cleanEnv(dataDir);
    t.equal(env.TALLER_DATA_DIR, dataDir);
    t.equal(env.HOME, dataDir);
    t.equal(env.TALLER_HOST, "127.0.0.1");
    t.equal(env.TALLER_OFFLINE, "1");
    t.equal(env.TALLER_LEARNING_TEST_GUARD, "1");
    t.deepEqual(Object.keys(env).sort(), ["PATH", "HOME", "TMPDIR", "LANG", "TZ", "TALLER_DATA_DIR", "TALLER_HOST", "TALLER_OFFLINE", "TALLER_LEARNING_TEST_GUARD"].sort());
    t.ok(path.resolve(dataDir).startsWith(path.resolve(os.tmpdir()) + path.sep));
    t.ok(!path.resolve(dataDir).startsWith(path.join(ROOT, "data") + path.sep));
  });

  await t.test("one explicitly synthetic device per legal wear, shared with preview", () => {
    t.equal(DEMO_WEARS.length, 13);
    t.equal(new Set(DEMO_WEARS).size, 13);
    t.deepEqual(arrayConstant(source("server.js"), "HW_WEARS"), [...DEMO_WEARS]);
    t.deepEqual(arrayConstant(source("workbench.html"), "HW_WEARS_UI"), [...DEMO_WEARS]);
    t.deepEqual(arrayConstant(source("hardware-body.js"), "BODY_WEARS"), [...DEMO_WEARS].slice(0, 10));
    t.equal(devices.length, 13);
    t.equal(new Set(names(devices)).size, 13);
    t.deepEqual(devices.map(d => d.wear), [...DEMO_WEARS]);
    t.ok(devices.every(d => d.name.includes("本地演示") && d.url === "" && [1, 2, 3].includes(d.lens)));
    t.deepEqual(createDemoDevices(), devices, "Fresh deterministic fixture, not shared mutable state");
  });

  await t.test("pinned GLB: legal v2 container, embedded buffers/images, mesh bounds and no external links", () => {
    validateModel(fs.readFileSync(path.join(ROOT, MODEL)));
  });

  await t.test("body + all five vendored modules parse as ES modules; imports stay local", () => {
    const files = ["hardware-body.js", ...VENDOR_FILES.filter(f => f.endsWith(".js")).map(f => VENDOR + f)];
    const allowed = new Set(files.map(f => path.join(ROOT, f)));
    for (const file of files) {
      const code = source(file);
      syntaxCheck(code, file);
      const specifiers = moduleSpecifiers(code);
      if (!file.endsWith("three.core.js")) t.ok(specifiers.length > 0, file + " must declare its local dependency");
      for (const specifier of specifiers) {
        t.match(specifier, /^\.\.?\//, file + " has no bare/CDN import");
        t.ok(allowed.has(path.resolve(ROOT, path.dirname(file), specifier)), "Dependency is in the local module closure: " + specifier);
      }
    }
    t.match(source(VENDOR + "LICENSE.txt"), /MIT License/);
    t.match(source(VENDOR + "three.core.js"), /REVISION\s*=\s*['"]180['"]/);
    t.ok(source("hardware-body.js").includes("./" + MODEL), "Body module references the new pinned model");
    t.ok(!source("hardware-body.js").includes("wearable-female.glb"), "No stale model path");
  });

  await t.test("workbench statically wires the new module/CSS, keeps atlas controls and parses inline scripts", () => {
    const page = source("workbench.html"), css = source("hardware-body.css");
    t.match(page, /(?:import\s*\(\s*["'](?:\.\/|\/)?hardware-body\.js(?:\?[^"']*)?["']|<script\b[^>]*\bsrc=["'](?:\.\/|\/)?hardware-body\.js(?:\?[^"']*)?["'])/);
    t.match(page, /<link\b[^>]*\bhref=["'](?:\.\/|\/)?hardware-body\.css(?:\?[^"']*)?["']/);
    for (const id of ["hwAtlasBtn", "atlMask", "atlClose", "atlViewBody", "atlViewTable", "atlCat", "atlQ", "atlBody"]) {
      t.match(page, new RegExp('\\bid=["\']' + id + '["\']'));
    }
    t.match(css, /\.atl-model-stage\b/);
    t.ok(!/(?:@import|url\s*\()[^;\n]*(?:https?:)?\/\//i.test(css), "Body CSS does not depend on external resources");
    for (const match of page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
      if (/\bsrc\s*=/.test(match[1]) || !match[2].trim()) continue;
      if (/\btype\s*=\s*["']importmap["']/.test(match[1])) JSON.parse(match[2]);
      else if (/\btype\s*=\s*["']module["']/.test(match[1])) syntaxCheck(match[2], "workbench inline module");
      else new vm.Script(match[2], { filename: "workbench inline script" });
    }
  });

  await t.test("VM shared filtering contract: all/lens/category/search intersections, arbitrary data, no mutation", () => {
    const filter = functionSource(source("workbench.html"), "atlasFiltered");
    const probes = [
      ...structuredClone(devices),
      { name: "NameProbe QN-Atlas", brand: "", collects: "", shows: "", lens: 3, cat: "Probe" },
      { name: "BrandProbe", brand: "QB-Atlas", lens: 1, cat: "Probe" },
      { name: "CollectProbe", collects: "QC-Atlas", lens: 2, cat: "Probe" },
      { name: "ShowProbe", shows: "QS-Atlas", lens: 0, cat: "Other" },
      { name: "Missing optional fields", lens: 0, cat: "Other" },
    ];
    const before = JSON.stringify(probes);
    const run = (state = {}) => {
      const atlas = { devices: structuredClone(probes), filter: "all", cat: "", q: "", wear: null, view: "body", ...state };
      const sandbox = vm.createContext({ ATLAS: atlas }, { codeGeneration: { strings: false, wasm: false } });
      const result = vm.runInContext(filter + "; JSON.stringify(atlasFiltered())", sandbox, { timeout: 1000 });
      t.equal(JSON.stringify(atlas.devices), before, "Filter leaves input data unchanged");
      return names(JSON.parse(result));
    };
    t.deepEqual(run(), names(probes));
    for (const lens of ["1", "2"]) {
      t.deepEqual(run({ filter: lens }), names(probes.filter(d => d.lens === Number(lens) || d.lens === 3)));
    }
    for (const cat of new Set(probes.map(d => d.cat))) t.deepEqual(run({ cat }), names(probes.filter(d => d.cat === cat)));
    t.deepEqual(run({ cat: "Does not exist" }), []);
    for (const [q, expected] of [["  qn-ATLAS  ", "NameProbe QN-Atlas"], ["qb-atlas", "BrandProbe"], ["qc-atlas", "CollectProbe"], ["qs-atlas", "ShowProbe"]]) {
      t.deepEqual(run({ q }), [expected], "Search includes name, brand, collects and shows, case-insensitively");
    }
    t.deepEqual(run({ filter: "1", cat: "Probe", q: "qc-atlas" }), [], "Filters intersect rather than union");
    t.deepEqual(run({ filter: "2", cat: "Probe", q: "qc-atlas" }), ["CollectProbe"]);
    t.deepEqual(run({ q: "no-match-local-sentinel" }), []);
    t.deepEqual(run({ view: "table", filter: "1" }), run({ view: "body", filter: "1" }), "Both views share the general filter contract");
  });

  await t.test("start helper-managed temporary server on a random 127.0.0.1 port", async () => {
    service = await startServer(dataDir);
    t.equal(new URL(service.base).hostname, "127.0.0.1");
    t.ok(service.port > 0);
    t.ok(!fs.existsSync(path.join(dataDir, "admin-initial-password.txt")), "Seeded logins avoid bootstrap admin");
  });

  if (service) {
    await t.test("anonymous device/workbench API denied without exposing synthetic devices", async () => {
      for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
        const response = await call("anonymous", method, "/api/workbench/hw/devices", method === "GET" ? undefined : { devices: [] });
        t.equal(response.status, 401, response.text);
        t.ok(!response.json?.devices && !response.text.includes("本地演示"));
      }
      const page = await call("anonymous", "GET", "/workbench.html");
      t.equal(page.status, 302);
      t.match(page.location || "", /^\/login\.html\?next=/);
    });

    await t.test("synthetic admin, reader (user), family and must-change accounts log in", async () => {
      for (const [role, account] of [["admin", ACCOUNTS.admin], ["reader", ACCOUNTS.user], ["family", ACCOUNTS.family], ["mustChange", ACCOUNTS.mustChange]]) {
        const response = await call("anonymous", "POST", "/api/login", { username: account.username, password: account.password });
        t.equal(response.status, 200, response.text);
        t.equal(response.json?.role, account.role);
        t.equal(response.json?.mustChangePassword, account.mustChange);
        t.match(response.cookie, /^taller_sid=.+/);
        cookies[role] = response.cookie;
      }
    });

    await t.test("reader/family/must-change admin cannot read or mutate the device API or enter workbench", async () => {
      for (const role of ["reader", "family", "mustChange"]) {
        for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
          const response = await call(role, method, "/api/workbench/hw/devices", method === "GET" ? undefined : { devices: [] });
          t.equal(response.status, 403, role + ": " + response.text);
          t.ok(!response.json?.devices && !response.text.includes("本地演示"));
        }
        const page = await call(role, "GET", "/workbench.html");
        t.equal(page.status, role === "mustChange" ? 302 : 403);
        if (role === "mustChange") t.equal(page.location, "/login.html?next=%2Fworkbench.html");
      }
    });

    await t.test("admin reads back exactly all 13 synthetic wear records; GET is read-only", async () => {
      const filename = path.join(dataDir, "hw-devices.json"), before = fs.readFileSync(filename);
      for (let i = 0; i < 2; i++) {
        const response = await call("admin", "GET", "/api/workbench/hw/devices");
        t.equal(response.status, 200, response.text);
        t.equal(response.json?.devices?.length, 13);
        t.deepEqual(sortDevices(response.json.devices), sortDevices(devices));
        t.deepEqual(response.json.devices.map(d => d.wear).sort(), [...DEMO_WEARS].sort());
        t.equal(typeof response.json.now, "number");
      }
      t.equal(sha256(fs.readFileSync(filename)), sha256(before), "Device GET does not rewrite seeded DATA");
    });

    await t.test("admin device endpoint remains read-only; ingestion still requires its separate token", async () => {
      const before = await call("admin", "GET", "/api/workbench/hw/devices");
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const response = await call("admin", method, "/api/workbench/hw/devices", { devices: [] });
        t.ok([404, 405].includes(response.status), method + ": " + response.status);
      }
      for (const role of ["anonymous", "reader", "admin"]) {
        t.equal((await call(role, "POST", "/api/workbench/hw/done", { devices: [] })).status, 401);
        t.equal((await call(role, "GET", "/api/workbench/hw/pending")).status, 401);
      }
      const after = await call("admin", "GET", "/api/workbench/hw/devices");
      t.deepEqual(after.json?.devices, before.json?.devices, "Denied mutations do not change devices");
    });

    await t.test("admin workbench HTML and public body/CSS/vendor assets have correct MIME and exact text", async () => {
      const page = await call("admin", "GET", "/workbench.html");
      t.equal(page.status, 200);
      t.match(page.headers.get("content-type") || "", /^text\/html\b/);
      t.ok(page.text.includes("hardware-body.js") && page.text.includes("hardware-body.css"));
      const assets = ["hardware-body.js", "hardware-body.css", ...VENDOR_FILES.map(f => VENDOR + f)];
      for (const role of ["anonymous", "reader", "admin"]) {
        for (const file of assets) {
          const response = await call(role, "GET", "/" + file);
          t.equal(response.status, 200, role + " /" + file);
          const mime = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/plain";
          t.equal((response.headers.get("content-type") || "").split(";")[0], mime, file + " MIME");
          t.equal(response.text, source(file), file + " exact static content");
        }
      }
    });

    await t.test("GLB HTTP delivery uses model/gltf-binary, matches pinned sha256 and supports ranges", async () => {
      for (const role of ["anonymous", "reader", "admin"]) {
        // This server serves static GET, not HEAD. A small range avoids decoding
        // an entire binary model through the helper's text response interface.
        const response = await request(service.base, "GET", "/" + MODEL, {
          cookie: cookies[role] || "", headers: { Range: "bytes=0-3" },
        });
        t.equal(response.status, 206);
        t.equal(response.text, "glTF");
        t.equal(response.headers.get("content-type"), "model/gltf-binary");
      }
      // The shared request helper decodes text. Use arrayBuffer only for this
      // binary response, at the same already-verified loopback base, no redirects.
      const response = await fetch(service.base + "/" + MODEL, { redirect: "manual", signal: AbortSignal.timeout(5000) });
      t.equal(response.status, 200);
      t.equal(sha256(Buffer.from(await response.arrayBuffer())), MODEL_SHA256);
      const range = await request(service.base, "GET", "/" + MODEL, { headers: { Range: "bytes=0-3" } });
      t.equal(range.status, 206);
      t.equal(range.text, "glTF");
      t.equal(range.headers.get("content-type"), "model/gltf-binary");
      t.match(range.headers.get("content-range") || "", /^bytes 0-3\/\d+$/);
    });

    await t.test("tools and DATA stay blocked as static paths for every tested role", async () => {
      for (const role of ["anonymous", "reader", "admin"]) {
        for (const url of ["/tools/test-atlas-body.mjs", "/tools/preview-atlas-body.mjs", "/tools/learning-test-support.cjs", "/data/hw-devices.json", "/data/users.db"]) {
          const response = await call(role, "GET", url);
          t.equal(response.status, 404, role + " " + url);
          t.ok(!response.text.includes("本地演示") && !response.text.includes("scryptSync"));
        }
      }
    });
  } else {
    t.skip("local HTTP cases", "Temporary offline server did not start; no existing/production server was used");
  }

  await t.test("preview smoke: random loopback URL, dedicated synthetic admin, 13 devices, SIGTERM cleanup", async () => {
    const child = spawn(NODE24, [path.join(ROOT, "tools/preview-atlas-body.mjs")], {
      cwd: ROOT, env: cleanEnv(dataDir), stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "", error;
    child.on("error", value => { error = value; });
    for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => { output = (output + bytes).slice(-50000); });
    let previewDir;
    try {
      const deadline = Date.now() + 20000;
      while (!output.includes("[atlas-preview] NODE24 ") && Date.now() < deadline) {
        if (error) throw error;
        if (child.exitCode !== null) throw new Error("Preview failed: " + output);
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const value = key => output.match(new RegExp("\\[atlas-preview\\] " + key + " ([^\\r\\n]+)"))?.[1];
      previewDir = value("DATA");
      t.ok(previewDir, "Preview readiness output includes temp DATA: " + output);
      t.ok(path.resolve(previewDir).startsWith(path.resolve(os.tmpdir()) + path.sep));
      t.ok(path.basename(previewDir).startsWith("taller-learning-atlas-preview-"));
      const url = new URL(value("URL"));
      t.equal(url.hostname, "127.0.0.1");
      t.ok(Number(url.port) > 0);
      t.equal(url.pathname, "/workbench.html");
      const login = await request(url.origin, "POST", "/api/login", {
        body: { username: value("ADMIN_USERNAME"), password: value("ADMIN_PASSWORD") },
      });
      t.equal(login.status, 200);
      t.equal(login.json?.role, "admin");
      t.equal(login.json?.mustChangePassword, false);
      t.match(login.cookie, /^taller_sid=.+/);
      const result = await request(url.origin, "GET", "/api/workbench/hw/devices", { cookie: login.cookie });
      t.equal(result.status, 200);
      t.deepEqual(sortDevices(result.json?.devices || []), sortDevices(devices));
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(path.join(previewDir, "users.db"), { readOnly: true });
      try { t.deepEqual(db.prepare("SELECT username,role,must_change FROM users").all().map(row => ({ ...row })), [{ username: "atlas-demo-admin", role: "admin", must_change: 0 }]); }
      finally { db.close(); }
      // helper service.stop() may leave its 2.5s fallback timer alive briefly.
      // Do not race it against stopChild's identical 2.5s SIGKILL deadline.
      child.kill("SIGTERM");
      const stopDeadline = Date.now() + 7000;
      while (child.exitCode === null && child.signalCode === null && Date.now() < stopDeadline) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      t.equal(child.exitCode, 0, "SIGTERM preview exits cleanly: " + output);
      t.ok(!fs.existsSync(previewDir), "Signal cleanup removed temporary preview DATA");
      t.ok(output.includes("临时服务已停止，合成数据已清理"));
      t.ok(!output.includes("LEARNING_TEST_EXTERNAL_IO_BLOCKED"));
      await t.rejects(request(url.origin, "GET", "/api/me", { timeout: 1000 }), "Preview listener is stopped");
    } finally {
      await stopChild(child);
      if (previewDir && fs.existsSync(previewDir)) removeTemp(previewDir);
    }
  });
} catch (error) {
  await t.test("unexpected setup/runtime error", () => { throw error; });
} finally {
  try { await service?.stop(); }
  finally {
    await t.test("independent network guard observed no attempted external I/O", () => {
      t.ok(!service?.log.includes("LEARNING_TEST_EXTERNAL_IO_BLOCKED"));
    });
    removeTemp(dataDir);
    t.ok(!fs.existsSync(dataDir), "Test DATA cleaned up");
    t.finish();
    console.log("LIMIT: source/VM, binary integrity and isolated HTTP only. No browser, WebGL rendering, screenshots, production SSH, real user data, commit or deployment.");
  }
}
