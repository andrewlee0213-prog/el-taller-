const fs = require('fs');
const p = 'C:/Users/XC/.zcode/cli/memories/projects/default-76059537cd57f389/memory/MEMORY.md';
let t = fs.readFileSync(p, 'utf8');
const lines = t.split('\n');
const NEW = '- [飞书文档读取能力](feishu-doc-access.md) — IAB 已有 my.feishu.cn 登录态可直接读私有文档;已读:offer多多《大模型学习路线+八股+面试实战6》;**Seed五件套已交付 workspace/default/seed-kb/**(01原文存档[仅前1/7]/02面试题库/03手册/04便携HTML/05完整版桌面HTML含深段补全6块NEW+06覆盖度核查报告);全文已重扫12238行存tools/text-full.txt;86张插图在tools/imgs;纠偏:用户要知识本体不要对照索引';
let hit = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('feishu-doc-access.md')) { lines[i] = NEW; hit++; }
}
if (hit !== 1) throw new Error('expected 1 line, hit=' + hit);
fs.writeFileSync(p, lines.join('\n'), 'utf8');
console.log('MEMORY.md line replaced OK');
