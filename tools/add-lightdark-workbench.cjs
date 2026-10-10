#!/usr/bin/env node
/* 一次性改造脚本（2026-10-10）：给 workbench.html 补 blanco/negro 两主题。
 * 它是 10-09 晚并行会话按旧四主题脚手架新建的，tools/add-lightdark.cjs 的 13 页清单没含它。
 * 主体逻辑与 add-lightdark.cjs 相同，按 workbench 脚手架差异适配：
 *  - 无 body transition 行 → 在 body 规则末尾补 ;transition:background-color .35s 再插主题块
 *  - 大阴影串只有两种：0 34px 90px .45 / 0 14px 40px .5
 *  - 绿徽章五处 #8fe9bd + rgba(57,217,138,…) → var(--ok)/color-mix(var(--ok))，
 *    :root 需补 --ok:#39d98a 默认值（negro 块不覆盖 --ok，回落默认亮绿，同 index 语义）
 *  - 无 pre / .vis / .g-pill，跳过对应步骤
 * 用法：node tools/add-lightdark-workbench.cjs   （仅跑一次；回退 = git checkout workbench.html） */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname + "/..";
const FILE = "workbench.html";

const ROOT_EXTRA = "  --ink:#ffffff; --g-drop:rgba(0,0,0,.45); --ok:#39d98a;";

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

const p = path.join(ROOT, FILE);
let html = fs.readFileSync(p, "utf8");
if (html.includes('data-theme="blanco"')) throw new Error(FILE + " 已包含 blanco，疑似重复执行");

/* 1. 白alpha → --ink（先于插块；跳过 :root / inset 内高光 / --dot 行） */
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

/* 2. :root 扩展 --ink / --g-drop / --ok */
const rootAnchor = /^.*--g-bg-1:#4a290f;.*$/m;
if (!rootAnchor.test(html)) throw new Error(FILE + " :root 锚点缺失");
html = html.replace(rootAnchor, line => line + "\n" + ROOT_EXTRA);

/* 3. body 规则补过渡 + 其后插两个主题块 */
const bodyRule = "body{font-family:var(--g-font);color:var(--g-text);background:var(--g-bg-base);min-height:100vh}";
if (!html.includes(bodyRule)) throw new Error(FILE + " body 规则锚点缺失");
html = html.replace(bodyRule,
  bodyRule.replace(/}$/, ";transition:background-color .35s}") + "\n" + THEME_BLOCKS.trimEnd());

/* 4. 追加两个圆点 */
const dotRe = /^(\s*)<button class="tdot" type="button" data-theme-dot="crepusculo"[^>]*><\/button>$/m;
const dm = html.match(dotRe);
if (!dm) throw new Error(FILE + " crepusculo 圆点缺失");
html = html.replace(dotRe, line => line + "\n" + DOT_EXTRA.blanco + "\n" + DOT_EXTRA.negro);

/* 5. 大阴影 → var(--g-drop)（workbench 只这两种） */
for (const [from, to] of [
  ["0 34px 90px rgba(0,0,0,.45)", "0 34px 90px var(--g-drop)"],
  ["0 14px 40px rgba(0,0,0,.5)", "0 14px 40px var(--g-drop)"],
]) html = html.split(from).join(to);

/* 6. 绿徽章令牌化：浅绿字 #8fe9bd 与 rgba(57,217,138,…) 底/边 → var(--ok)（blanco 下变深绿可读） */
html = html.split("background:rgba(57,217,138,.18);color:#8fe9bd;border:1px solid rgba(57,217,138,.35)")
           .join("background:color-mix(in srgb,var(--ok) 16%,transparent);color:var(--ok);border:1px solid color-mix(in srgb,var(--ok) 36%,transparent)");
html = html.split("background:rgba(57,217,138,.15);color:#8fe9bd;border:1px solid rgba(57,217,138,.3)")
           .join("background:color-mix(in srgb,var(--ok) 15%,transparent);color:var(--ok);border:1px solid color-mix(in srgb,var(--ok) 30%,transparent)");
const greenLeft = html.split("#8fe9bd").length - 1;
html = html.split("#8fe9bd").join("var(--ok)");

fs.writeFileSync(p, html);
console.log(`${FILE} OK｜剩余 #8fe9bd 已全换 ${greenLeft} 处｜--ink 注入、主题块×2、圆点×2、阴影×2、绿徽章×2行`);
