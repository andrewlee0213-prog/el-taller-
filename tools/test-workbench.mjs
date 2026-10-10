/* 工作台验收测试：独立端口 + 隔离数据目录起临时服务实例，不碰真实 data/
   用法: node tools/test-workbench.mjs  （自带起服，无需提前启动）
   覆盖：页面/端点三级守卫（匿名→302/401，user→403，admin→200）、
         工作记录增删、评论增清、收进日志可见性、notes-extra 公开过滤、
         周计划确认、配置保存、BLOCKED 目录不泄、workbench 数据端点结构 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NODE24 = process.env.NODE24 || "node";   // 本机可用 NODE24=~/.openclaw/tools/node-v24.19.0/bin/node

/* 动态挑空闲端口（8899 这类固定端口可能被别的应用占用） */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on("error", reject);
  });
}
const PORT = await freePort();
const BASE = `http://localhost:${PORT}`;

let pass = 0, fail = 0, cookie = "";
const check = (name, cond, detail = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "  → " + detail : "")); }
};
async function req(method, p, body, redirect = "manual") {
  const r = await fetch(BASE + p, {
    method, redirect,
    headers: Object.assign({ "Content-Type": "application/json" }, cookie ? { Cookie: cookie } : {}),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const setc = r.headers.get("set-cookie");
  if (setc) cookie = setc.split(";")[0];
  const text = await r.text();
  let j = null; try { j = JSON.parse(text); } catch {}
  return { status: r.status, json: j, text, location: r.headers.get("location") };
}
async function waitPort(tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { await fetch(BASE + "/api/me"); return true; } catch { await new Promise(r => setTimeout(r, 250)); }
  }
  return false;
}

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "taller-wb-test-"));
console.log("临时数据目录: " + tmpData);
console.log("测试端口: " + PORT);
const child = spawn(NODE24, ["server.js"], {
  cwd: ROOT,
  env: Object.assign({}, process.env, { TALLER_PORT: String(PORT), TALLER_DATA_DIR: tmpData }),
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
child.stdout.on("data", d => { serverLog += d; });
child.stderr.on("data", d => { serverLog += d; });

try {
  check("服务在临时端口启动", await waitPort());

  /* ---- 三级守卫 ---- */
  let r = await req("GET", "/workbench.html");
  check("匿名 /workbench.html → 302 登录页", r.status === 302 && (r.location || "").includes("login.html"), r.status + " " + r.location);
  r = await req("GET", "/api/workbench/data");
  check("匿名 /api/workbench/data → 401", r.status === 401, r.status);
  r = await req("GET", "/workbench.html", undefined, "follow");
  check("匿名跟随跳转后落在登录页", r.status === 200 && r.text.includes("登录"), r.status);

  cookie = "";
  await req("POST", "/api/login", { username: "admin", password: "x" });
  /* 初始 admin 密码随机，改为直接造两个临时账号 */
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(path.join(tmpData, "users.db"));
  const mkUser = (name, role) => {
    const salt = crypto.randomBytes(16).toString("hex");
    db.prepare("INSERT INTO users(username,pwhash,salt,role,must_change) VALUES(?,?,?,?,0)")
      .run(name, crypto.scryptSync("wbtest-pass-2026", salt, 64).toString("hex"), salt, role);
  };
  mkUser("wbtest-user", "user");
  mkUser("wbtest-admin", "admin");

  cookie = "";
  r = await req("POST", "/api/login", { username: "wbtest-user", password: "wbtest-pass-2026" });
  check("临时 user 登录", r.json && r.json.ok === true, JSON.stringify(r.json));
  r = await req("GET", "/workbench.html");
  check("user /workbench.html → 403", r.status === 403, r.status);
  r = await req("GET", "/api/workbench/data");
  check("user /api/workbench/data → 403", r.status === 403, r.status);

  cookie = "";
  r = await req("POST", "/api/login", { username: "wbtest-admin", password: "wbtest-pass-2026" });
  check("临时 admin 登录", r.json && r.json.ok === true, JSON.stringify(r.json));
  r = await req("GET", "/workbench.html", undefined, "follow");
  check("admin /workbench.html → 200 含 El Estudio", r.status === 200 && r.text.includes("El Estudio"), r.status);
  r = await req("GET", "/api/workbench/data");
  check("admin /api/workbench/data → 200 且含五板块键", r.status === 200 &&
    ["glm", "oil", "bili", "anth", "arxiv"].every(k => k in (r.json.data || {})), JSON.stringify(r.json).slice(0, 120));
  check("data.cfg 含 ups/profile", Array.isArray(r.json.cfg.ups) && typeof r.json.cfg.profile === "string");

  /* ---- 工作记录 ---- */
  r = await req("POST", "/api/workbench/log", { text: "测试：写了一行工作记录", date: "2026-10-09" });
  check("新增工作记录", r.json && r.json.ok === true, JSON.stringify(r.json));
  r = await req("POST", "/api/workbench/log", { text: "" });
  check("空记录 → 400", r.status === 400, r.status);
  r = await req("GET", "/api/workbench/log");
  const logItem = (r.json.items || []).find(x => x.text.includes("测试：写了一行"));
  check("工作记录可查", !!logItem, JSON.stringify(r.json).slice(0, 120));

  /* ---- 评论 ---- */
  const testUrl = "https://arxiv.org/abs/2610.99999";
  r = await req("PUT", "/api/workbench/comment", { url: testUrl, source: "arxiv", title: "测试论文", text: "测试观后感：路由方向有用" });
  check("保存评论", r.json && r.json.ok === true, JSON.stringify(r.json));
  r = await req("PUT", "/api/workbench/comment", { url: testUrl, source: "arxiv", title: "测试论文", text: "" });
  check("清空文本 = 删除评论", r.json && r.json.removed === true, JSON.stringify(r.json));
  r = await req("GET", "/api/workbench/comments");
  check("评论删除生效", !(r.json.items || []).some(c => c.url === testUrl));
  await req("PUT", "/api/workbench/comment", { url: testUrl, source: "arxiv", title: "测试论文", text: "测试观后感：路由方向有用" });

  /* ---- 收进日志 + notes-extra 可见性 ---- */
  r = await req("POST", "/api/workbench/note", { source: "arxiv", sourceUrl: testUrl, sourceTitle: "测试论文", text: "私有笔记内容", visibility: "private" });
  check("收进日志（private）", r.json && r.json.ok && r.json.note.id, JSON.stringify(r.json));
  const privId = r.json.note.id;
  r = await req("POST", "/api/workbench/note", { source: "arxiv", sourceUrl: testUrl, sourceTitle: "测试论文", text: "公开笔记内容", visibility: "public", title: "测试公开笔记" });
  check("收进日志（public）", r.json && r.json.ok, JSON.stringify(r.json));
  const pubId = r.json.note.id;
  cookie = "";
  r = await req("GET", "/api/notes-extra");
  check("匿名 notes-extra 只含 public", r.status === 200 &&
    r.json.items.some(n => n.id === pubId) && !r.json.items.some(n => n.id === privId),
    JSON.stringify(r.json.items || []).slice(0, 120));
  cookie = "";
  await req("POST", "/api/login", { username: "wbtest-user", password: "wbtest-pass-2026" });
  r = await req("GET", "/api/notes-extra");
  check("user notes-extra 仍不含 private", !r.json.items.some(n => n.id === privId));
  cookie = "";
  await req("POST", "/api/login", { username: "wbtest-admin", password: "wbtest-pass-2026" });
  r = await req("GET", "/api/notes-extra");
  check("admin notes-extra 含全部", r.json.items.some(n => n.id === privId) && r.json.items.some(n => n.id === pubId));
  r = await req("DELETE", "/api/workbench/note?id=" + privId);
  check("删除笔记", r.json && r.json.removed === 1, JSON.stringify(r.json));

  /* ---- 周总结/计划（任意日期区间） ---- */
  r = await req("POST", "/api/workbench/weekly/generate");
  check("无 Key 生成 → 友好报错（不裸抛）", r.json && r.json.ok === false && (r.json.error || "").includes("Key"), JSON.stringify(r.json));
  r = await req("POST", "/api/workbench/weekly/confirm", { start: "2026-10-05", end: "2026-10-11", summary: "测试总结", plan: "测试计划" });
  check("确认区间计划", r.json && r.json.ok === true, JSON.stringify(r.json));
  r = await req("GET", "/api/workbench/weekly");
  check("区间计划落盘含确认时间", !!(r.json.weeks["2026-10-05~2026-10-11"] || {}).confirmedAt, JSON.stringify(r.json).slice(0, 160));
  check("current 含 start/end", r.json.current && /^\d{4}-\d{2}-\d{2}$/.test(r.json.current.start || ""), JSON.stringify(r.json.current));

  /* ---- Mac 命中率上报（token 鉴权） ---- */
  cookie = "";
  r = await req("POST", "/api/workbench/hitrate", { day: 88.8, all: 77.7 });
  check("无 token 上报 → 401", r.status === 401, r.status);
  const pushToken = JSON.parse(fs.readFileSync(path.join(tmpData, "server-config.json"), "utf8")).pushToken;
  check("boot 已生成 pushToken", /^[0-9a-f]{32}$/.test(pushToken || ""), String(pushToken));
  r = await fetch(BASE + "/api/workbench/hitrate", {
    method: "POST", headers: { "Content-Type": "application/json", "X-WB-Token": pushToken },
    body: JSON.stringify({ day: 88.8, all: 77.7 }),
  });
  check("带 token 上报 → 200", r.status === 200, r.status);
  cookie = "";
  await req("POST", "/api/login", { username: "wbtest-admin", password: "wbtest-pass-2026" });
  r = await req("GET", "/api/workbench/data");
  check("命中率进入 glm.hit", r.json.data.glm && r.json.data.glm.hit && r.json.data.glm.hit.day === 88.8,
    JSON.stringify((r.json.data.glm || {}).hit));

  /* ---- ICS 日历订阅源（先造一条备忘再验证内容） ---- */
  cookie = "";
  r = await req("GET", "/api/workbench/calendar.ics");
  check("无 token 订阅 → 401", r.status === 401, r.status);
  cookie = "";
  await req("POST", "/api/login", { username: "wbtest-admin", password: "wbtest-pass-2026" });
  await req("POST", "/api/workbench/memos", { date: "2026-10-20", text: "ICS订阅测试备忘" });
  let icsRes = await fetch(BASE + "/api/workbench/calendar.ics?token=" + pushToken);
  let icsText = await icsRes.text();
  check("带 token 订阅 → VCALENDAR", icsRes.status === 200 && icsText.includes("BEGIN:VCALENDAR"), icsRes.status);
  check("订阅含备忘事件", icsText.includes("备忘：ICS订阅测试备忘"), icsText.slice(0, 200));

  /* ---- 节假日 + F1（真实数据源，需网络） ---- */
  r = await req("GET", "/api/workbench/holidays?year=2026");
  check("节假日 holiday-cn 拉取", r.json && r.json.year === 2026 && Array.isArray(r.json.days) && r.json.days.length > 5,
    JSON.stringify(r.json).slice(0, 120));
  await req("POST", "/api/workbench/refresh", { section: "f1" });
  let f1ok = false;
  for (let i = 0; i < 15; i++) {
    await new Promise(rs => setTimeout(rs, 3000));
    const d = await req("GET", "/api/workbench/data");
    if ((d.json.data.f1 || {}).ok) { f1ok = true; break; }
  }
  check("F1 赛程抓取（Jolpica）", f1ok, "45s 内未完成");
  if (f1ok) {
    icsRes = await fetch(BASE + "/api/workbench/calendar.ics?token=" + pushToken);
    icsText = await icsRes.text();
    check("订阅含 F1 赛事", icsText.includes("🏎 F1 "), icsText.slice(0, 150));
  }

  /* ---- 备忘记事（日历数据源） ---- */
  r = await req("POST", "/api/workbench/memos", { date: "2026-10-15", text: "测试备忘：交周报" });
  check("新增备忘", r.json && r.json.ok && r.json.memo.id, JSON.stringify(r.json));
  const memoId = r.json.memo.id;
  r = await req("POST", "/api/workbench/memos", { text: "" });
  check("空备忘 → 400", r.status === 400, r.status);
  r = await req("PUT", "/api/workbench/memos", { id: memoId, done: true });
  check("勾选完成", r.json && r.json.ok && r.json.memo.done === true, JSON.stringify(r.json));
  r = await req("GET", "/api/workbench/memos");
  check("备忘列表可查", (r.json.items || []).some(m => m.id === memoId && m.done));
  r = await req("DELETE", "/api/workbench/memos?id=" + memoId);
  check("删除备忘", r.json && r.json.removed === 1, JSON.stringify(r.json));

  /* ---- 配置保存 ---- */
  r = await req("POST", "/api/workbench/config", { glmKey: "test-key-123", biliUps: [{ uid: "111", name: "甲" }, { uid: "", name: "脏数据" }, "坏行"] });
  check("保存配置并清洗 UP 清单", r.json && r.json.ok === true && r.json.ups === 1, JSON.stringify(r.json));
  const cfgSaved = JSON.parse(fs.readFileSync(path.join(tmpData, "server-config.json"), "utf8"));
  check("配置写入隔离 data 目录", cfgSaved.glmKey === "test-key-123" && cfgSaved.biliUps.length === 1);
  r = await req("POST", "/api/workbench/refresh", { section: "nope" });
  check("未知板块刷新 → 400", r.status === 400, r.status);
  r = await req("POST", "/api/workbench/refresh", { section: "glm" });
  check("刷新指令受理", r.json && r.json.ok === true, JSON.stringify(r.json));

  /* ---- Biblioteca 待处理队列（上传 → inbox → keep/note/discard 三态） ---- */
  async function rawUpload(name, bytes) {
    const ru = await fetch(BASE + "/api/kb/upload", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/octet-stream", "x-file-name": encodeURIComponent(name) }, cookie ? { Cookie: cookie } : {}),
      body: bytes,
    });
    return { status: ru.status, json: await ru.json().catch(() => ({})) };
  }
  cookie = "";   // 先验证匿名守卫，再恢复 admin 会话
  r = await req("POST", "/api/kb/triage", { id: "whatever", act: "keep" });
  check("匿名 triage → 401", r.status === 401, r.status);
  await req("POST", "/api/login", { username: "wbtest-admin", password: "wbtest-pass-2026" });
  let up = await rawUpload("队列测试-甲.md", "# 队列甲\n\n## 一\n\n内容一\n");
  check("上传甲 → 进库", up.json && up.json.ok && up.json.id, JSON.stringify(up.json));
  up = await rawUpload("队列测试-乙.md", "# 队列乙\n\n## 二\n\n内容二\n");
  check("上传乙 → 进库", up.json && up.json.ok && up.json.id);
  r = await req("GET", "/api/workbench/data");
  check("inbox 列出 2 份 new（含章数）", (r.json.kbInbox || []).length === 2 && r.json.kbInbox.every(u => u.chapters >= 1), JSON.stringify(r.json.kbInbox));
  const idA = r.json.kbInbox[0].id, idB = r.json.kbInbox[1].id;
  r = await req("POST", "/api/kb/triage", { id: idA, act: "keep" });
  check("triage keep → 出队", r.json && r.json.ok === true, JSON.stringify(r.json));
  r = await req("POST", "/api/kb/triage", { id: idB, act: "note", note: "测试评论：值得留" });
  check("triage note → 出队并记笔记", r.json && r.json.ok === true, JSON.stringify(r.json));
  r = await req("GET", "/api/workbench/data");
  check("inbox 清空", (r.json.kbInbox || []).length === 0, JSON.stringify(r.json.kbInbox));
  r = await req("GET", "/kb-data.js");
  check("目录带站主笔记", (r.text || "").includes("测试评论：值得留"));
  up = await rawUpload("队列测试-丙.md", "# 队列丙\n\n## 三\n\n内容三\n");
  r = await req("POST", "/api/kb/triage", { id: up.json.id, act: "discard" });
  check("triage discard → 删书", r.json && r.json.discarded === true, JSON.stringify(r.json));
  r = await req("GET", "/kb-data.js");
  check("discard 后目录移除", !(r.text || "").includes("队列测试-丙"));
  r = await req("POST", "/api/kb/triage", { id: idA, act: "burn" });
  check("非法 act → 400", r.status === 400, r.status);
  r = await req("POST", "/api/kb/triage", { id: idA, act: "note", note: "   " });
  check("空评论 → 400", r.status === 400, r.status);

  /* ---- BLOCKED 目录 ---- */
  cookie = "";
  r = await req("GET", "/data/server-config.json");
  check("data/server-config.json 对外 404", r.status === 404, r.status);
  r = await req("GET", "/data/workbench-comments.json");
  check("data/workbench-comments.json 对外 404", r.status === 404, r.status);

  /* ---- 登出 ---- */
  cookie = "";
  await req("POST", "/api/logout");
  cookie = "";
  r = await req("GET", "/api/workbench/data");
  check("登出后恢复 401", r.status === 401, r.status);
} catch (e) {
  fail++;
  console.log("  FAIL  测试过程异常 → " + e.message);
} finally {
  child.kill("SIGTERM");
  await new Promise(r => setTimeout(r, 300));
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
  console.log("\n临时实例已停止，数据目录已清理");
  console.log(serverLog.split("\n").filter(l => l.includes("workbench")).slice(0, 5).join("\n"));
  console.log("结果: " + pass + " 通过 / " + fail + " 失败");
  process.exit(fail ? 1 : 0);
}
