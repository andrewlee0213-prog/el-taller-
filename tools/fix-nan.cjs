#!/usr/bin/env node
/* 修复 add-theme.cjs 的 NaN% bug（一次性，v2 对齐版）：
 * swapColors 的 replace 回调误把完整匹配（字符串）当捕获组数组——m[1] 取到匹配串的
 * 第二个字符（"rgba(255,157,46,.35)"[1]==="g"），parseFloat 一律 NaN，所有 color-mix
 * 百分数变成 NaN%（CSS 声明失效掉色）。原始 alpha 从备份按行恢复。
 * 行对齐 key 的归一化（两侧同规则）：
 *   \u0001 = 九种已变量化的 rgba 元组（备份侧）/ 任意 color-mix（当前侧，含 NaN 与已修复）
 *   \u0002 = hex→var 令牌（#c96a12↔var(--g-accent-deep) 等五对）
 * 行内/跨行游标消费，NaN 处的变量名做二次校准。
 * posts/trace-as-state.html 无备份（他会话新建），用修复后的 kids-english.html 当参照。 */
const fs = require("fs");
const path = require("path");

const ROOT = __dirname + "/..";
const BACKUP = ROOT + "/../.backup-el-taller-20261009-theme";

const TUPLE_VAR = [
  [[255,157,46], "--g-accent"], [[255,170,70], "--g-accent"], [[255,150,45], "--g-accent"],
  [[255,217,163], "--g-accent-soft"], [[255,200,120], "--g-accent-soft"],
  [[255,240,228], "--g-text"], [[255,244,232], "--g-text"],
  [[255,236,216], "--g-tint"], [[255,214,180], "--g-tint"],
];
const TUPLE_RE = new RegExp(
  "rgba\\((?:" + TUPLE_VAR.map(([t]) => t.join(",")).join("|") + "),\\d*\\.?\\d+\\)", "g");
const CM_RE = /color-mix\(in srgb,var\(--g-[a-z-]+\) (?:NaN|[\d.]+)%,transparent\)/g;
const NAN_RE = /color-mix\(in srgb,var\((--g-[a-z-]+)\) NaN%,transparent\)/g;
const NORM_RE = /var\(--g-accent(?:-soft|-deep|-mid)?\)|var\(--g-on-accent\)|var\(--g-bg-base\)|var\(--g-bg-[1-3]\)|var\(--g-blob[12]\)|var\(--g-tint\)|#c96a12|#d97c14|#2a1505|#ff9d2e|#ffd9a3/g;
const P1 = "\u0001", P2 = "\u0002";

function pct(alpha){ return String(Math.round(parseFloat(alpha) * 1000) / 10); }
function tupleToVar(r, g, b){
  const hit = TUPLE_VAR.find(([t]) => t[0] === +r && t[1] === +g && t[2] === +b);
  return hit ? hit[1] : null;
}
function keyOf(line){
  return line.replace(CM_RE, P1).replace(TUPLE_RE, P1).replace(NORM_RE, P2);
}

/* 参照：key → [{varName, pct, used}]（只从九种元组取值） */
function buildRefMap(text){
  const map = new Map();
  for (const line of text.split("\n")){
    if (!/rgba\(/.test(line) && !/color-mix\(/.test(line)) continue;
    TUPLE_RE.lastIndex = 0;
    const entries = [];
    let m;
    while ((m = TUPLE_RE.exec(line))){
      const [r, g, b] = m[0].slice(5, -1).split(",").slice(0, 3);
      entries.push({ varName: tupleToVar(r, g, b), pct: pct(m[0].slice(m[0].lastIndexOf(",") + 1, -1)), used: false });
    }
    if (!entries.length) continue;
    const key = keyOf(line);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(...entries);
  }
  return map;
}

let totalFixed = 0;
const failures = [];
function fixFile(file, refPath){
  const cur = fs.readFileSync(path.join(ROOT, file), "utf8");
  const refMap = buildRefMap(fs.readFileSync(refPath, "utf8"));
  const cursor = new Map();
  let fixedInFile = 0;
  const outLines = cur.split("\n").map(line => {
    if (!line.includes("NaN%")) return line;
    const key = keyOf(line);
    const queue = refMap.get(key);
    if (!queue){
      failures.push(`${file} 无参照行: ${key.trim().slice(0, 90)}`);
      return line;
    }
    if (!cursor.has(key)) cursor.set(key, 0);
    let i = cursor.get(key);
    const rebuilt = line.replace(NAN_RE, (m, varName) => {
      while (i < queue.length && (queue[i].used || queue[i].varName !== varName)) i++;
      if (i >= queue.length){
        failures.push(`${file} 参照耗尽(${varName}): ${key.trim().slice(0, 90)}`);
        return m;
      }
      const info = queue[i];
      queue[i].used = true;
      fixedInFile++;
      return `color-mix(in srgb,var(${varName}) ${info.pct}%,transparent)`;
    });
    cursor.set(key, i);
    return rebuilt;
  });
  fs.writeFileSync(path.join(ROOT, file), outLines.join("\n"));
  console.log(`${file}: 修复 ${fixedInFile} 处`);
  totalFixed += fixedInFile;
}

const PAIRS = [
  "index.html","about-site.html","kindle-dashboard.html","poster-six.html","video-scripts.html",
  "kids-english.html","kb.html","login.html",
  "posts/kb-engineering.html","posts/poster-methodology.html","posts/poster-agent-spec.html",
];
for (const f of PAIRS) fixFile(f, path.join(BACKUP, f));
fixFile("posts/trace-as-state.html", path.join(BACKUP, "kids-english.html"));

console.log(`\n共修复 ${totalFixed} 处；失败 ${failures.length} 处`);
for (const f of failures) console.log("  ✗", f);
