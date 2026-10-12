// 材料002 融入点 1/2/5 批量执行：03 → 04 模板 → 05 模板 → 05.1 → 02，逐处断言
const fs = require('fs');
const path = require('path');
const KB = path.join(__dirname, '..');
let bad = 0;
const must = (cond, name) => { if (!cond) { console.log('FAIL:', name); bad++; } };

// ---------- 内容定义 ----------
const MD44 = `### 4.4 知识形态的第三阶：把制度做成机器可执行（标准本体）

RAG 之后的第三种知识形态：**不再只是检索文本，而是把规则本身建模成结构化、机器可校验执行的知识**。国家标准 GB/T 48000《标准数字化》（2025/2026 年发布）给出了完整方法体系：

- **能力阶梯**：L1 电子化（有 PDF）→ L2 结构化（XML/JSON 标记）→ L3 语义化（语义单元与知识图谱，可推理）→ L4 智能化（机器可问答、可校验、可执行）→ L5+ 可拓展；
- **本体建模**：15 类核心实体（标准实体、层次、条款、对象、特性、约束逻辑、行动等）+ 34 个对象属性——把"初始容量应为额定容量的 100%–110%"这类条文，变成机器可直接校验的约束逻辑；
- **协同制定**：9 阶段、8 角色、6 权限的在线协同编写规则（参考 ISO/IEC OSD 平台）。

与第 8 章的关系：RAG 解决"答案从哪来"，本体解决"规则能不能自动判"——合规校验类需求（报销是否超标、流程是否越级）走到 L4 后，判断成本趋近于零。完整知识库见 \`gbt48000-kb/\`（00–05）。`;

const HTML44 = (badge) => `<h3>4.4 知识形态的第三阶：把制度做成机器可执行（标准本体）${badge}</h3>
<p>RAG 之后的第三种知识形态：<strong>不再只是检索文本，而是把规则本身建模成结构化、机器可校验执行的知识</strong>。国家标准 GB/T 48000《标准数字化》（2025/2026 年发布）给出了完整方法体系：</p>
<ul>
  <li><strong>能力阶梯</strong>：L1 电子化（有 PDF）→ L2 结构化（XML/JSON 标记）→ L3 语义化（语义单元与知识图谱，可推理）→ L4 智能化（机器可问答、可校验、可执行）→ L5+ 可拓展；</li>
  <li><strong>本体建模</strong>：15 类核心实体（标准实体、层次、条款、对象、特性、约束逻辑、行动等）+ 34 个对象属性——把"初始容量应为额定容量的 100%–110%"这类条文，变成机器可直接校验的约束逻辑；</li>
  <li><strong>协同制定</strong>：9 阶段、8 角色、6 权限的在线协同编写规则（参考 ISO/IEC OSD 平台）。</li>
</ul>
<p>与第 8 章的关系：RAG 解决"答案从哪来"，本体解决"规则能不能自动判"——合规校验类需求（报销是否超标、流程是否越级）走到 L4 后，判断成本趋近于零。完整知识库见 <code>gbt48000-kb/</code>（00–05）。</p>
<h3>4.5 RAG 效果评估（对接第 8 章）</h3>`;

const Q15 = `\n\n### Q15. 如果要让系统"自动判断"一笔报销是否合规，光有 RAG 够吗？你会怎么做？

**考察点**：知识形态阶梯（对应手册 4.4；来源：GB/T 48000《标准数字化》，2026-09-16 进料）。

- ✅ **OK**：分三条技术路线并知道怎么选——文本检索（RAG：答案带出处，但**不能自动执行判断**）、知识图谱（关系可推理）、**本体建模+约束逻辑**（把制度条款拆成对象/特性/约束，规则由机器直接校验，如 GB/T 48000.3 的 15 类实体 34 个属性方法）；能说出"问答用 RAG、自动校验用本体"的选型逻辑。
- 🆗 **还行**：知道 RAG 和知识图谱两种路线，说不清"机器可执行"意味着什么，或不知道约束要结构化。
- ❌ **不合格**：认为把 PDF 扫进系统就是数字化；只会回答"上大模型"；不知道制度规则需要先结构化才能被自动判断。`;

// ---------- 03 md ----------
{
  const f = path.join(KB, '03-AI Agent构建知识手册.md');
  let t = fs.readFileSync(f, 'utf8');
  const re = /### 4\.4 RAG 效果评估[^\n]*/;
  const m = t.match(re);
  must(m, '03 ch4 4.4 heading');
  if (m) {
    const renamed = m[0].replace('4.4', '4.5');
    t = t.replace(re, MD44 + '\n\n' + renamed);
  }
  fs.writeFileSync(f, t, 'utf8');
  console.log('03 md done');
}

// ---------- 05 template ----------
{
  const f = path.join(KB, '05-AI Agent构建知识手册-完整版.template.html');
  let t = fs.readFileSync(f, 'utf8');
  const re = /<h3>4\.4 RAG 效果评估[^<]*<\/h3>/;
  must(re.test(t), '05 ch4 4.4 heading');
  t = t.replace(re, HTML44('<span class="new">NEW</span>'));
  fs.writeFileSync(f, t, 'utf8');
  console.log('05 template done');
}

// ---------- 04 template ----------
{
  const f = path.join(KB, '04-AI Agent构建知识手册-便携版.template.html');
  let t = fs.readFileSync(f, 'utf8');
  const re = /<h3>4\.4 RAG 效果评估[^<]*<\/h3>/;
  must(re.test(t), '04 ch4 4.4 heading');
  t = t.replace(re, HTML44(''));
  fs.writeFileSync(f, t, 'utf8');
  console.log('04 template done');
}

// ---------- 05.1 白话版：4.3 末尾导流句 ----------
{
  const f = path.join(KB, '05.1-AI Agent构建知识手册-白话版.html');
  let t = fs.readFileSync(f, 'utf8');
  const re = /偏 RAG [^<]*深入。<\/p>/;
  must(re.test(t), '05.1 4.3 tail');
  t = t.replace(re, '偏 RAG 岗位才需要深入。顺带一提：<strong>更高阶的做法</strong>，是把制度直接做成机器能读懂、能执行的格式——国家已为此发布专门标准（GB/T 48000《标准数字化》），本知识库另立专库详解。</p>');
  fs.writeFileSync(f, t, 'utf8');
  console.log('05.1 done');
}

// ---------- 02 题库增补 Q15 ----------
{
  const f = path.join(KB, '02-面试题库-见习AI应用工程师-含三档评分.md');
  let t = fs.readFileSync(f, 'utf8');
  const a = '- ❌ **不合格**：不知道缓存的存在；认为省钱只能靠换小模型。';
  must(t.includes(a), '02 Q14 tail');
  t = t.replace(a, a + Q15);
  fs.writeFileSync(f, t, 'utf8');
  console.log('02 done');
}

if (bad) process.exitCode = 1;
