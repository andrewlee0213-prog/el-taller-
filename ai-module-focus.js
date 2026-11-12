/* Promote the live dashboard node into a native dialog; never clone interactive controls. */
(function (root) {
  'use strict';
  function create({ document:doc = root.document, onOpen = () => {}, onClose = () => {} } = {}) {
    const dialog = doc.getElementById('aiModuleDialog'), body = doc.getElementById('aiModuleBody');
    const title = doc.getElementById('aiModuleTitle'), select = doc.getElementById('aiModuleSelect');
    const closeButton = doc.getElementById('aiModuleClose'), modules = new Map();
    let active = null, returnFocus = null, pointerDownOutside = false;
    const interactive = 'a,button,input,textarea,select,option,label,summary,details,[contenteditable],.item,.hw-link,.calday,[data-mjump]';
    function outside(event) {
      const rect = dialog.getBoundingClientRect();
      return event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom;
    }
    function restore() {
      if (!active) return;
      const saved = active;
      saved.node.classList.remove('ai-module-expanded');
      saved.button.setAttribute('aria-expanded', 'false');
      if (saved.placeholder.parentNode) saved.placeholder.replaceWith(saved.node);
      else saved.parent.insertBefore(saved.node, saved.next && saved.next.parentNode === saved.parent ? saved.next : null);
      active = null;
      for (const item of saved.scrollPositions) item.node.scrollTop = item.top;
    }
    function open(key, trigger) {
      const item = modules.get(key);
      if (!item || active && active.key === key) return;
      const switching = !!active;
      if (!switching) returnFocus = trigger || item.button;
      restore();
      const rect = item.node.getBoundingClientRect(), placeholder = doc.createElement('div');
      placeholder.className = 'ai-module-placeholder';placeholder.setAttribute('aria-hidden', 'true');
      placeholder.style.height = Math.max(0, rect.height) + 'px';
      const scrollPositions = [item.node, ...item.node.querySelectorAll('.cbody,.ilist,.loglist,.memolist,.caldetail,.ai-info-sources')].map(node => ({ node, top:node.scrollTop }));
      active = { ...item, key, placeholder, parent:item.node.parentNode, next:item.node.nextSibling, scrollPositions };
      item.node.before(placeholder);body.append(item.node);item.node.classList.add('ai-module-expanded');
      item.button.setAttribute('aria-expanded', 'true');title.textContent = item.label;select.value = key;body.scrollTop = 0;
      doc.body.classList.add('ai-module-open');
      if (!dialog.open) {
        try { dialog.showModal(); }
        catch (error) { restore();doc.body.classList.remove('ai-module-open');throw error; }
      }
      onOpen(key);closeButton.focus({ preventScroll:true });
    }
    function close() { if (dialog.open) dialog.close(); }
    function register(key, node, label, kind) {
      if (!node || modules.has(key)) return;
      node.classList.add('ai-peripheral');node.dataset.moduleKey = key;node.dataset.moduleKind = kind || key;
      const button = doc.createElement('button');
      button.type = 'button';button.className = 'ai-module-expand';button.setAttribute('aria-label', '放大查看：' + label);
      button.setAttribute('aria-haspopup', 'dialog');button.setAttribute('aria-controls', dialog.id);button.setAttribute('aria-expanded', 'false');
      button.title = '放大查看完整内容';
      const text = doc.createElement('span');text.textContent = '放大';
      const glyph = doc.createElement('span');glyph.textContent = '↗';glyph.setAttribute('aria-hidden', 'true');
      button.append(text, glyph);node.prepend(button);
      modules.set(key, { node, label, button });
      const option = doc.createElement('option');option.value = key;option.textContent = label;select.append(option);
      button.addEventListener('click', event => { event.stopPropagation();open(key, button); });
      node.addEventListener('click', event => {
        if (dialog.open || event.defaultPrevented || event.button > 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
        const control = event.target.closest(interactive);
        if (control && node.contains(control)) return;
        const selection = doc.getSelection && doc.getSelection();
        if (selection && !selection.isCollapsed) return;
        open(key, button);
      });
    }
    doc.addEventListener('click', event => {
      if (dialog.open && event.target.closest('#hwAtlasBtn')) close();
    }, true);
    closeButton.addEventListener('click', close);
    select.addEventListener('change', () => open(select.value));
    dialog.addEventListener('pointerdown', event => { pointerDownOutside = event.target === dialog && outside(event); });
    dialog.addEventListener('click', event => {
      if (event.target === dialog && pointerDownOutside && outside(event)) close();
      pointerDownOutside = false;
    });
    dialog.addEventListener('cancel', event => { event.preventDefault();close(); });
    dialog.addEventListener('close', () => {
      restore();doc.body.classList.remove('ai-module-open');onClose();
      if (returnFocus && returnFocus.isConnected) returnFocus.focus({ preventScroll:true });
      returnFocus = null;
    });
    return Object.freeze({ register, open, close, get activeKey() { return active && active.key; } });
  }
  root.AiModuleFocus = Object.freeze({ create });
  if (typeof module === 'object' && module.exports) module.exports = root.AiModuleFocus;
})(typeof globalThis !== 'undefined' ? globalThis : this);
