// 把滚动抓取的飞书文档纯文本按原文结构重排为 Markdown 存档
// 输入: ../飞书文档-大模型学习路线-全文.txt（行号与本脚本中的区间一一对应，若重抓需同步修改）
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', '..', '飞书文档-大模型学习路线-全文.txt');
const OUT = path.join(__dirname, '..', '01-原文存档-大模型应用算法学习路线面试实战6.md');

const lines = fs.readFileSync(SRC, 'utf8').split(/\r?\n/);
const L = (n) => (lines[n - 1] || '').trim();

// 区间为 1-based 闭区间，且只含正文（标题行已由 t 字段重发，不重复进正文）
const sections = [
  { lv: 2, t: '阅读指南和学习建议', ranges: [] },
  { lv: 3, t: '前言', ranges: [[59, 78]] },
  { lv: 3, t: '路线/笔记的设计思路', ranges: [[80, 111]] },
  { lv: 2, t: '大模型应用/算法学习路线', ranges: [[113, 205]] },
  { lv: 2, t: '问题说明', ranges: [] },
  { lv: 3, t: '参考资料说明', ranges: [[208, 213]] },
  { lv: 3, t: '笔记学习顺序建议', ranges: [[215, 263], [284, 285]] },
  { lv: 2, t: '经验之谈', ranges: [[287, 287]] },
  { lv: 3, t: '项目如何找', ranges: [[289, 314]] },
  { lv: 3, t: '面试内容复盘小技巧', ranges: [[316, 316]] },
  { lv: 2, t: '大模型岗位介绍', ranges: [[318, 329]] },
  { lv: 3, t: '1 算法工程师', ranges: [[331, 352]] },
  { lv: 3, t: '2 大模型开发工程师', ranges: [[354, 372]] },
  { lv: 3, t: '3. 大模型数据工程师', ranges: [[374, 404]] },
  { lv: 3, t: '4. 推理工程师', ranges: [[406, 432]] },
  { lv: 3, t: '5. 垂直领域微调工程师', ranges: [[434, 467]] },
  { lv: 3, t: 'FDE（前线部署工程师）', ranges: [[469, 534]] },
  { lv: 3, t: '7. 不同岗位技术侧重点和面试技巧', ranges: [[536, 545]] },
  { lv: 2, t: '学习路线（按作者个人背景的路线讲解）', ranges: [[547, 553]] },
  { lv: 2, t: '提升简历通过率，做深项目', ranges: [[555, 558]] },
  { lv: 3, t: '2026年真正有价值的AI项目', ranges: [[582, 590]] },
  { lv: 4, t: '项目一：生产级 RAG 系统', ranges: [[592, 616]] },
  { lv: 4, t: '项目二：完全离线的本地小模型助手', ranges: [[618, 632]] },
  { lv: 4, t: '项目三：监控与可观测性', ranges: [[634, 650]] },
  { lv: 4, t: '项目四：使用 LoRA 和 DPO 微调', ranges: [[652, 676]] },
  { lv: 4, t: '项目五：实时多模态应用', ranges: [[678, 698]] },
  { lv: 4, t: '项目六：可靠的 AI Agent 系统', ranges: [[700, 760]] },
  { lv: 4, t: '7. 如何写进简历', ranges: [[762, 796], [836, 843]] },
  { lv: 4, t: '7.4 三个常见的坑', ranges: [[845, 850]] },
  { lv: 4, t: '8. 结语', ranges: [[852, 854]] },
  { lv: 4, t: '9. 讲解视频', ranges: [[856, 856]] },
  { lv: 2, t: '答疑', ranges: [[858, 886]] },
  { lv: 2, t: '更新记录', ranges: [[888, 1093]] },
];

// 正文中的小标题提升为 ####
const isSubhead = (s) =>
  /^\d+\.\d+(\.\d+)?\s/.test(s) ||
  /^第[一二三]阶段[：:]/.test(s) ||
  /^阶段[一二三][：:]/.test(s) ||
  /^方向[一二三四五六]：/.test(s) ||
  /^示例[一二]：/.test(s) ||
  /^(Agent|RAG|后端知识|前后训练|推理|行业素养|项目)[：:]?$/.test(s) ||
  s === '速览' ||
  (/^\d+[\.、]\s*\S/.test(s) && s.length >= 4 && s.length < 40);

let out = [];
out.push('# 大模型应用/算法学习路线+八股+面试实战6（原文存档）');
out.push('');
out.push('> **原始数据存档，仅供内部使用。**');
out.push('');
out.push('- 来源：《大模型应用/算法学习路线+八股+面试实战6》，飞书云文档，作者"offer多多"（李严骏的云文档）');
out.push('- 链接：<https://my.feishu.cn/docx/CpQ3dVGRbo5oJMxHp9HcaXX0nic>（非公开分享，需飞书登录态）');
out.push('- 抓取：2026-09-08，ZCode 内置浏览器全文提取（模拟滚动 + 按行去重）');
out.push('- 处理：按原文标题结构重新排版；**正文文字一字未改**；仅剔除页面 UI 噪声与重复的侧栏目录');
out.push('- 已知缺失：图片/视频缩略图未包含；内嵌代码块未抓到（如"面试内容复盘小技巧"一节提到的面试录音转写提示词）；"问题说明"一节正文在抓取流中未独立出现');
out.push('- 附录A 是抓取到的侧栏目录，其中"项目实战 → RAG项目实战（含大厂面试真题清单）"等章节正文未随主文档展开，需要时回原文档定位');
out.push('');

for (const sec of sections) {
  out.push('');
  out.push('#'.repeat(sec.lv) + ' ' + sec.t);
  out.push('');
  let n = 0;
  for (const [a, b] of sec.ranges) {
    for (let i = a; i <= b; i++) {
      const s = L(i);
      if (!s) continue;
      if (isSubhead(s)) { out.push(''); out.push('#### ' + s); }
      else { out.push(s); out.push(''); }
      n++;
    }
  }
  if (n === 0) { out.push('（此节正文未在抓取流中出现，回原文档查看）'); out.push(''); }
}

out.push('');
out.push('## 附录A：抓取到的侧栏目录（原文档实际包含的全部章节名）');
out.push('');
for (let i = 8; i <= 51; i++) { const s = L(i); if (s) out.push('- ' + s); }
out.push('');

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out.join('\n'), 'utf8');
console.log('written:', OUT);
console.log('total lines:', out.length);
