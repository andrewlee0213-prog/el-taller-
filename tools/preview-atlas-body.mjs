/* Node 24, local-only atlas preview. No repository data/, browser or external I/O.
   Run: /path/to/node24 tools/preview-atlas-body.mjs
   Importing this module only exposes the synthetic fixture; it does not start a server. */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import support from "./learning-test-support.cjs";

const { NODE24, assertNode24, tempDir, seedServerData, writeJson, startServer, request, removeTemp } = support;

export const DEMO_WEARS = Object.freeze([
  "头部", "眼部", "耳部", "颈部", "胸口", "上臂", "手腕", "手指", "腰部", "腿脚", "环境家居", "宠物", "其他",
]);

export function createDemoDevices() {
  const categories = [
    "头戴设备", "AR眼镜", "耳机", "颈挂设备", "胸前徽章", "臂带传感器", "健康手表",
    "智能戒指", "智能腰带", "步态鞋垫", "环境传感器", "宠物项圈", "其他设备",
  ];
  return DEMO_WEARS.map((wear, index) => ({
    name: "本地演示 · " + categories[index],
    wear, cat: categories[index], lens: index % 3 + 1,
    brand: index % 2 ? "Atlas Demo" : "Local Wear Lab",
    collects: "合成信号 " + String(index + 1).padStart(2, "0"),
    shows: "演示视图 " + String(index + 1).padStart(2, "0"),
    status: "合成演示", heat: index + 1,
    firstSeen: "2026-11-06", lastSeen: "2026-11-06",
    url: "", src: "本地合成夹具，非真实产品", prices: [],
  }));
}

async function preview() {
  assertNode24();
  const dataDir = tempDir("taller-learning-atlas-preview-");
  const account = {
    username: "atlas-demo-admin",
    password: "LocalAtlas-" + crypto.randomBytes(18).toString("base64url"),
  };
  let service, requestedSignal;
  let resolveStop;
  const stopRequested = new Promise(resolve => { resolveStop = resolve; });
  const handlers = new Map(["SIGINT", "SIGTERM", "SIGHUP"].map(signal => {
    const handler = () => {
      requestedSignal ||= signal;
      resolveStop({ kind: "signal", signal: requestedSignal });
    };
    process.on(signal, handler);
    return [signal, handler];
  }));

  try {
    seedServerData(dataDir);
    writeJson(path.join(dataDir, "hw-devices.json"), { devices: createDemoDevices() });

    // Replace the helper's known test logins with one dedicated, per-run demo admin.
    // This database was just created in tempDir; no existing user database is opened.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(path.join(dataDir, "users.db"));
    try {
      const salt = crypto.randomBytes(16).toString("hex");
      const hash = crypto.scryptSync(account.password, salt, 64).toString("hex");
      db.exec("DELETE FROM users");
      db.prepare("INSERT INTO users(username,pwhash,salt,role,must_change) VALUES(?,?,?,?,0)")
        .run(account.username, hash, salt, "admin");
    } finally { db.close(); }

    if (requestedSignal) return;
    // startServer supplies NODE24, cleanEnv, offline mode, the independent network
    // guard, and a random port bound only to 127.0.0.1. No env overrides are accepted.
    service = await startServer(dataDir);
    service.child.once("exit", (code, signal) => resolveStop({ kind: "exit", code, signal }));
    assert.equal(new URL(service.base).hostname, "127.0.0.1");
    if (requestedSignal) return;

    const login = await request(service.base, "POST", "/api/login", {
      body: account, headers: { Origin: service.base },
    });
    assert.equal(login.status, 200, "Synthetic preview admin must be able to log in");
    assert.equal(login.json?.role, "admin");
    assert.equal(login.json?.mustChangePassword, false);
    assert.match(login.cookie, /^taller_sid=.+/);
    const devices = await request(service.base, "GET", "/api/workbench/hw/devices", { cookie: login.cookie });
    assert.equal(devices.status, 200);
    assert.equal(devices.json?.devices?.length, 13);
    assert.deepEqual(devices.json.devices.map(d => d.wear).sort(), [...DEMO_WEARS].sort());
    assert.ok(devices.json.devices.every(d => d.name.includes("本地演示") && d.url === ""));
    if (requestedSignal) return;
    assert.equal(service.child.exitCode, null, "Preview server exited before becoming available");

    console.log("[atlas-preview] 本地演示：13 类 wear 各 1 件合成设备；不是真实账号或生产数据。");
    console.log("[atlas-preview] URL " + service.base + "/workbench.html");
    console.log("[atlas-preview] LOGIN " + service.base + "/login.html?next=%2Fworkbench.html");
    console.log("[atlas-preview] ADMIN_USERNAME " + account.username);
    console.log("[atlas-preview] ADMIN_PASSWORD " + account.password);
    console.log("[atlas-preview] DATA " + dataDir);
    console.log("[atlas-preview] NODE24 " + NODE24);
    console.log("[atlas-preview] 仅回环、干净 env、offline + 外网守卫；未打开浏览器。按 Ctrl+C 停服并删除临时数据。");

    const outcome = await stopRequested;
    if (outcome.kind === "exit") {
      throw new Error("Temporary preview server exited unexpectedly (" + outcome.code + ", " + outcome.signal + ")");
    }
  } finally {
    try { await service?.stop(); }
    finally {
      try {
        if (service?.log.includes("LEARNING_TEST_EXTERNAL_IO_BLOCKED")) {
          process.exitCode = 1;
          console.error("[atlas-preview] 外网守卫阻断了非本地 I/O；本次预览不算干净通过。");
        }
        removeTemp(dataDir);
        console.log("[atlas-preview] 临时服务已停止，合成数据已清理。");
      } finally {
        for (const [signal, handler] of handlers) process.removeListener(signal, handler);
      }
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await preview().catch(error => {
    console.error("[atlas-preview] 启动或运行失败：" + String(error.stack || error));
    process.exitCode = 1;
  });
}
