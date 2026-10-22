/* ============================================================
   El Taller de Andres — 应用服务器（零 npm 依赖，Node 24+）
   node server.js  →  http://localhost:8891
   功能：静态托管 / 账号登录（scrypt+签名Cookie）/ 角色权限 /
         作品可见性过滤下发 / 和风天气代理（Key 只存服务端）
   ============================================================ */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");
const { DatabaseSync } = require("node:sqlite");
const { spawnSync } = require("child_process");

/* ---------------- 配置（按需修改） ---------------- */
const CFG = {
  PORT: parseInt(process.env.TALLER_PORT || "8891", 10),
  SESSION_TTL_MS: 7 * 24 * 3600 * 1000,     // 会话有效期 7 天
  LOGIN_MAX_FAILS: 5,                        // 连续失败 N 次锁定
  LOCK_MS: 10 * 60 * 1000,                   // 锁定 10 分钟
  WEATHER_CACHE_MS: 30 * 60 * 1000,          // 天气缓存 30 分钟
  WEATHER_TIMEOUT_MS: 6000,
  QW_HOST: "m53mdbgg6c.re.qweatherapi.com",  // 和风专属 API Host
  QW_LOCATION: "101020100",                  // 上海
  /* 天气 Key 不进源码：data/server-config.json 的 qwKey 字段，环境变量 TALLER_QW_KEY 可覆盖 */
};

const ROOT = __dirname;
/* TALLER_DATA_DIR 供测试隔离数据目录；运行时数据（users.db / server-config.json / workbench-*）都在这里 */
const DATA = process.env.TALLER_DATA_DIR ? path.resolve(process.env.TALLER_DATA_DIR) : path.join(ROOT, "data");
if (!fs.existsSync(DATA)) fs.mkdirSync(DATA, { recursive: true });

/* ---------------- 数据库 ---------------- */
const db = new DatabaseSync(path.join(DATA, "users.db"));
db.exec(`CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  pwhash TEXT NOT NULL,
  salt TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  must_change INTEGER NOT NULL DEFAULT 0,
  created TEXT NOT NULL DEFAULT (datetime('now'))
)`);

function hashPassword(pwd, salt) {
  return crypto.scryptSync(pwd, salt, 64).toString("hex");
}
function makeSalt() {
  return crypto.randomBytes(16).toString("hex");
}
function verifyPassword(pwd, salt, expectHex) {
  const got = Buffer.from(hashPassword(pwd, salt), "hex");
  const exp = Buffer.from(expectHex, "hex");
  return got.length === exp.length && crypto.timingSafeEqual(got, exp);
}
/* 管理台可建角色（guest 不是账号，是未登录态） */
const ROLES_CREATABLE = ["user", "family", "admin"];
function countAdmins() {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin'").get().n;
}

/* 首次启动：生成种子管理员，初始密码写入 data/admin-initial-password.txt */
if (db.prepare("SELECT COUNT(*) AS n FROM users").get().n === 0) {
  const pwd = crypto.randomBytes(9).toString("base64url");
  const salt = makeSalt();
  db.prepare("INSERT INTO users(username,pwhash,salt,role,must_change) VALUES(?,?,?,?,1)")
    .run("admin", hashPassword(pwd, salt), salt, "admin");
  const notice =
    "El Taller de Andres —— 管理员初始密码（首次登录后会要求修改）\r\n" +
    "生成时间: " + new Date().toLocaleString() + "\r\n" +
    "用户名: admin\r\n" +
    "初始密码: " + pwd + "\r\n\r\n" +
    "改密成功后本文件可删除。请勿把本文件提交到仓库或上传服务器。\r\n";
  fs.writeFileSync(path.join(DATA, "admin-initial-password.txt"), notice, "utf8");
  console.log("----------------------------------------------------------");
  console.log("  已创建管理员账号 admin");
  console.log("  初始密码见 data\\admin-initial-password.txt");
  console.log("----------------------------------------------------------");
}

/* ---------------- 会话（HMAC 签名 Cookie，无服务端存储） ---------------- */
const SECRET_FILE = path.join(DATA, "session-secret.key");
function makeSessionSecret() {
  fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString("hex"), "utf8");
  return Buffer.from(fs.readFileSync(SECRET_FILE, "utf8").trim(), "hex");
}
/* let：改密成功会调 rotateSessionSecret() 重建密钥，所有旧 Cookie 验签立即失败（= 全站踢下线重登） */
let SECRET = fs.existsSync(SECRET_FILE)
  ? Buffer.from(fs.readFileSync(SECRET_FILE, "utf8").trim(), "hex")
  : makeSessionSecret();
function rotateSessionSecret() { SECRET = makeSessionSecret(); }
const COOKIE = "taller_sid";

const b64u = buf => Buffer.from(buf).toString("base64url");
function signSession(payload) {
  const body = b64u(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return body + "." + sig;
}
function readSession(req) {
  const cookies = (req.headers.cookie || "").split(";").map(s => s.trim());
  const raw = cookies.find(c => c.startsWith(COOKIE + "="));
  if (!raw) return null;
  const val = raw.slice(COOKIE.length + 1);
  const dot = val.lastIndexOf(".");
  if (dot < 0) return null;
  const body = val.slice(0, dot), sig = val.slice(dot + 1);
  const expect = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!p.e || Date.now() > p.e) return null;
    return p;
  } catch { return null; }
}
function sessionCookie(payload, secure) {
  return `${COOKIE}=${signSession(payload)}; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}; Max-Age=${Math.floor((payload.e - Date.now()) / 1000)}`;
}
/* 经 Nginx/HTTPS 反代时（X-Forwarded-Proto: https）Cookie 自动加 Secure */
const isSecureReq = req => !!(req.socket.encrypted || (req.headers["x-forwarded-proto"] || "").startsWith("https"));
function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

/* ---------------- 登录限速 ---------------- */
const fails = new Map(); // key: ip|username -> {n, lockUntil}
function loginLocked(key) {
  const f = fails.get(key);
  return f && f.lockUntil > Date.now() ? f.lockUntil : 0;
}
function recordFail(key) {
  const now = Date.now();
  /* 顺手清掉锁早已过期且无剩余计数的条目，防长期运行 Map 无限增长 */
  for (const [k, f] of fails) if (f.n === 0 && f.lockUntil < now - 24 * 3600e3) fails.delete(k);
  const f = fails.get(key) || { n: 0, lockUntil: 0 };
  f.n += 1;
  if (f.n >= CFG.LOGIN_MAX_FAILS) { f.lockUntil = now + CFG.LOCK_MS; f.n = 0; }
  fails.set(key, f);
}

/* ---------------- 工具 ---------------- */
function send(res, status, body, headers) {
  const h = Object.assign({ "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" }, headers);
  res.writeHead(status, h);
  res.end(body);
}
function json(res, status, obj, headers) {
  send(res, status, JSON.stringify(obj), Object.assign({ "Content-Type": "application/json; charset=utf-8" }, headers));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > 16384) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
async function readJson(req) {
  const raw = await readBody(req);
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

/* ---------------- 静态文件 ---------------- */
const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp",
  ".svg": "image/svg+xml", ".ico": "image/x-icon", ".txt": "text/plain; charset=utf-8",
    ".mp4": "video/mp4", ".webm": "video/webm", ".m4v": "video/mp4",
    ".glb": "model/gltf-binary",
  ".pdf": "application/pdf", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
const BLOCKED_DIRS = ["data", "tools", "node_modules", ".git", "deploy"]; // 永不对外
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath).replace(/^\/+/, "");
  const hx = rel.indexOf("#");
  if (hx >= 0) rel = rel.slice(0, hx);   // # 被编码成 %23 混进路径（转发链接常见）→ 截断还原，按真实页面走
  if (rel === "") rel = "index.html";
  const abs = path.normalize(path.join(ROOT, rel));
  /* 必须带路径分隔符：不带则 /opt/taller-xxx 等同前缀兄弟目录也能通过检查 */
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) return json(res, 403, { error: "forbidden" });
  const relCheck = path.relative(ROOT, abs);
  if (BLOCKED_DIRS.includes(relCheck.split(path.sep)[0])) return json(res, 404, { error: "not found" });
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return json(res, 404, { error: "not found" });
  const ext = path.extname(abs).toLowerCase();
  if (!MIME[ext]) return json(res, 404, { error: "not found" });
  /* 大体积且低频变更的 3D 资源给 24h 缓存（模型更换时前端用 ?v=N 破缓存），其余一律 no-store */
  const cacheable = rel.startsWith("assets/models/") || rel.startsWith("assets/vendor/");
  const cacheHdr = cacheable ? { "Cache-Control": "public, max-age=86400" } : {};
  const data = fs.readFileSync(abs);
  const range = req.headers.range;                         // 视频拖动/Safari 播放需要 206
  if (range && /^bytes=/.test(range)) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    const size = data.length;
    let start = m[1] === "" ? 0 : parseInt(m[1], 10);
    let end = m[2] === "" ? size - 1 : parseInt(m[2], 10);
    if (isNaN(start) || isNaN(end) || start > end || start >= size) {
      json(res, 416, { error: "range not satisfiable" });
      return true;
    }
    if (end >= size) end = size - 1;
    res.writeHead(206, Object.assign({
      "Content-Type": MIME[ext],
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Cache-Control": "no-store",
    }, cacheHdr));
    res.end(data.subarray(start, end + 1));
    return true;
  }
  send(res, 200, data, Object.assign({ "Content-Type": MIME[ext], "Accept-Ranges": "bytes" }, cacheHdr));
  return true;
}

/* ---------------- 作品下发（按角色过滤 visibility） ---------------- */
/* works.js / notes.js 都是「注释 + window.XXX=[...]」格式：截取首个 [ 到最后一个 ] 求值 */
function loadJsArray(file) {
  try {
    const text = fs.readFileSync(file, "utf8");
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start < 0 || end <= start) return null;
    const arr = new Function(`return ${text.slice(start, end + 1)}`)();
    return Array.isArray(arr) ? arr : null;
  } catch { return null; }
}
function loadWorks() {
  return loadJsArray(path.join(ROOT, "works.js")) || [];
}
/* 四级可见性链 public < friends < family < private；角色档位 guest(0) < user朋友(1) < family家人(2) < admin(3)。
   未知 visibility 一律隐藏（与服务端过滤口径一致）。 */
const VIS_LEVEL = { public: 0, friends: 1, family: 2, private: 3 };
const ROLE_LEVEL = { user: 1, family: 2, admin: 3 };
const roleLevel = s => (s && ROLE_LEVEL[s.r]) || 0;
function filterWorks(works, session) {
  const lvl = roleLevel(session);
  return works.filter(w => {
    const need = VIS_LEVEL[w.visibility || "public"];
    return need != null && need <= lvl;
  });
}

/* ---------------- 知识库下发（登录可见；内容文件在 data/，永不静态外泄） ---------------- */
let kbCache = { mtime: 0, body: null };
function loadKb() {
  const f = path.join(DATA, "kb-content.json");
  const mt = fs.statSync(f).mtimeMs;
  if (!kbCache.body || kbCache.mtime !== mt) {
    kbCache = { mtime: mt, body: JSON.parse(fs.readFileSync(f, "utf8")) };
  }
  return kbCache.body;
}

/* ---------------- Biblioteca 上传收录（admin 上传 PDF/MD；登录可见） ----------------
   md = build-kb 同款「## 拆章」逻辑（复制自 tools/build-kb.js 保持自包含）；
   pdf = 不抽文本，内嵌浏览器原生查看器；文件存 data/kb-uploads/（BLOCKED，只走 API） */
const KB_UPLOAD_DIR = path.join(DATA, "kb-uploads");
const KB_UPLOAD_FILE = path.join(DATA, "kb-uploads.json");
let kbUploads = loadJson(KB_UPLOAD_FILE, {});
/* 公开分享链接：{ [token]: {token, book, chapter(-1=整本|索引), createdAt, expiresAt(0=永久), by, title快照} }
   —— token 12 字节 base64url（96 位熵不可猜）；/s/<token> 无登录只读；吊销/过期即失效 */
const KB_SHARE_FILE = path.join(DATA, "kb-shares.json");
let kbShares = loadJson(KB_SHARE_FILE, {});
/* 设计修正（2026-10-10 站主反馈）：主动上传 ≠ 看过——只有点过 要/不要 或写过评论（有 readAt）的才算处置过，
   其余一律回待处理队列。旧版迁移曾把无 state 的标成 keep，无 readAt 的 keep 一并重排（幂等）。 */
for (const u of Object.values(kbUploads)) {
  if (!u.state || (u.state === "keep" && !u.readAt)) u.state = "new";
}

/* ---------------- 视频收集桥（Biblioteca 提交链接 → Mac openclaw 领取 → 转录回传） ----------------
   队列存 data/kb-collect.json；pending 超 3 小时视为失败（Mac 未领取或处理卡死） */
const KB_COLLECT_FILE = path.join(DATA, "kb-collect.json");
let kbCollect = loadJson(KB_COLLECT_FILE, { items: [] });
if (!Array.isArray(kbCollect.items)) kbCollect.items = [];
function kbCollectSweep() {
  const cutoff = Date.now() - 3 * 3600 * 1000;
  let dirty = false;
  for (const it of kbCollect.items) {
    if (it.state === "pending" && it.at < cutoff) {
      it.state = "failed";
      it.error = "处理超时：Mac 侧 openclaw 未领取或处理卡住（超过 3 小时）";
      it.doneAt = Date.now();
      dirty = true;
    }
  }
  if (dirty) saveJson(KB_COLLECT_FILE, kbCollect);
}
kbCollectSweep();
const kbUploadEsc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function kbMdInline(s) {
  let t = kbUploadEsc(s);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return t;
}
function kbMdToHtml(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {
      const buf = []; i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push('<pre class="kb-pre"><code>' + kbUploadEsc(buf.join("\n")) + "</code></pre>");
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const cells = row => row.trim().replace(/^\||\|$/g, "").split("|").map(c => kbMdInline(c.trim()));
      const head = cells(line); i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      out.push("<table><thead><tr>" + head.map(h => "<th>" + h + "</th>").join("") + "</tr></thead><tbody>" +
        rows.map(r => "<tr>" + r.map(c => "<td>" + c + "</td>").join("") + "</tr>").join("") + "</tbody></table>");
      continue;
    }
    let m;
    if ((m = line.match(/^(#{1,4})\s+(.+)$/))) { out.push(`<h${m[1].length + 1}>` + kbMdInline(m[2]) + `</h${m[1].length + 1}>`); i++; continue; }
    if ((m = line.match(/^>\s?(.*)$/))) {
      const buf = [m[1]]; i++;
      while (i < lines.length && (m = lines[i].match(/^>\s?(.*)$/))) { buf.push(m[1]); i++; }
      out.push("<blockquote>" + buf.map(kbMdInline).join("<br>") + "</blockquote>");
      continue;
    }
    if (/^\s*-\s+/.test(line)) {
      const items = [];
      while (i < lines.length) {
        const mm = lines[i].match(/^(\s*)-\s+(.+)$/);
        if (!mm) break;
        items.push({ deep: mm[1].length >= 2, text: mm[2] }); i++;
      }
      let html = "<ul>", open = false;
      for (const it of items) {
        if (it.deep) { if (!open) { html += "<ul>"; open = true; } html += "<li>" + kbMdInline(it.text) + "</li>"; }
        else { if (open) { html += "</ul>"; open = false; } html += "<li>" + kbMdInline(it.text) + "</li>"; }
      }
      if (open) html += "</ul>";
      out.push(html + "</ul>");
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && (m = lines[i].match(/^\s*\d+\.\s+(.+)$/))) { items.push(m[1]); i++; }
      out.push("<ol>" + items.map(t => "<li>" + kbMdInline(t) + "</li>").join("") + "</ol>");
      continue;
    }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
    if (/^\s*$/.test(line)) { i++; continue; }
    const buf = [line]; i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,4}\s|>|\s*-\s+|\s*\d+\.\s+|\s*\||```|-{3,})/.test(lines[i])) { buf.push(lines[i]); i++; }
    out.push("<p>" + buf.map(kbMdInline).join("<br>") + "</p>");
  }
  return out.join("\n");
}
/* 上传 MD 拆书：连续 H1 合并当书名（中英对照标题），> 引用进简介，## 拆章 */
function kbSplitUploadBook(md) {
  const lines = md.split(/\r?\n/);
  const titles = [];
  let intro = "", bodyStart = 0, seenBody = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (!seenBody && /^#\s+/.test(l) && !/^##\s/.test(l)) { titles.push(l.replace(/^#\s+/, "")); continue; }
    if (!seenBody && /^>\s?/.test(l)) { intro += (intro ? " " : "") + l.replace(/^>\s?/, ""); continue; }
    if (/^##\s+/.test(l)) { bodyStart = i; break; }
    if (!/^\s*$/.test(l) && !/^(-{3,}|\*{3,})\s*$/.test(l)) { bodyStart = i; seenBody = true; continue; }
    if (seenBody) break;
  }
  const chapters = [];
  let cur = null;
  for (let i = bodyStart; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.+)$/);
    if (m) { cur = { id: "ch" + chapters.length, title: m[1].trim(), md: [] }; chapters.push(cur); }
    else if (cur) cur.md.push(lines[i]);
  }
  chapters.forEach(c => { c.html = kbMdToHtml(c.md.join("\n")); c.text = c.html.replace(/<[^>]+>/g, " "); delete c.md; });
  return { title: titles.join(" ｜ ") || "未命名文档", intro: kbMdInline(intro), chapters: chapters.filter(c => c.html.length > 0) };
}
/* 全量书装配（含正文）：静态基座（mtime 缓存解析）+ 阅读精选 + 上传书 */
const kbUploadParsed = {};   // 上传 md 解析缓存（id → {chapters, intro}；文件不可变，进程内一次）
let kbFullCache = { mtime: 0, books: [] };
function kbFullBooks() {
  const f = path.join(ROOT, "kb-data.js");
  const mt = fs.statSync(f).mtimeMs;
  if (mt !== kbFullCache.mtime) {
    try {
      const t = fs.readFileSync(f, "utf8");
      kbFullCache = { mtime: mt, books: JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)).books || [] };
    } catch { /* 解析失败沿用旧缓存 */ }
  }
  return kbFullCache.books;
}
/* 静态书移除名单：kb-data.js 是部署产物（每次 deploy 重推），删除靠运行时屏蔽——
   名单存 data/kb-removed.json（永不随部署覆盖）；恢复 = 从名单里去掉 id */
const KB_REMOVED_FILE = path.join(DATA, "kb-removed.json");
let kbRemoved = new Set((loadJson(KB_REMOVED_FILE, { ids: [] }).ids || []).map(String).filter(Boolean));
/* 书本分类：七类白名单；类别表存 data/kb-categories.json（运行时，部署不覆盖）。
   by: auto（GLM 按内容分）| manual（站主手改，永不被自动覆盖）；图鉴/阅读精选的类别在 catalog 固定，不入表 */
const KB_CATS = ["AI与智能体", "职场与商业", "设计与审美", "视频与创作", "硬件与设备", "学习与语言", "其他"];
const KB_CAT_FILE = path.join(DATA, "kb-categories.json");
let kbCats = loadJson(KB_CAT_FILE, {});
if (!kbCats || typeof kbCats !== "object" || Array.isArray(kbCats)) kbCats = {};
/* 划线/页边问答/每日回顾（gloss 式）：按用户名隔离，存 data/kb-marks.json（运行时，部署不覆盖）。
   quote=选中原文；pre/suf=前后文锚（重锚定高亮用）；ask/answer=页边问答；box/due=Leitner 盒子 */
const KB_MARKS_FILE = path.join(DATA, "kb-marks.json");
let kbMarks = loadJson(KB_MARKS_FILE, { marks: [] });
if (!kbMarks || !Array.isArray(kbMarks.marks)) kbMarks = { marks: [] };
const kbMarkSave = () => saveJson(KB_MARKS_FILE, kbMarks);
const kbMarkId = () => "m" + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36);
const KB_MARKS_CAP = 2000;            /* 每用户划线上限 */
const KB_ASK_GAP_MS = 8000;           /* 页边问答每用户冷却 */
const KB_SRS_DAYS = [0, 1, 3, 7, 16, 35];   /* 盒子 0-5 的复习间隔（天） */
const kbAskLast = new Map();          /* u → 上次提问 ts（-1 = 回答中） */
/* 阅读进度（每用户最后读位）：data/kb-progress.json */
const KB_PROGRESS_FILE = path.join(DATA, "kb-progress.json");
let kbProgress = loadJson(KB_PROGRESS_FILE, {});
if (!kbProgress || typeof kbProgress !== "object" || Array.isArray(kbProgress)) kbProgress = {};
let kbClassifyBusy = false;
function kbCatOf(b) {
  if (b.atlas) return "硬件与设备";
  if (b.id === "lectura") return "AI与智能体";
  return (kbCats[b.id] && kbCats[b.id].cat) || "";
}
/* GLM 自动分类（后台逐本，1.5s 间隔；未配 Key / 已有类别则跳过；失败静默等下次补扫） */
function kbClassifyQueue() {
  if (kbClassifyBusy || !wbCfg.glmKey) return;
  const todo = kbAllBooks().filter(b => !kbCats[b.id] && !b.atlas && b.id !== "lectura");
  if (!todo.length) return;
  kbClassifyBusy = true;
  (async () => {
    for (const b of todo) {
      try {
        const chs = (b.chapters || []).slice(0, 12).map(c => c.title).join(" / ").slice(0, 600);
        const out = await glmChat(
          "判断下面这本书属于哪个类别。类别只能从这七个里选一个：AI与智能体/职场与商业/设计与审美/视频与创作/硬件与设备/学习与语言/其他。\n" +
          "书名：" + b.title + "\n简介：" + String(b.desc || b.intro || "").slice(0, 200) + "\n章节：" + chs + "\n只回答类别名，不要任何其他文字。",
          { temperature: 0 });
        const hit = KB_CATS.find(c => String(out || "").includes(c));
        if (hit) { kbCats[b.id] = { cat: hit, by: "auto", at: Date.now() }; saveJson(KB_CAT_FILE, kbCats); }
      } catch (e) { console.log("[kb] 分类失败 " + b.id + ": " + e.message); }
      await new Promise(r => setTimeout(r, 1500));
    }
    kbClassifyBusy = false;
    kbClassifyQueue();
  })().catch(() => { kbClassifyBusy = false; });
}

/* ---------------- PDF 上传 → 中英对照书：python3+pypdf 抽文本 → GLM 翻译 → 生成 .md（保留 PDF 原文入口） ----------------
   失败降级 = 保持 PDF 原文内嵌（note 记原因）：无 pypdf / 无文本层（扫描版）/ 无 GLM Key / 翻译成功率过低 */
const KB_PDF_PY = [
  "import sys,json",
  "try:",
  "    from pypdf import PdfReader",
  "except Exception:",
  "    print(json.dumps({'error':'no-pypdf'})); sys.exit(0)",
  "try:",
  "    r=PdfReader(sys.argv[1])",
  "    print(json.dumps({'pages':[ (p.extract_text() or '') for p in r.pages ]}))",
  "except Exception as e:",
  "    print(json.dumps({'error':str(e)[:120]}))",
].join("\n");
function kbPdfExtractPages(pdfPath) {
  const r = spawnSync("python3", ["-c", KB_PDF_PY, pdfPath], { timeout: 120000, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  if (r.error || r.status !== 0 || !String(r.stdout || "").includes("{")) return { error: r.error ? "spawn" : "exit-" + r.status };
  try {
    return JSON.parse(String(r.stdout).slice(String(r.stdout).indexOf("{"), String(r.stdout).lastIndexOf("}") + 1));
  } catch { return { error: "parse" }; }
}
/* 页文本 → 段落：行合并、空行分段；滤页码与跨多数页重复的页眉脚；
   抽取器若无空行（每视觉行一条）导致段落过碎，则退化为按句子聚合成段 */
function kbPdfParas(pages) {
  const n = (pages || []).length || 1;
  const freq = {};
  const lines = [];
  (pages || []).forEach(pg => {
    String(pg).split(/\r?\n/).forEach(raw => {
      const t = raw.replace(/\s+/g, " ").trim();
      lines.push(t);
      if (t && t.length <= 60) freq[t] = (freq[t] || 0) + 1;
    });
    lines.push("\f");
  });
  const junk = new Set(Object.keys(freq).filter(t => freq[t] >= Math.max(3, Math.ceil(n * 0.6))));
  const paras = [];
  let cur = "";
  const flush = () => { const t = cur.replace(/\s+/g, " ").trim(); if (t.length > 40) paras.push(t); cur = ""; };
  for (const t of lines) {
    if (t === "\f" || !t) { flush(); continue; }
    if (junk.has(t) || /^\d{1,4}$/.test(t)) continue;
    cur += (cur ? " " : "") + t;
  }
  flush();
  if (parisTooFine(paras)) {
    const all = lines.filter(t => t && t !== "\f" && !junk.has(t) && !/^\d{1,4}$/.test(t)).join(" ").replace(/\s+/g, " ");
    const sents = all.split(/(?<=[.!?])\s+(?=[A-Z“"(])/);
    const out = [];
    let buf = "";
    for (const s of sents) {
      if ((buf + " " + s).length > 550 && buf) { out.push(buf.trim()); buf = s; }
      else buf = (buf ? buf + " " : "") + s;
    }
    if (buf.trim()) out.push(buf.trim());
    return out.filter(p => p.length > 40);
  }
  return paras;
  function parisTooFine(ps) {
    if (!ps.length) return true;
    return ps.join("").length / ps.length < 120;
  }
}
async function kbPdfTranslateParas(paras) {
  const zh = await glmTranslateLinesFast(paras);
  /* 批量协议丢的段落用单条纯文本协议补（最多补 12 条，沿用 10-15 翻译文章脚本的经验） */
  const miss = [];
  zh.forEach((t, i) => { if (!t && paras[i].length > 60) miss.push(i); });
  for (const i of miss.slice(0, 12)) {
    try {
      zh[i] = keepEnglishTerms(String(await glmChat("把下面这段英文翻译成中文，术语和产品名保留英文，只输出译文：\n\n" + paras[i])).trim());
    } catch {}
  }
  return zh;
}
const kbPdfQueue = [];
let kbPdfBusy = false;
function kbPdfTranslateEnqueue(id) {
  if (!kbPdfQueue.includes(id)) kbPdfQueue.push(id);
  kbPdfTranslateRun();
}
function kbPdfTranslateRun() {
  if (kbPdfBusy) return;
  const id = kbPdfQueue.shift();
  if (!id) return;
  const u = kbUploads[id];
  if (!u || u.type !== "pdf") return kbPdfTranslateRun();
  kbPdfBusy = true;
  u.state = "translating";
  saveJson(KB_UPLOAD_FILE, kbUploads);
  console.log("[kb] PDF 转中英对照开始: " + u.title);
  (async () => {
    try {
      if (!wbCfg.glmKey) throw new Error("未配置 GLM Key");
      const ext = kbPdfExtractPages(path.join(KB_UPLOAD_DIR, u.file));
      if (ext.error) throw new Error("文本抽取失败(" + ext.error + ")");
      /* 超长段（>1600 字符）按句子切开再进批量翻译，防编号协议被超长行打断 */
      const raw = kbPdfParas(ext.pages);
      const paras = [];
      for (const p of raw) {
        if (p.length <= 1600) { paras.push(p); continue; }
        let buf = "";
        for (const s of p.split(/(?<=[.!?])\s+/)) {
          if ((buf + " " + s).length > 1400 && buf) { paras.push(buf.trim()); buf = s; }
          else buf = (buf ? buf + " " : "") + s;
        }
        if (buf.trim()) paras.push(buf.trim());
      }
      const capped = paras.slice(0, 400);
      if (capped.join("").length < 300) throw new Error("无文本层（疑似扫描版 PDF）");
      const zh = await kbPdfTranslateParas(capped);
      const hit = zh.filter(Boolean).length;
      if (hit < Math.ceil(capped.length * 0.5)) throw new Error("翻译段落过少 " + hit + "/" + capped.length);
      let zhTitle = "";
      try {
        zhTitle = keepEnglishTerms(String(await glmChat("把下面的文章标题翻译成简短中文标题（15 字内），只输出标题本身：\n" + u.title.replace(/\.pdf$/i, "")))).trim().slice(0, 24);
      } catch {}
      /* 段落按 ~3500 字符分章，章内每段原文下挂 > 中文译文（与 8 篇对照文章同格式，kbMdToHtml 原生渲染） */
      const chs = [];
      let s = 0, len = 0;
      capped.forEach((p, i) => {
        if (len + p.length > 3500 && i > s) { chs.push([s, i]); s = i; len = 0; }
        len += p.length;
      });
      chs.push([s, capped.length]);
      const md = chs.map((c, ci) => {
        const body = [];
        for (let i = c[0]; i < c[1]; i++) {
          body.push(capped[i]);
          if (zh[i]) body.push("> " + zh[i]);
        }
        return "## 第 " + (ci + 1) + " 部分 / Parte " + (ci + 1) + "\n\n" + body.join("\n\n");
      }).join("\n\n");
      const mdFile = id + ".md";
      fs.writeFileSync(path.join(KB_UPLOAD_DIR, mdFile), md);
      u.pdfFile = u.file;
      u.file = mdFile;
      u.type = "md";
      u.title = u.title.replace(/\.pdf$/i, "") + (zhTitle ? " ｜ " + zhTitle : "");
      u.state = "done";
      delete kbUploadParsed[id];
      saveJson(KB_UPLOAD_FILE, kbUploads);
      console.log("[kb] PDF 转中英对照完成: " + u.title + "（" + hit + "/" + capped.length + " 段，" + chs.length + " 章）");
    } catch (e) {
      u.state = "raw";
      u.note = "PDF 自动转对照未成功：" + (e.message || "未知") + "，保留原文内嵌";
      saveJson(KB_UPLOAD_FILE, kbUploads);
      console.log("[kb] PDF 转中英对照失败: " + u.title + " → " + (e.message || "未知"));
    }
    kbPdfBusy = false;
    kbPdfTranslateRun();
  })();
}
function kbAllBooks() {
  const books = kbFullBooks().slice().filter(b => !kbRemoved.has(b.id));
  const arts = Object.values(wbBiblio).sort((a, b) => (b.promotedAt || 0) - (a.promotedAt || 0));
  if (arts.length) books.push({
    id: "lectura", title: "阅读精选 · 对照阅读", es: "📖 Lectura",
    desc: "Anthropic 研究与 arXiv 论文的全文中英对照。工作台里评论过的文章自动收进本书（未评论的 3 天后清除）。",
    intro: "El Estudio 对照阅读评论过的文章，带着评论收录于此；中文在上、原文在下。",
    at: arts[0].promotedAt || Date.now(),
    chapters: arts.map(a => ({ id: a.id, title: a.title, html: a.html, text: a.text })),
  });
  /* 一个视频一本书：md 的 ## 节拆成章（多分P 每节一章；单P 一章） */
  const colDone = kbCollect.items.filter(i => i.state === "done" && i.md).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  for (const it of colDone) {
    const body = String(it.md).replace(/^#\s+[^\n]+\n*/, "").replace(/(^\s*>[^\n]*\n*)+/, "");
    const frags = body.split(/\n(?=##\s)/);
    const chapters = [];
    for (const s of frags) {
      const m = s.match(/^##\s+([^\n]+)/);
      if (m) chapters.push({ id: "p" + chapters.length, title: m[1].trim().slice(0, 60), html: kbMdToHtml(s.replace(/^##\s+[^\n]+\n?/, "")), text: "" });
      else if (s.trim().length > 20) chapters.push({ id: "p" + chapters.length, title: "开场", html: kbMdToHtml(s), text: "" });
    }
    if (!chapters.length) chapters.push({ id: "p0", title: it.title || "视频内容", html: kbMdToHtml(body), text: "" });
    chapters[0].html = '<p style="opacity:.72;font-size:12px;margin:0 0 14px">📼 个人收集 · 🔗 来源：<a href="' + kbUploadEsc(it.url) + '" target="_blank" rel="noopener">' + kbUploadEsc(it.url) +
      "</a> · 收录于 " + new Date(it.doneAt || it.at).toLocaleString() + "</p>" + chapters[0].html;
    books.push({
      id: "col-" + it.id, title: it.title || "未命名视频", es: "📼 " + (it.title || "视频").slice(0, 10),
      desc: "个人收集 · B 站视频转录 · " + new Date(it.doneAt || it.at).toLocaleDateString() + " · " + chapters.length + " 节",
      intro: "由 openclaw + getnote 自动转录收录；每节对应一个分P。",
      at: it.doneAt || it.at, chapters, collected: true, note: "",
    });
  }
  /* 智能硬件图鉴（动态书：每品类一章，渲染时从 hw-devices.json 生成——每日情报 done 合并后自动更新，零迁移） */
  if (hwDevices.devices.length) {
    const byCat = new Map();
    for (const d of hwDevices.devices) {
      if (!byCat.has(d.cat)) byCat.set(d.cat, []);
      byCat.get(d.cat).push(d);
    }
    const cats = [...byCat.entries()].sort((a, b) => b[1].length - a[1].length);
    const chapters = cats.map(([cat, list], i) => ({
      id: "c" + i, title: cat + " · " + list.length + " 件", html: hwAtlasTable(list), text: "",
    }));
    const l1 = hwDevices.devices.filter(d => d.lens === 1 || d.lens === 3).length;
    const l2 = hwDevices.devices.filter(d => d.lens === 2 || d.lens === 3).length;
    chapters[0].html = '<p style="opacity:.72;font-size:12px;margin:0 0 14px">📔 每日情报自动沉淀 · 共 ' + hwDevices.devices.length + " 件 " + cats.length +
      " 类 · 透镜① " + l1 + " 件 · 透镜② " + l2 + " 件<br>① 让以往无法展现的数据可见 · ② 让以往无法收集的数据可持续收集</p>" + chapters[0].html;
    books.push({
      id: "hw-devices", title: "智能硬件图鉴", es: "📔 硬件图鉴",
      desc: "每日情报沉淀 · " + hwDevices.devices.length + " 件 · " + cats.length + " 品类 · 透镜①" + l1 + " ②" + l2,
      intro: "符合两个透镜的硬件累积目录：① 让以往无法展现的数据可见；② 让以往无法收集的数据可持续收集。由 openclaw 硬件情报站每日自动合并去重。",
      chapters, atlas: true, note: "",
    });
  }
  return books.concat(kbUploadBooks());
}
function kbUploadBooks() {
  return Object.values(kbUploads).sort((a, b) => b.at - a.at).map(u => {
    const es = (u.title || "文档").replace(/\.(md|pdf)$/i, "").slice(0, 10);
    if (u.type === "md") {
      let cached = kbUploadParsed[u.id];
      if (!cached) {
        const md = fs.readFileSync(path.join(KB_UPLOAD_DIR, u.file), "utf8");
        const parsed = kbSplitUploadBook(md);
        const chapters = parsed.chapters.length ? parsed.chapters
          : [{ id: "ch0", title: u.title.replace(/\.md$/i, ""), html: kbMdToHtml(md), text: "" }];
        if (u.pdfFile) chapters.push({ id: "pdf", title: "查看 PDF 原文",
          html: '<iframe src="/api/kb/file/' + u.pdfFile + '" style="width:100%;height:72vh;border:1px solid color-mix(in srgb,var(--ink) 14%,transparent);border-radius:12px;background:var(--g-bg-base)"></iframe>' +
            '<p style="margin-top:10px"><a href="/api/kb/file/' + u.pdfFile + '" target="_blank" rel="noopener">↗ 新窗口打开 / 下载 PDF</a></p>', text: "" });
        cached = kbUploadParsed[u.id] = { chapters, intro: parsed.intro };
      }
      return { id: "up-" + u.id, title: u.title.replace(/\.md$/i, ""), es, desc: "上传收录 · " + new Date(u.at).toLocaleDateString(),
        intro: cached.intro, at: u.at, chapters: cached.chapters, uploaded: true, note: u.note || "" };
    }
    const pdfDesc = u.state === "new" || u.state === "translating" ? "上传收录 · 转中英对照中…" : "上传收录 · PDF 原文";
    return { id: "up-" + u.id, title: u.title.replace(/\.pdf$/i, ""), es, desc: pdfDesc,
      intro: "PDF 原文内嵌查看（浏览器原生渲染）。",
      at: u.at, chapters: [{ id: "pdf", title: "查看 PDF 原文",
        html: '<iframe src="/api/kb/file/' + u.file + '" style="width:100%;height:72vh;border:1px solid color-mix(in srgb,var(--ink) 14%,transparent);border-radius:12px;background:var(--g-bg-base)"></iframe>' +
          '<p style="margin-top:10px"><a href="/api/kb/file/' + u.file + '" target="_blank" rel="noopener">↗ 新窗口打开 / 下载</a></p>',
        text: "" }], uploaded: true, note: u.note || "" };
  }).filter(b => b.chapters.length > 0);
}
/* 目录（不含正文）：藏书成百上千时 kb-data.js 也只有几十 KB；正文按需 /api/kb/chapter */
function kbCatalog() {
  return kbAllBooks().map(b => ({
    id: b.id, title: b.title, es: b.es, desc: b.desc, uploaded: !!b.uploaded, collected: !!b.collected, atlas: !!b.atlas, note: b.note || "",
    cat: kbCatOf(b), at: b.at || 0,
    chapters: b.chapters.map(c => ({ id: c.id, title: c.title })),
  }));
}
/* 原始二进制 body 读取（上传用；readBody 只吃 16KB JSON） */
function readRawBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > maxBytes) { reject(new Error("too large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

/* ---------------- 天气代理（Key 只存服务端：server-config.json / 环境变量，30 分钟缓存） ---------------- */
let weatherCache = { at: 0, body: null };
async function weatherProxy(res) {
  if (Date.now() - weatherCache.at < CFG.WEATHER_CACHE_MS && weatherCache.body) {
    return json(res, 200, weatherCache.body);
  }
  const qwKey = process.env.TALLER_QW_KEY || wbCfg.qwKey;
  if (!qwKey) return json(res, 200, { ok: false, error: "未配置天气 Key" });
  try {
    const url = `https://${CFG.QW_HOST}/v7/weather/now?location=${CFG.QW_LOCATION}&lang=zh`;
    const r = await fetch(url, {
      headers: { "X-QW-Api-Key": qwKey },
      signal: AbortSignal.timeout(CFG.WEATHER_TIMEOUT_MS),
    });
    const j = await r.json();
    if (j && j.code === "200" && j.now) {
      const body = { ok: true, data: {
        temp: j.now.temp, text: j.now.text, feelsLike: j.now.feelsLike,
        windDir: j.now.windDir, windScale: j.now.windScale, humidity: j.now.humidity,
      } };
      weatherCache = { at: Date.now(), body };
      return json(res, 200, body);
    }
    return json(res, 200, { ok: false, error: "weather api " + (j && j.code || "?") });
  } catch (e) {
    return json(res, 200, { ok: false, error: "weather unreachable" });
  }
}

/* ============================================================
   工作台（El Estudio · 仅 admin）——五路信息抓取 + 工作记录 +
   周总结/下周计划 + 内容评论（反馈 arXiv 选文）+ 一键收进日志
   配置: data/server-config.json（glmKey/biliCookie/biliUps/arxivProfile）
   数据: data/workbench-cache.json / workbench-log.json / workbench-weekly.json
         / workbench-comments.json / cuaderno-extra.json（运行时生成，部署不覆盖）
   抓取语义移植自 Mac 挂件：失败保留旧值、错误分级、各板块独立节奏
   ============================================================ */
const WB_FILE = {
  cfg:      path.join(DATA, "server-config.json"),
  cache:    path.join(DATA, "workbench-cache.json"),
  log:      path.join(DATA, "workbench-log.json"),
  weekly:   path.join(DATA, "workbench-weekly.json"),
  comments: path.join(DATA, "workbench-comments.json"),
  notes:    path.join(DATA, "cuaderno-extra.json"),
  memos:    path.join(DATA, "workbench-memos.json"),
  holidays: path.join(DATA, "holidays.json"),
  reader:   path.join(DATA, "workbench-reader.json"),   // 对照阅读的文章正文缓存（3 天无评论自动清除）
  biblio:   path.join(DATA, "biblioteca-articles.json"),// 评论过 → 收进 Biblioteca 的文章（永久）
  dislikes: path.join(DATA, "workbench-dislikes.json"), // 不感兴趣：强降权 + 永不进 Biblioteca
  hw:       path.join(DATA, "workbench-hw.json"),       // 智能硬件·每日情报（Mac 收集任务推送，留 7 天）
  xhs:      path.join(DATA, "xhs-fans.json"),           // 小红书粉丝监控（服务器侧抓取，日点留 120 天）
};
function loadJson(f, def) { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return def; } }
function saveJson(f, obj) { try { fs.writeFileSync(f, JSON.stringify(obj, null, 1), "utf8"); } catch {} }

const WB_DEFAULTS = {
  glmUrl: "https://open.bigmodel.cn/api/monitor/usage/quota/limit",
  arxivProfile:
    "- AI Agent 与个人 AI 助理：多智能体协作、工具调用、任务规划、长期记忆、电脑/桌面自动化(GUI agent、computer use)\n" +
    "- LLM 路由与决策：模型选择/级联路由、小模型做决策、成本与质量权衡、推理优化\n" +
    "- 医疗 AI 评测：临床分诊、辅助诊断、医疗大模型 benchmark 与评测方法\n" +
    "- LLM 评测与工作流：benchmark 设计、评测方法学、prompt 工程、RAG/检索增强",
  arxivKeys: ["agent", "agentic", "multi-agent", "LLM", "large language model", "language model",
    "tool use", "tool call", "function call", "MCP", "workflow", "planning", "memory",
    "router", "routing", "cascade", "model selection", "decision", "RAG", "retrieval",
    "prompt", "benchmark", "evaluation", "GUI agent", "computer use", "automation",
    "assistant", "reasoning", "medical", "clinical", "triage", "diagnosis", "health", "patient"],
  arxivNoise: ["autonomous driving", "self-driving", "robot", "point cloud", "segmentation",
    "video generation", "diffusion model", "speech", "audio", "remote sensing",
    "graph neural network", "federated", "hardware", "circuit", "optical", "quantum",
    "protein", "molecule", "weather", "satellite", "3D reconstruction", "SLAM", "drug discovery"],
  xhsAccount: "5ae9132b11be103284ad135c",                // 小红书粉丝监控的主页用户 ID（hex；小红书号如 kg12141706 在 URL 里 404，须先登录态搜索解析）
};
const wbCfg = Object.assign({}, WB_DEFAULTS, loadJson(WB_FILE.cfg, {}));
if (!Array.isArray(wbCfg.biliUps)) wbCfg.biliUps = [];

/* ---------------- 小红书粉丝监控（Mac 推送；2026-10-14 实测小红书只认真浏览器上下文，
   服务器/裸客户端带有效 Cookie 也一律 302→登录页，curl-impersonate 同样无效 → 与 hw 情报同架构） ----------------
   data/xhs-fans.json = { account, current:{ok,fans,nickname,redId,at}, days:[{date,fans}]（日点留 120 天） }
   Mac launchd「taller-小红书粉丝」每 2h 用登录态 Chrome 读主页 __INITIAL_STATE__
   （userInfo.interactions[type=fans].count，2026-10 字段；redId=小红书号）→ POST /api/workbench/xhs/done（xhsToken） */
let xhsStore = loadJson(WB_FILE.xhs, null);
if (!xhsStore || !Array.isArray(xhsStore.days)) xhsStore = { account: "", current: null, days: [] };
const xhsAccount = () => String(wbCfg.xhsAccount || "5ae9132b11be103284ad135c").replace(/[^\w-]/g, "") || "5ae9132b11be103284ad135c";
const xhsDateStr = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
function xhsApply(body) {
  const fans = Number(body.fans);
  if (!Number.isFinite(fans) || fans < 0 || fans > 1e9) return { ok: false, error: "fans 非法" };
  let date = String(body.date || "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = xhsDateStr(new Date());
  const today = xhsDateStr(new Date()), yesterday = xhsDateStr(new Date(Date.now() - 86400e3));
  if (date !== today && date !== yesterday) return { ok: false, error: "date 仅允许今/昨日" };
  const redId = String(body.redId || "").replace(/\s+/g, "").slice(0, 32);
  const nickname = String(body.nickname || "").replace(/\s+/g, " ").trim().slice(0, 40);
  const n = Math.round(fans);
  xhsStore.account = xhsAccount();
  xhsStore.current = { ok: true, fans: n, nickname, redId, at: Date.now() };
  const last = xhsStore.days[xhsStore.days.length - 1];
  if (last && last.date === date) last.fans = n;
  else xhsStore.days.push({ date, fans: n });
  xhsStore.days.sort((a, b) => (a.date < b.date ? -1 : 1));
  if (xhsStore.days.length > 120) xhsStore.days = xhsStore.days.slice(-120);
  saveJson(WB_FILE.xhs, xhsStore);
  console.log("[workbench] xhs 粉丝 " + n + "（" + (nickname || redId || xhsStore.account) + "）");
  return { ok: true };
}
function xhsSnapshot() {
  const days = xhsStore.days || [];
  const cur = xhsStore.current || null;
  const fans = cur ? cur.fans : null;
  let delta1 = null, delta7 = null;
  if (typeof fans === "number") {
    const d1 = days[days.length - 2];                                  /* 昨日点 */
    if (d1 && typeof d1.fans === "number") delta1 = fans - d1.fans;
    if (days.length >= 8) {                                            /* 满一整周才报 7 日涨跌，避免拿今天对比今天 */
      const d7 = days[days.length - 8];
      if (d7 && typeof d7.fans === "number") delta7 = fans - d7.fans;
    }
  }
  return {
    account: xhsStore.account || xhsAccount(), ok: !!(cur && cur.ok), fans,
    nickname: cur ? cur.nickname : null, redId: cur ? (cur.redId || "") : "", at: cur ? cur.at : null,
    days, delta1, delta7,
  };
}

/* ---------------- 智能硬件·每日情报（Mac openclaw「taller-硬件情报站」每日推送；服务器只存取，不抓外网） ----------------
   data/workbench-hw.json = { days:[{date,at,summary,links,prices,sources}], watch:[保值观察机型] }
   watch = 动态基线清单（done 可增量回写，去重、留最新 30 个）；days 保留 7 天 */
const HW_WATCH_SEED = ["雷鸟 Air3", "XREAL One", "Meta Ray-Ban Display", "Oura Ring 4", "Galaxy Ring",
  "魅族 StarV Ring2", "AirPods Pro 2", "Bose QC 消噪耳塞 Ultra", "Sony WH-1000XM6"];
let hwStore = loadJson(WB_FILE.hw, null);
if (!hwStore || !Array.isArray(hwStore.days)) hwStore = { days: [] };
if (!Array.isArray(hwStore.watch) || !hwStore.watch.length) hwStore.watch = HW_WATCH_SEED.slice();
const hwDateStr = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const hwToday = () => hwDateStr(new Date());
const hwYesterday = () => hwDateStr(new Date(Date.now() - 86400e3));
function hwPrune() {
  hwStore.days.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  if (hwStore.days.length > 7) hwStore.days = hwStore.days.slice(0, 7);
}
hwPrune();
const hwLatest = () => (hwStore.days.length ? hwStore.days[0] : null);
/* 长度/形状收敛（XSS 转义在前端 esc()；这里只保证字段短、URL 是 http(s)） */
function hwSanitize(body, date) {
  const str = (v, n) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, n);
  const entry = { date, at: Date.now(), summary: str(body.summary, 2000) };
  entry.links = (Array.isArray(body.links) ? body.links : []).slice(0, 60).map(l => ({
    t: str(l && l.t, 160), u: str(l && l.u, 500), s: str(l && l.s, 30), cat: str(l && l.cat, 16), n: str(l && l.n, 120),
    lens: [1, 2, 3].includes(l && l.lens) ? l.lens : 0,
  })).filter(l => l.t && /^https?:\/\//i.test(l.u));
  entry.prices = (Array.isArray(body.prices) ? body.prices : []).slice(0, 40).map(x => ({
    m: str(x && x.m, 60), p: str(x && x.p, 40), src: str(x && x.src, 30),
  })).filter(x => x.m && x.p);
  entry.sources = {};
  for (const [k, v] of Object.entries(body.sources || {})) entry.sources[str(k, 20)] = str(v, 60);
  return entry;
}

/* ---------------- 硬件图鉴（透镜硬件累积目录：done 按 name 合并去重，价轨留 12 条，上限 500 冷淘汰） ---------------- */
const HW_DEV_FILE = path.join(DATA, "hw-devices.json");
let hwDevices = loadJson(HW_DEV_FILE, null);
if (!hwDevices || !Array.isArray(hwDevices.devices)) hwDevices = { devices: [] };
function hwDevPrune() {
  hwDevices.devices.sort((a, b) => ((b.heat || 0) - (a.heat || 0)) || (a.lastSeen < b.lastSeen ? 1 : -1));
  if (hwDevices.devices.length > 500) hwDevices.devices = hwDevices.devices.slice(0, 500);
}
hwDevPrune();
function hwDevPrice(dev, date, p, src) {
  const last = dev.prices[dev.prices.length - 1];
  if (last && last.d === date) { last.p = p; if (src) last.src = src; }
  else { dev.prices.push({ d: date, p, src: src || "" }); if (dev.prices.length > 12) dev.prices = dev.prices.slice(-12); }
}
function hwMergeDevices(list, date, watchPrices) {
  const byName = new Map(hwDevices.devices.map(d => [String(d.name).toLowerCase(), d]));
  for (const raw of (Array.isArray(list) ? list.slice(0, 20) : [])) {
    const name = String((raw && raw.name) || "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (!name) continue;
    const cat = String((raw && raw.cat) || "").trim().slice(0, 16);
    const lens = [1, 2, 3].includes(raw && raw.lens) ? raw.lens : 0;
    let dev = byName.get(name.toLowerCase());
    if (dev) {
      dev.lastSeen = date;
      dev.heat = (dev.heat || 1) + 1;
      if (cat) dev.cat = cat;
      if (lens) dev.lens = lens;
      const c = String(raw.collects || "").trim().slice(0, 60); if (c) dev.collects = c;
      const s = String(raw.shows || "").trim().slice(0, 60); if (s) dev.shows = s;
      const st = String(raw.status || "").trim().slice(0, 12); if (st) dev.status = st;
      const u = String(raw.url || "").trim().slice(0, 500); if (/^https?:\/\//i.test(u)) dev.url = u;
      const w = String(raw.wear || "").trim(); if (HW_WEARS.includes(w)) dev.wear = w;
    } else {
      dev = { name, brand: String((raw && raw.brand) || "").trim().slice(0, 40), cat: cat || "未分类", lens,
        collects: String((raw && raw.collects) || "").trim().slice(0, 60), shows: String((raw && raw.shows) || "").trim().slice(0, 60),
        status: String((raw && raw.status) || "传闻").trim().slice(0, 12), firstSeen: date, lastSeen: date, heat: 1,
        url: /^https?:\/\//i.test(String((raw && raw.url) || "")) ? String(raw.url).trim().slice(0, 500) : "",
        src: String((raw && raw.src) || "").trim().slice(0, 30),
        wear: hwWearOf(String((raw && raw.wear) || "").trim()), prices: [] };
      byName.set(name.toLowerCase(), dev);
      hwDevices.devices.push(dev);
    }
    const p = String((raw && (raw.price || raw.p)) || "").trim().slice(0, 40);
    if (p) hwDevPrice(dev, date, p, String((raw && raw.priceSrc) || raw.src || "").trim().slice(0, 30));
  }
  /* 保值组价格样本自动挂到同名设备的价格轨迹 */
  for (const wp of (watchPrices || [])) {
    const m = String(wp.m || "").trim().toLowerCase();
    if (!m) continue;
    const dev = hwDevices.devices.find(d => d.name.toLowerCase().includes(m) || m.includes(d.name.toLowerCase()));
    if (dev) hwDevPrice(dev, date, String(wp.p || "").slice(0, 40), String(wp.src || "").slice(0, 30));
  }
  hwDevPrune();
}
/* 图鉴书章正文：品类内的设备表（kbMdToHtml 的 table 样式复用） */
function hwAtlasTable(list) {
  const tag = l => l === 3 ? "①②" : l === 1 ? "①" : l === 2 ? "②" : "";
  let h = "<table><thead><tr><th>设备</th><th>部位</th><th>透镜</th><th>采集 / 展现</th><th>状态</th><th>最新价</th><th>热度</th></tr></thead><tbody>";
  for (const d of list) {
    const cs = [d.collects, d.shows].filter(Boolean).join(" / ");
    const price = d.prices && d.prices.length ? d.prices[d.prices.length - 1].p : "";
    h += "<tr><td>" + (d.url ? '<a href="' + kbUploadEsc(d.url) + '" target="_blank" rel="noopener">' + kbUploadEsc(d.name) + "</a>" : kbUploadEsc(d.name)) +
      "</td><td>" + kbUploadEsc(d.wear || "其他") + "</td><td>" + tag(d.lens) + "</td><td>" + kbUploadEsc(cs || "—") + "</td><td>" + kbUploadEsc(d.status || "") +
      "</td><td>" + kbUploadEsc(price) + "</td><td>" + (d.heat || 1) + "</td></tr>";
  }
  return h + "</tbody></table>";
}
/* 佩戴/测量部位白名单：优先佩戴位置，无佩戴用核心测量数据所在的身体部位；环境/家居/宠物单列 */
const HW_WEARS = ["头部", "眼部", "耳部", "颈部", "胸口", "上臂", "手腕", "手指", "腰部", "腿脚", "环境家居", "宠物", "其他"];
const hwWearOf = w => HW_WEARS.includes(w) ? w : "其他";

const CHROME_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const md5 = s => crypto.createHash("md5").update(s, "utf8").digest("hex");
/* 返回捕获组数组 (g[0]=第1组)，无匹配返回 null */
function reFirst(text, re) { const m = re.exec(text); return m ? m.slice(1).map(g => g === undefined ? "" : g) : null; }
function reAll(text, re) {
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const out = []; let m;
  while ((m = rx.exec(text))) out.push(m.slice(1).map(g => g === undefined ? "" : g));
  return out;
}
function htmlDecode(s) {
  let r = String(s)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"")
    .replace(/&#x27;|&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ");
  return r.replace(/&#(\d+);/g, (all, d) => { const v = parseInt(d, 10); return v > 0 && v < 0x110000 ? String.fromCodePoint(v) : all; });
}
const cleanText = s => htmlDecode(String(s).replace(/\s+/g, " ")).trim();
async function httpGetText(url, timeoutMs, headers = {}) {
  const r = await fetch(url, {
    headers: Object.assign({ "User-Agent": CHROME_UA }, headers),
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return await r.text();
}

/* ---------------- GLM 对话（标题翻译 / arXiv 评分 / 周总结共用） ---------------- */
const AI_TERMS_EN = "agent/agents, multi-agent, LLM, MLLM, RAG, MCP, benchmark, prompt, token, workflow, planning, memory, reasoning, fine-tuning, Chain-of-Thought, Claude, GPT";
function keepEnglishTerms(s) {
  /* 兜底纠正：模型把 AI 术语翻成中文时换回英文（顺序敏感，长词在前） */
  return String(s).replace(/克劳德/g, "Claude").replace(/多智能体/g, "multi-agent")
    .replace(/智能体/g, "agent").replace(/代理系统/g, "agent系统")
    .replace(/代理人/g, "agent").replace(/代理/g, "agent")
    .replace(/令牌/g, "token")
    .replace(/(LLM|AI|MLLM|RAG|MCP)agent/g, "$1 agent");
}
async function glmChat(prompt, opts = {}) {
  if (!wbCfg.glmKey) throw new Error("未配置 GLM Key");
  const body = JSON.stringify({
    model: "glm-4-flash",
    temperature: opts.temperature != null ? opts.temperature : 0.2,
    ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}),
    messages: [{ role: "user", content: prompt }],
  });
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch("https://open.bigmodel.cn/api/paas/v4/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8", Authorization: "Bearer " + wbCfg.glmKey },
        body, signal: AbortSignal.timeout(opts.timeoutMs || 90000),
      });
      const j = await r.json();
      const content = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
      if (content) return content;
      lastErr = new Error("GLM 响应异常");
    } catch (e) { lastErr = e; }
    if (attempt === 0) await new Promise(rs => setTimeout(rs, 5000));
  }
  throw lastErr || new Error("GLM 请求失败");
}
async function glmTranslateLines(lines) {
  if (!lines.length) return [];
  if (!wbCfg.glmKey) return lines.map(() => "");
  const prompt = "Translate these research article titles from English to Chinese. " +
    "Keep product names like Claude and AI terms such as " + AI_TERMS_EN + " in English — never translate them into Chinese. " +
    "Output only the translations, one per line, keeping the same numbering.";
  const joined = lines.map((l, i) => (i + 1) + ". " + l).join("\n");
  const txt = await glmChat(prompt + "\n" + joined);
  const out = lines.map(() => "");
  for (const line of txt.split("\n")) {
    const m = /^\s*(\d+)[.、]\s*(.+)$/.exec(line.trim());
    if (m) { const i = parseInt(m[1], 10); if (i >= 1 && i <= lines.length) out[i - 1] = keepEnglishTerms(m[2].trim()); }
  }
  return out;
}

/* ---------------- Biblioteca 页边问读（gloss 式）：整章分段 + GLM 作答 ---------------- */
/* 章节正文按块（p/h/li/blockquote/pre/tr…）切成带 [¶n] 锚的纯文本段，供模型引用 */
function kbChapterParas(c) {
  let s = "";
  const html = String(c.html || "");
  if (html) {
    s = html.replace(/<\/(?:p|div|h[1-6]|li|blockquote|pre|tr|table|ul|ol)\s*>/gi, "\n\n").replace(/<br\s*\/?>/gi, "\n");
  } else s = String(c.text || "");
  const text = s.replace(/<[^>]+>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"');
  return text.split(/\n+/).map(x => x.replace(/\s+/g, " ").trim()).filter(x => x.length > 1).slice(0, 300);
}
async function kbAskAnswer(book, ci, c, quote, question) {
  const paras = kbChapterParas(c);
  let full = paras.map((t, i) => "[¶" + (i + 1) + "] " + t).join("\n");
  if (full.length > 16000) full = full.slice(0, 16000) + "\n……（后文过长已省略）";
  const prompt =
    "你是「El Taller」书库的页边答疑助手。下面是《" + book.title + "》第 " + (ci + 1) + " 章「" + c.title + "」的全文，段落已用 [¶n] 标号：\n\n" + full +
    "\n\n————\n读者在文中选中了这段文字：\n「" + quote + "」\n\n读者的问题：" + question +
    "\n\n请结合全章内容回答：中文，不超过 200 字，直接给答案不要客套；引用原文时标注段落号（如 [¶3]）；术语保留英文。";
  return (await glmChat(prompt, { temperature: 0.3, timeoutMs: 60000 })).trim().slice(0, 800);
}
function extractJSON(s) {
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; }
}
function jsonScore(it, key) {
  const v = it && it[key];
  if (typeof v === "number") return v;
  if (typeof v === "string") { const f = parseFloat(v); return isNaN(f) ? 0 : f; }
  return 0;
}
function jsonInt(v) {
  if (typeof v === "number") return Math.round(v);
  if (typeof v === "string") { const i = parseInt(v.trim(), 10); return isNaN(i) ? null : i; }
  return null;
}

/* ---------------- 抓取器 · GLM 额度 ---------------- */
async function wbFetchGLM() {
  if (!wbCfg.glmKey) return { ok: false, error: "未配置 API Key" };
  const r = await fetch(wbCfg.glmUrl, {
    headers: { Authorization: wbCfg.glmKey },
    signal: AbortSignal.timeout(15000),
  });
  const j = await r.json();
  const data = j && j.data, limits = data && data.limits;
  if (!Array.isArray(limits) || !limits.length) return { ok: false, error: "接口返回异常" };
  const d = {
    ok: true, at: Date.now(),
    level: (data.level || "Pro").toString(),
    limits: limits.map(l => ({
      unit: l.unit, usage: l.usage != null ? l.usage : null, remaining: l.remaining != null ? l.remaining : null,
      currentValue: l.currentValue != null ? l.currentValue : null, pct: l.percentage != null ? l.percentage : null,
      reset: l.nextResetTime != null ? l.nextResetTime : null,
    })),
  };
  /* 用量历史（走势图数据）：值变了或距上个点超 1 小时才记，上限 400 点 ≈ 稳态 33 小时 */
  const five = d.limits.find(l => l.unit === 3) || d.limits[0];
  const week = d.limits.find(l => l.unit === 6) || d.limits[1] || d.limits[0];
  const hist = (wbCache.glm && wbCache.glm.history) || [];
  const last = hist[hist.length - 1];
  const now = Date.now();
  if (!last || last.u5 !== five.currentValue || last.uW !== week.currentValue || now - last.t > 3600e3) {
    hist.push({ t: now, u5: five.currentValue || 0, uW: week.currentValue || 0 });
  }
  while (hist.length > 400) hist.shift();
  d.history = hist;
  d.hit = (wbCache.glm && wbCache.glm.hit) || null;   // Mac 上报的缓存命中率（跨抓取保留）
  return d;
}

/* ---------------- 抓取器 · 上海油价（金投网，窗口过期 2h 重查） ---------------- */
function oilUpcoming(month, day) {
  if (!(month >= 1 && month <= 12 && day >= 1 && day <= 31)) return false;
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let d = new Date(now.getFullYear(), month - 1, day);
  if (d >= today) return true;
  d = new Date(now.getFullYear() + 1, month - 1, day);
  return d >= today;
}
/* 调价窗口 [月,日] → "YYYY-MM-DD"（北京墙钟推断年份：今年已过即明年；调价窗口 ~10 个工作日一开，跨年仅 Dec→Jan 一种） */
function oilAdjISO(month, day) {
  const w = bjWall(Date.now());
  let y = w.y;
  if (month < w.m || (month === w.m && day < w.d)) y += 1;
  return y + "-" + String(month).padStart(2, "0") + "-" + String(day).padStart(2, "0");
}
function oilForecast(dirn, amt, range) {
  if (!dirn) return "";
  let f = "预计" + (dirn === "上调" ? "涨" : dirn === "下调" ? "跌" : "搁浅");
  if (range && ((dirn === "上调" && range[0] === "上涨") || (dirn === "下调" && range[0] === "下跌"))) {
    f += range[1] + "~" + range[2] + "元/升";
  } else {
    const a = parseFloat(amt);
    if (a > 0) f += String(Math.round(a / 1350 * 100) / 100) + "元/升";
  }
  return f;
}
/* 主表按表头对齐取四标号：免疫单元格渲染差异导致的列错位（89# 格偶发非纯数字会让连续正则从 92# 列吃起） */
function parseOilTable(html) {
  const ti = html.indexOf("hq_table1");
  if (ti < 0) return null;
  const tbl = html.slice(ti, ti + 1600);
  const heads = [...tbl.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map(m => cleanText(m[1]));
  const datas = [...tbl.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(m => cleanText(m[1]));
  if (heads.length < 4 || datas.length < 4) return null;
  const by = {};
  for (const k of ["89", "92", "95", "0"]) {
    const i = heads.findIndex(h => h.replace("#", "").replace("汽油", "").replace("柴油", "").startsWith(k));
    const v = i >= 0 && i < datas.length && /^\d+(\.\d+)?$/.test(datas[i]) ? datas[i] : null;
    by[k] = v;
  }
  return by;
}
async function wbFetchOil() {
  const html = await httpGetText("https://www.cngold.org/crude/shanghai.html", 12000);
  const grades = parseOilTable(html);
  if (!grades || !grades["95"]) return { ok: false, error: "取价失败" };
  const info = {
    ok: true, at: Date.now(), price: grades["95"],   // 95# 为主价（与 Mac 挂件一致）
    prices: ["89", "92", "95", "0"].filter(k => grades[k])
      .map(k => ({ g: k + "#", v: grades[k] })),
    note: "", next: "", expired: false, hist: [],
  };
  const dd = reFirst(html, /class="data">\s*(\d{4}-\d{2}-\d{2})/);
  if (dd) info.note += dd[0].slice(5) + "起";
  /* 调价历史表：每行 = 生效日期 + 四个标号价，取 95#（第3列）攒走势 */
  const rows = reAll(html, /<td class="data">\s*(\d{4}-\d{2}-\d{2})\s*<\/td>([\s\S]*?)<\/tr>/);
  if (rows.length >= 2) {
    const nums = reAll(rows[1][1], /class="nums">\s*([\d.]+)/);
    if (nums.length >= 3) {
      const prev = parseFloat(nums[2][0]), cur = parseFloat(info.price);
      if (!isNaN(prev) && !isNaN(cur)) {
        const diff = Math.round(cur * 100) / 100 - prev;
        info.note += " · 上期" + nums[2][0] + "(" + (diff >= 0 ? "+" : "") + diff.toFixed(2) + ")";
      }
    }
    for (let i = 0; i < rows.length && info.hist.length < 12; i++) {
      const hnums = reAll(rows[i][1], /class="nums">\s*([\d.]+)/);
      if (hnums.length >= 3) info.hist.push({ date: rows[i][0], price: hnums[2][0] });
    }
  }
  /* 下次调价窗口 + 预估：独立降级，失败只影响这一行 */
  try {
    const h2 = await httpGetText("https://energy.cngold.org/", 12000);
    let dirn = "", amt = "", win2 = "", range = null;
    const mm = reFirst(h2, /今日\(?\d{1,2}月\d{1,2}日\)?油价预计(上调|下调|搁浅)(\d+)?(?:元\/吨)?/);   // 页面文案日期带不带括号都吃；搁浅可能不带单位
    if (mm) { dirn = mm[0]; amt = mm[1] || ""; }
    const ma = reFirst(h2, /<a href="([^"]+)"[^>]*title="油价调整最新消息/);
    if (ma && /^https?:\/\//.test(ma[0])) {
      try {
        const art = await httpGetText(ma[0], 12000);
        const md = reFirst(art, /<meta name="description" content="([^"]+)"/);
        if (md) {
          const rg = reFirst(md[0], /(上涨|下跌)([\d.]+)元(?:\/升)?-([\d.]+)元\/升/);
          if (rg) range = rg;
          const mw = reFirst(md[0], /将于(\d{1,2}月\d{1,2}日24时)/);
          if (mw) win2 = mw[0];
        }
        if (!win2) {
          for (const w of reAll(art, /(\d{1,2})月(\d{1,2})日24时/)) {
            if (oilUpcoming(parseInt(w[0], 10), parseInt(w[1], 10))) { win2 = w[0] + "月" + w[1] + "日24时"; break; }
          }
        }
      } catch {}
    }
    let win = null;
    if (win2) {
      const wm = reFirst(win2, /(\d{1,2})月(\d{1,2}日)/);
      if (wm) win = [parseInt(wm[0], 10), parseInt(wm[1], 10)];
      if (win && oilUpcoming(win[0], win[1])) {
        info.next = "下次调价 " + win2;
        info.adj = oilAdjISO(win[0], win[1]);   // 结构化调价日落盘：调度按 [adj-1, adj+1] 三天窗口走
      } else info.expired = true;   // 网站数据滞后，窗口已过
    }
    const ftxt = oilForecast(dirn, amt, range);
    if (ftxt) info.next += (info.next ? " · " : "") + ftxt;
  } catch {}
  const prevOil = wbCache.oil;
  if (!info.next && !info.expired) {
    if (prevOil && prevOil.next && !prevOil.expired) info.next = prevOil.next;   // 旧窗口未过期则保留
  }
  if (!info.adj && prevOil && prevOil.adj) info.adj = prevOil.adj;   // 本次没解析出新窗口 → 沿用旧 adj（调价节奏不变）
  return info;
}

/* ---------------- 抓取器 · B站关注（wbi 签名 + Cookie，逐 UP 保留旧值） ---------------- */
const WBI_TAB = [46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52];
let wbiCache = { key: "", exp: 0 };
function biliHeaders() {
  const h = { Referer: "https://space.bilibili.com/", Origin: "https://www.bilibili.com" };
  if (wbCfg.biliCookie) h.Cookie = wbCfg.biliCookie;
  return h;
}
async function biliWbiKey() {
  if (wbiCache.key && Date.now() < wbiCache.exp) return wbiCache.key;
  const txt = await httpGetText("https://api.bilibili.com/x/web-interface/nav", 12000, biliHeaders());
  let j = null; try { j = JSON.parse(txt); } catch {}
  const img = j && j.data && j.data.wbi_img && j.data.wbi_img.img_url || "";
  const sub = j && j.data && j.data.wbi_img && j.data.wbi_img.sub_url || "";
  if (!img || !sub) { const e = new Error("风控拦截·需有效Cookie"); e.risky = true; throw e; }
  const raw = img.split("/").pop().split(".")[0] + sub.split("/").pop().split(".")[0];
  const key = WBI_TAB.slice(0, 32).map(i => raw[i] || "").join("");
  wbiCache = { key, exp: Date.now() + 24 * 3600e3 };
  return key;
}
function wbiSign(params, key) {
  const p = Object.assign({}, params, { wts: String(Math.floor(Date.now() / 1000)) });
  const q = Object.keys(p).sort().map(k => {
    const v = String(p[k]).replace(/['()*]/g, "");
    return k + "=" + encodeURIComponent(v).replace(/[!'()*]/g, c => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  }).join("&");
  p.w_rid = md5(q + key);
  return p;
}
async function wbFetchBiliOne(up) {
  const key = await biliWbiKey();
  const p = wbiSign({ mid: up.uid, ps: "1", tid: "0", pn: "1", keyword: "",
    order: "pubdate", platform: "web", web_location: "1551101", order_avoided: "true" }, key);
  const qs = new URLSearchParams(p).toString();
  const txt = await httpGetText("https://api.bilibili.com/x/space/wbi/arc/search?" + qs, 15000, biliHeaders());
  let j = null; try { j = JSON.parse(txt); } catch {}
  const code = j && j.code;
  if (code === -352 || code === -412) { const e = new Error("风控拦截·需有效Cookie"); e.risky = true; throw e; }
  if (code === -101) { const e = new Error("登录失效·请更新Cookie"); e.risky = true; throw e; }
  if (code !== 0 || !j.data || !j.data.list || !Array.isArray(j.data.list.vlist)) { const e = new Error("拉取为空"); throw e; }
  const v = j.data.list.vlist[0];
  if (!v || !v.bvid) { const e = new Error("拉取为空"); throw e; }
  return { uid: String(up.uid), name: up.name || String(up.uid), bv: v.bvid,
    title: v.title || "（无标题）", created: Number(v.created) || 0, at: Date.now() };
}
async function wbFetchBiliAll() {
  if (!wbCfg.biliUps.length) return { ok: true, at: Date.now(), items: [], error: "未配置 UP" };
  const items = [], fails = [];
  for (const up of wbCfg.biliUps) {
    try {
      items.push(await wbFetchBiliOne(up));
    } catch (e) {
      fails.push({ up, msg: e.message, risky: !!e.risky });
      if (e.risky) wbiCache = { key: "", exp: 0 };
      const old = ((wbCache.bili && wbCache.bili.items) || []).find(x => x.uid === String(up.uid));
      if (old) items.push(old);   // 失败的 UP 保留旧值
    }
  }
  return {
    ok: fails.length === 0 || items.length > 0, at: Date.now(), items,
    error: fails.map(f => (f.up.name || f.up.uid) + ":" + f.msg).join(" "),
    risky: fails.length > 0 && fails.every(f => f.risky) && items.length === 0,
  };
}

/* ---------------- 抓取器 · Anthropic 研究（境外源，腾讯云直连尽力而为） ---------------- */
function parseEnDate(s) {
  const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
  const m = /([A-Z][a-z]{2})\s+(\d{1,2}),\s*(\d{4})/.exec(String(s).trim());
  if (!m || MONTHS[m[1]] === undefined) return null;
  return new Date(Date.UTC(parseInt(m[3], 10), MONTHS[m[1]], parseInt(m[2], 10)));
}
async function wbFetchAnth() {
  const html = await httpGetText("https://www.anthropic.com/research", 20000);
  const items = [], seen = new Set();
  let m;
  /* 2026-10 改版：列表页去掉了 <li><time> 结构，文章数据藏进内嵌 Next.js flight JSON（一层反斜杠转义），
     字段顺序 href→title→span→date；HeroCarousel 轮播条目兜底补充 */
  const reArt = /\\"href\\":\\"(\/research\/(?!team)[^\\]+)\\",\\"title\\":\\"([^\\]+)\\",\\"span\\":\d+,\\"date\\":\\"([^\\]+)\\"/g;
  while ((m = reArt.exec(html))) {
    const href = "https://www.anthropic.com" + m[1];
    if (seen.has(href)) continue;
    const dt = parseEnDate(m[3]);
    if (!dt) continue;
    seen.add(href);
    items.push({ url: href, ts: dt.getTime(), title: cleanText(m[2]), cat: "" });
  }
  const reHero = /<p><a class="[^"]*TopicLink[^"]*"[^>]*>([^<]*)<\/a><\/p><time class="[^"]*carousel-info-date">([^<]+)<\/time><\/header><a class="[^"]*carousel-info-link"[^>]*href="(\/research\/[^"]+)"[^>]*>\s*<h2[^>]*>([^<]+)<\/h2>/g;
  while ((m = reHero.exec(html))) {
    const href = "https://www.anthropic.com" + m[3];
    if (seen.has(href)) continue;
    const dt = parseEnDate(m[2]);
    if (!dt) continue;
    seen.add(href);
    items.push({ url: href, ts: dt.getTime(), title: cleanText(m[4]), cat: cleanText(m[1]) });
  }
  if (!items.length) return { ok: false, error: "抓取失败" };
  items.sort((a, b) => b.ts - a.ts);
  const latest = items.slice(0, 3);
  const zhMap = {};
  for (const it of ((wbCache.anth && wbCache.anth.items) || [])) zhMap[it.url] = it.zh;
  const need = latest.filter(it => !zhMap[it.url]);
  let zhs = [];
  try { zhs = await glmTranslateLines(need.map(it => it.title)); } catch {}
  need.forEach((it, i) => { if (zhs[i]) zhMap[it.url] = zhs[i]; });
  return {
    ok: true, at: Date.now(),
    items: latest.map(it => ({ url: it.url, zh: zhMap[it.url] || it.title, pub: new Date(it.ts).toISOString().slice(0, 10), cat: it.cat })),
  };
}

/* ---------------- 抓取器 · GitHub Trending 日榜（官方无 API，HTML 解析；GLM 逐仓解读「是什么/能干什么」；对比昨日标新上榜） ---------------- */
async function wbFetchGithub() {
  const html = await httpGetText("https://github.com/trending?since=daily", 25000);
  const num = s => parseInt(String(s || "").replace(/,/g, ""), 10) || 0;
  const items = [];
  const seen = new Set();
  let m;
  const reRow = /<article class="Box-row">([\s\S]*?)<\/article>/g;
  while ((m = reRow.exec(html)) && items.length < 10) {
    const row = m[1];
    const hm = /<h2[^>]*>[\s\S]*?href="\/([\w.-]+\/[\w.-]+)"/.exec(row);
    if (!hm || seen.has(hm[1].toLowerCase())) continue;
    seen.add(hm[1].toLowerCase());
    const dm = /<p class="[^"]*color-fg-muted[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(row);
    const lm = /itemprop="programmingLanguage"[^>]*>([^<]+)</.exec(row);
    const sm = /href="\/[\w.-]+\/[\w.-]+\/stargazers"[^>]*>([\s\S]*?)<\/a>/.exec(row);
    const tm = /([\d,]+)\s+stars?\s+today/.exec(row);
    items.push({
      url: "https://github.com/" + hm[1],
      repo: hm[1],
      desc: dm ? cleanText(dm[1].replace(/<[^>]+>/g, " ")).slice(0, 200) : "",
      lang: lm ? cleanText(lm[1]) : "",
      stars: sm ? num(sm[1].replace(/<[^>]+>/g, " ").trim()) : 0,
      today: tm ? num(tm[1]) : 0,
    });
  }
  if (!items.length) return { ok: false, error: "榜单解析失败（GitHub 改版？）" };
  /* 与昨日榜对比：新进榜的标 fresh；解读按仓库名复用（连任不重翻；旧值若是对输入的复述则视为无效重翻） */
  const prev = ((wbCache.github && wbCache.github.items) || []);
  const prevSet = new Set(prev.map(it => String(it.repo).toLowerCase()));
  const zhMap = {};
  const isEcho = (repo, zh) => !zh || !/[\u4e00-\u9fff]/.test(zh) || String(zh).startsWith(repo);
  prev.forEach(it => { if (it.zh && !isEcho(it.repo, it.zh)) zhMap[it.repo] = it.zh; });
  const need = items.filter(it => !zhMap[it.repo]);
  if (need.length && wbCfg.glmKey) {
    try {
      const out = await glmChat(
        "下面是 GitHub 今日趋势榜的仓库清单。为每个仓库写一句不超过 60 字的中文解读，必须覆盖两点：它是什么、能用来干什么；术语和产品名保留英文。\n" +
        "示例——输入「3. vercel/next.js（TypeScript）The React Framework」输出「3. React 全栈框架，用于构建服务端渲染与静态站点，前端工程主流选择」。\n" +
        "要求：每行输出以编号开头，编号后直接是中文解读（以汉字开头，禁止复述仓库名/语言/英文描述）。按编号顺序，不要其他文字：\n" +
        need.map((it, i) => (i + 1) + ". " + it.repo + "（" + (it.lang || "语言未知") + "）" + (it.desc || "无描述")).join("\n"),
        { temperature: 0.3, maxTokens: 2000 });
      for (const line of String(out).split("\n")) {
        const g = /^\s*(\d+)[.、)]?\s*(.+)$/.exec(line.trim());
        if (g) {
          const i = parseInt(g[1], 10);
          if (i >= 1 && i <= need.length && !isEcho(need[i - 1].repo, g[2].trim())) zhMap[need[i - 1].repo] = g[2].trim().slice(0, 120);
        }
      }
    } catch {}
    /* 批量丢条/回显兜底：单条纯文本协议（输出取首个汉字起，剥掉可能的回显前缀） */
    for (const it of need.filter(it => !zhMap[it.repo]).slice(0, 10)) {
      try {
        const one = await glmChat("用不超过 60 字中文解读这个 GitHub 项目，说清它是什么、能用来干什么。输出直接以汉字开头，不要复述项目名和英文描述，只输出解读：\n" + it.repo + " —— " + (it.desc || "无描述"));
        const zhm = /[\u4e00-\u9fff][\s\S]*/.exec(String(one));
        if (zhm) zhMap[it.repo] = zhm[0].trim().slice(0, 120);
      } catch {}
    }
  }
  return {
    ok: true, at: Date.now(),
    items: items.map(it => ({ url: it.url, repo: it.repo, desc: it.desc, lang: it.lang, stars: it.stars, today: it.today,
      zh: zhMap[it.repo] || "", fresh: !prevSet.has(String(it.repo).toLowerCase()) })),
  };
}

/* ---------------- 抓取器 · arXiv 精选（五段漏斗 300→40→12→8→6，评论反馈进 prompt） ---------------- */
function arxivPrefilter(papers, topN) {
  const keys = wbCfg.arxivKeys.map(k => k.toLowerCase());
  const noise = wbCfg.arxivNoise.map(k => k.toLowerCase());
  for (const p of papers) {
    p.score = 0;
    const t = p.title.toLowerCase(), a = p.abs.toLowerCase();
    for (const k of keys) { if (t.includes(k)) p.score += 2; if (a.includes(k)) p.score += 1; }
    for (const k of noise) if (t.includes(k) || a.includes(k)) p.score -= 1.5;
  }
  return papers.slice().sort((a, b) => b.score - a.score).slice(0, topN);
}
function arxivFeedback() {
  const cut = Date.now() - 14 * 86400e3;
  const dis = Object.values(wbDislikes).filter(d => d.source === "arxiv" && d.at >= cut);
  let out = "";
  if (dis.length) {
    out += "用户明确标记「不感兴趣」的论文（同类主题一律强降权，尽量不要再推荐相近方向）：\n" +
      dis.map(d => "-「" + String(d.title || "").slice(0, 60) + "」").join("\n") + "\n\n";
  }
  const list = Object.values(wbComments).filter(c => c.source === "arxiv" && c.createdAt >= cut && c.text);
  if (!list.length) return out;
  return out + "用户近期阅读反馈（打分与推荐时酌情参考：用户明确喜欢的方向可加权，被批评同质或无用的方向降权）：\n" +
    list.map(c => "-「" + String(c.title || "").slice(0, 50) + "」：" + String(c.text).slice(0, 120)).join("\n") + "\n\n";
}
async function wbFetchArxiv() {
  const pad2 = n => String(n).padStart(2, "0");
  const dFmt = d => d.getUTCFullYear() + pad2(d.getUTCMonth() + 1) + pad2(d.getUTCDate()) + pad2(d.getUTCHours()) + pad2(d.getUTCMinutes());
  const from = dFmt(new Date(Date.now() - 3 * 86400e3));
  const to = dFmt(new Date(Date.now() + 60e3));
  const apiUrl = "https://export.arxiv.org/api/query?search_query=" +
    encodeURIComponent("(cat:cs.AI OR cat:cs.CL OR cat:cs.LG) AND submittedDate:[" + from + " TO " + to + "]") +
    "&sortBy=submittedDate&sortOrder=descending&max_results=300";
  /* arXiv API 间歇性抽风：失败隔 20s 再试一次，连败两次才放弃 */
  let xml = null;
  for (let tries = 1; tries >= 0; tries--) {
    try { xml = await httpGetText(apiUrl, 120000); break; }
    catch (e) {
      if (tries > 0) { await new Promise(rs => setTimeout(rs, 20000)); continue; }
      return { ok: false, error: "抓取失败" };
    }
  }
  const recent = new Set(((wbCache.arxiv && wbCache.arxiv.items) || []).map(x => x.url));
  const cutoff = Date.now() - 3 * 86400e3;
  const papers = [], seen = new Set();
  let em;
  const entryRe = /<entry>([\s\S]*?)<\/entry>/g;
  while ((em = entryRe.exec(xml))) {
    const en = em[1];
    const idm = reFirst(en, /<id>(.*?)<\/id>/);
    const tm = reFirst(en, /<title>([\s\S]*?)<\/title>/);
    const sm = reFirst(en, /<summary>([\s\S]*?)<\/summary>/);
    const pm = reFirst(en, /<published>(.*?)<\/published>/);
    if (!idm || !tm || !sm || !pm) continue;
    const dt = Date.parse(pm[0].trim());
    if (isNaN(dt) || dt < cutoff) continue;
    let url = idm[0].replace(/v\d+$/, "");
    if (url.startsWith("http://")) url = "https://" + url.slice(7);
    if (seen.has(url) || recent.has(url)) continue;
    seen.add(url);
    papers.push({ url, title: cleanText(tm[0]), abs: cleanText(sm[0]).slice(0, 1500),
      pub: new Date(dt).toISOString().slice(0, 10), score: 0, coarse: 0, comment: "" });
  }
  if (papers.length < 10) return { ok: false, error: "解析仅" + papers.length + "篇" };

  /* 段2 本地预筛 top40 */
  const cand = arxivPrefilter(papers, 40);
  const fb = arxivFeedback();
  const profile = wbCfg.arxivProfile;

  /* 段3 GLM 粗评 40→12 */
  const p3 = "你是论文筛选助手。用户兴趣画像:\n" + profile + "\n\n" + fb +
    "以下是 " + cand.length + " 篇 arXiv 论文,每篇格式「编号|标题|摘要截断」。请对每篇按与画像的相关性打 0~10 分。\n" +
    "只输出 JSON: {\"r\":[{\"i\":编号,\"s\":分数},...]},必须覆盖全部 " + cand.length + " 篇。\n\n" +
    cand.map((p, i) => (i + 1) + "|" + p.title + "|" + p.abs.slice(0, 250)).join("\n");
  const r3 = extractJSON(await glmChat(p3));
  const s3 = new Map();
  for (const it of (r3 && r3.r) || []) { const i = jsonInt(it && it.i); if (i) s3.set(i, jsonScore(it, "s")); }
  const cands = cand.map((p, i) => Object.assign({}, p, { coarse: s3.get(i + 1) || 0 }))
    .filter(p => p.coarse > 0).sort((a, b) => b.coarse - a.coarse);
  const deep = cands.slice(0, 12);
  if (deep.length < 5) return { ok: false, error: "粗评有效不足" };

  /* 段4 GLM 精评 12→8 */
  const p4 = "用户兴趣画像:\n" + profile + "\n\n" + fb +
    "以下是 " + deep.length + " 篇候选论文(编号|标题|摘要)。请结合画像深评: ①对用户项目的直接可用性 ②方法新颖度。每篇写 2~3 句中文评语并打 0~10 总分。\n" +
    "只输出 JSON: {\"r\":[{\"i\":编号,\"score\":总分,\"comment\":\"中文评语\"},...]}\n\n" +
    deep.map((p, i) => (i + 1) + "|" + p.title + "|" + p.abs).join("\n");
  const r4 = extractJSON(await glmChat(p4));
  const s4 = new Map();
  for (const it of (r4 && r4.r) || []) {
    const i = jsonInt(it && it.i);
    if (i) s4.set(i, { score: jsonScore(it, "score"), comment: (it && it.comment) || "" });
  }
  const shorts = deep.map((p, i) => {
    const v = s4.get(i + 1);
    return v ? Object.assign({}, p, { coarse: v.score, comment: v.comment }) : null;
  }).filter(Boolean).sort((a, b) => b.coarse - a.coarse);
  const final8 = shorts.slice(0, 8);
  if (final8.length < 4) return { ok: false, error: "精评有效不足" };

  /* 段5 GLM 终选 8→6（多样性权衡 + 中文标题/理由） */
  const p5 = "用户兴趣画像:\n" + profile + "\n\n" + fb +
    "以下 " + final8.length + " 篇论文已通过深评(编号|标题|摘要截断|评语)。请选出最有价值的 6 篇定稿: 兼顾价值与多样性(避免同质,如全是 agent 框架则换角度)。\n" +
    "为每篇输出两个字段: \"zh\" 是把原标题翻译成的简体中文标题, 但 AI 专有名词必须保留英文原文(" + AI_TERMS_EN + " 等, 不得译成 代理/智能体/基准/提示 等), \"why\" 是一句话中文推荐理由(不超过40字,点明对用户的具体价值)。\n" +
    "只输出 JSON: {\"r\":[{\"i\":编号,\"zh\":\"中文标题\",\"why\":\"一句话理由\"},...]},恰好 6 个元素。\n\n" +
    final8.map((p, i) => (i + 1) + "|" + p.title + "|" + p.abs.slice(0, 500) + "|" + p.comment).join("\n");
  const r5 = extractJSON(await glmChat(p5));
  const picked = [];
  for (const it of (r5 && r5.r) || []) {
    const i = jsonInt(it && it.i), zh = it && it.zh;
    if (i >= 1 && i <= final8.length && zh) picked.push({ p: final8[i - 1], zh, why: (it && it.why) || final8[i - 1].comment });
  }
  if (picked.length < 4) return { ok: false, error: "终选有效不足" };
  let zhs = [];
  try { zhs = await glmTranslateLines(picked.map(x => x.p.title)); } catch {}
  return {
    ok: true, at: Date.now(),
    items: picked.map((x, i) => ({ url: x.p.url, zh: keepEnglishTerms(zhs[i] || x.zh), why: x.why, pub: x.p.pub })),
  };
}

/* ---------------- 抓取器 · F1 赛程（Jolpica = Ergast 官方继任者，正赛+冲刺赛；开赛时间换算为北京时间） ---------------- */
const BJ_OFFSET_MS = 8 * 3600e3;
/* API 时间是 UTC（"07:00:00Z"）→ 北京日期 + HH:MM（跨日自动进位，如拉斯维加斯站凌晨场） */
function f1Beijing(dateUtc, timeUtc) {
  if (!dateUtc || !/^\d{2}:\d{2}:\d{2}Z?$/.test(timeUtc || "")) return null;
  const d = new Date(dateUtc + "T" + timeUtc.replace(/Z?$/, "Z"));
  if (isNaN(d)) return null;
  const iso = new Date(d.getTime() + BJ_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), hm: iso.slice(11, 16) };
}
/* 各节次 → 短码/中文标签（正赛 R 在 date/time 上，其余在此枚举） */
const F1_SESSIONS = [
  ["FirstPractice", "P1", "一练"],
  ["SecondPractice", "P2", "二练"],
  ["ThirdPractice", "P3", "三练"],
  ["SprintQualifying", "SQ", "冲刺排位"],
  ["Sprint", "S", "冲刺赛"],
  ["Qualifying", "Q", "排位赛"],
];
async function wbFetchF1() {
  const txt = await httpGetText("https://api.jolpi.ca/ergast/f1/current.json", 30000);
  let j = null; try { j = JSON.parse(txt); } catch {}
  const races = j && j.MRData && j.MRData.RaceTable && j.MRData.RaceTable.Races;
  if (!Array.isArray(races) || !races.length) return { ok: false, error: "赛程为空" };
  return {
    ok: true, at: Date.now(),
    races: races.filter(r => r.date).map(r => {
      const sessions = [];
      for (const [key, k, label] of F1_SESSIONS) {
        const s = r[key] && f1Beijing(r[key].date, r[key].time);
        if (s) sessions.push({ k, label, date: s.date, hm: s.hm });
      }
      const race = f1Beijing(r.date, r.time);
      if (race) sessions.push({ k: "R", label: "正赛", date: race.date, hm: race.hm });
      sessions.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.hm < b.hm ? -1 : 1));
      const sp = sessions.find(s => s.k === "S") || {};
      return {
        round: r.round, raceName: r.raceName,
        date: race ? race.date : r.date,                 // 正赛（北京日期，兼容旧消费方）
        time: race ? race.hm : null,
        sprint: sp.date || null, sprintTime: sp.hm || null,
        locality: (r.Circuit && r.Circuit.Location && r.Circuit.Location.locality) || "",
        sessions,                                        // 全节次：P1/P2/P3/SQ/S/Q/R（含北京日期+时刻）
      };
    }),
  };
}

/* ---------------- 调度（定点每日 + 条件触发，失败分级重试，缓存落盘回放） ----------------
   2026-10-14 起部分板块从「固定间隔」改为「北京墙钟定点/条件窗口」：
   bili 每天 11:00；anth/arxiv 每天 05:00；oil 只在调价日 ±1 天窗口内每天 05:00（窗口外睡到前夜）；
   f1 只在未来 session 的前一天 05:00 抓（休赛期每周兜底一次）。全部显式 +8 计算，不依赖服务器时区。 */
const bjWall = ms => {   // 北京墙钟分量（getUTC* 读 now+8h）
  const d = new Date(ms + 8 * 3600e3);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), hh: d.getUTCHours(), mm: d.getUTCMinutes() };
};
const bjDayKey = ms => { const w = bjWall(ms); return w.y + "-" + String(w.m).padStart(2, "0") + "-" + String(w.d).padStart(2, "0"); };
const bjDayStart = dateStr => { const [y, m, d] = dateStr.split("-").map(Number); return Date.UTC(y, m - 1, d) - 8 * 3600e3; };   // 北京某日 00:00
function bjNextDailyAt(hh, mm, afterMs) {   // 严格晚于 afterMs 的下一个北京定点时刻（重启/手动刷新不重抓当天已抓）
  const w = bjWall(afterMs);
  let t = Date.UTC(w.y, w.m - 1, w.d, hh, mm, 0, 0) - 8 * 3600e3;
  if (t <= afterMs) t += 24 * 3600e3;
  return t;
}
const WB_INTERVALS = {
  glm:   { ok: 5 * 60e3,    fail: 2 * 60e3 },
  oil:   { dailyAt: "05:00", fail: 30 * 60e3, stale: 2 * 3600e3 },
  bili:  { dailyAt: "11:00", fail: 3 * 60e3, failRisk: 60 * 60e3 },
  anth:  { dailyAt: "05:00", fail: 20 * 60e3 },
  arxiv: { dailyAt: "05:00", fail: 20 * 60e3 },
  f1:    { dailyAt: "05:00", fail: 6 * 3600e3 },
  github:{ dailyAt: "05:00", fail: 20 * 60e3 },
};
/* 成功后的下一次运行时刻（lastAt = 该板块缓存 at；失败仍走 WB_INTERVALS.fail 短重试） */
function wbNextRun(section, lastAt) {
  const now = Date.now();
  const iv = WB_INTERVALS[section];
  if (section === "glm") return Math.max(now, lastAt + iv.ok);
  const [hh, mm] = (iv.dailyAt || "05:00").split(":").map(Number);
  if (section === "oil") {
    const adj = (wbCache.oil && wbCache.oil.adj) || "";        // 下次调价日 "YYYY-MM-DD"（fetch 落盘）
    if (!adj) return bjNextDailyAt(hh, mm, lastAt);            // 窗口未知 → 每天兜底，抓到就进窗口节奏
    const winStart = bjDayStart(adj) - 86400e3;                // adj-1 天 00:00
    if (now >= winStart && now < winStart + 3 * 86400e3) return bjNextDailyAt(hh, mm, lastAt);   // 窗口内：每天一次
    if (now < winStart) return bjNextDailyAt(hh, mm, winStart - 1);   // 窗口未到：直接睡到 adj-1 的 05:00
    return bjNextDailyAt(hh, mm, lastAt);                      // 窗口已过（网站滞后）→ 每天等新 adj
  }
  if (section === "f1") {
    const today0 = bjDayStart(bjDayKey(now));
    const futures = new Set();
    for (const r of (wbCache.f1 && wbCache.f1.races) || [])
      for (const ss of r.sessions || []) { const t0 = bjDayStart(ss.date); if (t0 >= today0) futures.add(t0); }
    if (!futures.size) return Math.max(now, lastAt + 7 * 24 * 3600e3);   // 无未来 session（休赛期/缓存旧）→ 每周兜底
    for (const t0 of [...futures].sort((a, b) => a - b)) {
      const cand = t0 - 86400e3 + 5 * 3600e3;                  // session 前一天 05:00（北京）
      if (cand <= lastAt) continue;                            // 该前夜已抓过 → 顺延到下一个 session 前夜
      return Math.max(cand, now);                              // 错过（停机/睡过）则醒来立即补
    }
    return Math.max(now, lastAt + 7 * 24 * 3600e3);
  }
  return bjNextDailyAt(hh, mm, lastAt);                        // bili / anth / arxiv：每天定点
}
let wbCache = loadJson(WB_FILE.cache, { glm: null, oil: null, bili: null, anth: null, arxiv: null, f1: null, github: null });
let wbSched = {};
function wbInitSchedule() {
  /* 旧格式 F1 缓存（无北京时间/无全节次 sessions）→ 丢弃，让调度立即重抓 */
  if (wbCache.f1 && Array.isArray(wbCache.f1.races) &&
      (wbCache.f1.races.some(r => r.time === undefined) || !wbCache.f1.races.some(r => r.sessions))) {
    wbCache.f1 = null;
  }
  const now = Date.now();
  for (const k of Object.keys(WB_INTERVALS)) {
    const last = (wbCache[k] && wbCache[k].at) || 0;
    wbSched[k] = { busy: false, nextAt: wbNextRun(k, last) };
    if (!wbCache[k]) wbSched[k].nextAt = now;   // 冷启动立即抓
  }
  /* 错峰：glm 立即，oil/bili/anth/arxiv/f1/github 依次让路 */
  if (!wbCache.oil) wbSched.oil.nextAt = now + 8e3;
  if (!wbCache.bili) wbSched.bili.nextAt = now + 16e3;
  if (!wbCache.anth) wbSched.anth.nextAt = now + 30e3;
  if (!wbCache.arxiv) wbSched.arxiv.nextAt = now + 45e3;
  if (!wbCache.f1) wbSched.f1.nextAt = now + 60e3;
  if (!wbCache.github) wbSched.github.nextAt = now + 70e3;
}
function wbFail(section, msg) {
  console.log("[workbench] " + section + " 失败: " + msg);
  if (wbCache[section]) wbCache[section].error = msg;
  else wbCache[section] = { ok: false, error: msg, at: Date.now() };
}
async function wbRun(section) {
  const s = wbSched[section];
  if (!s || s.busy) return false;
  s.busy = true;
  const iv = WB_INTERVALS[section];
  const done = delay => { s.busy = false; s.nextAt = Date.now() + delay; saveJson(WB_FILE.cache, wbCache); };   // 失败/滞后的短重试
  const okNext = () => { s.busy = false; s.nextAt = wbNextRun(section, Date.now()); saveJson(WB_FILE.cache, wbCache); };   // 成功：定点/条件节奏
  try {
    if (section === "glm") {
      const d = await wbFetchGLM();
      if (d.ok) { wbCache.glm = d; okNext(); } else { wbFail("glm", d.error); done(iv.fail); }
    } else if (section === "oil") {
      const d = await wbFetchOil();
      if (d.ok) { wbCache.oil = d; if (d.expired) done(iv.stale); else okNext(); }   // 网站滞后（窗口已过未上新）→ 2h 后重查
      else { wbFail("oil", d.error); done(iv.fail); }
    } else if (section === "bili") {
      const d = await wbFetchBiliAll();
      if (d.ok) { wbCache.bili = d; okNext(); }
      else { wbFail("bili", d.error); done(d.risky ? iv.failRisk : iv.fail); }
    } else if (section === "anth") {
      const d = await wbFetchAnth();
      if (d.ok) { wbCache.anth = d; okNext(); readerPrefetch("anth"); }
      else { wbFail("anth", d.error); done(iv.fail); }
    } else if (section === "arxiv") {
      console.log("[workbench] arxiv 五段选文开始");
      const d = await wbFetchArxiv();
      if (d.ok) { wbCache.arxiv = d; console.log("[workbench] arxiv 终选: " + d.items.map(x => x.zh).join(" / ")); okNext(); readerPrefetch("arxiv"); }
      else { wbFail("arxiv", d.error); done(iv.fail); }
    } else if (section === "f1") {
      const d = await wbFetchF1();
      if (d.ok) { wbCache.f1 = d; console.log("[workbench] f1 赛程 " + d.races.length + " 站"); okNext(); }
      else { wbFail("f1", d.error); done(iv.fail); }
    } else if (section === "github") {
      const d = await wbFetchGithub();
      if (d.ok) { wbCache.github = d; console.log("[workbench] github 日榜 " + d.items.length + " 仓（新上榜 " + d.items.filter(x => x.fresh).length + "）"); okNext(); }
      else { wbFail("github", d.error); done(iv.fail); }
    }
  } catch (e) {
    wbFail(section, e.name === "TimeoutError" || e.name === "AbortError" ? "网络超时" : (e.message || "抓取失败"));
    done(iv.fail || 15 * 60e3);
  }
  return true;
}

/* ---------------- 工作记录 / 评论 / 周总结 / 收进日志（运行时数据） ---------------- */
let wbLog = loadJson(WB_FILE.log, []);            // [{id,date,text,createdAt}]
let wbComments = loadJson(WB_FILE.comments, {});  // { [url]: {url,source,title,text,createdAt} }
let wbWeekly = loadJson(WB_FILE.weekly, {});      // { [start~end]: {id,start,end,range,summary,plan,confirmedAt,generatedAt} }
let wbNotes = loadJson(WB_FILE.notes, []);        // [{id,title,date,tags,summary,body,visibility,sourceUrl,source}]
let wbMemos = loadJson(WB_FILE.memos, []);        // [{id,date,text,done,createdAt}] 备忘记事（带日期上日历）
let wbReader = loadJson(WB_FILE.reader, {});      // { [url]: {url,source,title,pub,paras:[[src,zh]],firstAt,fetchedAt,promotedAt} }
let wbBiblio = loadJson(WB_FILE.biblio, {});      // { [url]: {url,id,source,title,promotedAt,html,text} } 评论过的文章进 Biblioteca
let wbDislikes = loadJson(WB_FILE.dislikes, {});  // { [url]: {url,source,title,at} } 不感兴趣：强降权、永不进 Biblioteca

/* ---------------- 节假日（holiday-cn：国务院公告口径，含调休补班；jsdelivr→raw 双源） ---------------- */
const holidaysByYear = loadJson(WB_FILE.holidays, {});   // { 2026: [{name,date,isOffDay}] }
const holidaysPending = {};
async function ensureHolidays(year) {
  year = parseInt(year, 10);
  if (!(year >= 2024 && year <= 2100)) return null;
  if (holidaysByYear[year]) return holidaysByYear[year];
  if (holidaysPending[year]) return holidaysPending[year];
  holidaysPending[year] = (async () => {
    /* jsdelivr 主源偶发空响应（2026-10 实测），加 fastly 镜像 + 重试一轮；raw.github 国内常不可达仅兜底 */
    const sources = [
      "https://cdn.jsdelivr.net/gh/NateScarlet/holiday-cn@master/" + year + ".json",
      "https://fastly.jsdelivr.net/gh/NateScarlet/holiday-cn@master/" + year + ".json",
      "https://raw.githubusercontent.com/NateScarlet/holiday-cn/master/" + year + ".json",
    ];
    for (let round = 0; round < 2; round++) {
      for (const src of sources) {
        try {
          const r = await fetch(src, { signal: AbortSignal.timeout(9000) });
          if (!r.ok) continue;
          const j = await r.json();
          if (Array.isArray(j.days) && j.days.length) {
            holidaysByYear[year] = j.days.map(d => ({ name: String(d.name || ""), date: d.date, isOffDay: !!d.isOffDay }));
            saveJson(WB_FILE.holidays, holidaysByYear);
            delete holidaysPending[year];
            return holidaysByYear[year];
          }
        } catch {}
      }
    }
    delete holidaysPending[year];
    return null;
  })();
  return holidaysPending[year];
}

/* ---------------- ICS 订阅源（iPhone/ICSx⁵ 订阅：工作记录 + 备忘 + F1） ---------------- */
function icsEscape(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function icsFold(line) {
  if (Buffer.byteLength(line, "utf8") <= 73) return line;
  const parts = [];
  let cur = "", len = 0, first = true;
  for (const ch of String(line)) {
    const l = Buffer.byteLength(ch, "utf8");
    if (len + l > (first ? 73 : 72)) { parts.push(cur); cur = " " + ch; len = 1 + l; first = false; }
    else { cur += ch; len += l; }
  }
  parts.push(cur);
  return parts.join("\r\n");
}
function icsAddDays(ds, n) {
  const d = new Date(ds + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
}
function buildCalendarICS() {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const ev = [];
  const addDay = (ds, summary) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ds || "")) return;
    ev.push("BEGIN:VEVENT",
      "UID:" + md5(ds + "|" + summary).slice(0, 20) + "@taller",
      "DTSTAMP:" + stamp,
      "DTSTART;VALUE=DATE:" + ds.replace(/-/g, ""),
      "DTEND;VALUE=DATE:" + icsAddDays(ds, 1).replace(/-/g, ""),
      "SUMMARY:" + icsEscape(summary),
      "END:VEVENT");
  };
  /* 定时事件（HH:MM 为北京时间；浮动时间写法 = 订阅端按本地时区解读，国内手机即北京时间） */
  const addTimed = (ds, hm, durMin, summary) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ds || "") || !/^\d{2}:\d{2}$/.test(hm || "")) return;
    const start = new Date(ds + "T" + hm + ":00");
    const end = new Date(start.getTime() + durMin * 60000);
    const fmt = d => d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + "T" + pad2(d.getHours()) + pad2(d.getMinutes()) + "00";
    ev.push("BEGIN:VEVENT",
      "UID:" + md5(ds + "|" + hm + "|" + summary).slice(0, 20) + "@taller",
      "DTSTAMP:" + stamp,
      "DTSTART:" + fmt(start),
      "DTEND:" + fmt(end),
      "SUMMARY:" + icsEscape(summary),
      "END:VEVENT");
  };
  wbLog.forEach(e => addDay(e.date, "工作：" + e.text));
  wbMemos.forEach(m => addDay(m.date, (m.done ? "✅ " : "备忘：") + m.text));
  const races = (wbCache.f1 && wbCache.f1.races) || [];
  races.forEach(r => {
    const label = "🏎 F1 " + r.raceName + (r.locality ? " · " + r.locality : "");
    if (Array.isArray(r.sessions) && r.sessions.length) {
      r.sessions.forEach(ss => {
        if (ss.hm) addTimed(ss.date, ss.hm, ss.k === "R" ? 120 : 60, label + " " + ss.label + " " + ss.hm + " 开赛");
        else addDay(ss.date, label + " " + ss.label);
      });
    } else if (r.time) addTimed(r.date, r.time, 120, label + " 正赛 " + r.time + " 开赛");
    else addDay(r.date, label);
  });
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//El Taller//Workbench//CN",
    "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:El Taller 工作台", "X-WR-TIMEZONE:Asia/Shanghai",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H", "X-PUBLISHED-TTL:PT6H",
    ...ev, "END:VCALENDAR",
  ];
  return lines.map(icsFold).join("\r\n") + "\r\n";
}

const pad2 = n => String(n).padStart(2, "0");
const dstr = d => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
/* GLM 偶发不守「字符串」约定，把 summary/plan 写成对象/数组：兜底拍平成可读文本 */
function wbJsonToText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    return v.map(x => wbJsonToText(x)).filter(Boolean)
      .map(t => /^[-·•]|^(总述|盘面|顺延|风险|投入对比|【)/.test(t) ? t : "- " + t).join("\n");
  }
  if (typeof v === "object") {
    return Object.entries(v).map(([k, val]) => {
      const t = wbJsonToText(val);
      if (!t) return "";
      if (/^\d+$/.test(k)) return t;
      if (typeof val === "string") return /^(总述|盘面|顺延|风险|投入对比)/.test(k) ? k + "：" + t : "【" + k + "】" + t;
      return (/^(顺延|风险)/.test(k) ? k + "：\n" : "【" + k + "】\n") + t;
    }).filter(Boolean).join("\n");
  }
  return String(v);
}
/* 周报草稿：模型只负责出结构（JSON），展示格式由服务端确定性渲染，
   避免 glm-4-flash 跟不稳长格式约定（空排周末/跨天重复/段落错位都出过） */
function wbRenderSummary(s) {
  if (typeof s === "string") return s.trim();
  if (!s || typeof s !== "object") return "";
  const parts = [];
  if (s.overview) parts.push("总述：" + String(s.overview).trim());
  (Array.isArray(s.projects) ? s.projects : []).forEach(p => {
    if (!p || typeof p !== "object") return;
    const pts = (Array.isArray(p.points) ? p.points : [p.points]).filter(Boolean).map(String);
    if (!p.name && !pts.length) return;
    parts.push("【" + String(p.name || "未分类") + "】" + (p.count ? "（" + p.count + " 条）" : "") +
      (pts.length ? "\n" + pts.map(t => "- " + t).join("\n") : ""));
  });
  if (s.mix) parts.push("投入对比：" + String(s.mix).trim());
  return parts.join("\n\n");
}
function wbRenderPlan(p) {
  if (typeof p === "string") return p.trim();
  if (!p || typeof p !== "object") return "";
  const parts = [];
  if (p.capacity) parts.push(String(p.capacity).trim());
  (Array.isArray(p.days) ? p.days : []).forEach(d => {
    if (!d || typeof d !== "object") return;
    const items = (Array.isArray(d.items) ? d.items : []).filter(Boolean);
    if (!items.length) return;
    const head = String(d.label || "").trim() + (d.kind ? "（" + String(d.kind).trim() + "）" : "");
    parts.push(head + "\n" + items.map(it => {
      if (typeof it === "string") return "- " + it;
      const pr = it.project ? "[" + String(it.project).trim() + "] " : "";
      const tail = it.slot ? "（约 " + (it.hours != null ? it.hours + "h · " : "") + String(it.slot).trim() + "）"
        : (it.hours != null ? "（约 " + it.hours + "h）" : "");
      return "- " + pr + String(it.task || "").trim() + tail;
    }).join("\n"));
  });
  const carry = (Array.isArray(p.carryover) ? p.carryover : []).map(String).filter(Boolean);
  parts.push("顺延：\n" + (carry.length ? carry.map(t => "- " + t).join("\n") : "无"));
  const risks = (Array.isArray(p.risks) ? p.risks : []).map(String).filter(Boolean);
  if (risks.length) parts.push("风险与兜底：\n" + risks.map(t => "- " + t).join("\n"));
  return parts.join("\n\n");
}
function localWeekRange() {
  const now = new Date();
  const day = (now.getDay() + 6) % 7;   // 周一为 0
  const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate() - day);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { start: dstr(mon), end: dstr(sun) };
}
async function wbGenerateWeekly(start, end) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) throw new Error("日期格式应为 YYYY-MM-DD");
  const startTime = new Date(start + "T00:00:00").getTime();
  const endTime = new Date(end + "T23:59:59.999").getTime();
  if (!(startTime <= endTime)) throw new Error("起始日期不能晚于结束日期");
  if (!wbCfg.glmKey) throw new Error("未配置 GLM Key");   // 提前抛，别让无 Key 场景白跑节假日抓取
  const entries = wbLog.filter(e => e.date >= start && e.date <= end);
  const comments = Object.values(wbComments).filter(c => c.createdAt >= startTime && c.createdAt <= endTime);
  const memos = wbMemos.filter(m => m.date >= start && m.date <= end);
  /* 对照基准 = 最近一次已确认的计划（任意区间，不限于"上一周"） */
  const prev = Object.values(wbWeekly).filter(w => w.confirmedAt).sort((a, b) => b.confirmedAt - a.confirmedAt)[0];
  const prevPlan = prev ? prev.plan : "";
  const rangeLabel = start + " ~ " + end;

  /* 总结材料①：工作记录按项目分组（旧记录无 project 字段归「未分类」） */
  const groups = {};
  entries.forEach(e => {
    const k = String(e.project || "未分类").slice(0, 24);
    (groups[k] = groups[k] || []).push(e);
  });
  const groupLines = Object.entries(groups).sort((a, b) => b[1].length - a[1].length)
    .map(([name, es]) => "■ " + name + "（" + es.length + " 条 · 活跃 " + new Set(es.map(e => e.date)).size + " 天）\n" +
      es.map(e => "- (" + e.date.slice(5) + ") " + e.text).join("\n")).join("\n\n");

  /* 计划材料：下阶段窗口 = 紧接 end 的同长度区间（周报场景即下周一~周日），
     逐日给出周几/休班（holiday-cn：法定假 isOffDay=true、调休补班落在周末 isOffDay=false）/当天已排备忘 */
  const lenDays = Math.round((new Date(end + "T00:00:00") - new Date(start + "T00:00:00")) / 86400e3) + 1;
  const nextDays = [];
  for (let i = 1; i <= Math.min(Math.max(lenDays, 7), 21); i++) {
    const d = new Date(end + "T00:00:00");
    d.setDate(d.getDate() + i);
    nextDays.push(dstr(d));
  }
  const holIdx = {};
  for (const y of [...new Set(nextDays.map(ds => ds.slice(0, 4)))]) {
    (await ensureHolidays(y) || []).forEach(h => { holIdx[h.date] = !!h.isOffDay; });
  }
  const WK = ["日", "一", "二", "三", "四", "五", "六"];
  const openMemos = wbMemos.filter(m => !m.done);
  const dayFacts = nextDays.map(ds => {
    const dow = new Date(ds + "T00:00:00").getDay();
    let mark = (dow === 0 || dow === 6) ? "周末休" : "工作日";
    if (ds in holIdx) mark = holIdx[ds] ? "法定休" : "调休补班";
    const occ = openMemos.filter(m => m.date === ds).map(m => m.text);
    return "- 周" + WK[dow] + " " + ds.slice(5) + "（" + mark + (occ.length ? "；已排备忘：" + occ.join("、") : "") + "）";
  }).join("\n");
  const nextStart = nextDays[0], nextEnd = nextDays[nextDays.length - 1];

  const prompt = "你是 Andres 的工作助理（他白天有全职工作，晚上和周末做个人项目）。根据下面的材料，为时间段 " + rangeLabel + " 写「工作总结」，并为紧随其后的 " + nextStart + " ~ " + nextEnd + " 写「下阶段计划」。\n\n" +
    "【该时间段的工作记录（按项目分组）】\n" + (groupLines || "（该时间段暂无记录）") + "\n\n" +
    "【该时间段的阅读与评论】\n" + (comments.length ? comments.map(c => "- [" + (c.source || "") + "] " + (c.title || c.url) + "：" + (c.text || "")).join("\n") : "（该时间段暂无评论）") + "\n\n" +
    "【该时间段的备忘记事/待办】\n" + (memos.length ? memos.map(m => "- (" + m.date + (m.done ? " 已完成" : " 未完成") + ") " + m.text).join("\n") : "（无）") + "\n\n" +
    "【最近一次已确认的计划（对照：已完成的在总结里体现，未完成的列入下阶段计划的顺延）】\n" + (prevPlan || "（无）") + "\n\n" +
    "【下阶段日历（排程的唯一依据）】\n" + dayFacts + "\n\n" +
    "要求（全部中文）：\n" +
    "1. 总结按项目分组：projects 只来自上面工作记录的项目分组（阅读评论、备忘记事不算项目），每个项目 1~4 条要点，写清做了什么、推进到哪、有什么结论或卡点，不要泛泛而谈。\n" +
    "2. 计划是排程推演：Andres 白天有全职工作，可自由支配的是工作日晚间（约 2h）和休息日白天（约 4h/天）。capacity 写出估算式（如「盘面：5 个工作日×2h + 2 个体息日×4h ≈ 18h」，已排备忘要占用则说明）；days 只列有安排的日子，工作日/调休补班的 items.slot 只能是「晚间」（hours ≤ 2）或「白天顺带」（琐碎沟通审批类，hours ≤ 0.5，不占晚间容量），大块事项（hours ≥ 3）必须排在法定休/周末休；每天 items 的 hours 合计：班日 ≤ 2（白天顺带除外）、休日 ≤ 4；事项要可执行可验证，不写「继续优化」这类空话；carryover 列上期计划未完成需带走的（没有给空数组）；risks 1~2 条，写清哪个安排若被挤掉、顺延到哪天。\n\n" +
    "只输出如下 JSON，不要输出任何多余文字：\n" +
    "{\"summary\":{\"overview\":\"一句话总述\",\"projects\":[{\"name\":\"项目名\",\"count\":条数,\"points\":[\"要点\",\"…\"]}],\"mix\":\"投入对比一句话\"},\"plan\":{\"capacity\":\"盘面：估算式\",\"days\":[{\"label\":\"周一 10-19\",\"kind\":\"班\",\"items\":[{\"project\":\"项目名\",\"task\":\"事项\",\"hours\":1.5,\"slot\":\"晚间\"}]}],\"carryover\":[\"顺延事项\"],\"risks\":[\"风险与兜底\"]}}";
  const r = extractJSON(await glmChat(prompt, { temperature: 0.4, maxTokens: 3000 }));
  const rSum = r && r.summary, rPlan = r && r.plan;
  const sumOk = typeof rSum === "string" ? !!rSum.trim() : !!(rSum && typeof rSum === "object" && (rSum.overview || (Array.isArray(rSum.projects) && rSum.projects.length)));
  const planOk = typeof rPlan === "string" ? !!rPlan.trim() : !!(rPlan && typeof rPlan === "object" &&
    (rPlan.capacity || (Array.isArray(rPlan.days) && rPlan.days.some(d => d && Array.isArray(d.items) && d.items.length))));
  if (!sumOk || !planOk) throw new Error("生成失败，请重试");
  const summary = (wbRenderSummary(rSum) || wbJsonToText(rSum)).slice(0, 20000);
  const plan = (wbRenderPlan(rPlan) || wbJsonToText(rPlan)).slice(0, 20000);
  return { start, end, range: rangeLabel, summary, plan };
}
function wbAddNote(o) {
  const srcTag = o.source === "arxiv" ? "论文笔记" : o.source === "anth" ? "AI 前沿" : "视频笔记";
  const note = {
    id: "x-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
    title: String(o.title || o.sourceTitle || "读文笔记").slice(0, 60),
    date: dstr(new Date()),
    tags: [srcTag],
    summary: String(o.text || "").slice(0, 80),
    body: String(o.text || "") + (o.sourceUrl ? "\n\n原文：" + o.sourceUrl : ""),
    visibility: ["public", "friends", "family", "private"].includes(o.visibility) ? o.visibility : "private",
    sourceUrl: o.sourceUrl || "", source: o.source || "", createdAt: Date.now(),
  };
  wbNotes.unshift(note);
  saveJson(WB_FILE.notes, wbNotes);
  return note;
}

/* ---------------- 对照阅读：抓正文 → GLM 逐段翻译 → 评论即入 Biblioteca / 3 天无评论清除 ---------------- */
const escHtml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/* Anthropic 研究页 / arXiv HTML 正文抽取：<article>/<main> 内的 <p>，
   滤掉短碎导航句、未转换的 LaTeX 宏汤（tcolorbox 之类）、花括号密度异常段 */
function extractArticleParas(html) {
  const h = String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(nav|footer|header|aside|form)[\s\S]*?<\/\1>/gi, " ");
  const m = /<article[\s\S]*?<\/article>/i.exec(h) || /<main[\s\S]*?<\/main>/i.exec(h) || [h];
  const paras = [];
  const re = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let pm;
  while ((pm = re.exec(m[0]))) {
    const t = cleanText(pm[1].replace(/<[^>]+>/g, " "));
    if (t.length < 40) continue;
    if ((t.match(/\\[a-zA-Z_]+/g) || []).length >= 2) continue;        // LaTeX 宏汤
    if ((t.match(/[{}]/g) || []).length > t.length * 0.1) continue;    // 花括号密度异常
    paras.push(t.slice(0, 2000));
  }
  return paras.slice(0, 60);
}
/* arXiv 摘要：优先 abs 网页（网页端无 API 限流），export API 兜底（连续查会 429） */
async function arxivAbstract(url) {
  const idm = /arxiv\.org\/abs\/([^?#]+)/.exec(url);
  if (!idm) return [];
  const id = idm[1];
  try {
    const html = await httpGetText("https://arxiv.org/abs/" + id, 25000);
    const tm = reFirst(html, /<h1 class="title[^"]*">[\s\S]*?<span[^>]*>Title:<\/span>\s*([\s\S]*?)<\/h1>/);
    const sm = reFirst(html, /<blockquote class="abstract[^"]*">[\s\S]*?<span[^>]*>Abstract:<\/span>\s*([\s\S]*?)<\/blockquote>/);
    const out = [];
    if (tm && tm[0]) out.push(cleanText(tm[0]));
    if (sm && sm[0]) out.push(cleanText(sm[0]));
    if (out.length) return out;
  } catch {}
  const xml = await httpGetText("https://export.arxiv.org/api/query?id_list=" + encodeURIComponent(id) + "&max_results=1", 30000);
  const em = /<entry>([\s\S]*?)<\/entry>/.exec(xml);
  if (!em) return [];
  const tm = reFirst(em[1], /<title>([\s\S]*?)<\/title>/);
  const sm = reFirst(em[1], /<summary>([\s\S]*?)<\/summary>/);
  const out = [];
  if (tm && tm[0]) out.push(cleanText(tm[0]));
  if (sm && sm[0]) out.push(cleanText(sm[0]));
  return out;
}
/* 分块并行翻译：长文一次请求要 40~60 秒，按 8 段一块并行降到 ~20 秒 */
async function glmTranslateLinesFast(lines) {
  if (!lines.length) return [];
  if (lines.length <= 8) return glmTranslateLines(lines);
  const chunks = [];
  for (let i = 0; i < lines.length; i += 8) chunks.push(lines.slice(i, i + 8));
  const outs = await Promise.all(chunks.map(c => glmTranslateLines(c)));
  return outs.flat();
}
/* arXiv 内容三级兜底：官方 HTML 全文（LaTeXML，2024 后论文基本都有）→ ar5iv → abs 摘要 */
async function arxivContent(url) {
  const idm = /arxiv\.org\/abs\/([^?#]+)/.exec(url);
  if (!idm) return [];
  const id = idm[1];
  for (const u of [
    "https://arxiv.org/html/" + id,
    "https://ar5iv.labs.arxiv.org/html/" + id.replace(/v\d+$/, ""),
  ]) {
    try {
      const paras = extractArticleParas(await httpGetText(u, 25000));
      if (paras.length >= 6) return paras;   // 少于 6 段视为没有像样的全文
    } catch {}
  }
  return arxivAbstract(url);
}

/* 确保文章正文+译文在缓存里（懒加载：首次点开才抓+翻译；译文全空则隔 10 分钟允许重试）
   readerBusy 去重：连点/多人同时开同一篇只触发一次抓取+翻译
   arXiv 旧条目（full!==1，只有摘要）自动重抓全文 */
const readerBusy = new Map();
async function readerEnsure(url) {
  if (readerBusy.has(url)) return readerBusy.get(url);
  const p = readerEnsureInner(url).finally(() => readerBusy.delete(url));
  readerBusy.set(url, p);
  return p;
}
/* 条目是否已备好：有正文；arXiv 必须是全文版（full=1，旧摘要条目重抓）；译文全空隔 10 分钟重试 */
function readerEntryReady(e) {
  if (!e || !Array.isArray(e.paras) || !e.paras.length) return false;
  if (e.source === "arxiv" && e.full !== 1) return false;
  return !(e.needZh && Date.now() - (e.fetchedAt || 0) > 600e3);
}
async function readerEnsureInner(url) {
  const anth = ((wbCache.anth && wbCache.anth.items) || []).find(x => x.url === url);
  const arx = ((wbCache.arxiv && wbCache.arxiv.items) || []).find(x => x.url === url);
  const item = anth || arx;
  if (!item) return wbReader[url] || null;   // 只读当前卡片里在列的文章；已不在卡片只有缓存可给
  const old = wbReader[url];
  if (readerEntryReady(old)) return old;
  const source = anth ? "anth" : "arxiv";
  /* 境外源直连偶发抖动：失败重试，最多 3 次（arXiv 限流 429 退避要长） */
  const gapMs = source === "arxiv" ? 12000 : 4000;
  let srcs = [];
  for (let tries = 2; tries >= 0; tries--) {
    try {
      if (source === "anth") srcs = extractArticleParas(await httpGetText(url, 25000));
      else srcs = await arxivContent(url);
    } catch {}
    if (srcs.length) break;
    if (tries > 0) await new Promise(rs => setTimeout(rs, gapMs));
  }
  if (!srcs.length) return old || null;
  let zhs = [];
  try { zhs = await glmTranslateLinesFast(srcs); } catch {}
  const e = {
    url, source, title: item.zh || item.title || url, pub: item.pub || "",
    paras: srcs.map((s, i) => [s, keepEnglishTerms(zhs[i] || "")]),
    firstAt: (old && old.firstAt) || Date.now(), fetchedAt: Date.now(),
    needZh: zhs.every(z => !z),
    full: source === "arxiv" ? (srcs.length >= 6 ? 1 : 0) : 1,   // arXiv：≥6 段才算全文
  };
  wbReader[url] = e;
  saveJson(WB_FILE.reader, wbReader);
  return e;
}
/* 评论过 → 文章（中英对照）+评论 收进 Biblioteca；评论改/删时同步更新条目（文章保留）
   标过「不感兴趣」的文章永不收录 */
async function promoteArticle(url) {
  if (wbDislikes[url]) return;
  const e = await readerEnsure(url);
  if (!e) return;
  const c = wbComments[url];
  const srcName = e.source === "arxiv" ? "arXiv 论文" : "Anthropic 研究";
  const head = "<p><strong>来源：</strong>" + srcName + (e.pub ? " · " + e.pub : "") +
    ' · <a href="' + escHtml(url) + '" target="_blank" rel="noopener">原文链接</a> · 收录于 ' + dstr(new Date()) + "</p>";
  const paras = e.paras.map(pair =>
    (pair[1] ? "<p>" + escHtml(pair[1]) + "</p>" : "") +
    '<p style="opacity:.62;font-size:.92em">' + escHtml(pair[0]) + "</p>"
  ).join("");
  const cmt = c && c.text
    ? "<h4>我的评论</h4><blockquote>" + escHtml(c.text) + "</blockquote>" : "";
  wbBiblio[url] = {
    url, id: "r-" + md5(url).slice(0, 10), source: e.source,
    title: e.title, pub: e.pub || "", promotedAt: Date.now(),
    html: head + paras + cmt,
    text: e.paras.map(p => p[1] || p[0]).join("\n") + "\n评论：" + ((c && c.text) || ""),
  };
  e.promotedAt = Date.now();
  saveJson(WB_FILE.biblio, wbBiblio);
  saveJson(WB_FILE.reader, wbReader);
}
/* 3 天无评论且未晋升 → 删除正文缓存（卡片条目本身随每日抓取自然轮换） */
function readerPurge() {
  const cut = Date.now() - 3 * 86400e3;
  let dirty = false;
  for (const [url, e] of Object.entries(wbReader)) {
    const commented = !!(wbComments[url] && wbComments[url].text);
    if (!e.promotedAt && !commented && (e.firstAt || e.fetchedAt || 0) < cut) {
      delete wbReader[url];
      dirty = true;
    }
  }
  if (dirty) saveJson(WB_FILE.reader, wbReader);
}
/* 预取：anth/arxiv 抓取成功后，后台把在列文章的正文+译文备好——点开 📄 即读，不再等首抓 */
const readerPrefetching = {};
function readerPrefetch(section) {
  if (readerPrefetching[section]) return;
  const items = ((wbCache[section] || {}).items) || [];
  if (!items.length) return;
  readerPrefetching[section] = true;
  const gap = section === "arxiv" ? 10000 : 3000;   // arXiv 对连续请求限流(429)，间隔拉大
  (async () => {
    for (const it of items) {
      if (readerEntryReady(wbReader[it.url])) continue;   // 已备好（含 arXiv 摘要条目自动升级全文）
      console.log("[workbench] 预取 " + section + ": " + String(it.zh || it.url).slice(0, 44));
      try { await readerEnsure(it.url); } catch {}
      await new Promise(rs => setTimeout(rs, gap));
    }
  })().catch(() => {}).finally(() => { readerPrefetching[section] = false; });
}

/* ---------------- 管理台：账号管理页（建号 / 改角色 / 重置密码 / 删除，仅 admin） ---------------- */
const ADMIN_PAGE = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>账号与权限 · El Taller</title>
<style>
body{font-family:"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#241006;color:#fff6ec;
min-height:100vh;display:grid;place-items:center;margin:0;padding:24px}
.box{width:min(760px,96vw);padding:34px;border-radius:26px;
background:linear-gradient(150deg,rgba(185,128,82,.38),rgba(115,70,40,.32));border:1px solid rgba(255,255,255,.15);
box-shadow:inset 0 1px 0 rgba(255,255,255,.28),0 34px 90px rgba(0,0,0,.45);
-webkit-backdrop-filter:blur(40px) saturate(1.5);backdrop-filter:blur(40px) saturate(1.5)}
h1{font-size:20px;margin:0 0 8px;text-align:center;font-weight:650}
.sub{color:rgba(255,240,228,.62);font-size:12.5px;line-height:1.9;text-align:center;margin:0 0 24px}
.sub b{font-weight:600}
.r-user{color:#a9ddff}.r-family{color:#8fe9bd}.r-admin{color:#ffd9a3}
form{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;justify-content:center;margin:0 0 24px;padding:16px;
border:1px dashed rgba(255,255,255,.2);border-radius:16px}
label{display:flex;flex-direction:column;gap:6px;font-size:11.5px;color:rgba(255,240,228,.62)}
label.chk{flex-direction:row;align-items:center;gap:7px;padding-bottom:9px}
label.chk input{width:auto;margin:0}
input,select{font:inherit;font-size:13px;border-radius:10px;border:1px solid rgba(255,255,255,.22);
background:rgba(255,255,255,.08);color:#fff6ec;padding:8px 10px;outline:0;min-width:0}
input:focus,select:focus{border-color:rgba(255,157,46,.6)}
button{font:inherit;font-size:12.5px;border:0;border-radius:10px;cursor:pointer;padding:9px 14px;transition:.2s;
background:linear-gradient(140deg,#ff9d2e,#d97c14);color:#2a1505;font-weight:600}
button:hover{filter:brightness(1.08)}
button.ghost{background:rgba(255,255,255,.12);color:#fff6ec;font-weight:400}
button.danger{background:rgba(200,70,50,.78);color:#fff}
table{width:100%;border-collapse:collapse;font-size:13px}
th{color:rgba(255,240,228,.55);font-weight:500;text-align:left;padding:8px 10px;font-size:11.5px;
border-bottom:1px solid rgba(255,255,255,.16);letter-spacing:.5px}
td{padding:10px;border-bottom:1px solid rgba(255,255,255,.09);vertical-align:middle}
td.u{font-weight:600}
td.op{text-align:right;white-space:nowrap}
td.op button{padding:6px 10px;font-size:12px}
.mut{color:rgba(255,240,228,.5);font-size:11.5px}
#msg{min-height:18px;text-align:center;font-size:12.5px;margin:16px 0 0}
.ok{color:#8fe9bd}.err{color:#ffb3a3}
.back{display:block;text-align:center;margin-top:18px;font-size:12.5px;color:rgba(255,240,228,.62);text-decoration:none}
.back:hover{color:#fff6ec}
select.tr{font-size:12px;padding:5px 8px}
.ptable{margin:0 auto 26px;max-width:620px}
.ptable td,.ptable th{text-align:left;font-size:12px;padding:7px 10px}
</style></head>
<body><div class="box">
<h1>El Taller · 账号与权限</h1>
<p class="sub">注册始终关闭，账号只在这里创建；账号的权限=其角色，内容的可见档位在 works.js / 工作台收日志时选择。<br>
<span class="mut">改密 / 改角色 / 删除账号后，全站会话作废，所有人（含管理员）需重新登录。</span></p>

<table class="ptable">
<thead><tr><th>角色</th><th>能看什么</th><th>能做什么</th></tr></thead>
<tbody>
<tr><td class="mut">未登录<br><span style="font-size:11px">路人 / 同事 / 面试官</span></td><td>public 公开内容</td><td class="mut">只读浏览</td></tr>
<tr><td class="r-user">user · 朋友</td><td>＋ friends 好友内容</td><td class="mut">只读浏览</td></tr>
<tr><td class="r-family">family · 家人</td><td>＋ family 家庭内容</td><td class="mut">只读浏览</td></tr>
<tr><td class="r-admin">admin · 管理员</td><td>全部（含 private）</td><td>管理台 + 工作台 + 全部写操作</td></tr>
</tbody></table>

<form id="createForm">
  <label>用户名<input id="nu" maxlength="24" placeholder="2~24 位字母数字"></label>
  <label>初始密码（≥6 位）<input id="np" type="text" autocomplete="off" placeholder="线下传达给对方"></label>
  <label>角色<select id="nr">
    <option value="family" selected>family · 家人</option>
    <option value="user">user · 朋友</option>
    <option value="admin">admin · 管理员</option>
  </select></label>
  <label class="chk"><input id="nmc" type="checkbox" checked>首次登录须改密</label>
  <button type="submit" id="cbtn">建号</button>
</form>

<table><thead><tr><th>用户名</th><th>角色</th><th>首登改密</th><th>创建时间</th><th style="text-align:right">操作</th></tr></thead>
<tbody id="rows"><tr><td colspan="5" class="mut" style="text-align:center;padding:24px">加载中…</td></tr></tbody></table>
<div id="msg"></div>
<a class="back" href="/">← 返回主页</a>
</div>
<script>
var $=function(s){return document.querySelector(s)};
var LOGIN='/login.html?next=%2Fadmin%2F';
function say(t,cls){var m=$('#msg');m.textContent=t||'';m.className=cls||''}
function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function kicked(){say('已生效——全站会话作废，即将去登录页重新登录…','ok');
  setTimeout(function(){location.href=LOGIN},1500)}
function api(method,path,body){
  return fetch(path,{method:method,headers:{'Content-Type':'application/json'},
    body:body?JSON.stringify(body):undefined}).then(function(r){
      if(r.status===401){kicked();throw new Error('unauthorized')}
      return r.json().catch(function(){return{}});
    });
}
var ROLE_TXT={user:'user · 朋友',family:'family · 家人',admin:'admin · 管理员'};
function roleOptions(cur){var h='';['user','family','admin'].forEach(function(k){
  h+='<option value="'+k+'"'+(k===cur?' selected':'')+'>'+ROLE_TXT[k]+'</option>'});return h}
function load(){
  return api('GET','/api/admin/users').then(function(j){
    var rows=(j.users||[]).map(function(u){
      return '<tr><td class="u">'+esc(u.username)+'</td>'+
        '<td><select class="tr" data-role="'+esc(u.username)+'">'+roleOptions(u.role)+'</select></td>'+
        '<td><input type="checkbox" data-mc="'+esc(u.username)+'"'+(u.must_change?' checked':'')+' title="勾选=下次登录强制改密"></td>'+
        '<td class="mut">'+esc(String(u.created||'').slice(0,16).replace('T',' '))+'</td>'+
        '<td class="op"><button class="ghost" data-pwd="'+esc(u.username)+'">重置密码</button> '+
        '<button class="danger" data-del="'+esc(u.username)+'">删除</button></td></tr>';
    }).join('');
    $('#rows').innerHTML=rows||'<tr><td colspan="5" class="mut" style="text-align:center;padding:24px">暂无账号</td></tr>';
  }).catch(function(){});
}
$('#createForm').addEventListener('submit',function(e){
  e.preventDefault();
  var username=$('#nu').value.trim(),password=$('#np').value;
  if(!username||password.length<6){say('用户名必填，初始密码至少 6 位','err');return}
  $('#cbtn').disabled=true;
  api('POST','/api/admin/users',{username:username,password:password,role:$('#nr').value,mustChange:$('#nmc').checked})
    .then(function(j){
      if(j.ok){say('已创建 '+username+'（初始密码记得线下传达）','ok');$('#nu').value='';$('#np').value='';load()}
      else say(j.error||'创建失败','err');
    }).catch(function(){}).then(function(){$('#cbtn').disabled=false});
});
$('#rows').addEventListener('change',function(e){
  var t=e.target;
  if(t.dataset.role){
    api('PUT','/api/admin/users',{username:t.dataset.role,role:t.value}).then(function(j){
      if(j.ok){if(j.rotated)kicked();else{say('角色已更新','ok');load()}}
      else say(j.error||'失败','err');
    }).catch(function(){});
  }else if(t.dataset.mc){
    api('PUT','/api/admin/users',{username:t.dataset.mc,mustChange:t.checked}).then(function(j){
      say(j.ok?(t.checked?'下次登录须改密':'允许沿用当前密码'):(j.error||'失败'),j.ok?'ok':'err');
    }).catch(function(){});
  }
});
$('#rows').addEventListener('click',function(e){
  var b=e.target.closest('button');if(!b)return;
  if(b.dataset.pwd){
    var pwd=prompt('给 '+b.dataset.pwd+' 设的新密码（≥6 位；默认要求其下次登录改密，可在行内取消勾选）：');
    if(pwd==null)return;
    if(pwd.length<6){say('新密码至少 6 位','err');return}
    api('PUT','/api/admin/users',{username:b.dataset.pwd,password:pwd,mustChange:true}).then(function(j){
      if(j.ok)kicked();else say(j.error||'失败','err');
    }).catch(function(){});
  }else if(b.dataset.del){
    if(!confirm('删除账号 '+b.dataset.del+'？不可恢复，其会话立即失效。'))return;
    api('DELETE','/api/admin/users?username='+encodeURIComponent(b.dataset.del)).then(function(j){
      if(j.ok)kicked();else say(j.error||'失败','err');
    }).catch(function(){});
  }
});
load();
</script>
</body></html>`;

/* ---------------- 公开分享页（无登录只读；朱漆金默认配色，独立轻量页不带主题切换） ---------------- */
function kbSharePage(token) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>分享阅读 · El Taller de Andres</title>
<style>
:root{
  --accent:#d9a44e; --accent-soft:#f3d9a8; --text:#f8efe2; --dim:rgba(248,239,226,.6);
  --glass-hi:rgba(164,75,62,.36); --glass-lo:rgba(88,38,26,.34);
  --bg-1:#4a2317; --bg-2:#33140c; --bg-3:#1d0906; --bg-base:#230d07;
}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:"Segoe UI Variable Display","Segoe UI",system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;
  color:var(--text);background:var(--bg-base);min-height:100vh}
.page{position:relative;min-height:100vh;overflow-x:hidden}
.page::before{content:"";position:fixed;inset:0;z-index:0;
  background:radial-gradient(90% 70% at 72% 6%,rgba(217,164,78,.24),transparent 60%),
    radial-gradient(70% 60% at 12% 88%,rgba(164,75,62,.30),transparent 65%),
    linear-gradient(180deg,var(--bg-1),var(--bg-2) 55%,var(--bg-3));}
.wrap{position:relative;z-index:1;width:min(1240px,94vw);margin:0 auto;padding:36px 20px 60px}
.glass{background:linear-gradient(150deg,var(--glass-hi),var(--glass-lo));
  -webkit-backdrop-filter:blur(40px) saturate(1.8);backdrop-filter:blur(40px) saturate(1.8);
  border:1px solid rgba(248,239,226,.2);border-radius:22px;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 18px 50px rgba(0,0,0,.35)}
.head{padding:26px 30px 18px}
.eyebrow{font-size:11px;letter-spacing:3px;color:var(--accent);text-transform:uppercase}
.head h1{font-size:22px;line-height:1.45;margin-top:8px;font-weight:650}
.head .desc{font-size:12.5px;color:var(--dim);margin-top:8px;line-height:1.7}
.meta{font-size:11.5px;color:var(--dim);margin-top:10px}
.toc{display:flex;flex-wrap:wrap;gap:8px;padding:4px 30px 22px}
.toc button{border:1px solid rgba(248,239,226,.22);background:rgba(248,239,226,.07);color:var(--text);
  border-radius:999px;padding:6px 14px;font:inherit;font-size:12px;cursor:pointer}
.toc button.on{background:var(--accent);border-color:var(--accent);color:#2a1b05;font-weight:600}
.article{padding:10px 30px 26px;font-size:15px;line-height:1.95;overflow-wrap:anywhere}
/* 自适应行宽：正文文字列 ~850px 保行长舒适，表格/代码/内嵌 PDF 用满容器 */
.article > p,.article > h2,.article > h3,.article > h4,.article > h5,.article > blockquote,.article > ul,.article > ol{max-width:850px}
.article h2,.article h3,.article h4,.article h5{margin:26px 0 10px;line-height:1.5}
.article h2{font-size:18px;color:var(--accent-soft)}
.article h3{font-size:16px}.article h4{font-size:14.5px}
.article p{margin:12px 0}
.article a{color:var(--accent);text-decoration:none;border-bottom:1px solid rgba(217,164,78,.45)}
.article blockquote{margin:14px 0;padding:10px 16px;border-left:3px solid var(--accent);
  background:rgba(217,164,78,.09);border-radius:0 10px 10px 0;color:var(--accent-soft)}
.article ul,.article ol{margin:12px 0 12px 22px}
.article li{margin:5px 0}
.article table{border-collapse:collapse;margin:14px 0;font-size:13px;width:100%}
.article th,.article td{border:1px solid rgba(248,239,226,.18);padding:7px 11px;text-align:left}
.article th{background:rgba(248,239,226,.08)}
.article pre{background:rgba(0,0,0,.4);border:1px solid rgba(248,239,226,.14);border-radius:12px;
  padding:14px;overflow-x:auto;font-size:12.5px;margin:14px 0}
.article iframe{width:100%;height:72vh;border:1px solid rgba(248,239,226,.2);border-radius:12px;background:#fff}
.article .dl{display:inline-block;margin-top:10px;color:var(--accent);font-size:13px;border:1px solid rgba(217,164,78,.45);
  border-radius:999px;padding:6px 16px;text-decoration:none}
.foot{position:relative;z-index:1;text-align:center;font-size:11.5px;color:var(--dim);margin-top:22px;line-height:1.8}
.foot b{color:var(--accent)}
.dead{text-align:center;padding:80px 20px}
.dead .emoji{font-size:44px}
.dead h2{font-size:18px;margin:16px 0 8px}
.dead p{color:var(--dim);font-size:13px}
.nav{display:flex;justify-content:space-between;gap:10px;padding:0 30px 24px}
.nav button{border:1px solid rgba(248,239,226,.22);background:rgba(248,239,226,.07);color:var(--text);
  border-radius:999px;padding:8px 18px;font:inherit;font-size:12.5px;cursor:pointer}
.nav button:disabled{opacity:.35;cursor:default}
@media (max-width:640px){.head,.article,.toc,.nav{padding-left:18px;padding-right:18px}}
</style>
</head>
<body>
<div class="page"><div class="wrap">
  <div class="glass" id="card">
    <div class="dead"><div class="emoji">🔗</div><h2>加载中…</h2><p>正在打开分享的内容</p></div>
  </div>
  <div class="foot">分享自 <b>El Taller de Andres · 安德烈的工坊</b><br><span id="expire"></span></div>
</div></div>
<script>
(function(){
  var token = location.pathname.split("/")[2] || "";
  var card = document.getElementById("card");
  var cur = 0, data = null;
  function esc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
  function fmtExp(t){
    if(!t) return "链接永久有效";
    var d = Math.ceil((t - Date.now()) / 864e5);
    return d > 0 ? "链接 " + d + " 天后失效" : "链接已过期";
  }
  function render(){
    var chs = data.chapter >= 0 ? [{t:"分享章节"}] : data.chapters;
    var toc = data.chapter >= 0 ? "" : '<div class="toc">' + chs.map(function(c,i){
      return '<button data-i="' + i + '" class="' + (i===cur?"on":"") + '">' + esc(c.t) + "</button>";
    }).join("") + "</div>";
    card.innerHTML =
      '<div class="head"><div class="eyebrow">Lectura compartida · 分享阅读</div><h1>' + esc(data.title) + "</h1>" +
      (data.desc ? '<div class="desc">' + esc(data.desc) + "</div>" : "") +
      '<div class="meta">' + (data.chapter >= 0 ? "单章分享" : chs.length + " 章") + " · " + fmtExp(data.expiresAt) + "</div></div>" +
      toc +
      '<div class="article" id="art">正文加载中…</div>' +
      (data.chapter >= 0 ? "" :
        '<div class="nav"><button id="prev">← 上一章</button><button id="next">下一章 →</button></div>');
    document.title = data.title + " · 分享阅读";
    document.getElementById("expire").textContent = fmtExp(data.expiresAt);
    if (data.chapter < 0) {
      card.querySelectorAll(".toc button").forEach(function(b){ b.onclick = function(){ load(+b.dataset.i); }; });
      document.getElementById("prev").onclick = function(){ if(cur>0) load(cur-1); };
      document.getElementById("next").onclick = function(){ if(cur<chs.length-1) load(cur+1); };
    }
    load(cur);
  }
  function load(i){
    cur = i;
    var art = document.getElementById("art");
    art.textContent = "正文加载中…";
    fetch("/api/kb/share/chapter?token=" + encodeURIComponent(token) + "&c=" + i).then(function(r){return r.json()}).then(function(j){
      if(!j || !j.ok){ art.innerHTML = "<p>" + esc((j&&j.error)||"章节加载失败") + "</p>"; return; }
      art.innerHTML = j.html;
      var pb = document.getElementById("prev"), nb = document.getElementById("next");
      if(pb){ pb.disabled = cur<=0; nb.disabled = cur>=data.chapters.length-1; }
      card.querySelectorAll(".toc button").forEach(function(b){ b.classList.toggle("on", +b.dataset.i===cur); });
      window.scrollTo({top:0});
    }).catch(function(){ art.innerHTML = "<p>章节加载失败，请刷新重试</p>"; });
  }
  fetch("/api/kb/share/view?token=" + encodeURIComponent(token)).then(function(r){return r.json()}).then(function(j){
    if(!j || !j.ok){
      card.innerHTML = '<div class="dead"><div class="emoji">🔒</div><h2>链接已失效或过期</h2><p>请向分享者索取新的链接</p></div>';
      document.getElementById("expire").textContent = "";
      return;
    }
    data = j; cur = j.chapter >= 0 ? j.chapter : 0;
    render();
  }).catch(function(){
    card.innerHTML = '<div class="dead"><div class="emoji">⚠️</div><h2>加载失败</h2><p>请刷新重试</p></div>';
  });
})();
</script>
</body></html>`;
}

/* ---------------- 路由 ---------------- */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;
  /* 限速认的真实客户端 IP：经 Nginx 反代（来源是本机回环）时用 X-Real-IP，
     否则用 socket 地址——防止直连者伪造 X-Real-IP 绕过限速 */
  const ra = req.socket.remoteAddress || "?";
  const ip = (ra === "127.0.0.1" || ra === "::1" || ra === "::ffff:127.0.0.1"
    ? String(req.headers["x-real-ip"] || ra)
    : ra
  ).replace("::ffff:", "");
  const log = (status) => console.log(`[${new Date().toLocaleTimeString()}] ${req.method} ${p} → ${status}`);

  try {
    /* ---- 认证 API ---- */
    if (p === "/api/login" && req.method === "POST") {
      const body = await readJson(req);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      const key = ip + "|" + username;
      const lockUntil = loginLocked(key);
      if (lockUntil) {
        const mins = Math.ceil((lockUntil - Date.now()) / 60000);
        json(res, 429, { ok: false, error: `失败次数过多，请 ${mins} 分钟后再试。` });
        return log(429);
      }
      const row = db.prepare("SELECT * FROM users WHERE username=?").get(username);
      const ok = row && verifyPassword(password, row.salt, row.pwhash);
      if (!ok) {
        recordFail(key);
        json(res, 401, { ok: false, error: "用户名或密码不正确。" });
        return log(401);
      }
      fails.delete(key);
      const payload = { u: row.username, r: row.role, mc: !!row.must_change, e: Date.now() + CFG.SESSION_TTL_MS };
      json(res, 200, { ok: true, username: row.username, role: row.role, mustChangePassword: !!row.must_change },
        { "Set-Cookie": sessionCookie(payload, isSecureReq(req)) });
      return log(200);
    }

    if (p === "/api/logout" && req.method === "POST") {
      json(res, 200, { ok: true }, { "Set-Cookie": clearCookie() });
      return log(200);
    }

    if (p === "/api/me" && req.method === "GET") {
      const s = readSession(req);
      if (!s) return json(res, 200, { authenticated: false });
      json(res, 200, { authenticated: true, username: s.u, role: s.r, mustChangePassword: s.mc });
      return log(200);
    }

    if (p === "/api/password" && req.method === "POST") {
      const s = readSession(req);
      if (!s) { json(res, 401, { ok: false, error: "请先登录。" }); return log(401); }
      /* 改密入口同样受防爆破锁定保护（与登录共用 fails 计数） */
      const key = ip + "|" + s.u;
      const lockUntil = loginLocked(key);
      if (lockUntil) {
        const mins = Math.ceil((lockUntil - Date.now()) / 60000);
        json(res, 429, { ok: false, error: `尝试次数过多，请 ${mins} 分钟后再试。` });
        return log(429);
      }
      const body = await readJson(req);
      const next = String(body.next || "");
      if (next.length < 8) { json(res, 400, { ok: false, error: "新密码至少 8 位。" }); return log(400); }
      const row = db.prepare("SELECT * FROM users WHERE username=?").get(s.u);
      if (!row || !verifyPassword(String(body.current || ""), row.salt, row.pwhash)) {
        recordFail(key);
        json(res, 401, { ok: false, error: "当前密码不正确。" });
        return log(401);
      }
      const salt = makeSalt();
      db.prepare("UPDATE users SET pwhash=?, salt=?, must_change=0 WHERE username=?")
        .run(hashPassword(next, salt), salt, s.u);
      fails.delete(key);
      /* 改密 = 全站所有旧会话作废：重建 HMAC 密钥后旧 Cookie 验签全部失败，
         所有已登录者（含本账号其他设备）需重新登录。单人站可接受的语义。 */
      rotateSessionSecret();
      const payload = { u: s.u, r: s.r, mc: false, e: Date.now() + CFG.SESSION_TTL_MS };
      json(res, 200, { ok: true }, { "Set-Cookie": sessionCookie(payload, isSecureReq(req)) });
      return log(200);
    }

    /* ---- 业务 API ---- */
    if (p === "/api/works" && req.method === "GET") {
      const s = readSession(req);
      json(res, 200, { works: filterWorks(loadWorks(), s) });
      return log(200);
    }

    if (p === "/api/kb" && req.method === "GET") {
      const s = readSession(req);
      if (!s) { json(res, 401, { error: "unauthorized" }); return log(401); }
      if (s.mc) { json(res, 403, { error: "请先修改初始密码" }); return log(403); }
      json(res, 200, loadKb());
      return log(200);
    }

    /* ---- Biblioteca 章节按需下发 / 全文搜索（登录可见） ---- */
    if (p === "/api/kb/chapter" && req.method === "GET") {
      const s = readSession(req);
      if (!s) { json(res, 401, { error: "unauthorized" }); return log(401); }
      const b = kbAllBooks().find(x => x.id === u.searchParams.get("b"));
      const ci = parseInt(u.searchParams.get("c") || "0", 10);
      if (!b || !b.chapters[ci]) { json(res, 404, { error: "not found" }); return log(404); }
      const c = b.chapters[ci];
      json(res, 200, { ok: true, book: b.title, es: b.es, title: c.title, html: c.html, idx: ci, total: b.chapters.length });
      return log(200);
    }
    if (p === "/api/kb/search" && req.method === "GET") {
      const s = readSession(req);
      if (!s) { json(res, 401, { error: "unauthorized" }); return log(401); }
      const q = (u.searchParams.get("q") || "").trim().toLowerCase();
      if (q.length < 2) { json(res, 200, { ok: true, total: 0, results: [], marks: [] }); return log(200); }
      const allBooks = kbAllBooks();
      const out = [];
      for (const b of allBooks) {
        b.chapters.forEach((c, ci) => {
          const inTitle = c.title.toLowerCase().includes(q);
          const text = c.text || c.html || "";
          const pos = text.toLowerCase().indexOf(q);
          if (inTitle || pos >= 0) {
            const start = Math.max(0, pos > 40 ? pos - 40 : 0);
            out.push({ b: b.id, bTitle: b.title, c: ci, cTitle: c.title, inTitle,
              snip: inTitle ? "" : "…" + text.substr(start, 90).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() + "…" });
          }
        });
        if (out.length >= 200) break;
      }
      /* 我的划线也进搜索（quote/note/ask/answer 命中，跳深链定位高亮） */
      const smarks = kbMarks.marks
        .filter(m => m.u === s.u && (m.quote + "\n" + m.note + "\n" + m.ask + "\n" + m.answer).toLowerCase().includes(q))
        .sort((a, b) => b.at - a.at).slice(0, 20)
        .map(m => {
          const b = allBooks.find(x => x.id === m.b);
          return { id: m.id, b: m.b, c: m.c, bTitle: b ? b.title : "（书已移除）",
            cTitle: b && b.chapters[m.c] ? b.chapters[m.c].title : "", quote: m.quote, note: m.note || "", ask: m.ask || "" };
        });
      json(res, 200, { ok: true, total: out.length, results: out.slice(0, 80), marks: smarks });
      return log(200);
    }

    /* ---- Biblioteca 上传收录（admin 上传；文件服务登录可见） ---- */
    if (p === "/api/kb/upload" && (req.method === "POST" || req.method === "DELETE")) {
      const s = readSession(req);
      if (!s || s.r !== "admin") { json(res, s ? 403 : 401, { ok: false, error: s ? "forbidden" : "unauthorized" }); return log(s ? 403 : 401); }
      if (req.method === "DELETE") {
        const e = kbUploads[u.searchParams.get("id") || ""];
        if (!e) { json(res, 404, { ok: false, error: "not found" }); return log(404); }
        try { fs.unlinkSync(path.join(KB_UPLOAD_DIR, e.file)); } catch {}
        if (e.pdfFile) { try { fs.unlinkSync(path.join(KB_UPLOAD_DIR, e.pdfFile)); } catch {} }
        delete kbUploadParsed[e.id];
        delete kbUploads[e.id];
        delete kbCats["up-" + e.id];
        saveJson(KB_UPLOAD_FILE, kbUploads);
        saveJson(KB_CAT_FILE, kbCats);
        json(res, 200, { ok: true });
        return log(200);
      }
      /* POST：raw body = 文件字节（≤25MB），x-file-name 头传 URL 编码文件名 */
      const raw = String(req.headers["x-file-name"] || "");
      let fname = raw;
      try { fname = decodeURIComponent(raw); } catch {}
      fname = fname.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80).trim();
      const ext = (/\.md$/i.test(fname)) ? ".md" : (/\.pdf$/i.test(fname)) ? ".pdf" : "";
      if (!ext) { json(res, 400, { ok: false, error: "仅支持 .md / .pdf 文件" }); return log(400); }
      let buf;
      try { buf = await readRawBody(req, 25 * 1024 * 1024); }
      catch { json(res, 413, { ok: false, error: "文件超过 25MB 上限" }); return log(413); }
      if (!buf.length) { json(res, 400, { ok: false, error: "空文件" }); return log(400); }
      if (!fs.existsSync(KB_UPLOAD_DIR)) fs.mkdirSync(KB_UPLOAD_DIR, { recursive: true });
      const id = "u" + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36);
      const file = id + ext;
      fs.writeFileSync(path.join(KB_UPLOAD_DIR, file), buf);
        kbUploads[id] = { id, title: fname, file, type: ext.slice(1), size: buf.length, at: Date.now(), state: "new" };
        saveJson(KB_UPLOAD_FILE, kbUploads);
        kbClassifyQueue();   /* 新上传入队自动分类 */
        if (ext === ".pdf") kbPdfTranslateEnqueue(id);   /* PDF 入队自动转中英对照 */
        json(res, 200, { ok: true, id, title: fname, books: kbUploadBooks().length });
      return log(200);
    }

    /* ---- 分享链接管理（仅 admin）：建 / 列 / 吊销 ---- */
    if (p === "/api/kb/share" && req.method === "POST") {
      const s = readSession(req);
      if (!s || s.r !== "admin") { json(res, s ? 403 : 401, { ok: false, error: s ? "forbidden" : "unauthorized" }); return log(s ? 403 : 401); }
      const body = await readJson(req);
      const book = String(body.book || "");
      const b = kbAllBooks().find(x => x.id === book);
      if (!b) { json(res, 400, { ok: false, error: "书不存在" }); return log(400); }
      const chapter = body.chapter === -1 || body.chapter === "-1" ? -1 : parseInt(body.chapter, 10);
      if (!(chapter >= -1 && chapter < b.chapters.length)) { json(res, 400, { ok: false, error: "章节范围错误" }); return log(400); }
      const days = [0, 7, 30, 90].includes(body.days) ? body.days : 30;
      const token = crypto.randomBytes(12).toString("base64url");
      kbShares[token] = { token, book, chapter, days, createdAt: Date.now(),
        expiresAt: days ? Date.now() + days * 86400e3 : 0, by: s.u, title: b.title, revoked: false };
      saveJson(KB_SHARE_FILE, kbShares);
      json(res, 200, { ok: true, token, url: "/s/" + token, expiresAt: kbShares[token].expiresAt });
      return log(200);
    }
    if (p === "/api/kb/shares" && req.method === "GET") {
      const s = readSession(req);
      if (!s || s.r !== "admin") { json(res, s ? 403 : 401, { ok: false, error: s ? "forbidden" : "unauthorized" }); return log(s ? 403 : 401); }
      const now = Date.now();
      json(res, 200, { items: Object.values(kbShares).map(sh => ({
        token: sh.token, book: sh.book, title: sh.title, chapter: sh.chapter, days: sh.days,
        createdAt: sh.createdAt, expiresAt: sh.expiresAt,
        status: sh.revoked ? "revoked" : (sh.expiresAt && now > sh.expiresAt ? "expired" : "active"),
      })).sort((a, b) => b.createdAt - a.createdAt) });
      return log(200);
    }
    if (p === "/api/kb/share" && req.method === "DELETE") {
      const s = readSession(req);
      if (!s || s.r !== "admin") { json(res, s ? 403 : 401, { ok: false, error: s ? "forbidden" : "unauthorized" }); return log(s ? 403 : 401); }
      const tok = String(u.searchParams.get("token") || "");
      if (!kbShares[tok]) { json(res, 404, { ok: false, error: "not found" }); return log(404); }
      delete kbShares[tok];
      saveJson(KB_SHARE_FILE, kbShares);
      json(res, 200, { ok: true });
      return log(200);
    }

    /* 书本删除：静态书=进运行时屏蔽名单（源文件不动，可恢复）；lectura=清空对照阅读收录；
       上传/收集书各有专用接口；图鉴书由每日情报自动生成，拒删 */
    if (p === "/api/kb/book" && req.method === "DELETE") {
      const s = readSession(req);
      if (!s || s.r !== "admin") { json(res, s ? 403 : 401, { ok: false, error: s ? "forbidden" : "unauthorized" }); return log(s ? 403 : 401); }
      const id = String(u.searchParams.get("id") || "");
      if (!id) { json(res, 400, { ok: false, error: "缺少 id" }); return log(400); }
      if (id === "hw-devices") { json(res, 400, { ok: false, error: "图鉴书由每日情报自动生成，不能删除" }); return log(400); }
      if (id.startsWith("up-") || id.startsWith("col-")) { json(res, 400, { ok: false, error: "上传/收集书请走各自删除接口" }); return log(400); }
      if (id === "lectura") {
        const n = Object.keys(wbBiblio).length;
        if (!n) { json(res, 404, { ok: false, error: "not found（本书当前为空）" }); return log(404); }
        for (const k of Object.keys(wbBiblio)) delete wbBiblio[k];
        saveJson(WB_FILE.biblio, wbBiblio);
        json(res, 200, { ok: true, removed: n });
        return log(200);
      }
      const book = kbFullBooks().find(b => b.id === id);
      if (!book) { json(res, 404, { ok: false, error: "not found" }); return log(404); }
      const first = !kbRemoved.has(id);
      kbRemoved.add(id);
      saveJson(KB_REMOVED_FILE, { ids: [...kbRemoved] });
      /* 类别条目保留：恢复这本书时分类还在 */
      json(res, 200, { ok: true, title: book.title, first });
      return log(200);
    }

    /* 手动改类（admin；白名单校验；manual 永不被自动分类覆盖） */
    if (p === "/api/kb/category" && req.method === "PUT") {
      const s = readSession(req);
      if (!s || s.r !== "admin") { json(res, s ? 403 : 401, { ok: false, error: s ? "forbidden" : "unauthorized" }); return log(s ? 403 : 401); }
      const body = await readJson(req);
      const id = String(body.id || "");
      const cat = String(body.cat || "");
      if (!KB_CATS.includes(cat)) { json(res, 400, { ok: false, error: "类别需在七类白名单内" }); return log(400); }
      if (!kbAllBooks().some(b => b.id === id)) { json(res, 404, { ok: false, error: "not found" }); return log(404); }
      kbCats[id] = { cat, by: "manual", at: Date.now() };
      saveJson(KB_CAT_FILE, kbCats);
      json(res, 200, { ok: true, cat });
      return log(200);
    }

    /* 待处理队列：keep=要（留库）/ discard=不要（删书删文件）/ note=写了评论（算看过，附站主笔记） */
    if (p === "/api/kb/triage" && req.method === "POST") {
      const s = readSession(req);
      if (!s || s.r !== "admin") { json(res, s ? 403 : 401, { ok: false, error: s ? "forbidden" : "unauthorized" }); return log(s ? 403 : 401); }
      const body = await readJson(req);
      const e = kbUploads[String(body.id || "")];
      const act = String(body.act || "");
      if (!e || !["keep", "discard", "note"].includes(act)) { json(res, 400, { ok: false, error: "bad request" }); return log(400); }
      if (act === "discard") {
        try { fs.unlinkSync(path.join(KB_UPLOAD_DIR, e.file)); } catch {}
        if (e.pdfFile) { try { fs.unlinkSync(path.join(KB_UPLOAD_DIR, e.pdfFile)); } catch {} }
        delete kbUploadParsed[e.id];
        delete kbUploads[e.id];
        saveJson(KB_UPLOAD_FILE, kbUploads);
        json(res, 200, { ok: true, discarded: true });
        return log(200);
      }
      if (act === "note") {
        const note = String(body.note || "").trim().slice(0, 500);
        if (!note) { json(res, 400, { ok: false, error: "评论内容为空" }); return log(400); }
        e.note = note;
      }
      e.state = "keep";
      e.readAt = Date.now();
      saveJson(KB_UPLOAD_FILE, kbUploads);
      json(res, 200, { ok: true, id: e.id });
      return log(200);
    }

    /* ---- 视频收集桥：提交/查状态/重试（admin 会话） + 领取/回传（collectToken） ---- */
    if (p === "/api/kb/collect" && (req.method === "POST" || req.method === "GET" || req.method === "DELETE")) {
      const s = readSession(req);
      if (!s || s.r !== "admin") { json(res, s ? 403 : 401, { ok: false, error: s ? "forbidden" : "unauthorized" }); return log(s ? 403 : 401); }
      if (req.method === "GET") {
        kbCollectSweep();
        json(res, 200, { ok: true, items: kbCollect.items.slice().sort((a, b) => b.at - a.at) });
        return log(200);
      }
      if (req.method === "DELETE") {
        const idx = kbCollect.items.findIndex(i => i.id === String(u.searchParams.get("id") || ""));
        if (idx < 0) { json(res, 404, { ok: false, error: "not found" }); return log(404); }
        delete kbCats["col-" + kbCollect.items[idx].id];
        kbCollect.items.splice(idx, 1);
        saveJson(KB_COLLECT_FILE, kbCollect);
        saveJson(KB_CAT_FILE, kbCats);
        json(res, 200, { ok: true });
        return log(200);
      }
      const body = await readJson(req);
      const url = String(body.url || "").trim();
      if (!/^https?:\/\/(www\.)?(bilibili\.com\/video\/|b23\.tv\/)\S*$/i.test(url)) {
        json(res, 400, { ok: false, error: "仅支持 B 站视频链接（bilibili.com/video 或 b23.tv）" }); return log(400);
      }
      const dup = kbCollect.items.find(i => i.url === url && i.state !== "failed");
      if (dup) {
        json(res, 409, { ok: false, error: dup.state === "pending" ? "该链接已在收集队列中" : "该链接已于 " + new Date(dup.doneAt || dup.at).toLocaleString() + " 收录过" });
        return log(409);
      }
      const it = { id: "c" + Date.now().toString(36) + Math.floor(Math.random() * 1e3).toString(36), url, title: "", state: "pending", at: Date.now() };
      kbCollect.items.push(it);
      saveJson(KB_COLLECT_FILE, kbCollect);
      json(res, 200, { ok: true, id: it.id });
      return log(200);
    }
    if (p === "/api/kb/collect/retry" && req.method === "POST") {
      const s = readSession(req);
      if (!s || s.r !== "admin") { json(res, s ? 403 : 401, { ok: false }); return log(s ? 403 : 401); }
      const body = await readJson(req);
      const it = kbCollect.items.find(i => i.id === String(body.id || ""));
      if (!it || it.state !== "failed") { json(res, 404, { ok: false, error: "not found" }); return log(404); }
      it.state = "pending"; it.at = Date.now(); delete it.error;
      saveJson(KB_COLLECT_FILE, kbCollect);
      json(res, 200, { ok: true });
      return log(200);
    }
    if (p === "/api/kb/collect/pending" && req.method === "GET") {
      const tok = String(u.searchParams.get("token") || req.headers["x-collect-token"] || "");
      const expect = String(wbCfg.collectToken || "");
      const a = Buffer.from(tok), b = Buffer.from(expect);
      if (!expect || a.length !== b.length || !crypto.timingSafeEqual(a, b)) { json(res, 401, { ok: false, error: "unauthorized" }); return log(401); }
      kbCollectSweep();
      json(res, 200, { ok: true, items: kbCollect.items.filter(i => i.state === "pending").map(i => ({ id: i.id, url: i.url })) });
      return log(200);
    }
    if (p === "/api/kb/collect/done" && req.method === "POST") {
      const tok = String(req.headers["x-collect-token"] || req.headers["x-token"] || "");
      const expect = String(wbCfg.collectToken || "");
      const a = Buffer.from(tok), b = Buffer.from(expect);
      if (!expect || a.length !== b.length || !crypto.timingSafeEqual(a, b)) { json(res, 401, { ok: false, error: "unauthorized" }); return log(401); }
      /* 回传的 md 可达数百 KB，readJson 只吃 16KB —— 走 raw body 再解析 */
      let body;
      try { body = JSON.parse((await readRawBody(req, 700 * 1024)).toString("utf8")); }
      catch { json(res, 400, { ok: false, error: "bad json / body 超过 700KB" }); return log(400); }
      const it = kbCollect.items.find(i => i.id === String(body.id || ""));
      if (!it) { json(res, 404, { ok: false, error: "not found" }); return log(404); }
      if (it.state !== "pending") { json(res, 409, { ok: false, error: "该任务已处理过（" + it.state + "）" }); return log(409); }
      if (body.ok) {
        const md = String(body.md || "");
        if (!md.trim()) { json(res, 400, { ok: false, error: "md 为空" }); return log(400); }
        const CAP = 600 * 1024;
        it.md = md.length > CAP ? md.slice(0, CAP) + "\n\n[内容超长已截断]" : md;
        it.title = String(body.title || "").trim().slice(0, 120) || "未命名视频";
        it.state = "done";
      } else {
        it.state = "failed";
        it.error = String(body.error || "未知原因").slice(0, 300);
      }
      it.doneAt = Date.now();
      saveJson(KB_COLLECT_FILE, kbCollect);
      if (it.state === "done") kbClassifyQueue();   /* 新收集成书入队自动分类 */
      json(res, 200, { ok: true });
      return log(200);
    }

    if (/^\/api\/kb\/file\/[\w.-]+$/.test(p) && req.method === "GET") {
      const s = readSession(req);
      if (!s) { json(res, 401, { error: "unauthorized" }); return log(401); }
      const file = p.slice("/api/kb/file/".length);
      if (!Object.values(kbUploads).some(e => e.file === file)) { json(res, 404, { error: "not found" }); return log(404); }
      const abs = path.join(KB_UPLOAD_DIR, path.basename(file));
      if (!fs.existsSync(abs)) { json(res, 404, { error: "not found" }); return log(404); }
      send(res, 200, fs.readFileSync(abs), {
        "Content-Type": file.endsWith(".pdf") ? "application/pdf" : "text/markdown; charset=utf-8",
        "Content-Disposition": "inline; filename*=UTF-8''" + encodeURIComponent(file),
        "Cache-Control": "no-store",
      });
      return log(200);
    }

    /* ---- Biblioteca 划线/页边问答/回顾/进度（gloss 式；登录即可用，按用户名隔离） ---- */
    if (p === "/api/kb/marks" && req.method === "GET") {
      const s = readSession(req);
      if (!s) { json(res, 401, { ok: false, error: "unauthorized" }); return log(401); }
      let rows = kbMarks.marks.filter(m => m.u === s.u);
      const b = u.searchParams.get("b");
      if (b) {
        const c = u.searchParams.get("c");
        rows = rows.filter(m => m.b === b && (!c || m.c === parseInt(c, 10)));
      }
      json(res, 200, { ok: true, marks: rows });
      return log(200);
    }
    if (p === "/api/kb/marks" && req.method === "POST") {
      const s = readSession(req);
      if (!s) { json(res, 401, { ok: false, error: "unauthorized" }); return log(401); }
      if (kbMarks.marks.filter(m => m.u === s.u).length >= KB_MARKS_CAP) {
        json(res, 400, { ok: false, error: "划线已达上限（" + KB_MARKS_CAP + " 条），请先清理" }); return log(400);
      }
      const body = await readJson(req);
      const b = String(body.b || ""), c = parseInt(body.c, 10);
      const book = kbAllBooks().find(x => x.id === b);
      if (!book || !(c >= 0) || !book.chapters[c]) { json(res, 404, { ok: false, error: "not found" }); return log(404); }
      const quote = String(body.quote || "").trim().slice(0, 200);
      if (!quote) { json(res, 400, { ok: false, error: "划线内容为空" }); return log(400); }
      const m = { id: kbMarkId(), u: s.u, b, c,
        quote, pre: String(body.pre || "").slice(0, 30), suf: String(body.suf || "").slice(0, 30),
        note: String(body.note || "").trim().slice(0, 500), ask: "", answer: "",
        at: Date.now(), box: 0, due: Date.now(), ok: 0, miss: 0 };
      kbMarks.marks.push(m);
      kbMarkSave();
      json(res, 200, { ok: true, mark: m });
      return log(200);
    }
    if (p === "/api/kb/marks" && req.method === "PUT") {
      const s = readSession(req);
      if (!s) { json(res, 401, { ok: false, error: "unauthorized" }); return log(401); }
      const body = await readJson(req);
      const m = kbMarks.marks.find(x => x.id === String(body.id || "") && x.u === s.u);
      if (!m) { json(res, 404, { ok: false, error: "not found" }); return log(404); }
      m.note = String(body.note || "").trim().slice(0, 500);
      kbMarkSave();
      json(res, 200, { ok: true, mark: m });
      return log(200);
    }
    if (p === "/api/kb/marks" && req.method === "DELETE") {
      const s = readSession(req);
      if (!s) { json(res, 401, { ok: false, error: "unauthorized" }); return log(401); }
      const i = kbMarks.marks.findIndex(x => x.id === String(u.searchParams.get("id") || "") && x.u === s.u);
      if (i < 0) { json(res, 404, { ok: false, error: "not found" }); return log(404); }
      kbMarks.marks.splice(i, 1);
      kbMarkSave();
      json(res, 200, { ok: true });
      return log(200);
    }
    /* 页边问读：整章上下文 GLM 作答，自动存成带问答的划线（每用户冷却 + in-flight 互斥） */
    if (p === "/api/kb/ask" && req.method === "POST") {
      const s = readSession(req);
      if (!s) { json(res, 401, { ok: false, error: "unauthorized" }); return log(401); }
      const last = kbAskLast.get(s.u);
      if (last === -1) { json(res, 429, { ok: false, error: "上一个问题还在回答中，稍候片刻" }); return log(429); }
      if (last && Date.now() - last < KB_ASK_GAP_MS) {
        json(res, 429, { ok: false, error: "提问太快啦，歇 " + Math.ceil((KB_ASK_GAP_MS - (Date.now() - last)) / 1000) + " 秒再问" }); return log(429);
      }
      if (kbMarks.marks.filter(m => m.u === s.u).length >= KB_MARKS_CAP) {
        json(res, 400, { ok: false, error: "划线已达上限（" + KB_MARKS_CAP + " 条），请先清理" }); return log(400);
      }
      const body = await readJson(req);
      const b = String(body.b || ""), c = parseInt(body.c, 10);
      const book = kbAllBooks().find(x => x.id === b);
      if (!book || !(c >= 0) || !book.chapters[c]) { json(res, 404, { ok: false, error: "not found" }); return log(404); }
      const quote = String(body.quote || "").trim().slice(0, 200), question = String(body.question || "").trim().slice(0, 200);
      if (!quote || !question) { json(res, 400, { ok: false, error: "缺少选中文字或问题" }); return log(400); }
      if (!wbCfg.glmKey) { json(res, 503, { ok: false, error: "服务端未配置 GLM Key" }); return log(503); }
      kbAskLast.set(s.u, -1);
      try {
        const answer = await kbAskAnswer(book, c, book.chapters[c], quote, question);
        const m = { id: kbMarkId(), u: s.u, b, c,
          quote, pre: String(body.pre || "").slice(0, 30), suf: String(body.suf || "").slice(0, 30),
          note: "", ask: question, answer, at: Date.now(), box: 0, due: Date.now(), ok: 0, miss: 0 };
        kbMarks.marks.push(m);
        kbMarkSave();
        kbAskLast.set(s.u, Date.now());
        json(res, 200, { ok: true, mark: m });
        return log(200);
      } catch (e) {
        kbAskLast.set(s.u, Date.now() - KB_ASK_GAP_MS + 2000);   /* 失败只缓 2 秒再试 */
        json(res, 502, { ok: false, error: "GLM 暂时不可用：" + ((e && e.message) || "未知错误") });
        return log(502);
      }
    }
    /* 每日回顾：Leitner 盒子（ok=升盒按间隔排期 / so=原地 1 天 / miss=归零当天再来） */
    if (p === "/api/kb/marks/review" && req.method === "POST") {
      const s = readSession(req);
      if (!s) { json(res, 401, { ok: false, error: "unauthorized" }); return log(401); }
      const body = await readJson(req);
      const m = kbMarks.marks.find(x => x.id === String(body.id || "") && x.u === s.u);
      const g = String(body.grade || "");
      if (!m || !["ok", "so", "miss"].includes(g)) { json(res, 400, { ok: false, error: "bad request" }); return log(400); }
      if (g === "ok") { m.ok = (m.ok || 0) + 1; m.box = Math.min(5, (m.box || 0) + 1); m.due = Date.now() + KB_SRS_DAYS[m.box] * 86400e3; }
      else if (g === "so") { m.due = Date.now() + 86400e3; }
      else { m.miss = (m.miss || 0) + 1; m.box = 0; m.due = Date.now(); }
      kbMarkSave();
      json(res, 200, { ok: true, box: m.box, due: m.due });
      return log(200);
    }
    /* 今日到期队列（≤5 条，不足用最近的划线补——gloss：每天都有回顾） */
    if (p === "/api/kb/marks/due" && req.method === "GET") {
      const s = readSession(req);
      if (!s) { json(res, 401, { ok: false, error: "unauthorized" }); return log(401); }
      const mine = kbMarks.marks.filter(m => m.u === s.u);
      const due = mine.filter(m => (m.due || 0) <= Date.now()).sort((a, b) => (a.due || 0) - (b.due || 0));
      const list = due.slice(0, 5);
      if (list.length < 5) {
        for (const m of mine.slice().sort((a, b) => (b.at || 0) - (a.at || 0))) {
          if (list.length >= 5) break;
          if (!list.includes(m) && Date.now() - (m.at || 0) > 600e3) list.push(m);
        }
      }
      const books = kbAllBooks();
      const out = list.map(m => {
        const b = books.find(x => x.id === m.b);
        return Object.assign({}, m, { bTitle: b ? b.title : "（书已移除）", cTitle: b && b.chapters[m.c] ? b.chapters[m.c].title : "" });
      });
      json(res, 200, { ok: true, dueTotal: due.length, marks: out });
      return log(200);
    }
    /* 划线导出：Obsidian 友好的 Markdown 附件（书/章分组 + 深链 + 问答/笔记） */
    if (p === "/api/kb/marks/export" && req.method === "GET") {
      const s = readSession(req);
      if (!s) { json(res, 401, { ok: false, error: "unauthorized" }); return log(401); }
      const books = kbAllBooks();
      const host = String(req.headers.host || "tallerdeandres.cn");
      const mine = kbMarks.marks.filter(m => m.u === s.u)
        .sort((a, b) => (a.b === b.b ? (a.c - b.c || (a.at || 0) - (b.at || 0)) : (a.b < b.b ? -1 : 1)));
      const L = ["# La Biblioteca · 我的划线", "", "> 导出于 " + new Date().toLocaleString("zh-CN") + " · 共 " + mine.length + " 条 · El Taller", ""];
      let curB = "", curC = -1;
      for (const m of mine) {
        const b = books.find(x => x.id === m.b);
        const cTitle = b && b.chapters[m.c] ? b.chapters[m.c].title : "（章节已移除）";
        if (m.b !== curB) { curB = m.b; curC = -1; L.push("", "## 📖 " + (b ? b.title : m.b), ""); }
        if (m.c !== curC) { curC = m.c; L.push("### 第 " + (m.c + 1) + " 章 · " + cTitle, ""); }
        L.push("> " + m.quote, "");
        if (m.ask) L.push("**❓ " + m.ask + "**", "", m.answer || "", "");
        if (m.note) L.push("**📝 笔记：**" + m.note, "");
        L.push("🔗 [跳转原文](https://" + host + "/kb.html#b=" + m.b + "&c=" + m.c + "&m=" + m.id + ") · " +
          new Date(m.at || 0).toLocaleDateString("zh-CN") + ((m.box || 0) ? " · 复习盒子 " + m.box : ""), "");
      }
      send(res, 200, L.join("\n"), {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": 'attachment; filename="biblioteca-marcas-' + new Date().toISOString().slice(0, 10) + '.md"',
      });
      return log(200);
    }
    /* 阅读进度：每用户最后读位（GET 查 / POST 记） */
    if (p === "/api/kb/progress" && (req.method === "GET" || req.method === "POST")) {
      const s = readSession(req);
      if (!s) { json(res, 401, { ok: false, error: "unauthorized" }); return log(401); }
      if (req.method === "GET") {
        json(res, 200, { ok: true, progress: kbProgress[s.u] || null });
        return log(200);
      }
      const body = await readJson(req);
      const b = String(body.b || ""), c = parseInt(body.c, 10);
      const book = kbAllBooks().find(x => x.id === b);
      if (!book || !(c >= 0) || !book.chapters[c]) { json(res, 404, { ok: false, error: "not found" }); return log(404); }
      /* 进度 v2：last=书架「继续上次」；books=每书最后读位（书卡「读到第 N 章」+「最近读」排序） */
      const prev = kbProgress[s.u] || {};
      const now = Date.now();
      kbProgress[s.u] = { b, c, at: now, books: Object.assign({}, prev.books, { [b]: { c, at: now } }) };
      saveJson(KB_PROGRESS_FILE, kbProgress);
      json(res, 200, { ok: true });
      return log(200);
    }

    if (p === "/api/weather" && req.method === "GET") {
      await weatherProxy(res);
      return log(200);
    }

    /* ---- Mac 本机命中率上报（launchd 推送，token 鉴权；必须在 admin 守卫之前） ---- */
    if (p === "/api/workbench/hitrate" && req.method === "POST") {
      const tok = String(req.headers["x-wb-token"] || "");
      const expect = String(wbCfg.pushToken || "");
      const a = Buffer.from(tok), b = Buffer.from(expect);
      if (!expect || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        json(res, 401, { ok: false, error: "unauthorized" });
        return log(401);
      }
      const body = await readJson(req);
      const num = v => (typeof v === "number" && isFinite(v)) ? Math.round(v * 10) / 10 : null;
      const hit = { day: num(body.day), all: num(body.all), at: Date.now() };
      if (hit.day == null && hit.all == null) { json(res, 400, { ok: false, error: "无有效数据" }); return log(400); }
      if (wbCache.glm) wbCache.glm.hit = hit;
      else wbCache.glm = { ok: false, error: "等待抓取", at: Date.now(), hit };
      saveJson(WB_FILE.cache, wbCache);
      json(res, 200, { ok: true });
      return log(200);
    }

    /* ---- 日历订阅源（iPhone/ICSx⁵ 订阅，token 鉴权；必须在 admin 守卫之前） ---- */
    if (p === "/api/workbench/calendar.ics" && req.method === "GET") {
      const tok = String(u.searchParams.get("token") || "");
      const expect = String(wbCfg.pushToken || "");
      const a = Buffer.from(tok), b = Buffer.from(expect);
      if (!expect || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        json(res, 401, { error: "unauthorized" });
        return log(401);
      }
      send(res, 200, buildCalendarICS(), { "Content-Type": "text/calendar; charset=utf-8" });
      return log(200);
    }

    /* ---- 智能硬件·每日情报（Mac openclaw「taller-硬件情报站」领取/回传，hwToken 鉴权；必须在 admin 守卫之前） ---- */
    if (p === "/api/workbench/hw/pending" && req.method === "GET") {
      const tok = String(u.searchParams.get("token") || "");
      const expect = String(wbCfg.hwToken || "");
      const a = Buffer.from(tok), b = Buffer.from(expect);
      if (!expect || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        json(res, 401, { ok: false, error: "unauthorized" });
        return log(401);
      }
      const latest = hwLatest();
      const recentUrls = [];
      for (const d of hwStore.days.slice(0, 3)) for (const l of d.links || []) recentUrls.push(l.u);
      /* B站 UP 最新视频直接带出（服务器已有 cookie+wbi 签名链路，收集任务无需再碰 B站 API） */
      const bili = ((wbCache.bili && wbCache.bili.items) || []).map(v => ({
        up: v.name, title: v.title, url: "https://www.bilibili.com/video/" + v.bv,
      }));
      json(res, 200, {
        /* 出报时点拦门：北京时间 05:00 前不算「今日缺报」——Mac 端 30 分钟轮询零改动，05:00 后首次轮询触发出报；
           Mac 睡过 05:00 则唤醒后的首次轮询补跑，不丢天 */
        ok: true, need: !(latest && latest.date === hwToday()) && bjWall(Date.now()).hh >= 5, date: hwToday(),
        ups: wbCfg.biliUps, watch: hwStore.watch, recentUrls, bili,
        devices: hwDevices.devices.map(d => ({ name: d.name, cat: d.cat, lens: d.lens, status: d.status, firstSeen: d.firstSeen })),
      });
      return log(200);
    }
    if (p === "/api/workbench/hw/done" && req.method === "POST") {
      const tok = String(req.headers["x-hw-token"] || "");
      const expect = String(wbCfg.hwToken || "");
      const a = Buffer.from(tok), b = Buffer.from(expect);
      if (!expect || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        json(res, 401, { ok: false, error: "unauthorized" });
        return log(401);
      }
      let body;
      try { body = JSON.parse((await readRawBody(req, 300 * 1024)).toString("utf8")); }
      catch (e) { json(res, 400, { ok: false, error: e && e.message === "too large" ? "body 超过 300KB" : "bad json" }); return log(400); }
      const date = String(body.date || "");
      if (date !== hwToday() && date !== hwYesterday()) {
        json(res, 400, { ok: false, error: "date 需为今日或昨日（以 /pending 返回的 date 为准）" });
        return log(400);
      }
      const entry = hwSanitize(body, date);
      if (!entry.summary && !entry.links.length) { json(res, 400, { ok: false, error: "summary 与 links 至少要有一项" }); return log(400); }
      hwStore.days = hwStore.days.filter(d => d.date !== date);
      hwStore.days.push(entry);
      if (Array.isArray(body.watch)) {   /* 动态基线：增量合并观察机型，留最新 30 个 */
        const seen = new Set(hwStore.watch.map(s => String(s).toLowerCase()));
        for (const m of body.watch) {
          const v = String(m || "").replace(/\s+/g, " ").trim().slice(0, 60);
          if (v && !seen.has(v.toLowerCase())) { hwStore.watch.push(v); seen.add(v.toLowerCase()); }
        }
        hwStore.watch = hwStore.watch.slice(-30);
      }
      hwPrune();
      saveJson(WB_FILE.hw, hwStore);
      hwMergeDevices(body.devices, date, entry.prices);   /* 图鉴合并（含保值组价格自动挂轨） */
      saveJson(HW_DEV_FILE, hwDevices);
      json(res, 200, { ok: true, date: entry.date, links: entry.links.length, watch: hwStore.watch.length, devices: hwDevices.devices.length });
      return log(200);
    }

    /* ---- 小红书粉丝监控（Mac launchd「taller-小红书粉丝」回传，xhsToken 鉴权；必须在 admin 守卫之前） ---- */
    if (p === "/api/workbench/xhs/done" && req.method === "POST") {
      const tok = String(req.headers["x-xhs-token"] || "");
      const expect = String(wbCfg.xhsToken || "");
      const a = Buffer.from(tok), b = Buffer.from(expect);
      if (!expect || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        json(res, 401, { ok: false, error: "unauthorized" });
        return log(401);
      }
      let body;
      try { body = JSON.parse((await readRawBody(req, 8 * 1024)).toString("utf8")); }
      catch (e) { json(res, 400, { ok: false, error: "bad json" }); return log(400); }
      const r = xhsApply(body);
      json(res, r.ok ? 200 : 400, r);
      return log(r.ok ? 200 : 400);
    }

    /* ---- 工作台 API（仅 admin） ---- */
    if (p.startsWith("/api/workbench/")) {
      const ws = readSession(req);
      if (!ws) { json(res, 401, { error: "unauthorized" }); return log(401); }
      if (ws.mc) { json(res, 403, { error: "请先修改初始密码" }); return log(403); }
      if (ws.r !== "admin") { json(res, 403, { error: "forbidden" }); return log(403); }

      if (p === "/api/workbench/data" && req.method === "GET") {
        const upBooks = kbUploadBooks();
        json(res, 200, {
          cfg: { hasKey: !!wbCfg.glmKey, hasCookie: !!wbCfg.biliCookie, ups: wbCfg.biliUps, profile: wbCfg.arxivProfile },
          data: wbCache,
          hw: hwLatest(),
          xhs: xhsSnapshot(),
          hwDevices: hwDevices.devices.length,
          dislikes: wbDislikes,
          kbInbox: Object.values(kbUploads).filter(u => u.state === "new").sort((a, b) => a.at - b.at).map(u => {
            const b = upBooks.find(x => x.id === "up-" + u.id);
            return { id: u.id, title: u.title, type: u.type, at: u.at, chapters: b ? b.chapters.length : 0 };
          }),
          sched: Object.fromEntries(Object.entries(wbSched).map(([k, s]) => [k, { busy: s.busy, nextAt: s.nextAt }])),
          now: Date.now(),
        });
        return log(200);
      }

      /* 硬件图鉴全量（弹窗视图用；只读，写路径在 done 合并） */
      if (p === "/api/workbench/hw/devices" && req.method === "GET") {
        json(res, 200, { devices: hwDevices.devices, now: Date.now() });
        return log(200);
      }

      if (p === "/api/workbench/refresh" && req.method === "POST") {
        const body = await readJson(req);
        const sec = String(body.section || "");
        if (!WB_INTERVALS[sec]) { json(res, 400, { ok: false, error: "unknown section" }); return log(400); }
        wbRun(sec).catch(e => console.error("[workbench]", sec, e.message));   // 后台执行，不 await
        json(res, 200, { ok: true, started: true });
        return log(200);
      }

      if (p === "/api/workbench/config" && req.method === "POST") {
        const body = await readJson(req);
        if (typeof body.glmKey === "string" && body.glmKey.trim()) wbCfg.glmKey = body.glmKey.trim();
        if (typeof body.biliCookie === "string" && body.biliCookie.trim()) wbCfg.biliCookie = body.biliCookie.trim();
        if (Array.isArray(body.biliUps)) {
          wbCfg.biliUps = body.biliUps
            .map(u => ({ uid: String((u && u.uid) || "").trim(), name: String((u && u.name) || "").trim() }))
            .filter(u => u.uid);
        }
        if (typeof body.arxivProfile === "string" && body.arxivProfile.trim()) wbCfg.arxivProfile = body.arxivProfile.trim();
        saveJson(WB_FILE.cfg, wbCfg);
        json(res, 200, { ok: true, hasKey: !!wbCfg.glmKey, hasCookie: !!wbCfg.biliCookie, ups: wbCfg.biliUps.length });
        return log(200);
      }

      if (p === "/api/workbench/log" && req.method === "GET") {
        json(res, 200, { items: wbLog.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0)) });
        return log(200);
      }
      if (p === "/api/workbench/log" && req.method === "POST") {
        const body = await readJson(req);
        const text = String(body.text || "").trim();
        if (!text) { json(res, 400, { ok: false, error: "内容不能为空" }); return log(400); }
        let date = String(body.date || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = dstr(new Date());
        const project = String(body.project || "").trim().slice(0, 24);
        wbLog.push({ id: "l-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), date,
          text: text.slice(0, 2000), ...(project ? { project } : {}), createdAt: Date.now() });
        saveJson(WB_FILE.log, wbLog);
        json(res, 200, { ok: true });
        return log(200);
      }
      if (p === "/api/workbench/log" && req.method === "DELETE") {
        const id = u.searchParams.get("id") || "";
        const before = wbLog.length;
        wbLog = wbLog.filter(e => e.id !== id);
        saveJson(WB_FILE.log, wbLog);
        json(res, 200, { ok: true, removed: before - wbLog.length });
        return log(200);
      }

      if (p === "/api/workbench/comments" && req.method === "GET") {
        json(res, 200, { items: Object.values(wbComments).sort((a, b) => b.createdAt - a.createdAt) });
        return log(200);
      }
      if (p === "/api/workbench/comment" && req.method === "PUT") {
        const body = await readJson(req);
        const url = String(body.url || "").trim();
        if (!url) { json(res, 400, { ok: false, error: "缺少条目 URL" }); return log(400); }
        const text = String(body.text || "").trim();
        /* anth/arxiv 的评论 = 触发收进 Biblioteca（后台执行，首次要抓正文+翻译可能要几十秒） */
        const wantPromote = ["anth", "arxiv"].includes(body.source) || !!wbBiblio[url];
        if (!text) {
          delete wbComments[url];   // 清空文本 = 删除评论
          saveJson(WB_FILE.comments, wbComments);
          if (wantPromote) promoteArticle(url).catch(() => {});   // 同步更新条目（文章保留）
          json(res, 200, { ok: true, removed: true });
          return log(200);
        }
        wbComments[url] = {
          url,
          source: ["bili", "anth", "arxiv"].includes(body.source) ? body.source : "",
          title: String(body.title || "").slice(0, 200),
          text: text.slice(0, 2000),
          createdAt: Date.now(),
        };
        saveJson(WB_FILE.comments, wbComments);
        if (wantPromote) promoteArticle(url).catch(() => {});
        json(res, 200, { ok: true });
        return log(200);
      }

      if (p === "/api/workbench/dislike" && req.method === "PUT") {
        /* 不感兴趣（可撤销）：强降权未来推荐（进 arXiv 选文 prompt）、永不进 Biblioteca、
           已收录的立即退出、正文缓存即清 */
        const body = await readJson(req);
        const url = String(body.url || "").trim();
        if (!/^https?:\/\//.test(url)) { json(res, 400, { ok: false, error: "缺少文章 URL" }); return log(400); }
        if (body.undo) {
          delete wbDislikes[url];
          saveJson(WB_FILE.dislikes, wbDislikes);
          json(res, 200, { ok: true, disliked: false });
          return log(200);
        }
        wbDislikes[url] = {
          url,
          source: ["anth", "arxiv"].includes(body.source) ? body.source : "",
          title: String(body.title || "").slice(0, 200),
          at: Date.now(),
        };
        if (wbBiblio[url]) { delete wbBiblio[url]; saveJson(WB_FILE.biblio, wbBiblio); }
        if (wbReader[url]) { delete wbReader[url]; saveJson(WB_FILE.reader, wbReader); }
        saveJson(WB_FILE.dislikes, wbDislikes);
        json(res, 200, { ok: true, disliked: true });
        return log(200);
      }

      if (p === "/api/workbench/article" && req.method === "GET") {
        /* 对照阅读：正文+译文已在预取缓存就绪（首次点开兜底懒加载，约 10~30 秒） */
        const url = String(u.searchParams.get("url") || "").trim();
        if (!/^https?:\/\//.test(url)) { json(res, 400, { ok: false, error: "缺少文章 URL" }); return log(400); }
        let e = null;
        try { e = await readerEnsure(url); } catch {}
        if (!e || !Array.isArray(e.paras) || !e.paras.length) {
          json(res, 200, { ok: false, error: "正文抓取失败或文章已过期清除" });
          return log(200);
        }
        const c = wbComments[url];
        json(res, 200, { ok: true, article: {
          url: e.url, source: e.source, title: e.title, pub: e.pub || "",
          paras: e.paras, firstAt: e.firstAt, fetchedAt: e.fetchedAt,
          promoted: !!((wbBiblio[url] || {}).promotedAt),
          comment: (c && c.text) || "",
          deadline: (e.firstAt || Date.now()) + 3 * 86400e3,
        } });
        return log(200);
      }

      if (p === "/api/workbench/weekly" && req.method === "GET") {
        json(res, 200, { weeks: wbWeekly, current: localWeekRange() });
        return log(200);
      }
      if (p === "/api/workbench/weekly/generate" && req.method === "POST") {
        try {
          const body = await readJson(req);
          const def = localWeekRange();
          const draft = await wbGenerateWeekly(
            /^\d{4}-\d{2}-\d{2}$/.test(body.start || "") ? body.start : def.start,
            /^\d{4}-\d{2}-\d{2}$/.test(body.end || "") ? body.end : def.end);
          json(res, 200, { ok: true, draft });
        } catch (e) {
          json(res, 200, { ok: false, error: e.message === "未配置 GLM Key" ? "未配置 GLM Key，先在下方 Ajustes 填入" : "生成失败：" + (e.message || "未知错误") });
        }
        return log(200);
      }
      if (p === "/api/workbench/weekly/confirm" && req.method === "POST") {
        const body = await readJson(req);
        const start = String(body.start || ""), end = String(body.end || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) {
          json(res, 400, { ok: false, error: "日期格式错误" });
          return log(400);
        }
        const summary = String(body.summary || "").slice(0, 20000);
        const plan = String(body.plan || "").slice(0, 20000);
        if (!summary.trim() || !plan.trim()) { json(res, 400, { ok: false, error: "总结和计划都不能为空" }); return log(400); }
        const key = start + "~" + end;
        const prev = wbWeekly[key] || {};
        // 确认时快照区间内工作记录 id：前端据此隐藏「已总结」记录（旧条目无 logIds 则按区间覆盖回退）
        const logIds = wbLog.filter(e => e.date >= start && e.date <= end).map(e => e.id);
        wbWeekly[key] = { id: key, start, end, range: start + " ~ " + end, summary, plan,
          generatedAt: prev.generatedAt || Date.now(), confirmedAt: Date.now(), logIds };
        saveJson(WB_FILE.weekly, wbWeekly);
        json(res, 200, { ok: true });
        return log(200);
      }

      if (p === "/api/workbench/memos" && req.method === "GET") {
        json(res, 200, { items: wbMemos.slice().sort((a, b) =>
          a.done === b.done ? (a.date.localeCompare(b.date) || a.createdAt - b.createdAt) : (a.done ? 1 : -1)) });
        return log(200);
      }
      if (p === "/api/workbench/memos" && req.method === "POST") {
        const body = await readJson(req);
        const text = String(body.text || "").trim();
        if (!text) { json(res, 400, { ok: false, error: "内容不能为空" }); return log(400); }
        let date = String(body.date || "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) date = dstr(new Date());
        const memo = { id: "m-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36),
          date, text: text.slice(0, 500), done: false, cat: body.cat === "work" ? "work" : "life", createdAt: Date.now() };
        wbMemos.push(memo);
        saveJson(WB_FILE.memos, wbMemos);
        json(res, 200, { ok: true, memo });
        return log(200);
      }
      if (p === "/api/workbench/memos" && req.method === "PUT") {
        const body = await readJson(req);
        const memo = wbMemos.find(m => m.id === String(body.id || ""));
        if (!memo) { json(res, 404, { ok: false, error: "备忘不存在" }); return log(404); }
        if (typeof body.done === "boolean") memo.done = body.done;
        if (body.cat === "work" || body.cat === "life") memo.cat = body.cat;
        saveJson(WB_FILE.memos, wbMemos);
        json(res, 200, { ok: true, memo });
        return log(200);
      }
      if (p === "/api/workbench/memos" && req.method === "DELETE") {
        const id = u.searchParams.get("id") || "";
        const before = wbMemos.length;
        wbMemos = wbMemos.filter(m => m.id !== id);
        saveJson(WB_FILE.memos, wbMemos);
        json(res, 200, { ok: true, removed: before - wbMemos.length });
        return log(200);
      }

      if (p === "/api/workbench/note" && req.method === "POST") {
        const body = await readJson(req);
        if (!String(body.text || "").trim() && !String(body.sourceUrl || "").trim()) {
          json(res, 400, { ok: false, error: "评论和原文链接至少要有一个" });
          return log(400);
        }
        const note = wbAddNote(body);
        json(res, 200, { ok: true, note });
        return log(200);
      }
      if (p === "/api/workbench/note" && req.method === "DELETE") {
        const id = u.searchParams.get("id") || "";
        const before = wbNotes.length;
        wbNotes = wbNotes.filter(n => n.id !== id);
        saveJson(WB_FILE.notes, wbNotes);
        json(res, 200, { ok: true, removed: before - wbNotes.length });
        return log(200);
      }
    }

      if (p === "/api/workbench/holidays" && req.method === "GET") {
        const year = u.searchParams.get("year") || String(new Date().getFullYear());
        const days = await ensureHolidays(year);
        json(res, 200, { year: parseInt(year, 10) || null, days: days || [] });
        return log(200);
      }

      /* ---- 收进日志的笔记：按四级可见性链过滤（同 filterWorks 口径） ---- */
    if (p === "/api/notes-extra" && req.method === "GET") {
      const s = readSession(req);
      const lvl = roleLevel(s);
      const items = wbNotes.filter(n => {
        const need = VIS_LEVEL[n.visibility || "public"];
        return need != null && need <= lvl;
      }).sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.createdAt - a.createdAt);
      json(res, 200, { items });
      return log(200);
    }

    /* ---- 公开分享链接（无登录只读；令牌 96 位熵 + noindex 不进搜索引擎） ---- */
    const shareValidOf = tok => {
      const sh = kbShares[tok];
      if (!sh || sh.revoked) return null;
      if (sh.expiresAt && Date.now() > sh.expiresAt) return null;
      const b = kbAllBooks().find(x => x.id === sh.book);
      return b ? { sh, b } : null;
    };
    if (/^\/s\/[\w-]{8,32}$/.test(p) && req.method === "GET") {
      send(res, 200, Buffer.from(kbSharePage(p.slice(3))), {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      });
      return log(200);
    }
    if (/^\/s\/[\w-]{8,32}\/f\/[\w.-]+$/.test(p) && req.method === "GET") {
      const m = /^\/s\/([\w-]{8,32})\/f\/([\w.-]+)$/.exec(p);
      const g = shareValidOf(m[1]);
      const file = m[2];
      /* 只放行「被分享的这本书自己的」上传文件（原文 pdf / md） */
      const upEntry = g && String(g.b.id).startsWith("up-") ? kbUploads[g.b.id.slice(3)] : null;
      if (!g || !upEntry || (upEntry.file !== file && upEntry.pdfFile !== file)) {
        json(res, 404, { error: "not found" }); return log(404);
      }
      const abs = path.join(KB_UPLOAD_DIR, path.basename(file));
      if (!fs.existsSync(abs)) { json(res, 404, { error: "not found" }); return log(404); }
      send(res, 200, fs.readFileSync(abs), {
        "Content-Type": file.endsWith(".pdf") ? "application/pdf" : "text/markdown; charset=utf-8",
        "Content-Disposition": "inline; filename*=UTF-8''" + encodeURIComponent(file),
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      });
      return log(200);
    }
    if (p === "/api/kb/share/view" && req.method === "GET") {
      const g = shareValidOf(String(u.searchParams.get("token") || ""));
      if (!g) { json(res, 200, { ok: false, error: "链接已失效或过期" }); return log(200); }
      const { sh, b } = g;
      json(res, 200, {
        ok: true, title: b.title, desc: (b.intro || b.desc || "").slice(0, 300),
        chapter: sh.chapter, expiresAt: sh.expiresAt,
        chapters: b.chapters.map(c => ({ t: c.title })),
      });
      return log(200);
    }
    if (p === "/api/kb/share/chapter" && req.method === "GET") {
      const g = shareValidOf(String(u.searchParams.get("token") || ""));
      const ci = parseInt(u.searchParams.get("c") || "0", 10);
      if (!g) { json(res, 200, { ok: false, error: "链接已失效或过期" }); return log(200); }
      const { sh, b } = g;
      if (sh.chapter >= 0 && ci !== sh.chapter) { json(res, 200, { ok: false, error: "此链接只包含单章" }); return log(200); }
      const c = b.chapters[ci];
      if (!c) { json(res, 200, { ok: false, error: "章节不存在" }); return log(200); }
      /* 内嵌文件路径换成带令牌的公开路由（无登录也能看 PDF 原文） */
      const html = String(c.html || "").replace(/\/api\/kb\/file\//g, "/s/" + sh.token + "/f/");
      json(res, 200, { ok: true, title: c.title, html, total: b.chapters.length });
      return log(200);
    }

    /* ---- 知识库（登录可见：/kb.html 重定向登录，/kb-data.js 直接 401） ---- */
    if (p === "/kb.html" || p === "/kb-data.js") {
      const s = readSession(req);
      if (!s || s.mc) {
        if (p === "/kb.html") {
          res.writeHead(302, { Location: "/login.html?next=%2Fkb.html" });
          res.end();
          return log(302);
        }
        json(res, 401, { error: "unauthorized" });
        return log(401);
      }
      /* /kb-data.js 动态下发：轻量目录（书名+章名，藏书多时也只几十 KB）；正文按需 /api/kb/chapter */
      if (p === "/kb-data.js") {
        let generated = new Date().toISOString();
        try {
          const t = fs.readFileSync(path.join(ROOT, "kb-data.js"), "utf8");
          const g = JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)).generated;
          if (g) generated = g;
        } catch { json(res, 404, { error: "not found" }); return log(404); }
        send(res, 200, "window.KB = " + JSON.stringify({ generated, books: kbCatalog() }) + ";\n",
          { "Content-Type": "text/javascript; charset=utf-8" });
        return log(200);
      }
    }

    /* ---- 工作台（仅 admin：未登录去登录页，非 admin 明示 403；reader.html 对照阅读页同守卫） ---- */
    if (p === "/workbench.html" || p === "/reader.html") {
      const s = readSession(req);
      if (!s || s.mc) {
        res.writeHead(302, { Location: "/login.html?next=%2Fworkbench.html" });
        res.end();
        return log(302);
      }
      if (s.r !== "admin") {
        send(res, 403, '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><title>403 · El Taller</title></head>' +
          '<body style="font-family:system-ui;background:#241006;color:#fff6ec;display:grid;place-items:center;min-height:100vh;margin:0">' +
          '<p style="opacity:.7">El Estudio · 工作台仅管理员可用</p></body></html>', { "Content-Type": "text/html; charset=utf-8" });
        return log(403);
      }
    }

    /* ---- 管理端（守卫） ---- */
    if (p === "/" || p === "/admin" || p.startsWith("/admin/")) {
      if (p !== "/") {
        const s = readSession(req);
        if (!s) { json(res, 401, { error: "unauthorized" }); return log(401); }
        if (s.mc) { json(res, 403, { error: "请先修改初始密码" }); return log(403); }
        if (s.r !== "admin") { json(res, 403, { error: "forbidden" }); return log(403); }
        if (p === "/admin" || p === "/admin/") { send(res, 200, ADMIN_PAGE, { "Content-Type": "text/html; charset=utf-8" }); return log(200); }
        if (p === "/api/admin/ping") { json(res, 200, { ok: true, role: s.r, user: s.u, ts: Date.now() }); return log(200); }
        json(res, 404, { error: "not found" });
        return log(404);
      }
    }

    if (p === "/api/admin/ping") { // 未带 /admin 前缀的也守住
      const s = readSession(req);
      if (!s || s.r !== "admin") { json(res, s ? 403 : 401, { error: s ? "forbidden" : "unauthorized" }); return log(s ? 403 : 401); }
      json(res, 200, { ok: true, role: s.r, user: s.u, ts: Date.now() });
      return log(200);
    }

    /* ---- 账号管理（admin）：列表 / 建号 / 改角色·重置密码 / 删除。
       注册始终关闭，账号只由此处创建。改密、改角色、删除会轮换会话密钥：
       会话无服务端存储，旧 Cookie 只能整体作废（= 全员重新登录，含正在操作的管理员） ---- */
    if (p === "/api/admin/users") {
      const s = readSession(req);
      if (!s || s.r !== "admin") { json(res, s ? 403 : 401, { ok: false, error: s ? "forbidden" : "unauthorized" }); return log(s ? 403 : 401); }
      if (req.method === "GET") {
        json(res, 200, { ok: true, users: db.prepare("SELECT id, username, role, must_change, created FROM users ORDER BY id").all() });
        return log(200);
      }
      if (req.method === "POST") {
        const body = await readJson(req);
        const username = String(body.username || "").trim();
        const password = String(body.password || "");
        const role = String(body.role || "");
        if (!/^[a-zA-Z0-9_-]{2,24}$/.test(username)) { json(res, 400, { ok: false, error: "用户名需 2~24 位字母/数字/下划线/连字符" }); return log(400); }
        if (!ROLES_CREATABLE.includes(role)) { json(res, 400, { ok: false, error: "角色只能是 user / family / admin" }); return log(400); }
        if (password.length < 6) { json(res, 400, { ok: false, error: "初始密码至少 6 位" }); return log(400); }
        if (db.prepare("SELECT 1 FROM users WHERE username=?").get(username)) { json(res, 409, { ok: false, error: "用户名已存在" }); return log(409); }
        const salt = makeSalt();
        db.prepare("INSERT INTO users(username,pwhash,salt,role,must_change) VALUES(?,?,?,?,?)")
          .run(username, hashPassword(password, salt), salt, role, body.mustChange ? 1 : 0);
        json(res, 200, { ok: true, username, role });
        return log(200);
      }
      if (req.method === "PUT") {
        const body = await readJson(req);
        const username = String(body.username || "").trim();
        const row = db.prepare("SELECT * FROM users WHERE username=?").get(username);
        if (!row) { json(res, 404, { ok: false, error: "账号不存在" }); return log(404); }
        let rotated = false;
        if (body.password != null) {
          const pwd = String(body.password || "");
          if (pwd.length < 6) { json(res, 400, { ok: false, error: "新密码至少 6 位" }); return log(400); }
          const salt = makeSalt();
          db.prepare("UPDATE users SET pwhash=?, salt=? WHERE username=?").run(hashPassword(pwd, salt), salt, username);
          rotated = true;
        }
        if (body.role != null) {
          const role = String(body.role);
          if (!ROLES_CREATABLE.includes(role)) { json(res, 400, { ok: false, error: "角色只能是 user / family / admin" }); return log(400); }
          if (row.role === "admin" && role !== "admin" && countAdmins() <= 1) { json(res, 400, { ok: false, error: "不能降级最后一个管理员" }); return log(400); }
          if (role !== row.role) {
            db.prepare("UPDATE users SET role=? WHERE username=?").run(role, username);
            rotated = true;
          }
        }
        if (body.mustChange != null) {
          db.prepare("UPDATE users SET must_change=? WHERE username=?").run(body.mustChange ? 1 : 0, username);
        }
        if (rotated) rotateSessionSecret();
        json(res, 200, { ok: true, rotated });
        return log(200);
      }
      if (req.method === "DELETE") {
        const username = String(u.searchParams.get("username") || "").trim();
        const row = db.prepare("SELECT * FROM users WHERE username=?").get(username);
        if (!row) { json(res, 404, { ok: false, error: "账号不存在" }); return log(404); }
        if (row.role === "admin" && countAdmins() <= 1) { json(res, 400, { ok: false, error: "不能删除最后一个管理员" }); return log(400); }
        db.prepare("DELETE FROM users WHERE username=?").run(username);
        rotateSessionSecret();
        json(res, 200, { ok: true, rotated: true });
        return log(200);
      }
      json(res, 405, { ok: false, error: "method not allowed" });
      return log(405);
    }

    /* ---- works.js / notes.js 动态下发：按会话过滤 visibility（防匿名直读未过滤的原始数据） ----
       前端零改动：输出仍是 window.WORKS/window.NOTES；file:// 直开不受影响 */
    if (req.method === "GET" && (p === "/works.js" || p === "/notes.js")) {
      const arr = loadJsArray(path.join(ROOT, p));
      if (!arr) { json(res, 404, { error: "not found" }); return log(404); }
      const filtered = filterWorks(arr, readSession(req));
      const name = p === "/works.js" ? "WORKS" : "NOTES";
      send(res, 200, `window.${name}=${JSON.stringify(filtered)};`,
        { "Content-Type": "text/javascript; charset=utf-8" });
      return log(200);
    }

    /* ---- 静态 ---- */
    if (req.method === "GET") {
      serveStatic(req, res, p);
      return;
    }
    json(res, 405, { error: "method not allowed" });
    log(405);
  } catch (err) {
    console.error("[error]", p, err.message);
    if (!res.headersSent) json(res, 500, { error: "internal error" });
  }
});

server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.error(`端口 ${CFG.PORT} 被占用：可能服务已在运行。先执行 stop-server.${process.platform === "win32" ? "bat" : "sh"} 或换 CFG.PORT。`);
    process.exit(1);
  }
  throw err;
});

/* ---------------- 工作台调度：主循环每 15s 查一次到期板块 ---------------- */
wbInitSchedule();
/* 确保 pushToken 存在（Mac launchd 上报命中率用） */
if (!wbCfg.pushToken) {
  wbCfg.pushToken = crypto.randomBytes(16).toString("hex");
  saveJson(WB_FILE.cfg, wbCfg);
}
/* 确保 collectToken 存在（Mac openclaw 收集桥领取/回传用，与 pushToken 分权） */
if (!wbCfg.collectToken) {
  wbCfg.collectToken = crypto.randomBytes(16).toString("hex");
  saveJson(WB_FILE.cfg, wbCfg);
}
/* 确保 hwToken 存在（Mac openclaw 硬件情报站领取/回传用，三 token 分权） */
if (!wbCfg.hwToken) {
  wbCfg.hwToken = crypto.randomBytes(16).toString("hex");
  saveJson(WB_FILE.cfg, wbCfg);
}
/* 确保 xhsToken 存在（Mac launchd 小红书粉丝监控回传用，四 token 分权） */
if (!wbCfg.xhsToken) {
  wbCfg.xhsToken = crypto.randomBytes(16).toString("hex");
  saveJson(WB_FILE.cfg, wbCfg);
}
setInterval(() => {
  const now = Date.now();
  for (const [k, s] of Object.entries(wbSched)) {
    if (!s.busy && now >= s.nextAt) wbRun(k).catch(e => console.error("[workbench]", k, e.message));
  }
}, 15000).unref();

/* 对照阅读缓存：3 天无评论且未晋升 → 清除（启动即清一次 + 每小时巡检） */
readerPurge();
setInterval(readerPurge, 3600e3).unref();
/* 重启补拉：卡片缓存里的在列文章若正文未备好，90 秒后后台预取（错过首轮抓取钩子的兜底） */
setTimeout(() => { readerPrefetch("anth"); readerPrefetch("arxiv"); }, 90e3).unref();
/* 书本自动分类：boot 5s 后背景扫未分类的书（无 GLM Key 自动跳过，配好 Key 重启即补全） */
setTimeout(kbClassifyQueue, 5e3).unref();
/* 启动补跑：重启/部署打断的 PDF 转中英对照（state 仍 new/translating 的） */
setTimeout(() => {
  Object.values(kbUploads).filter(u => u.type === "pdf" && (u.state === "new" || u.state === "translating"))
    .forEach(u => kbPdfTranslateEnqueue(u.id));
}, 20e3).unref();

server.listen(CFG.PORT, "0.0.0.0", () => {
  const lans = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list || []) {
      if (ni.family === "IPv4" && !ni.internal) lans.push(ni.address);
    }
  }
  console.log("==========================================================");
  console.log("  El Taller de Andres · 服务已启动");
  console.log(`  本机:   http://localhost:${CFG.PORT}`);
  for (const ip of lans) console.log(`  局域网: http://${ip}:${CFG.PORT}`);
  console.log("  管理台: /admin/（需 admin 登录）");
  console.log("==========================================================");
});
