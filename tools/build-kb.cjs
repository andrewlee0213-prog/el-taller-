/* 把 seed-kb 的 03手册 + 02题库 转成知识卡片 JSON
   输出: el-taller/data/kb-content.json（data/ 目录被服务器列为永不对外，仅 /api/kb 鉴权下发）
   用法: node tools/build-kb.cjs */
const fs = require('fs');
const path = require('path');

const SEED = process.env.SEED_KB_DIR || '/Users/yanjunli/Documents/家庭AI/Seed/seed-kb';
if (!fs.existsSync(SEED)) { console.error('找不到 seed-kb 目录: ' + SEED + '\n（可设环境变量 SEED_KB_DIR 指定）'); process.exit(1); }
const OUT = path.join(__dirname, '..', 'data', 'kb-content.json');
const find = kw => fs.readdirSync(SEED).find(x => x.includes(kw));

const entries = [];
let seq = 0;
const push = e => entries.push(Object.assign({ id: 'kb-' + (++seq) }, e));

/* ---------- 03 手册：## 章节为类目，### 小节为卡片；无小节的章节整章成卡 ---------- */
const manual = fs.readFileSync(path.join(SEED, find('03-AI')), 'utf8').split('\n');
let chapter = '';
let cur = null; // {title, buf}
const flushManual = () => {
  if (cur) {
    const text = cur.buf.join('\n').trim();
    if (text) push({ cat: chapter, title: cur.title, body: text, type: '手册' });
  }
  cur = null;
};
for (const line of manual) {
  const h2 = line.match(/^## (.+)/);
  const h3 = line.match(/^### (.+)/);
  if (h3) { flushManual(); cur = { title: h3[1].trim(), buf: [] }; continue; }
  if (h2) {
    flushManual();
    chapter = h2[1].trim();
    cur = { title: chapter, buf: [] }; // 章节头也可能直接带正文（如全景/反模式）
    continue;
  }
  if (cur) cur.buf.push(line);
}
flushManual();

/* ---------- 02 题库：## 模块为类目，### Q 为卡片 ---------- */
const bank = fs.readFileSync(path.join(SEED, find('02-面')), 'utf8').split('\n');
let qcat = '题库·说明';
let qcur = null;
const flushQ = () => {
  if (qcur && qcur.buf.trim()) push({ cat: qcat, title: qcur.title, body: qcur.buf.trim(), type: '题库' });
  qcur = null;
};
for (const line of bank) {
  const h2 = line.match(/^## (.+)/);
  const h3 = line.match(/^### (.+)/);
  if (h3) { flushQ(); qcur = { title: h3[1].trim(), buf: '' }; continue; }
  if (h2) { flushQ(); qcat = '题库·' + h2[1].trim(); continue; }
  if (qcur) qcur.buf += line + '\n';
}
flushQ();

/* 输出 */
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const meta = {
  name: 'El Semillero',
  built: new Date().toISOString(),
  source: 'seed-kb 03手册 + 02题库',
  count: entries.length,
  cats: [...new Set(entries.map(e => e.cat))],
};

/* 上站脱敏钩子：词表与 tools/build-kb.js 共用本机 tools/sanitize.local.json（不入库——词表本身即内部信息；缺失时拒绝构建） */
const SANITIZE = (() => {
  const p = path.join(__dirname, "sanitize.local.json");
  if (!fs.existsSync(p)) { console.error('缺少 tools/sanitize.local.json（本机私有词表）'); process.exit(1); }
  return JSON.parse(fs.readFileSync(p, "utf8")).pairs.map(x => [new RegExp(x.re, x.flags || "g"), x.to]);
})();
let payload = JSON.stringify({ meta, entries }, null, 1);
let hits = 0;
for (const [re, to] of SANITIZE) { payload = payload.replace(re, () => { hits++; return to; }); }
fs.writeFileSync(OUT, payload, 'utf8');
console.log('OK entries=' + entries.length + ' cats=' + meta.cats.length + ' 脱敏替换=' + hits);
meta.cats.forEach(c => console.log('  -', c, '(', entries.filter(e => e.cat === c).length, ')'));
