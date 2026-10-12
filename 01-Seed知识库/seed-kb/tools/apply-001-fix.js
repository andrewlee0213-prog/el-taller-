// 001 补写：修正 5 处锚点变体
const fs = require('fs');
const path = require('path');
const KB = path.join(__dirname, '..');
const F03 = path.join(KB, '03-AI Agent构建知识手册.md');
const F04 = path.join(KB, '04-AI Agent构建知识手册-便携版.template.html');
const F05 = path.join(KB, '05-AI Agent构建知识手册-完整版.template.html');
let bad = 0;

// 03 M2a：宽松行锚
let t = fs.readFileSync(F03, 'utf8');
{
  const re = /4\. \*\*工具分级\*\*：[^\n]*/;
  const m = t.match(re);
  const add = '\n\n还有两条商业一线验证过的工具原则：**工具调用你已有的系统，而不是重新实现它的逻辑**——搜索排序、购物车、库存、风控这些系统沉淀了多年调优，工具的边界就是系统逻辑的尽头、模型判断的起点（调用 search_products 时结果应已排好序，模型的活是决定展示哪些、怎么展示）；**工具结果就是上下文**——只返回模型要推理的字段（搜索行里捎带图片 URL 是惯犯），错误要返回指令而不是错误码（"查询库存请带商品 ID"胜过一个裸 403）。';
  if (m) { t = t.replace(re, m[0] + add); console.log('03 M2a OK'); } else { console.log('03 M2a STILL FAIL'); bad++; }
}
fs.writeFileSync(F03, t, 'utf8');

const M3TXT = '<h3>5.2 工程实现：异步抽取与三层读取<span class="new">NEW</span></h3>\n<p>存储用你已有数据库里的<strong>小型类型化事实</strong>（键、短值、类别、来源会话），按"人"而不止按"账号"建（共享账号场景每人一份，读取遵守该操作员的权限）；<strong>写入走异步抽取</strong>——每轮或每几轮由独立线程读对话文本并增删改事实，不给用户回合加延迟（内部评测事实召回 +13%）；不要做成"Agent 调用保存工具"：每次保存占一轮还和主任务抢注意力，实测会漏记。抽取器只读用户与助手的文本、不读工具结果——商品描述不能变成关于用户的记忆。<strong>读取分三层</strong>：常驻上下文（几乎每个请求都依赖的少数事实）、按轮预取（由入口信号预测，搜鞋就带上尺码偏好）、其余走查询工具。隐私四则：写入路径用校验器控制"愿意存哪类记忆"；给用户查看/更正/删除通道并接入注销流程；设保留期防陈旧；按部署地区可整体关闭。</p>';

// 04 M3：s5 以 figure 结尾
let t4 = fs.readFileSync(F04, 'utf8');
{
  const a = '</figure>\n</section>\n\n<section id="s6">';
  if (t4.includes(a)) { t4 = t4.replace(a, '</figure>\n' + M3TXT.replace('<span class="new">NEW</span>', '') + '\n</section>\n\n<section id="s6">'); console.log('04 M3 OK'); }
  else { console.log('04 M3 STILL FAIL'); bad++; }
}
// 04 M6a：子集匹配变体
{
  const a = '（agentevals 库支持无序/子集匹配）。</p>';
  const bq = '\n<blockquote><p><strong>裁决：门禁评快照，调试评轨迹。</strong>行业另一主流主张"评快照不评路径"：模型 API 无状态，任何对话状态都可以直接构造——造出测试态、追加测试消息、跑 Agent，然后<strong>只评最终状态与渲染结果（含最后一次写操作的参数）</strong>，对路径的断言脆弱且限制实现。这与三层评测不矛盾，按用途分工：上线门禁用快照结果（稳定、可构造、不脆弱）；轨迹与单步评测降级为调试定位手段，不作发布门槛。模拟用户评测（第二个模型扮用户、裁判评全程）只用于<strong>发现覆盖缺口</strong>，不用于测量。</p></blockquote>';
  if (t4.includes(a)) { t4 = t4.replace(a, a + bq); console.log('04 M6a OK'); }
  else { console.log('04 M6a STILL FAIL'); bad++; }
}
// 04 徽标日期（M3 插入不含日期，补做）
t4 = t4.split('2026-09-08 版').join('2026-09-09 版').split('2026-09-08 编成').join('2026-09-09 编成');
fs.writeFileSync(F04, t4, 'utf8');

// 05 M6b：锚在 Rubric 条尾部
let t5 = fs.readFileSync(F05, 'utf8');
{
  const a = '重新校准阈值。</li>';
  const add = '\n  <li><strong>脏条件与负面用例</strong>：多数套例挂在干净状态上，要专门造长而乱、自相矛盾的前置历史；每个正面用例配负面对（应服务/应拒答、应直接做/应先问）——缺负面是最常见的套例缺口；注入拆两例：用户消息注入 vs 数据面注入（藏在商品名/评论/网页摘要里随工具结果进来）；跨能力组合请求单独写例（"降价 15% 库存够吗"=定价+库存两问，逐能力写的评测各自只核自己那半）；受管文案逐字节比对。用例与业务专家（客服/法务/运营）共写，<strong>真实事故是最好的用例</strong>，每个用户流 50–100 条起步。</li>';
  if (t5.includes(a)) { t5 = t5.replace(a, a + add); console.log('05 M6b OK'); }
  else { console.log('05 M6b STILL FAIL'); bad++; }
}
// 05 M6c：锚在阻断发布
{
  const a = '阻断发布</strong>。</p>';
  const add = '\n<p>组织级协作要点：<strong>所有权跟着系统走</strong>（每个 Skill/工具有唯一归属团队，共享提示词分平台段与域段双属主）；变更自带用例，CI 按影响分层跑——核心高流量集与全部安全例必跑，改 Skill 跑自身+邻域边界例，改共享提示词跑全量；门禁看多次试用的通过率，外加缓存命中率与每轮成本；夜间全量+发布前全量抓跨团队回归；Agent 进发布日历：金丝雀灰度、单 Skill 热开关、高峰期前冻结。</p>';
  if (t5.includes(a)) { t5 = t5.replace(a, a + add); console.log('05 M6c OK'); }
  else { console.log('05 M6c STILL FAIL'); bad++; }
}
fs.writeFileSync(F05, t5, 'utf8');
if (bad) process.exitCode = 1;
