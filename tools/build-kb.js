/* ============================================================
   build-kb.js — 把 Seed 知识库的 md 组装成站点数据 kb-data.js
   用法: node tools/build-kb.js
   源: workspace/default/seed-kb/ 的 03 手册 + 02 题库（01 原文存档不入站）
   00 维护机制更新 03/02 后重跑本脚本即可同步到网站
   ============================================================ */
"use strict";
const fs = require("fs");
const path = require("path");

const SEED = process.env.SEED_KB_DIR || "/Users/yanjunli/Documents/家庭AI/Seed/seed-kb";
if (!fs.existsSync(SEED)) { console.error("找不到 seed-kb 目录: " + SEED + "\n（可设环境变量 SEED_KB_DIR 指定）"); process.exit(1); }
const OUT = path.join(__dirname, "..", "kb-data.js");

/* ---------- 极简 md→HTML（覆盖 03/02 用到的语法子集） ---------- */
const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
function inline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
  return t;
}
function mdToHtml(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let i = 0;
  const isListItem = (l, re) => re.test(l);
  while (i < lines.length) {
    const line = lines[i];
    if (/^```/.test(line)) {                               /* 代码块 */
      const buf = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
      i++;
      out.push('<pre class="kb-pre"><code>' + esc(buf.join("\n")) + "</code></pre>");
      continue;
    }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
      const cells = row => row.trim().replace(/^\||\|$/g, "").split("|").map(c => inline(c.trim()));
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(cells(lines[i])); i++; }
      out.push("<table><thead><tr>" + head.map(h => "<th>" + h + "</th>").join("") + "</tr></thead><tbody>" +
        rows.map(r => "<tr>" + r.map(c => "<td>" + c + "</td>").join("") + "</tr>").join("") + "</tbody></table>");
      continue;
    }
    let m;
    if ((m = line.match(/^(#{3,4})\s+(.+)$/))) { out.push(`<h${m[1].length + 1}>` + inline(m[2]) + `</h${m[1].length + 1}>`); i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { out.push("<hr>"); i++; continue; }
    if ((m = line.match(/^>\s?(.*)$/))) {                    /* 引用块（可多行） */
      const buf = [m[1]]; i++;
      while (i < lines.length && (m = lines[i].match(/^>\s?(.*)$/))) { buf.push(m[1]); i++; }
      out.push("<blockquote>" + buf.map(inline).join("<br>") + "</blockquote>");
      continue;
    }
    if (isListItem(line, /^\s*-\s+/)) {                      /* 无序列表（支持一层嵌套） */
      const items = [];
      while (i < lines.length) {
        const mm = lines[i].match(/^(\s*)-\s+(.+)$/);
        if (!mm) break;
        items.push({ deep: mm[1].length >= 2, text: mm[2] }); i++;
      }
      let html = "<ul>", open = false;
      for (const it of items) {
        if (it.deep) { if (!open) { html += "<ul>"; open = true; } html += "<li>" + inline(it.text) + "</li>"; }
        else { if (open) { html += "</ul>"; open = false; } html += "<li>" + inline(it.text) + "</li>"; }
      }
      if (open) html += "</ul>";
      out.push(html + "</ul>");
      continue;
    }
    if (isListItem(line, /^\s*\d+\.\s+/)) {                  /* 有序列表 */
      const items = [];
      while (i < lines.length && (m = lines[i].match(/^\s*\d+\.\s+(.+)$/))) { items.push(m[1]); i++; }
      out.push("<ol>" + items.map(t => "<li>" + inline(t) + "</li>").join("") + "</ol>");
      continue;
    }
    if (/^\s*$/.test(line)) { i++; continue; }
    /* 普通段落：连续非空行合并 */
    const buf = [line]; i++;
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !/^(#{1,4}\s|>|\s*-\s+|\s*\d+\.\s+|\s*\||```|-{3,})/.test(lines[i])) { buf.push(lines[i]); i++; }
    out.push("<p>" + buf.map(inline).join("<br>") + "</p>");
  }
  return out.join("\n");
}

/* ---------- 拆书：## 为章，题首行 > 引用为书简介 ---------- */
function splitBook(md) {
  const lines = md.split(/\r?\n/);
  let title = "", intro = "", bodyStart = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!title && /^#\s+/.test(lines[i])) { title = lines[i].replace(/^#\s+/, ""); continue; }
    if (/^>\s?/.test(lines[i])) { intro += (intro ? " " : "") + lines[i].replace(/^>\s?/, ""); continue; }
    if (/^##\s+/.test(lines[i])) { bodyStart = i; break; }
    if (/^\s*$/.test(lines[i])) continue;
    bodyStart = i; break;
  }
  const chapters = [];
  let cur = null;
  for (let i = bodyStart; i < lines.length; i++) {
    const m = lines[i].match(/^##\s+(.+)$/);
    if (m) {
      cur = { id: "ch" + chapters.length, title: m[1].trim(), md: [] };
      chapters.push(cur);
    } else if (cur) {
      cur.md.push(lines[i]);
    }
  }
  chapters.forEach(c => { c.html = mdToHtml(c.md.join("\n")); c.text = c.html.replace(/<[^>]+>/g, " "); delete c.md; });
  return { title, intro: inline(intro), chapters };
}

/* ---------- 按书预处理器 ----------
   video：第二个 H1（苹果发布会风格升级包）降为 ## 章标题、其内部 ## 降为 ###，
          否则整段会糊进上一章正文；
   dala：首个 ## 前的说明段（Theme/Dala operates）转 > 引用，让它进书简介
          而不是被拆章逻辑丢弃；书名用中文覆盖源文件英文标题 ---------- */
function preVideo(md) {
  const cut = md.indexOf("\n# 附：苹果发布会风格升级包");
  if (cut < 0) return md;
  const head = md.slice(0, cut);
  const rest = md.slice(cut + 1);                       // 去掉 "# "，保留标题文字
  const nl = rest.indexOf("\n");
  const titleLine = rest.slice(0, nl);
  const body = rest.slice(nl + 1).replace(/^## /gm, "### ");
  return head + "\n## 附 ｜ " + titleLine + "\n" + body;
}
function preDala(md) {
  const cut = md.indexOf("\n## ");
  const head = cut > 0 ? md.slice(0, cut) : md;
  const rest = cut > 0 ? md.slice(cut) : "";
  return head.replace(/^(?![>#\s]).+$/gm, m => "> " + m) + rest;
}

const books = [
  {
    id: "agent-handbook",
    file: path.join(SEED, "03-AI Agent构建知识手册.md"),
    es: "Manual de Agentes",
    desc: "生产级 Agent 系统的十个组成部分、反模式清单与交付纪律。个人知识库知识本体，新材料按 00 维护机制五阶段并入。",
  },
  {
    id: "interview-bank",
    file: path.join(SEED, "02-面试题库-见习AI应用工程师-含三档评分.md"),
    es: "Banco de preguntas",
    desc: "见习 AI 应用工程师面试题库：11 题计分体系、三档评分（OK/还行/不合格）、内转调整与增补题。",
  },
  {
    id: "video-scripts",
    file: path.join(SEED, "07-白话版短视频脚本-12集60秒.md"),
    es: "Guiones de video",
    desc: "白话版的知识视频化改编：12 集 × 60 秒旁白脚本（TTS 直接可读）+ 逐镜画面提示词 + 发布建议与苹果发布会风格升级包。",
    pre: preVideo,
  },
  {
    id: "dala-design",
    file: path.join(SEED, "style", "DESIGN-Dala.md"),
    es: "Lenguaje de diseño",
    desc: "黑色天鹅绒舞台上的星座视觉——Dala 设计语言完整参考：色彩/字体/间距/组件/守则，新页面快速对齐风格用。",
    pre: preDala,
    title: "Dala 设计语言 · 黑色星座风格参考",
  },
].map(b => {
  let md = fs.readFileSync(b.file, "utf8");
  if (b.pre) md = b.pre(md);
  const parsed = splitBook(md);
  const chapters = parsed.chapters.filter(c => c.html.length > 0);   // 源里偶有只挂标题的空节（如 Dala 的 Agent Prompt Guide），产物中剔除
  return { id: b.id, title: b.title || parsed.title, es: b.es, desc: b.desc, intro: parsed.intro, chapters };
});

const total = books.reduce((n, b) => n + b.chapters.length, 0);

/* ---------- 上站脱敏钩子：源文件（私人知识库）保持原样，仅在上站产物中替换。
   词表与《上站内容规划.md》敏感词表同步；新增敏感点先加这里再重建 ---------- */
/* 敏感词表在本机 tools/sanitize.local.json（不入库——词表本身即内部信息，进公开仓库等于自曝）；缺失时拒绝构建，防漏脱敏上站 */
const SANITIZE = (() => {
  const p = path.join(__dirname, "sanitize.local.json");
  if (!fs.existsSync(p)) { console.error("缺少 tools/sanitize.local.json（本机私有词表）"); process.exit(1); }
  return JSON.parse(fs.readFileSync(p, "utf8")).pairs.map(x => [new RegExp(x.re, x.flags || "g"), x.to]);
})();

let payload = JSON.stringify({ generated: new Date().toISOString(), books }, null, 1);
let hits = 0;
for (const [re, to] of SANITIZE) { payload = payload.replace(re, () => { hits++; return to; }); }
fs.writeFileSync(OUT, "/* 由 tools/build-kb.js 生成，勿手改；源文件变更后重跑脚本（已过脱敏钩子） */\nwindow.KB = " + payload + ";\n", "utf8");
console.log(`KB built: ${books.length} books, ${total} chapters, ${(fs.statSync(OUT).size / 1024).toFixed(0)}KB, 脱敏替换 ${hits} 处`);
