const fs = require('fs');
const p = 'C:/Users/XC/.zcode/cli/memories/projects/default-76059537cd57f389/memory/MEMORY.md';
let t = fs.readFileSync(p, 'utf8');
const lines = t.split('\n');
let hit = 0;
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('feishu-doc-access.md')) {
    if (!lines[i].includes('00维护机制')) {
      lines[i] = lines[i].replace(';纠偏:用户要知识本体不要对照索引', ';纠偏:用户要知识本体不要对照索引;**00=知识库维护机制(新材料一律走五阶段:完整阅读硬闸门→知识点卡片→一致/进化/冲突/新增/失效五类判定→03先改再同步HTML)**');
      hit++;
    } else { hit++; }
  }
}
if (hit !== 1) throw new Error('expected 1 line, hit=' + hit);
fs.writeFileSync(p, lines.join('\n'), 'utf8');
console.log('index updated');
