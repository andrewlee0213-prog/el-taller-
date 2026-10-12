const fs = require('fs');
const path = require('path');
const f = path.join(__dirname, '..', '05.1-AI Agent构建知识手册-白话版.html');
let t = fs.readFileSync(f, 'utf8');
let bad = 0;
const r = (a, b, name) => {
  if (!t.includes(a)) { console.log('FAIL:', name); bad++; return; }
  t = t.replace(a, b);
};

// CSS：新增 .orig 样式
r('  strong { color:#fff; }',
  '  strong { color:#fff; }\n  h2 .orig { display:inline-block; font-size:12px; color:var(--sub); border:1px solid var(--line); border-radius:6px; padding:1px 8px; margin-left:10px; vertical-align:3px; font-weight:400; letter-spacing:0; }',
  'css');

// 13 个章节标题：白话主标题 + 完整版章名小标签
const H2 = [
  ['<h2><span class="no">0</span>全景：一位靠谱管家是怎么组成的</h2>',
   '<h2><span class="no">0</span>全景：一位靠谱管家是怎么组成的<span class="orig">完整版：一个生产级 Agent 系统由什么组成</span></h2>'],
  ['<h2><span class="no">1</span>脑子：请多聪明的、请谁家的</h2>',
   '<h2><span class="no">1</span>脑子：请多聪明的、请谁家的<span class="orig">完整版：模型层——调用、参数与选型</span></h2>'],
  ['<h2><span class="no">2</span>交代：把话说清楚，把本子给到位</h2>',
   '<h2><span class="no">2</span>交代：把话说清楚，把本子给到位<span class="orig">完整版：上下文与提示层</span></h2>'],
  ['<h2><span class="no">3</span>手脚：管家替你打电话的本事</h2>',
   '<h2><span class="no">3</span>手脚：管家替你打电话的本事<span class="orig">完整版：工具层——Function Calling / MCP / Skill</span></h2>'],
  ['<h2><span class="no">4</span>资料室：开卷考试的艺术（RAG）</h2>',
   '<h2><span class="no">4</span>资料室：开卷考试的艺术<span class="orig">完整版：知识层——RAG 全链路</span></h2>'],
  ['<h2><span class="no">5</span>记性：便签和记事本</h2>',
   '<h2><span class="no">5</span>记性：便签和记事本<span class="orig">完整版：记忆层</span></h2>'],
  ['<h2><span class="no">6</span>行程：跟团游还是自由行</h2>',
   '<h2><span class="no">6</span>行程：跟团游还是自由行<span class="orig">完整版：编排层——循环、框架与状态</span></h2>'],
  ['<h2><span class="no">7</span>规矩：钥匙、银行卡和快递</h2>',
   '<h2><span class="no">7</span>规矩：钥匙、银行卡和快递<span class="orig">完整版：安全、权限与人工介入</span></h2>'],
  ['<h2><span class="no">8</span>考核：怎么才算合格</h2>',
   '<h2><span class="no">8</span>考核：怎么才算合格<span class="orig">完整版：评测——第一基础设施</span></h2>'],
  ['<h2><span class="no">9</span>账本：花销与监控</h2>',
   '<h2><span class="no">9</span>账本：花销与监控<span class="orig">完整版：可观测性与成本</span></h2>'],
  ['<h2><span class="no">10</span>上岗：从能演示到真转正</h2>',
   '<h2><span class="no">10</span>上岗：从能演示到真转正<span class="orig">完整版：从演示到生产——交付纪律</span></h2>'],
  ['<h2><span class="no">11</span>踩坑清单（出现任何一条，评审直接打回）</h2>',
   '<h2><span class="no">11</span>踩坑清单（出现任何一条，评审直接打回）<span class="orig">完整版：反模式清单</span></h2>'],
  ['<h2><span class="no">12</span>黑话对照表 + 延伸阅读</h2>',
   '<h2><span class="no">12</span>黑话对照表 + 延伸阅读<span class="orig">完整版：附录——案例图集与推荐阅读</span></h2>'],
];
for (const [a, b] of H2) r(a, b, a.slice(0, 30));

// 侧栏：技术名在前 + 白话名（等宽排版，二者并存）
const NAV = [
  ['<a href="#s0">0 · 全景：管家是怎么组成的</a>', '<a href="#s0">0 · 系统全景 ｜ 管家组成</a>'],
  ['<a href="#s1">1 · 脑子：请多聪明的</a>', '<a href="#s1">1 · 模型层 ｜ 请多聪明的</a>'],
  ['<a href="#s2">2 · 交代：把话说清楚</a>', '<a href="#s2">2 · 上下文提示 ｜ 把话说清</a>'],
  ['<a href="#s3">3 · 手脚：打电话的本事</a>', '<a href="#s3">3 · 工具层 ｜ 打电话跑腿</a>'],
  ['<a href="#s4">4 · 资料室：开卷考试</a>', '<a href="#s4">4 · RAG ｜ 开卷考试</a>'],
  ['<a href="#s5">5 · 记性：记事本</a>', '<a href="#s5">5 · 记忆层 ｜ 记事本</a>'],
  ['<a href="#s6">6 · 行程：跟团还是自由行</a>', '<a href="#s6">6 · 编排层 ｜ 行程安排</a>'],
  ['<a href="#s7">7 · 规矩：钥匙和银行卡</a>', '<a href="#s7">7 · 安全权限 ｜ 钥匙规矩</a>'],
  ['<a href="#s8">8 · 考核：怎么算合格</a>', '<a href="#s8">8 · 评测 ｜ 转正考核</a>'],
  ['<a href="#s9">9 · 账本：花销与监控</a>', '<a href="#s9">9 · 可观测成本 ｜ 账本</a>'],
  ['<a href="#s10">10 · 上岗：三步转正</a>', '<a href="#s10">10 · 交付纪律 ｜ 上岗</a>'],
  ['<a href="#s11">11 · 踩坑清单</a>', '<a href="#s11">11 · 反模式 ｜ 踩坑清单</a>'],
  ['<a href="#s12">12 · 黑话对照表</a>', '<a href="#s12">12 · 附录 ｜ 黑话对照表</a>'],
];
for (const [a, b] of NAV) r(a, b, 'nav ' + a.slice(0, 24));

fs.writeFileSync(f, t, 'utf8');
console.log(bad ? 'FAILURES: ' + bad : 'all applied OK');
if (bad) process.exitCode = 1;
