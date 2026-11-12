/* Shared workbench behavior: one data source for classic and AI layouts. */
function runWorkbench(){
"use strict";
const AI_WORKBENCH = document.documentElement.hasAttribute("data-ai-workbench");
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const pad2 = n => String(n).padStart(2, "0");
const hm = ts => { const d = new Date(ts); return pad2(d.getHours()) + ":" + pad2(d.getMinutes()); };
const mdhm = ts => { const d = new Date(ts); return pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + hm(ts); };
const dstr = d => d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SRC_LABEL = { bili: "B站", anth: "Anthropic", arxiv: "arXiv" };

let CFG = null, WB = null, SCHED = null, LOG = [], CMT = {}, DIS = {}, MEMOS = [], WEEKLY = { weeks: {}, current: { start: "", end: "" } };
let INBOX = [];   // Biblioteca 待处理（state=new 的上传）

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("on"), 2400);
}
async function api(method, path, body) {
  try {
    const r = await fetch(path, {
      method,
      headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    let result;
    try { result = await r.json(); } catch { return { ok: false, error: "HTTP " + r.status, status: r.status }; }
    return r.ok ? result : { ok: false, error: result.error || "HTTP " + r.status, status: r.status };
  } catch { return { ok: false, error: "网络连接失败，请稍后重试。", status: 0 }; }
}

/* ================= Panel 渲染 ================= */
const fmtInt = n => Number(n || 0).toLocaleString("en-US");
function relReset(ms) {
  const diff = ms - Date.now();
  if (!(diff > 0)) return "";
  const m = Math.round(diff / 60e3);
  if (m < 60) return m + "分钟后重置";
  const h = Math.floor(m / 60), rm = m % 60;
  if (h < 48) return h + "小时" + (rm ? rm + "分" : "") + "后重置";
  return Math.round(h / 24) + "天后重置";
}
function barHtml(label, item, weekly) {
  let rem = 100;
  if (item && item.usage > 0 && item.remaining != null) rem = Math.round(item.remaining / item.usage * 100);
  else if (item && item.pct != null) rem = 100 - item.pct;
  rem = Math.max(0, Math.min(100, rem));
  const color = rem <= 20 ? "#f85149" : rem <= 50 ? "#d29922" : "#3fb950";
  let rst = "";
  if (item && item.reset) {
    const d = new Date(item.reset);
    rst = weekly ? (pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) + " " + hm(item.reset)) : (hm(item.reset) + " 重置");
  }
  let sub = "";
  if (item && (item.currentValue != null || item.usage != null)) {
    sub = "已用 <b>" + fmtInt(item.currentValue) + "</b> / " + fmtInt(item.usage) + " 点";
    const rel = item.reset ? relReset(item.reset) : "";
    if (rel) sub += " · " + rel;
  }
  return '<div class="qrow"><span class="qlab">' + label + '</span>' +
    '<div class="track"><div class="fill" style="width:' + rem + '%;background:' + color + '"></div></div>' +
    '<span class="qpct">' + (item ? rem + "%" : "--") + '</span><span class="qrst">' + esc(rst) + "</span></div>" +
    (sub ? '<div class="qsub">' + sub + "</div>" : "");
}
/* 本周已用走势迷你图：历史点来自服务器缓存（5 分钟一点） */
function sparkHtml(hist) {
  if (!hist || hist.length < 2) {
    return '<div class="spark"><span class="st"><span>本周已用走势 · 数据积累中（每 5 分钟记一点）</span></span></div>';
  }
  const W = 300, H = 40, PAD = 3;
  const vals = hist.map(p => p.uW || 0);
  const min = Math.min(...vals), max = Math.max(...vals), span = (max - min) || 1;
  const pts = hist.map((p, i) => {
    const x = (i / (hist.length - 1)) * W;
    const y = H - PAD - ((p.uW || 0) - min) / span * (H - PAD * 2);
    return x.toFixed(1) + "," + y.toFixed(1);
  });
  const area = "0," + H + " " + pts.join(" ") + " " + W + "," + H;
  const lastP = hist[hist.length - 1];
  const dotX = W, dotY = H - PAD - ((lastP.uW || 0) - min) / span * (H - PAD * 2);
  const label = mdhm(hist[0].t) + " → " + mdhm(lastP.t);
  return '<div class="spark"><span class="st"><span>本周已用走势（' + esc(label) + "）</span><b>" +
    fmtInt(lastP.uW) + " 点</b></span>" +
    '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true">' +
    '<polygon class="sarea" points="' + area + '"></polygon>' +
    '<polyline class="sline" points="' + pts.join(" ") + '"></polyline>' +
    '<circle class="sdot" cx="' + Math.min(dotX, W - 1.5) + '" cy="' + dotY.toFixed(1) + '" r="1.6"></circle></svg></div>';
}
function renderGLM() {
  const d = WB.glm, body = $("#glmBody"), upd = $("#glmUpd");
  $("#glmLvl").style.display = "none";
  if (!CFG.hasKey) { body.innerHTML = '<span class="dim">未配置 API Key · 到底部 Ajustes 粘贴后自动开始</span>'; upd.textContent = ""; return; }
  if (!d || !d.limits) { body.innerHTML = '<span class="dim">等待首抓…</span>' + (d && d.error ? '<span class="err">' + esc(d.error) + "</span>" : ""); upd.textContent = ""; return; }
  upd.textContent = d.error ? hm(d.at) + " · 旧值" : hm(d.at) + " 更新";
  const five = d.limits.find(l => l.unit === 3) || d.limits[0];
  const week = d.limits.find(l => l.unit === 6) || d.limits[1] || d.limits[0];
  let html = barHtml("5小时", five, false) + barHtml("本周", week, true);
  if (d.hit && (d.hit.day != null || d.hit.all != null)) {
    const stale = Date.now() - d.hit.at > 2 * 3600e3;
    html += '<div class="qsub" style="padding-left:0">缓存命中率（本机 ZCode 上报）<b>近24h ' +
      (d.hit.day != null ? d.hit.day.toFixed(1) : "--") + "%</b> · 累计 <b>" +
      (d.hit.all != null ? d.hit.all.toFixed(1) : "--") + "%</b>" +
      (stale ? " · " + hm(d.hit.at) + " 上报" : "") + "</div>";
  }
  html += sparkHtml(d.history);
  if (d.error) html += '<span class="err">' + esc(d.error) + "（已保留旧值）</span>";
  const pill = $("#glmLvl");
  pill.textContent = d.level || "Pro";
  pill.style.display = "";
  body.innerHTML = html;
}
/* 95# 调价走势（历史来自金投调价表，最近 12 次） */
function oilSparkHtml(hist) {
  if (!hist || hist.length < 2) return "";
  const pts = hist.slice().reverse();   // 表格最新在前 → 反转为时间正序
  const W = 300, H = 44, PAD = 4;
  const vals = pts.map(p => parseFloat(p.price)).filter(v => !isNaN(v));
  if (vals.length < 2) return "";
  const min = Math.min(...vals), max = Math.max(...vals), span = (max - min) || 1;
  const xy = pts.map((p, i) => {
    const x = (i / (pts.length - 1)) * W;
    const y = H - PAD - ((parseFloat(p.price) - min) / span) * (H - PAD * 2);
    return x.toFixed(1) + "," + y.toFixed(1);
  });
  const area = "0," + H + " " + xy.join(" ") + " " + W + "," + H;
  const lastV = vals[vals.length - 1];
  const dotY = H - PAD - ((lastV - min) / span) * (H - PAD * 2);
  const lo = Math.round(min * 100) / 100, hi = Math.round(max * 100) / 100;
  const label = pts[0].date.slice(5) + " → " + pts[pts.length - 1].date.slice(5);
  return '<div class="spark"><span class="st"><span>95# 调价走势（' + esc(label) + " · 低" + lo.toFixed(2) + " / 高" + hi.toFixed(2) + "）</span><b>" +
    esc(pts[pts.length - 1].price) + " 元</b></span>" +
    '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true">' +
    '<polygon class="sarea" points="' + area + '"></polygon>' +
    '<polyline class="sline" points="' + xy.join(" ") + '"></polyline>' +
    '<circle class="sdot" cx="' + (W - 1.5) + '" cy="' + dotY.toFixed(1) + '" r="1.6"></circle></svg></div>';
}
/* 预测只认新版、来源可核对的未来周期；以下三个纯函数不依赖 DOM 或缓存 next。 */
function oilSourceUrlValid(url) {
  return typeof url === "string" && url === url.trim() &&
    /^https:\/\/energy\.cngold\.org\/c\/\d{4}-\d{2}-\d{2}\/c\d+\.html$/.test(url);
}
function oilCycleAt(d, now = Date.now()) {
  if (!d || typeof d !== "object" || d.forecastVersion !== 2 || !Number.isFinite(now) ||
      typeof d.adj !== "string" || d.adj.length !== 10 || !oilSourceUrlValid(d.cycleSource)) return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d.adj);
  if (!m) return 0;
  const year = +m[1], month = +m[2], day = +m[3];
  if (year < 2000 || year > 2100) return 0;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return 0;
  const adjustAt = date.getTime() + 16 * 3600e3;   // 北京该日 24:00 = UTC 同日 16:00
  return d.adjustAt === adjustAt && adjustAt > now && adjustAt - now <= 32 * 86400e3 ? adjustAt : 0;
}
function oilNextHtml(d, now = Date.now()) {
  const adjustAt = oilCycleAt(d, now);
  if (!adjustAt) return '<span class="dim">下一轮调价预测待更新</span>';
  const label = "下次调价 " + Number(d.adj.slice(5, 7)) + "月" + Number(d.adj.slice(8, 10)) + "日24时";
  const f = d.forecast;
  const valid = d.expired !== true && f && f.adj === d.adj && oilSourceUrlValid(f.sourceUrl) &&
    Number.isFinite(f.publishedAt) && f.publishedAt > 0 && f.publishedAt <= now && adjustAt - f.publishedAt <= 32 * 86400e3 &&
    typeof f.text === "string" && f.text === f.text.trim() && /^预计(?:[涨跌](?:约)?\d+(?:\.\d+)?(?:~\d+(?:\.\d+)?)?元\/升|搁浅)$/.test(f.text);
  // 日期由 adj 生成，预测文案受完整正则限制；不展示 d.next，也不把旧预测接到新日期上。
  return '<span class="' + (valid ? "okline" : "dim") + '">' + label + " · " +
    (valid ? f.text : "本轮预测待更新") + "</span>";
}
let oilCycleTimer = null, oilReadPromise = null;
function armOilBoundary(d, now = Date.now()) {
  clearTimeout(oilCycleTimer);
  oilCycleTimer = null;
  const adjustAt = oilCycleAt(d, now);
  if (!adjustAt) return;
  oilCycleTimer = setTimeout(() => {
    oilCycleTimer = null;
    const reached = Date.now() >= adjustAt;
    renderOil();   // 先按当前 WB 撤下过期预测，再等只读请求；旧响应不会触发循环重试。
    if (reached) void loadOilData();
  }, Math.max(1, Math.min(adjustAt - now, 2147483647)));   // 超过浏览器安全延时则分段重挂
}
function loadOilData() {
  if (!WB || oilReadPromise) return oilReadPromise;
  const currentOil = WB.oil;
  oilReadPromise = (async () => {
    try {
      const d = await api("GET", "/api/workbench/data");
      // 手动刷新若已应用新数据，就不再让先发出的只读响应覆盖它；其他卡片不重绘。
      if (d && d.data && Object.prototype.hasOwnProperty.call(d.data, "oil") && WB && WB.oil === currentOil) {
        WB.oil = d.data.oil;
        renderOil();
      }
    } catch (_) { /* 网络失败保持现价；预测仍由本地时钟判定失效。 */ }
    finally { oilReadPromise = null; }
  })();
  return oilReadPromise;
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !WB) return;
  renderOil();   // 隐藏页的计时器可能被节流，恢复时同步校验，绝不等请求结束才撤下旧预测。
  void loadOilData();
});
function renderOil() {
  const d = WB.oil, body = $("#oilBody"), upd = $("#oilUpd");
  armOilBoundary(d);
  if (!d || !d.price) {
    body.innerHTML = '<span class="dim">等待首抓…</span>' + (d && d.error ? '<span class="err">' + esc(d.error) + "（已保留旧值）</span>" : "");
    upd.textContent = ""; return;
  }
  upd.textContent = (d.error ? hm(d.at) + " · 旧值" : hm(d.at) + " 更新");
  body.innerHTML =
    '<div><span class="oilprice">' + esc(d.price) + '</span><span class="oilunit">元/升 · 95#</span></div>' +
    (d.prices && d.prices.length ? '<div class="oilgrades">' + d.prices.map(p =>
      '<span class="ogchip' + (p.g === "95#" ? " on" : "") + '" title="' + esc(p.g) + '"><b>' + esc(p.g) + "</b>" + esc(p.v) + "</span>").join("") + "</div>" : "") +
    oilSparkHtml(d.hist) +
    (d.note ? '<span class="dim">' + esc(d.note) + "</span>" : "") +
    oilNextHtml(d) +
    (d.error ? '<span class="err">' + esc(d.error) + "（已保留旧值）</span>" : "");
}
function cmtBtnHtml(url, source, title) {
  const has = !!(CMT[url] && CMT[url].text);
  return '<button class="icmt' + (has ? " has" : "") + '" data-cmt="1" data-url="' + esc(url) + '" data-src="' + source + '" data-title="' + esc(title) +
    '" title="' + (has ? "已有评论 · 点击查看" : "写观后评论") + '">💬</button>';
}
function cboxHtml(url, title) {
  const c = CMT[url] || {};
  return '<div class="cbox" data-cbox="' + esc(url) + '">' +
    '<textarea placeholder="观后感：有用 / 没用 / 想追问什么…（arXiv 评论会反馈给后续选文）">' + esc(c.text || "") + "</textarea>" +
    '<div class="crow"><input class="ctitle" placeholder="日志标题（收进日志时用）" value="读「' + esc((c.title || title || "").slice(0, 24)) + '」">' +
    '<select class="cvis"><option value="private">仅自己</option><option value="family">家人可见</option><option value="friends">登录可见</option><option value="public">公开</option></select></div>' +
    '<div class="crow"><button class="bmini" data-csave="' + esc(url) + '">存评论</button>' +
    '<button class="bmini hot" data-cnote="' + esc(url) + '">收进日志</button><span class="csaved"></span></div></div>';
}
function itemRowHtml(url, href, titleHtml, metaHtml, source, title) {
  const readable = (source === "anth" || source === "arxiv");
  const rd = readable
    ? '<a class="icmt" href="reader.html?url=' + encodeURIComponent(url) + '" title="对照阅读全文（中文在上·原文在下；评论后收进 Biblioteca，3 天没评论自动清除）">📄</a>' : "";
  const dl = readable
    ? '<button class="icmt dsl' + (DIS[url] ? " has" : "") + '" data-dis="1" data-url="' + esc(url) +
      '" data-src="' + source + '" data-title="' + esc(title) +
      '" title="不感兴趣：以后减少推荐这类，且永不进 Biblioteca（再点一次撤销）">👎</button>' : "";
  const disNote = DIS[url]
    ? '<span class="imeta" style="color:var(--warn)">已标记不感兴趣 · 后续减少同类推荐 · 不进 Biblioteca</span>' : "";
  return '<div class="item' + (DIS[url] ? " disliked" : "") + '"><div class="l1"><a class="it" href="' + esc(href) + '" target="_blank" rel="noopener">' + titleHtml + "</a>" +
    rd + cmtBtnHtml(url, source, title) + dl + "</div>" +
    (metaHtml ? '<span class="imeta">' + metaHtml + "</span>" : "") +
    disNote +
    cboxHtml(url, title) + "</div>";
}
function isNewDay(tsSecOrDate, now) {
  if (typeof tsSecOrDate === "number") {
    const d = new Date(tsSecOrDate * 1000);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  }
  return tsSecOrDate === dstr(now);
}
function renderBili() {
  const d = WB.bili, body = $("#biliBody"), upd = $("#biliUpd");
  if (!CFG.ups.length && !(d && d.items && d.items.length)) {
    body.innerHTML = '<span class="dim">未配置 UP · 到底部 Ajustes 添加 uid 清单</span>'; upd.textContent = ""; return;
  }
  if (!d || !d.items) { body.innerHTML = '<span class="dim">等待首轮核对…</span>'; upd.textContent = ""; return; }
  const videos = AI_WORKBENCH ? d.items.slice(0, 5) : d.items;
  upd.textContent = (d.error ? hm(d.at) + " · 部分" : hm(d.at) + " 更新") +
    (AI_WORKBENCH ? "（展示 " + videos.length + " / " + d.items.length + "）" : "(" + d.items.length + "/" + Math.max(CFG.ups.length, d.items.length) + ")");
  const now = new Date();
  body.innerHTML = videos.map(it => {
    let title = it.title || "";
    if (title.startsWith("【" + it.name + "】")) title = title.slice(it.name.length + 2);
    const t = esc("· " + it.name + " | " + title) + (isNewDay(it.created, now) ? ' <span class="new">New</span>' : "");
    const url = "https://www.bilibili.com/video/" + it.bv;
    return itemRowHtml(url, url, t, "", "bili", (it.name || "") + "：" + title);
  }).join("") + (d.error ? '<span class="err">' + esc(d.error) + "</span>" : "");
}
function renderAnth() {
  const d = WB.anth, body = $("#anthBody"), upd = $("#anthUpd");
  if (!d || !d.items || !d.items.length) {
    body.innerHTML = '<span class="dim">' + (d && d.error ? esc(d.error) + "（已保留旧值）" : "等待首抓…") + "</span>";
    upd.textContent = d && d.error ? hm(d.at) + " 失败" : ""; return;
  }
  const articles = AI_WORKBENCH ? d.items.slice(0, 3) : d.items;
  upd.textContent = (d.error ? hm(d.at) + " · 旧值" : hm(d.at) + " 更新") +
    (AI_WORKBENCH ? "（展示 " + articles.length + " / " + d.items.length + "）" : "(" + d.items.length + ")");
  const today = dstr(new Date());
  body.innerHTML = articles.map(a => {
    const t = esc("· " + a.zh) + (a.pub === today ? ' <span class="new">New</span>' : "");
    const meta = esc(a.cat || "") + (a.pub ? " · " + a.pub : "");
    return itemRowHtml(a.url, a.url, t, meta, "anth", a.zh);
  }).join("") + (d.error ? '<span class="err">' + esc(d.error) + "</span>" : "");
}
function renderArxiv() {
  const d = WB.arxiv, body = $("#arxivBody"), upd = $("#arxivUpd");
  const busy = SCHED && SCHED.arxiv && SCHED.arxiv.busy;
  if (busy) { upd.textContent = "选文中…"; }
  else upd.textContent = d && d.at ? (d.error ? hm(d.at) + " · 旧值" : hm(d.at) + " 更新") +
    (AI_WORKBENCH ? "（展示 " + Math.min((d.items || []).length, 3) + " / " + (d.items || []).length + "）" : "(" + (d.items || []).length + ")") : "";
  if ((!d || !d.items || !d.items.length) && !busy) {
    body.innerHTML = '<span class="dim">' + (d && d.error ? esc(d.error) + "（已保留旧值）" : "等待首次选文…") + "</span>";
    return;
  }
  if (busy && (!d || !d.items || !d.items.length)) { body.innerHTML = '<span class="dim">五段选文进行中：抓取 → 预筛 → 粗评 → 精评 → 终选，约 1 分钟…</span>'; return; }
  const today = dstr(new Date());
  const articles = d.items.slice(0, AI_WORKBENCH ? 3 : 6);
  body.innerHTML = '<div class="xgrid">' + articles.map(a => {
    const t = esc("· " + a.zh) + (a.pub === today ? ' <span class="new">New</span>' : "");
    return itemRowHtml(a.url, a.url, t, esc(a.why || ""), "arxiv", a.zh);
  }).join("") + "</div>" + (d.error ? '<span class="err">' + esc(d.error) + "</span>" : "");
}
/* ================= GitHub 趋势榜（日榜/周榜双标签；GLM 解读「是什么/能干什么」；新上榜标注） ================= */
let ghTab = "d";
try { ghTab = localStorage.getItem("wb-gh-tab") === "w" ? "w" : "d"; } catch (e) {}
$("#ghTabs").addEventListener("click", e => {
  const b = e.target.closest("[data-ght]");
  if (!b) return;
  ghTab = b.dataset.ght;
  try { localStorage.setItem("wb-gh-tab", ghTab); } catch (e) {}
  renderGithub();
});
function renderGithub() {
  document.querySelectorAll("#ghTabs button").forEach(b => b.classList.toggle("on", b.dataset.ght === ghTab));
  const d = WB.github, body = $("#githubBody"), upd = $("#githubUpd");
  if (!d || ((!d.items || !d.items.length) && (!d.weekly || !d.weekly.length))) {
    body.innerHTML = '<span class="dim">' + (d && d.error ? esc(d.error) + "（已保留旧值）" : "等待首抓…") + "</span>";
    upd.textContent = d && d.error ? hm(d.at) + " 失败" : ""; return;
  }
  const week = ghTab === "w";
  const list = week ? (d.weekly || []) : (d.items || []);
  const freshN = list.filter(x => x.fresh).length;
  upd.textContent = (d.error ? hm(d.at) + " · 旧值" : hm(d.at) + " 更新") +
    "(日" + ((d.items || []).length) + "·周" + ((d.weekly || []).length) + ")";
  if (!list.length) {
    body.innerHTML = '<span class="dim">' + (week ? "周榜等待首抓（下次 05:00 或点 ↻）" : "日榜为空") + "</span>" +
      (d.error ? '<span class="err">' + esc(d.error) + "</span>" : "");
    return;
  }
  const dl = week ? "本周" : "今日";
  body.innerHTML = list.map((r, i) => {
    const l1 = '<a class="it" href="' + esc(r.url) + '" target="_blank" rel="noopener">' + (i + 1) + ". " + esc(r.repo) + "</a>" +
      (r.fresh ? ' <span class="new">新上榜</span>' : "");
    const delta = r.delta != null ? r.delta : r.today;   // 旧缓存字段兼容
    const meta = (delta ? '<b style="color:var(--c);font-weight:600">' + dl + " +" + delta + " ★</b>" : "") +
      (r.stars ? " · 总 " + r.stars.toLocaleString() + " ★" : "") + (r.lang ? " · " + esc(r.lang) : "");
    const zh = r.zh || r.desc || "";
    return '<div class="item"><div class="l1">' + l1 + "</div>" +
      (meta ? '<span class="imeta">' + meta + "</span>" : "") +
      (zh ? '<span class="imeta" style="line-height:1.6">' + esc(zh) + "</span>" : "") + "</div>";
  }).join("") + (d.error ? '<span class="err">' + esc(d.error) + "</span>" : "");
}
/* ================= Biblioteca 待处理（上传材料巡检） ================= */
function renderKbInbox() {
  const node = document.getElementById("kbinBody");
  if (node) { node.innerHTML = '<a href="kb.html#inbox">前往 Biblioteca 处理待收材料 ↗</a>'; document.getElementById("kbinUpd").textContent = String(INBOX.length); return; }
  const body = $("#kbinBody"), upd = $("#kbinUpd");
  upd.textContent = INBOX.length ? INBOX.length + " 份待看" : "";
  if (!INBOX.length) { body.innerHTML = '<span class="dim">✓ 上传的材料都看过啦 —— 点过 要 / 不要 或写过评论的不再出现</span>'; return; }
  body.innerHTML = INBOX.map(u =>
    '<div class="item"><div class="l1"><a class="it" href="kb.html#b=up-' + esc(u.id) + '&c=0" target="_blank" rel="noopener" title="去 Biblioteca 阅读">' +
    esc(u.title.replace(/\.(md|pdf)$/i, "")) + '</a>' +
    '<button class="icmt" data-kin="' + esc(u.id) + '" data-act="keep" title="要：留在 Biblioteca">✅</button>' +
    '<button class="icmt dsl" data-kin="' + esc(u.id) + '" data-act="discard" title="不要：从 Biblioteca 删除，文件一并移除">🗑</button>' +
    '<button class="icmt" data-kin="' + esc(u.id) + '" data-act="note" title="写评论（全屏输入框，提交即算看过，显示为站主笔记）">💬</button></div>' +
    '<span class="imeta">' + (u.type === "pdf" ? "PDF 原文" : "MD · " + u.chapters + " 章") + " · 上传于 " + hm(u.at) + "</span></div>").join("");
}
async function kbTriage(btn) {
  const id = btn.dataset.kin, act = btn.dataset.act;
  if (act === "discard" && !confirm("不要这份材料？将从 Biblioteca 删除，文件一并移除。")) return;
  btn.disabled = true;
  const r = await api("POST", "/api/kb/triage", { id, act });
  btn.disabled = false;
  if (!r.ok) { toast(r.error || "操作失败"); return; }
  INBOX = INBOX.filter(u => u.id !== id);
  renderKbInbox();
}
/* 评论全屏弹层：点 💬 打开 → 大输入框 → 提交（⌘/Ctrl+Enter）或 Esc 取消 */
let kbinTarget = null;
function kbinOpenNote(id) {
  const u = INBOX.find(x => x.id === id);
  if (!u) return;
  kbinTarget = id;
  $("#kbinDTitle").textContent = u.title.replace(/\.(md|pdf)$/i, "");
  $("#kbinDText").value = "";
  $("#kbinDCount").textContent = "0 / 500";
  $("#kbinMask").style.display = "flex";
  setTimeout(() => $("#kbinDText").focus(), 60);
}
function kbinClose() { $("#kbinMask").style.display = "none"; kbinTarget = null; }
$("#kbinDText").addEventListener("input", () => { $("#kbinDCount").textContent = $("#kbinDText").value.length + " / 500"; });
$("#kbinDCancel").addEventListener("click", kbinClose);
$("#kbinDClose").addEventListener("click", kbinClose);
$("#kbinMask").addEventListener("click", e => { if (e.target.id === "kbinMask") kbinClose(); });
$("#kbinDGo").addEventListener("click", async () => {
  const note = $("#kbinDText").value.trim();
  if (!note) { toast("评论内容为空"); return; }
  const id = kbinTarget;
  if (!id) return;
  const btn = $("#kbinDGo");
  btn.disabled = true;
  const r = await api("POST", "/api/kb/triage", { id, act: "note", note });
  btn.disabled = false;
  if (!r.ok) { toast(r.error || "提交失败"); return; }
  kbinClose();
  INBOX = INBOX.filter(u => u.id !== id);
  renderKbInbox();
});
document.addEventListener("keydown", e => {
  const kbinOpen = $("#kbinMask").style.display !== "none";
  if (e.key === "Escape") {
    if (kbinOpen || $("#atlMask").classList.contains("on")) { kbinClose(); atlasClose(); }
    return;
  }
  if (!kbinOpen) return;
  if ((e.metaKey || e.ctrlKey) && e.key === "Enter") $("#kbinDGo").click();
});

function renderPanelHint() {
  const busyList = ["arxiv"].filter(k => SCHED && SCHED[k] && SCHED[k].busy);
  $("#panelHint").textContent = busyList.length ? "arXiv 五段选文进行中，完成后自动换新" : "";
}

/* ================= Registro ================= */
/* 已总结判定：确认总结时快照过 logIds 的用名单（精确）；旧条目无名单按区间覆盖回退。
   只影响本列表展示——生成总结/年报/半年报走服务器全量，与隐藏无关 */
function wbCoveredSet() {
  const covered = new Set();
  Object.values(WEEKLY.weeks || {}).forEach(w => {
    if (!w.confirmedAt) return;
    if (Array.isArray(w.logIds) && w.logIds.length) w.logIds.forEach(id => covered.add(id));
    else if (w.start && w.end) LOG.forEach(e => { if (e.date >= w.start && e.date <= w.end) covered.add(e.id); });
  });
  return covered;
}
function logRowHtml(e, done) {
  return '<div class="logrow' + (done ? " done" : "") + '"><span class="ld">' + esc((e.date || "").slice(5)) + "</span>" +
    (e.project ? '<span class="lp" title="项目">' + esc(e.project) + "</span>" : "") +
    '<span class="lt">' + esc(e.text) +
    '</span><button class="del" data-del="' + esc(e.id) + '" title="删除">✕</button></div>';
}
function renderLog() {
  const box = $("#logList");
  if (!LOG.length) { box.innerHTML = '<span class="dim">还没有记录，想到什么写什么，周总结会用到。</span>'; renderProjList(); return; }
  const covered = wbCoveredSet();
  const active = LOG.filter(e => !covered.has(e.id));
  const done = LOG.filter(e => covered.has(e.id));
  let html = "";
  if (done.length) html += '<details class="loghist"><summary>已总结 ' + done.length + " 条已自动隐藏 · 点开翻看（年报/半年报重新总结不受影响）</summary><div class='loghistbody'>" +
    done.map(e => logRowHtml(e, true)).join("") + "</div></details>";
  html += active.length ? active.map(e => logRowHtml(e, false)).join("")
    : '<span class="dim">当前没有待总结的记录。</span>';
  box.innerHTML = html;
  renderProjList();
}
/* 项目自动补全：历史用过的项目 + 少量起步种子（输入框可自由手输任意项目名） */
function renderProjList() {
  const seeds = ["El Taller", "家庭AI", "openclaw", "getnote", "求职"];
  const seen = new Set(seeds);
  LOG.forEach(e => { if (e.project) seen.add(e.project); });
  $("#projList").innerHTML = [...seen].map(p => '<option value="' + esc(p) + '">').join("");
}

/* ================= Resumen（任意日期区间） ================= */
function curRangeKey() {
  return ($("#wkStart").value || "?") + "~" + ($("#wkEnd").value || "?");
}
function renderWeekly() {
  const saved = WEEKLY.weeks[curRangeKey()];
  const st = $("#wkState");
  if (saved && saved.confirmedAt) { st.textContent = "已确认 · " + mdhm(saved.confirmedAt); st.className = "wkstate ok"; }
  else if (saved && saved.generatedAt) { st.textContent = "草稿待确认"; st.className = "wkstate"; }
  else { st.textContent = "未生成"; st.className = "wkstate"; }
  if (saved) {
    if (!$("#sumBox").value) $("#sumBox").value = saved.summary || "";
    if (!$("#planBox").value) $("#planBox").value = saved.plan || "";
    $("#confirmInfo").textContent = saved.confirmedAt ? "✓ " + mdhm(saved.confirmedAt) + " 确认，可重新生成覆盖" : "";
  } else {
    $("#confirmInfo").textContent = "";
  }
  const hist = Object.values(WEEKLY.weeks).filter(w => w.confirmedAt).sort((a, b) => (b.confirmedAt || 0) - (a.confirmedAt || 0));
  $("#wkHistList").innerHTML = hist.length ? hist.map(w =>
    '<div class="hitem"><div class="hd"><b>' + esc(w.range || w.week || "") + "</b><span>确认于 " + mdhm(w.confirmedAt) + "</span></div>" +
    '<div class="hsec">总结</div><p>' + esc(w.summary) + "</p>" +
    '<div class="hsec">计划</div><p>' + esc(w.plan) + "</p></div>").join("")
    : '<div class="dim" style="padding:12px 0">还没有归档</div>';
}

/* ================= 评论框交互（事件委托） ================= */
document.addEventListener("click", async e => {
  const tg = e.target.closest("[data-cmt],[data-csave],[data-cnote],[data-del],[data-dis],[data-kin]");
  if (tg && tg.hasAttribute("data-kin")) {
    if (tg.dataset.act === "note") kbinOpenNote(tg.dataset.kin);
    else kbTriage(tg);
    return;
  }
  if (!tg) return;
  if (tg.hasAttribute("data-dis")) {
    const url = tg.dataset.url;
    const undo = !!DIS[url];
    tg.disabled = true;
    const r = await api("PUT", "/api/workbench/dislike", {
      url, source: tg.dataset.src, title: tg.dataset.title, undo,
    });
    tg.disabled = false;
    if (!r.ok) { toast(r.error || "操作失败"); return; }
    if (undo) delete DIS[url];
    else DIS[url] = { url, source: tg.dataset.src, title: tg.dataset.title, at: Date.now() };
    renderAnth();
    renderArxiv();
    toast(undo ? "已撤销不感兴趣" : "已标记不感兴趣：减少同类推荐，不会进 Biblioteca");
    return;
  }
  if (tg.dataset.cmt != null && tg.dataset.cmt !== undefined && tg.hasAttribute("data-cmt")) {
    const box = document.querySelector('[data-cbox="' + CSS.escape(tg.dataset.url) + '"]');
    if (box) box.classList.toggle("on");
    return;
  }
  if (tg.hasAttribute("data-csave") || tg.hasAttribute("data-cnote")) {
    const url = tg.dataset.csave || tg.dataset.cnote;
    const box = document.querySelector('[data-cbox="' + CSS.escape(url) + '"]');
    const text = box.querySelector("textarea").value.trim();
    const btn = tg.hasAttribute("data-cnote") ? tg : box.querySelector("[data-csave]");
    const source = box.closest(".item").querySelector("[data-cmt]").dataset.src;
    const title = box.closest(".item").querySelector("[data-cmt]").dataset.title;
    const savedEl = box.querySelector(".csaved");
    if (tg.hasAttribute("data-cnote") && !text) { savedEl.textContent = "写点什么再收进日志"; savedEl.style.color = "#ff8a80"; return; }
    btn.disabled = true;
    if (tg.hasAttribute("data-cnote")) btn.textContent = "收进中…";
    const r1 = await api("PUT", "/api/workbench/comment", { url, source, title, text });
    let msg = "";
    if (!r1.ok) msg = r1.error || "保存失败";
    if (r1.ok && tg.hasAttribute("data-cnote")) {
      const r2 = await api("POST", "/api/workbench/note", {
        source, sourceUrl: url, sourceTitle: title, text,
        title: box.querySelector(".ctitle").value.trim() || ("读「" + title.slice(0, 24) + "」"),
        visibility: box.querySelector(".cvis").value,
      });
      msg = r2.ok ? "已收进日志 ✓（首页 Cuaderno 可见）" : (r2.error || "收进失败");
    } else if (r1.ok) {
      msg = text ? "评论已存 ✓" : "评论已清除";
    }
    if (r1.ok) {
      if (text) CMT[url] = { url, source, title, text, createdAt: Date.now() };
      else delete CMT[url];
      tg.closest(".item").querySelector("[data-cmt]").classList.toggle("has", !!text);
    }
    btn.disabled = false;
    if (tg.hasAttribute("data-cnote")) btn.textContent = "收进日志";
    savedEl.style.color = "";
    savedEl.textContent = msg;
    return;
  }
  if (tg.hasAttribute("data-del")) {
    await api("DELETE", "/api/workbench/log?id=" + encodeURIComponent(tg.dataset.del));
    LOG = LOG.filter(x => x.id !== tg.dataset.del);
    renderLog();
    toast("已删除");
  }
});

/* ================= 刷新按钮：触发 + 轮询（hw/xhs 除外——数据由 Mac 收集任务推送，↻ 只重拉展示） ================= */
document.querySelectorAll('.rfbtn:not([data-sec="hw"]):not([data-sec="xhs"])').forEach(btn => btn.addEventListener("click", async () => {
  if (btn.disabled) return;
  const sec = btn.dataset.sec;
  btn.disabled = true;
  btn.classList.add("spin");
  await api("POST", "/api/workbench/refresh", { section: sec });
  const startAt = (WB[sec] || {}).at;
  for (let i = 0; i < 45; i++) {
    await sleep(2000);
    const d = await api("GET", "/api/workbench/data");
    WB = d.data; SCHED = d.sched; CFG = d.cfg; DIS = d.dislikes || {};
    if (d.xhs) XHS = d.xhs;
    renderAll();
    if ((WB[sec] || {}).at !== startAt && !(SCHED[sec] || {}).busy) break;
  }
  btn.disabled = false;
  btn.classList.remove("spin");
}));

/* 硬件情报 ↻：重拉 /data 并重渲染（收集任务在 Mac 侧，服务器无可触发抓取） */
$("#card-hw .rfbtn").addEventListener("click", async function () {
  if (this.disabled) return;
  this.disabled = true;
  this.classList.add("spin");
  try {
    const d = await api("GET", "/api/workbench/data");
    HW = d.hw || null;
    renderHw();
    toast(HW ? "已重拉：" + HW.date : "今日尚未生成");
  } catch (_) {}
  await sleep(600);
  this.disabled = false;
  this.classList.remove("spin");
});

/* 小红书 ↻：同 hw —— 数据由 Mac 收集任务推送，只重拉展示 */
$("#card-xhs .rfbtn").addEventListener("click", async function () {
  if (this.disabled) return;
  this.disabled = true;
  this.classList.add("spin");
  try {
    const d = await api("GET", "/api/workbench/data");
    if (d.xhs) XHS = d.xhs;
    renderXhs();
    toast(XHS && XHS.fans != null ? "已重拉：" + xhsFmt(XHS.fans) + " 粉丝" : "尚无推送数据");
  } catch (_) {}
  await sleep(600);
  this.disabled = false;
  this.classList.remove("spin");
});

/* ================= Registro / Resumen / Ajustes 交互 ================= */
$("#logSave").addEventListener("click", async () => {
  const text = $("#logText").value.trim();
  if (!text) { toast("写点内容再记录"); return; }
  const project = $("#logProject").value.trim();
  const r = await api("POST", "/api/workbench/log", { text, date: $("#logDate").value, ...(project ? { project } : {}) });
  if (r.ok) {
    $("#logText").value = "";
    $("#logProject").value = "";
    const d = await api("GET", "/api/workbench/log");
    LOG = d.items || [];
    renderLog();
    toast("已记录 ✓");
  } else toast(r.error || "记录失败");
});
$("#genBtn").addEventListener("click", async () => {
  const btn = $("#genBtn");
  if (!$("#wkStart").value || !$("#wkEnd").value) { toast("先选起止日期"); return; }
  btn.disabled = true;
  const old = btn.textContent;
  btn.textContent = "生成中…（约 1 分钟）";
  $("#genErr").textContent = "";
  const r = await api("POST", "/api/workbench/weekly/generate", { start: $("#wkStart").value, end: $("#wkEnd").value });
  btn.disabled = false;
  btn.textContent = old;
  if (r.ok) {
    $("#sumBox").value = r.draft.summary;
    $("#planBox").value = r.draft.plan;
    toast("草稿已生成，改完点「确认计划」");
  } else {
    $("#genErr").textContent = r.error || "生成失败";
  }
});
$("#confirmBtn").addEventListener("click", async () => {
  const summary = $("#sumBox").value.trim(), plan = $("#planBox").value.trim();
  if (!$("#wkStart").value || !$("#wkEnd").value) { toast("先选起止日期"); return; }
  if (!summary || !plan) { toast("总结和计划都要有内容"); return; }
  const btn = $("#confirmBtn");
  btn.disabled = true;
  const r = await api("POST", "/api/workbench/weekly/confirm", { start: $("#wkStart").value, end: $("#wkEnd").value, summary, plan });
  btn.disabled = false;
  if (r.ok) {
    const d = await api("GET", "/api/workbench/weekly");
    WEEKLY = d;
    renderWeekly();
    renderLog();
    toast("计划已确认 ✓");
  } else toast(r.error || "确认失败");
});
$("#wkStart").addEventListener("change", () => { $("#sumBox").value = ""; $("#planBox").value = ""; renderWeekly(); });
$("#wkEnd").addEventListener("change", () => { $("#sumBox").value = ""; $("#planBox").value = ""; renderWeekly(); });
$("#cfgSave").addEventListener("click", async () => {
  const btn = $("#cfgSave");
  btn.disabled = true;
  let ups;
  try { ups = JSON.parse($("#cfgUps").value || "[]"); }
  catch { toast("UP 清单不是合法 JSON"); btn.disabled = false; return; }
  const body = { biliUps: Array.isArray(ups) ? ups : [] };
  if ($("#cfgKey").value.trim()) body.glmKey = $("#cfgKey").value.trim();
  if ($("#cfgCookie").value.trim()) body.biliCookie = $("#cfgCookie").value.trim();
  if ($("#cfgDtId").value.trim() || $("#cfgDtSecret").value.trim())
    body.dingtalk = { clientId: $("#cfgDtId").value.trim(), clientSecret: $("#cfgDtSecret").value.trim() };
  if ($("#cfgProfile").value.trim()) body.arxivProfile = $("#cfgProfile").value.trim();
  const r = await api("POST", "/api/workbench/config", body);
  btn.disabled = false;
  if (r.ok) {
    $("#cfgKey").value = ""; $("#cfgCookie").value = "";
    $("#cfgSaved").textContent = "已保存 ✓ " + hm(Date.now()) + "，板块自动刷新";
    window.dispatchEvent(new CustomEvent("workbench:config-saved"));
    const d = await api("GET", "/api/workbench/data");
    if (d.cfg && d.data) {
      CFG = d.cfg; WB = d.data;
      renderBanner(); renderGLM();
    }
    ["glm", "oil", "bili", "anth"].forEach(sec => api("POST", "/api/workbench/refresh", { section: sec }));
    toast("设置已保存，板块刷新中");
  } else toast(r.error || "保存失败");
});

/* ================= Calendario 日历 ================= */
let calY = 0, calM = 0, calSel = "";   // 查看月份与选中日（YYYY-MM-DD）
let calFilter = "all";                   // 日历分类筛选：all / work / life
let memoCat = "life";                    // 新建备忘的分类（表单按钮切换）
try { calFilter = localStorage.getItem("cal-filter") || "all"; } catch (e) {}
const memoCatOf = m => m.cat === "work" ? "work" : "life";   // 旧备忘无 cat 默认生活
const calShowLogs = () => calFilter !== "life" && calFilter !== "dt";
const calShowF1 = () => calFilter !== "work" && calFilter !== "dt";
const calShowDt = () => DTC.status && DTC.status.configured && (calFilter === "all" || calFilter === "dt");

/* ---- Agenda 日程（DingTalk → 工作台，单向只读；状态 + 缓存事件一次拉全） ---- */
let DTC = { status: { configured: false, bound: false }, events: [] };
async function dtLoad() {
  try {
    const r = await api("GET", "/api/workbench/dingtalk/events");
    DTC = { status: r.status || {}, events: r.events || [] };
  } catch (e) { return; }   // 接口不可用（旧版服务端）→ 静默保持隐藏
  dtRenderState();
  renderCalendar();
}
function dtRenderState() {
  const s = DTC.status || {};
  const bar = $("#dtBar"), chip = $("#dtChip"), legend = $("#dtLegend");
  if (!s.configured) { bar.style.display = "none"; chip.style.display = "none"; legend.style.display = "none"; return; }
  bar.style.display = ""; chip.style.display = ""; legend.style.display = "";
  $("#dtBind").style.display = s.bound ? "none" : "";
  $("#dtSync").style.display = s.bound ? "" : "none";
  const el = $("#dtState");
  el.classList.remove("err");
  if (!s.bound) el.textContent = "Agenda：未绑定";
  else if (s.needRebind || (!s.lastOk && s.error)) { el.textContent = s.error || "授权失效，请重新绑定"; el.classList.add("err"); $("#dtBind").style.display = ""; }
  else el.textContent = "Agenda" + (s.nick ? "·" + s.nick : "") + " 已同步 " + (s.lastAt ? hm(s.lastAt) : "—");
}
function dtRowHtml(ev) {
  const t = ev.allDay ? "全天" : ((ev.start || "").slice(11, 16) + "–" + (ev.end || "").slice(11, 16) +
    ((ev.end || "").slice(0, 10) > (ev.start || "").slice(0, 10) ? "→次日" : ""));
  return '<div class="drow"><i class="cdot dt"></i><span><b>' + t + "</b> · " + esc(ev.title || "(无标题)") +
    (ev.location ? " · 📍" + esc(ev.location) : "") + (ev.organizer ? " · " + esc(ev.organizer) : "") + "</span></div>";
}
const calShowMemo = m => calFilter === "all" || memoCatOf(m) === calFilter;
const WD_ZH = ["一", "二", "三", "四", "五", "六", "日"];
const HOLIDAYS = {};                    // year -> [{name,date,isOffDay}]（服务端 holiday-cn 缓存）
let holidaysAsked = {};
function ensureHolidaysFront(year) {
  if (HOLIDAYS[year] || holidaysAsked[year]) return;
  holidaysAsked[year] = true;
  api("GET", "/api/workbench/holidays?year=" + year).then(r => {
    HOLIDAYS[year] = r.days || [];
    renderCalendar();
  }).catch(() => {});
}
function holidayMap(year) {
  const m = {};
  (HOLIDAYS[year] || []).forEach(h => { m[h.date] = h; });
  return m;
}
function renderCalendar() {
  if (!calY) {
    const t = new Date();
    calY = t.getFullYear(); calM = t.getMonth(); calSel = dstr(t);
  }
  ensureHolidaysFront(calY);
  const holMap = holidayMap(calY);
  $("#calTitle").textContent = calY + " 年 " + (calM + 1) + " 月";
  document.querySelectorAll("#calChips .calchip").forEach(c => c.classList.toggle("on", c.dataset.calf === calFilter));
  const today = dstr(new Date());
  const map = {};
  if (calShowLogs()) LOG.forEach(e => { (map[e.date] = map[e.date] || { log: 0, memo: 0, memoOpen: 0, f1s: [] }).log++; });
  MEMOS.forEach(m => { if (!calShowMemo(m)) return; const c = (map[m.date] = map[m.date] || { log: 0, memo: 0, memoOpen: 0, f1s: [] }); c.memo++; if (!m.done) c.memoOpen++; });
  if (calShowF1()) (WB.f1 && WB.f1.races || []).forEach(r => {
    const push = (ds, label, hm) => {
      if (!ds) return;
      const c = (map[ds] = map[ds] || { log: 0, memo: 0, memoOpen: 0, f1s: [] });
      if (!c.f1s.some(x => x.name === r.raceName && x.label === label)) c.f1s.push({ name: r.raceName, label, hm: hm || "" });
    };
    if (Array.isArray(r.sessions) && r.sessions.length) r.sessions.forEach(ss => push(ss.date, ss.label, ss.hm));
    else { push(r.date, "正赛", r.time); push(r.sprint, "冲刺赛", r.sprintTime); }   // 旧缓存兜底
  });
  if (calShowDt()) DTC.events.forEach(ev => {
    const c = (map[ev.ds] = map[ev.ds] || { log: 0, memo: 0, memoOpen: 0, f1s: [], dt: 0 });
    c.dt = (c.dt || 0) + 1;
  });
  const first = new Date(calY, calM, 1);
  const offset = (first.getDay() + 6) % 7;             // 周一为第一列
  const daysInMonth = new Date(calY, calM + 1, 0).getDate();
  const rows = Math.ceil((offset + daysInMonth) / 7);
  let html = WD_ZH.map(w => '<span class="calwd">' + w + "</span>").join("");
  for (let i = 0; i < rows * 7; i++) {
    const dObj = new Date(calY, calM, i - offset + 1);
    const ds = dstr(dObj);
    const out = dObj.getMonth() !== calM;
    const hol = holMap[ds];
    const holHtml = hol ? (hol.isOffDay
      ? '<span class="hol">' + esc(hol.name.replace(/节$/, "")) + "</span>"
      : '<span class="ban">班</span>') : "";
    const c = map[ds];
    const zwd = zwDotFor(ds);
    let dots = "";
    if (c || zwd) {
      dots = '<span class="caldots">' +
        (c && c.log ? '<i class="cdot log"></i>' : "") +
        (c && c.memo ? '<i class="cdot ' + (c.memoOpen ? "memo" : "memodone") + '"></i>' : "") +
        (c && c.f1s && c.f1s.length ? '<i class="cdot f1" title="' + esc(c.f1s.map(x => "F1 " + x.name + " " + x.label + (x.hm ? " · " + x.hm : "")).join("\n")) + '"></i>' : "") +
        (c && c.dt ? '<i class="cdot dt" title="Agenda 日程 ×' + c.dt + '"></i>' : "") + zwd + "</span>";
    }
    html += '<button type="button" class="calday' + (out ? " out" : "") + zwHeatCls(ds, !out) +
      (ds === today ? " today" : "") + (ds === calSel ? " sel" : "") + (hol && hol.isOffDay ? " off" : "") +
      '"' + zwHeatTitle(ds) + ' data-calday="' + ds + '">' +
      '<span class="calhead"><b>' + dObj.getDate() + "</b>" + holHtml + "</span>" + dots + "</button>";
  }
  $("#calGrid").innerHTML = html;
  $("#calGrid").classList.toggle("heaton", ZW_HEAT !== "all" && zwReady());
  renderZwMount();
  renderZwWeek();
  renderCalDetail();
}
function renderCalDetail() {
  const dObj = new Date(calSel + "T00:00:00");
  const wd = WD_ZH[(dObj.getDay() + 6) % 7];
  const logs = calShowLogs() ? LOG.filter(e => e.date === calSel) : [];
  const memos = MEMOS.filter(m => m.date === calSel && calShowMemo(m));
  const races = (WB.f1 && WB.f1.races) || [];
  const f1Today = [];
  races.forEach(r => {
    if (Array.isArray(r.sessions)) r.sessions.forEach(ss => { if (ss.date === calSel) f1Today.push({ name: r.raceName, label: ss.label, hm: ss.hm, locality: r.locality }); });
    else {
      if (r.date === calSel) f1Today.push({ name: r.raceName, label: "正赛", hm: r.time, locality: r.locality });
      if (r.sprint === calSel) f1Today.push({ name: r.raceName, label: "冲刺赛", hm: r.sprintTime, locality: r.locality });
    }
  });
  f1Today.sort((a, b) => (a.hm || "").localeCompare(b.hm || ""));
  let html = "<h4>" + (dObj.getMonth() + 1) + "月" + dObj.getDate() + "日 · 星期" + wd + (calSel === dstr(new Date()) ? " · 今天" : "") + "</h4>";
  const hol = holidayMap(calY)[calSel];
  if (hol) html += '<div class="dim small">' + (hol.isOffDay ? "节假日：" : "调休补班：") + esc(hol.name) + "</div>";
  html += zwDailyHtml(calSel);
  if (calShowF1() && f1Today.length) {
    html += '<div class="dsec">F1 赛历</div>';
    html += f1Today.map(x =>
      '<div class="drow"><i class="cdot f1"></i><span>🏎 ' + esc(x.name) + " · " + esc(x.label) +
      (x.hm ? ' · <b>' + x.hm + "</b> 开赛（北京时间）" : "") +
      (x.locality ? " · " + esc(x.locality) : "") + "</span></div>").join("");
  }
  if (calShowDt()) {
    const dts = DTC.events.filter(e => e.ds === calSel).sort((a, b) => (a.start || "").localeCompare(b.start || ""));
    html += '<div class="dsec">Agenda 日程</div>';
    html += dts.length ? dts.map(dtRowHtml).join("") : '<div class="dim small">这一天没有 Agenda 日程</div>';
  }
  if (calShowLogs()) {
    html += '<div class="dsec">已完成的工作</div>';
    html += logs.length ? logs.map(l => '<div class="drow"><i class="cdot log"></i><span>' + esc(l.text) + "</span></div>").join("")
      : '<div class="dim small">这一天没有工作记录</div>';
  }
  html += '<div class="dsec">备忘 / 计划</div>';
  html += memos.length ? memos.map(m => memoRowHtml(m)).join("") : '<div class="dim small">这一天没有备忘</div>';
  $("#calDetail").innerHTML = html;
}
function memoTagHtml(m) {
  const cat = memoCatOf(m);
  return '<button type="button" class="mtag' + (cat === "life" ? " life" : "") + '" data-mcat="' + m.id +
    '" title="点击切换 工作/生活">' + (cat === "work" ? "工" : "生") + "</button>";
}
function memoRowHtml(m) {
  return '<div class="mrow' + (m.done ? " done" : "") + '"><button type="button" class="mchk' + (m.done ? " on" : "") +
    '" data-mchk="' + m.id + '" title="' + (m.done ? "标记未完成" : "标记完成") + '">' + (m.done ? "✓" : "") + "</button>" +
    '<span class="mtext">' + esc(m.text) + "</span>" + memoTagHtml(m) +
    '<button type="button" class="del" data-mdel="' + m.id + '" title="删除">✕</button></div>';
}
function renderMemos() {
  const box = $("#memoList");
  if (!MEMOS.length) { box.innerHTML = '<span class="dim small">没有备忘。想到就记，选个日期就会落在日历上。</span>'; return; }
  box.innerHTML = MEMOS.map(m =>
    '<div class="mrow' + (m.done ? " done" : "") + '"><button type="button" class="mchk' + (m.done ? " on" : "") +
    '" data-mchk="' + m.id + '">' + (m.done ? "✓" : "") + "</button>" +
    '<span class="mdate" data-mjump="' + m.date + '" title="在日历中查看">' + m.date.slice(5) + "</span>" +
    '<span class="mtext">' + esc(m.text) + "</span>" +
    '<button type="button" class="del" data-mdel="' + m.id + '" title="删除">✕</button></div>').join("");
}
function calRefresh() { renderCalendar(); renderMemos(); }

$("#calPrev").addEventListener("click", () => { calM--; if (calM < 0) { calM = 11; calY--; } renderCalendar(); });
$("#calNext").addEventListener("click", () => { calM++; if (calM > 11) { calM = 0; calY++; } renderCalendar(); });
$("#calToday").addEventListener("click", () => {
  const t = new Date();
  calY = t.getFullYear(); calM = t.getMonth(); calSel = dstr(t);
  renderCalendar();
});
$("#calGrid").addEventListener("click", e => {
  const btn = e.target.closest("[data-calday]");
  if (!btn) return;
  calSel = btn.dataset.calday;
  renderCalendar();
});
$("#memoSave").addEventListener("click", async () => {
  const text = $("#memoText").value.trim();
  if (!text) { toast("写点内容再记下"); return; }
  const r = await api("POST", "/api/workbench/memos", { text, date: $("#memoDate").value, cat: memoCat });
    if (r.ok) { $("#memoCat").textContent = "分类：生活"; memoCat = "life"; }
  if (r.ok) {
    $("#memoText").value = "";
    const d = await api("GET", "/api/workbench/memos");
    MEMOS = d.items || [];
    calRefresh();
    toast("备忘已记 ✓");
  } else toast(r.error || "记录失败");
});
document.getElementById("calChips").addEventListener("click", e => {
  const c = e.target.closest("[data-calf]");
  if (!c) return;
  calFilter = c.dataset.calf;
  try { localStorage.setItem("cal-filter", calFilter); } catch (_) {}
  renderCalendar();
});
document.getElementById("memoCat").addEventListener("click", () => {
  memoCat = memoCat === "life" ? "work" : "life";
  document.getElementById("memoCat").textContent = "分类：" + (memoCat === "life" ? "生活" : "工作");
});
/* Agenda：绑定（跳授权页）/ 立即同步 */
$("#dtBind").addEventListener("click", () => { location.href = "/api/workbench/dingtalk/bind"; });
$("#dtSync").addEventListener("click", async () => {
  toast("Agenda 同步已开始…");
  await api("POST", "/api/workbench/refresh", { section: "dingtalk" }).catch(() => {});
  setTimeout(dtLoad, 2500);
});
document.addEventListener("click", async e => {
  const mc = e.target.closest("[data-mcat]");
  if (mc) {
    const m = MEMOS.find(x => x.id === mc.dataset.mcat);
    if (!m) return;
    const next = memoCatOf(m) === "life" ? "work" : "life";
    const r = await api("PUT", "/api/workbench/memos", { id: m.id, cat: next });
    if (r.ok) { m.cat = next; renderMemos(); renderCalendar(); }
    return;
  }
  const tg = e.target.closest("[data-mchk],[data-mdel],[data-mjump]");
  if (!tg) return;
  if (tg.hasAttribute("data-mchk")) {
    const memo = MEMOS.find(m => m.id === tg.dataset.mchk);
    if (!memo) return;
    const r = await api("PUT", "/api/workbench/memos", { id: memo.id, done: !memo.done });
    if (r.ok) {
      memo.done = !memo.done;
      MEMOS.sort((a, b) => a.done === b.done ? (a.date.localeCompare(b.date) || a.createdAt - b.createdAt) : (a.done ? 1 : -1));
      calRefresh();
    }
    return;
  }
  if (tg.hasAttribute("data-mdel")) {
    const r = await api("DELETE", "/api/workbench/memos?id=" + encodeURIComponent(tg.dataset.mdel));
    if (r.ok) {
      MEMOS = MEMOS.filter(m => m.id !== tg.dataset.mdel);
      calRefresh();
      toast("已删除");
    }
    return;
  }
  if (tg.hasAttribute("data-mjump")) {
    const parts = tg.dataset.mjump.split("-");
    calY = parseInt(parts[0], 10); calM = parseInt(parts[1], 10) - 1; calSel = tg.dataset.mjump;
    renderCalendar();
    $("#calGrid").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
});

/* ================= 紫微运势（引擎 ziwei.js · 作者 liyanjun · 通行口径） =================
   生辰存服务端 data/ziwei.json（仅 admin 接口可读写）；排盘与推演全在前端本地确定性计算。
   月视图打点 = 流日综合星级（菱形）；月主题条 = 流月四化落宫；周运势条 = 7 流日聚合。 */
let ZW_BIRTH = null, ZW_CHART = null, ZW_ON = true, ZW_FORM = false;
try { ZW_ON = localStorage.getItem("cal-zw") !== "0"; } catch (e) {}
let ZW_HEAT = "all";                                     // 热力领域：all=综合(菱形点) / career / wealth / love / health
try { const h = localStorage.getItem("cal-zw-heat"); ZW_HEAT = ["all","career","wealth","love","health"].includes(h) ? h : "all"; } catch (e) {}
let ZW_SUMMARY = {};                                     // monthKey -> {text, glm}（GLM 月总述内存缓存，服务端另有持久缓存）
let ZW_MONTH_CACHE = { key: "", grid: null, report: null };
const zwReady = () => !!(window.ZW && ZW_CHART && ZW_ON);
const zwSI2Cls = { "禄": "lu", "权": "quan", "科": "ke", "忌": "ji" };
function zwMonthData() {
  if (!zwReady()) return null;
  const key = calY + "-" + calM;
  if (ZW_MONTH_CACHE.key === key) return ZW_MONTH_CACHE.grid;
  ZW_MONTH_CACHE = { key, grid: null, report: null };
  try {
    ZW_MONTH_CACHE.grid = ZW.monthGrid(ZW_CHART, calY, calM + 1);
    ZW_MONTH_CACHE.report = ZW.monthReport(ZW_CHART, calY, calM + 1);
  } catch (e) { /* 超出农历表等 */ }
  return ZW_MONTH_CACHE.grid;
}
function zwReport() { zwMonthData(); return ZW_MONTH_CACHE.report; }
function zwCellOf(g, ds) { return g && g.cells.find(c => c.y + "-" + pad2(c.m) + "-" + pad2(c.d) === ds); }
function zwDotFor(ds) {
  if (!zwReady()) return "";
  const cell = zwCellOf(zwMonthData(), ds);
  if (!cell || cell.overall == null) return "";
  const tip = "流日运势 " + "★".repeat(cell.overall) + "☆".repeat(5 - cell.overall) +
    "\n" + cell.sihua.map((s, i) => "化" + ["禄", "权", "科", "忌"][i] + s).join(" · ");
  return '<i class="cdot zw zw' + cell.overall + '" title="' + esc(tip) + '"></i>';
}
function zwHeatCls(ds, inMonth) {
  if (ZW_HEAT === "all" || !inMonth || !zwReady()) return "";
  const cell = zwCellOf(zwMonthData(), ds);
  return cell && cell.stars ? " heat" + cell.stars[ZW_HEAT] : "";
}
function zwHeatTitle(ds) {
  if (!zwReady()) return "";
  const cell = zwCellOf(zwMonthData(), ds);
  if (!cell || !cell.stars) return "";
  return ' title="' + esc("事业★" + cell.stars.career + " 财运★" + cell.stars.wealth + " 感情★" + cell.stars.love + " 健康★" + cell.stars.health) + '"';
}
/* GLM 月总述：素材为引擎确定性产物；成功换 ✨ 版文案，失败/无 Key 保持规则表 headline */
function zwEnsureSummary(rep) {
  if (!ZW_BIRTH || !rep || ZW_SUMMARY[rep.monthKey]) return;
  ZW_SUMMARY[rep.monthKey] = { pending: true };
  const birthFp = [ZW_BIRTH.y, ZW_BIRTH.m, ZW_BIRTH.d, ZW_BIRTH.hour, ZW_BIRTH.gender].join("-");
  api("POST", "/api/workbench/ziwei/month-summary", {
    monthKey: rep.monthKey, birthFp,
    material: { headline: rep.headline, rows: rep.rows, monthStars: rep.monthStars,
      goodDays: rep.goodDays, cautionDays: rep.cautionDays }
  }).then(r => {
    ZW_SUMMARY[rep.monthKey] = r && r.ok && r.summary ? { text: r.summary, glm: true } : { text: rep.headline, glm: false };
    if (ZW_MONTH_CACHE.key === calY + "-" + calM) renderZwMount();
  }).catch(() => { ZW_SUMMARY[rep.monthKey] = { text: rep.headline, glm: false }; });
}
function zwStarsHtml(stars) {
  return '<span class="zwstars">' + Object.entries(ZW.DOMAIN_NAME).map(([k, name]) =>
    '<span>' + name + ' <b>' + "★".repeat(stars[k]) + "☆".repeat(5 - stars[k]) + "</b></span>").join("") + "</span>";
}
function renderZwMount() {
  const box = $("#zwMount");
  $("#zwLegend").style.display = ZW_BIRTH ? "" : "none";
  if (!window.ZW) { box.innerHTML = ""; return; }
  /* 未配置：引导条 */
  if (!ZW_BIRTH) {
    box.innerHTML = '<div class="zwmonth"><span>🔮 紫微月/周/日运势还没配置生辰</span>' +
      (ZW_FORM ? "" : '<button class="calbtn zwset" data-zw="form">设置生辰</button>') + "</div>" +
      (ZW_FORM ? zwFormHtml() : "");
    return;
  }
  /* 已配置但被关掉：只留开关行 */
  const g = zwMonthData();
  let inner = "";
  if (!ZW_ON) {
    inner = '<span class="dim">流日运势已隐藏</span><button class="calbtn zwset" data-zw="toggle">显示</button>';
  } else if (!g || !g.theme) {
    inner = '<span>🔮 本月运势推演暂不可用（超出农历表范围）</span><button class="calbtn zwset" data-zw="toggle">隐藏</button>';
  } else {
    const t = g.theme, rep = zwReport() || { headline: "", goodDays: [], cautionDays: [], monthStars: t.stars, monthKey: "" };
    zwEnsureSummary(zwReport());
    const SI4 = ["禄", "权", "科", "忌"];
    /* 第一行：现状主题 + 四化标签（hover 出落宫解读）+ 宜忌 + 按钮 */
    inner = '<span>🔮 农历' + t.mEff + '月 · 流月行至本命<b>' + esc(t.yuePalaceName) + '</b></span>' +
      t.sihua.map((s, i) => '<span class="zwtag ' + zwSI2Cls[SI4[i]] + '" title="' +
        esc((t.rows.find(r => r.si === SI4[i]) || {}).text || "") + '">' + SI4[i] + esc(s) + "</span>").join("") +
      '<span>' + esc(t.advice) + "</span>" +
      '<button class="calbtn zwset" data-zw="toggle">隐藏</button><button class="calbtn zwset" data-zw="form">生辰</button>';
    /* 第二行：领域 chips（带月度★）+ 热力图例 */
    const chips = [["all", "综合", null]].concat(Object.entries(ZW.DOMAIN_NAME))
      .map(([k, name]) => [k, name, rep.monthStars ? rep.monthStars[k] : null])
      .map(([k, name, st]) => '<button type="button" class="calchip' + (ZW_HEAT === k ? " on" : "") + '" data-zwheat="' + k + '">' +
        name + (st ? "★" + st : "") + "</button>").join("");
    const HEAT_LEG = '<span class="zwlegend" title="底色=当日该领域星级：深绿★5 → 淡红★1">' +
      [5, 4, 3, 2, 1].map(n => '<i class="heatleg' + n + '"></i>').join("") + "</span>";
    inner += '<span class="zwchips">' + chips + (ZW_HEAT !== "all" ? HEAT_LEG : "") + "</span>";
    /* 第三行：月总述（GLM ✨ / 规则表）+ 吉慎日 */
    const sum = ZW_SUMMARY[rep.monthKey];
    const sumText = sum && sum.text ? sum.text : rep.headline;
    inner += '<span class="zws2">' + (sum && sum.glm ? '<i class="glmmark">✨</i>' : "") + esc(sumText) + "</span>";
    if (rep.goodDays && rep.goodDays.length) {
      inner += '<span class="zws2"><span class="zwgd">吉</span> ' + rep.goodDays.map(d =>
        '<b data-zwday="' + d.date + '" title="' + esc(d.why + " · 点开看当天") + '">' + d.date.slice(5) + "</b>").join("·") +
        '　<span class="zwcd">慎</span> ' + rep.cautionDays.map(d =>
        '<b data-zwday="' + d.date + '" title="' + esc(d.why + " · 点开看当天") + '">' + d.date.slice(5) + "</b>").join("·") + "</span>";
    }
  }
  box.innerHTML = '<div class="zwmonth">' + inner + "</div>" + (ZW_FORM ? zwFormHtml() : "");
}
function zwFormHtml() {
  const b = ZW_BIRTH || { y: 1990, m: 6, d: 15, hour: 6, gender: "男" };
  const opts = ["子 23-01", "丑 01-03", "寅 03-05", "卯 05-07", "辰 07-09", "巳 09-11",
    "午 11-13", "未 13-15", "申 15-17", "酉 17-19", "戌 19-21", "亥 21-23"]
    .map((t, i) => '<option value="' + i + '"' + (i === b.hour ? " selected" : "") + ">" + t + "时</option>").join("");
  return '<div class="zwform">' +
    '<label>公历年<input id="zwY" type="number" min="1900" max="2100" value="' + b.y + '"></label>' +
    '<label>月<input id="zwM" type="number" min="1" max="12" value="' + b.m + '"></label>' +
    '<label>日<input id="zwD" type="number" min="1" max="31" value="' + b.d + '"></label>' +
    '<label>时辰<select id="zwH">' + opts + "</select></label>" +
    '<label>性别<select id="zwG"><option' + (b.gender === "男" ? " selected" : "") + '>男</option><option' + (b.gender === "女" ? " selected" : "") + '>女</option></select></label>' +
    '<button class="calbtn" data-zw="save">保存</button><button class="calbtn" data-zw="cancel">收起</button>' +
    '<span class="dim" style="align-self:center">仅站主本人排盘 · 存服务端不入库 · 闰月前15日归本月后16日起归下月</span></div>';
}
function renderZwWeek() {
  const box = $("#zwWeekMount");
  if (!zwReady()) { box.innerHTML = ""; return; }
  /* 选中日所在周（周一起） */
  const dObj = new Date(calSel + "T00:00:00");
  const monday = new Date(dObj);
  monday.setDate(dObj.getDate() - (dObj.getDay() + 6) % 7);
  let wk;
  try { wk = ZW.week(ZW_CHART, dstr(monday)); } catch (e) { box.innerHTML = ""; return; }
  const today = dstr(new Date());
  box.innerHTML = '<div class="zwweek"><div class="zwwh"><b>本周运势</b><span>' + esc(wk.advice) + "</span>" +
    (wk.best ? "<span>最佳 " + wk.best.date.slice(5) + " ★" + wk.best.overall + "</span>" : "") +
    (wk.worst ? "<span>最慎 " + wk.worst.date.slice(5) + " ★" + wk.worst.overall + "</span>" : "") + "</div>" +
    '<div class="zwrow">' + wk.days.map(d => {
      const best = Object.entries(d.stars).sort((a, b) => b[1] - a[1])[0];
      return '<button type="button" class="zwcell' + (d.date === calSel ? " sel" : "") + '" data-zwday="' + d.date + '">' +
        "<b>" + d.date.slice(5).replace("-", "/") + (d.date === today ? " ·今" : "") + "</b>" +
        '<span class="zwst"><i class="cdot zw zw' + d.overall + '" style="display:inline-block"></i> ' + "★" + d.overall + "</span>" +
        '<span class="zwst">' + ZW.DOMAIN_NAME[best[0]] + "旺</span></button>";
    }).join("") + "</div></div>";
}
function zwDailyHtml(ds) {
  if (!zwReady()) return "";
  let d;
  try { d = ZW.daily(ZW_CHART, ds); } catch (e) { return ""; }
  if (!d) return "";
  const lx = d.lunar.leap ? "闰" : "";
  let html = '<div class="dsec">流日运势</div>';
  html += '<div class="zwdx">农历' + lx + d.lunar.m + "月" + d.lunar.d + "日 · 流日命宫行至本命<b>" + esc(d.riPalaceName) + "</b>" +
    (d.dxName ? " · 虚岁" + d.age + "走" + esc(d.dxName) + "大限" : "") + "</div>";
  html += '<div class="dim small" style="margin-bottom:6px">' + esc(d.riTheme) + " · " + esc(d.advice) + "</div>";
  html += d.rows.map(r => '<div class="drow"><span class="zwtag ' + zwSI2Cls[r.si] + '">' + r.si + "</span><span>" +
    esc(r.star) + "化" + r.si + " · " + esc(r.text) + "</span></div>").join("");
  html += zwStarsHtml(d.stars);
  html += '<div class="dim" style="font-size:10px;margin-top:8px">流月层：化' + ["禄", "权", "科", "忌"].map((s, i) => s + esc(d.yueSihua[i])).join(" 化") + "</div>";
  return html;
}
document.addEventListener("click", async e => {
  const hw = e.target.closest("[data-zwheat]");
  if (hw) {
    ZW_HEAT = hw.dataset.zwheat;
    try { localStorage.setItem("cal-zw-heat", ZW_HEAT); } catch (_) {}
    renderCalendar();
    return;
  }
  const z = e.target.closest("[data-zw],[data-zwday]");
  if (!z) return;
  if (z.dataset.zwday) {
    const p = z.dataset.zwday.split("-");
    calY = +p[0]; calM = +p[1] - 1; calSel = z.dataset.zwday;
    renderCalendar();
    return;
  }
  const act = z.dataset.zw;
  if (act === "toggle") {
    ZW_ON = !ZW_ON;
    try { localStorage.setItem("cal-zw", ZW_ON ? "1" : "0"); } catch (_) {}
    renderCalendar();
  } else if (act === "form") {
    ZW_FORM = true; renderZwMount();
  } else if (act === "cancel") {
    ZW_FORM = false; renderZwMount();
  } else if (act === "save") {
    const birth = { y: +$("#zwY").value, m: +$("#zwM").value, d: +$("#zwD").value, hour: +$("#zwH").value, gender: $("#zwG").value };
    const r = await api("PUT", "/api/workbench/ziwei", { birth });
    if (r.ok) {
      ZW_BIRTH = r.birth; ZW_FORM = false;
      try { ZW_CHART = ZW.natal(ZW_BIRTH); } catch (err) { toast("生辰无法排盘：" + err.message); ZW_CHART = null; }
      ZW_MONTH_CACHE = { key: "", grid: null, report: null };
      ZW_SUMMARY = {};
      renderCalendar(); toast("生辰已保存 ✓");
    } else toast(r.error || "保存失败");
  }
});
(async function zwInit() {
  if (location.protocol === "file:" || !window.ZW) return;
  try {
    const r = await api("GET", "/api/workbench/ziwei");
    if (r && r.birth) {
      ZW_BIRTH = r.birth;
      try { ZW_CHART = ZW.natal(ZW_BIRTH); } catch (e) { console.warn("[ziwei]", e.message); }
      renderCalendar();
    }
  } catch (e) {}
})();


/* ================= 装配 ================= */
/* 信息面板折叠：状态记 localStorage，刷新/重开保持 */
(function () {
  const btn = $("#panelFold"), body = $("#panelBody");
  function applyFold(folded) {
    body.hidden = folded;
    btn.classList.toggle("folded", folded);
    btn.setAttribute("aria-expanded", String(!folded));
  }
  btn.addEventListener("click", () => {
    const folded = !body.hidden;
    applyFold(folded);
    try { localStorage.setItem("taller-wb-panel", folded ? "1" : "0"); } catch (_) {}
  });
  try { if (localStorage.getItem("taller-wb-panel") === "1") applyFold(true); } catch (_) {}
})();

/* ================= 智能硬件 · 每日情报（Mac 收集任务推送：一段整合文字 + 原始链接） ================= */
let HW = null;
const HW_CATS = [["众筹源头","🚀"],["测评口碑","🧪"],["二手保值","💹"],["海外口碑","🌐"],["展会新品","🎪"],["行业数据","📊"]];
function renderHw() {
  const body = $("#hwBody");
  if (!body) return;
  if (!HW || (!HW.summary && !(HW.links || []).length)) {
    $("#hwUpd").textContent = "";
    body.innerHTML = '<span class="hw-empty">今日尚未生成 —— 情报由 Mac 上的收集任务（openclaw「taller-硬件情报站」）每天推送，Mac 离线当天缺席，最近一次见右上年月日</span>';
    return;
  }
  $("#hwUpd").textContent = HW.date + " · " + (HW.links || []).length + " 条";
  const by = new Map();
  for (const l of HW.links || []) {
    if (!by.has(l.cat)) by.set(l.cat, []);
    by.get(l.cat).push(l);
  }
  let html = "";
  if (HW.summary) html += '<div class="hw-sum">' + esc(HW.summary) + "</div>";
  const catHtml = (cat, ico, ls) => '<div class="hw-cat">' + ico + " " + esc(cat) + "</div>" + ls.map(l =>
    '<div class="hw-link"><span class="hw-src">' + esc(l.s || "") + '</span>' +
    '<a class="hw-t" href="' + esc(l.u) + '" target="_blank" rel="noopener">' + esc(l.t) + "</a>" +
    (l.lens ? '<span class="hw-lens">' + (l.lens === 3 ? "①②" : l.lens === 1 ? "①" : "②") + "</span>" : "") +
    (l.n ? '<span class="hw-n">' + esc(l.n) + "</span>" : "") + "</div>").join("");
  for (const [cat, ico] of HW_CATS) {
    const ls = by.get(cat);
    if (ls && ls.length) { html += catHtml(cat, ico, ls); by.delete(cat); }
  }
  for (const [cat, ls] of by) if (ls.length) html += catHtml(cat, "📎", ls);   /* 未知分组兜底，不丢链接 */
  const pr = (HW.prices || []).slice(0, 12);
  if (pr.length) html += '<div class="hw-cat">💹 保值样本</div><div class="hw-prices">' +
    pr.map(x => '<span class="hw-pill">' + esc(x.m + " · " + x.p + (x.src ? " · " + x.src : "")) + "</span>").join("") + "</div>";
  const hs = Object.entries(HW.sources || {});
  if (hs.length) html += '<div class="hw-health">数据源 · ' + hs.map(([k, v]) => {
    const cls = String(v).includes("原生") ? "hw-h-ok" : (String(v).includes("降") ? "hw-h-warn" : "hw-h-miss");
    return '<b class="' + cls + '">' + esc(k) + "</b> " + esc(v);
  }).join(" · ") + "</div>";
  body.innerHTML = html;
}

/* ================= 小红书粉丝监控（Mac 推送：小红书只认真浏览器上下文，launchd 每 2h 登录态 Chrome 抓了推上来） ================= */
let XHS = null;
const xhsFmt = n => n == null ? "—" : n.toLocaleString("zh-Hans");
function renderXhs() {
  const body = $("#xhsBody");
  if (!body) return;
  if (!XHS) { $("#xhsUpd").textContent = ""; body.innerHTML = '<span class="dim">等待首轮抓取…</span>'; return; }
  $("#xhsUpd").textContent = XHS.at ? hm(XHS.at) + " 更新" : "";
  if (XHS.fans == null && !XHS.days.length) {
    body.innerHTML = '<div class="xhs-err">等待 Mac 收集任务首次推送 —— 每 2 小时用登录态浏览器读一次粉丝数自动推上来（小红书反爬只认真浏览器，服务器/裸抓一律被拦）。</div>';
    return;
  }
  const fans = XHS.fans;
  const handle = XHS.redId || XHS.account;   /* 展示用小红书号；redId 缺省回落主页 ID */
  let html = '<div class="xhs-num">' + xhsFmt(fans) + "<small>粉丝</small></div>" +
    '<div class="xhs-name"><b>' + esc(XHS.nickname || XHS.account) + "</b> · @" + esc(handle) + " · <a href=\"https://www.xiaohongshu.com/user/profile/" + esc(XHS.account) + "\" target=\"_blank\" rel=\"noopener\">主页 ↗</a></div>";
  const chips = [];
  if (typeof XHS.delta1 === "number") chips.push('<span class="xhs-delta ' + (XHS.delta1 > 0 ? "up" : XHS.delta1 < 0 ? "down" : "") + '">今日 ' + (XHS.delta1 > 0 ? "+" : "") + XHS.delta1 + "</span>");
  if (typeof XHS.delta7 === "number") chips.push('<span class="xhs-delta ' + (XHS.delta7 > 0 ? "up" : XHS.delta7 < 0 ? "down" : "") + '">7 天 ' + (XHS.delta7 > 0 ? "+" : "") + XHS.delta7 + "</span>");
  if (XHS.days && XHS.days.length) chips.push('<span class="xhs-delta">记录 ' + XHS.days.length + " 天</span>");
  if (chips.length) html += '<div class="xhs-deltas">' + chips.join("") + "</div>";
  /* 近 30 天折线（无涨跌也画基线；两点起画） */
  const days = (XHS.days || []).slice(-30);
  if (days.length >= 2) {
    const vals = days.map(d => d.fans);
    const lo = Math.min(...vals), hi = Math.max(...vals), span = Math.max(1, hi - lo);
    const W = 300, H = 52, PAD = 4;
    const pts = vals.map((v, i) =>
      (PAD + i * (W - 2 * PAD) / (vals.length - 1)).toFixed(1) + "," + (H - PAD - (v - lo) * (H - 2 * PAD) / span).toFixed(1)).join(" ");
    html += '<svg class="xhs-spark" viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" aria-hidden="true">' +
      '<polyline points="' + pts + '" fill="none" stroke="var(--c,#ff2442)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
      '<title>' + esc(days[0].date + " " + lo + " → " + days[days.length - 1].date + " " + hi) + "</title></svg>";
  }
  if (!XHS.ok && XHS.error) html += '<div class="xhs-err"><b>最近一次异常</b>：' + esc(XHS.error) + "（展示上次读数）</div>";
  body.innerHTML = html;
}

/* ================= 硬件图鉴弹窗（每日情报自动沉淀的累积目录，筛选全在客户端） ================= */
let ATLAS = { devices: [], filter: "all", cat: "", q: "", view: "body", wear: null, device: null };
let atlasModel = null, atlasAbort = null, atlasLoadId = 0;
const HW_WEARS_UI = ["头部", "眼部", "耳部", "颈部", "胸口", "上臂", "手腕", "手指", "腰部", "腿脚", "环境家居", "宠物", "其他"];
async function atlasOpen() {
  atlasStopModel();
  const loadId = ++atlasLoadId;
  $("#atlMask").classList.add("on");
  $("#atlBody").innerHTML = '<div class="atl-empty">加载中…</div>';
  try {
    const d = await api("GET", "/api/workbench/hw/devices");
    if (loadId !== atlasLoadId || !$("#atlMask").classList.contains("on")) return;
    ATLAS.devices = d.devices || [];
  } catch (e) { ATLAS.devices = []; }
  const cats = [...new Set(ATLAS.devices.map(x => x.cat))].sort();
  $("#atlCat").innerHTML = '<option value="">全部品类</option>' + cats.map(c => '<option value="' + esc(c) + '">' + esc(c) + "</option>").join("");
  $("#atlCat").value = ATLAS.cat;
  atlasRender();
}
function atlasStopModel() {
  atlasAbort?.abort(); atlasAbort = null;
  atlasModel?.destroy(); atlasModel = null;
}
function atlasClose() { atlasLoadId++; atlasStopModel(); $("#atlMask").classList.remove("on"); }
function atlasSelectWear(wear, device = null) {
  ATLAS.wear = wear; ATLAS.device = device;
  atlasRender();
}
async function atlasMountModel(counts) {
  const host = $("#atlModelHost");
  if (!host || atlasAbort) return;
  const controller = new AbortController(); atlasAbort = controller;
  try {
    const { createBodyAtlas } = await import("./hardware-body.js?v=233ddd7a-2");
    if (controller.signal.aborted || !host.isConnected) return;
    const model = await createBodyAtlas(host, {
      counts, selected: ATLAS.wear, signal: controller.signal,
      onSelect: wear => atlasSelectWear(wear),
      onError: error => console.warn("硬件人体显示：", error.message),
    });
    if (controller.signal.aborted || !host.isConnected) { model.destroy(); return; }
    atlasModel = model;
    atlasUpdateBody();
  } catch (error) {
    if (controller.signal.aborted) return;
    host.innerHTML = '<div class="atl-empty">三维人体暂不可用，请用部位按钮或切换表格继续浏览。</div>';
    console.warn("硬件人体加载：", error.message);
  }
}
function atlasFiltered() {
  const q = ATLAS.q.trim().toLowerCase();
  return ATLAS.devices.filter(d => {
    if (ATLAS.filter === "1" && !(d.lens === 1 || d.lens === 3)) return false;
    if (ATLAS.filter === "2" && !(d.lens === 2 || d.lens === 3)) return false;
    if (ATLAS.cat && d.cat !== ATLAS.cat) return false;
    if (q && !((d.name + " " + (d.brand || "") + " " + (d.collects || "") + " " + (d.shows || "")).toLowerCase().includes(q))) return false;
    return true;
  });
}
/* 部位沿用 HW_WEARS，三维人体只负责佩戴位置与设备的空间关联 */
const HW_BODY_WEARS = HW_WEARS_UI.slice(0, 10);
function atlasBodyCounts(rows) {
  const counts = {};
  for (const d of rows) { const wear = d.wear || "其他"; counts[wear] = (counts[wear] || 0) + 1; }
  return counts;
}
function atlasBodyChips(counts) {
  const chip = (wear, text, count) => '<button type="button" class="atl-chip' + (ATLAS.wear === wear ? " on" : "") +
    '" data-wearchip="' + esc(wear || "__all") + '" aria-pressed="' + (ATLAS.wear === wear) + '">' + esc(text) + " " + count + "</button>";
  return chip(null, "全部", Object.values(counts).reduce((a, b) => a + b, 0)) +
    ["环境家居", "宠物", "其他"].map(wear => chip(wear, wear, counts[wear] || 0)).join("");
}
function atlasUpdateBody() {
  const rows = atlasFiltered(), counts = atlasBodyCounts(rows);
  const shown = ATLAS.wear ? rows.filter(d => (d.wear || "其他") === ATLAS.wear) : rows;
  if (ATLAS.device && !shown.some(d => d.name === ATLAS.device)) ATLAS.device = null;
  const chips = $("#atlBodyChips"), list = $("#atlDeviceRows"), title = $("#atlDeviceTitle");
  if (!chips || !list || !title) return;
  chips.innerHTML = atlasBodyChips(counts);
  title.innerHTML = '<b>' + esc(ATLAS.wear || "全部设备") + '</b><span>' + shown.length + " 件 · 点击设备定位</span>";
  list.innerHTML = shown.length ? atlasRows(shown) : '<div class="atl-empty">' + (ATLAS.wear ? "这个部位暂无符合筛选的设备" : "暂无符合筛选的设备") + "</div>";
  atlasModel?.update({ counts, selected: ATLAS.wear, deviceName: ATLAS.device });
  document.querySelectorAll(".atl-body-fallback [data-wearchip]").forEach(button => {
    button.classList.toggle("on", ATLAS.wear === button.dataset.wearchip);
  });
}
const lensTagS = l => l === 3 ? "①②" : l === 1 ? "①" : l === 2 ? "②" : "";
function atlasRows(list) {
  return list.map(d => {
    const ps = d.prices || [], last = ps[ps.length - 1], wear = d.wear || "其他";
    const cs = [d.collects, d.shows].filter(Boolean).join(" / ");
    const url = /^https?:\/\//i.test(d.url || "") ? d.url : "";
    return '<div class="atl-row' + (ATLAS.device === d.name ? " selected" : "") + '">' +
      '<div class="atl-device-top"><button type="button" class="atl-device-select" data-device="' + esc(d.name) +
      '" data-devicewear="' + esc(wear) + '" aria-label="定位 ' + esc(d.name) + ' 的' + esc(wear) + '位置">' + esc(d.name) + "</button>" +
      (d.lens ? '<span class="hw-lens">' + lensTagS(d.lens) + "</span>" : "") + "</div>" +
      '<div class="atl-device-copy"><span class="atl-device-where">' + esc(wear) + "</span>" + esc(cs || "设备资料持续更新") + "</div>" +
      '<div class="atl-device-meta"><span>' + esc(d.status || "") + (last ? " · " + esc(last.p) : "") + "</span>" +
      '<span>热度 ' + Number(d.heat || 1) + " · " + esc(d.firstSeen || "") + "</span>" +
      (url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">查看来源 ↗</a>' : "") + "</div></div>";
  }).join("");
}
function atlasRender() {
  const dev = ATLAS.devices;
  const l1 = dev.filter(d => d.lens === 1 || d.lens === 3).length;
  const l2 = dev.filter(d => d.lens === 2 || d.lens === 3).length;
  const mz = dev.filter(d => String(d.firstSeen || "").startsWith(new Date().toISOString().slice(0, 7))).length;
  $("#atlStats").textContent = "共 " + dev.length + " 件 · 透镜① " + l1 + " · 透镜② " + l2 + " · 本月新增 " + mz;
  $("#atlViewBody").classList.toggle("on", ATLAS.view === "body");
  $("#atlViewTable").classList.toggle("on", ATLAS.view === "table");
  const rows = atlasFiltered();
  const body = $("#atlBody");
  if (ATLAS.view === "table") {
    atlasStopModel();
    const tag = l => l === 3 ? "①②" : l === 1 ? "①" : l === 2 ? "②" : "";
    body.innerHTML = rows.length
      ? '<table class="atl-table"><thead><tr><th>设备</th><th>部位</th><th>品类</th><th>透镜</th><th>采集 / 展现</th><th>状态</th><th>最新价</th><th>首现</th><th>热度</th></tr></thead><tbody>' +
        rows.map(d => {
          const ps = d.prices || [];
          const last = ps[ps.length - 1];
          const cs = [d.collects, d.shows].filter(Boolean).join(" / ");
          return "<tr>" +
            "<td>" + (d.url ? '<a href="' + esc(d.url) + '" target="_blank" rel="noopener">' + esc(d.name) + "</a>" : esc(d.name)) + "</td>" +
            "<td>" + esc(d.wear || "其他") + "</td><td>" + esc(d.cat) + "</td><td>" + tag(d.lens) + "</td>" +
            "<td>" + esc(cs || "—") + "</td><td>" + esc(d.status || "") + "</td>" +
            "<td" + (ps.length ? ' title="' + esc(ps.map(p => p.d + " " + p.p).join("\n")) + '"' : "") + ">" + esc(last ? last.p : "") + "</td>" +
            "<td>" + esc(d.firstSeen || "") + "</td><td>" + (d.heat || 1) + "</td></tr>";
        }).join("") + "</tbody></table>"
      : '<div class="atl-empty">图鉴还是空的 —— Mac 收集任务每日推送后自动累积<br>透镜① = 让以往无法展现的数据可见 · 透镜② = 让以往无法收集的数据可持续收集</div>';
    return;
  }
  /* 保持画布实例，搜索和部位切换只更新计数、列表与高亮 */
  const counts = atlasBodyCounts(rows);
  if (!$("#atlModelHost")) {
    body.innerHTML = '<div class="atl-mapwrap"><div class="atl-map">' +
      '<div class="atl-mapwrap-map" id="atlModelHost"><div class="atl-empty">正在准备三维人体…</div></div>' +
      '<div class="atl-mapchips" id="atlBodyChips"></div>' +
      '<details class="atl-body-fallback"><summary>按部位选择</summary><div class="atl-mapchips">' +
      HW_BODY_WEARS.map(wear => '<button type="button" class="atl-chip" data-wearchip="' + esc(wear) + '">' + esc(wear) + "</button>").join("") + "</div></details></div>" +
      '<div class="atl-list"><div class="atl-list-head" id="atlDeviceTitle"></div><div class="atl-list-rows" id="atlDeviceRows"></div></div></div>';
  }
  atlasUpdateBody();
  atlasMountModel(counts);
}
$("#hwAtlasBtn").addEventListener("click", atlasOpen);
$("#atlClose").addEventListener("click", atlasClose);
$("#atlMask").addEventListener("click", e => { if (e.target.id === "atlMask") atlasClose(); });
$("#atlViewBody").addEventListener("click", () => { ATLAS.view = "body"; atlasRender(); });
$("#atlViewTable").addEventListener("click", () => { ATLAS.view = "table"; atlasRender(); });
$("#atlBody").addEventListener("click", e => {
  const device = e.target.closest("[data-devicewear]");
  if (device) { atlasSelectWear(device.dataset.devicewear, device.dataset.device); return; }
  const chip = e.target.closest("[data-wearchip]");
  if (chip) atlasSelectWear(chip.dataset.wearchip === "__all" ? null : chip.dataset.wearchip);
});
document.querySelectorAll(".atl-chip[data-lf]").forEach(c => c.addEventListener("click", () => {
  document.querySelectorAll(".atl-chip[data-lf]").forEach(x => x.classList.remove("on"));
  c.classList.add("on");
  ATLAS.filter = c.dataset.lf;
  atlasRender();
}));
$("#atlCat").addEventListener("change", e => { ATLAS.cat = e.target.value; atlasRender(); });
let atlasQTimer = null;
$("#atlQ").addEventListener("input", e => {
  clearTimeout(atlasQTimer);
  atlasQTimer = setTimeout(() => { ATLAS.q = e.target.value; atlasRender(); }, 250);
});

function renderBanner() {
  $("#cfgBanner").classList.toggle("on", !(CFG && CFG.hasKey));
}
function renderAll() {
  renderGLM(); renderOil(); renderBili(); renderAnth(); renderArxiv(); renderHw(); renderXhs(); renderGithub(); renderKbInbox();
  renderLog(); renderWeekly(); renderPanelHint();
  renderCalendar(); renderMemos();
}
async function loadAll() {
  const [d, log, cmt, wk, memo] = await Promise.all([
    api("GET", "/api/workbench/data"),
    api("GET", "/api/workbench/log"),
    api("GET", "/api/workbench/comments"),
    api("GET", "/api/workbench/weekly"),
    api("GET", "/api/workbench/memos"),
  ]);
  for (const result of [d, log, cmt, wk, memo]) {
    if (!result || result.ok === false) {
      const error = new Error(result && result.error || "工作台数据载入失败，请重试。");
      error.status = result && result.status || 0;
      throw error;
    }
  }
  if (!d.cfg || !d.data) throw new Error("工作台数据格式无效，请重试。");
  CFG = d.cfg; WB = d.data; SCHED = d.sched; DIS = d.dislikes || {};
  INBOX = d.kbInbox || [];
  HW = d.hw || null;
  XHS = d.xhs || null;
  const btn = $("#hwAtlasBtn");
  if (btn) btn.textContent = "📔 图鉴" + (d.hwDevices ? " · " + d.hwDevices + " 件" : "");
  LOG = log.items || [];
  CMT = {};
  (cmt.items || []).forEach(c => { CMT[c.url] = c; });
  MEMOS = memo.items || [];
  WEEKLY = wk;
  if (wk.current && wk.current.start) {
    $("#wkStart").value = wk.current.start;
    $("#wkEnd").value = wk.current.end;
  }
  $("#cfgUps").value = JSON.stringify(CFG.ups || [], null, 1);
  if (CFG.profile) $("#cfgProfile").value = CFG.profile;
}
(async function boot() {
  if (location.protocol === "file:") {
    document.querySelector(".wrap").innerHTML = '<p style="padding:40px 0;color:var(--g-dim)">工作台需要服务模式（node server.js 后访问）。</p>';
    return;
  }
  let me;
  try {
    me = await fetch("/api/me", typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(8000) } : {})
      .then(r => r.json());
  } catch (_) {
    /* /api/me 挂起或失败不再无声停留（此前会永远卡在加载页）：明确报错并给重试入口。 */
    if (AI_WORKBENCH) window.dispatchEvent(new CustomEvent("workbench:boot-fail", { detail: { message: "连接服务器超时或失败，请检查网络后重试。" } }));
    else document.querySelector(".wrap").innerHTML = '<p style="padding:40px 0;color:var(--g-dim)">连接服务器失败，请检查网络后刷新重试。</p>';
    return;
  }
  if (!me.authenticated || me.mustChangePassword) { location.href = (AI_WORKBENCH ? "/login.html?next=%2Fai-workbench.html" : "/login.html?next=%2Fworkbench.html"); return; }
  if (me.role !== "admin") {
    if (AI_WORKBENCH) window.dispatchEvent(new CustomEvent("workbench:denied", { detail:"请使用管理员账号登录。" }));
    else document.querySelector(".wrap").innerHTML = '<p style="padding:40px 0;color:var(--g-dim)">El Estudio · 工作台仅管理员可用。</p>';
    return;
  }
  $("#whoami").classList.add("on");
  $("#whoName").textContent = me.username;
  $("#logoutBtn").addEventListener("click", async e => {
    e.preventDefault();
    try { await fetch("/api/logout", { method: "POST" }); } catch (_) {}
    location.href = "/index.html";
  });
  /* 视觉学习层为本地实验：线上未部署时状态接口 404，隐藏「比较学习」等入口。 */
  fetch("/api/learning/status", { headers: { accept: "application/json" } })
    .then(r => { if (r.status === 404) document.querySelectorAll('a[href^="/learning.html"]').forEach(el => { el.hidden = true; }); })
    .catch(() => {});
  async function initialize() {
    try {
      await loadAll();
      const errorPanel = document.getElementById("workbenchLoadError");
      if (errorPanel) errorPanel.remove();
      renderBanner(); renderAll();
      /* Agenda 日历：绑定回跳提示 + 首拉。 */
      const dtQ = new URLSearchParams(location.search).get("dt");
      if (dtQ) {
        history.replaceState(null, "", location.pathname);
        toast(dtQ === "ok" ? "Agenda 已绑定 ✓ 日程拉取中…" : dtQ);
      }
      dtLoad();
      if (dtQ === "ok") setTimeout(dtLoad, 4500);
      window.dispatchEvent(new CustomEvent("workbench:ready"));
    } catch (error) {
      const detail = { message: error.message || "工作台数据载入失败，请重试。", status: error.status || 0 };
      if (AI_WORKBENCH) window.dispatchEvent(new CustomEvent("workbench:load-error", { detail }));
      else {
        let panel = document.getElementById("workbenchLoadError");
        if (!panel) { panel = document.createElement("div"); panel.id = "workbenchLoadError"; panel.className = "banner on"; document.getElementById("main").after(panel); }
        panel.replaceChildren();
        const message = document.createElement("span"), retry = document.createElement("button");
        message.textContent = detail.message + " "; retry.textContent = "重新载入"; retry.className = "btn btn-ghost";
        retry.addEventListener("click", () => { retry.disabled = true; initialize(); });
        panel.append(message, retry);
      }
    }
  }
  if (AI_WORKBENCH) window.addEventListener("workbench:retry", initialize);
  /* AI 工作台的日程草稿确认写入后，同步刷新备忘与日历 */
  window.addEventListener("workbench:memos-sync", async () => {
    const d = await api("GET", "/api/workbench/memos");
    if (d && Array.isArray(d.items)) { MEMOS = d.items; renderAll(); }
  });
  await initialize();
})();


}

(function(){
  if (!document.documentElement.hasAttribute('data-ai-workbench')) { runWorkbench(); return; }
  fetch('workbench-template.html', { credentials:'same-origin' }).then(function(response){
    if(!response.ok)throw new Error('工作台组件载入失败');return response.text();
  }).then(function(text){
    var parsed=new DOMParser().parseFromString(text,'text/html');
    var host=document.getElementById('aiLegacy');
    Array.from(parsed.body.children).forEach(function(node){ host.append(document.importNode(node,true)); });
    var oldNav=host.querySelector('nav');if(oldNav)oldNav.remove();
    runWorkbench();
  }).catch(function(){window.dispatchEvent(new CustomEvent('workbench:denied',{detail:'工作台组件载入失败，请刷新重试。'}));});
})();
