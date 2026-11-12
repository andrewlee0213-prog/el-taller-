/* 油价专项回归：固定北京时间、模拟网页，直接执行 server.js 的油价段，不启动服务/不访问外网。
   用法：node tools/test-oil.mjs [--source /绝对路径/文章.html] */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const server = fs.readFileSync(path.join(ROOT, "server.js"), "utf8");
const between = (text, start, end) => {
  const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
  assert(a >= 0 && b > a, "测试锚点仍在实际源码中");
  return text.slice(a, b);
};
const NOW = Date.parse("2026-10-30T14:02:00+08:00");
let clock = NOW, pages = new Map(), requests = [], writes = [];
class Clock extends Date { static now() { return clock; } }
const ctx = vm.createContext({
  Date: Clock, console,
  httpGetText: async url => {
    requests.push(url);
    if (!pages.has(url)) throw new Error("模拟源不可用");
    return pages.get(url);
  },
  loadJson: () => ({}), saveJson: (...args) => writes.push(args), WB_FILE: { cache: "fixture" },
  dtCfgOk: () => false, DT: { token: null },
});
vm.runInContext([
  between(server, "/* 返回捕获组数组", "async function httpGetText("),
  between(server, "/* ---------------- 抓取器 · 上海油价", "/* ---------------- 抓取器 · B站关注"),
  between(server, "const bjWall =", "function wbFail("),
  "globalThis.oilTest = { oilDateISO, oilAdjISO, oilWindow, oilForecastText, oilCalendar, oilArticleUrls, oilParseArticle, oilSnapshot, wbFetchOil, wbNextRun, wbInitSchedule, bjNextDailyAt, getCache: () => wbCache, setCache: c => { wbCache = c; }, getSched: () => wbSched };",
].join("\n"), ctx);
const t = ctx.oilTest;
let passed = 0;
async function check(name, fn) {
  await fn(); passed++; console.log("  PASS  " + name);
}
const src = "https://energy.cngold.org/c/2026-10-29/c10846889.html";
const freshSrc = "https://energy.cngold.org/c/2026-10-30/c10848199.html";
const nextAt = Date.parse("2026-11-13T00:00:00+08:00");
const calendar = `<table><tr><td colspan="2"><strong>2026年国内<a>油价调整时间表</a></strong></td></tr>
<tr><td>2026年10月油价调价日期</td><td>10月15日、10月29日</td></tr>
<tr><td>2026年11月油价调价日期</td><td>11月12日、11月26日</td></tr></table>`;
const oldText = "今日油价预计汽油上调345元/吨，折合油价上涨0.33元-0.40元/升，国内新一轮成品油调价窗口将于今晚24时进行。";
const newText = "国内新一轮成品油调价窗口将于11月12日24时进行，本轮油价预计下调50元/吨，折合油价下跌0.03元-0.04元/升。";
const article = (desc, body = "", cal = calendar) => `<meta name="description" content="${desc}"><div class="article_con" id="zoom"><p>${body || desc}</p>${cal}</div>`;
const oldArticle = article(oldText);
const newArticle = article(newText);
const pricePage = `<table id="hq_table1"><tr><th>89#汽油</th><th>92#汽油</th><th>95#汽油</th><th>0#柴油</th></tr><tr><td>--</td><td>8.85</td><td>9.41</td><td>8.57</td></tr></table>
<table><tr><td class="data">2026-10-30</td><td class="nums">8.00</td><td class="nums">8.85</td><td class="nums">9.41</td><td class="nums">8.57</td></tr>
<tr><td class="data">2026-10-16</td><td class="nums">7.80</td><td class="nums">8.60</td><td class="nums">9.12</td><td class="nums">8.30</td></tr></table>`;
const link = (url, title = "油价调整最新消息") => `<a title="${title}" href="${url}">${title}</a>`;
const fixture = () => ({ ok: true, forecastVersion: 2, at: NOW, price: "9.41", note: "10-30起 · 上期9.12(+0.29)", hist: [],
  adj: "2026-11-12", adjustAt: nextAt, cycleSource: freshSrc, calendar: [{ adj: "2026-11-12", sourceUrl: src }],
  forecast: { adj: "2026-11-12", text: "预计跌0.03~0.04元/升", sourceUrl: freshSrc, publishedAt: NOW - 3600e3 } });
const reset = cache => {
  clock = NOW; requests = []; writes = []; t.setCache(cache || {});
  pages = new Map([
    ["https://www.cngold.org/crude/shanghai.html", pricePage],
    ["https://energy.cngold.org/", link(src)], [src, oldArticle],
    ["https://energy.cngold.org/yjcx/", "<p>暂无新周期预测</p>"],
  ]);
};

await check("已过 10/29 不被挪到 2027 年", () => {
  assert.equal(t.oilAdjISO(10, 29, 0, NOW), "2026-10-29");
  assert.equal(t.oilWindow("2026-10-29", NOW), null);
  assert.equal(t.oilWindow("2027-10-29", NOW), null);
});
await check("北京时间 24时边界严格失效", () => {
  const boundary = Date.parse("2026-10-30T00:00:00+08:00");
  assert.equal(t.oilWindow("2026-10-29", boundary - 1).adjustAt, boundary);
  assert.equal(t.oilWindow("2026-10-29", boundary), null);
});
await check("跨年仅年末→年初，真实公历日期校验", () => {
  const dec = Date.parse("2026-12-28T10:00:00+08:00");
  assert.equal(t.oilAdjISO(1, 7, 0, dec), "2027-01-07");
  assert(t.oilWindow("2027-01-07", dec));
  assert.equal(t.oilDateISO(2026, 2, 30), "");
  assert.equal(t.oilDateISO(2028, 2, 29), "2028-02-29");
  assert.equal(t.oilDateISO(2026, 13, 1), "");
});
await check("宿主 UTC/美洲/上海时区结果相同", () => {
  const oldTZ = process.env.TZ;
  try {
    for (const tz of ["UTC", "America/Los_Angeles", "Asia/Shanghai"]) {
      process.env.TZ = tz;
      assert.equal(t.oilAdjISO(10, 29, 0, NOW), "2026-10-29");
      assert.equal(t.oilWindow("2026-11-12", NOW).adjustAt, nextAt);
    }
  } finally { if (oldTZ === undefined) delete process.env.TZ; else process.env.TZ = oldTZ; }
});
await check("旧文年表找到 11/12，丢弃 10/29 涨幅", () => {
  const p = t.oilParseArticle(oldArticle, src, NOW);
  assert.equal(p.forecast, null);
  assert.equal(p.calendar[0].adj, "2026-11-12");
  assert.equal(p.calendar[1].adj, "2026-11-26");
});
await check("相对今晚按文章日期而非抓取日期解析", () => {
  const before = Date.parse("2026-10-29T23:00:00+08:00");
  const p = t.oilParseArticle(oldArticle, src, before);
  assert.equal(p.forecast.adj, "2026-10-29");
  assert.equal(p.forecast.text, "预计涨0.33~0.40元/升");
  assert.equal(t.oilParseArticle(oldArticle, src, NOW).forecast, null);
});
await check("新周期文章日期和幅度同段绑定", () => {
  const p = t.oilParseArticle(newArticle, freshSrc, NOW);
  assert.equal(p.forecast.adj, "2026-11-12");
  assert.equal(p.forecast.text, "预计跌0.03~0.04元/升");
  assert.equal(p.forecast.sourceUrl, freshSrc);
});
await check("旧元描述不阻断正文新周期，但不能借旧幅度", () => {
  const p = t.oilParseArticle(article(oldText.replace("今晚", "10月29日"), "国内新一轮成品油调价窗口将于11月12日24时进行。"), freshSrc, NOW);
  assert.equal(p.cycle.adj, "2026-11-12");
  assert.equal(p.forecast, null);
});
await check("同段提到上轮涨幅和下轮日期时不拼接", () => {
  const mixed = "上一轮10月29日油价上涨0.33元-0.40元/升，国内新一轮调价窗口将于11月12日24时进行，预计汽油下调50元/吨。";
  const p = t.oilParseArticle(article(mixed), freshSrc, NOW);
  assert.equal(p.cycle.adj, "2026-11-12"); assert.equal(p.forecast, null);
});
await check("忽略历史表和相关推荐的预测", () => {
  const h = article("新闻正文", "<table><tr><td>" + newText + "</td></tr></table>");
  assert.equal(t.oilParseArticle(h, freshSrc, NOW).forecast, null);
});
await check("元/吨换算标约，不伪装精确升价", () => {
  assert.equal(t.oilForecastText("本轮油价预计上调135元/吨"), "预计涨约0.1元/升");
  assert.equal(t.oilForecastText("本轮油价预计搁浅"), "预计搁浅");
  assert.equal(t.oilForecastText("本轮油价预计下调"), "");
  assert.equal(t.oilForecastText("本轮预计上涨0.4元-0.3元/升"), "");
});
await check("候选去重、新文优先，拒绝外部/非文章 URL", () => {
  const urls = t.oilArticleUrls(link(src) + link(freshSrc) + link(src) + link("https://evil.test/") + link("https://energy.cngold.org/nybk/schedule.html"));
  assert.equal(urls.length, 2); assert.equal(urls[0], freshSrc);
});
await check("未来文章/陈旧文章不可作当前预测", () => {
  assert.equal(t.oilParseArticle(newArticle, "https://energy.cngold.org/c/2026-11-01/c100.html", NOW).forecast, null);
  assert.equal(t.oilParseArticle(newArticle, "https://energy.cngold.org/c/2025-10-30/c100.html", NOW).calendar.length, 0);
});
await check("旧缓存迁移保留现价历史，不保留错误年份", () => {
  const old = { price: "9.41", hist: [{ date: "2026-10-30", price: "9.41" }], next: "下次调价 10月29日24时 · 预计涨0.33~0.40元/升", adj: "2027-10-29", expired: false };
  const safe = t.oilSnapshot(old, NOW);
  assert.equal(safe.price, "9.41"); assert.equal(safe.hist.length, 1);
  assert.equal(safe.adj, ""); assert.equal(safe.forecast, null);
  assert.equal(safe.next, "下一轮调价预测待更新");
});
await check("响应时重验周期，不会下发上轮涨幅", () => {
  const d = fixture(); d.forecast.adj = "2026-10-29";
  const safe = t.oilSnapshot(d, NOW);
  assert.equal(safe.next, "下次调价 11月12日24时 · 本轮预测待更新");
});
await check("跨时刻按年表切下一窗口，数值不沿用", () => {
  const d = fixture(); d.calendar.push({ adj: "2026-11-26", sourceUrl: src });
  const safe = t.oilSnapshot(d, nextAt);
  assert.equal(safe.adj, "2026-11-26"); assert.equal(safe.forecast, null);
  assert.equal(safe.next, "下次调价 11月26日24时 · 本轮预测待更新");
});
await check("抓取：首页仍是旧文时，现价和下一窗口正确", async () => {
  reset(); const d = await t.wbFetchOil();
  assert.equal(d.price, "9.41"); assert(d.note.includes("10-30起 · 上期9.12(+0.29)"));
  assert.equal(d.adj, "2026-11-12"); assert.equal(d.forecast, null);
  assert.equal(d.next, "下次调价 11月12日24时 · 本轮预测待更新");
  assert.equal(d.prices.find(p => p.g === "92#").v, "8.85");
});
await check("抓取：旧文置顶仍选择最新同周期预测", async () => {
  reset(); pages.set("https://energy.cngold.org/", link(src) + link(freshSrc)); pages.set(freshSrc, newArticle);
  const d = await t.wbFetchOil();
  assert.equal(d.forecast.text, "预计跌0.03~0.04元/升");
  assert(!d.next.includes("0.33"));
});
await check("抓取：首页未上新时检查预测列表", async () => {
  reset(); pages.set("https://energy.cngold.org/yjcx/", link(freshSrc)); pages.set(freshSrc, newArticle);
  const d = await t.wbFetchOil();
  assert.equal(d.forecast.sourceUrl, freshSrc);
});
await check("抓取：主页方向不混进另一文章的窗口", async () => {
  reset(); pages.set("https://energy.cngold.org/", "今日(10月30日)油价预计上调500元/吨" + link(freshSrc));
  pages.set(freshSrc, article("国内新一轮成品油调价窗口将于11月12日24时进行。"));
  const d = await t.wbFetchOil(); assert.equal(d.forecast, null); assert(!d.next.includes("预计涨"));
});
await check("预测源故障仅保留同周期有效缓存", async () => {
  reset({ oil: fixture() }); pages.delete("https://energy.cngold.org/");
  const d = await t.wbFetchOil(); assert.equal(d.forecast.text, "预计跌0.03~0.04元/升");
  clock = nextAt; const expired = await t.wbFetchOil();
  assert.equal(expired.price, "9.41"); assert.equal(expired.forecast, null); assert(!expired.next.includes("0.03"));
});
await check("重读原文章已无有效预测时不复活旧缓存", async () => {
  reset({ oil: fixture() }); pages.set("https://energy.cngold.org/", link(freshSrc));
  pages.set(freshSrc, article("国内新一轮成品油调价窗口将于11月12日24时进行。"));
  const d = await t.wbFetchOil(); assert.equal(d.forecast, null);
});
await check("有效预测每天北京05点更新，无预测最多2小时重试", () => {
  reset({ oil: fixture() }); const at = NOW - 30e3;
  assert.equal(t.wbNextRun("oil", at), t.bjNextDailyAt(5, 0, at));
  t.setCache({ oil: { ...fixture(), forecast: null } });
  assert.equal(t.wbNextRun("oil", at), at + 2 * 3600e3);
});
await check("旧缓存启动尽快重抓，不睡到明年", () => {
  reset({ oil: { price: "9.41", at: NOW, adj: "2027-10-29", next: "旧预测", expired: false } });
  t.wbInitSchedule();
  assert.equal(t.getSched().oil.nextAt, NOW + 8e3);
  assert.equal(t.getCache().oil.price, "9.41"); assert.equal(t.getCache().oil.adj, "");
});

await check("调价边界唤醒，不等到次日05点", () => {
  reset({ oil: fixture() }); clock = nextAt - 3600e3;
  assert.equal(t.wbNextRun("oil", clock), nextAt);
});

const front = fs.readFileSync(path.join(ROOT, "workbench-runtime.js"), "utf8");
let pendingTimer = null, getCalls = 0, rendered = "", visibilityHandler;
const ui = vm.createContext({
  Date: Clock, console, WB: { oil: fixture() },
  setTimeout: (fn, ms) => { pendingTimer = { fn, ms }; return 1; },
  clearTimeout: () => { pendingTimer = null; },
  document: { visibilityState: "hidden", addEventListener: (name, fn) => { if (name === "visibilitychange") visibilityHandler = fn; } },
  api: async (method, url) => { assert.equal(method, "GET"); assert.equal(url, "/api/workbench/data"); getCalls++; return { data: { oil: fixture() } }; },
});
vm.runInContext(between(front, "function oilSourceUrlValid(", "function renderOil()") + `
function renderOil() { globalThis.rendered = oilNextHtml(WB.oil); armOilBoundary(WB.oil); }
globalThis.uiTest = { oilNextHtml, oilCycleAt, armOilBoundary, loadOilData };`, ui);
const f = ui.uiTest;
await check("前端：有效新版预测显示同周期数值", () => {
  clock = NOW;
  assert.equal(f.oilNextHtml(fixture(), NOW), '<span class="okline">下次调价 11月12日24时 · 预计跌0.03~0.04元/升</span>');
});
await check("前端：未知幅度不冒绿、旧 next 无论内容都不用", () => {
  const d = fixture(); d.forecast = null; d.next = "下次调价 10月29日24时 · 预计涨0.33~0.40元/升";
  assert.equal(f.oilNextHtml(d, NOW), '<span class="dim">下次调价 11月12日24时 · 本轮预测待更新</span>');
  delete d.forecastVersion;
  assert.equal(f.oilNextHtml(d, NOW), '<span class="dim">下一轮调价预测待更新</span>');
});
await check("前端：跨周期/来源异常/脚本注入/错误时间均降级", () => {
  for (const mutation of [
    d => { d.forecast.adj = "2026-10-29"; },
    d => { d.forecast.sourceUrl = "https://evil.test/"; },
    d => { d.forecast.text = '<img src=x onerror="alert(1)">'; },
    d => { d.forecast.publishedAt = NOW + 1; },
    d => { d.adjustAt++; },
    d => { d.forecastVersion = 3; },
    d => { d.adj = "2026-11-31"; },
  ]) {
    const d = fixture(); mutation(d);
    const html = f.oilNextHtml(d, NOW); assert(!html.includes('class="okline"')); assert(!html.includes("<img"));
  }
});
await check("前端：搁浅和约数文案有效", () => {
  for (const text of ["预计搁浅", "预计涨约0.1元/升"]) {
    const d = fixture(); d.forecast.text = text;
    assert(f.oilNextHtml(d, NOW).includes('class="okline"'));
  }
});
await check("前端：未来长计时分段，不会溢出或提前抓", () => {
  clock = NOW;
  const d = fixture(); d.adj = "2026-11-28"; d.adjustAt = Date.parse("2026-11-29T00:00:00+08:00");
  ui.WB.oil = d; getCalls = 0;
  f.armOilBoundary(d, clock); assert.equal(pendingTimer.ms, 2147483647);
  pendingTimer.fn(); assert.equal(getCalls, 0); assert(pendingTimer.ms > 0);
});
await check("前端：边界同步撤下预测，随后只读GET一次", async () => {
  ui.WB.oil = fixture(); clock = nextAt - 1; getCalls = 0;
  f.armOilBoundary(ui.WB.oil, clock); assert.equal(pendingTimer.ms, 1);
  clock = nextAt; pendingTimer.fn();
  assert(!ui.rendered.includes("0.03"));
  await f.loadOilData();
  assert.equal(getCalls, 1); assert.equal(pendingTimer, null);
});
await check("前端：后台恢复先撤旧值，不覆盖其他卡片", async () => {
  ui.WB.oil = fixture(); ui.WB.other = { untouched: true }; clock = nextAt;
  ui.document.visibilityState = "visible"; getCalls = 0;
  visibilityHandler(); assert(!ui.rendered.includes("0.03"));
  await f.loadOilData(); assert.equal(getCalls, 1); assert.equal(ui.WB.other.untouched, true);
});

const sourceArg = process.argv.indexOf("--source");
if (sourceArg >= 0) await check("实际下载网页：下一窗口11/12且无旧涨幅", () => {
  const h = fs.readFileSync(process.argv[sourceArg + 1], "utf8");
  const p = t.oilParseArticle(h, src, NOW);
  assert.equal(p.calendar[0].adj, "2026-11-12"); assert.equal(p.forecast, null);
});
console.log("\n油价回归：" + passed + " 项通过（固定时钟、无真实网络、未启动服务）");
