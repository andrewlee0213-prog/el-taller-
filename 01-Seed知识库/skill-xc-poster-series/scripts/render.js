#!/usr/bin/env node
/**
 * xc-poster-series 渲染器
 * 用法:
 *   node render.js poster.json            → 同目录同名 .png
 *   node render.js poster.json out.png    → 指定输出
 *   node render.js 某目录/                → 目录内每个 .json 渲染一张
 *   node render.js --html poster.json     → 只产出调试用 html
 * json 支持 "extends": "base.json"(同目录)做字段合并。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const ROOT = path.join(__dirname, '..');
const TEMPLATE = fs.readFileSync(path.join(ROOT, 'assets', 'template.html'), 'utf8');

const DEFAULT_THEME = {
  bg: '#F7EEDC', focus: '#1E6FE0', heavy: '#3E2B1C', cream: '#F7EEDC',
  accents: ['#2B7DE9', '#F08C3C', '#8FCB4A'], red: '#E2554A',
};

/* ───────────────────────── 工具 ───────────────────────── */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function loadJson(p) {
  let j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (j.extends) {
    const base = loadJson(path.resolve(path.dirname(p), j.extends));
    for (const k of Object.keys(base)) {
      if (!(k in j)) j[k] = base[k];
      else if (typeof base[k] === 'object' && !Array.isArray(base[k]) && typeof j[k] === 'object' && !Array.isArray(j[k])) {
        j[k] = Object.assign({}, base[k], j[k]);
      }
    }
  }
  j.theme = Object.assign({}, DEFAULT_THEME, j.theme || {});
  return j;
}

/* 票笺左右锯齿边 clip-path */
function zigzagClip(w, h, tooth = 17, amp = 8) {
  const step = tooth / 2, pts = [];
  const n = Math.ceil(h / step);
  const px = v => `${Math.round(v * 10) / 10}px`;
  for (let i = 0; i <= n; i++) {
    const y = Math.min(i * step, h);
    pts.push(`${px(i % 2 ? w - amp : w)} ${px(y)}`);
  }
  for (let i = n; i >= 0; i--) {
    const y = Math.min(i * step, h);
    pts.push(`${px(i % 2 ? amp : 0)} ${px(y)}`);
  }
  return `polygon(${pts.join(', ')})`;
}

const titleFs = t => { const n = [...String(t)].length; return n <= 6 ? 50 : n <= 8 ? 46 : 41; };

/* ───────────────────────── S3 插画原语库 ─────────────────────────
 * 每个原语以 (0,0) 为中心,返回 <g> 片段;双层描边模拟贴纸剪影白边。 */
function halo(d, extra = '') {
  return `<path d="${d}" fill="none" stroke="#FFFDF6" stroke-width="12" stroke-linejoin="round" ${extra}/>`;
}
const P = {
  paper(t) { // 揉皱的纸
    const d = 'M-38,-20 L-10,-34 L22,-30 L40,-12 L34,18 L8,32 L-24,28 L-42,8 Z';
    return halo(d) + `<path d="${d}" fill="#FFFDF6" stroke="${t.heavy}" stroke-width="4" stroke-linejoin="round"/>
      <path d="M-20,-18 L2,-2 M6,-24 L14,4 M-12,10 L18,14" stroke="${t.heavy}" stroke-width="2.5" fill="none" opacity=".4"/>`;
  },
  ticket(t) { // 票根
    return `<rect x="-49" y="-28" width="98" height="56" rx="8" fill="none" stroke="#FFFDF6" stroke-width="12"/>
      <rect x="-49" y="-28" width="98" height="56" rx="8" fill="#FFFDF6" stroke="${t.heavy}" stroke-width="4"/>
      <line x1="24" y1="-28" x2="24" y2="28" stroke="${t.heavy}" stroke-width="3" stroke-dasharray="6 6"/>
      <circle cx="37" cy="0" r="8" fill="${t.bg}" stroke="${t.heavy}" stroke-width="3"/>
      <line x1="-36" y1="-10" x2="8" y2="-10" stroke="${t.heavy}" stroke-width="3.5" opacity=".55"/>
      <line x1="-36" y1="4" x2="0" y2="4" stroke="${t.heavy}" stroke-width="3.5" opacity=".35"/>`;
  },
  chat(t) { // 对话气泡
    return `<path d="M-40,-26 h80 a14,14 0 0 1 14,14 v24 a14,14 0 0 1 -14,14 h-52 l-14,16 2,-16 h-16 a14,14 0 0 1 -14,-14 v-24 a14,14 0 0 1 14,-14 z"
      transform="translate(4,-2)" fill="none" stroke="#FFFDF6" stroke-width="12" stroke-linejoin="round"/>
      <path d="M-36,-28 h80 a14,14 0 0 1 14,14 v24 a14,14 0 0 1 -14,14 h-52 l-14,16 2,-16 h-16 a14,14 0 0 1 -14,-14 v-24 a14,14 0 0 1 14,-14 z"
      fill="#FFFDF6" stroke="${t.heavy}" stroke-width="4" stroke-linejoin="round"/>
      <circle cx="-18" cy="-2" r="4.5" fill="${t.heavy}" opacity=".5"/>
      <circle cx="0" cy="-2" r="4.5" fill="${t.heavy}" opacity=".5"/>
      <circle cx="18" cy="-2" r="4.5" fill="${t.heavy}" opacity=".5"/>`;
  },
  clock(t) {
    return `<circle r="27" fill="none" stroke="#FFFDF6" stroke-width="12"/>
      <circle r="27" fill="#FFFDF6" stroke="${t.heavy}" stroke-width="4"/>
      <line x1="0" y1="0" x2="13" y2="-11" stroke="${t.heavy}" stroke-width="4" stroke-linecap="round"/>
      <line x1="0" y1="0" x2="-9" y2="9" stroke="${t.heavy}" stroke-width="4" stroke-linecap="round"/>
      <circle r="3.5" fill="${t.focus}"/>`;
  },
  coin(t) {
    return `<circle r="25" fill="none" stroke="#FFFDF6" stroke-width="12"/>
      <circle r="25" fill="#FFFDF6" stroke="${t.heavy}" stroke-width="4"/>
      <circle r="16" fill="none" stroke="${t.accents[1]}" stroke-width="3"/>
      <text x="0" y="8" text-anchor="middle" font-size="22" font-weight="900" fill="${t.accents[1]}" font-family="inherit">¥</text>`;
  },
  folder(t) {
    const d = 'M-40,-16 L-14,-16 L-6,-8 L40,-8 L40,24 L-40,24 Z';
    return halo(d) + `<path d="${d}" fill="#FFFDF6" stroke="${t.heavy}" stroke-width="4" stroke-linejoin="round"/>
      <line x1="-28" y1="4" x2="20" y2="4" stroke="${t.heavy}" stroke-width="3" opacity=".4"/>`;
  },
  phone(t) {
    return `<rect x="-17" y="-30" width="34" height="60" rx="8" fill="none" stroke="#FFFDF6" stroke-width="12"/>
      <rect x="-17" y="-30" width="34" height="60" rx="8" fill="#FFFDF6" stroke="${t.heavy}" stroke-width="4"/>
      <line x1="-8" y1="-22" x2="8" y2="-22" stroke="${t.heavy}" stroke-width="3" opacity=".5"/>
      <path d="M28,-34 a10,10 0 0 1 8,8 M32,-42 a18,18 0 0 1 14,14" stroke="${t.heavy}" stroke-width="3.5" fill="none" stroke-linecap="round" opacity=".6"/>`;
  },
  search(t) {
    return `<circle cx="-6" cy="-6" r="20" fill="none" stroke="#FFFDF6" stroke-width="12"/>
      <circle cx="-6" cy="-6" r="20" fill="#FFFDF6" stroke="${t.heavy}" stroke-width="4"/>
      <line x1="-13" y1="-6" x2="1" y2="-6" stroke="${t.accents[0]}" stroke-width="3" opacity=".7"/>
      <line x1="-6" y1="-13" x2="-6" y2="1" stroke="${t.accents[0]}" stroke-width="3" opacity=".7"/>
      <line x1="9" y1="9" x2="26" y2="26" stroke="${t.heavy}" stroke-width="7" stroke-linecap="round"/>`;
  },
  plane(t) { // 纸飞机
    const d = 'M-36,12 L40,-18 L4,28 L-2,14 Z';
    return halo(d) + `<path d="${d}" fill="#FFFDF6" stroke="${t.heavy}" stroke-width="4" stroke-linejoin="round"/>
      <path d="M-2,14 L40,-18" stroke="${t.heavy}" stroke-width="3" opacity=".5"/>`;
  },
  card(t) { // 整齐卡片 + 对勾
    return `<rect x="-34" y="-24" width="68" height="48" rx="8" fill="none" stroke="#FFFDF6" stroke-width="12"/>
      <rect x="-34" y="-24" width="68" height="48" rx="8" fill="#FFFDF6" stroke="${t.accents[2]}" stroke-width="4"/>
      <polyline points="-16,2 -4,13 18,-10" fill="none" stroke="#4CAF7D" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  },
  star(t, fill) {
    const d = 'M0,-22 C3,-6 6,-3 22,0 C6,3 3,6 0,22 C-3,6 -6,3 -22,0 C-6,-3 -3,-6 0,-22 Z';
    return `<path d="${d}" fill="none" stroke="#FFFDF6" stroke-width="9" stroke-linejoin="round"/>
      <path d="${d}" fill="${fill || t.accents[1]}" stroke="${t.heavy}" stroke-width="2.5" stroke-linejoin="round"/>`;
  },
  lock(t) {
    return `<path d="M-11,-8 v-4 a11,11 0 0 1 22,0 v4" fill="none" stroke="#FFFDF6" stroke-width="13"/>
      <path d="M-11,-8 v-4 a11,11 0 0 1 22,0 v4" fill="none" stroke="${t.heavy}" stroke-width="5"/>
      <rect x="-19" y="-8" width="38" height="32" rx="7" fill="none" stroke="#FFFDF6" stroke-width="12"/>
      <rect x="-19" y="-8" width="38" height="32" rx="7" fill="#FFFDF6" stroke="${t.heavy}" stroke-width="4"/>
      <circle cy="6" r="4" fill="${t.focus}"/><rect x="-2" y="8" width="4" height="9" rx="2" fill="${t.focus}"/>`;
  },
  calendar(t) {
    return `<rect x="-30" y="-22" width="60" height="46" rx="7" fill="none" stroke="#FFFDF6" stroke-width="12"/>
      <rect x="-30" y="-22" width="60" height="46" rx="7" fill="#FFFDF6" stroke="${t.heavy}" stroke-width="4"/>
      <path d="M-30,-12 h60" stroke="${t.heavy}" stroke-width="3"/>
      <rect x="-30" y="-22" width="60" height="11" rx="6" fill="${t.focus}"/>
      <line x1="-13" y1="-28" x2="-13" y2="-18" stroke="${t.heavy}" stroke-width="4" stroke-linecap="round"/>
      <line x1="13" y1="-28" x2="13" y2="-18" stroke="${t.heavy}" stroke-width="4" stroke-linecap="round"/>
      <circle cx="-14" cy="2" r="3.5" fill="${t.heavy}" opacity=".45"/><circle cx="0" cy="2" r="3.5" fill="${t.heavy}" opacity=".45"/><circle cx="14" cy="2" r="3.5" fill="${t.accents[1]}"/>
      <circle cx="-14" cy="14" r="3.5" fill="${t.heavy}" opacity=".45"/><circle cx="0" cy="14" r="3.5" fill="#4CAF7D"/>`;
  },
};
P.sparkle = P.star;

/* 徽章小图标(线性,单色重色) */
const ICONS = {
  bolt: '<polygon points="2,-10 -7,2 -1,2 -2,10 7,-2 1,-2" fill="CUR" stroke="CUR" stroke-width="1.5" stroke-linejoin="round"/>',
  search: '<circle cx="-1" cy="-1" r="7" fill="none" stroke="CUR" stroke-width="3"/><line x1="4" y1="4" x2="9" y2="9" stroke="CUR" stroke-width="3.5" stroke-linecap="round"/>',
  lock: '<rect x="-7" y="-2" width="14" height="11" rx="3" fill="CUR"/><path d="M-4,-2 v-2 a4,4 0 0 1 8,0 v2" fill="none" stroke="CUR" stroke-width="2.6"/>',
  shield: '<path d="M0,-9 L8,-6 V1 Q8,8 0,10 Q-8,8 -8,1 V-6 Z" fill="none" stroke="CUR" stroke-width="3" stroke-linejoin="round"/><polyline points="-3,0 0,3 4,-2" fill="none" stroke="CUR" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  refresh: '<path d="M-8,0 a8,8 0 1 1 3,6" fill="none" stroke="CUR" stroke-width="3" stroke-linecap="round"/><polygon points="-9,-6 -3,-6 -8,0" fill="CUR"/>',
  chat: '<rect x="-9" y="-8" width="18" height="13" rx="4" fill="none" stroke="CUR" stroke-width="3"/><path d="M-3,5 L-3,10 L3,5" fill="none" stroke="CUR" stroke-width="3" stroke-linejoin="round"/>',
  clock: '<circle r="8" fill="none" stroke="CUR" stroke-width="3"/><path d="M0,-4 V0 H4" fill="none" stroke="CUR" stroke-width="2.6" stroke-linecap="round"/>',
  star: '<path d="M0,-9 L2.6,-2.8 L9,-2.8 L4,1.4 L5.8,8 L0,4 L-5.8,8 L-4,1.4 L-9,-2.8 L-2.6,-2.8 Z" fill="CUR"/>',
  folder: '<path d="M-9,-6 h6 l3,3 h9 v11 h-18 z" fill="none" stroke="CUR" stroke-width="2.8" stroke-linejoin="round"/>',
  card: '<rect x="-9" y="-7" width="18" height="14" rx="3" fill="none" stroke="CUR" stroke-width="2.8"/><polyline points="-4,0 -1,3 5,-3" fill="none" stroke="CUR" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
};
function iconSvg(name, color) {
  const body = (ICONS[name] || ICONS.bolt).split('CUR').join(color);
  return `<svg width="38" height="38" viewBox="-12 -12 24 24">${body}</svg>`;
}

/* ───────────────────────── 场景 SVG ───────────────────────── */
function robot(t) {
  return `<g>
    <ellipse cy="96" rx="86" ry="12" fill="${t.heavy}" opacity=".08"/>
    <g transform="translate(5,5)" opacity=".3">${robotBody(t, t.focus)}</g>
    ${robotBody(t)}
  </g>`;
}
function robotBody(t, mono) {
  const line = mono || t.heavy;
  return `
    <line x1="0" y1="-104" x2="0" y2="-126" stroke="${line}" stroke-width="4"/>
    <circle cy="-132" r="8" fill="${mono || t.focus}"/>
    <rect x="-62" y="-104" width="124" height="92" rx="22" fill="${mono || '#FFFDF6'}" stroke="${line}" stroke-width="4.5"/>
    <circle cx="-21" cy="-60" r="8.5" fill="${mono || t.focus}"/>
    <circle cx="21" cy="-60" r="8.5" fill="${mono || t.focus}"/>
    <path d="M-13,-38 Q0,-27 13,-38" fill="none" stroke="${line}" stroke-width="4" stroke-linecap="round"/>
    <rect x="-52" y="0" width="104" height="70" rx="16" fill="${mono || '#FFFDF6'}" stroke="${line}" stroke-width="4.5"/>
    <rect x="-20" y="14" width="40" height="26" rx="6" fill="${mono || t.focus}"/>
    <g transform="translate(-72,16) rotate(-28)"><rect x="-9" y="-24" width="18" height="42" rx="9" fill="${mono || '#FFFDF6'}" stroke="${line}" stroke-width="4"/></g>
    <g transform="translate(72,16) rotate(28)"><rect x="-9" y="-24" width="18" height="42" rx="9" fill="${mono || '#FFFDF6'}" stroke="${line}" stroke-width="4"/></g>`;
}

function qMark(x, y, rot, t) {
  return `<text x="${x}" y="${y}" transform="rotate(${rot} ${x} ${y})" text-anchor="middle"
    font-size="46" font-weight="900" fill="${t.red}" font-family="inherit">?</text>`;
}

function scene(t, s3) {
  const W = 941, H = 556, cx = 470, cy = 292;
  const leftSlots = [[96,70,-14,1.08],[224,56,9,.95],[80,288,10,1.02],[218,274,-8,.98],[118,490,12,1.06],[244,472,-11,.95]];
  const rightSlots = [[674,64,-2,1.02],[832,52,2,.95],[658,290,-1,.98],[832,296,1,1.04],[674,484,-2,1.06],[834,480,2,.95]];
  let g = '';
  // 中央索引卡大底:母题锚点,填中部留白(标签台在左上,藏书卡制式)
  g += `<g transform="translate(470,298) rotate(-2)">
    <rect x="-192" y="-178" width="150" height="44" rx="12" fill="${t.heavy}"/>
    <rect x="-192" y="-152" width="384" height="292" rx="16" fill="#FFFDF6" stroke="${t.heavy}" stroke-width="4"/>
    <line x1="-150" y1="-52" x2="150" y2="-52" stroke="${t.heavy}" stroke-width="3" opacity=".14"/>
    <line x1="-150" y1="2" x2="150" y2="2" stroke="${t.heavy}" stroke-width="3" opacity=".14"/>
    <line x1="-150" y1="56" x2="150" y2="56" stroke="${t.heavy}" stroke-width="3" opacity=".14"/>
    <line x1="-150" y1="110" x2="150" y2="110" stroke="${t.heavy}" stroke-width="3" opacity=".14"/>
  </g>`;
  // 虚线流程
  g += `<path d="M30,280 C110,262 190,298 256,280" stroke="${t.heavy}" stroke-width="3.5" fill="none" opacity=".4" stroke-dasharray="9 9"/>
        <path d="M684,278 C760,260 830,296 894,276" stroke="${t.heavy}" stroke-width="3.5" fill="none" opacity=".4" stroke-dasharray="9 9"/>
        <polygon points="908,275 884,265 886,286" fill="${t.heavy}" opacity=".45"/>`;
  // 左乱
  (s3.left || ['ticket', 'paper', 'chat']).forEach((k, i) => {
    const s = leftSlots[i % leftSlots.length], f = P[k] || P.paper;
    g += `<g transform="translate(${s[0]},${s[1]}) rotate(${s[2]}) scale(${s[3]})">${f(t)}</g>`;
  });
  g += qMark(164, 190, -12, t) + qMark(58, 360, 8, t);
  g += `<path d="M36,166 q10,-8 20,0 q10,8 20,0" stroke="${t.heavy}" stroke-width="3" fill="none" opacity=".35"/>
        <path d="M150,344 q10,-8 20,0 q10,8 20,0" stroke="${t.heavy}" stroke-width="3" fill="none" opacity=".3"/>`;
  // 中间机器人(站在索引卡上)
  g += `<g transform="translate(${cx},${cy}) scale(1.08)">${robot(t)}</g>`;
  // 右净
  (s3.right || ['card', 'card', 'star']).forEach((k, i) => {
    const s = rightSlots[i % rightSlots.length], f = P[k] || P.card;
    g += `<g transform="translate(${s[0]},${s[1]}) rotate(${s[2]}) scale(${s[3] || 1})">${f(t)}</g>`;
  });
  g += `<g transform="translate(742,52) scale(.62)" opacity=".9">${P.star(t)}</g>
        <g transform="translate(896,346) scale(.5)" opacity=".85">${P.star(t)}</g>
        <g transform="translate(624,500) scale(.45)" opacity=".8">${P.star(t, t.accents[0])}</g>`;
  // 整体放大一档,压掉四周空带
  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg"><g transform="translate(470.5,278) scale(1.1) translate(-470.5,-278)">${g}</g></svg>`;
}

/* ───────────────────────── 装饰 / 组装 ───────────────────────── */
function deco(t) {
  const st = (x, y, s, c, o) => `<g transform="translate(${x},${y}) scale(${s})" opacity="${o}">${P.star(t, c)}</g>`;
  return `<svg viewBox="0 0 1025 1280" xmlns="http://www.w3.org/2000/svg">
    ${st(46, 106, .42, t.accents[1], .9)}
    ${st(988, 138, .3, t.heavy, .3)}
    ${st(40, 1030, .34, t.accents[0], .7)}
    ${st(884, 1238, .44, t.accents[1], .95)}
    ${st(146, 1242, .28, t.heavy, .3)}
    <circle cx="30" cy="118" r="4" fill="${t.heavy}" opacity=".25"/>
    <circle cx="966" cy="1036" r="4" fill="${t.heavy}" opacity=".25"/>
    <circle cx="584" cy="70" r="4" fill="${t.accents[0]}" opacity=".4"/>
  </svg>`;
}

function badgeHtml(b, theme) {
  const color = theme.accents[b.i % theme.accents.length];
  return `<div class="badge" style="border:4px solid ${color}; transform:rotate(${[-2.5, .8, 2.2][b.i % 3]}deg);">
    ${iconSvg(b.icon, color)}<span class="bt">${esc(b.t)}</span></div>`;
}

/* s3.image / theme.bgImage:AI 底图槽位,存在即用,缺席退回内置 SVG */
function toUrl(abs) { return 'file:///' + encodeURI(abs.replace(/\\/g, '/')); }
function resolveImg(p, baseDir) {
  if (!p) return null;
  const abs = path.isAbsolute(p) ? p : path.join(baseDir, p);
  return fs.existsSync(abs) ? abs : null;
}
function sceneHtml(d, baseDir) {
  const abs = resolveImg(d.s3 && d.s3.image, baseDir);
  if (abs) return `<div class="s3frame"><img src="${toUrl(abs)}"></div>`;
  if (d.s3 && d.s3.image) console.warn('[warn] s3.image 找不到,退回内置 SVG 场景:', d.s3.image);
  return scene(d.theme, d.s3 || {});
}
function bgAttr(d, baseDir) {
  const abs = resolveImg(d.theme.bgImage, baseDir);
  if (!abs) return '';
  return ` style="background-image:url('${toUrl(abs)}');background-size:cover;background-position:center;"`;
}

function fill(d, baseDir) {
  const t = d.theme;
  const cssVars = `--bg:${t.bg}; --focus:${t.focus}; --heavy:${t.heavy}; --cream:${t.cream};` +
    ` --frame:${t.heavy}44; --tline:${t.heavy}24;`;
  const badges = (d.s4 || []).map((b, i) => badgeHtml({ t: b.t || b, icon: b.icon || 'bolt', i }, t)).join('\n');
  const rays = '<span class="ray rl1"></span><span class="ray rl2"></span><span class="ray rl3"></span>';
  const rayr = '<span class="ray rr1"></span><span class="ray rr2"></span><span class="ray rr3"></span>';
  return TEMPLATE
    .replace('{{VARS}}', cssVars)
    .replace('{{COLNAME}}', esc(d.s1.column))
    .replace('{{PRODUCT}}', esc(d.s1.product))
    .replace('{{NO}}', 'No.' + d.s1.no)
    .replace('{{TOTAL}}', d.s1.total)
    .replace('{{T1_CLIP}}', zigzagClip(580, 104))
    .replace('{{T2_CLIP}}', zigzagClip(600, 104))
    .replace('{{PAIN_FS}}', titleFs(d.s2.pain))
    .replace('{{SOLVE_FS}}', titleFs(d.s2.solve))
    .replace('{{PAIN}}', esc(d.s2.pain))
    .replace('{{SOLVE}}', esc(d.s2.solve))
    .replace('{{SCENE_SVG}}', sceneHtml(d, baseDir))
    .replace('{{BADGES}}', badges)
    .replace('{{GOLD}}', esc(d.s5))
    .replace('{{CTA}}', esc(d.s6.cta))
    .replace('{{RAYS_L}}', rays)
    .replace('{{RAYS_R}}', rayr)
    .replace('{{DECO_SVG}}', deco(t))
    .replace('{{POSTER_BG}}', bgAttr(d, baseDir));
}

/* ───────────────────────── Edge 截图 ───────────────────────── */
function findEdge() {
  const cands = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  throw new Error('未找到 msedge.exe');
}

function shoot(htmlPath, pngPath, w, h) {
  const prof = path.join(os.tmpdir(), 'xc-poster-edge-profile');
  const args = [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--disable-extensions', '--hide-scrollbars', '--force-device-scale-factor=1',
    `--user-data-dir=${prof}`, `--window-size=${w},${h}`, '--virtual-time-budget=5000',
    `--screenshot=${pngPath}`,
    'file:///' + encodeURI(htmlPath.replace(/\\/g, '/')),
  ];
  const r = cp.spawnSync(findEdge(), args, { timeout: 90000, stdio: 'ignore' });
  if (r.error) throw r.error;
  if (!fs.existsSync(pngPath) || fs.statSync(pngPath).size < 8000) throw new Error('截图失败: ' + pngPath);
}

/* ───────────────────────── 主流程 ───────────────────────── */
function renderOne(jsonPath, outPath, alsoHtml) {
  const d = loadJson(jsonPath);
  const html = fill(d, path.dirname(jsonPath));
  const htmlPath = outPath.replace(/\.png$/i, '') + '.html';
  fs.writeFileSync(htmlPath, html, 'utf8');
  if (!alsoHtml) shoot(htmlPath, outPath, 1025, 1280);
  console.log('OK', path.basename(outPath));
}

function main() {
  const argv = process.argv.slice(2);
  const alsoHtml = argv.includes('--html');
  const rest = argv.filter(a => !a.startsWith('--'));
  if (!rest.length) { console.log('用法: node render.js [--html] <poster.json|目录>'); process.exit(1); }
  const input = path.resolve(rest[0]);
  const outArg = rest[1] ? path.resolve(rest[1]) : null;

  if (fs.statSync(input).isDirectory()) {
    const jsons = fs.readdirSync(input).filter(f => f.endsWith('.json') && f !== 'base.json');
    if (!jsons.length) { console.log('目录里没有 poster json'); process.exit(1); }
    for (const f of jsons) {
      const jp = path.join(input, f);
      const out = outArg ? path.join(outArg, f.replace(/\.json$/i, '.png')) : jp.replace(/\.json$/i, '.png');
      renderOne(jp, out, alsoHtml);
    }
  } else {
    const out = outArg || input.replace(/\.json$/i, '.png');
    renderOne(input, out, alsoHtml);
  }
}
main();
