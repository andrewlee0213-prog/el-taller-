#!/usr/bin/env node
/* 一次性改造脚本（2026-10-09 晚）：新增 blanco（白）/ negro（黑）两主题。
 * 用法：node tools/add-lightdark.cjs   （在 el-taller/ 目录下执行，仅跑一次）
 * 改造前备份：../.backup-el-taller-20261009-lightdark/
 * 要点：
 *  - 新变量 --ink（白alpha令牌的墨色，暗主题=白/白主题=深棕）与 --g-drop（大阴影色），
 *    默认值=现状渲染，老四主题像素级不变。
 *  - 白alpha替换跳过 :root 块、跳过 inset 前缀的内高光、跳过含 --dot 的行（圆点高光）。
 *  - replace 回调一律 (m, p1) 签名——上一批 codemod 的 NaN% 教训。 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname + "/..";
const PAGES = [
  "index.html","kids-english.html","about-site.html","kindle-dashboard.html","poster-six.html",
  "video-scripts.html","kb.html","login.html","openclaw.html",
  "posts/kb-engineering.html","posts/poster-methodology.html","posts/poster-agent-spec.html","posts/trace-as-state.html",
];

const ROOT_EXTRA = "  --ink:#ffffff; --g-drop:rgba(0,0,0,.45);";

const THEME_BLOCKS = `
/* ---- blanco / negro：亮暗两极（结构同前四主题，光影同步换底） ---- */
html[data-theme="blanco"]{
  --g-accent:#d97706; --g-accent-soft:#96600c; --g-accent-deep:#b45f09; --g-accent-mid:#e08514; --g-on-accent:#fff8ec;
  --g-text:#33261a; --g-dim:rgba(74,56,32,.66); --g-brd:rgba(62,46,26,.16);
  --g-glass-hi:rgba(255,255,255,.78); --g-glass-lo:rgba(255,255,255,.46);
  --g-card-hi:rgba(255,255,255,.72); --g-card-lo:rgba(255,252,245,.40);
  --g-pillactive:rgba(255,255,255,.92); --g-tint:#f2e3c9;
  --g-glow-a:rgba(255,160,60,.22); --g-glow-b:rgba(214,150,80,.16); --g-glow-c:rgba(160,110,210,.08);
  --g-bg-1:#fdf9f2; --g-bg-2:#f8f1e6; --g-bg-3:#f1e7d6; --g-bg-base:#f8f3ea;
  --g-blob1:rgba(255,170,70,.32); --g-blob2:rgba(170,120,255,.10);
  --ok:#1f9d5c; --warn:#b9791a; --pause:rgba(74,56,32,.45);
  --ink:#3a2c18; --g-drop:rgba(96,72,42,.16);
}
html[data-theme="negro"]{
  --g-accent:#ffa335; --g-accent-soft:#ffd9a3; --g-accent-deep:#c96a12; --g-accent-mid:#d97c14; --g-on-accent:#1c1206;
  --g-text:#f1efec; --g-dim:rgba(240,238,234,.60); --g-brd:rgba(255,255,255,.13);
  --g-glass-hi:rgba(255,255,255,.09); --g-glass-lo:rgba(255,255,255,.035);
  --g-card-hi:rgba(255,255,255,.08); --g-card-lo:rgba(255,255,255,.028);
  --g-pillactive:rgba(48,48,50,.92); --g-tint:#ece7de;
  --g-glow-a:rgba(255,155,55,.15); --g-glow-b:rgba(140,140,148,.10); --g-glow-c:rgba(210,90,220,.07);
  --g-bg-1:#1b1b1d; --g-bg-2:#101012; --g-bg-3:#050506; --g-bg-base:#0b0b0c;
  --g-blob1:rgba(255,150,50,.15); --g-blob2:rgba(170,120,255,.09);
  --ink:#ffffff; --g-drop:rgba(0,0,0,.62);
}
`;

const DOT_EXTRA = {
  blanco: '        <button class="tdot" type="button" data-theme-dot="blanco" style="--dot:#ffffff" title="纸白 · Blanco" aria-label="纸白主题"></button>',
  negro:  '        <button class="tdot" type="button" data-theme-dot="negro" style="--dot:#181818" title="玄黑 · Negro" aria-label="玄黑主题"></button>',
};

/* 工具：挖出第一个 :root{...} 块（其中是主题定义，不做白alpha替换） */
function splitRoot(css){
  const start = css.indexOf(":root{");
  if (start < 0) return { before: css, root: "", after: "" };
  let depth = 0, i = start;
  for (; i < css.length; i++){
    if (css[i] === "{") depth++;
    else if (css[i] === "}"){ depth--; if (depth === 0){ i++; break; } }
  }
  return { before: css.slice(0, start), root: css.slice(start, i), after: css.slice(i) };
}

function process(file){
  const p = path.join(ROOT, file);
  let html = fs.readFileSync(p, "utf8");
  const log = [file];
  if (html.includes('data-theme="blanco"')) throw new Error(file + " 已包含 blanco，疑似重复执行");

  /* 1. 白alpha → --ink（必须在插入主题块之前做，否则块内白色磨砂值会被误转成墨色；
        跳过 :root；跳过 inset 内高光；跳过 --dot 所在行） */
  {
    const parts = splitRoot(html);
    const body = parts.after.split("\n").map(line => {
      if (!line.includes("rgba(255,255,255,") || line.includes("--dot")) return line;
      return line.replace(/inset\s[^,}]*?rgba\(255,255,255,[\d.]+\)|rgba\(255,255,255,[\d.]+\)/g, (m) => {
        if (m.startsWith("inset")) return m;
        const a = m.match(/([\d.]+)\)$/)[1];
        const pct = String(Math.round(parseFloat(a) * 1000) / 10);
        return `color-mix(in srgb,var(--ink) ${pct}%,transparent)`;
      });
    }).join("\n");
    html = parts.before + parts.root + body;
  }

  /* 2. :root 扩展 --ink / --g-drop（锚定 :root 里的默认 bg 行，主题块里是别的色值不会误中） */
  const rootAnchor = /^.*--g-bg-1:#4a290f;.*$/m;
  if (!rootAnchor.test(html)) throw new Error(file + " :root 锚点缺失");
  html = html.replace(rootAnchor, line => line + "\n" + ROOT_EXTRA);

  /* 3. 追加两个主题块（其白色磨砂字面量保持字面量） */
  const trans = "body{transition:background-color .35s}";
  if (!html.includes(trans)) throw new Error(file + " transition 锚点缺失");
  html = html.replace(trans, trans + "\n" + THEME_BLOCKS.trimEnd());

  /* 4. 追加两个圆点 */
  const dotRe = /^(\s*)<button class="tdot" type="button" data-theme-dot="crepusculo"[^>]*><\/button>$/m;
  const dm = html.match(dotRe);
  if (!dm) throw new Error(file + " crepusculo 圆点缺失");
  html = html.replace(dotRe, line => line + "\n" + DOT_EXTRA.blanco + "\n" + DOT_EXTRA.negro);

  /* 5. 大阴影 → var(--g-drop)（精确串，全文件范围） */
  for (const [from, to] of [
    ["0 34px 90px rgba(0,0,0,.45)", "0 34px 90px var(--g-drop)"],
    ["0 24px 60px rgba(0,0,0,.5)", "0 24px 60px var(--g-drop)"],
    ["0 18px 44px rgba(0,0,0,.35)", "0 18px 44px var(--g-drop)"],
    ["0 18px 44px rgba(0,0,0,.5)", "0 18px 44px var(--g-drop)"],
    ["0 16px 36px rgba(0,0,0,.4)", "0 16px 36px var(--g-drop)"],
    ["0 22px 50px rgba(0,0,0,.5)", "0 22px 50px var(--g-drop)"],
  ]) html = html.split(from).join(to);

  /* 6. 代码块 = 深底浅字孤岛：文字色脱离主题文字变量 */
  html = html.split('monospace;color:color-mix(in srgb,var(--g-text) 85%,transparent)}')
             .join('monospace;color:#ffe9cf}');
  html = html.split("padding:0;color:var(--g-accent-soft)}")
             .join("padding:0;color:#ffe9cf}");

  /* 7. index：role-chip 绿色随主题；.vis 徽章文字固定浅色（它坐在深色小底上） */
  html = html.split("background:rgba(57,217,138,.18);color:var(--ok);border:1px solid rgba(57,217,138,.35)")
             .join("background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--ok);border:1px solid color-mix(in srgb,var(--ok) 36%,transparent)");
  html = html.split("background:rgba(20,10,4,.55);color:var(--g-dim)")
             .join("background:rgba(20,10,4,.55);color:rgba(255,240,228,.78)");

  fs.writeFileSync(p, html);
  log.push("OK");
  console.log(log.join(" | "));
}

for (const f of PAGES) process(f);
console.log(`\n完成：${PAGES.length} 页已注入 blanco/negro。`);
