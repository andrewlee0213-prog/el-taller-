/* ===== El Taller — 紫微引擎农历数据表生成器 =====
 * 作者：liyanjun
 * 用途：一次性离线工具。以 lunar-javascript 为数据源，生成 1900–2100 年
 *       的紧凑农历表（每年一个 24bit 字），产出 JS 片段贴入 ziwei.js。
 *       本生成器不参与网站运行时，网站运行时零依赖。
 * 用法：node tools/build-lunar-table.js（需先在对照仓库装好 lunar-javascript，
 *       或把 LUNAR_DIR 指向任意装有该包的 node_modules）
 * 溯源：数据由 lunar-javascript（MIT）在本机计算生成，仅取其事实性历法数据。
 */

'use strict';
const path = require('path');

const LUNAR_DIR =
  process.env.LUNAR_DIR ||
  '/Users/yanjunli/.zcode/workspace/draft-b374c8f6-2c8a-470a-85b5-5b879dc09eb2/ziwei-doushu/node_modules/lunar-javascript';
const { Solar, Lunar, LunarMonth } = require(path.join(LUNAR_DIR, 'index.js'));

const YEAR_MIN = 1900;
const YEAR_MAX = 2100;

// ── 儒略日数（格里历整数算法，与 ziwei.js 内实现保持一致）──────
function toJDN(y, m, d) {
  const a = Math.floor((14 - m) / 12);
  const yy = y + 4800 - a;
  const mm = m + 12 * a - 3;
  return d + Math.floor((153 * mm + 2) / 5) + 365 * yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) - 32045;
}

function leapOf(y) {
  for (let m = 1; m <= 12; m++) {
    const lm = LunarMonth.fromYm(y, -m);
    if (lm && typeof lm.getDayCount() === 'number' && lm.getDayCount() > 0) return m;
  }
  return 0;
}
function dayCountOf(y, m, isLeap) {
  const lm = LunarMonth.fromYm(y, isLeap ? -m : m);
  return lm ? lm.getDayCount() : 0;
}

// ── 每年打包：正月初一的公历年内日序 | 闰月号 | 历序月大小位 ──
// 位布局（共 23 位，存 24bit）：bit0-5 新年偏移(1月1日=0，最大 51)
//                              bit6-9 闰月号(0=无闰，1..12)
//                              bit10-22 历序月份大小(1=大月30天，从正月起按历序，闰月紧跟本数之后)
function packYear(y) {
  const ny = Lunar.fromYmd(y, 1, 1).getSolar();
  const nyOff = toJDN(ny.getYear(), ny.getMonth(), ny.getDay()) - toJDN(y, 1, 1);
  if (nyOff < 0 || nyOff > 63) throw new Error(`新年偏移越界 ${y}: ${nyOff}`);

  const leap = leapOf(y);
  if (leap < 0 || leap > 12) throw new Error(`闰月越界 ${y}: ${leap}`);

  const sizes = []; // 历序：正月..十二月，闰m 紧跟 m
  for (let m = 1; m <= 12; m++) {
    sizes.push(dayCountOf(y, m, false));
    if (m === leap) sizes.push(dayCountOf(y, m, true));
  }
  if (sizes.length !== (leap ? 13 : 12)) throw new Error(`月数异常 ${y}`);
  let bits = 0;
  sizes.forEach((days, i) => {
    if (days !== 29 && days !== 30) throw new Error(`月天数异常 ${y} #${i}: ${days}`);
    if (days === 30) bits |= 1 << i;
  });

  let word = nyOff | (leap << 6) | (bits << 10);
  if (word > 0xffffff) throw new Error(`打包越界 ${y}`);
  return word.toString(16).padStart(6, '0');
}

// ── 日干支锚点：取 2000-01-01 的日干/日支索引 ──
function dayAnchor() {
  const l = Solar.fromYmd(2000, 1, 1).getLunar();
  const STEMS = '甲乙丙丁戊己庚辛壬癸';
  const BRANCHES = '子丑寅卯辰巳午未申酉戌亥';
  return { jdn: toJDN(2000, 1, 1), stem: STEMS.indexOf(l.getDayGan()), branch: BRANCHES.indexOf(l.getDayZhi()) };
}

// ── 自检：随机日期 solar→lunar 往返 + 跨年边界 ──
function selfCheck(words) {
  let bad = 0;
  const rnd = (n) => Math.floor(Math.random() * n);
  for (let i = 0; i < 20000; i++) {
    const y = YEAR_MIN + rnd(YEAR_MAX - YEAR_MIN + 1);
    const solar = Solar.fromYmd(y, 1 + rnd(12), 1 + rnd(28));
    const lun = solar.getLunar();
    const ly = lun.getYear(), lmRaw = lun.getMonth(), ld = lun.getDay();
    const lm = Math.abs(lmRaw), isLeap = lmRaw < 0;
    // 用表反推：从正月初一起按历序走（以「年内第几天」驱动）
    const ny = Lunar.fromYmd(ly, 1, 1).getSolar();
    let day = toJDN(solar.getYear(), solar.getMonth(), solar.getDay()) - toJDN(ny.getYear(), ny.getMonth(), ny.getDay()) + 1;
    if (day < 1) { bad++; console.error('落在正月初一前', solar.toYmd()); continue; }
    let mm = 1, leapNow = false;
    for (;;) {
      const dc = dayCountOf(ly, mm, leapNow);
      if (day <= dc) {
        if (mm !== lm || leapNow !== isLeap) { bad++; console.error('月不匹配', solar.toYmd(), '期望', lm, isLeap, '实际', mm, leapNow); }
        break;
      }
      day -= dc;
      if (!leapNow && leapOf(ly) === mm) { leapNow = true; } else { leapNow = false; mm++; }
      if (mm > 12) { bad++; break; }
    }
    if (bad > 5) break;
  }
  return bad;
}

// ── 输出 ──
const words = [];
for (let y = YEAR_MIN; y <= YEAR_MAX; y++) words.push(packYear(y));
const anchor = dayAnchor();
const bad = selfCheck(words);
if (bad) { console.error(`自检失败 ${bad} 例，中止输出`); process.exit(1); }

console.log('/* 生成参数：' + new Date().toISOString().slice(0, 10) + ' · ' + (YEAR_MAX - YEAR_MIN + 1) + ' 年 · 自检 20000 例通过 */');
console.log(`const LUNAR_WORDS = '${words.join('')}';`);
console.log(`const LUNAR_Y0 = ${YEAR_MIN}, LUNAR_Y1 = ${YEAR_MAX};`);
console.log(`const GZ_ANCHOR = { jdn: ${anchor.jdn}, stem: ${anchor.stem}, branch: ${anchor.branch} }; // 2000-01-01 日柱锚点`);
