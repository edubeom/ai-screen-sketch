// 펜 옆 버튼 두 개에 기능 붙이기 (VEIKK 등).
// 브라우저는 펜 버튼을 "포인터 버튼(오른쪽=2 · 가운데=1 · 지우개=5)" 또는 드라이버가 바꿔 준 "키보드 키"로만 받는다.
// 그래서 버튼마다 받을 입력을 등록(학습)해 두고, 짧게 1·2·3번 누른 횟수로 기능을 고른다.
import { getState, loadPref, redo, savePref, setState, toast, undo } from './store.ts';
import { eyedropAt, getCanvasApi, setTool, toggleEraser } from './actions.ts';

export type PenSlot = 'far' | 'near';
export type PenBinding = { kind: 'pointer'; button: number; pointerType: string } | { kind: 'key'; code: string };

/** 펜촉에서 먼 버튼 · 가까운 버튼의 기본값 (Windows Ink 펜: 옆 버튼 = 2, 지우개/둘째 버튼 = 5 또는 1) */
export const DEFAULT_BINDINGS: Record<PenSlot, PenBinding[]> = {
  far: [
    { kind: 'pointer', button: 5, pointerType: 'pen' },
    { kind: 'pointer', button: 1, pointerType: 'pen' },
  ],
  near: [{ kind: 'pointer', button: 2, pointerType: 'pen' }],
};

export const SLOT_LABELS: Record<PenSlot, string> = { far: '펜촉에서 먼 버튼', near: '펜촉에 가까운 버튼' };

export const SLOT_ACTIONS: Record<PenSlot, [string, string, string]> = {
  far: ['채우기 (누른 뒤 모형·바탕을 누름)', '커서 자리에 색 팝업', '커서 자리 색 가져오기'],
  near: ['실행 취소', '다시 실행', '지우개 ↔ 이전 도구'],
};

const MULTI_PRESS_MS = 330;
const BIT: Record<number, number> = { 0: 1, 1: 4, 2: 2, 3: 8, 4: 16, 5: 32 };

let bindings: Record<PenSlot, PenBinding[]> = loadPref('penButtons', DEFAULT_BINDINGS);
let learning: PenSlot | undefined;
let lastInput = '';
const lastPointer = { x: 200, y: 200 };
let lastBoundAt = 0;
const counters: Record<PenSlot, { n: number; timer?: ReturnType<typeof setTimeout> }> = { far: { n: 0 }, near: { n: 0 } };

type Listener = () => void;
const listeners = new Set<Listener>();
const notify = () => listeners.forEach((l) => l());
export function subscribePen(l: Listener) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export function penState() {
  return { bindings, learning, lastInput };
}

export function describeBinding(b: PenBinding): string {
  if (b.kind === 'key') return `키보드 ${b.code}`;
  const name = { 1: '가운데 버튼', 2: '오른쪽(옆) 버튼', 3: '뒤로 버튼', 4: '앞으로 버튼', 5: '지우개 버튼' }[b.button] ?? `버튼 ${b.button}`;
  return `${b.pointerType === 'pen' ? '펜' : b.pointerType === 'mouse' ? '마우스' : b.pointerType} ${name}`;
}

export function startLearning(slot: PenSlot | undefined) {
  learning = slot;
  notify();
}

export function resetBindings() {
  bindings = DEFAULT_BINDINGS;
  savePref('penButtons', bindings);
  notify();
}

function learn(b: PenBinding) {
  if (!learning) return;
  const other: PenSlot = learning === 'far' ? 'near' : 'far';
  const same = (x: PenBinding) => JSON.stringify(x) === JSON.stringify(b);
  bindings = { ...bindings, [learning]: [b], [other]: bindings[other].filter((x) => !same(x)) };
  savePref('penButtons', bindings);
  toast(`${SLOT_LABELS[learning]}: ${describeBinding(b)} 로 등록했습니다`);
  learning = undefined;
  notify();
}

function slotFor(b: PenBinding): PenSlot | undefined {
  for (const slot of ['far', 'near'] as const) {
    if (bindings[slot].some((x) => (x.kind === 'key' && b.kind === 'key' ? x.code === b.code : x.kind === 'pointer' && b.kind === 'pointer' && x.button === b.button && x.pointerType === b.pointerType))) return slot;
  }
  return undefined;
}

/** 버튼 누름 한 번 -- 잠깐 기다렸다가 몇 번 눌렀는지로 기능을 고른다 */
export function pressSlot(slot: PenSlot) {
  const c = counters[slot];
  c.n += 1;
  clearTimeout(c.timer);
  c.timer = setTimeout(() => {
    const n = Math.min(3, c.n);
    c.n = 0;
    runSlot(slot, n as 1 | 2 | 3);
  }, MULTI_PRESS_MS);
}

export function runSlot(slot: PenSlot, count: 1 | 2 | 3) {
  lastInput = `${SLOT_LABELS[slot]} ${count}번 → ${SLOT_ACTIONS[slot][count - 1]}`;
  notify();
  if (slot === 'near') {
    if (count === 1) undo();
    else if (count === 2) redo();
    else {
      toggleEraser();
      toast(getState().tool === 'eraser' ? '지우개' : '이전 도구로 돌아왔습니다');
    }
    return;
  }
  if (count === 1) {
    setTool('fill');
    setState({ fillOnce: true });
    toast('채우기: 칠할 모형이나 바탕을 누르세요');
  } else if (count === 2) {
    setState({ colorPopup: { ...lastPointer } });
  } else {
    const api = getCanvasApi();
    if (api) eyedropAt(api.toWorld(lastPointer.x, lastPointer.y));
  }
}

function typing(t: EventTarget | null) {
  return !!(t as HTMLElement | null)?.closest?.('input, textarea, select, [contenteditable="true"]');
}

function onPointerPress(e: PointerEvent, button: number) {
  const b: PenBinding = { kind: 'pointer', button, pointerType: e.pointerType };
  if (learning) {
    learn(b);
  } else {
    const slot = slotFor(b);
    if (!slot) return;
    pressSlot(slot);
  }
  lastBoundAt = Date.now();
  e.preventDefault();
  e.stopImmediatePropagation();
}

export function installPenButtons() {
  // 캡처 단계에서 먼저 받아 작업판의 이동(pan)·선택으로 넘어가지 않게 한다
  window.addEventListener(
    'pointerdown',
    (e) => {
      lastPointer.x = e.clientX;
      lastPointer.y = e.clientY;
      if (e.button > 0) onPointerPress(e, e.button);
    },
    true,
  );
  window.addEventListener(
    'pointermove',
    (e) => {
      lastPointer.x = e.clientX;
      lastPointer.y = e.clientY;
      // 펜이 닿은 채로 옆 버튼을 누르면 pointerdown 없이 button 이 바뀐 pointermove 로 온다
      if (e.button > 0 && e.buttons & (BIT[e.button] ?? 0)) onPointerPress(e, e.button);
    },
    true,
  );
  window.addEventListener(
    'keydown',
    (e) => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key) || e.repeat) return;
      if (learning) {
        if (e.key === 'Escape') return startLearning(undefined);
        learn({ kind: 'key', code: e.code });
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      if (typing(e.target)) return;
      const slot = slotFor({ kind: 'key', code: e.code });
      if (!slot) return;
      pressSlot(slot);
      e.preventDefault();
      e.stopImmediatePropagation();
    },
    true,
  );
  // 펜 버튼이 마우스 오른쪽 클릭으로 오면 메뉴가 뜨지 않게
  window.addEventListener('contextmenu', (e) => {
    if (learning || Date.now() - lastBoundAt < 1000) e.preventDefault();
  });
  window.addEventListener('auxclick', (e) => {
    if (Date.now() - lastBoundAt < 1000) e.preventDefault();
  });
}
