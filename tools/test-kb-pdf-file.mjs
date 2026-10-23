/* PDF 原文文件路由白名单测试（自起临时实例 + 隔离数据目录，不碰真实 data/）
   背景（2026-10-23 站主反馈）：PDF 转中英对照后注册表 e.file 变 .md、原件挪进 e.pdfFile，
   /api/kb/file 白名单只认 e.file → 登录态「查看 PDF 原文」章 404。修复后两者都认。
   用法: node tools/test-kb-pdf-file.mjs */
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const NODE24 = process.env.NODE24 || "node";
const PORT = await new Promise((res, rej) => {
  const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const p = s.address().port; s.close(() => res(p)); }); s.on("error", rej);
});
const BASE = `http://localhost:${PORT}`;
let pass = 0, fail = 0, cookie = "";
const check = (name, cond, detail = "") => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "  → " + detail : "")); }
};
async function req(method, p) {
  const r = await fetch(BASE + p, { method, redirect: "manual", headers: cookie ? { Cookie: cookie } : {} });
  const setc = r.headers.get("set-cookie"); if (setc) cookie = setc.split(";")[0];
  const text = await r.text();
  return { status: r.status, text, type: r.headers.get("content-type") };
}
async function waitPort(tries = 40) {
  for (let i = 0; i < tries; i++) { try { await fetch(BASE + "/api/me"); return true; } catch { await new Promise(r => setTimeout(r, 250)); } }
  return false;
}

const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), "taller-kbpdf-test-"));
fs.mkdirSync(path.join(tmpData, "kb-uploads"), { recursive: true });
/* 种子：一本「已转中英对照」的书（file=md / pdfFile=pdf）+ 一个盘上存在但未注册的 pdf */
fs.writeFileSync(path.join(tmpData, "kb-uploads", "conv1.md"), "# 转档书\n\n## 第 1 部分\n\n原文段\n\n> 译文段\n");
fs.writeFileSync(path.join(tmpData, "kb-uploads", "conv1.pdf"), "%PDF-1.4 假 PDF 内容");
fs.writeFileSync(path.join(tmpData, "kb-uploads", "unreg.pdf"), "%PDF-1.4 未注册文件");
fs.writeFileSync(path.join(tmpData, "kb-uploads.json"), JSON.stringify({
  conv1: { id: "conv1", title: "转档书 ｜ 白名单测试", file: "conv1.md", pdfFile: "conv1.pdf", type: "md", size: 64, at: Date.now() - 86400e3, state: "done" },
}));
const child = spawn(NODE24, ["server.js"], { cwd: ROOT, env: Object.assign({}, process.env, { TALLER_PORT: String(PORT), TALLER_DATA_DIR: tmpData }), stdio: ["ignore", "pipe", "pipe"] });
let serverLog = ""; child.stdout.on("data", d => { serverLog += d; }); child.stderr.on("data", d => { serverLog += d; });

try {
  check("服务在临时端口启动", await waitPort());
  const salt = crypto.randomBytes(16).toString("hex");
  const db = new DatabaseSync(path.join(tmpData, "users.db"));
  db.prepare("INSERT INTO users(username,pwhash,salt,role,must_change) VALUES(?,?,?,?,0)")
    .run("kbpdf-admin", crypto.scryptSync("kbpdf-pass-2026", salt, 64).toString("hex"), salt, "admin");
  /* login 需要 JSON 体，直接 fetch */
  const lr = await fetch(BASE + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "kbpdf-admin", password: "kbpdf-pass-2026" }) });
  cookie = (lr.headers.get("set-cookie") || "").split(";")[0];
  check("临时 admin 登录", lr.ok, lr.status);

  let r = await req("GET", "/api/kb/file/conv1.pdf");
  check("登录态读转档书 PDF 原文 → 200", r.status === 200 && r.text.startsWith("%PDF") && (r.type || "").includes("application/pdf"), r.status + " " + r.type);
  r = await req("GET", "/api/kb/file/conv1.md");
  check("转档书 md 正文仍可读 → 200", r.status === 200 && r.text.includes("原文段"), r.status);
  r = await req("GET", "/api/kb/file/unreg.pdf");
  check("未注册文件仍拒绝 → 404", r.status === 404, r.status);
  const keep = cookie; cookie = "";
  r = await req("GET", "/api/kb/file/conv1.pdf");
  check("未登录读文件 → 401", r.status === 401, r.status);
  cookie = keep;
} catch (e) {
  fail++; console.log("  FAIL  测试过程异常 → " + e.message);
} finally {
  child.kill("SIGTERM");
  await new Promise(r => setTimeout(r, 300));
  try { fs.rmSync(tmpData, { recursive: true, force: true }); } catch {}
  console.log("临时实例已停止，数据目录已清理");
  console.log("结果: " + pass + " 通过 / " + fail + " 失败");
  process.exit(fail ? 1 : 0);
}
