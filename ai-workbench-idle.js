/* Focus mode is the default: data panels reveal only while the pointer is near a screen edge. */
(function (root) {
  'use strict';
  const EDGE = 160, GRACE = 700;
  function fitCore(rect, viewport) {
    if (!rect || !viewport || ![rect.left, rect.top, rect.width, rect.height, viewport.width, viewport.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return null;
    const gap = Math.min(32, Math.max(12, viewport.width * .02));
    const scale = Math.min(1.65, (viewport.width - gap * 2) / rect.width, (viewport.height - gap * 2) / rect.height);
    if (scale <= 0) return null;
    return { scale, x:(viewport.width - rect.width * scale) / 2 - rect.left, y:(viewport.height - rect.height * scale) / 2 - rect.top };
  }
  function create({ document:doc = root.document, window:win = root } = {}) {
    const regions = Array.from(doc.querySelectorAll('.ai-topbar,.ai-data-strip,.ai-sidebar,.ai-mobile-tabs'));
    const originalInert = new Map(regions.map(node => [node, node.inert]));
    let hideTimer = null, shown = true, disposed = false, lastX = null, lastY = null;
    let instance = null;
    const listeners = [];
    function listen(target, name, callback, options) { target.addEventListener(name, callback, options); listeners.push([target, name, callback, options]); }
    function clearHide() { if (hideTimer !== null) { win.clearTimeout(hideTimer); hideTimer = null; } }
    function show() {
      clearHide();
      if (disposed || shown) return;
      shown = true; doc.body.classList.remove('ai-idle');
      regions.forEach(node => { node.inert = originalInert.get(node); });
    }
    function blocked() {
      if (doc.querySelector('dialog[open],.atl-mask.on')) return true;
      const note = doc.getElementById('kbinMask');
      if (note && note.style.display && note.style.display !== 'none') return true;
      const core = doc.getElementById('ai-main');
      if (!core || !core.getClientRects().length) return true;
      const active = doc.activeElement;
      if (active && regions.some(node => node.contains(active)) &&
          active.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])')) return true;
      const selection = doc.getSelection && doc.getSelection();
      return !!(selection && !selection.isCollapsed && regions.some(node => node.contains(selection.anchorNode) || node.contains(selection.focusNode)));
    }
    /* 呼出区=上、左、右三边（站主指定）；底部留给对话输入框，避免点输入框时看板冒出 */
    function inZone(x, y) {
      return Number.isFinite(x) && Number.isFinite(y) &&
        (x <= EDGE || y <= EDGE || x >= win.innerWidth - EDGE);
    }
    /* 悬停在外围信息区（含信息看板）时保持显示；隐藏态这些区域 pointer-events:none + inert，不会成为事件目标 */
    function overRevealRegion(target) {
      return !!(target && typeof target.closest === 'function' && target.closest('.ai-topbar,.ai-data-strip,.ai-sidebar,.ai-mobile-tabs'));
    }
    function applyCoreFit() {
      const core = doc.getElementById('ai-main');
      if (!core) return;
      let rect = core.getBoundingClientRect();
      const style = win.getComputedStyle ? win.getComputedStyle(core) : null;
      if (style && root.DOMMatrixReadOnly) {
        const matrix = new root.DOMMatrixReadOnly(style.transform === 'none' ? '' : style.transform);
        if (matrix.a > 0 && matrix.d > 0 && matrix.b === 0 && matrix.c === 0) {
          rect = { left:rect.left - matrix.e, top:rect.top - matrix.f, width:rect.width / matrix.a, height:rect.height / matrix.d };
        }
      }
      const fit = fitCore(rect, { width:win.innerWidth, height:win.innerHeight });
      if (fit) {
        core.style.setProperty('--ai-idle-core-scale', String(fit.scale));
        core.style.setProperty('--ai-idle-core-x', fit.x + 'px');
        core.style.setProperty('--ai-idle-core-y', fit.y + 'px');
      }
    }
    function hide() {
      if (disposed || !shown || blocked()) return;
      applyCoreFit();
      shown = false; doc.body.classList.add('ai-idle');
      regions.forEach(node => { node.inert = true; });
    }
    function scheduleHide(delay) {
      if (disposed || !shown) return;
      if (inZone(lastX, lastY) || blocked()) return;
      clearHide();
      hideTimer = win.setTimeout(() => { hideTimer = null; hide(); }, delay);
    }
    function handlePointer(event) {
      if (disposed) return;
      lastX = event.clientX; lastY = event.clientY;
      if (inZone(lastX, lastY) || overRevealRegion(event && event.target)) show();
      else scheduleHide(GRACE);
    }
    function handleFocus() {
      if (disposed) return;
      const active = doc.activeElement;
      if (active && regions.some(node => node.contains(active))) show();
      else scheduleHide(GRACE);
    }
    function handleInput() {
      if (disposed) return;
      const active = doc.activeElement;
      if (active && regions.some(node => node.contains(active))) show();
    }
    function handleSelection() {
      if (disposed) return;
      const selection = doc.getSelection && doc.getSelection();
      if (selection && !selection.isCollapsed && regions.some(node => node.contains(selection.anchorNode) || node.contains(selection.focusNode))) show();
    }
    function blankCoreClick(event) {
      if (disposed || event.defaultPrevented || event.button > 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
      const target = event.target;
      if (!target || typeof target.closest !== 'function' || !target.closest('#ai-main')) return;
      if (target.closest('a,button,input,textarea,select,label,summary,details,[contenteditable],[role="button"],.ai-compose-wrap,.ai-transcript,.ai-stage-heading,.ai-stage-note')) return;
      const selection = doc.getSelection && doc.getSelection();
      if (selection && !selection.isCollapsed) return;
      hide();
    }
    function handleVisibility() {
      if (doc.hidden) clearHide();
      else scheduleHide(GRACE);
    }
    function handleResize() { if (!shown) applyCoreFit(); }
    function destroy() {
      if (disposed) return;
      disposed = true; clearHide(); show();
      listeners.forEach(([target, name, callback, options]) => target.removeEventListener(name, callback, options));
    }
    ['pointermove', 'touchstart'].forEach(name => listen(doc, name, handlePointer, { capture:true, passive:true }));
    listen(doc, 'click', blankCoreClick);
    listen(doc, 'focusin', handleFocus, true);
    listen(doc, 'focusout', () => scheduleHide(GRACE), true);
    listen(doc, 'input', handleInput, true);
    listen(doc, 'selectionchange', handleSelection, true);
    listen(doc, 'visibilitychange', handleVisibility);
    listen(win, 'resize', handleResize);
    listen(win, 'blur', () => scheduleHide(GRACE));
    listen(win, 'workbench:layout', () => hide());
    listen(win, 'pagehide', destroy, { once:true });
    applyCoreFit(); hide();
    instance = { destroy, get hidden() { return !shown; } };
    return Object.freeze(instance);
  }
  root.AiWorkbenchIdle = Object.freeze({ create });
  if (typeof module === 'object' && module.exports) module.exports = { create, fitCore };
  else root.addEventListener('workbench:ready', () => create(), { once:true });
})(typeof globalThis !== 'undefined' ? globalThis : this);
