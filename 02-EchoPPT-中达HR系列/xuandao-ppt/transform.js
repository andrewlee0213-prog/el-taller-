const fs = require('fs');
const path = require('path');
const X = 'C:/Users/XC/.zcode/workspace/default/xuandao-ppt/x';
const S = X + '/ppt/slides';
const EMU = 914400;

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const unesc = s => s.replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const rd = f => fs.readFileSync(f, 'utf8');
const wr = (f, s) => fs.writeFileSync(f, s);

/* ---------------- Step 1: table surgery (slide25/26) ---------------- */
function addTableRow(file) {
  let xml = rd(file);
  const tbl = xml.match(/<a:tbl>[\s\S]*?<\/a:tbl>/)[0];
  let trs = tbl.match(/<a:tr [^>]*>[\s\S]*?<\/a:tr>/g);
  if (trs.length >= 6 || tbl.includes('@@R5C')) { console.log(path.basename(file) + ': row5 already present, skip'); return; }
  const header = trs[0], dataRows = trs.slice(1), last = dataRows[dataRows.length - 1];
  const totalH = dataRows.reduce((a, t) => a + parseInt(t.match(/h="(\d+)"/)[1]), 0);
  const newH = Math.round(totalH / (dataRows.length + 1));
  // clone last row, replace cell texts with placeholders
  let clone = last, ci = 0;
  clone = clone.replace(/<a:tc[ >][\s\S]*?<\/a:tc>/g, c => {
    ci++;
    let first = true;
    return c.replace(/<a:t>[\s\S]*?<\/a:t>/g, t => {
      if (first) { first = false; return '<a:t>@@R5C' + ci + '@@</a:t>'; }
      return '<a:t></a:t>';
    });
  });
  // rebuild tbl: adjust data row heights (skip header) + append clone
  let newTbl = tbl;
  let tri = 0;
  newTbl = newTbl.replace(/<a:tr h="\d+"([^>]*)>((?:(?!<\/a:tr>)[\s\S])*)<\/a:tr>/g, (m, rest, body) => {
    tri++;
    if (tri === 1) return m; // header row keeps its height
    return `<a:tr h="${newH}"${rest}>` + body + '</a:tr>';
  });
  const cloneInner = clone.slice(clone.indexOf('>') + 1); // ends with </a:tr>
  newTbl = newTbl.replace('</a:tbl>', `<a:tr h="${newH}">${cloneInner}</a:tbl>`);
  xml = xml.replace(tbl, newTbl);
  wr(file, xml);
  console.log(`${path.basename(file)}: added row5 (placeholders), data-row h -> ${newH} EMU (${(newH / EMU).toFixed(2)}in)`);
}
addTableRow(S + '/slide25.xml');
addTableRow(S + '/slide26.xml');

/* ---------------- Step 2: paragraph text mapping ---------------- */
const M = {
  'slide1.xml': [
    ['绩效型薪酬管理 —— 绩效驱动 · 价值共享', '绩效型薪酬管理 —— 指标到岗 · 责任到人'],
    ['绩效型薪酬体系 · 绩效管理总则 · 战略目标分解及个人指标设定', '部门指标分解方法 · 岗位指标设定 · 岗位职责编写规则'],
  ],
  'slide20.xml': [
    ['战略解码方法论 · 个人指标设定要点', '指标到岗方法论 · 岗位职责编写要点'],
    ['战略目标分解及个人指标设定', '部门指标分解及岗位指标设定'],
    ['目的作用 · 流程要点 · 案例', '分解方法 · 案例 · 职责规则'],
    ['战略不破解，就是墙上的标语；目标不对齐，就是各跑各的。', '指标不到岗，考核就悬空；责任不到人，目标就落空。'],
  ],
  'slide24.xml': [
    ['PROCESS · 流程要点', 'CASCADE · 岗位承接'],
    ['五步解码流程 + 四个关键要点', '岗位指标五步落地 + 四个关键要点'],
    ['定战略主题', '盘点部门指标'],
    ['公司年度BSC目标与战略地图定稿', '部门BSC逐条过：数量·权重·口径'],
    ['开解码会', '岗位认领拆分'],
    ['跨职能研讨：上下对齐校验', '主责岗位承接，大指标切块分派'],
    ['画价值树', '职责衍生补位'],
    ['识别部门对四维度的贡献点与因果链', '从岗位说明书补齐指标盖不到的产出'],
    ['成部门目标', '定口径定权重'],
    ['输出部门KPI/OKR定权重口径', '公式·数据源·目标值·权重=100%'],
    ['双向沟通、书面确认、报CEO/HR备案', '一对一沟通签字确认，报HR备案入指标库'],
    ['• 纵向贯通·横向协同：公司—部门—个人三级对齐，跨部门的接口目标必须双人确认', '• 可控可影响：指标须是岗位行为能推动的；跨岗位指标写明R主责与C协同'],
    ['• SMART 可衡量：每项部门目标须有数据源与计算口径，杜绝"加强/提升"式虚指标', '• 上下贯通：每个岗位指标都答得出「支撑哪条部门指标」，答不出的不进考核'],
    ['• 双向共识：禁止单方面下达，先线下一致再线上审批；权重合计须=100%', '• 数量收敛：每岗3-8个为宜，权重合计100%，单项≥5%，避免人人有份'],
    ['• 动态可调：业务突变时书面确认调整，每周期调整≤1次并报 HR 备案', '• 数据可得：无数据源、无计算口径的指标，先补口径再入库'],
  ],
  'slide23.xml': [
    ['FRAMEWORK · 分解框架', 'FRAMEWORK · 分解四法'],
    ['从 BSC 四维度，找到部门的"贡献点"', '四种分解方法，找到岗位的「承接点」'],
    ['公司战略地图由四个维度构成因果链；部门目标 = 在本维度认领对组织目标的贡献，并写出可衡量结果。', '部门指标不会自动变成岗位指标；同一项指标落到不同岗位，承接方式不同——四法对号入座，避免「人人有份=人人无责」。'],
    ['财', '承'], ['客', '拆'], ['流', '支'], ['学', '衍'],
    ['财务', '直接承接'], ['客户', '口径拆分'], ['内部流程', '流程支撑'], ['学习成长', '职责衍生'],
    ['营收·利润·成本·ROI', '部门指标 = 岗位主责结果'],
    ['用户·份额·满意度·品牌', '按客户·区域·产品·时间切块'],
    ['效率·质量·创新·速度', '上游交付质量决定下游结果'],
    ['人才·能力·文化·系统', '覆盖指标外的长期性职责'],
    ['部门思考：部门如何驱动增长与效率', '岗位思考：我是否对该结果负最终责任'],
    ['部门服务谁、交付什么价值', '岗位领走一块，加总=部门目标'],
    ['部门靠什么流程赢', '以过程指标支撑主责岗位（如：剪辑支撑爆款率）'],
    ['部门靠什么能力支撑前三项', '从岗位说明书提取（如：方法论沉淀、带教）'],
    ['要点：部门未必四个维度都认领，但认领的每项都要能回答"我对组织目标哪一条负责、用什么指标证明"。',
      ['要点：', '一个岗位通常「承接1-2项+衍生1-2项」；纯衍生指标权重合计≤30%，岗位始终围着部门指标转。']],
    ['R主责：对指标结果负最终责任，纳入负责人BSC考核', ['①能推动：', '该结果确为此岗位行为可影响，而非外部环境决定']],
    ['C协同：配合执行，提供输入支持，指标纳入部门BSC，权重偏低', ['②有数据：', '有明确数据源与计算口径，周期内可取数可核对']],
    ['I知悉：仅同步信息，不纳入考核', ['③有归属：', '能答出支撑哪条部门指标——三问皆是才可入库']],
  ],
  'slide25.xml': [
    ['CASE 1 · 业务团队', 'CASE 3 · 业务岗位'],
    ['案例：内容推广团队（业务部门）的目标分解', '案例：抖音内容推广团队（业务部门）的岗位分解'],
    ['组织级 BSC 目标：抖音粉丝净增 500万、内容曝光 20亿、内容驱动新增 GMV 1亿。',
      ['部门级目标（承接上一讲）：', '内容引流 GMV ≥1亿 · 粉丝净增 500万 · 爆款率 ≥8% · 投流 ROI ≥3 · 制作发布周期 ↓30% · 金牌编导 3名']],
    ['BSC 维度', '部门指标'], ['组织目标', '关键岗位'], ['部门（抖音内容推广团队）分解目标', '岗位指标（方法 · 口径 · 目标）'],
    ['财务', '内容引流GMV ≥1亿'],
    ['内容驱动新增 GMV 1亿', '直播运营经理 · 承接'],
    ['内容引流 GMV ≥1亿；单粉获客成本 ↓15%', '全年 GMV ≥1亿按月拆解；单粉获客成本 ↓15%'],
    ['客户', '粉丝净增500万 · 爆款率≥8%'],
    ['粉丝净增500万 / 曝光20亿', '内容编导 · 拆分'],
    ['粉丝净增500万；爆款率(百万播放)≥8%；互动率≥5%', '月爆款条数 ≥N（百万播放口径）；互动率 ≥5%'],
    ['内部流程', '投流 ROI ≥3'],
    ['内容生产提效', '投流专员 · 承接'],
    ['选题-制作-发布周期 ↓30%；投流 ROI ≥3', '投流 ROI ≥3；消耗进度偏差 ≤10%'],
    ['学习成长', '制作发布周期 ↓30%'],
    ['内容方法论沉淀', '后期剪辑 · 支撑'],
    ['搭建可复用内容方法论库；培养3名金牌编导', '单条成片 ≤48h 交付；返工率 ≤10%'],
    ['@@R5C1@@', '方法论沉淀 · 金牌编导3名'],
    ['@@R5C2@@', '编导组长 · 衍生'],
    ['@@R5C3@@', '季度沉淀脚本模板 ≥3套；带教 2 名独立编导'],
    ['解码逻辑：组织"客户+财务"目标，由该团队以"内容产能+投流效率"承接；流程与成长维度保证产能可持续。',
      '解码逻辑：经理承接结果、编导拆口径、投手盯ROI、剪辑做支撑、组长衍生带教——岗位指标加总，必须回到部门目标。'],
  ],
  'slide26.xml': [
    ['CASE 2 · 职能部门', 'CASE 4 · 职能岗位'],
    ['案例：人力资源部（职能部门）的目标分解', '案例：人力资源部（职能部门）的岗位分解'],
    ['组织级 BSC 目标：人效提升 10%、关键岗位满编、核心人才保留率 ≥80%。',
      ['部门级目标（承接上一讲）：', '招聘满足周期 ↓20% · 绩效闭环覆盖率 100% · 薪酬核算准确率 ≥95% · 继任覆盖率 60% · 核心人才保留率 ≥80%']],
    ['BSC 维度', '部门指标'], ['组织目标', '关键岗位'], ['部门（人力资源部）分解目标', '岗位指标（方法 · 口径 · 目标）'],
    ['财务', '招聘满足周期 ↓20%'],
    ['人力成本占收比优化', '招聘专员 · 承接'],
    ['人力成本占收比控制在年度预算内', '平均到岗周期 ≤25天；试用期通过率 ≥85%'],
    ['客户(内部)', '绩效闭环覆盖率 100%'],
    ['关键岗位满编 / 员工满意', '绩效薪酬专员 · 承接'],
    ['招聘满足周期 ↓20%；员工满意度 ≥80', '目标签订率 100%；面谈记录归档率 100%'],
    ['内部流程', '薪酬核算准确率 ≥95%'],
    ['人效提升 10%', '薪酬核算专员 · 拆分'],
    ['绩效闭环覆盖率100%；薪酬核算准确率95%', '分模块核算差错 0起；月度 T+3 出表'],
    ['学习成长', '继任覆盖率 60%'],
    ['核心人才保留 ≥80%', 'HRBP · 支撑'],
    ['关键岗位继任覆盖率60%；核心人才保留率≥80%', '季度更新人才九宫格；继任人 IDP 完成率 100%'],
    ['@@R5C1@@', '人力成本占收比优化'],
    ['@@R5C2@@', 'HRBP · 衍生'],
    ['@@R5C3@@', '季度人效分析报告 1份；预警响应 ≤5个工作日'],
    ['解码逻辑：职能部门的"客户"是业务与员工；用内部服务水平协议(SLA)把软目标变硬指标，对接组织人效与保留。',
      '解码逻辑：职能岗多用SLA口径（周期·准确率·覆盖率·时效）；岗位目标值可严于部门值——加严保达成。'],
  ],
  'slide28.xml': [
    ['RULE · 设定规则', ['JD · ', '职责编写']],
    ['个人指标设定规则', ['岗位职责编写', '规则']],
    ['绩效权重设置原则', '职责编写四条规则'],
    ['指标数量', '动宾结构'], ['5-6个为佳', '动词+对象+成果'], ['最少3个，最多8个', '写清「做什么、出什么」'],
    ['权重总和', '结果导向'], ['所有关键绩效指标', '每条落到可交付产出'], ['权重之和为100%', '写到什么程度，而非日常事务'],
    ['单个权重', '边界清晰'], ['最小不小于5%', '一岗一主线，不重不漏'], ['最好是5的倍数（方便计算）', '交叉职责写明主责与配合'],
    ['权重差异', '数量克制'], ['呈现明显差异', '核心职责 6-10 条'], ['避免全部平均分配', '覆盖80%以上工时'],
    ['指标写法：结果 + 口径 + 时间', ['职责写法：', '动词 + 对象 + 方式 + 成果']],
    ['定量指标', '合格写法'],
    ['写清指标、数据源、目标值与期限', '动词具体 · 有产出 · 可衡量'],
    ['示例：招聘满足周期较上年缩短20%，年度内达成', '示例：独立完成月度薪酬核算，T+3出表，全年差错0起'],
    ['定性指标', '不合格写法'],
    ['写清行为场景、交付标准与等级描述', '动词空洞 · 无产出 · 不可衡量'],
    ['示例：跨部门需求在约定时限内响应并闭环', '示例：负责薪酬相关工作，完成领导交办的其他事项'],
    ['每个指标必须追溯到组织或部门目标；无数据源、无计算口径、无期限的指标不进入考核。',
      '职责是指标的「源代码」——职责里没写的产出，考核里长不出指标；写好职责，指标分解就成功了一半。'],
  ],
  'slide14.xml': [
    ['步骤 ④ · 反馈面谈', 'LINK · 职责到指标'],
    ['一人一谈、面向成长', '从一条职责，长出一项指标'],
    ['基本要求', '转化三问'], ['面谈框架（2701）', '转化示例'], ['记录与跟进', '常见误区'],
    ['• 一人一谈：1对1 当面，禁邮件/群消息替代', '• 产出：这条职责交付什么（成果 · 交付物）'],
    ['• 面向成长：谈优势与不足，非单纯通知分数', '• 衡量：产出好不好怎么量（数量·质量·时效·成本）'],
    ['• 结论与改进计划当场达成共识', '• 定标：目标值多少、数据从哪来（口径+数据源）'],
    ['• 2 分钟：开场破冰、定调', '• 职责：运营公司新媒体账号，产出获客内容'],
    ['• 7 分钟：讲事实与数据', '• 初稿：「新媒体获客效果好」——不可考'],
    ['• 0 留白：员工充分表达', '• 加口径：月均获客线索 ≥300条，单线索成本 ≤50元'],
    ['• 1 分钟：共识下一步行动', '• 补全：季度内达成 · 权重 20%，入指标库'],
    ['• 面谈记录签字确认', '• 职责写成任务流水账，提不出指标'],
    ['• 改进计划纳入下一周期目标', '• 指标与职责两张皮，考核另起炉灶'],
    ['• HRBP 抽查面谈质量', '• 全是「做好配合」式定性，期末没法打分'],
    ['• 未按期面谈纳入管理者扣分', '• 边界不清：交叉产出无人认领，指标落空'],
  ],
  'slide19.xml': [
    ['宣导后，员工与管理者分别要做什么', '宣导后，管理者和员工分别要做什么'],
    ['双方：达成目标共识，确认指标、权重和计算口径', '管理者：盘点部门指标，逐岗定承接·拆分·支撑·衍生'],
    ['员工：定期复盘进展，主要提出资源及支持需求', '管理者：与员工一对一沟通岗位指标、口径与权重'],
    ['管理者：持续跟进，事件发生48小时内反馈', '员工：确认资源与数据源，对口径有异议当场提出'],
    ['员工：用事实自评，参加一对一反馈并确认改进计划', '双方：达成共识签字确认，报HR备案入指标库'],
    ['管理者：统一尺度评估并参加校准，不能全员平均', '管理者：按职责编写规则更新岗位说明书'],
    ['管理者：完成面谈、结果应用和必要的PIP', '员工：按周期复盘进展，数据异常及时预警'],
    ['双方：有异议时按申诉流程提出并保留事实材料', '双方：变更须书面确认报HR，每周期≤1次'],
  ],
};

function rebuildPara(pXml, newText) {
  const pPrM = pXml.match(/<a:pPr[^>]*\/>|<a:pPr[^>]*>[\s\S]*?<\/a:pPr>/);
  const pPr = pPrM ? pPrM[0] : '';
  const runs = pXml.match(/<a:r>[\s\S]*?<\/a:r>/g) || [];
  const endM = pXml.match(/<a:endParaRPr[^>]*\/>|<a:endParaRPr[^>]*>[\s\S]*?<\/a:endParaRPr>/);
  const endPr = endM ? endM[0] : '';
  if (!runs.length) return null;
  const arr = Array.isArray(newText) ? newText.slice() : [newText];
  const n = Math.min(arr.length, runs.length);
  let out = '<a:p>' + pPr;
  for (let i = 0; i < n; i++) {
    let r = runs[i].replace(/<a:t>[\s\S]*?<\/a:t>/, '<a:t>' + esc(arr[i]) + '</a:t>');
    if (i === n - 1 && arr.length > runs.length) r = r.replace(/<a:t>[\s\S]*?<\/a:t>/, '<a:t>' + esc(arr.slice(n - 1).join('')) + '</a:t>');
    out += r;
  }
  return out + endPr + '</a:p>';
}

for (const [file, pairs] of Object.entries(M)) {
  const fp = S + '/' + file;
  let xml = rd(fp);
  const used = new Set();
  xml = xml.replace(/<a:p>[\s\S]*?<\/a:p>/g, p => {
    const runs = p.match(/<a:r>[\s\S]*?<\/a:r>/g) || [];
    if (!runs.length) return p;
    const txt = runs.map(r => (r.match(/<a:t>([\s\S]*?)<\/a:t>/) || [, ''])[1]).join('');
    const key = unesc(txt).trim();
    const hit = pairs.find(([k]) => !used.has(k) && (k === key || k.replace(/\s+/g, '') === key.replace(/\s+/g, '')));
    if (!hit) return p;
    used.add(hit[0]);
    const nb = rebuildPara(p, hit[1]);
    return nb || p;
  });
  const missing = pairs.filter(([k]) => !used.has(k)).map(([k]) => k);
  wr(fp, xml);
  console.log(`${file}: ${used.size}/${pairs.length} replaced` + (missing.length ? '  MISSING: ' + JSON.stringify(missing) : ''));
  if (missing.length) process.exitCode = 2;
}
if (rd(S + '/slide25.xml').includes('@@') || rd(S + '/slide26.xml').includes('@@')) { console.error('PLACEHOLDER LEFT!'); process.exitCode = 3; }

/* ---------------- Step 3: delete / reorder / cleanup ---------------- */
const KEEP_ORDER = [1, 20, 24, 23, 25, 26, 28, 14, 19, 29];
const KEEP = new Set(KEEP_ORDER);
const DEL = []; for (let i = 1; i <= 29; i++) if (!KEEP.has(i)) DEL.push(i);

const presPath = X + '/ppt/presentation.xml';
const relsPath = X + '/ppt/_rels/presentation.xml.rels';
let pres = rd(presPath);
let rels = rd(relsPath);

const relMap = {}; // rId -> slideN
rels.replace(/<Relationship [^>]*\/>/g, r => {
  const id = (r.match(/Id="(rId\d+)"/) || [])[1];
  const tg = (r.match(/Target="([^"]+)"/) || [])[1];
  const m = tg && tg.match(/^slides\/slide(\d+)\.xml$/);
  if (m) relMap[id] = parseInt(m[1]);
  return r;
});
const slide2rid = {}; for (const [rid, n] of Object.entries(relMap)) slide2rid[n] = rid;

// reorder sldIdLst
const sldIds = pres.match(/<p:sldId id="\d+" r:id="rId\d+"\/>/g) || [];
const keepEntries = KEEP_ORDER.map(n => {
  const rid = slide2rid[n];
  const e = sldIds.find(s => s.includes(`r:id="${rid}"`));
  if (!e) { console.error('NO sldId for slide' + n); process.exit(4); }
  return e;
});
const lstStart = pres.indexOf('<p:sldIdLst>');
const lstEnd = pres.indexOf('</p:sldIdLst>');
pres = pres.slice(0, lstStart) + '<p:sldIdLst>' + keepEntries.join('') + pres.slice(lstEnd);
// strip custom shows / sections if any
pres = pres.replace(/<p:custShowLst>[\s\S]*?<\/p:custShowLst>/g, '');
pres = pres.replace(/<p:extension[^>]*>[\s\S]*?sectionLst[\s\S]*?<\/p:extension>/g, '');
wr(presPath, pres);

// rels: drop deleted slide relationships
const delRids = DEL.map(n => slide2rid[n]);
rels = rels.replace(/<Relationship [^>]*\/>/g, r => (delRids.some(id => r.includes(`Id="${id}"`)) ? '' : r));
wr(relsPath, rels);

// find deleted slides' notesSlides, delete slide+rels+notes parts
const ctPath = X + '/[Content_Types].xml';
let ct = rd(ctPath);
const notesToDelete = [];
for (const n of DEL) {
  const rp = `${S}/_rels/slide${n}.xml.rels`;
  if (fs.existsSync(rp)) {
    const rc = rd(rp);
    const nm = rc.match(/Target="[^"]*notesSlide(\d+)\.xml"/);
    if (nm) notesToDelete.push(nm[1]);
    fs.rmSync(rp);
  }
  fs.rmSync(`${S}/slide${n}.xml`);
}
for (const nn of [...new Set(notesToDelete)]) {
  fs.rmSync(`${X}/ppt/notesSlides/notesSlide${nn}.xml`, { force: true });
  fs.rmSync(`${X}/ppt/notesSlides/_rels/notesSlide${nn}.xml.rels`, { force: true });
  ct = ct.replace(new RegExp(`<Override PartName="/ppt/notesSlides/notesSlide${nn}\\.xml"[^>]*/>`, 'g'), '');
}
for (const n of DEL) ct = ct.replace(new RegExp(`<Override PartName="/ppt/slides/slide${n}\\.xml"[^>]*/>`, 'g'), '');
wr(ctPath, ct);

// purge orphan media
const ref = new Set();
function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    if (fs.statSync(fp).isDirectory()) walk(fp);
    else if (f.endsWith('.rels')) {
      const c = rd(fp);
      for (const m of c.matchAll(/Target="[^"]*media\/([^"]+)"/g)) ref.add(m[1]);
    }
  }
}
walk(X + '/ppt');
const mediaDir = X + '/ppt/media';
let purged = 0;
for (const f of fs.readdirSync(mediaDir)) if (!ref.has(f)) { fs.rmSync(path.join(mediaDir, f)); purged++; }
console.log('media purged:', purged, 'kept:', ref.size);

// core.xml title
const coreP = X + '/docProps/core.xml';
if (fs.existsSync(coreP)) {
  let core = rd(coreP);
  if (/<dc:title>[\s\S]*?<\/dc:title>/.test(core)) core = core.replace(/<dc:title>[\s\S]*?<\/dc:title>/, '<dc:title>中达集团绩效型薪酬管理宣导·岗位指标分解篇</dc:title>');
  wr(coreP, core);
}

/* ---------------- Step 4: self checks ---------------- */
const KEPT_TEXT_WHITELIST = ['共识归档', '四个关键要点', '管理要求', '人力资源部 Judy', '正道', '利他', '真实', '情义', '把目标变成行动'];
const FORBIDDEN = ['解码会', '价值树', '2701', '定量指标', '定性指标', '组织级', '述职', '战略解码', 'BSC 维度', '组织目标', '绩效权重', '反馈面谈', '业务团队', '的目标分解', '@@'];
let bad = 0;
for (const n of KEEP_ORDER) {
  const xml = rd(`${S}/slide${n}.xml`);
  const texts = [...xml.matchAll(/<a:t>([\s\S]*?)<\/a:t>/g)].map(m => unesc(m[1])).filter(t => t.trim());
  const joined = texts.join('\u0001');
  for (const f of FORBIDDEN) if (joined.includes(f)) { console.error(`slide${n}: FORBIDDEN "${f}" remains`); bad++; }
  // rels integrity
  const rp = `${S}/_rels/slide${n}.xml.rels`;
  const rc = rd(rp);
  for (const m of xml.matchAll(/r:(?:embed|id|link)="(rId\d+)"/g)) {
    if (!new RegExp(`Id="${m[1]}"`).test(rc)) { console.error(`slide${n}: dangling ${m[1]}`); bad++; }
  }
  for (const m of rc.matchAll(/Target="([^"]+)"/g)) {
    const t = m[1];
    if (t.startsWith('http') || t.includes('TargetMode="External"')) continue;
    const full = path.normalize(path.join(S, t));
    if (!fs.existsSync(full)) { console.error(`slide${n}: rel target missing ${t}`); bad++; }
  }
}
const sldIdCount = (rd(presPath).match(/<p:sldId /g) || []).length;
console.log('sldIdLst count =', sldIdCount, '(expect 10)');
console.log(bad === 0 && sldIdCount === 10 ? 'SELF-CHECK PASS' : 'SELF-CHECK FAIL');
