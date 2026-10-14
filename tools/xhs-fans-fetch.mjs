#!/usr/bin/env node
/* 小红书粉丝监控 · Mac 抓取端（launchd「taller-小红书粉丝」每 2h 调用）
   为什么在 Mac：2026-10-14 实测小红书只认真浏览器上下文 —— 服务器/裸客户端带有效 Cookie
   也一律 302 登录墙（curl-impersonate 同样无效），只有登录态 Chrome 里能读到主页数据。
   做法：用常驻登录态的 Chrome profile（~/Library/Application Support/taller-xhs-chrome）
   headless 打开主页 → 直读 window.__INITIAL_STATE__.userPageData.userInfo.interactions
   → POST <服务器>/api/workbench/xhs/done（xhsToken 鉴权，同 hw 情报回传模式）。
   配置：~/.openclaw/credentials/taller-xhs.env  →  SERVER=https://tallerdeandres.cn
                                                  TOKEN=<xhsToken>
   退出码：0 成功 / 1 抓取失败 / 2 登录失效（须重新扫码：手动开 Chrome --user-data-dir=该 profile） */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const PROFILE = path.join(os.homedir(), "Library/Application Support/taller-xhs-chrome");
const CHROME = ["Google Chrome", "Chromium", "chrome"]
  .map(n => path.join(os.homedir(), "Applications/Google Chrome.app/Contents/MacOS", n))
  .concat(["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"])
  .find(p => existsSync(p));
const PORT = process.env.XHS_CDP_PORT || 9231;
const ACCOUNT = process.env.XHS_ACCOUNT || "5ae9132b11be103284ad135c";
const sleep = ms => new Promise(r => setTimeout(r, ms));

const env = {};
const envPath = path.join(os.homedir(), ".openclaw/credentials/taller-xhs.env");
if (existsSync(envPath)) for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Za-z_]+)\s*=\s*(.*?)\s*$/);
  if (m) env[m[1]] = m[2];
}
const SERVER = (process.env.XHS_SERVER || env.SERVER || "https://tallerdeandres.cn").replace(/\/+$/, "");
const TOKEN = process.env.XHS_TOKEN || env.TOKEN || "";

async function main() {
  if (!existsSync(CHROME)) { console.error("未找到 Chrome:", CHROME); process.exit(1); }
  if (!existsSync(PROFILE)) { console.error("未找到登录态 profile:", PROFILE); process.exit(2); }
  if (!TOKEN) { console.error("缺 TOKEN（~/.openclaw/credentials/taller-xhs.env）"); process.exit(1); }

  const chrome = spawn(CHROME, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`,
    `https://www.xiaohongshu.com/user/profile/${ACCOUNT}`,
  ], { stdio: "ignore" });

  try {
    let target = null;
    for (let i = 0; i < 40 && !target; i++) {
      await sleep(500);
      try {
        const list = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
        target = list.find(t => t.type === "page" && (t.url || "").includes("xiaohongshu.com"));
      } catch {}
    }
    if (!target) throw new Error("CDP 页面未就绪（20s）");

    const ws = new WebSocket(target.webSocketDebuggerUrl.replace("localhost", "127.0.0.1"));
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; setTimeout(() => rej(new Error("ws 超时")), 5000); });
    let id = 0; const pending = new Map();
    ws.onmessage = ev => { const d = JSON.parse(ev.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
    const send = (method, params = {}) => new Promise(res => { const mid = ++id; pending.set(mid, res); ws.send(JSON.stringify({ id: mid, method, params })); });

    /* 等页面水合出 __INITIAL_STATE__（最多 25s，每秒试一次）。
       2026-10 结构：state.user.userPageData 是 Vue ref → 解包后 { basicInfo:{redId,nickname}, interactions:[{count,type}] } */
    let data = null;
    for (let i = 0; i < 25 && !data; i++) {
      await sleep(1000);
      const r = await send("Runtime.evaluate", {
        expression: `(function(){
          if (location.pathname.startsWith("/login") || /captcha|verify/.test(location.href)) return "LOGIN";
          const unrefv = r => (r && typeof r === "object" && "__v_isRef" in r) ? (r._rawValue !== undefined ? r._rawValue : r.value) : r;
          const up = unrefv((window.__INITIAL_STATE__ && __INITIAL_STATE__.user || {}).userPageData);
          if (!up || !up.interactions) return null;
          const it = up.interactions.find(x => x && x.type === "fans");
          const bi = up.basicInfo || {};
          return JSON.stringify({ fans: it ? Number(it.count) : null, redId: bi.redId || "", nickname: bi.nickname || "" });
        })()`,
        returnByValue: true,
      });
      const v = r.result && r.result.result && r.result.result.value;
      if (v === "LOGIN") { ws.close(); chrome.kill(); console.error("登录已失效：请手动开 Chrome 重新扫码（tools/xhs-fans-fetch.mjs 头部有命令）"); process.exit(2); }
      if (v) { try { data = JSON.parse(v); } catch {} }
    }
    ws.close();
    if (!data || data.fans == null || !Number.isFinite(data.fans)) throw new Error("页面未解析出 fans（结构变化或未完全加载）");

    const resp = await fetch(SERVER + "/api/workbench/xhs/done", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-xhs-token": TOKEN },
      body: JSON.stringify(data),
    });
    const j = await resp.json().catch(() => ({}));
    if (!resp.ok || !j.ok) throw new Error("服务器回传 " + resp.status + " " + JSON.stringify(j));
    console.log(`推送成功：${data.nickname}(@${data.redId}) 粉丝 ${data.fans} → ${SERVER}`);
  } finally {
    chrome.kill();
    await sleep(500);
  }
}
main().catch(e => { console.error("抓取失败:", e.message); process.exit(1); });
