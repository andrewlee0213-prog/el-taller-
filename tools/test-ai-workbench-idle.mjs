/* Virtual-clock regression for the edge-reveal focus mode. No server, network, credentials or browser. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url), { create, fitCore } = require('../ai-workbench-idle.js');
class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, fn) { if (!this.listeners.has(name)) this.listeners.set(name, new Set()); this.listeners.get(name).add(fn); }
  removeEventListener(name, fn) { this.listeners.get(name)?.delete(fn); }
  emit(name, detail = {}) { for (const fn of [...(this.listeners.get(name) || [])]) fn({ type:name, ...detail }); }
}
function fixture({ populatedCore = true } = {}) {
  let time = 0, id = 0, dialog = false, overlay = false, noteDisplay = 'none', coreVisible = true, selected = false;
  const timers = new Map(), classes = new Set(), coreStyles = new Map();
  const core = { getClientRects: () => coreVisible ? [{}] : [],
    getBoundingClientRect: () => ({ left:350, top:300, width:700, height:550 }),
    style: { setProperty:(key, value) => coreStyles.set(key, value) } };
  const regions = Array.from({ length:4 }, () => ({ inert:false, contains:node => node && node.region === true }));
  const doc = new Events(), win = new Events();
  doc.hidden = false; doc.activeElement = null; win.innerWidth = 1440; win.innerHeight = 900;
  doc.body = { classList:{ add:key => classes.add(key), remove:key => classes.delete(key) } };
  doc.querySelectorAll = () => regions;
  doc.querySelector = () => dialog || overlay ? {} : null;
  doc.getElementById = key => key === 'ai-main' ? core : key === 'kbinMask' ? { style:{ display:noteDisplay } } : null;
  doc.getSelection = () => ({ isCollapsed:!selected, anchorNode:selected ? { region:true } : null, focusNode:null });
  win.setTimeout = (fn, delay) => { const token = ++id; timers.set(token, { fn, at:time + delay }); return token; };
  win.clearTimeout = token => timers.delete(token);
  const idle = create({ document:doc, window:win, now:() => time });
  function advance(ms) { const end = time + ms; while (true) { const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0]; if (!next || next[1].at > end) break; time = next[1].at; timers.delete(next[0]); next[1].fn(); } time = end; }
  return { doc, win, idle, regions, classes, core, coreStyles, timers, advance,
    setDialog:v => dialog = v, setOverlay:v => overlay = v, setNote:v => noteDisplay = v,
    setCore:v => coreVisible = v, setSelection:v => selected = v };
}
let passed = 0; function test(name, fn) { const f = fixture(); fn(f); passed++; console.log('PASS ' + name); }
test('opens in focus mode: panels hidden and core fitted without waiting', f => {
  assert.equal(f.idle.hidden, true); assert(f.regions.every(x => x.inert));
  assert(Number(f.coreStyles.get('--ai-idle-core-scale')) > 1);
});
test('pointer near a screen edge reveals the panels at once', f => {
  f.doc.emit('pointermove', { clientX:8, clientY:450 }); assert.equal(f.idle.hidden, false);
  assert(f.regions.every(x => !x.inert));
});
test('moving to the center collapses the panels after the grace delay', f => {
  f.doc.emit('pointermove', { clientX:8, clientY:450 });
  f.doc.emit('pointermove', { clientX:720, clientY:450 }); assert.equal(f.idle.hidden, false);
  f.advance(699); assert.equal(f.idle.hidden, false); f.advance(1); assert.equal(f.idle.hidden, true);
});
test('hovering over a revealed panel keeps it shown far from the edge', () => {
  for (const hit of ['ai-sidebar', 'ai-data-strip', 'ai-topbar']) {
    const f = fixture();
    const target = { closest:selector => selector.includes(hit) ? {} : null };
    f.doc.emit('pointermove', { clientX:8, clientY:450 });
    f.doc.emit('pointermove', { clientX:150, clientY:500, target }); f.advance(5000);
    assert.equal(f.idle.hidden, false, hit);
    assert.equal(f.timers.size, 0, hit + ' no pending collapse while hovering');
  }
});
test('the bottom edge does not reveal the panels (chat input lives there)', f => {
  f.doc.emit('pointermove', { clientX:720, clientY:894 }); f.advance(3000);
  assert.equal(f.idle.hidden, true);
  f.doc.emit('pointermove', { clientX:8, clientY:450 }); assert.equal(f.idle.hidden, false);
  f.doc.emit('pointermove', { clientX:720, clientY:800 }); f.advance(699);
  assert.equal(f.idle.hidden, false); f.advance(1); assert.equal(f.idle.hidden, true);
});
test('leaving the panel back to the middle collapses after the grace delay', f => {
  const board = { closest:selector => selector.includes('ai-sidebar') ? {} : null };
  f.doc.emit('pointermove', { clientX:8, clientY:450 });
  f.doc.emit('pointermove', { clientX:150, clientY:500, target:board }); f.advance(3000);
  assert.equal(f.idle.hidden, false);
  f.doc.emit('pointermove', { clientX:720, clientY:450 });
  f.advance(699); assert.equal(f.idle.hidden, false); f.advance(1); assert.equal(f.idle.hidden, true);
});
test('returning to the edge before the grace elapses cancels the collapse', f => {
  f.doc.emit('pointermove', { clientX:8, clientY:450 });
  f.doc.emit('pointermove', { clientX:720, clientY:450 }); f.advance(400);
  f.doc.emit('pointermove', { clientX:1436, clientY:450 }); f.advance(2000);
  assert.equal(f.idle.hidden, false);
});
test('peripheral form focus keeps panels; focus back in the core collapses again', f => {
  f.doc.emit('pointermove', { clientX:8, clientY:450 });
  f.doc.activeElement = { region:true, matches:() => true };
  f.doc.emit('pointermove', { clientX:720, clientY:450 }); f.advance(3000);
  assert.equal(f.idle.hidden, false);
  f.doc.activeElement = { region:false, matches:() => true };
  f.doc.emit('focusout'); f.advance(700); assert.equal(f.idle.hidden, true);
});
test('open dialogs and legacy overlays keep revealed panels visible without edge proximity', f => {
  f.doc.emit('pointermove', { clientX:8, clientY:450 }); assert.equal(f.idle.hidden, false);
  for (const block of ['dialog', 'overlay', 'note']) {
    if (block === 'dialog') f.setDialog(true); if (block === 'overlay') f.setOverlay(true); if (block === 'note') f.setNote('flex');
    f.doc.emit('pointermove', { clientX:720, clientY:450 }); f.advance(5000);
    assert.equal(f.idle.hidden, false, block);
    if (block === 'dialog') f.setDialog(false); if (block === 'overlay') f.setOverlay(false); if (block === 'note') f.setNote('none');
    f.doc.emit('pointermove', { clientX:8, clientY:450 }); assert.equal(f.idle.hidden, false);
  }
});
test('a dialog open before reveal leaves focus mode intact (dialog is a top layer)', () => {
  const plain = fixture(); plain.setDialog(true); plain.advance(5000);
  assert.equal(plain.idle.hidden, true);
});
test('clicking core blank space collapses immediately without a timer', f => {
  const target = { closest:selector => selector === '#ai-main' ? f.core : null };
  f.doc.emit('click', { target, button:0 });
  assert.equal(f.idle.hidden, true); assert.equal(f.timers.size, 0);
});
test('with panels revealed, core controls, transcript and modified clicks keep them visible', () => {
  for (const control of ['button', 'textarea', 'a', '.ai-compose-wrap', '.ai-transcript', '.ai-stage-note']) {
    const f = fixture(); f.doc.emit('pointermove', { clientX:8, clientY:450 }); assert.equal(f.idle.hidden, false);
    const target = { closest:selector => selector === '#ai-main' ? f.core : selector.includes(control) ? {} : null };
    f.doc.emit('click', { target, button:0 }); assert.equal(f.idle.hidden, false, control);
  }
  for (const detail of [{ button:2 }, { ctrlKey:true }, { metaKey:true }, { defaultPrevented:true }]) {
    const f = fixture(); f.doc.emit('pointermove', { clientX:8, clientY:450 });
    const target = { closest:selector => selector === '#ai-main' ? f.core : null };
    f.doc.emit('click', { target, button:0, ...detail }); assert.equal(f.idle.hidden, false);
  }
});
test('clicks outside the core while revealed do nothing; selection keeps panels too', f => {
  f.doc.emit('pointermove', { clientX:8, clientY:450 }); assert.equal(f.idle.hidden, false);
  f.doc.emit('click', { target:{ closest:() => null }, button:0 }); assert.equal(f.idle.hidden, false);
  f.setSelection(true); f.doc.emit('click', { target:{ closest:selector => selector === '#ai-main' ? f.core : null }, button:0 });
  assert.equal(f.idle.hidden, false);
});
test('clicking a core control while hidden stays in focus mode', f => {
  const target = { closest:selector => selector === '#ai-main' ? f.core : selector.includes('button') ? {} : null };
  f.doc.emit('click', { target, button:0 }); assert.equal(f.idle.hidden, true);
});
test('typing in a peripheral form keeps panels while typing continues', f => {
  f.doc.emit('pointermove', { clientX:8, clientY:450 });
  f.doc.activeElement = { region:true, matches:() => true };
  f.doc.emit('input'); assert.equal(f.idle.hidden, false);
});
test('hidden tab pauses collapse; returning collapses after pointer leaves the edge', f => {
  f.doc.emit('pointermove', { clientX:8, clientY:450 }); assert.equal(f.idle.hidden, false);
  f.doc.hidden = true; f.doc.emit('visibilitychange'); assert.equal(f.timers.size, 0);
  f.advance(60000); assert.equal(f.idle.hidden, false);
  f.doc.hidden = false; f.doc.emit('visibilitychange');
  assert.equal(f.idle.hidden, false); // pointer still at the edge: panels stay
  f.doc.emit('pointermove', { clientX:720, clientY:450 });
  f.advance(699); assert.equal(f.idle.hidden, false); f.advance(1); assert.equal(f.idle.hidden, true);
});
test('resize while hidden refits the core and stays in focus mode', f => {
  const before = f.coreStyles.get('--ai-idle-core-scale');
  f.win.innerWidth = 1200; f.win.innerHeight = 700; f.win.emit('resize');
  assert.equal(f.idle.hidden, true); assert.notEqual(f.coreStyles.get('--ai-idle-core-scale'), before);
});
test('destroy reveals panels and cancels pending collapse', f => {
  f.doc.emit('pointermove', { clientX:8, clientY:450 }); f.idle.destroy();
  assert.equal(f.idle.hidden, false); assert(f.regions.every(x => !x.inert));
  f.advance(60000); assert.equal(f.idle.hidden, false); assert.equal(f.timers.size, 0);
});
test('core fits desktop, short and mobile viewports and stays centered', () => {
  for (const [rect, viewport] of [
    [{ left:521, top:326, width:1081, height:832 }, { width:2187, height:1182 }],
    [{ left:350, top:300, width:700, height:550 }, { width:1440, height:900 }],
    [{ left:10, top:760, width:355, height:700 }, { width:390, height:844 }],
  ]) {
    const fit = fitCore(rect, viewport); assert(fit && fit.scale > 0 && fit.scale <= 1.65);
    const left = rect.left + fit.x, top = rect.top + fit.y;
    assert(left >= 0 && top >= 0); assert(left + rect.width * fit.scale <= viewport.width);
    assert(top + rect.height * fit.scale <= viewport.height);
    assert(Math.abs(left + rect.width * fit.scale / 2 - viewport.width / 2) < .001);
    assert(Math.abs(top + rect.height * fit.scale / 2 - viewport.height / 2) < .001);
  }
  assert.equal(fitCore({ left:0, top:0, width:0, height:10 }, { width:100, height:100 }), null);
});
console.log('RESULT ' + passed + ' edge-reveal checks passed; not a GUI or real model test.');
