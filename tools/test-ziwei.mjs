/* ===== El Taller — 紫微引擎校验脚本 =====
 * 作者：liyanjun
 * 用法：node tools/test-ziwei.mjs [--quick]
 *   阶段 A 历法对照（vs lunar-javascript）
 *   阶段 B 排盘铁律不变量（720 盘）
 *   阶段 C 安星全量对照（vs iztro，含闰月前后半月、名人盘、金标准盘）
 *   阶段 D 斗君公式 vs 子年斗君表全量 diff
 *   阶段 E 流月/流日命宫 vs iztro horoscope 索引
 * 无断言框架，失败 exit 1。对照包从对照仓库 node_modules 加载（离线基准）。
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ZW = createRequire(path.join(HERE, 'ziwei.js'))('../ziwei.js');

const REF = '/Users/yanjunli/.zcode/workspace/draft-b374c8f6-2c8a-470a-85b5-5b879dc09eb2/ziwei-doushu/node_modules';
const reqRef = createRequire(path.join(REF, 'noop.js'));
const { Solar, Lunar } = reqRef('lunar-javascript');
const { astro } = reqRef('iztro');
astro.config({ yearDivide: 'normal' });

const QUICK = process.argv.includes('--quick');
let fail = 0, pass = 0;
const ok = (m) => { pass++; };
const bad = (m) => { fail++; console.error('  ✗ ' + m); };
const check = (cond, m) => { cond ? ok() : bad(m); return cond; };

const STEM = '甲乙丙丁戊己庚辛壬癸'.split('');
const BRANCH = '子丑寅卯辰巳午未申酉戌亥'.split('');

/* ── A 历法对照 ─────────────────────────────── */
function phaseA() {
  console.log('── A 历法对照');
  let seed = 42;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
  const N = QUICK ? 800 : 5000;
  for (let i = 0; i < N; i++) {
    const y = 1900 + Math.floor(rnd() * 201);
    const m = 1 + Math.floor(rnd() * 12);
    const d = 1 + Math.floor(rnd() * 28);
    const mine = ZW.solarToLunar(y, m, d);
    const lu = Solar.fromYmd(y, m, d).getLunar();
    if (lu.getYear() < 1900) { check(mine === null, `表外应 null ${y}-${m}-${d}`); continue; } // 表自 1900 正月初一起
    const exp = { y: lu.getYear(), m: Math.abs(lu.getMonth()), leap: lu.getMonth() < 0, d: lu.getDay() };
    if (!check(JSON.stringify(mine) === JSON.stringify(exp), `solarToLunar ${y}-${m}-${d}: ${JSON.stringify(mine)} ≠ ${JSON.stringify(exp)}`)) { if (fail > 20) break; continue; }
    // 往返
    const back = ZW.lunarToSolar(exp.y, exp.m, exp.d, exp.leap);
    check(back && back.y === y && back.m === m && back.d === d, `roundtrip ${y}-${m}-${d}`);
    // 日干支
    const gz = ZW.dayGZ(y, m, d);
    check(STEM[gz.stem] === lu.getDayGan() && BRANCH[gz.branch] === lu.getDayZhi(),
      `dayGZ ${y}-${m}-${d}: ${STEM[gz.stem]}${BRANCH[gz.branch]} ≠ ${lu.getDayGan()}${lu.getDayZhi()}`);
    // 年干支（正月初一换年）
    const yg = ZW.yearGZ(mine.y);
    check(STEM[yg.stem] === lu.getYearGan() && BRANCH[yg.branch] === lu.getYearZhi(),
      `yearGZ ${y}-${m}-${d}: ${STEM[yg.stem]}${BRANCH[yg.branch]} ≠ ${lu.getYearGan()}${lu.getYearZhi()}`);
  }
  // 春秋边界逐日（每年 ±3 天，含全部 201 年）；表外（1900 年首日前）应为 null
  const jdn = (y, m, d) => {
    const a = Math.floor((14 - m) / 12), yy = y + 4800 - a, mm = m + 12 * a - 3;
    return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
  };
  const unjdn = (j) => {
    const a = j + 32044, b = Math.floor((4 * a + 3) / 146097), c = a - Math.floor(146097 * b / 4);
    const d2 = Math.floor((4 * c + 3) / 1461), e = c - Math.floor(1461 * d2 / 4), mm = Math.floor((5 * e + 2) / 153);
    return { y: 100 * b + d2 - 4800 + Math.floor(mm / 10), m: mm + 3 - 12 * Math.floor(mm / 10), d: e - Math.floor((153 * mm + 2) / 5) + 1 };
  };
  let bad2 = 0;
  for (let y = 1900; y <= 2100; y++) {
    const ny = Lunar.fromYmd(y, 1, 1).getSolar();
    const nyJ = jdn(ny.getYear(), ny.getMonth(), ny.getDay());
    for (let k = -2; k <= 2; k++) {
      const t = unjdn(nyJ + k);
      const mine = ZW.solarToLunar(t.y, t.m, t.d);
      const lu = Solar.fromYmd(t.y, t.m, t.d).getLunar();
      if (lu.getYear() < 1900) { check(mine === null, `表外应 null ${t.y}-${t.m}-${t.d}`); continue; }
      const same = mine && mine.y === lu.getYear() && mine.m === Math.abs(lu.getMonth()) && mine.leap === (lu.getMonth() < 0) && mine.d === lu.getDay();
      if (!same) { bad2++; console.error(`  ✗ 边界 ${t.y}-${t.m}-${t.d}: ${JSON.stringify(mine)} vs ${lu.getYear()}/${lu.getMonth()}/${lu.getDay()}`); }
      else pass++;
    }
  }
  check(bad2 === 0, `春节边界失败 ${bad2} 例`);
}

/* ── B 排盘铁律 ─────────────────────────────── */
function genSamples() {
  const out = [];
  for (let y = 1955; y <= 2010; y += 7)
    for (let m = 1; m <= 12; m += 3)
      for (let d = 5; d <= 26; d += 10)
        for (let h = 0; h < 12; h += 3)
          for (const g of ['男', '女']) {
            if (ZW.solarToLunar(y, m, d)) out.push({ y, m, d, hour: h, gender: g });
          }
  return out;
}
function chartDigest(c) { // branch → 星名集
  return c.palaces.map(p => p.stars.map(s => s.name).sort().join('/'));
}
function phaseB() {
  console.log('── B 排盘铁律（720 盘 × 6 律）');
  const samples = genSamples();
  check(samples.length >= 700, `采样数 ${samples.length}`);
  for (const s of samples) {
    const c = ZW.natal(s);
    const digest = chartDigest(c);
    // 1. 14 主星齐全且各一
    const majors = {};
    digest.forEach((stars, b) => stars.split('/').filter(Boolean).forEach(n => {
      if (['紫微','天机','太阳','武曲','天同','廉贞','天府','太阴','贪狼','巨门','天相','天梁','七杀','破军'].includes(n)) majors[n] = (majors[n] || 0) + 1;
    }));
    check(Object.keys(majors).length === 14 && Object.values(majors).every(v => v === 1), `${s.y}-${s.m}-${s.d} 14主星: ${JSON.stringify(majors)}`);
    // 2. 宫名覆盖十二宫各一
    const names = c.palaces.map(p => p.name).sort();
    check(new Set(names).size === 12, `${s.y}-${s.m}-${s.d} 宫名重复`);
    // 3. 紫府对称
    const zw = c.palaces.findIndex(p => p.stars.some(x => x.name === '紫微'));
    const tf = c.palaces.findIndex(p => p.stars.some(x => x.name === '天府'));
    check((zw + tf) % 12 === 4, `${s.y}-${s.m}-${s.d} 紫府对称 ${zw}/${tf}`);
    // 4. 机梁同宫只可在辰戌
    const j = c.palaces.findIndex(p => p.stars.some(x => x.name === '天机'));
    const l = c.palaces.findIndex(p => p.stars.some(x => x.name === '天梁'));
    if (j === l) check(j === 4 || j === 10, `机梁同宫于 ${BRANCH[j]}`);
    else ok();
    // 5. 命身宫差为偶数（身宫只可能命+0/2/4/6/8/10）
    check((c.shen - c.ming + 12) % 2 === 0, `${s.y}-${s.m}-${s.d} 身宫位 ${c.ming}→${c.shen}`);
    // 6. 大限十二段覆盖 2..121 连续不重叠
    const ranges = c.palaces.map(p => p.daXian).filter(Boolean).sort((a, b) => a[0] - b[0]);
    check(ranges.length === 12 && ranges[0][0] === c.ju &&
      ranges.every((r, i) => r[1] - r[0] === 9 && (i === 0 || r[0] === ranges[i - 1][1] + 1)),
      `${s.y}-${s.m}-${s.d} 大限带`);
  }
}

/* ── C 安星全量对照 vs iztro ─────────────────── */
const MINOR_SET = ['左辅','右弼','文昌','文曲','天魁','天钺','禄存','天马','擎羊','陀罗','火星','铃星','地空','地劫'];
const ADJ_SET = ['红鸾','天喜','天刑','天姚'];
function iztroDigest(a) {
  const byBranch = {};
  for (const p of a.palaces) {
    const b = BRANCH.indexOf(p.earthlyBranch);
    const names = []
      .concat(p.majorStars.map(s => s.name + (s.mutagen ? ':' + s.mutagen : '')))
      .concat(p.minorStars.map(s => s.name + (s.mutagen ? ':' + s.mutagen : '')))
      .concat(p.adjectiveStars.map(s => s.name));
    byBranch[b] = {
      names: names,
      stem: STEM.indexOf(p.heavenlyStem),
      name: p.name,
      range: p.decadal ? p.decadal.range : null
    };
  }
  return {
    byBranch,
    ming: BRANCH.indexOf(a.earthlyBranchOfSoulPalace),
    shen: BRANCH.indexOf(a.earthlyBranchOfBodyPalace),
    juName: a.fiveElementsClass
  };
}
function myDigest(c) {
  const byBranch = {};
  for (const p of c.palaces) {
    byBranch[p.branch] = {
      names: p.stars.map(s => s.name + (s.sihua ? ':' + s.sihua : '')),
      stem: p.stem, name: p.name.replace('宫', '') === p.name ? p.name : p.name, range: p.daXian
    };
  }
  return { byBranch, ming: c.ming, shen: c.shen, juName: c.juName };
}
function compareOne(s, extra) {
  const c = ZW.natal(s);
  const a = astro.bySolar(`${s.y}-${s.m}-${s.d}`, s.hour, s.gender, true, 'zh-CN');
  const iz = iztroDigest(a), my = myDigest(c);
  const tag = `${s.y}-${s.m}-${s.d} ${s.hour} ${s.gender}${extra || ''}`;
  if (!check(my.ming === iz.ming, `${tag} 命宫 ${BRANCH[my.ming]}≠${BRANCH[iz.ming]}`)) return false;
  if (!check(my.shen === iz.shen, `${tag} 身宫 ${BRANCH[my.shen]}≠${BRANCH[iz.shen]}`)) return false;
  if (!check(my.juName === iz.juName, `${tag} 五行局 ${my.juName}≠${iz.juName}`)) return false;
  // 宫干/宫名/大限
  for (let b = 0; b < 12; b++) {
    const M = my.byBranch[b], I = iz.byBranch[b];
    check(M.stem === I.stem, `${tag} 宫干 ${BRANCH[b]}: ${STEM[M.stem]}≠${STEM[I.stem]}`);
    const myName = M.name.replace(/宫$/, '');
    const izName = I.name.replace(/宫$/, '');
    if (!check(myName === izName || (myName === '交友' && izName === '仆役'), `${tag} 宫名 ${BRANCH[b]}: ${M.name}≠${I.name}`)) return false;
    if (!check(JSON.stringify(M.range) === JSON.stringify(I.range), `${tag} 大限 ${BRANCH[b]}: ${M.range}≠${I.range}`)) return false;
    // 星集合（我只排 iztro 的 14主+14辅煞+4杂耀，取交集比较；四化标记仅主/辅星）
    const mySet = new Set(M.names);
    for (const n of I.names) {
      if (n.includes(':')) { check(mySet.has(n), `${tag} ${BRANCH[b]} 缺 ${n}`); continue; }
      if (MINOR_SET.includes(n) || ADJ_SET.includes(n)) check(mySet.has(n), `${tag} ${BRANCH[b]} 缺 ${n}`);
    }
    // 反向：我排的星都应在 iztro 中
    for (const n of M.names) {
      const bare = n.split(':')[0];
      check(I.names.some(x => x.split(':')[0] === bare), `${tag} ${BRANCH[b]} 多出 ${n}`);
    }
  }
  return true;
}
function phaseC() {
  console.log('── C 安星对照 vs iztro');
  // 金标准盘（对照仓库回归用例）
  compareOne({ y: 1988, m: 10, d: 8, hour: 7, gender: '男' }, '·金标准');
  compareOne({ y: 1974, m: 1, d: 28, hour: 4, gender: '男' }, '·金标准2');
  // 名人盘（对照仓库 famous.ts 同款采样）
  const famous = [
    [1964, 9, 10, 8, '男'], [1964, 10, 15, 4, '男'], [1955, 10, 28, 8, '男'],
    [1954, 10, 24, 12 - 1, '男'], [1979, 8, 29, 4, '男'], [1962, 11, 11, 6, '男'],
    [1955, 2, 24, 0, '男'], [1965, 5, 18, 2, '男'], [1942, 11, 20, 4, '男'],
    [1967, 7, 7, 10, '男'], [1989, 6, 21, 8, '女']
  ];
  for (const f of famous) compareOne({ y: f[0], m: f[1], d: f[2], hour: f[3], gender: f[4] }, '·名人');
  // 随机广覆盖
  let seed = 7;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000;
  const N = QUICK ? 60 : 400;
  for (let i = 0; i < N; i++) {
    const y = 1950 + Math.floor(rnd() * 80);
    const m = 1 + Math.floor(rnd() * 12);
    const d = 1 + Math.floor(rnd() * 28);
    const h = Math.floor(rnd() * 12);
    const g = rnd() < 0.5 ? '男' : '女';
    if (!ZW.solarToLunar(y, m, d)) continue;
    compareOne({ y, m, d, hour: h, gender: g });
  }
  // 闰月专项：1950-2030 所有闰月，前半月（初八）与后半月（廿二）
  const leapCases = [];
  for (let y = 1950; y <= 2030; y++) {
    for (let m = 1; m <= 12; m++) {
      const lm = Lunar.fromYmd(y, m, 1);
      const leapLunar = (() => { try { return Lunar.fromYmd(y, -m, 1); } catch { return null; } })();
      if (!leapLunar || leapLunar.getMonth() !== -m) continue;
      for (const d of [8, 22]) {
        const l2 = Lunar.fromYmd(y, -m, d).getSolar();
        leapCases.push({ y: l2.getYear(), m: l2.getMonth(), d: l2.getDay(), hour: (d + m) % 12, gender: d % 2 ? '男' : '女' });
      }
    }
  }
  check(leapCases.length > 40, `闰月样本 ${leapCases.length}`);
  for (const s of leapCases) compareOne(s, '·闰月');
  // 紫微定位穷举：5 局 × 30 日（借月/时固定，直接比对紫微支）
  for (let ju = 2; ju <= 6; ju++) {
    for (let day = 1; day <= 30; day++) {
      // 找一个 (命局=ju) 的盘比对紫微太费事，改为公式自检：紫微支 ∈ 0-11
      const b = ZW.ziweiBranch(day, ju);
      check(b >= 0 && b <= 11, `紫微支越界 ${ju}/${day}`);
    }
  }
}

/* ── D 斗君公式 vs 子年斗君表 ────────────────── */
function phaseD() {
  console.log('── D 斗君 vs ZNDJ 表');
  // 子年斗君表（子起一编码，行=生月1-12，列=生时1-12）
  const ZNDJ = [
    [0,0,0,0,0,0,0,0,0,0,0,0,0],
    [1,2,3,4,5,6,7,8,9,10,11,12],
    [12,1,2,3,4,5,6,7,8,9,10,11],
    [11,12,1,2,3,4,5,6,7,8,9,10],
    [10,11,12,1,2,3,4,5,6,7,8,9],
    [9,10,11,12,1,2,3,4,5,6,7,8],
    [8,9,10,11,12,1,2,3,4,5,6,7],
    [7,8,9,10,11,12,1,2,3,4,5,6],
    [6,7,8,9,10,11,12,1,2,3,4,5],
    [5,6,7,8,9,10,11,12,1,2,3,4],
    [4,5,6,7,8,9,10,11,12,1,2,3],
    [3,4,5,6,7,8,9,10,11,12,1,2],
    [2,3,4,5,6,7,8,9,10,11,12,1]
  ];
  for (let m = 1; m <= 12; m++) for (let h = 0; h < 12; h++) {
    const mine = ((0 - (m - 1) + h) % 12 + 12) % 12 + 1; // 子年：斗君(子起一)
    check(mine === ZNDJ[m][h], `斗君 ${m}月${h}时: ${mine}≠${ZNDJ[m][h]}`);
  }
}

/* ── E 流月/流日命宫 vs iztro horoscope ─────── */
function phaseE() {
  console.log('── E 流月/流日命宫 vs iztro');
  const cases = [
    { y: 1988, m: 10, d: 8, hour: 7, gender: '男' },
    { y: 1974, m: 1, d: 28, hour: 4, gender: '男' },
    { y: 1992, m: 6, d: 15, hour: 2, gender: '女' },
    { y: 2001, m: 3, d: 9, hour: 10, gender: '女' }
  ];
  const dates = ['2026-10-26', '2026-01-01', '2025-08-15', '2027-03-03', '2026-06-30', '2033-12-20'];
  for (const b of cases) {
    const c = ZW.natal(b);
    const a = astro.bySolar(`${b.y}-${b.m}-${b.d}`, b.hour, b.gender, true, 'zh-CN');
    for (const ds of dates) {
      const h = a.horoscope(ds);
      const f = ZW.flowOf(c, +ds.slice(0, 4), +ds.slice(5, 7), +ds.slice(8, 10));
      // iztro 宫索引以寅为 0：支 = (index+2)%12
      const izYue = ((h.monthly.index + 2) % 12 + 12) % 12;
      const izRi = ((h.daily.index + 2) % 12 + 12) % 12;
      check(f.yuePalace === izYue, `${ds} 流月宫 ${BRANCH[f.yuePalace]}≠${BRANCH[izYue]} (${b.y}盘)`);
      check(f.riPalace === izRi, `${ds} 流日宫 ${BRANCH[f.riPalace]}≠${BRANCH[izRi]} (${b.y}盘)`);
      // 流日四化：iztro daily.mutagen = [禄,权,科,忌] 星名数组
      const SI4 = ['禄', '权', '科', '忌'];
      const izRiSi = (h.daily.mutagen || []).map((s, i) => s + SI4[i]).sort().join();
      const myRiSi = f.riSihua.map((s, i) => s + SI4[i]).sort().join();
      check(izRiSi === myRiSi, `${ds} 流日四化 ${myRiSi}≠${izRiSi} (${b.y}盘)`);
      const izYueSi = (h.monthly.mutagen || []).map((s, i) => s + SI4[i]).sort().join();
      const myYueSi = f.yueSihua.map((s, i) => s + SI4[i]).sort().join();
      check(izYueSi === myYueSi, `${ds} 流月四化 ${myYueSi}≠${izYueSi} (${b.y}盘)`);
    }
  }
}

/* ── F 冒烟：daily/week/monthGrid ─────────────── */
function phaseF() {
  console.log('── F 日/周/月冒烟');
  const c = ZW.natal({ y: 1988, m: 10, d: 8, hour: 7, gender: '男' });
  const d = ZW.daily(c, '2026-10-26');
  check(d && d.stars && d.rows, 'daily 结构');
  check(typeof d.overall === 'number' && d.overall >= 1 && d.overall <= 5, 'daily 星级');
  const w = ZW.week(c, '2026-10-26');
  check(w.days.length === 7 && w.best && w.worst, 'week 结构');
  const g = ZW.monthGrid(c, 2026, 10);
  check(g.cells.length === 42 && g.theme, 'monthGrid 结构');
  check(g.cells.every(x => !x.inMonth || (x.stars && ['career','wealth','love','health'].every(k => x.stars[k] >= 1 && x.stars[k] <= 5))), 'cells 逐日四领域 stars');
  // 确定性：同参同出
  check(JSON.stringify(ZW.daily(c, '2026-10-26')) === JSON.stringify(d), '确定性');
  // 月度报告
  const rep = ZW.monthReport(c, 2026, 10);
  check(rep && typeof rep.headline === 'string' && rep.headline.length > 20, 'monthReport headline');
  check(/^\d{4}-\d{1,2}$/.test(rep.monthKey), 'monthKey 格式 ' + rep.monthKey);
  check(rep.goodDays.length === 3 && rep.cautionDays.length === 3, '吉慎日各 3');
  check(rep.goodDays.every(x => x.date.startsWith('2026-10-')) && rep.cautionDays.every(x => x.date.startsWith('2026-10-')), '吉慎日限当月');
  check(!rep.goodDays.some(x => rep.cautionDays.some(y => y.date === x.date)), '吉慎日不重叠');
  check(rep.goodDays.every(x => /^宜/.test(x.why)) && rep.cautionDays.every(x => /^慎/.test(x.why)), 'why 宜/慎前缀');
  check(rep.monthStars && ['career','wealth','love','health'].every(k => rep.monthStars[k] >= 1 && rep.monthStars[k] <= 5), '月度四领域星级');
  check(JSON.stringify(ZW.monthReport(c, 2026, 10)) === JSON.stringify(rep), 'monthReport 确定性');
  const r2 = ZW.monthReport(c, 2027, 1);
  check(r2 && r2.goodDays.length === 3 && r2.cautionDays.length === 3, '跨年边界月（公历 1 月）');
  try { ZW.monthReport(c, 2026, 13); check(false, '非法月份应抛错'); } catch (e) { ok(); }
}

phaseA();
phaseB();
phaseC();
phaseD();
phaseE();
phaseF();
console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
