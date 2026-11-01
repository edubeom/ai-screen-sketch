// 전역 단축키. 입력창을 고치는 중에는 지우기·방향키 등을 가로채지 않는다.
import { getState, redo, setState, undo } from './store.ts';
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  fitScreen,
  groupSelection,
  nudge,
  paste,
  selectAll,
  setTool,
  ungroupSelection,
  zoomTo,
} from './actions.ts';
import { saveNow } from './persistence.ts';

function typing(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  return !!el.closest?.('input, textarea, select, [contenteditable="true"]');
}

export function installKeyboard() {
  window.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    // 저장은 어디서나
    if (mod && k === 's') {
      e.preventDefault();
      void saveNow();
      return;
    }
    if (typing(e.target)) return;
    if (document.querySelector('.modal-back')) return;
    const s = getState();

    if (mod && k === 'z') {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && k === 'y') {
      e.preventDefault();
      redo();
      return;
    }
    if (mod && k === 'c') return copySelection();
    if (mod && k === 'x') return cutSelection();
    if (mod && k === 'v') return paste();
    if (mod && k === 'd') {
      e.preventDefault();
      return duplicateSelection();
    }
    if (mod && k === 'a') {
      e.preventDefault();
      return selectAll();
    }
    if (mod && k === 'g') {
      e.preventDefault();
      return e.shiftKey ? ungroupSelection() : groupSelection();
    }
    if (mod && (k === '=' || k === '+')) {
      e.preventDefault();
      return zoomTo(s.zoom * 1.25);
    }
    if (mod && k === '-') {
      e.preventDefault();
      return zoomTo(s.zoom / 1.25);
    }
    if (mod && k === '0') {
      e.preventDefault();
      return zoomTo(1);
    }
    if (mod) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      return deleteSelection();
    }
    if (e.key.startsWith('Arrow')) {
      if (!s.selection.length) return;
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      return nudge(dx, dy);
    }
    if (e.key === 'Escape') {
      if (s.pickingTargetFor) return setState({ pickingTargetFor: undefined });
      if (s.tool !== 'select') return setTool('select');
      if (s.enteredGroup) return setState({ selection: [s.enteredGroup], enteredGroup: undefined });
      return setState({ selection: [] });
    }
    if (e.key === '!' || (e.shiftKey && e.code === 'Digit1')) return fitScreen();
    if (k === 'v') return setTool('select');
    if (k === 'p') return setTool('pen');
    if (k === 'e') return setTool('eraser');
    if (k === 'l') return setTool('connect');
  });
}
