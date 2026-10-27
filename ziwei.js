/* ===== El Taller — 紫微斗数引擎（本命盘 + 流月/流周/流日运势）=====
 * 作者：liyanjun
 *
 * 口径（通行主流，均已在测试中与基准逐项核对）：
 *   · 换年：正月初一换农历年（非立春）
 *   · 闰月：前 15 日归本月、第 16 日起归下月（闰腊月后半入次年正月）
 *   · 时辰：0-11 索引（子…亥），子时含早晚子、不换日
 *   · 四化：通行十干四化表（庚：太阳禄·武曲权·太阴科·天同忌）
 *   · 大限：阳男阴女顺行（命宫支 +k），起运岁 = 五行局数，童限走
 *     「一命二财三疾厄四夫妻五福德六官禄」
 *   · 斗君：生年支宫起正月逆数至生月、再顺数至生时；流月宫 = 流年斗君
 *     起正月顺数；流日宫 = 流月宫起初一顺数农历日
 *
 * 实现：依传统安星规则独立重写，无第三方依赖、无框架，浏览器与 Node 双端
 *       可用（UMD）。农历数据表由 tools/build-lunar-table.js 离线生成。
 * 声明：历法为事实性天文数据；安星规则为传统术数公共算法；本文件为独立实现。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ZW = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ════════════════ ① 历法层 ════════════════ */

  var STEM = '甲乙丙丁戊己庚辛壬癸';
  var BRANCH = '子丑寅卯辰巳午未申酉戌亥';
  var LUNAR_WORDS = '5b4a1e1d48313a942659295c192c2e2a6c2255591815a82b2d64205d48951d48286c959d2c9430292c2452ad590ab42c15ac212da49636a4297649df3a483234942669355b29582e0ad82356d5171b502b3aa4207a48963a482834999d14ac2f295c244ad9592d682c1b50223b24d71d24295a4dde2a4c3114ac26296d9a2ab42d15a8236d55182e902b2d24206a4c952a542854b5dc14d82f2ab42456a95a16c82c3694217528d735282a2a561e2a5c301558262ad59b2b542d1b48233a95183a942b192820325cd42a6c275569dd15a82f2da4245d495a2d482d2c9421592d16292c2952ae1e0ab43015b4252da59b36a42e36482374951834942b6936a02958320ad82716d59c1b542f3aa4247a495a3a482d3498222958d6295c28535a1e0d68311b54255b255b1d242e1a4c2354ad1714ac2a296c1f55689515a8276d55dc2e90302d24256a4d592a542c14b4212ab5162ad42856aa5e17483136942675299b35282e32542354b91815582a2ad41f56c8951b48283a959c1c942f192c24325d5932ac2b1568212b58d62da4295d4ade2d48312c9426692d9b292c2d12ac22156d5716b42a2da81f6d48953648287495dd34942f29542452b55912d82c16d42036a8d63b24297a4a1f3a483134982629599b295c2d1358221b55171d542a1d24203a4cd41a4c2754addc14ac2f296c2355695915a82c2d94215d29162d28296a561e2a543114b4252ab59a2ad42d16a8232e951736942a3528207254d53258276539dc15582f2ad42456c9591b482c3a94213929171a2c28325e1d12ac30156c252b599a2da82d1d48235c95182d142a2a2c1f526c9412ac27';
  var LUNAR_Y0 = 1900, LUNAR_Y1 = 2100;
  // 日柱锚点：2000-01-01 = 戊午日（日干支为连续循环，与换年无关）
  var GZ_ANCHOR = { jdn: 2451545, stem: 4, branch: 6 };

  function toJDN(y, m, d) {
    var a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
    return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
  }
  function fromJDN(j) {
    var a = j + 32044, b = Math.floor((4 * a + 3) / 146097), c = a - Math.floor(146097 * b / 4);
    var d2 = Math.floor((4 * c + 3) / 1461), e = c - Math.floor(1461 * d2 / 4);
    var mm = Math.floor((5 * e + 2) / 153);
    return {
      d: e - Math.floor((153 * mm + 2) / 5) + 1,
      m: mm + 3 - 12 * Math.floor(mm / 10),
      y: 100 * b + d2 - 4800 + Math.floor(mm / 10)
    };
  }
  function validSolar(y, m, d) {
    var t = fromJDN(toJDN(y, m, d));
    return t.y === y && t.m === m && t.d === d;
  }

  // 惰性解包：每年 → {ny: 正月初一 JDN, leap: 闰月号, months: [{m, leap, days}] }
  var YEARS = null;
  function lunarYears() {
    if (YEARS) return YEARS;
    YEARS = [];
    for (var i = 0; i <= LUNAR_Y1 - LUNAR_Y0; i++) {
      var w = parseInt(LUNAR_WORDS.substr(i * 6, 6), 16);
      var nyOff = w & 63, leap = (w >> 6) & 15, sizeBits = (w >> 10) & 0x1fff;
      var ny = fromJDN(toJDN(LUNAR_Y0 + i, 1, 1) + nyOff);
      var months = [], k = 0;
      for (var m = 1; m <= 12; m++) {
        months.push({ m: m, leap: false, days: (sizeBits >> k) & 1 ? 30 : 29 });
        k++;
        if (m === leap) { months.push({ m: m, leap: true, days: (sizeBits >> k) & 1 ? 30 : 29 }); k++; }
      }
      YEARS.push({ y: LUNAR_Y0 + i, nyJdn: toJDN(ny.y, ny.m, ny.d), leap: leap, months: months });
    }
    return YEARS;
  }
  function yearAt(ly) {
    var ys = lunarYears();
    if (ly < LUNAR_Y0 || ly > LUNAR_Y1) return null;
    return ys[ly - LUNAR_Y0];
  }

  /** 公历 → 农历原始（闰月带 leap 标记，不做归月）。越界返回 null。 */
  function solarToLunar(y, m, d) {
    if (!validSolar(y, m, d)) return null;
    var j = toJDN(y, m, d);
    // 定位农历年：正月初一 <= j < 次年正月初一
    var ly = y >= LUNAR_Y1 ? LUNAR_Y1 : y; // 起猜
    var yr = yearAt(ly), ny = yr ? yr.nyJdn : 0;
    if (!yr || j < ny) { ly -= 1; yr = yearAt(ly); ny = yr ? yr.nyJdn : 0; }
    while (yr && j >= ny) { var nxt = yearAt(ly + 1); if (!nxt) break; if (j < nxt.nyJdn) break; ly += 1; yr = nxt; ny = nxt.nyJdn; }
    if (!yr || j < ny || ly < LUNAR_Y0) return null;
    var off = j - ny, acc = 0;
    for (var i = 0; i < yr.months.length; i++) {
      var mm = yr.months[i];
      if (off < acc + mm.days) return { y: ly, m: mm.m, leap: mm.leap, d: off - acc + 1 };
      acc += mm.days;
    }
    return null; // 表内不一致（不应发生）
  }

  /** 农历（可带闰月）→ 公历。非法返回 null。 */
  function lunarToSolar(ly, m, d, isLeap) {
    var yr = yearAt(ly);
    if (!yr || d < 1) return null;
    var acc = 0;
    for (var i = 0; i < yr.months.length; i++) {
      var mm = yr.months[i];
      if (mm.m === m && mm.leap === !!isLeap) {
        if (d > mm.days) return null;
        var t = fromJDN(yr.nyJdn + acc + d - 1);
        return { y: t.y, m: t.m, d: t.d };
      }
      acc += mm.days;
    }
    return null;
  }

  /** 日干支（连续循环）。返回 {stem, branch} 索引。 */
  function dayGZ(y, m, d) {
    var n = (toJDN(y, m, d) - GZ_ANCHOR.jdn) % 60;
    if (n < 0) n += 60;
    return { stem: (GZ_ANCHOR.stem + n) % 10, branch: (GZ_ANCHOR.branch + n) % 12 };
  }

  /** 农历年干支（正月初一换年）。ly 为农历年号。 */
  function yearGZ(ly) {
    var n = ly - 4;
    return { stem: ((n % 10) + 10) % 10, branch: ((n % 12) + 12) % 12 };
  }

  /** 五虎遁：年干 → 寅宫天干。 */
  function yinStemOf(yearStem) { return [2, 4, 6, 8, 0][yearStem % 5]; }

  /* ════════════════ ② 安星层 ════════════════ */

  var SI_HUA = [           // 十干四化 [禄, 权, 科, 忌]（星名索引见 MAJOR_IDX）
    ['廉贞', '破军', '武曲', '太阳'],  // 甲
    ['天机', '天梁', '紫微', '太阴'],  // 乙
    ['天同', '天机', '文昌', '廉贞'],  // 丙
    ['太阴', '天同', '天机', '巨门'],  // 丁
    ['贪狼', '太阴', '右弼', '天机'],  // 戊
    ['武曲', '贪狼', '天梁', '文曲'],  // 己
    ['太阳', '武曲', '太阴', '天同'],  // 庚
    ['巨门', '太阳', '文曲', '文昌'],  // 辛
    ['天梁', '紫微', '左辅', '武曲'],  // 壬
    ['破军', '巨门', '太阴', '贪狼']   // 癸
  ];
  var SI_NAME = ['禄', '权', '科', '忌'];
  var KUIYUE = [[1, 7], [0, 8], [11, 9], [11, 9], [1, 7], [0, 8], [1, 7], [6, 2], [3, 5], [3, 5]];
  var LUCUN = [2, 3, 5, 6, 5, 6, 8, 9, 11, 0];
  // 年支三合 → 天马 / 火星铃星起点
  var MA_GROUP = { 0: 0, 4: 0, 8: 0, 2: 1, 6: 1, 10: 1, 1: 2, 5: 2, 9: 2, 3: 3, 7: 3, 11: 3 };
  var TIANMA = [2, 8, 11, 5];        // 组序：申子辰→寅, 寅午戌→申, 巳酉丑→亥, 亥卯未→巳
  var HUO_LING = [[2, 10], [1, 3], [3, 10], [9, 10]]; // [火起点, 铃起点]
  // 紫微系逆行偏移 / 天府系顺行偏移
  var ZI_GROUP = [['天机', 1], ['太阳', 3], ['武曲', 4], ['天同', 5], ['廉贞', 8]]; // 相对紫微逆行
  var FU_GROUP = [['太阴', 1], ['贪狼', 2], ['巨门', 3], ['天相', 4], ['天梁', 5], ['七杀', 6], ['破军', 10]]; // 相对天府顺行
  var PALACE_CCW = ['命宫', '兄弟', '夫妻', '子女', '财帛', '疾厄', '迁移', '交友', '官禄', '田宅', '福德', '父母'];
  var MING_ZHU = ['贪狼', '巨门', '禄存', '文曲', '廉贞', '武曲', '破军', '武曲', '廉贞', '文曲', '禄存', '巨门'];
  var SHEN_ZHU = ['火星', '天相', '天梁', '天同', '文昌', '天机', '火星', '天相', '天梁', '天同', '文昌', '天机'];
  var STAR_TYPE = {};
  ['紫微', '天机', '太阳', '武曲', '天同', '廉贞', '天府', '太阴', '贪狼', '巨门', '天相', '天梁', '七杀', '破军'].forEach(function (s) { STAR_TYPE[s] = 'major'; });
  ['左辅', '右弼', '文昌', '文曲', '天魁', '天钺', '禄存', '天马', '红鸾', '天喜'].forEach(function (s) { STAR_TYPE[s] = 'lucky'; });
  ['擎羊', '陀罗', '火星', '铃星', '地空', '地劫', '天刑', '天姚'].forEach(function (s) { STAR_TYPE[s] = 'sha'; });
  var JU_NAME = { 2: '水二局', 3: '木三局', 4: '金四局', 5: '土五局', 6: '火六局' };

  function mod12(n) { return ((n % 12) + 12) % 12; }
  function mod10(n) { return ((n % 10) + 10) % 10; }

  /** 纳音五行局：命宫干支 → 局数（口诀：干支取数相加，多减五，木金水火土 → 三四二六五）。 */
  function juOf(stem, branch) {
    var s = Math.floor(stem / 2) + 1 + Math.floor(mod12(branch) % 6 / 2) + 1;
    while (s > 5) s -= 5;
    return [0, 3, 4, 2, 6, 5][s];
  }

  /** 紫微定位（寅起进商格，借数偶顺奇逆）。返回紫微支索引。 */
  function ziweiBranch(day, ju) {
    var o = 0, q;
    while ((day + o) % ju !== 0) o++;
    q = Math.floor((day + o) / ju) % 12;
    var frame = q - 1 + (o % 2 === 0 ? o : -o); // 寅=0 框架
    return mod12(frame + 2);
  }

  /**
   * 本命盘。birth = {y,m,d, hour(0-11), gender('男'|'女')} 公历。
   * 闰月口径：前 15 日归本月、16 日起归下月。
   */
  function natal(birth) {
    if (!birth || birth.hour < 0 || birth.hour > 11) throw new Error('时辰须为 0-11');
    if (birth.gender !== '男' && birth.gender !== '女') throw new Error('性别须为 男/女');
    var raw = solarToLunar(birth.y, birth.m, birth.d);
    if (!raw) throw new Error('公历日期不存在或超出 1900-2100 农历表');

    // 闰月归月（split）
    var ly = raw.y, lm = raw.m, leap = false;
    if (raw.leap && raw.d > 15) {
      lm += 1; leap = false;
      if (lm > 12) { lm = 1; ly += 1; }
    }

    var yGZ = yearGZ(ly);                       // 年干支（随归月跨年推进）
    var hour = birth.hour;

    // 命宫身宫：寅起正月顺数至生月，逆/顺数生时
    var ming = mod12(2 + (lm - 1) - hour);
    var shen = mod12(2 + (lm - 1) + hour);

    // 宫干：五虎遁起寅
    var yinStem = yinStemOf(yGZ.stem);
    var stemAt = function (b) { return mod10(yinStem + mod12(b - 2)); };

    // 五行局（命宫干支纳音）
    var ju = juOf(stemAt(ming), ming);

    // 安星：palaces[branch] = {stars:[name...]}
    var palaces = [];
    for (var b = 0; b < 12; b++) palaces.push({ branch: b, stem: stemAt(b), name: PALACE_CCW[mod12(ming - b)], stars: [], daXian: null });
    function put(b, name) { palaces[mod12(b)].stars.push({ name: name, type: STAR_TYPE[name] || 'minor', sihua: null }); }

    // 十四主星
    var zw = ziweiBranch(raw.d, ju);            // 紫微按原始农历日
    var tf = mod12(4 - zw);
    put(zw, '紫微');
    ZI_GROUP.forEach(function (g) { put(mod12(zw - g[1]), g[0]); });
    put(tf, '天府');
    FU_GROUP.forEach(function (g) { put(mod12(tf + g[1]), g[0]); });

    // 月系：左辅右弼（辰起正月顺 / 戌起正月逆）、天刑天姚（酉/丑起正月顺）
    put(4 + (lm - 1), '左辅'); put(10 - (lm - 1), '右弼');
    put(9 + (lm - 1), '天刑'); put(1 + (lm - 1), '天姚');
    // 时系：文昌文曲（戌起子时逆 / 辰起子时顺）、地空地劫（亥起子时空逆/劫顺）
    put(10 - hour, '文昌'); put(4 + hour, '文曲');
    put(11 - hour, '地空'); put(11 + hour, '地劫');
    // 年干系：魁钺、禄存、羊陀（夹禄）
    put(KUIYUE[yGZ.stem][0], '天魁'); put(KUIYUE[yGZ.stem][1], '天钺');
    var lu = LUCUN[yGZ.stem];
    put(lu, '禄存'); put(lu + 1, '擎羊'); put(lu - 1, '陀罗');
    // 年支系：天马、火铃（三合定起点 + 时辰顺数）、红鸾天喜（卯起年支逆，对宫天喜）
    var grp = MA_GROUP[yGZ.branch];
    put(TIANMA[grp], '天马');
    put(HUO_LING[grp][0] + hour, '火星'); put(HUO_LING[grp][1] + hour, '铃星');
    put(3 - yGZ.branch, '红鸾'); put(9 - yGZ.branch, '天喜');

    // 生年四化标记
    var sihuaMap = {};
    SI_HUA[yGZ.stem].forEach(function (star, i) { sihuaMap[star] = SI_NAME[i]; });
    palaces.forEach(function (p) { p.stars.forEach(function (s) { if (sihuaMap[s.name]) s.sihua = sihuaMap[s.name]; }); });

    // 大限：阳男阴女顺行（命宫 +k），起运 = 局数
    var forward = (yGZ.stem % 2 === 0) === (birth.gender === '男');
    for (var k = 0; k < 12; k++) {
      var pb = mod12(ming + (forward ? k : -k));
      palaces[pb].daXian = [ju + 10 * k, ju + 10 * k + 9];
    }

    // 童限宫序列（起运前虚岁 1..ju-1）：一命二财三疾厄四夫妻五福德六官禄
    var CCW_IDX = { '命宫': 0, '财帛': 4, '疾厄': 5, '夫妻': 2, '福德': 10, '官禄': 8 };
    var childhood = ['命宫', '财帛', '疾厄', '夫妻', '福德', '官禄'].slice(0, ju - 1).map(function (n) {
      return mod12(ming - CCW_IDX[n]);
    });

    return {
      birth: { y: birth.y, m: birth.m, d: birth.d, hour: hour, gender: birth.gender },
      rawLunar: raw,                    // 原始农历（含闰月标记）
      lunar: { y: ly, m: lm, leap: leap, d: raw.d },
      yearStem: yGZ.stem, yearBranch: yGZ.branch,
      ming: ming, shen: shen, ju: ju, juName: JU_NAME[ju],
      mingZhu: MING_ZHU[ming], shenZhu: SHEN_ZHU[shen],
      yinYang: (yGZ.stem % 2 === 0 ? '阳' : '阴') + birth.gender,
      forward: forward, doujun: mod12(yGZ.branch - (lm - 1) + hour), // 本命斗君
      palaces: palaces, childhood: childhood
    };
  }

  /* ════════════════ ③ 运限层 ════════════════ */

  /** 解析 'YYYY-MM-DD'。 */
  function parseDate(s) {
    var t = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s || '');
    if (!t) return null;
    var y = +t[1], m = +t[2], d = +t[3];
    return validSolar(y, m, d) ? { y: y, m: m, d: d } : null;
  }

  /**
   * 某公历日的运限上下文（流年/流月/流日 + 挂靠大限）。
   * 返回 null 表示日期越界。
   */
  function flowOf(chart, y, m, d) {
    var raw = solarToLunar(y, m, d);
    if (!raw) return null;
    var ly = raw.y, mEff = raw.m, mRolled = false;
    if (raw.leap && raw.d > 15) { mEff += 1; if (mEff > 12) { mEff = 1; ly += 1; mRolled = true; } }
    var yGZ = yearGZ(raw.y);                    // 流年干支按日期所在农历年（闰腊月后半亦然）
    var yGZStemForMonth = mRolled ? yearGZ(ly).stem : yGZ.stem; // 流月干在闰腊月后半用次年干
    // 虚岁与挂靠大限/童限
    var age = raw.y - chart.lunar.y + 1;
    var dxPalace = -1, dxRange = null, isChildhood = false;
    for (var i = 0; i < 12; i++) {
      var p = chart.palaces[i];
      if (p.daXian && age >= p.daXian[0] && age <= p.daXian[1]) { dxPalace = i; dxRange = p.daXian; break; }
    }
    if (dxPalace < 0 && age >= 1 && age <= chart.childhood.length) {
      dxPalace = chart.childhood[age - 1]; isChildhood = true;
    }
    // 流月宫：流年支 − 生月 + 生时 + 当月（与「流年斗君起正月顺数」等价）
    var birthM = chart.lunar.m;
    var yuePalace = mod12(yGZ.branch - birthM + chart.birth.hour + mEff);
    // 流日宫：流月宫起初一顺数
    var riPalace = mod12(yuePalace + raw.d - 1);
    // 流月天干（五虎遁）
    var yueStem = mod10(yinStemOf(yGZStemForMonth) + mEff - 1);
    // 流日天干（日柱连续干支）
    var dGZ = dayGZ(y, m, d);
    return {
      solar: { y: y, m: m, d: d },
      lunar: raw, mEff: mEff,
      age: age, dxPalace: dxPalace, dxRange: dxRange, isChildhood: isChildhood,
      yearGZ: yGZ,
      yuePalace: yuePalace, riPalace: riPalace,
      yueStem: yueStem, dayStem: dGZ.stem,
      yueSihua: SI_HUA[yueStem], riSihua: SI_HUA[dGZ.stem]
    };
  }

  /* ════════════════ ④ 解读层 ════════════════
   * 规则表驱动、确定性输出：四化落宫 → 四领域加权得分 + 逐行提示 + 宜忌。
   */

  var DOMAIN_NAME = { career: '事业', wealth: '财运', love: '感情', health: '健康' };
  var DOMAINS = ['career', 'wealth', 'love', 'health'];
  var SI_NAME_L = ['禄', '权', '科', '忌'];
  var SI_NAME = SI_NAME_L; // 安星层四化标记共用
  // 十二宫 → 领域权重（首项为主领域）
  var PALACE_DOMAIN = {
    '命宫': [['career', .5], ['wealth', .5], ['love', .5], ['health', .5]],
    '兄弟': [['career', .5]],
    '夫妻': [['love', 1]],
    '子女': [['love', .5]],
    '财帛': [['wealth', 1]],
    '疾厄': [['health', 1]],
    '迁移': [['career', 1]],
    '交友': [['career', .5]],
    '官禄': [['career', 1]],
    '田宅': [['wealth', 1]],
    '福德': [['love', .5], ['health', .5]],
    '父母': [['health', .5], ['career', .5]]
  };
  var SI_WEIGHT = { '禄': 2, '权': 1, '科': 1, '忌': -2 };
  // 宫位事项词 × 四化动作词 → 逐行提示
  var PALACE_NOUN = {
    '命宫': '自身状态', '兄弟': '同侪协作', '夫妻': '感情伴侣', '子女': '家庭亲子',
    '财帛': '钱财进出', '疾厄': '身体情绪', '迁移': '外出变动', '交友': '人际应酬',
    '官禄': '事业职务', '田宅': '家宅资产', '福德': '心神享受', '父母': '长辈文书'
  };
  var SI_VERB = { '禄': '得利顺遂，宜进取收成', '权': '主动权在握，宜果断拍板', '科': '有贵人文书之助，宜沟通学习', '忌': '易有波折劳心，宜守不宜攻' };
  var SI_ACTION = { '禄': '顺遂进财', '权': '掌权发力', '科': '名声文书', '忌': '波折劳心' };
  // 流日命宫落本命何宫 → 当日基调
  var RI_THEME = {
    '命宫': '气场归位，做自己主场的日子', '兄弟': '协作往来多，宜借力同侪',
    '夫妻': '重心在感情伴侣，宜陪伴沟通', '子女': '亲子家庭事务上桌',
    '财帛': '钱财事务当令，宜理账核数', '疾厄': '身体发出信号，宜休整养神',
    '迁移': '宜动不宜静，外出有得', '交友': '人际应酬聚拢，宜走动',
    '官禄': '事业职务当令，宜攻坚正事', '田宅': '家宅资产事宜当令',
    '福德': '心神享受当令，宜犒赏自己', '父母': '长辈文书之事，宜问候办证'
  };
  var STAR_MOOD = {
    '紫微': '尊贵稳重', '天机': '机变谋略', '太阳': '外放博爱', '武曲': '刚毅决断',
    '天同': '安逸随缘', '廉贞': '规范情感', '天府': '守成积储', '太阴': '细腻内敛',
    '贪狼': '欲望才艺', '巨门': '口舌思辨', '天相': '辅佐协调', '天梁': '荫庇化解',
    '七杀': '开创肃杀', '破军': '破立变动', '文昌': '文书才思', '文曲': '才艺表达',
    '左辅': '得力辅佐', '右弼': '贵人相助', '天魁': '长辈提携', '天钺': '贵人暗助',
    '禄存': '稳财守成', '天马': '奔走变动', '红鸾': '喜庆桃花', '天喜': '喜事临门',
    '擎羊': '刑伤刀锋', '陀罗': '拖延纠缠', '火星': '急躁冲动', '铃星': '阴损暗耗',
    '地空': '落空灵感', '地劫': '劫耗破财', '天刑': '法度刑伤', '天姚': '桃花魅惑'
  };

  /** 把某层四化（[禄,权,科,忌]星名）落到本命宫位上，产出行明细与四领域得分。 */
  function landSihua(chart, sihua) {
    var rows = [], score = { career: 0, wealth: 0, love: 0, health: 0 };
    var palOf = {};
    chart.palaces.forEach(function (p) { p.stars.forEach(function (s) { palOf[s.name] = p; }); });
    sihua.forEach(function (star, i) {
      var si = SI_NAME_L[i], p = palOf[star];
      if (!p) return;
      (PALACE_DOMAIN[p.name] || []).forEach(function (dw) {
        score[dw[0]] += SI_WEIGHT[si] * dw[1];
      });
      rows.push({
        star: star, si: si, palace: p.name,
        text: '化' + si + '入' + p.name + '：' + PALACE_NOUN[p.name] + SI_VERB[si] +
              '（' + STAR_MOOD[star] + '）'
      });
    });
    return { rows: rows, score: score };
  }

  function clampStars(v) { // 得分 → 1..5 星
    if (v >= 3) return 5; if (v >= 1.5) return 4; if (v >= 0.5) return 3;
    if (v > -1.5) return 2; return 1;
  }
  function domainRank(score) { // 降序排领域
    return DOMAINS.slice().sort(function (a, b) { return score[b] - score[a]; });
  }

  /** 单日运势。dateStr = 'YYYY-MM-DD'。 */
  function daily(chart, dateStr) {
    var dt = parseDate(dateStr);
    if (!dt) throw new Error('日期格式应为 YYYY-MM-DD');
    var f = flowOf(chart, dt.y, dt.m, dt.d);
    if (!f) return null;
    var land = landSihua(chart, f.riSihua);
    var yueLand = landSihua(chart, f.yueSihua);
    var total = 0, cnt = 0;
    DOMAINS.forEach(function (k) { total += land.score[k]; cnt++; });
    var rank = domainRank(land.score);
    var riPalaceName = chart.palaces[f.riPalace].name;
    var dxName = f.dxPalace >= 0 ? chart.palaces[f.dxPalace].name : null;
    return {
      date: dateStr, lunar: f.lunar, mEff: f.mEff,
      age: f.age, dxPalace: f.dxPalace, dxName: dxName, dxRange: f.dxRange, isChildhood: f.isChildhood,
      yuePalace: f.yuePalace, riPalace: f.riPalace, riPalaceName: riPalaceName,
      riTheme: RI_THEME[riPalaceName] || '',
      riSihua: f.riSihua, yueSihua: f.yueSihua, yueStem: f.yueStem, dayStem: f.dayStem,
      rows: land.rows, score: land.score, yueScore: yueLand.score,
      stars: {
        career: clampStars(land.score.career), wealth: clampStars(land.score.wealth),
        love: clampStars(land.score.love), health: clampStars(land.score.health)
      },
      overall: clampStars(total / cnt),
      best: rank[0], worst: rank[3],
      advice: '宜' + DOMAIN_NAME[rank[0]] + ' · 慎' + DOMAIN_NAME[rank[3]]
    };
  }

  /** 一周（周一起 7 天）聚合。mondayStr 为周一日期。 */
  function week(chart, mondayStr) {
    var dt = parseDate(mondayStr);
    if (!dt) throw new Error('日期格式应为 YYYY-MM-DD');
    var j = toJDN(dt.y, dt.m, dt.d), days = [], sum = { career: 0, wealth: 0, love: 0, health: 0 };
    for (var i = 0; i < 7; i++) {
      var t = fromJDN(j + i);
      var d = daily(chart, t.y + '-' + pad2(t.m) + '-' + pad2(t.d));
      if (!d) continue;
      days.push(d);
      DOMAINS.forEach(function (k) { sum[k] += d.score[k]; });
    }
    var n = days.length || 1;
    var best = null, worst = null;
    days.forEach(function (d) {
      if (!best || d.overall > best.overall) best = d;
      if (!worst || d.overall < worst.overall) worst = d;
    });
    var rank = domainRank(sum);
    return {
      monday: mondayStr, days: days,
      score: { career: sum.career / n, wealth: sum.wealth / n, love: sum.love / n, health: sum.health / n },
      stars: {
        career: clampStars(sum.career / n), wealth: clampStars(sum.wealth / n),
        love: clampStars(sum.love / n), health: clampStars(sum.health / n)
      },
      best: best, worst: worst,
      advice: '本周宜' + DOMAIN_NAME[rank[0]] + ' · 慎' + DOMAIN_NAME[rank[3]]
    };
  }

  /** 月视图：某公历月 42 格（周一网格），每格带运势星级；附流月主题。 */
  function monthGrid(chart, year, month) {
    var first = parseDate(year + '-' + pad2(month) + '-01');
    if (!first) throw new Error('月份非法');
    var offset = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7; // 周一为 0
    var startJ = toJDN(year, month, 1) - offset;
    var cells = [];
    for (var i = 0; i < 42; i++) {
      var t = fromJDN(startJ + i);
      var inMonth = t.m === month && t.y === year;
      var d = null;
      try { d = daily(chart, t.y + '-' + pad2(t.m) + '-' + pad2(t.d)); } catch (e) { d = null; }
      cells.push({
        y: t.y, m: t.m, d: t.d, inMonth: inMonth,
        overall: d ? d.overall : null, score: d ? d.score : null,
        sihua: d ? d.riSihua : null, lunar: d ? d.lunar : null
      });
    }
    // 流月主题：取当月 15 号所在流月
    var mid = daily(chart, year + '-' + pad2(month) + '-15');
    var theme = null;
    if (mid) {
      var yl = landSihua(chart, mid.yueSihua);
      var yueName = chart.palaces[mid.yuePalace].name;
      var yr = domainRank(yl.score);
      theme = {
        mEff: mid.mEff, yueStem: mid.yueStem, yuePalace: mid.yuePalace, yuePalaceName: yueName,
        sihua: mid.yueSihua, rows: yl.rows, score: yl.score,
        stars: {
          career: clampStars(yl.score.career), wealth: clampStars(yl.score.wealth),
          love: clampStars(yl.score.love), health: clampStars(yl.score.health)
        },
        advice: '本月宜' + DOMAIN_NAME[yr[0]] + ' · 慎' + DOMAIN_NAME[yr[3]]
      };
    }
    return { year: year, month: month, cells: cells, theme: theme };
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* ════════════════ 对外 API ════════════════ */
  return {
    version: '1.0.0',
    natal: natal,
    daily: daily,
    week: week,
    monthGrid: monthGrid,
    flowOf: flowOf,
    solarToLunar: solarToLunar,
    lunarToSolar: lunarToSolar,
    dayGZ: dayGZ,
    yearGZ: yearGZ,
    ziweiBranch: ziweiBranch,
    juOf: juOf,
    STEM: STEM, BRANCH: BRANCH,
    PALACE_CCW: PALACE_CCW, DOMAIN_NAME: DOMAIN_NAME
  };
});
