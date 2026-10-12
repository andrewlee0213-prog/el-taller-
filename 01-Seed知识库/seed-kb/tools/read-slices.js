const fs = require('fs');
const L = fs.readFileSync(__dirname + '/text-full.txt', 'utf8').split('\n');
const last = (k) => { let r = -1; L.forEach((t, i) => { if (t.includes(k)) r = i; }); return r; };
function dump(title, key, n) {
  const s = last(key);
  console.log('========== ' + title + ' (line ' + s + ') ==========');
  if (s < 0) { console.log('NOT FOUND'); return; }
  for (let i = s; i < Math.min(s + n, L.length); i++) console.log(L[i]);
}
const which = process.argv[2] || '1';
if (which === '1') {
  dump('4.8 CLAUDECODE省TOKEN', '4.8.2 大模型的计费标准', 135);
  dump('5.VIBE CODING', '5. Vibe Coding', 75);
} else if (which === '2') {
  dump('RAG是否被淘汰', 'RAG是否被淘汰', 65);
  dump('LLM-AS-A-JUDGE', 'llm-as-a-judge', 55);
  dump('AGENT场景设计题', 'Agent场景设计题', 90);
  dump('AGENT健壮性', 'Agent的健壮性', 55);
} else if (which === '3') {
  dump('CC四层权限', '四层权限', 70);
  dump('CC四层记忆', '四层记忆', 60);
  dump('CC压缩', 'CC 压缩', 45);
  dump('论文-AGENTS.md核心发现', '核心发现', 45);
  dump('论文-注意力残差', 'Kimi 的核心创新', 55);
  dump('模型选型示范', '模型选型：回答示范', 45);
}
