const fs = require('fs');
const f = path_join('../03-AI Agent构建知识手册.md');
function path_join(x) { return require('path').join(__dirname, x); }
let t = fs.readFileSync(f, 'utf8');
const a = '胜过一个裸 403）。';
if (!t.includes(a)) { console.log('anchor miss'); process.exit(1); }
const add = a + '\n\n### 3.3 Prompt 还是 Skill：按频次决定\n\n装载一个 Skill 要多花一轮模型调用，所以**按频次决定放哪**：覆盖约三分之一以上流量的指令放系统提示，长尾能力做成 Skill；安全、法务、品牌约束和关键用户事实（过敏原这类）永远放系统提示；能从信号预测的 Skill（比如用户从商品页进入）由 harness 在首轮前直接注入，省掉装载轮。\n\n### 3.4 UI 组件即工具\n\n业务 Agent 的回复大多是界面组件（商品卡片、行程、对比表），而不是散文——让模型输出结构化 Schema，而不是自造标签再让客户端解析。自造标签路线会随组件增长失控：模型对私有标记不如对工具调用可靠、标签定义膨胀系统提示、历史会话只有自研解析器能读。成熟模式是**每个组件就是一个工具**（present_products / present_plan_comparison 这类），模型带类型化参数调用，服务端校验并渲染；组件天然留在消息数组里，重新加载历史无需二次解析。组件参数要按渲染结构组织（有序的行与轮播，而不是会被客户端重排的平铺列表），这样用户说“第一个酒店”时，Agent 能从上一次展示调用的参数里知道屏幕上有什么。代价是流式粒度：工具参数按块缓冲校验，组件分步到达；要逐 Token 流式需开启 eager 流式并包一层重试。';
t = t.replace(a, add);
fs.writeFileSync(f, t, 'utf8');
const keys = ['按频次决定', 'UI 组件即工具', '对话归属权', 'ID 白名单', '门禁评快照', '三杠杆', '每完成任务'];
const miss = keys.filter(k => !t.includes(k));
console.log('03 md 缺关键词:', miss.length ? miss : '无');
