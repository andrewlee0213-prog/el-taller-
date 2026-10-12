const fs = require('fs');
const dir = 'C:/Users/XC/.zcode/workspace/default/seed-kb/';
const files = {
  '00-知识库维护机制.md': ['完整阅读'],
  '01-原文存档-大模型应用算法学习路线面试实战6.md': ['offer多多'],
  '02-面试题库-见习AI应用工程师-含三档评分.md': ['门禁评快照', 'ID 白名单', '按频次决定'],
  '03-AI Agent构建知识手册.md': ['按频次决定', '门禁评快照', 'ID 白名单', '每完成任务'],
  '04-AI Agent构建知识手册-便携版.html': ['2026-09-09', '按频次决定', '门禁评快照'],
  '05-AI Agent构建知识手册-完整版.html': ['2026-09-09', '按频次决定', '门禁评快照', '三杠杆'],
  '06-知识点覆盖度核查报告.md': ['材料 001', '快照评测 vs 轨迹评测'],
};
for (const [f, keys] of Object.entries(files)) {
  const t = fs.readFileSync(dir + f, 'utf8');
  const s = fs.statSync(dir + f);
  const marks = keys.map(k => k + ':' + (t.includes(k) ? 'Y' : 'N')).join(' ');
  const d08 = (t.match(/2026-09-08/g) || []).length;
  console.log(f.slice(0, 2), '| mtime:', s.mtime.toISOString().slice(0, 16), '|', marks, '| 09-08残留:', d08);
}
