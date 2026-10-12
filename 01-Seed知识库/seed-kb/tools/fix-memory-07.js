const fs = require('fs');
const p = 'C:/Users/XC/.zcode/cli/memories/projects/default-76059537cd57f389/memory/feishu-doc-access.md';
let t = fs.readFileSync(p, 'utf8');
if (t.includes('07 短视频脚本（09-09 交付）')) { console.log('07 line already present, nothing to do'); process.exit(0); }
const lines = t.split('\n');
const L07 = '- **07 短视频脚本（09-09 交付）**：`workspace/default/seed-kb/07-白话版短视频脚本-12集60秒.md`——白话版改编 12 集×60 秒，主角"管家小七"（深蓝马甲白手套7号徽章）贯穿，每集旁白 210–240 字+6/7 镜逐镜提示词（Seedance 中文直投/海螺运镜用 [Push in] 等导演指令），工作流=文生图定妆照→图生视频保一致性→TTS 旁白→拼装；硬规则：画面禁文字（字幕后期）。09-10 学习苹果发布会逐字稿风格→07 附录存 9 条叙事 DNA+EP1-A/EP9-A 发布会风示范集，其余 10 集待确认后换装。';
let hit = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('Seed HTML 统一设计风格 = Dala')) { lines.splice(i, 0, L07); hit++; break; }
}
if (hit !== 1) throw new Error('Dala line not found');
fs.writeFileSync(p, lines.join('\n'), 'utf8');
console.log('07 line restored before Dala line');
