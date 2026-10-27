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
/* 预置一条无 state 的旧上传（站主反馈 2026-10-10：主动上传≠看过，启动应重排进待处理队列） */
fs.mkdirSync(path.join(tmpData, "kb-uploads"), { recursive: true });
fs.writeFileSync(path.join(tmpData, "kb-uploads", "ulegacy1.md"), "# 旧上传\n\n## 一\n\n旧内容\n");
fs.writeFileSync(path.join(tmpData, "kb-uploads.json"),
  JSON.stringify({ ulegacy1: { id: "ulegacy1", title: "旧上传-未处置.md", file: "ulegacy1.md", type: "md", size: 24, at: Date.now() - 86400000 } }));
/* 预置 9 天旧情报（boot 的 hwPrune 应裁到 7 天） */
fs.writeFileSync(path.join(tmpData, "workbench-hw.json"), JSON.stringify({
  days: Array.from({ length: 9 }, (_, i) => ({
    date: "2026-09-0" + (i + 1), at: Date.now() - (9 - i) * 86400e3, summary: "旧情报 " + (i + 1), links: [], prices: [], sources: {},
  })),
  watch: ["雷鸟 Air3"],
}));
/* 预置 505 台种子设备（boot 图鉴裁到 500；done 后文件同样 500，多出的新设备挤掉最冷种子。001 给高 heat 保证活到更新断言） */
fs.writeFileSync(path.join(tmpData, "hw-devices.json"), JSON.stringify({
  devices: Array.from({ length: 505 }, (_, i) => ({
    name: "种子设备" + String(i + 1).padStart(3, "0"), cat: "测试品类", lens: 1, brand: "", collects: "", shows: "",
    status: "传闻", firstSeen: "2026-09-01", lastSeen: "2026-09-0" + ((i % 9) + 1), heat: i === 0 ? 5 : 1, url: "", src: "", prices: [],
  })),
}));
/* 预置书本分类（manual 一条 + auto 一条；图鉴/阅读精选的类别是 catalog 固定值不入表） */
fs.writeFileSync(path.join(tmpData, "kb-categories.json"), JSON.stringify({
  "interview-bank": { cat: "职场与商业", by: "manual", at: 1 },
  "video-scripts": { cat: "视频与创作", by: "auto", at: 1 },
}));
/* 预置调度缓存（定点制断言用）：全部 at=30 秒前；oil 给远期 adj=2099-06-01（窗口外→睡到 2099-05-31 05:00）；
   f1 给后天+8 天后两个 session（后天 session 的前夜=明天 05:00 恒在未来，断言免时钟竞态） */
const seedAt = Date.now() - 30e3;
const bjDate = off => new Date(Date.now() + 8 * 3600e3 + off * 86400e3).toISOString().slice(0, 10);
fs.writeFileSync(path.join(tmpData, "workbench-cache.json"), JSON.stringify({
  glm: { ok: true, at: seedAt },
  oil: { ok: true, at: seedAt, adj: "2099-06-01", price: "8.10", prices: [], note: "seed", next: "seed", expired: false, hist: [] },
  bili: { ok: true, at: seedAt, items: [] },
  anth: { ok: true, at: seedAt, items: [] },
  arxiv: { ok: true, at: seedAt, items: [] },
  github: { ok: true, at: seedAt, items: [{ url: "https://github.com/a/b", repo: "a/b", desc: "d", zh: "解读", lang: "Rust", stars: 1234, delta: 56, fresh: true }],
            weekly: [{ url: "https://github.com/c/d", repo: "c/d", desc: "w", zh: "周榜解读", lang: "Go", stars: 999, delta: 200, fresh: true }] },
  f1: { ok: true, at: seedAt, races: [
    { round: 98, raceName: "种子站A", locality: "测试", date: bjDate(2), time: "20:00", sprint: "", sprintTime: "",
      sessions: [{ k: "R", label: "正赛", date: bjDate(2), hm: "20:00" }] },
    { round: 99, raceName: "种子站B", locality: "测试", date: bjDate(8), time: "20:00", sprint: "", sprintTime: "",
      sessions: [{ k: "R", label: "正赛", date: bjDate(8), hm: "20:00" }] },
  ] },
}));
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
  check("data.github 种子条目完整下发", r.json.data.github && r.json.data.github.items.length === 1 &&
    r.json.data.github.items[0].repo === "a/b" && r.json.data.github.items[0].fresh === true, JSON.stringify(r.json.data.github || {}).slice(0, 100));
  check("data.github 周榜随种子下发", r.json.data.github && r.json.data.github.weekly && r.json.data.github.weekly[0].repo === "c/d", JSON.stringify((r.json.data.github || {}).weekly || null));
  check("data.cfg 含 ups/profile", Array.isArray(r.json.cfg.ups) && typeof r.json.cfg.profile === "string");

  /* ---- 定点调度断言（2026-10-14 起定点每日制）：sched.nextAt 与测试端同式重算比对 ----
     注：bili/anth/arxiv 的断言在定点时刻前后 ~1 分钟内跑会有时钟竞态（板块到点真去抓），避开整点跑测试即可 */
  {
    const sched = r.json.sched || {};
    const expNext = (hh, mm, after) => { const w = new Date(after + 8 * 3600e3); let t = Date.UTC(w.getUTCFullYear(), w.getUTCMonth(), w.getUTCDate(), hh, mm) - 8 * 3600e3; if (t <= after) t += 86400e3; return t; };
    const fmt = v => v == null ? "无" : new Date(v).toISOString();
    check("调度：glm 仍 5 分钟间隔", sched.glm && sched.glm.nextAt === seedAt + 5 * 60e3, fmt(sched.glm && sched.glm.nextAt));
    check("调度：bili 每天 11:00 定点", sched.bili && sched.bili.nextAt === expNext(11, 0, seedAt), fmt(sched.bili && sched.bili.nextAt));
    check("调度：anth 每天 05:00 定点", sched.anth && sched.anth.nextAt === expNext(5, 0, seedAt), fmt(sched.anth && sched.anth.nextAt));
    check("调度：arxiv 每天 05:00 定点", sched.arxiv && sched.arxiv.nextAt === expNext(5, 0, seedAt), fmt(sched.arxiv && sched.arxiv.nextAt));
    check("调度：oil 窗口外睡到 adj-1 的 05:00", sched.oil && sched.oil.nextAt === expNext(5, 0, Date.UTC(2099, 4, 31) - 8 * 3600e3 - 1), fmt(sched.oil && sched.oil.nextAt));
    const dayStart = ds => { const [y, m, d] = ds.split("-").map(Number); return Date.UTC(y, m - 1, d) - 8 * 3600e3; };
    const expF1 = dayStart(bjDate(2)) - 86400e3 + 5 * 3600e3;   // 后天 session → 明天 05:00（恒在未来，无竞态）
    check("调度：f1 只在 session 前一天 05:00", sched.f1 && sched.f1.nextAt === expF1, fmt(sched.f1 && sched.f1.nextAt));
    check("调度：github 每天 05:00 定点", sched.github && sched.github.nextAt === expNext(5, 0, seedAt), fmt(sched.github && sched.github.nextAt));
  }

  /* ---- 工作记录 ---- */
  r = await req("POST", "/api/workbench/log", { text: "测试：写了一行工作记录", date: "2026-10-09" });
  check("新增工作记录", r.json && r.json.ok === true, JSON.stringify(r.json));
  r = await req("POST", "/api/workbench/log", { text: "" });
  check("空记录 → 400", r.status === 400, r.status);
  r = await req("GET", "/api/workbench/log");
  const logItem = (r.json.items || []).find(x => x.text.includes("测试：写了一行"));
  check("工作记录可查", !!logItem, JSON.stringify(r.json).slice(0, 120));
  r = await req("POST", "/api/workbench/log", { text: "测试：带项目的工作记录", date: "2026-10-09", project: "El Taller" });
  check("带项目新增记录", r.json && r.json.ok === true, JSON.stringify(r.json));
  r = await req("GET", "/api/workbench/log");
  const projItem = (r.json.items || []).find(x => x.text.includes("带项目的工作记录"));
  check("项目字段落盘可查", projItem && projItem.project === "El Taller", JSON.stringify(projItem || {}).slice(0, 120));
  check("无项目记录不带 project 字段", logItem && logItem.project === undefined, JSON.stringify(logItem || {}).slice(0, 120));

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
  const wkSnap = (r.json.weeks["2026-10-05~2026-10-11"] || {}).logIds || [];
  check("确认时快照区间内记录 logIds", wkSnap.includes(logItem.id) && wkSnap.includes(projItem.id), JSON.stringify(wkSnap));
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

  /* ---- 紫微生辰（月/周/日预测数据源，引擎在前端 ziwei.js） ---- */
  cookie = "";
  r = await req("GET", "/api/workbench/ziwei");
  check("匿名读生辰 → 401", r.status === 401, r.status);
  cookie = "";
  await req("POST", "/api/login", { username: "wbtest-user", password: "wbtest-pass-2026" });
  r = await req("GET", "/api/workbench/ziwei");
  check("user 读生辰 → 403", r.status === 403, r.status);
  r = await req("PUT", "/api/workbench/ziwei", { birth: { y: 1988, m: 10, d: 8, hour: 7, gender: "男" } });
  check("user 写生辰 → 403", r.status === 403, r.status);
  cookie = "";
  await req("POST", "/api/login", { username: "wbtest-admin", password: "wbtest-pass-2026" });
  r = await req("GET", "/api/workbench/ziwei");
  check("admin 读生辰 → 空态", r.json && r.json.birth === null, JSON.stringify(r.json));
  r = await req("PUT", "/api/workbench/ziwei", { birth: { y: 1988, m: 2, d: 30, hour: 7, gender: "男" } });
  check("非法日期（2 月 30）→ 400", r.status === 400, r.status);
  r = await req("PUT", "/api/workbench/ziwei", { birth: { y: 1988, m: 10, d: 8, hour: 12, gender: "男" } });
  check("时辰越界（12）→ 400", r.status === 400, r.status);
  r = await req("PUT", "/api/workbench/ziwei", { birth: { y: 1899, m: 10, d: 8, hour: 7, gender: "男" } });
  check("年份越界（1899）→ 400", r.status === 400, r.status);
  r = await req("PUT", "/api/workbench/ziwei", { birth: { y: 1988, m: 10, d: 8, hour: 7, gender: "男" } });
  check("admin 保存生辰", r.json && r.json.ok === true && r.json.birth.hour === 7, JSON.stringify(r.json));
  r = await req("GET", "/api/workbench/ziwei");
  check("admin 回读生辰", r.json && r.json.birth && r.json.birth.y === 1988 && r.json.birth.gender === "男", JSON.stringify(r.json));
  check("生辰落隔离 data 目录（不入库）", fs.existsSync(path.join(tmpData, "ziwei.json")));
  r = await req("GET", "/workbench.html", undefined, "follow");
  check("工作台页引用 ziwei.js + 三层挂载点", r.text.includes('src="ziwei.js"') &&
    r.text.includes('id="zwMount"') && r.text.includes('id="zwWeekMount"') && r.text.includes("流日运势"));
  const zwJs = await fetch(BASE + "/ziwei.js");
  const zwText = await zwJs.text();
  check("ziwei.js 可下发且署名 liyanjun", zwJs.status === 200 && zwText.includes("作者：liyanjun") && zwText.includes("ZW"));

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
  check("inbox 列出 3 份 new（预置旧上传已重排进队）", (r.json.kbInbox || []).length === 3 &&
    r.json.kbInbox.some(u => (u.title || "").includes("旧上传")) && r.json.kbInbox.every(u => u.chapters >= 1), JSON.stringify(r.json.kbInbox));
  const idA = r.json.kbInbox[1].id, idB = r.json.kbInbox[2].id;
  r = await req("POST", "/api/kb/triage", { id: idA, act: "keep" });
  check("triage keep → 出队", r.json && r.json.ok === true, JSON.stringify(r.json));
  r = await req("POST", "/api/kb/triage", { id: idB, act: "note", note: "测试评论：值得留" });
  check("triage note → 出队并记笔记", r.json && r.json.ok === true, JSON.stringify(r.json));
  r = await req("GET", "/api/workbench/data");
  check("仅剩旧上传待处置", (r.json.kbInbox || []).length === 1 && (r.json.kbInbox[0].title || "").includes("旧上传"), JSON.stringify(r.json.kbInbox));
  r = await req("POST", "/api/kb/triage", { id: "ulegacy1", act: "keep" });
  check("旧上传 keep → 出队（有 readAt 后不再重排）", r.json && r.json.ok === true, JSON.stringify(r.json));
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

  /* ---- 视频收集桥（提交 → token 领取 → 回传 → 个人收集书；含失败/重试） ---- */
  cookie = "";
  r = await req("POST", "/api/kb/collect", { url: "https://www.bilibili.com/video/BV1test0001" });
  check("匿名提交收集 → 401", r.status === 401, r.status);
  await req("POST", "/api/login", { username: "wbtest-admin", password: "wbtest-pass-2026" });
  r = await req("POST", "/api/kb/collect", { url: "https://www.bilibili.com/video/BV1test0001" });
  check("提交 B 站链接", r.json && r.json.ok === true, JSON.stringify(r.json));
  r = await req("POST", "/api/kb/collect", { url: "https://www.bilibili.com/video/BV1test0001" });
  check("重复提交 → 409", r.status === 409, r.status);
  r = await req("POST", "/api/kb/collect", { url: "https://youtube.com/watch?v=x" });
  check("非 B 站链接 → 400", r.status === 400, r.status);
  const cfgAll = JSON.parse(fs.readFileSync(path.join(tmpData, "server-config.json"), "utf8"));
  const ct = cfgAll.collectToken;
  check("boot 已生成 collectToken", /^[0-9a-f]{32}$/.test(ct || ""), String(ct));
  let pr = await fetch(BASE + "/api/kb/collect/pending");
  check("无 token 领取 → 401", pr.status === 401, pr.status);
  pr = await fetch(BASE + "/api/kb/collect/pending?token=" + ct);
  const pj = await pr.json();
  check("领取队列含 1 条", pj.ok && pj.items.length === 1 && pj.items[0].url.includes("BV1test0001"), JSON.stringify(pj));
  const cid = pj.items[0].id;
  let dr = await fetch(BASE + "/api/kb/collect/done", {
    method: "POST", headers: { "Content-Type": "application/json", "x-collect-token": ct },
    body: JSON.stringify({ id: cid, ok: true, title: "测试视频标题", md: "# 测试视频\n\n## 第一节\n\n转录内容一。<script>alert(1)</script>\n" }),
  });
  check("回传转录内容", (await dr.json()).ok === true);
  r = await req("GET", "/kb-data.js");
  check("收集成书（一个视频一本）", (r.text || "").includes("col-" + cid) && (r.text || "").includes("测试视频标题") && (r.text || "").includes("collected"), (r.text || "").slice(0, 80));
  r = await req("GET", "/api/kb/chapter?b=col-" + cid + "&c=0");
  check("收集章节可读且转义", r.json && r.json.ok && r.json.html.includes("&lt;script&gt;"), JSON.stringify(r.json).slice(0, 140));
  dr = await fetch(BASE + "/api/kb/collect/done", {
    method: "POST", headers: { "Content-Type": "application/json", "x-collect-token": ct },
    body: JSON.stringify({ id: cid, ok: true, title: "again", md: "# x\n" }),
  });
  check("重复回传 → 409", dr.status === 409, dr.status);
  r = await req("POST", "/api/kb/collect", { url: "https://b23.tv/abc123" });
  const fid = r.json && r.json.id;
  check("提交短链", !!fid);
  dr = await fetch(BASE + "/api/kb/collect/done", {
    method: "POST", headers: { "Content-Type": "application/json", "x-collect-token": ct },
    body: JSON.stringify({ id: fid, ok: false, error: "保存失败：视频不存在" }),
  });
  check("回传失败状态", (await dr.json()).ok === true);
  r = await req("GET", "/api/kb/collect");
  check("状态列表含失败项", (r.json.items || []).some(i => i.id === fid && i.state === "failed"), JSON.stringify(r.json).slice(0, 140));
  r = await req("POST", "/api/kb/collect/retry", { id: fid });
  check("失败重试 → 重新排队", r.json && r.json.ok === true, JSON.stringify(r.json));
  r = await req("DELETE", "/api/kb/collect?id=" + fid);
  check("删除收集条目", r.json && r.json.ok === true, JSON.stringify(r.json));

  /* ---- 智能硬件·每日情报（Mac openclaw 推送，hwToken 鉴权） ---- */
  cookie = "";
  r = await req("GET", "/api/workbench/hw/pending?token=wrong");
  check("hw pending 错 token → 401", r.status === 401, r.status);
  let hd = await fetch(BASE + "/api/workbench/hw/done", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date: "2026-01-01", summary: "x" }),
  });
  check("hw done 无 token → 401", hd.status === 401, hd.status);
  const hwTok = cfgAll.hwToken;
  check("boot 已生成 hwToken（三 token 分权）", /^[0-9a-f]{32}$/.test(hwTok || "") && hwTok !== ct && hwTok !== cfgAll.pushToken, String(hwTok));
  let hpr = await fetch(BASE + "/api/workbench/hw/pending?token=" + hwTok);
  let hpj = await hpr.json();
  const hwDate = hpj.date;
  /* 2026-10-14 起 need 加北京时间 05:00 拦门：凌晨 0-5 点期望 false（今日缺报但未到出报时点） */
  const bjHourNow = new Date(Date.now() + 8 * 3600e3).getUTCHours();
  check("hw pending 领取（need 按 05:00 拦门 + UP/机型/近链/B站视频/图鉴名单）", hpj.ok === true && hpj.need === (bjHourNow >= 5) && /^\d{4}-\d{2}-\d{2}$/.test(hwDate) &&
    Array.isArray(hpj.ups) && Array.isArray(hpj.watch) && Array.isArray(hpj.recentUrls) && Array.isArray(hpj.bili) &&
    Array.isArray(hpj.devices) && hpj.devices.length === 500, "need=" + hpj.need + " bjHour=" + bjHourNow);
  hd = await fetch(BASE + "/api/workbench/hw/done", {
    method: "POST", headers: { "Content-Type": "application/json", "x-hw-token": hwTok },
    body: "not-json{",
  });
  check("hw done 坏 JSON → 400", hd.status === 400, hd.status);
  hd = await fetch(BASE + "/api/workbench/hw/done", {
    method: "POST", headers: { "Content-Type": "application/json", "x-hw-token": hwTok },
    body: JSON.stringify({ date: "2026-01-01", summary: "旧日期" }),
  });
  check("hw done 非今日/昨日 → 400", hd.status === 400, hd.status);
  let ovOk = false, ovDetail = "";
  try {
    hd = await hwPush({ date: hwDate, summary: "x".repeat(320 * 1024) });
    ovOk = hd.status === 400;
    ovDetail = "status " + hd.status;
  } catch (e) {
    /* 读满上限即 req.destroy() 掐断连接，客户端表现为连接重置——同样达到防护目的 */
    ovOk = true;
    ovDetail = (e.cause && e.cause.code) || e.message;
  }
  check("hw done 超 300KB → 拒绝（400 或掐断连接）", ovOk, ovDetail);
  const hwPush = (body, tok) => fetch(BASE + "/api/workbench/hw/done", {
    method: "POST", headers: { "Content-Type": "application/json", "x-hw-token": tok || hwTok },
    body: JSON.stringify(body),
  });
  hd = await hwPush({
    date: hwDate,
    summary: "今日整合：AI 眼镜两连发，戒指赛道降价。" + "长".repeat(2500),
    links: [
      { t: '<script>alert("hw")</script> 众筹新品', u: "https://www.kickstarter.com/projects/x", s: "Kickstarter", cat: "众筹源头", n: "达成 300%", lens: 1 },
      { t: "雷鸟 Air3 半年长测", u: "https://www.bilibili.com/video/BV1hw", s: "B站", cat: "测评口碑", n: "", lens: 9 },
      { t: "无 URL 条目应被丢弃", u: "javascript:alert(1)", s: "x", cat: "展会新品" },
    ],
    prices: [
      { m: "XREAL One", p: "2299 元", src: "慢慢买" },
      { m: "Galaxy Ring", p: "1999 元（闲鱼样本均值）", src: "闲鱼快照" },
      { m: "Oura Ring 4", p: "$249（黑五常价 $299）", src: "Reddit 讨论样本" },
    ],
    devices: [
      { name: "XREAL One", brand: "XREAL", cat: "AI眼镜", lens: 3, wear: "眼部", collects: "第一视角视频", shows: "AR 信息叠加", status: "已发售", url: "https://www.xreal.com/one", price: "2299 元", priceSrc: "慢慢买" },
      { name: "Oura Ring 4", brand: "Oura", cat: "智能戒指", lens: 2, wear: "手指", collects: "HRV/皮温/睡眠分期", status: "已发售", url: "https://ouraring.com/4" },
      { name: "非法透镜机", cat: "手表", lens: 9, wear: "鼻子", status: "传闻" },
      { name: "种子设备001", status: "已发售", price: "99 元" },
    ],
    sources: { kickstarter: "原生", smzdm: "降级(bing)", xianyu: "缺席" },
    watch: ["Rokid Glasses 3"],
  });
  const hdd = await hd.json();
  check("hw done 回传 → 200（滤后 2 条链接）", hd.status === 200 && hdd.ok === true && hdd.links === 2, JSON.stringify(hdd));
  cookie = "";
  await req("POST", "/api/login", { username: "wbtest-admin", password: "wbtest-pass-2026" });
  r = await req("GET", "/api/workbench/data");
  const hw = r.json.hw;
  check("情报进入 /data（最新一条 + 图鉴计数）", hw && hw.date === hwDate && hw.summary.startsWith("今日整合：") && hw.links.length === 2 && hw.prices.length === 3 &&
    r.json.hwDevices === 500, JSON.stringify({ hw: hw && hw.date, hwDevices: r.json.hwDevices }));
  check("链接透镜标注（非法 lens 9 归 0）", hw.links.some(l => l.lens === 1) && hw.links.every(l => [0, 1, 2, 3].includes(l.lens)),
    JSON.stringify(hw.links.map(l => l.lens)));
  check("summary 截 2000 / 非 http 链接被滤", hw.summary.length === 2000 && !hw.links.some(l => !/^https?:\/\//i.test(l.u)), String(hw.summary.length));
  check("链接标题原样存储（XSS 转义在前端 esc 渲染）", hw.links.some(l => l.t.includes("<script>alert")), JSON.stringify(hw.links[0]));
  /* 图鉴：匿名 401 → admin 全量 → 合并/价轨/淘汰 → Biblioteca 动态书 */
  hd = await fetch(BASE + "/api/workbench/hw/devices");
  check("hw devices 匿名 → 401", hd.status === 401, hd.status);
  r = await req("GET", "/api/workbench/hw/devices");
  const devs = (r.json && r.json.devices) || [];
  const dx = devs.find(d => d.name === "XREAL One") || {};
  const dO = devs.find(d => d.name === "Oura Ring 4") || {};
  check("图鉴合并：新设备入库 + 老 heat+1 + 非法 lens 归 0",
    dx.lens === 3 && dx.heat === 1 && dx.url === "https://www.xreal.com/one" &&
    (devs.find(d => d.name === "非法透镜机") || {}).lens === 0 &&
    (devs.find(d => d.name === "种子设备001") || {}).heat === 6,
    JSON.stringify({ total: devs.length, dx, d001: devs.find(d => d.name === "种子设备001") }));
  check("图鉴价轨：设备自带价 + 保值组同日覆盖挂轨",
    (dx.prices || []).length === 1 && dx.prices[0].p === "2299 元" && (dO.prices || [])[0] && dO.prices[0].p.includes("249") &&
    !devs.some(d => d.name === "Galaxy Ring"),   /* 保值组机型不凭空造设备 */
    JSON.stringify({ dx: dx.prices, dO: dO.prices }));
  check("部位收敛：wear 白名单外归「其他」", dx.wear === "眼部" && (dO.wear === "手指") &&
    (devs.find(d => d.name === "非法透镜机") || {}).wear === "其他",
    JSON.stringify({ dx: dx.wear, dO: dO.wear, bad: (devs.find(d => d.name === "非法透镜机") || {}).wear }));
  check("图鉴 500 上限冷淘汰（505 种子 + 3 新 → 挤掉 8 台最冷）",
    devs.length === 500 && devs.filter(d => d.name.startsWith("种子设备")).length === 497, devs.length);
  r = await req("GET", "/kb-data.js");
  check("图鉴成书（Biblioteca 动态书 + atlas 标记）",
    (r.text || "").includes("hw-devices") && (r.text || "").includes("智能硬件图鉴") && (r.text || "").includes("atlas"), (r.text || "").slice(0, 80));
  const kbJ = JSON.parse(r.text.replace(/^window\.KB = /, "").replace(/;\s*$/, ""));
  const atlasBook = kbJ.books.find(b => b.id === "hw-devices");
  const aiIdx = atlasBook ? atlasBook.chapters.findIndex(c => c.title.startsWith("AI眼镜")) : -1;
  r = await req("GET", "/api/kb/chapter?b=hw-devices&c=" + aiIdx);
  check("图鉴章渲染品类表格", aiIdx >= 0 && r.json && r.json.ok && r.json.html.includes("<table") && r.json.html.includes("XREAL One"),
    "aiIdx=" + aiIdx + " " + JSON.stringify(r.json).slice(0, 100));
  check("图鉴表格含部位列", r.json && r.json.ok && r.json.html.includes("部位") && r.json.html.includes("眼部"), (r.json && r.json.html || "").slice(0, 80));
  let hwFile = JSON.parse(fs.readFileSync(path.join(tmpData, "workbench-hw.json"), "utf8"));
  check("推送后仍只留 7 天且今日置顶", hwFile.days.length === 7 && hwFile.days[0].date === hwDate, hwFile.days.map(d => d.date).join(","));
  check("watch 增量合并（+Rokid）", hwFile.watch.includes("Rokid Glasses 3") && hwFile.watch.includes("雷鸟 Air3"), JSON.stringify(hwFile.watch));
  hd = await hwPush({ date: hwDate, summary: "同日重推版", links: [{ t: "重推", u: "https://a.b/c", s: "t", cat: "展会新品" }] });
  check("同日重推 → 覆盖更新", hd.status === 200 && (await hd.json()).links === 1, hd.status);
  hwFile = JSON.parse(fs.readFileSync(path.join(tmpData, "workbench-hw.json"), "utf8"));
  check("覆盖后仍 7 天、内容为新版", hwFile.days.length === 7 && hwFile.days[0].summary === "同日重推版", JSON.stringify(hwFile.days[0]).slice(0, 80));
  hpr = await fetch(BASE + "/api/workbench/hw/pending?token=" + hwTok);
  hpj = await hpr.json();
  check("推送后 pending.need=false（今日已完成）", hpj.ok === true && hpj.need === false, JSON.stringify(hpj).slice(0, 80));

  /* ---- 全站导航条 + 首页节气（静态结构） ---- */
  for (const pg of ["kb.html", "workbench.html", "kids-english.html", "kindle-dashboard.html",
    "openclaw.html", "poster-six.html", "reader.html", "video-scripts.html", "about-site.html"]) {
    r = await req("GET", "/" + pg, undefined, "follow");
    check("全站导航条 " + pg,
      r.status === 200 && (r.text || "").includes('class="g-pill"') && (r.text || "").includes("Inicio") && (r.text || "").includes("index.html#cuaderno"),
      r.status);
  }
  r = await req("GET", "/index.html", undefined, "follow");
  check("首页节气模块（clockTerm + Meeus 视黄经）",
    (r.text || "").includes('id="clockTerm"') && (r.text || "").includes("solarLongitude") && (r.text || "").includes("TERM_NAMES"));

  /* ---- 小红书粉丝监控（Mac 推送模式：xhsToken 回传，同 hw 情报） ---- */
  r = await req("GET", "/api/workbench/data");
  const xhs0 = (r.json && r.json.xhs) || {};
  check("小红书快照带出（主页 ID + days 结构）", xhs0.account === "5ae9132b11be103284ad135c" && Array.isArray(xhs0.days),
    JSON.stringify(xhs0).slice(0, 90));
  const xhsTok = JSON.parse(fs.readFileSync(path.join(tmpData, "server-config.json"), "utf8")).xhsToken;
  let xp = await fetch(BASE + "/api/workbench/xhs/done", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fans: 4577, redId: "kg12141706", nickname: "测试昵称" }) });
  check("小红书回传 无 token → 401", xp.status === 401, xp.status);
  xp = await fetch(BASE + "/api/workbench/xhs/done", { method: "POST", headers: { "Content-Type": "application/json", "x-xhs-token": xhsTok },
    body: JSON.stringify({}) });
  check("小红书回传 缺 fans → 400", xp.status === 400, xp.status);
  const xhsYesterday = new Date(Date.now() - 86400e3).toISOString().slice(0, 10);
  xp = await fetch(BASE + "/api/workbench/xhs/done", { method: "POST", headers: { "Content-Type": "application/json", "x-xhs-token": xhsTok },
    body: JSON.stringify({ fans: 4560, date: xhsYesterday, redId: "kg12141706", nickname: "测试昵称" }) });
  check("小红书回传 昨日点 → 200", xp.status === 200 && (await xp.json()).ok === true, xp.status);
  xp = await fetch(BASE + "/api/workbench/xhs/done", { method: "POST", headers: { "Content-Type": "application/json", "x-xhs-token": xhsTok },
    body: JSON.stringify({ fans: 4577, redId: "kg12141706", nickname: "测试昵称" }) });
  check("小红书回传 今日点 → 200", xp.status === 200, xp.status);
  r = await req("GET", "/api/workbench/data");
  const xhs1 = (r.json && r.json.xhs) || {};
  check("小红书快照：粉丝/redId/涨跌齐出", xhs1.ok === true && xhs1.fans === 4577 && xhs1.redId === "kg12141706" &&
    xhs1.delta1 === 17 && Array.isArray(xhs1.days) && xhs1.days.length === 2,
    JSON.stringify({ ok: xhs1.ok, fans: xhs1.fans, delta1: xhs1.delta1, days: xhs1.days.length }));
  xp = await fetch(BASE + "/api/workbench/xhs/done", { method: "POST", headers: { "Content-Type": "application/json", "x-xhs-token": xhsTok },
    body: JSON.stringify({ fans: 4580, date: "2026-01-01" }) });
  check("小红书回传 远古日期 → 400", xp.status === 400, xp.status);
  check("xhs-fans.json 落在隔离 data/（不入部署包）", fs.existsSync(path.join(tmpData, "xhs-fans.json")));

  /* ---- Biblioteca 书本删除（静态书=屏蔽名单 / lectura 清空 / 图鉴拒删） ---- */
  cookie = "";
  r = await req("DELETE", "/api/kb/book?id=agent-handbook");
  check("书本删除 匿名 → 401", r.status === 401, r.status);
  await req("POST", "/api/login", { username: "wbtest-admin", password: "wbtest-pass-2026" });
  r = await req("GET", "/kb-data.js");
  check("删除前目录含静态书 agent-handbook", (r.text || "").includes("agent-handbook"));
  r = await req("DELETE", "/api/kb/book?id=agent-handbook");
  check("删除静态书 → 200（first=true）", r.json && r.json.ok === true && r.json.first === true, JSON.stringify(r.json));
  r = await req("GET", "/kb-data.js");
  check("删除后目录不再含 agent-handbook", !(r.text || "").includes("agent-handbook"));
  r = await req("GET", "/api/kb/chapter?b=agent-handbook&c=0");
  check("删除后章节 → 404", r.status === 404, r.status);
  r = await req("DELETE", "/api/kb/book?id=agent-handbook");
  check("重复删除幂等 → 200（first=false）", r.json && r.json.ok === true && r.json.first === false, JSON.stringify(r.json));
  check("屏蔽名单写入 data/（部署不覆盖）", JSON.parse(fs.readFileSync(path.join(tmpData, "kb-removed.json"), "utf8")).ids.includes("agent-handbook"));
  r = await req("DELETE", "/api/kb/book?id=hw-devices");
  check("图鉴书拒删 → 400", r.status === 400, r.status);
  r = await req("DELETE", "/api/kb/book?id=lectura");
  check("lectura 空书 → 404", r.status === 404, r.status);
  r = await req("DELETE", "/api/kb/book?id=up-nope");
  check("上传/收集书引导走原接口 → 400", r.status === 400, r.status);

  /* ---- Biblioteca 书本分类（auto/manual + 图鉴固定 + 删除挂钩） ---- */
  r = await req("GET", "/kb-data.js");
  const kbc = JSON.parse(r.text.replace(/^window\.KB = /, "").replace(/;\s*$/, ""));
  const cbi = kbc.books.find(b => b.id === "interview-bank");
  const cbv = kbc.books.find(b => b.id === "video-scripts");
  const cba = kbc.books.find(b => b.id === "hw-devices");
  check("目录带分类（种子 manual/auto + 图鉴固定硬件与设备）",
    cbi && cbi.cat === "职场与商业" && cbv && cbv.cat === "视频与创作" && cba && cba.cat === "硬件与设备",
    JSON.stringify({ i: cbi && cbi.cat, v: cbv && cbv.cat, a: cba && cba.cat }));
  cookie = "";
  r = await req("PUT", "/api/kb/category", { id: "dala-design", cat: "设计与审美" });
  check("改类 匿名 → 401", r.status === 401, r.status);
  await req("POST", "/api/login", { username: "wbtest-admin", password: "wbtest-pass-2026" });
  r = await req("PUT", "/api/kb/category", { id: "dala-design", cat: "玄学" });
  check("白名单外类别 → 400", r.status === 400, r.status);
  r = await req("PUT", "/api/kb/category", { id: "dala-design", cat: "设计与审美" });
  check("手动改类 → 200", r.json && r.json.ok === true && r.json.cat === "设计与审美", JSON.stringify(r.json));
  let catFile = JSON.parse(fs.readFileSync(path.join(tmpData, "kb-categories.json"), "utf8"));
  check("manual 落盘", catFile["dala-design"] && catFile["dala-design"].by === "manual", JSON.stringify(catFile["dala-design"]));
  r = await req("PUT", "/api/kb/category", { id: "no-such-book", cat: "其他" });
  check("改类不存在书 → 404", r.status === 404, r.status);
  r = await req("DELETE", "/api/kb/book?id=video-scripts");
  check("删除静态书（类别条目应保留）", r.json && r.json.ok === true, JSON.stringify(r.json));
  catFile = JSON.parse(fs.readFileSync(path.join(tmpData, "kb-categories.json"), "utf8"));
  check("静态书删除后类别仍在表（恢复友好）", catFile["video-scripts"] && catFile["video-scripts"].cat === "视频与创作");
  const upr = await rawUpload("分类清理测试.md", "# 分类清理\n\n## 一\n\n内容\n");
  const upId = upr.json && upr.json.id;
  check("上传新书", !!upId, JSON.stringify(upr.json));
  r = await req("PUT", "/api/kb/category", { id: "up-" + upId, cat: "学习与语言" });
  check("给上传书分类", r.json && r.json.ok === true, JSON.stringify(r.json));
  r = await req("DELETE", "/api/kb/upload?id=" + upId);
  check("删除上传书", r.json && r.json.ok === true, JSON.stringify(r.json));
  catFile = JSON.parse(fs.readFileSync(path.join(tmpData, "kb-categories.json"), "utf8"));
  check("上传书删除后类别条目清理", !catFile["up-" + upId], Object.keys(catFile).join(","));

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
