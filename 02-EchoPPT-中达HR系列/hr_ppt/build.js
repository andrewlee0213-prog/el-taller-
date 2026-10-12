const pptxgen = require("pptxgenjs");
const fs = require("fs");

const FONT = "Microsoft YaHei";
// palette derived from xmzoda campus site (mauve/lavender purple)
const BG_DARK = "453252";      // deep purple (cover/section/closing)
const PRIMARY = "B997B9";      // xiangyu purple (site button color)
const PRIMARY_DARK = "7C5E7C"; // deep text-safe purple
const TINT = "F5EEF5";         // light lavender card bg
const ACCENT = "C078A8";       // rose-magenta accent
const RED = "D80018";          // logo red, warning only
const TEXT = "3A2F40";
const MUTED = "6E6276";
const WHITE = "FFFFFF";

const W = 13.33, H = 7.5, M = 0.5;

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE";
pres.author = "HR Department";
pres.title = "Zhongda Group HR Plan";

const shadow = () => ({ type: "outer", color: "453252", blur: 7, offset: 2, angle: 90, opacity: 0.14 });

function T(slide, text, o) {
  slide.addText(text, Object.assign({ fontFace: FONT, color: TEXT, margin: 0 }, o));
}
function pill(slide, text, x, y, w, h, o) {
  const opts = o || {};
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h, rectRadius: h / 2,
    fill: { color: opts.fill || TINT },
    line: opts.lineColor ? { color: opts.lineColor, width: 1 } : { type: "none" },
  });
  T(slide, text, { x, y, w, h, align: "center", valign: "middle", fontSize: opts.fontSize || 13, bold: opts.bold !== false, color: opts.color || PRIMARY_DARK });
}
function card(slide, x, y, w, h, fill, useShadow) {
  const o = { x, y, w, h, rectRadius: 0.12, fill: { color: fill || TINT }, line: { type: "none" } };
  if (useShadow) o.shadow = shadow();
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, o);
}
function header(slide, title, kicker, pageNo) {
  if (kicker) pill(slide, kicker, M, 0.48, 1.72, 0.34, { fontSize: 12.5 });
  T(slide, title, { x: M, y: kicker ? 0.92 : 0.78, w: 12.3, h: 0.72, fontSize: 36, bold: true, color: TEXT });
  T(slide, "Zhongda Group · HR", { x: M, y: 7.1, w: 3.5, h: 0.28, fontSize: 12, color: MUTED });
  T(slide, pageNo + " / 12", { x: 11.6, y: 7.1, w: 1.23, h: 0.28, fontSize: 12, color: MUTED, align: "right" });
}
function numCircle(slide, n, x, y, d, fillColor) {
  slide.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: fillColor || PRIMARY }, line: { type: "none" } });
  T(slide, String(n), { x, y, w: d, h: d, align: "center", valign: "middle", fontSize: 16, bold: true, color: WHITE });
}
function deco(slide) {
  slide.addShape(pres.shapes.OVAL, { x: 9.4, y: -1.9, w: 6.2, h: 6.2, fill: { color: PRIMARY, transparency: 82 }, line: { type: "none" } });
  slide.addShape(pres.shapes.OVAL, { x: 11.1, y: 3.1, w: 4.2, h: 4.2, fill: { color: ACCENT, transparency: 86 }, line: { type: "none" } });
  slide.addShape(pres.shapes.OVAL, { x: -2.1, y: 4.9, w: 5.4, h: 5.4, fill: { color: PRIMARY, transparency: 88 }, line: { type: "none" } });
}

/* ============ S1 Cover ============ */
{
  const s = pres.addSlide();
  s.background = { color: BG_DARK };
  deco(s);
  pill(s, "XIAMEN ZHONGDA GROUP · HR DEPARTMENT", 0.9, 1.55, 4.35, 0.4, { fill: "5A4368", color: "E8D8E8", fontSize: 12, bold: false });
  T(s, "厦门中达集团 · 人力资源部", { x: 0.92, y: 2.15, w: 8, h: 0.5, fontSize: 20, bold: true, color: PRIMARY });
  T(s, "HR部门工作规划", { x: 0.85, y: 2.7, w: 11.5, h: 1.15, fontSize: 60, bold: true, color: WHITE });
  T(s, "看清分工 · 建好标准 · 贴近业务", { x: 0.92, y: 4.05, w: 9, h: 0.45, fontSize: 19, color: "D8C4D8" });
  T(s, "管理层汇报 ｜ 2026年9月", { x: 0.92, y: 4.62, w: 8, h: 0.4, fontSize: 14, color: "B9A3C4" });
  T(s, "正道 · 利他 · 真实 · 情义", { x: 0.92, y: 6.6, w: 8, h: 0.4, fontSize: 14, bold: true, color: PRIMARY });
  s.addNotes("开场：今天汇报三件事——HR的分工是什么、招聘和绩效两套标准流程怎么建、BP怎么贴到业务身边。");
}

/* ============ S2 Contents ============ */
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  T(s, "目录", { x: 0.55, y: 1.0, w: 2.6, h: 0.95, fontSize: 48, bold: true, color: TEXT });
  T(s, "CONTENTS", { x: 0.58, y: 2.0, w: 2.6, h: 0.35, fontSize: 13, color: MUTED, charSpacing: 4 });
  const rows = [
    ["01", "认识中达", "我们在一家什么样的公司做HR：业务版图、发展阶段与当前处境"],
    ["02", "HR到底干啥的", "三支柱内部分工：COE定规则 · HRBP贴业务 · SSC管事务"],
    ["03", "分模块规划", "招聘的标准与流程 · 绩效的理念与流程 · HRBP的标准与职责"],
  ];
  rows.forEach((r, i) => {
    const y = 1.25 + i * 1.75;
    T(s, r[0], { x: 3.7, y: y + 0.08, w: 1.35, h: 0.85, fontSize: 44, bold: true, color: i === 1 ? ACCENT : PRIMARY });
    T(s, r[1], { x: 5.25, y: y + 0.02, w: 7.5, h: 0.55, fontSize: 24, bold: true, color: TEXT });
    T(s, r[2], { x: 5.25, y: y + 0.62, w: 7.5, h: 0.5, fontSize: 14, color: MUTED });
    if (i < 2) s.addShape(pres.shapes.LINE, { x: 3.7, y: y + 1.5, w: 9.1, h: 0, line: { color: "E4DAE4", width: 0.75 } });
  });
  T(s, "Zhongda Group · HR", { x: M, y: 7.1, w: 3.5, h: 0.28, fontSize: 12, color: MUTED });
  T(s, "02 / 12", { x: 11.6, y: 7.1, w: 1.23, h: 0.28, fontSize: 12, color: MUTED, align: "right" });
  s.addNotes("目录页：第一部分看公司，第二部分讲分工，第三部分是三套可落地的模块方案。");
}

/* ============ S3 Company ============ */
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  header(s, "认识中达：产研销一体的美妆电商集团", null, "03");
  T(s, "2014年成立，以电商产业园为载体、以品牌美妆为核心，深耕内容电商12年", { x: M, y: 1.58, w: 12.3, h: 0.4, fontSize: 15, bold: true, color: PRIMARY_DARK });
  const stats = [["2014", "集团成立"], ["10万㎡+", "园区运营总面积"], ["15亿+", "自营年销售额"], ["2000+", "服务数字企业"]];
  stats.forEach((st, i) => {
    const x = M + (i % 2) * 2.72, y = 2.2 + Math.floor(i / 2) * 1.55;
    T(s, st[0], { x, y, w: 2.55, h: 0.75, fontSize: 40, bold: true, color: PRIMARY_DARK });
    T(s, st[1], { x, y: y + 0.82, w: 2.55, h: 0.35, fontSize: 13, color: MUTED });
  });
  const biz = [
    ["中达电商园", "双国家级基地，园区服务的起家盘"],
    ["云创直播小镇", "厦门市重点项目，「短视频+直播」电商板块"],
    ["小树美 × 合拍", "自有美妆品牌：抖音唇油榜TOP1 · 最快年销破3亿国货彩妆"],
    ["潼欣园", "数字传媒星级服务商，信息服务年收入近11亿"],
  ];
  biz.forEach((b, i) => {
    const y = 2.12 + i * 0.87;
    s.addShape(pres.shapes.OVAL, { x: 6.05, y: y + 0.1, w: 0.14, h: 0.14, fill: { color: ACCENT }, line: { type: "none" } });
    T(s, b[0], { x: 6.35, y, w: 6.4, h: 0.36, fontSize: 15.5, bold: true, color: TEXT });
    T(s, b[1], { x: 6.35, y: y + 0.38, w: 6.4, h: 0.36, fontSize: 12.5, color: MUTED });
  });
  card(s, M, 5.6, 12.33, 0.75, PRIMARY, false);
  T(s, "当前阶段：集团化二次增长期 —— 多品牌 × 多平台 × 多地点", { x: M, y: 5.6, w: 12.33, h: 0.75, align: "center", valign: "middle", fontSize: 17, bold: true, color: WHITE });
  T(s, "资料来源：中达集团官网 xmzoda.com（2026年9月）", { x: M, y: 6.55, w: 8, h: 0.3, fontSize: 12, color: MUTED });
  s.addNotes("先对齐公司画像：四大板块、关键数字都来自官网。阶段判断是后面所有HR规划的出发点——公司进入二次增长期，组织要跟上。");
}

/* ============ S4 Current situation ============ */
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  header(s, "当前面对的四个现实", null, "04");
  const cards = [
    { t: "秋招战役已打响", d: "27届校招首批发8个岗位，覆盖厦门、广州、杭州、长沙，Q4是抢人窗口期", f: "抖音运营 · 天猫运营 · 直播运营 · 美妆产品开发…", badge: "8.31 已启动" },
    { t: "人才争夺白热化", d: "抖音美妆红海竞争、头部排位动荡，运营与内容人才高流动，薪酬成长双比价" },
    { t: "管理半径拉长", d: "多品牌 × 多平台 × 4城据点，一线需要「贴身」的HR响应，不能凡事等总部" },
    { t: "队伍年轻 · 用工弹性", d: "直播大促节奏波动大，年轻人看重成长与氛围，保留激励与弹性用工成常态考题" },
  ];
  cards.forEach((c, i) => {
    const x = M + i * 3.22;
    card(s, x, 1.75, 3.0, 4.35, TINT, true);
    T(s, "0" + (i + 1), { x: x + 0.28, y: 2.05, w: 1.2, h: 0.5, fontSize: 26, bold: true, color: PRIMARY });
    T(s, c.t, { x: x + 0.28, y: 2.62, w: 2.5, h: 0.85, fontSize: 19, bold: true, color: TEXT });
    let dy = 3.5;
    if (c.badge) {
      pill(s, c.badge, x + 0.28, 3.42, 1.35, 0.36, { fill: RED, color: WHITE, fontSize: 12 });
      dy = 3.95;
    }
    T(s, c.d, { x: x + 0.28, y: dy, w: 2.48, h: 1.55, fontSize: 13, color: MUTED, lineSpacingMultiple: 1.15 });
    if (c.f) T(s, c.f, { x: x + 0.28, y: 5.5, w: 2.48, h: 0.5, fontSize: 11.5, color: PRIMARY_DARK, bold: true });
  });
  T(s, "注：基于官网及公开信息的分析判断，供管理层讨论", { x: M, y: 6.45, w: 8, h: 0.3, fontSize: 12, color: MUTED });
  s.addNotes("四个现实：秋招已经启动、行业抢人、多据点管理半径、年轻队伍。HR规划就是回答这四件事。");
}

/* ============ S5 Three pillars ============ */
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  header(s, "HR到底干啥的：三支柱分工", null, "05");
  T(s, "上接战略 · 中接业务 · 下接员工 —— HR不是打杂的，是一套分工明确的支撑体系", { x: M, y: 1.52, w: 12.3, h: 0.4, fontSize: 15, bold: true, color: PRIMARY_DARK });
  const pillars = [
    { abbr: "COE", role: "定规则 · 专家中心", duty: ["招聘与绩效标准设计", "薪酬激励方案", "人才发展与晋升体系"], tag: "造武器" },
    { abbr: "HRBP", role: "贴业务 · 业务伙伴", duty: ["驻电商事业部与直播间", "政策落地与执行跟进", "一线声音反馈总部"], tag: "上一线", hot: true },
    { abbr: "SSC", role: "管事务 · 共享服务", duty: ["入离职与员工服务", "社保公积金与考勤", "人事数据与档案"], tag: "管后勤" },
  ];
  pillars.forEach((p, i) => {
    const x = M + i * 4.19;
    card(s, x, 2.05, 3.95, 3.7, TINT, true);
    T(s, p.abbr, { x: x + 0.32, y: 2.32, w: 3.3, h: 0.6, fontSize: 30, bold: true, color: p.hot ? ACCENT : PRIMARY_DARK });
    T(s, p.role, { x: x + 0.32, y: 2.98, w: 3.3, h: 0.35, fontSize: 14, bold: true, color: TEXT });
    s.addShape(pres.shapes.LINE, { x: x + 0.32, y: 3.45, w: 3.3, h: 0, line: { color: "DFD2DF", width: 1 } });
    p.duty.forEach((d, j) => {
      s.addShape(pres.shapes.OVAL, { x: x + 0.34, y: 3.72 + j * 0.5 + 0.07, w: 0.1, h: 0.1, fill: { color: PRIMARY }, line: { type: "none" } });
      T(s, d, { x: x + 0.56, y: 3.72 + j * 0.5, w: 3.15, h: 0.4, fontSize: 13, color: TEXT });
    });
    pill(s, p.tag, x + 0.32, 5.18, 1.3, 0.4, { fill: p.hot ? ACCENT : PRIMARY, color: WHITE, fontSize: 14 });
    if (p.hot) T(s, "本报告重点", { x: x + 1.78, y: 5.18, w: 2, h: 0.4, fontSize: 12, bold: true, color: ACCENT, valign: "middle" });
  });
  T(s, "三支柱协同：让每位员工从入职到成长都有人管、有标准、有回应", { x: M, y: 6.15, w: 12.33, h: 0.4, align: "center", fontSize: 14, bold: true, color: PRIMARY_DARK });
  s.addNotes("回答『HR到底干啥』：COE造武器、HRBP上一线、SSC管后勤。三个支柱各司其职，后面的模块按这套分工展开。");
}

/* ============ S6 Recruitment standards ============ */
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  header(s, "招聘标准：先看价值观，再看能力", "模块一 · 招聘", "06");
  card(s, M, 1.78, 4.55, 2.85, BG_DARK, true);
  T(s, "第一标准", { x: 0.85, y: 2.05, w: 3.9, h: 0.35, fontSize: 14, bold: true, color: PRIMARY });
  T(s, "价值观匹配", { x: 0.85, y: 2.42, w: 3.9, h: 0.6, fontSize: 28, bold: true, color: WHITE });
  T(s, "正道 · 利他 · 真实 · 情义", { x: 0.85, y: 3.1, w: 3.9, h: 0.42, fontSize: 17, bold: true, color: "E3D2E3" });
  T(s, "面试必问 · 背调必查", { x: 0.85, y: 3.58, w: 3.9, h: 0.35, fontSize: 13, color: "C9B3C9" });
  pill(s, "不诚信：一票否决", 0.85, 4.05, 1.9, 0.4, { fill: RED, color: WHITE, fontSize: 13 });
  T(s, "人才画像（官网人才理念）", { x: 5.5, y: 1.8, w: 7, h: 0.35, fontSize: 13, bold: true, color: MUTED });
  const traits = [
    ["锐意进取", "想打胜仗、能扛目标，跟得上大促节奏"],
    ["求真务实", "用数据说话、不玩虚的，结果导向"],
    ["创造力强", "内容与玩法的源头活水，匹配年轻团队"],
  ];
  traits.forEach((t, i) => {
    const y = 2.25 + i * 0.82;
    T(s, t[0], { x: 5.5, y, w: 1.75, h: 0.45, fontSize: 19, bold: true, color: PRIMARY_DARK });
    T(s, t[1], { x: 7.35, y: y + 0.05, w: 5.4, h: 0.4, fontSize: 14, color: TEXT });
    if (i < 2) s.addShape(pres.shapes.LINE, { x: 5.5, y: y + 0.62, w: 7.3, h: 0, line: { color: "E4DAE4", width: 0.75 } });
  });
  const seq = [
    ["业务运营类", "懂数据、懂平台玩法：抖音 / 天猫 / 拼多多"],
    ["品牌运营类", "懂审美、懂内容创意，做出品牌感"],
    ["校招批量化", "潜力＞经验，看文化契合与可塑性"],
  ];
  seq.forEach((q, i) => {
    const x = M + i * 4.19;
    card(s, x, 4.95, 3.95, 1.5, TINT, false);
    T(s, q[0], { x: x + 0.3, y: 5.18, w: 3.4, h: 0.4, fontSize: 16, bold: true, color: TEXT });
    T(s, q[1], { x: x + 0.3, y: 5.62, w: 3.4, h: 0.65, fontSize: 12.5, color: MUTED });
  });
  s.addNotes("招聘标准两层：第一层价值观红线（正道利他真实情义），第二层能力画像。不同序列侧重不同，校招看潜力。");
}

/* ============ S7 Recruitment process ============ */
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  header(s, "招聘流程：社招通用线 + 校招专线", "模块一 · 招聘", "07");
  const steps = [
    ["需求确认", "编制与JD，业务负责人签认"],
    ["寻访候选", "内推 / 平台 / 猎头 / 校招"],
    ["面试评估", "HR面+业务面，2轮闭环"],
    ["Offer审批", "3个工作日内完成"],
    ["入职融入", "背调后入职，导师带教"],
  ];
  steps.forEach((st, i) => {
    const x = M + i * 2.52;
    card(s, x, 1.78, 2.25, 1.8, TINT, true);
    numCircle(s, i + 1, x + 0.26, 1.98, 0.42);
    T(s, st[0], { x: x + 0.26, y: 2.5, w: 1.85, h: 0.38, fontSize: 15.5, bold: true, color: TEXT });
    T(s, st[1], { x: x + 0.26, y: 2.9, w: 1.8, h: 0.6, fontSize: 11.5, color: MUTED });
    if (i < 4) T(s, "▸", { x: x + 2.26, y: 2.5, w: 0.28, h: 0.4, fontSize: 17, color: PRIMARY, align: "center" });
  });
  T(s, "SLA承诺：需求确认48小时内启动 · 面试反馈3个工作日 · Offer审批3个工作日", { x: M, y: 3.78, w: 12.3, h: 0.35, fontSize: 12.5, color: PRIMARY_DARK, bold: true });
  pill(s, "27届校招专线", M, 4.35, 1.7, 0.42, { fill: ACCENT, color: WHITE, fontSize: 14 });
  T(s, "8个岗位 · 4城同步", { x: 2.4, y: 4.35, w: 4, h: 0.42, fontSize: 15, bold: true, color: ACCENT, valign: "middle" });
  s.addShape(pres.shapes.LINE, { x: 1.0, y: 5.42, w: 10.9, h: 0, line: { color: PRIMARY, width: 2 } });
  const tl = [
    ["8月底", "职位发布", true],
    ["9–10月", "宣讲·笔试·面试"],
    ["11月", "发放Offer"],
    ["寒假", "实习见习"],
    ["2027.7", "入职报到"],
    ["入职后", "第7期集训营"],
  ];
  tl.forEach((t, i) => {
    const cx = 1.0 + i * 2.18;
    s.addShape(pres.shapes.OVAL, { x: cx - 0.09, y: 5.33, w: 0.18, h: 0.18, fill: { color: t[2] ? ACCENT : WHITE }, line: { color: t[2] ? ACCENT : PRIMARY, width: 2 } });
    T(s, t[0], { x: cx - 1.0, y: 4.92, w: 2.0, h: 0.32, fontSize: 13, bold: true, color: t[2] ? ACCENT : TEXT, align: "center" });
    T(s, t[1], { x: cx - 1.0, y: 5.62, w: 2.0, h: 0.32, fontSize: 12.5, color: MUTED, align: "center" });
  });
  T(s, "校招集训营已连续举办6期，是中达校招培养的成熟打法", { x: M, y: 6.35, w: 10, h: 0.35, fontSize: 12.5, color: PRIMARY_DARK, bold: true });
  s.addNotes("社招一条线、校招一条线。给管理层的承诺是SLA：48小时启动、3天反馈、3天审批。校招8.31已发布，Q4全力冲刺。");
}

/* ============ S8 Performance philosophy ============ */
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  header(s, "绩效理念：跟着业务节奏走", "模块二 · 绩效", "08");
  const rows = [
    ["对齐业务", "目标跟着GMV与大促节奏走，全员打同一场仗"],
    ["轻形式 · 重反馈", "扁平管理、拒绝繁文缛节，反馈月月有回音"],
    ["激励向一线倾斜", "奖金提成向直播间与运营一线倾斜，多劳多得"],
    ["发展导向", "绩效是成长的镜子，不是年终审判"],
  ];
  rows.forEach((r, i) => {
    const y = 1.95 + i * 1.18;
    T(s, "0" + (i + 1), { x: M, y: y + 0.06, w: 0.85, h: 0.6, fontSize: 30, bold: true, color: PRIMARY });
    T(s, r[0], { x: 1.5, y, w: 3.05, h: 0.5, fontSize: 20, bold: true, color: TEXT });
    T(s, r[1], { x: 1.5, y: y + 0.52, w: 8.2, h: 0.42, fontSize: 14, color: MUTED });
    if (i < 3) s.addShape(pres.shapes.LINE, { x: M, y: y + 1.02, w: 9.2, h: 0, line: { color: "E4DAE4", width: 0.75 } });
  });
  card(s, 10.35, 2.1, 2.48, 3.9, TINT, true);
  T(s, "1–2次/年", { x: 10.55, y: 2.62, w: 2.1, h: 0.6, fontSize: 30, bold: true, color: ACCENT, align: "center" });
  T(s, "晋升述职通道", { x: 10.55, y: 3.32, w: 2.1, h: 0.4, fontSize: 14, bold: true, color: TEXT, align: "center" });
  T(s, "官网承诺的晋升节奏，绩效结果直接挂钩", { x: 10.62, y: 3.8, w: 1.95, h: 0.85, fontSize: 12, color: MUTED, align: "center" });
  pill(s, "事事有回应", 10.75, 5.08, 1.68, 0.42, { fill: PRIMARY, color: WHITE, fontSize: 13 });
  s.addNotes("四条理念：对齐业务、轻形式重反馈、激励向一线、发展导向。扁平年轻团队，绩效要轻但反馈不能少。");
}

/* ============ S9 Performance process ============ */
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  header(s, "绩效流程：五步闭环", "模块二 · 绩效", "09");
  const steps = [
    ["目标设定", "季度目标：OKR对齐 + KPI量化"],
    ["过程跟进", "月度回顾，大促专项复盘"],
    ["评估校准", "自评+上级评，校准会拉齐"],
    ["反馈面谈", "一人一谈，面向成长"],
    ["结果应用", "奖金 / 调薪 / 晋升 / 淘汰"],
  ];
  steps.forEach((st, i) => {
    const x = M + i * 2.52;
    card(s, x, 1.9, 2.25, 2.55, TINT, true);
    numCircle(s, i + 1, x + 0.26, 2.12, 0.42);
    T(s, st[0], { x: x + 0.26, y: 2.68, w: 1.85, h: 0.4, fontSize: 16.5, bold: true, color: TEXT });
    T(s, st[1], { x: x + 0.26, y: 3.12, w: 1.78, h: 1.1, fontSize: 12, color: MUTED, lineSpacingMultiple: 1.15 });
    if (i < 4) T(s, "▸", { x: x + 2.26, y: 2.95, w: 0.28, h: 0.4, fontSize: 17, color: PRIMARY, align: "center" });
  });
  const x1 = M + 2.25 / 2, x5 = M + 4 * 2.52 + 2.25 / 2;
  s.addShape(pres.shapes.LINE, { x: x5, y: 4.5, w: 0, h: 0.45, line: { color: PRIMARY, width: 1.5, dashType: "dash" } });
  s.addShape(pres.shapes.LINE, { x: x1, y: 4.95, w: x5 - x1, h: 0, line: { color: PRIMARY, width: 1.5, dashType: "dash" } });
  s.addShape(pres.shapes.LINE, { x: x1, y: 4.5, w: 0, h: 0.45, line: { color: PRIMARY, width: 1.5, dashType: "dash", beginArrowType: "triangle" } });
  T(s, "进入下一绩效周期", { x: 5.42, y: 5.02, w: 2.5, h: 0.3, fontSize: 12, color: MUTED, align: "center" });
  T(s, "落地节奏", { x: M, y: 5.75, w: 1.4, h: 0.6, fontSize: 15, bold: true, color: TEXT, valign: "middle" });
  const chips = ["10–11月 直播团队试点", "12月 复盘修订 V1.0", "2027年1月 全员推行"];
  chips.forEach((c, i) => {
    card(s, 1.95 + i * 3.62, 5.7, 3.42, 0.7, i === 2 ? PRIMARY : TINT, false);
    T(s, c, { x: 1.95 + i * 3.62, y: 5.7, w: 3.42, h: 0.7, align: "center", valign: "middle", fontSize: 14, bold: true, color: i === 2 ? WHITE : PRIMARY_DARK });
  });
  s.addNotes("绩效五步闭环，每步都有动作和产出。落地节奏：先在直播团队试点（正逢大促季），12月修订，明年1月全员推行。");
}

/* ============ S10 HRBP ============ */
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  header(s, "HRBP：业务身边的HR", "模块三 · HRBP", "10");
  card(s, M, 1.78, 3.6, 3.5, BG_DARK, true);
  T(s, "为什么需要BP", { x: 0.82, y: 2.05, w: 3.0, h: 0.4, fontSize: 17, bold: true, color: WHITE });
  const whys = ["多品牌 × 多平台 × 4城据点", "直播业务：日销 + 大促双节奏", "一线要的是「听得懂业务」的HR"];
  whys.forEach((wy, i) => {
    s.addShape(pres.shapes.OVAL, { x: 0.84, y: 2.72 + i * 0.82 + 0.15, w: 0.1, h: 0.1, fill: { color: ACCENT }, line: { type: "none" } });
    T(s, wy, { x: 1.06, y: 2.72 + i * 0.82, w: 2.95, h: 0.4, fontSize: 13, color: "E8DCE8" });
  });
  const roles = [
    ["战略伙伴", "参与业务规划，提前做人力盘点"],
    ["变革推动者", "新据点落地、组织调整的推动引擎"],
    ["员工支持者", "沟通关怀、留任与劳动关系第一责任"],
    ["流程守护者", "招聘绩效文化在一线落地不走样"],
  ];
  roles.forEach((r, i) => {
    const x = 4.4 + (i % 2) * 4.32, y = 1.78 + Math.floor(i / 2) * 1.85;
    card(s, x, y, 4.1, 1.65, TINT, true);
    T(s, r[0], { x: x + 0.3, y: y + 0.22, w: 3.5, h: 0.42, fontSize: 17, bold: true, color: PRIMARY_DARK });
    T(s, r[1], { x: x + 0.3, y: y + 0.68, w: 3.55, h: 0.75, fontSize: 13, color: TEXT });
  });
  T(s, "上岗标准", { x: M, y: 5.55, w: 1.4, h: 0.45, fontSize: 15, bold: true, color: TEXT, valign: "middle" });
  const std = [["懂业务", "看得懂GMV·ROI·投放"], ["懂人心", "听得了真话"], ["懂专业", "模块功底扎实"]];
  std.forEach((d, i) => {
    const x = 1.95 + i * 3.62;
    pill(s, d[0] + " · " + d[1], x, 5.52, 3.42, 0.5, { fontSize: 13 });
  });
  T(s, "日常动作：周业务会必到 · 月度人才盘点 · 季度员工访谈全覆盖", { x: M, y: 6.3, w: 11, h: 0.35, fontSize: 13, bold: true, color: PRIMARY_DARK });
  s.addNotes("BP的定位：不做二传手，做业务身边的HR。四大角色对应四类日常动作，上岗有三条硬标准。");
}

/* ============ S11 Roadmap ============ */
{
  const s = pres.addSlide();
  s.background = { color: WHITE };
  header(s, "推进节奏：三步走", null, "11");
  const phases = [
    { q: "2026 Q4", theme: "打胜仗", items: ["27届校招冲刺：宣讲 · 笔面 · Offer", "大促季绩效试点（直播团队）", "4城据点HRBP全部到岗"], hot: true },
    { q: "2027 Q1", theme: "立规矩", items: ["招聘标准手册发布", "绩效方案V1.0全员推行", "SSC一站式员工服务上线"] },
    { q: "2027 Q2起", theme: "成体系", items: ["BP驻场4城全覆盖", "人才盘点 + 晋升述职跑通", "校招集训营第7期开营"] },
  ];
  phases.forEach((p, i) => {
    const x = M + i * 4.19;
    card(s, x, 1.95, 3.95, 4.15, TINT, true);
    pill(s, p.q, x + 0.32, 2.25, 1.7, 0.44, { fill: p.hot ? ACCENT : PRIMARY, color: WHITE, fontSize: 14 });
    T(s, p.theme, { x: x + 0.32, y: 2.85, w: 3.3, h: 0.62, fontSize: 26, bold: true, color: TEXT });
    p.items.forEach((it, j) => {
      s.addShape(pres.shapes.OVAL, { x: x + 0.34, y: 3.72 + j * 0.72 + 0.15, w: 0.1, h: 0.1, fill: { color: p.hot ? ACCENT : PRIMARY }, line: { type: "none" } });
      T(s, it, { x: x + 0.56, y: 3.72 + j * 0.72, w: 3.2, h: 0.4, fontSize: 13, color: TEXT });
    });
    if (i < 2) T(s, "▸", { x: x + 3.95, y: 3.7, w: 0.26, h: 0.5, fontSize: 20, color: PRIMARY, align: "center" });
  });
  T(s, "先打仗、再建制、后成体系——每一步都有可验收的交付物", { x: M, y: 6.45, w: 11, h: 0.4, fontSize: 14, bold: true, color: PRIMARY_DARK });
  s.addNotes("三步走：Q4先打赢秋招和大促两场仗，Q1把制度和标准立起来，Q2起形成完整体系。每阶段都有交付物可验收。");
}

/* ============ S12 Closing ============ */
{
  const s = pres.addSlide();
  s.background = { color: BG_DARK };
  deco(s);
  T(s, "成就幸福中达", { x: 0.5, y: 2.5, w: 12.33, h: 1.0, fontSize: 54, bold: true, color: WHITE, align: "center" });
  T(s, "Achieve Happiness in Zhongda", { x: 0.5, y: 3.6, w: 12.33, h: 0.45, fontSize: 16, color: "C9B3C9", align: "center", charSpacing: 2 });
  const vs = ["正道", "利他", "真实", "情义"];
  vs.forEach((v, i) => {
    pill(s, v, 4.02 + i * 1.42, 4.5, 1.18, 0.52, { fill: "5A4368", color: "E8D8E8", fontSize: 16 });
  });
  T(s, "厦门中达集团 人力资源部 · 2026年9月", { x: 0.5, y: 6.55, w: 12.33, h: 0.4, fontSize: 13, color: "B9A3C4", align: "center" });
  s.addNotes("收尾：HR的所有工作最终指向一句话——成就幸福中达。谢谢，欢迎讨论。");
}

pres.writeFile({ fileName: "hr_plan.pptx" }).then(() => {
  const cn = Buffer.from([0xe4, 0xb8, 0xad, 0xe8, 0xbe, 0xbe, 0xe9, 0x9b, 0x86, 0xe5, 0x9b, 0xa2]).toString("utf8");
  const name = cn + "HR" + Buffer.from([0xe9, 0x83, 0xa8, 0xe9, 0x97, 0xa8, 0xe8, 0xa7, 0x84, 0xe5, 0x88, 0x92]).toString("utf8") + ".pptx";
  fs.copyFileSync("hr_plan.pptx", name);
  console.log("DONE slides=12 file=" + name);
});
