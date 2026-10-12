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
  PORT: 8891,
  SESSION_TTL_MS: 7 * 24 * 3600 * 1000,     // 会话有效期 7 天
  LOGIN_MAX_FAILS: 5,                        // 连续失败 N 次锁定
  LOCK_MS: 10 * 60 * 1000,                   // 锁定 10 分钟
  WEATHER_CACHE_MS: 30 * 60 * 1000,          // 天气缓存 30 分钟
  WEATHER_TIMEOUT_MS: 6000,
  QW_HOST: "m53mdbgg6c.re.qweatherapi.com",  // 和风专属 API Host
  QW_KEY:  "e1f99b62d8134a6f9a1de75e7b0b9cd5",
  QW_LOCATION: "101020100",                  // 上海
};

const ROOT = __dirname;
const DATA = path.join(ROOT, "data");
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
if (!fs.existsSync(SECRET_FILE)) {
  fs.writeFileSync(SECRET_FILE, crypto.randomBytes(32).toString("hex"), "utf8");
}
const SECRET = Buffer.from(fs.readFileSync(SECRET_FILE, "utf8").trim(), "hex");
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
  const f = fails.get(key) || { n: 0, lockUntil: 0 };
  f.n += 1;
  if (f.n >= CFG.LOGIN_MAX_FAILS) { f.lockUntil = Date.now() + CFG.LOCK_MS; f.n = 0; }
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
};
const BLOCKED_DIRS = ["data", "tools", "node_modules"]; // 永不对外
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath).replace(/^\/+/, "");
  if (rel === "") rel = "index.html";
  const abs = path.normalize(path.join(ROOT, rel));
  if (!abs.startsWith(ROOT)) return json(res, 403, { error: "forbidden" });
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
function loadWorks() {
  const text = fs.readFileSync(path.join(ROOT, "works.js"), "utf8");
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  try { return new Function(`return ${text.slice(start, end + 1)}`)(); }
  catch { return []; }
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

/* ---------------- 天气代理（服务端持 Key，30 分钟缓存） ---------------- */
let weatherCache = { at: 0, body: null };
async function weatherProxy(res) {
  if (Date.now() - weatherCache.at < CFG.WEATHER_CACHE_MS && weatherCache.body) {
    return json(res, 200, weatherCache.body);
  }
  try {
    const url = `https://${CFG.QW_HOST}/v7/weather/now?location=${CFG.QW_LOCATION}&lang=zh`;
    const r = await fetch(url, {
      headers: { "X-QW-Api-Key": CFG.QW_KEY },
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
  const ip = (req.socket.remoteAddress || "?").replace("::ffff:", "");
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
      const body = await readJson(req);
      const next = String(body.next || "");
      if (next.length < 8) { json(res, 400, { ok: false, error: "新密码至少 8 位。" }); return log(400); }
      const row = db.prepare("SELECT * FROM users WHERE username=?").get(s.u);
      if (!row || !verifyPassword(String(body.current || ""), row.salt, row.pwhash)) {
        json(res, 401, { ok: false, error: "当前密码不正确。" });
        return log(401);
      }
      const salt = makeSalt();
      db.prepare("UPDATE users SET pwhash=?, salt=?, must_change=0 WHERE username=?")
        .run(hashPassword(next, salt), salt, s.u);
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

    if (p === "/api/weather" && req.method === "GET") {
      await weatherProxy(res);
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
