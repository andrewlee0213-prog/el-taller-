const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');
const files = [
  path.join(DIR, '04-AI Agent构建知识手册-便携版.template.html'),
  path.join(DIR, '05-AI Agent构建知识手册-完整版.template.html'),
];
const reps = [
  // 图注去出处
  [/▲ 原文插图：/g, '▲ '],
  [/▲ 原文案例配图：/g, '▲ 案例配图：'],
  // 案例框抬头
  [/<b>原文案例（网页 RAG 项目）：<\/b>/g, '<b>案例（网页 RAG 项目）：</b>'],
  // 引言里的来源声明
  [/文中统计数据来自原素材整理，对外引用前先自证原始出处。/g, '文中数据为编写时的行业统计口径，正式对外引用前请先核实。'],
  [/，无需回看原始素材。/g, '。'],
  // JD 样例图注（两种措辞）
  [/面试实战章节收录的岗位 JD 样例（教候选人“从 JD 反推考察重点”）/g, 'AI 岗位 JD 样例——从 JD 反推考察重点是面试准备的标准方法'],
  [/面试实战章节收录的岗位 JD 样例（原文收录字节\/百度\/京东\/快手等大厂真题时，附 JD 原文截图，教候选人“从 JD 反推考察重点”）/g, 'AI 岗位 JD 样例——从 JD 反推考察重点是面试准备的标准方法'],
  [/面试实战章节收录的岗位 JD 样例/g, 'AI 岗位 JD 样例'],
  // 附录配图说明段（整段替换）
  [/<p style="font-size:14px;color:var\(--sub\)">原文档全部 86 张插图中[\s\S]*?<\/p>/g, '<p style="font-size:14px;color:var(--sub)">本手册配图 11 幅，均已嵌入对应章节。</p>'],
  // 页脚
  [/依据《AI Agent 构建知识手册》（03）生成 · 插图取自原素材快照 2026-09-08/g, '2026-09-08 编成'],
  [/在 03\/04 基础上补入原文深段 6 块知识 · 插图取自原素材快照 2026-09-08/g, '2026-09-08 编成'],
  // 侧栏说明（05）
  [/在便携版基础上补入原文深段 6 块知识/g, '含 6 块进阶补全'],
  [/。核查详见 06 报告。/g, '。'],
  // 徽标
  [/含原文案例插图 11 幅/g, '配图 11 幅'],
  [/含原文插图 11 幅/g, '配图 11 幅'],
  [/深段补全 6 块 NEW/g, '进阶补全 6 块 NEW'],
  [/快照 2026-09-08/g, '2026-09-08 版'],
];
for (const f of files) {
  let t = fs.readFileSync(f, 'utf8');
  for (const [re, to] of reps) t = t.replace(re, to);
  fs.writeFileSync(f, t, 'utf8');
  const left = t.match(/.{0,18}(原文|原素材|原始素材).{0,18}/g) || [];
  console.log(path.basename(f), '=> leftovers:', left.length ? left : 'NONE');
}
console.log('OK');
