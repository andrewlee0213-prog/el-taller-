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
    res.writeHead(206, {
      "Content-Type": MIME[ext],
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Cache-Control": "no-store",
    });
    res.end(data.subarray(start, end + 1));
    return true;
  }
  send(res, 200, data, { "Content-Type": MIME[ext], "Accept-Ranges": "bytes" });
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
function filterWorks(works, session) {
  const authed = !!session, admin = authed && session.r === "admin";
  return works.filter(w => {
    const v = w.visibility || "public";
    if (v === "public") return true;
    if (v === "friends") return authed;
    if (v === "private") return admin;
    return false;
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
function kbAllBooks() {
  const books = kbFullBooks().slice().filter(b => !kbRemoved.has(b.id));
  const arts = Object.values(wbBiblio).sort((a, b) => (b.promotedAt || 0) - (a.promotedAt || 0));
  if (arts.length) books.push({
    id: "lectura", title: "阅读精选 · 对照阅读", es: "📖 Lectura",
    desc: "Anthropic 研究与 arXiv 论文的全文中英对照。工作台里评论过的文章自动收进本书（未评论的 3 天后清除）。",
    intro: "El Estudio 对照阅读评论过的文章，带着评论收录于此；中文在上、原文在下。",
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
      chapters, collected: true, note: "",
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
        cached = kbUploadParsed[u.id] = { chapters, intro: parsed.intro };
      }
      return { id: "up-" + u.id, title: u.title.replace(/\.md$/i, ""), es, desc: "上传收录 · " + new Date(u.at).toLocaleDateString(),
        intro: cached.intro, chapters: cached.chapters, uploaded: true, note: u.note || "" };
    }
    return { id: "up-" + u.id, title: u.title.replace(/\.pdf$/i, ""), es, desc: "上传收录 · PDF 原文",
      intro: "PDF 原文内嵌查看（浏览器原生渲染）。",
      chapters: [{ id: "pdf", title: "查看 PDF 原文",
        html: '<iframe src="/api/kb/file/' + u.file + '" style="width:100%;height:72vh;border:1px solid color-mix(in srgb,var(--ink) 14%,transparent);border-radius:12px;background:var(--g-bg-base)"></iframe>' +
          '<p style="margin-top:10px"><a href="/api/kb/file/' + u.file + '" target="_blank" rel="noopener">↗ 新窗口打开 / 下载</a></p>',
        text: "" }], uploaded: true, note: u.note || "" };
  }).filter(b => b.chapters.length > 0);
}
/* 目录（不含正文）：藏书成百上千时 kb-data.js 也只有几十 KB；正文按需 /api/kb/chapter */
function kbCatalog() {
  return kbAllBooks().map(b => ({
    id: b.id, title: b.title, es: b.es, desc: b.desc, uploaded: !!b.uploaded, collected: !!b.collected, atlas: !!b.atlas, note: b.note || "",
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
};
const wbCfg = Object.assign({}, WB_DEFAULTS, loadJson(WB_FILE.cfg, {}));
if (!Array.isArray(wbCfg.biliUps)) wbCfg.biliUps = [];

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
    } else {
      dev = { name, brand: String((raw && raw.brand) || "").trim().slice(0, 40), cat: cat || "未分类", lens,
        collects: String((raw && raw.collects) || "").trim().slice(0, 60), shows: String((raw && raw.shows) || "").trim().slice(0, 60),
        status: String((raw && raw.status) || "传闻").trim().slice(0, 12), firstSeen: date, lastSeen: date, heat: 1,
        url: /^https?:\/\//i.test(String((raw && raw.url) || "")) ? String(raw.url).trim().slice(0, 500) : "",
        src: String((raw && raw.src) || "").trim().slice(0, 30), prices: [] };
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
  let h = "<table><thead><tr><th>设备</th><th>透镜</th><th>采集 / 展现</th><th>状态</th><th>最新价</th><th>热度</th></tr></thead><tbody>";
  for (const d of list) {
    const cs = [d.collects, d.shows].filter(Boolean).join(" / ");
    const price = d.prices && d.prices.length ? d.prices[d.prices.length - 1].p : "";
    h += "<tr><td>" + (d.url ? '<a href="' + kbUploadEsc(d.url) + '" target="_blank" rel="noopener">' + kbUploadEsc(d.name) + "</a>" : kbUploadEsc(d.name)) +
      "</td><td>" + tag(d.lens) + "</td><td>" + kbUploadEsc(cs || "—") + "</td><td>" + kbUploadEsc(d.status || "") +
      "</td><td>" + kbUploadEsc(price) + "</td><td>" + (d.heat || 1) + "</td></tr>";
  }
  return h + "</tbody></table>";
}

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
      const wm = reFirst(win2, /(\d{1,2})月(\d{1,2})日/);
      if (wm) win = [parseInt(wm[0], 10), parseInt(wm[1], 10)];
      if (win && oilUpcoming(win[0], win[1])) info.next = "下次调价 " + win2;
      else info.expired = true;   // 网站数据滞后，窗口已过
    }
    const ftxt = oilForecast(dirn, amt, range);
    if (ftxt) info.next += (info.next ? " · " : "") + ftxt;
  } catch {}
  if (!info.next && !info.expired) {
    const prev = wbCache.oil;
    if (prev && prev.next && !prev.expired) info.next = prev.next;   // 旧窗口未过期则保留
  }
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
  const re = /<li><a href="(\/research\/[^"]+)"[^>]*>\s*<div[^>]*>\s*<time[^>]*>([^<]+)<\/time>\s*<span[^>]*>([^<]*)<\/span>\s*<\/div>\s*<span[^>]*>([^<]+)<\/span>/g;
  let m;
  while ((m = re.exec(html))) {
    const href = "https://www.anthropic.com" + m[1];
    if (seen.has(href)) continue;
    const dt = parseEnDate(m[2]);
    if (!dt) continue;
    seen.add(href);
    items.push({ url: href, ts: dt.getTime(), title: cleanText(m[4]), cat: cleanText(m[3]) });
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

/* ---------------- 调度（各板块独立节奏，失败分级重试，缓存落盘回放） ---------------- */
const WB_INTERVALS = {
  glm:   { ok: 5 * 60e3,    fail: 2 * 60e3 },
  oil:   { ok: 24 * 3600e3, fail: 30 * 60e3, stale: 2 * 3600e3 },
  bili:  { ok: 144 * 60e3,  fail: 3 * 60e3, failRisk: 60 * 60e3 },
  anth:  { ok: 24 * 3600e3, fail: 20 * 60e3 },
  arxiv: { ok: 24 * 3600e3, fail: 20 * 60e3 },
  f1:    { ok: 24 * 3600e3, fail: 6 * 3600e3 },
};
let wbCache = loadJson(WB_FILE.cache, { glm: null, oil: null, bili: null, anth: null, arxiv: null, f1: null });
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
    wbSched[k] = { busy: false, nextAt: Math.max(now, last + WB_INTERVALS[k].ok) };
    if (!wbCache[k]) wbSched[k].nextAt = now;   // 冷启动立即抓
  }
  /* 错峰：glm 立即，oil/bili/anth/arxiv/f1 依次让路 */
  if (!wbCache.oil) wbSched.oil.nextAt = now + 8e3;
  if (!wbCache.bili) wbSched.bili.nextAt = now + 16e3;
  if (!wbCache.anth) wbSched.anth.nextAt = now + 30e3;
  if (!wbCache.arxiv) wbSched.arxiv.nextAt = now + 45e3;
  if (!wbCache.f1) wbSched.f1.nextAt = now + 60e3;
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
  const done = delay => { s.busy = false; s.nextAt = Date.now() + delay; saveJson(WB_FILE.cache, wbCache); };
  try {
    if (section === "glm") {
      const d = await wbFetchGLM();
      if (d.ok) { wbCache.glm = d; done(iv.ok); } else { wbFail("glm", d.error); done(iv.fail); }
    } else if (section === "oil") {
      const d = await wbFetchOil();
      if (d.ok) { wbCache.oil = d; done(d.expired ? iv.stale : iv.ok); }
      else { wbFail("oil", d.error); done(iv.fail); }
    } else if (section === "bili") {
      const d = await wbFetchBiliAll();
      if (d.ok) { wbCache.bili = d; done(iv.ok); }
      else { wbFail("bili", d.error); done(d.risky ? iv.failRisk : iv.fail); }
    } else if (section === "anth") {
      const d = await wbFetchAnth();
      if (d.ok) { wbCache.anth = d; done(iv.ok); readerPrefetch("anth"); }
      else { wbFail("anth", d.error); done(iv.fail); }
    } else if (section === "arxiv") {
      console.log("[workbench] arxiv 五段选文开始");
      const d = await wbFetchArxiv();
      if (d.ok) { wbCache.arxiv = d; console.log("[workbench] arxiv 终选: " + d.items.map(x => x.zh).join(" / ")); done(iv.ok); readerPrefetch("arxiv"); }
      else { wbFail("arxiv", d.error); done(iv.fail); }
    } else if (section === "f1") {
      const d = await wbFetchF1();
      if (d.ok) { wbCache.f1 = d; console.log("[workbench] f1 赛程 " + d.races.length + " 站"); done(iv.ok); }
      else { wbFail("f1", d.error); done(iv.fail); }
    }
  } catch (e) {
    wbFail(section, e.name === "TimeoutError" || e.name === "AbortError" ? "网络超时" : (e.message || "抓取失败"));
    done(iv.fail || Math.round(iv.ok / 6));
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
  const entries = wbLog.filter(e => e.date >= start && e.date <= end);
  const comments = Object.values(wbComments).filter(c => c.createdAt >= startTime && c.createdAt <= endTime);
  const memos = wbMemos.filter(m => m.date >= start && m.date <= end);
  /* 对照基准 = 最近一次已确认的计划（任意区间，不限于"上一周"） */
  const prev = Object.values(wbWeekly).filter(w => w.confirmedAt).sort((a, b) => b.confirmedAt - a.confirmedAt)[0];
  const prevPlan = prev ? prev.plan : "";
  const rangeLabel = start + " ~ " + end;
  const prompt = "你是 Andres 的工作助理。根据下面三份材料，为时间段 " + rangeLabel + " 写「工作总结」和「下阶段计划」。\n\n" +
    "【该时间段的工作记录】\n" + (entries.length ? entries.map(e => "- (" + e.date + ") " + e.text).join("\n") : "（该时间段暂无记录）") + "\n\n" +
    "【该时间段的阅读与评论】\n" + (comments.length ? comments.map(c => "- [" + (c.source || "") + "] " + (c.title || c.url) + "：" + (c.text || "")).join("\n") : "（该时间段暂无评论）") + "\n\n" +
    "【该时间段的备忘记事/待办】\n" + (memos.length ? memos.map(m => "- (" + m.date + (m.done ? " 已完成" : " 未完成") + ") " + m.text).join("\n") : "（无）") + "\n\n" +
    "【最近一次已确认的计划（对照：已完成的在总结里体现，未完成的视需要顺延）】\n" + (prevPlan || "（无）") + "\n\n" +
    "要求：总结用中文，300 字内，先一句总述再分点；计划用中文，3~6 条可执行事项，按优先级排序。\n" +
    "只输出 JSON: {\"summary\":\"…\",\"plan\":\"…\"}，字符串内的换行写成 \\n。";
  const r = extractJSON(await glmChat(prompt, { temperature: 0.4 }));
  if (!r || !r.summary || !r.plan) throw new Error("生成失败，请重试");
  return { start, end, range: rangeLabel, summary: String(r.summary), plan: String(r.plan) };
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
    visibility: ["public", "friends", "private"].includes(o.visibility) ? o.visibility : "private",
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

/* ---------------- 管理台占位页（证明守卫生效） ---------------- */
const ADMIN_PAGE = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0"><title>管理台 · El Taller</title>
<style>body{font-family:"Segoe UI","Microsoft YaHei",sans-serif;background:#241006;color:#fff6ec;
min-height:100vh;display:grid;place-items:center;margin:0}
.box{max-width:520px;padding:40px;border-radius:26px;text-align:center;
background:linear-gradient(150deg,rgba(185,128,82,.38),rgba(115,70,40,.32));border:1px solid rgba(255,255,255,.15)}
h1{font-size:22px;margin-bottom:10px}p{color:rgba(255,240,228,.6);font-size:13.5px;line-height:1.8}
code{background:rgba(255,255,255,.1);padding:2px 8px;border-radius:6px;font-size:12.5px}
#ping{margin-top:18px;padding:10px 22px;border-radius:999px;border:0;cursor:pointer;font:inherit;font-size:13.5px;
background:linear-gradient(140deg,#ff9d2e,#d97c14);color:#2a1505;font-weight:600}
#out{margin-top:14px;font-size:12.5px;color:#8fe9bd;min-height:18px}</style></head>
<body><div class="box"><h1>El Taller · 管理台</h1>
<p>权限守卫已生效：你能看到本页，说明当前会话角色为 <code>admin</code>。<br>
作品管理界面为后续版本预留；当前可用 <code>/api/admin/ping</code> 验证鉴权。</p>
<button id="ping">测试 /api/admin/ping</button><div id="out"></div>
<p style="margin-top:22px"><a href="/" style="color:#ffd9a3">← 返回主页</a></p></div>
<script>document.getElementById('ping').onclick=async()=>{try{const r=await fetch('/api/admin/ping');const j=await r.json();
document.getElementById('out').textContent=JSON.stringify(j)}catch(e){document.getElementById('out').textContent='请求失败'}}</script>
</body></html>`;

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
      if (q.length < 2) { json(res, 200, { ok: true, total: 0, results: [] }); return log(200); }
      const out = [];
      for (const b of kbAllBooks()) {
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
      json(res, 200, { ok: true, total: out.length, results: out.slice(0, 80) });
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
        delete kbUploadParsed[e.id];
        delete kbUploads[e.id];
        saveJson(KB_UPLOAD_FILE, kbUploads);
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
      json(res, 200, { ok: true, id, title: fname, books: kbUploadBooks().length });
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
      json(res, 200, { ok: true, title: book.title, first });
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
        kbCollect.items.splice(idx, 1);
        saveJson(KB_COLLECT_FILE, kbCollect);
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
        ok: true, need: !(latest && latest.date === hwToday()), date: hwToday(),
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
        wbLog.push({ id: "l-" + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36), date, text: text.slice(0, 2000), createdAt: Date.now() });
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
        const summary = String(body.summary || "").slice(0, 8000);
        const plan = String(body.plan || "").slice(0, 8000);
        if (!summary.trim() || !plan.trim()) { json(res, 400, { ok: false, error: "总结和计划都不能为空" }); return log(400); }
        const key = start + "~" + end;
        const prev = wbWeekly[key] || {};
        wbWeekly[key] = { id: key, start, end, range: start + " ~ " + end, summary, plan,
          generatedAt: prev.generatedAt || Date.now(), confirmedAt: Date.now() };
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

      /* ---- 收进日志的笔记：公开条目所有人可见，登录后含 friends，admin 含全部 ---- */
    if (p === "/api/notes-extra" && req.method === "GET") {
      const s = readSession(req);
      const admin = s && s.r === "admin";
      const authed = !!s;
      const items = wbNotes.filter(n => {
        const v = n.visibility || "public";
        if (v === "public") return true;
        if (v === "friends") return authed;
        return admin;
      }).sort((a, b) => (b.date || "").localeCompare(a.date || "") || b.createdAt - a.createdAt);
      json(res, 200, { items });
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
