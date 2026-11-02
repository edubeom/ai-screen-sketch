// 작업판: 선택·이동·크기 조절·영역 선택·확대/축소·이동(pan)·펜·지우개·동작 연결.
// 모든 포인터 좌표는 SVG 의 CTM 역행렬로 화면 좌표로 바꾼다 -- 확대·축소해도 펜 좌표가 어긋나지 않는다.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import {
  addStroke,
  addElements,
  connectorEnds,
  connectorFromEnds,
  createElement,
  deleteElements,
  hitAt,
  inCenter,
  recognizeShape,
  SHAPE_LABELS,
  deleteStroke,
  interactionTargetProblem,
  mapScreen,
  moveElements,
  newId,
  normRect,
  rectsIntersect,
  resizeElement,
  snap,
  sortedElements,
  strokeHit,
  updateElement,
  type ElementType,
  type Interaction,
  type PresetKey,
  type Rect,
  type Screen,
  type SketchElement,
  type Stroke,
  type StrokePoint,
} from '@sketch/core';
import { arrowMarkers } from '@sketch/exporters';
import { ElementView, StrokeView } from './ElementView.tsx';
import {
  beginGesture,
  currentScreen,
  endGesture,
  gestureBaseProject,
  getState,
  previewGesture,
  savePref,
  setState,
  toast,
  updateScreen,
  useEditor,
} from './store.ts';
import { addElementAt, addImageFile, addPresetAt, fillAt, GRID, setCanvasApi, setTool, setViewportSize, zoomTo } from './actions.ts';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'a' | 'b';

type Drag =
  | { kind: 'move'; start: Pt; ids: string[]; anchor: Rect; moved: boolean; clickedId: string; wasOnlySelected: boolean }
  | { kind: 'resize'; start: Pt; id: string; handle: Handle; orig: SketchElement }
  | { kind: 'marquee'; start: Pt; cur: Pt; additive: boolean }
  | { kind: 'pan'; startClient: Pt; startPan: Pt }
  | { kind: 'pen'; points: StrokePoint[]; startedAt: number }
  | { kind: 'erase'; erased: boolean }
  | { kind: 'connect'; sourceId: string; cur: Pt };

interface Pt {
  x: number;
  y: number;
}

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

/** 펜을 이만큼 쉬면 모형인지 본다 */
const PAUSE_MS = 700;
/** 앞 획과 이 시간 안에 그린 획끼리 묶어 본다 */
const PENDING_MS = 8000;

function handlePos(r: Rect, h: Handle): Pt {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const map: Record<string, Pt> = {
    nw: { x: r.x, y: r.y }, n: { x: cx, y: r.y }, ne: { x: r.x + r.width, y: r.y }, e: { x: r.x + r.width, y: cy },
    se: { x: r.x + r.width, y: r.y + r.height }, s: { x: cx, y: r.y + r.height }, sw: { x: r.x, y: r.y + r.height }, w: { x: r.x, y: cy },
  };
  return map[h];
}

function resizedRect(o: Rect, h: Handle, dx: number, dy: number, grid: boolean): Rect {
  let l = o.x;
  let t = o.y;
  let r = o.x + o.width;
  let b = o.y + o.height;
  const g = (v: number) => (grid ? snap(v, GRID) : Math.round(v));
  if (h.includes('w')) l = Math.min(g(o.x + dx), r - 4);
  if (h.includes('e')) r = Math.max(g(o.x + o.width + dx), l + 4);
  if (h.includes('n')) t = Math.min(g(o.y + dy), b - 4);
  if (h.includes('s')) b = Math.max(g(o.y + o.height + dy), t + 4);
  return { x: l, y: t, width: r - l, height: b - t };
}

/** 클릭한 요소에서 고를 요소: 묶음 밖이면 가장 바깥 묶음, 묶음 안에 들어가 있으면 그 안의 한 단계 */
function selectableId(screen: Screen, id: string, entered?: string): string {
  const byId = new Map(screen.elements.map((e) => [e.id, e]));
  let cur = byId.get(id);
  while (cur?.parentId && cur.parentId !== entered && byId.has(cur.parentId)) cur = byId.get(cur.parentId);
  return cur?.id ?? id;
}

function isInside(screen: Screen, id: string, groupId: string): boolean {
  const byId = new Map(screen.elements.map((e) => [e.id, e]));
  let cur = byId.get(id);
  while (cur?.parentId) {
    if (cur.parentId === groupId) return true;
    cur = byId.get(cur.parentId);
  }
  return false;
}

function elementIdAt(clientX: number, clientY: number): string | undefined {
  for (const node of document.elementsFromPoint(clientX, clientY)) {
    const hit = (node as Element).closest?.('[data-id]');
    if (hit) return hit.getAttribute('data-id') ?? undefined;
  }
  return undefined;
}

export function Canvas({ onPenButtons }: { onPenButtons: () => void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag>();
  const dragRef = useRef<Drag | undefined>(undefined);
  const spaceDown = useRef(false);
  const penSeen = useRef(false);
  const [editing, setEditing] = useState<string>();
  const pending = useRef<{ id: string; at: number }[]>([]);
  const recognizeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const screen = useEditor((s) => currentScreen(s));
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const zoom = useEditor((s) => s.zoom);
  const pan = useEditor((s) => s.pan);
  const grid = useEditor((s) => s.grid);
  const showLinks = useEditor((s) => s.showLinks);
  const pen = useEditor((s) => s.pen);
  const recognize = useEditor((s) => s.recognizeShapes);
  const assetUrls = useEditor((s) => s.assetUrls);
  const enteredGroup = useEditor((s) => s.enteredGroup);
  const picking = useEditor((s) => s.pickingTargetFor);

  const setD = (d: Drag | undefined) => {
    dragRef.current = d;
    setDrag(d);
  };

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewportSize(el.clientWidth, el.clientHeight));
    ro.observe(el);
    setViewportSize(el.clientWidth, el.clientHeight);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !(e.target as HTMLElement)?.closest?.('input,textarea,select,[contenteditable]')) {
        spaceDown.current = true;
        if (e.target === document.body) e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // 휠: 이동, Ctrl/Cmd+휠: 커서 기준 확대·축소 (passive 가 아니어야 막을 수 있다)
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = getState();
      if (e.ctrlKey || e.metaKey) {
        const r = svg.getBoundingClientRect();
        zoomTo(s.zoom * Math.exp(-e.deltaY * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top });
      } else {
        setState({ pan: { x: s.pan.x - (e.shiftKey ? e.deltaY : e.deltaX), y: s.pan.y - (e.shiftKey ? 0 : e.deltaY) } });
      }
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const toWorld = (clientX: number, clientY: number): Pt => {
    const g = worldRef.current;
    const svg = svgRef.current;
    if (!g || !svg) return { x: 0, y: 0 };
    const m = g.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(clientX, clientY).matrixTransform(m.inverse());
    return { x: p.x, y: p.y };
  };

  useEffect(() => {
    setCanvasApi({ toWorld, editText: (id: string) => setEditing(id) });
  });

  const sorted = useMemo(() => sortedElements(screen), [screen]);
  const byId = useMemo(() => new Map(screen.elements.map((e) => [e.id, e])), [screen]);

  // ---- 포인터 ----

  const onPointerDown = (e: RPointerEvent<SVGSVGElement>) => {
    if (editing) return;
    const svg = svgRef.current!;
    const p = toWorld(e.clientX, e.clientY);
    const s = getState();
    if (e.pointerType === 'pen') penSeen.current = true;

    // 이동(pan): 가운데 버튼, 스페이스+끌기
    if (e.button === 1 || spaceDown.current) {
      svg.setPointerCapture(e.pointerId);
      setD({ kind: 'pan', startClient: { x: e.clientX, y: e.clientY }, startPan: { ...s.pan } });
      return;
    }
    if (e.button !== 0) return;
    const hitId = (e.target as Element).closest?.('[data-id]')?.getAttribute('data-id') ?? undefined;
    const handle = (e.target as Element).closest?.('[data-handle]')?.getAttribute('data-handle') as Handle | null;

    // 작업판에서 동작 대상 고르기
    if (s.pickingTargetFor) {
      if (hitId) {
        const ixId = s.pickingTargetFor;
        updateScreen((sc) => ({ ...sc, interactions: sc.interactions.map((i) => (i.id === ixId ? { ...i, targetId: hitId } : i)) }));
        toast(`대상: ${byId.get(hitId)?.name ?? hitId}`);
      }
      setState({ pickingTargetFor: undefined });
      return;
    }

    if (s.tool === 'pen') {
      // 펜을 쓴 기기에서는 손가락(손바닥) 입력으로 그리지 않는다
      if (e.pointerType === 'touch' && penSeen.current) return;
      svg.setPointerCapture(e.pointerId);
      clearTimeout(recognizeTimer.current); // 이어서 그리는 중이면 기다린다
      setD({ kind: 'pen', points: [pointOf(e, p)], startedAt: Date.now() });
      return;
    }
    if (s.tool === 'eraser') {
      svg.setPointerCapture(e.pointerId);
      beginGesture();
      setD({ kind: 'erase', erased: false });
      eraseAt(p);
      return;
    }
    if (s.tool === 'fill') {
      fillAt(p);
      if (s.fillOnce) setTool(s.prevTool === 'fill' ? 'select' : s.prevTool);
      return;
    }
    if (s.tool === 'connect') {
      if (!hitId) return;
      svg.setPointerCapture(e.pointerId);
      setState({ selection: [hitId] });
      setD({ kind: 'connect', sourceId: hitId, cur: p });
      return;
    }

    // 선택 도구
    if (handle && s.selection.length === 1) {
      const el = byId.get(s.selection[0]);
      if (el && !el.props.locked) {
        svg.setPointerCapture(e.pointerId);
        beginGesture();
        setD({ kind: 'resize', start: p, id: el.id, handle, orig: el });
        return;
      }
    }
    if (hitId) {
      let entered = s.enteredGroup;
      if (entered && !isInside(screen, hitId, entered)) {
        entered = undefined;
        setState({ enteredGroup: undefined });
      }
      const id = selectableId(screen, hitId, entered);
      let sel = s.selection;
      const wasOnlySelected = sel.length === 1 && sel[0] === id;
      if (e.shiftKey || e.metaKey || e.ctrlKey) {
        sel = sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id];
        setState({ selection: sel });
        return;
      }
      if (!sel.includes(id)) {
        sel = [id];
        setState({ selection: sel });
      }
      const els = sel.map((x) => byId.get(x)).filter((x): x is SketchElement => !!x);
      if (!els.length) return;
      svg.setPointerCapture(e.pointerId);
      beginGesture();
      const anchor = els.find((x) => x.id === id) ?? els[0];
      setD({ kind: 'move', start: p, ids: sel, anchor: { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height }, moved: false, clickedId: id, wasOnlySelected });
      return;
    }
    // 빈 곳: 영역 선택
    svg.setPointerCapture(e.pointerId);
    if (!e.shiftKey) setState({ selection: [], enteredGroup: undefined });
    setD({ kind: 'marquee', start: p, cur: p, additive: e.shiftKey });
  };

  const pointOf = (e: { pointerType: string; pressure: number }, p: Pt): StrokePoint => {
    const x = Math.round(p.x * 10) / 10;
    const y = Math.round(p.y * 10) / 10;
    return e.pointerType === 'pen' && e.pressure > 0 ? [x, y, Math.round(e.pressure * 100) / 100] : [x, y];
  };

  /** 지우개: 필기·요소 가리지 않고 펜 아래 맨 위의 것을 지운다 */
  const eraseAt = (p: Pt) => {
    const sc = currentScreen();
    const tol = 6 / getState().zoom;
    const strokes = sc.strokes.filter((st) => strokeHit(st, p, tol));
    let next = sc;
    if (strokes.length) for (const h of strokes) next = deleteStroke(next, h.id);
    else {
      const hit = hitAt(sc, p, tol);
      if (!hit || !('element' in hit) || hit.element.props.locked) return;
      next = deleteElements(sc, [hit.element.id]);
    }
    previewGesture(mapScreen(getState().project, sc.id, () => next));
    if (dragRef.current?.kind === 'erase') dragRef.current.erased = true;
  };

  /** 펜 끝: 짧게 톡 = 모형 가운데면 글 쓰기, 닫힌 도형 = 모형으로 바꾸기, 나머지 = 필기 */
  const finishPen = (d: Extract<Drag, { kind: 'pen' }>) => {
    const s = getState();
    const xs = d.points.map((q) => q[0]);
    const ys = d.points.map((q) => q[1]);
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * s.zoom;
    if (span < 6 && Date.now() - d.startedAt < 400) {
      const at = { x: d.points[0][0], y: d.points[0][1] };
      const hit = hitAt(currentScreen(), at, 0);
      if (hit && 'element' in hit && hit.element.type === 'shape' && inCenter(hit.element, at)) {
        setEditing(hit.element.id);
        return;
      }
    }
    const stroke = { id: newId('stk'), points: d.points, color: s.pen.color, width: s.pen.width };
    updateScreen((sc) => addStroke(sc, stroke));
    // 펜이 잠깐 멈추면 방금 그린 획들을 묶어서 모형인지 본다 (네모·세모는 여러 획으로 그리니까)
    const now = Date.now();
    // 계속 그리는 동안(앞 획과 8초 안)은 묶음을 이어 간다. 오래 쉬었으면 새로 시작
    const last = pending.current[pending.current.length - 1];
    pending.current = [...(last && now - last.at < PENDING_MS ? pending.current : []), { id: stroke.id, at: now }].slice(-12);
    clearTimeout(recognizeTimer.current);
    recognizeTimer.current = setTimeout(recognizePending, PAUSE_MS);
  };

  /** 최근 획을 많은 것부터 묶어 보며 모형을 찾는다 (최대 6획). 찾으면 남은 획으로 다시 본다 */
  const recognizePending = () => {
    const s = getState();
    if (!s.recognizeShapes || dragRef.current) return;
    const found: string[] = [];
    for (let round = 0; round < 6; round++) {
      const sc = currentScreen();
      const recent = pending.current.map((x) => sc.strokes.find((st) => st.id === x.id)).filter((x): x is Stroke => !!x);
      let hit = false;
      for (let k = Math.min(6, recent.length); k >= 1 && !hit; k--) {
        const group = recent.slice(recent.length - k);
        const shape = recognizeShape(group.map((g) => g.points));
        if (!shape) continue;
        hit = true;
        const ids = new Set(group.map((g) => g.id));
        const el = createElement('shape', shape.x, shape.y, {
          width: shape.width,
          height: shape.height,
          name: SHAPE_LABELS[shape.kind],
          text: '',
          props: { shapeKind: shape.kind, stroke: group[group.length - 1].color, ...(shape.vertices ? { vertices: shape.vertices } : {}) },
        });
        // 손그림을 먼저 저장해 두었으니 Ctrl+Z 한 번이면 손그림으로 돌아간다
        updateScreen((x) => addElements({ ...x, strokes: x.strokes.filter((st) => !ids.has(st.id)) }, [el]));
        pending.current = pending.current.filter((x) => !ids.has(x.id));
        found.push(`${SHAPE_LABELS[shape.kind]}${k > 1 ? `(${k}획)` : ''}`);
      }
      if (!hit) break;
    }
    if (found.length) toast(`${found.reverse().join(' · ')}로 바꿨습니다 -- 가운데를 누르면 글을 씁니다 (Ctrl+Z: 손그림으로)`);
  };

  const onPointerMove = (e: RPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const p = toWorld(e.clientX, e.clientY);
    const s = getState();
    switch (d.kind) {
      case 'pan':
        setState({ pan: { x: d.startPan.x + e.clientX - d.startClient.x, y: d.startPan.y + e.clientY - d.startClient.y } });
        break;
      case 'pen': {
        const events = typeof e.nativeEvent.getCoalescedEvents === 'function' ? e.nativeEvent.getCoalescedEvents() : [];
        const pts = (events.length ? events : [e.nativeEvent]).map((ev) => pointOf(ev, toWorld(ev.clientX, ev.clientY)));
        setD({ ...d, points: [...d.points, ...pts] });
        break;
      }
      case 'erase':
        eraseAt(p);
        break;
      case 'connect':
        setD({ ...d, cur: p });
        break;
      case 'marquee':
        setD({ ...d, cur: p });
        break;
      case 'move': {
        let dx = p.x - d.start.x;
        let dy = p.y - d.start.y;
        if (!d.moved && Math.hypot(dx, dy) * s.zoom < 3) return;
        if (s.grid) {
          dx = snap(d.anchor.x + dx, GRID) - d.anchor.x;
          dy = snap(d.anchor.y + dy, GRID) - d.anchor.y;
        } else {
          dx = Math.round(dx);
          dy = Math.round(dy);
        }
        const base = gestureBaseProject();
        previewGesture(mapScreen(base, s.screenId, (sc) => moveElements(sc, d.ids, dx, dy)));
        if (!d.moved) dragRef.current = { ...d, moved: true };
        break;
      }
      case 'resize': {
        const base = gestureBaseProject();
        const dx = p.x - d.start.x;
        const dy = p.y - d.start.y;
        if (d.orig.type === 'connector') {
          const ends = connectorEnds(d.orig);
          const g = (v: number) => (s.grid ? snap(v, GRID) : Math.round(v));
          const a = d.handle === 'a' ? { x: g(ends.a.x + dx), y: g(ends.a.y + dy) } : ends.a;
          const b = d.handle === 'b' ? { x: g(ends.b.x + dx), y: g(ends.b.y + dy) } : ends.b;
          const c = connectorFromEnds(a, b);
          previewGesture(
            mapScreen(base, s.screenId, (sc) =>
              updateElement(sc, d.id, { x: c.x, y: c.y, width: c.width, height: c.height, props: { flip: c.flip, reverse: c.reverse } }),
            ),
          );
        } else {
          const r = resizedRect(d.orig, d.handle, dx, dy, s.grid);
          previewGesture(mapScreen(base, s.screenId, (sc) => resizeElement(sc, d.id, r)));
        }
        break;
      }
    }
  };

  const onPointerUp = (e: RPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    setD(undefined);
    if (!d) return;
    const s = getState();
    switch (d.kind) {
      case 'pen':
        if (d.points.length) finishPen(d);
        break;
      case 'move': {
        endGesture();
        // 여러 개를 고른 상태에서 끌지 않고 누르기만 했으면 누른 것만 고른다
        if (!d.moved && s.selection.length > 1) setState({ selection: [d.clickedId] });
        // 이미 고른 모형의 가운데를 한 번 더 누르면 글 쓰기
        const el = byId.get(d.clickedId);
        if (!d.moved && d.wasOnlySelected && el?.type === 'shape' && !el.props.locked && inCenter(el, d.start)) setEditing(el.id);
        break;
      }
      case 'erase':
      case 'resize':
        endGesture();
        break;
      case 'marquee': {
        const r = normRect(d.start, d.cur);
        if (r.width * s.zoom < 3 && r.height * s.zoom < 3) break;
        const sc = currentScreen();
        const ids = new Set<string>(d.additive ? s.selection : []);
        for (const el of sc.elements) {
          if (el.type === 'group') continue;
          if (rectsIntersect(r, el)) ids.add(selectableId(sc, el.id, s.enteredGroup));
        }
        setState({ selection: [...ids] });
        break;
      }
      case 'connect': {
        const targetId = elementIdAt(e.clientX, e.clientY);
        if (!targetId || targetId === d.sourceId) {
          toast('동작 연결: 시작 요소에서 대상 요소까지 끌어 놓으세요');
          break;
        }
        const src = byId.get(d.sourceId);
        const ix: Interaction = {
          id: newId('ix'),
          sourceId: d.sourceId,
          trigger: src?.type === 'card' ? 'drag_drop' : 'click',
          targetId,
          action: src?.type === 'card' ? 'create_item' : 'open_panel',
          effect: '',
          acceptance: '',
        };
        updateScreen((sc) => ({ ...sc, interactions: [...sc.interactions, ix] }), { selection: [d.sourceId] });
        setState({ tool: 'select', focusInteraction: ix.id });
        toast('동작을 만들었습니다 -- 오른쪽에서 조건·결과·예외를 적어 주세요');
        break;
      }
    }
  };

  const onDoubleClick = (e: React.MouseEvent) => {
    const s = getState();
    if (s.tool !== 'select') return;
    // 포인터 캡처 때문에 dblclick 의 target 은 svg 다 -- 좌표로 요소를 찾는다
    const hitId = elementIdAt(e.clientX, e.clientY);
    if (!hitId) return;
    const id = selectableId(screen, hitId, s.enteredGroup);
    const el = byId.get(id);
    if (el?.type === 'group') {
      const inner = selectableId(screen, hitId, id);
      setState({ enteredGroup: id, selection: [inner] });
      return;
    }
    if (el && el.type !== 'image' && !el.props.locked) setEditing(el.id);
  };

  // ---- 팔레트에서 끌어 놓기 ----
  const onDragOver = (e: React.DragEvent) => {
    if (e.dataTransfer.types.includes('application/x-sketch') || e.dataTransfer.types.includes('Files')) e.preventDefault();
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const p = toWorld(e.clientX, e.clientY);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      void addImageFile(file, p);
      return;
    }
    const v = e.dataTransfer.getData('application/x-sketch');
    if (v.startsWith('preset:')) addPresetAt(v.slice(7) as PresetKey, p);
    else if (v) addElementAt(v as ElementType, p);
  };

  // ---- 그리기 ----

  const selected = selection.map((id) => byId.get(id)).filter((x): x is SketchElement => !!x);
  const single = selected.length === 1 ? selected[0] : undefined;
  const hs = 8 / zoom;
  const ixFor = screen.interactions;
  const cursor = tool === 'pen' ? 'crosshair' : tool === 'eraser' ? 'cell' : tool === 'fill' ? 'copy' : tool === 'connect' || picking ? 'alias' : drag?.kind === 'pan' ? 'grabbing' : 'default';

  const center = (el: SketchElement): Pt => ({ x: el.x + el.width / 2, y: el.y + el.height / 2 });
  /** 가운데에서 다른 점으로 가는 선이 상자 테두리와 만나는 점 -- 동작선이 가운데에 몰리지 않게 */
  const edgePoint = (el: SketchElement, toward: Pt): Pt => {
    const c = center(el);
    const dx = toward.x - c.x;
    const dy = toward.y - c.y;
    if (!dx && !dy) return c;
    const sx = dx ? el.width / 2 / Math.abs(dx) : Infinity;
    const sy = dy ? el.height / 2 / Math.abs(dy) : Infinity;
    const t = Math.min(sx, sy, 1);
    return { x: c.x + dx * t, y: c.y + dy * t };
  };

  return (
    <div className="canvas-wrap" ref={wrapRef} onDragOver={onDragOver} onDrop={onDrop}>
      <svg
        ref={svgRef}
        className="canvas"
        data-testid="canvas"
        style={{ cursor }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
      >
        <defs>
          <pattern id="grid" width={GRID} height={GRID} patternUnits="userSpaceOnUse">
            <path d={`M ${GRID} 0 L 0 0 0 ${GRID}`} fill="none" stroke="#e2e8f0" strokeWidth={0.5} />
          </pattern>
          <g dangerouslySetInnerHTML={{ __html: arrowMarkers(['#2563eb', '#16a34a', '#475569', '#7c3aed', '#dc2626']) }} />
        </defs>
        <g ref={worldRef} transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
          <rect className="artboard-shadow" x={2} y={3} width={screen.width} height={screen.height} />
          <rect className="artboard" x={0} y={0} width={screen.width} height={screen.height} style={screen.background ? { fill: screen.background } : undefined} />
          {grid && zoom > 0.35 && <rect x={0} y={0} width={screen.width} height={screen.height} fill="url(#grid)" pointerEvents="none" />}
          <g className={tool === 'select' || tool === 'connect' || picking ? '' : 'no-hit'}>
            {sorted.map((el) => (
              <ElementView key={el.id} el={el} href={el.props.assetId ? assetUrls[el.props.assetId] : undefined} dim={!!enteredGroup && el.id !== enteredGroup && !isInside(screen, el.id, enteredGroup)} />
            ))}
          </g>
          <g pointerEvents="none">
            {screen.strokes.map((st) => (
              <StrokeView key={st.id} stroke={st} />
            ))}
            {drag?.kind === 'pen' && <StrokeView stroke={{ id: 'live', points: drag.points, color: pen.color, width: pen.width }} />}
          </g>
          {showLinks && (
            <g pointerEvents="none" data-testid="links">
              {ixFor.map((ix) => {
                const src = byId.get(ix.sourceId);
                if (!src) return null;
                const tgt = ix.targetId ? byId.get(ix.targetId) : undefined;
                const broken = !!interactionTargetProblem(project, screen, ix);
                const a = center(src);
                if (tgt) {
                  // 대상이 시작 요소를 감싸면(카드 → 그 카드가 든 목록) 가운데끼리 잇는다
                  const inside = tgt.x <= src.x && tgt.y <= src.y && tgt.x + tgt.width >= src.x + src.width && tgt.y + tgt.height >= src.y + src.height;
                  const a2 = inside ? a : edgePoint(src, center(tgt));
                  const b = inside ? center(tgt) : edgePoint(tgt, center(src));
                  return (
                    <g key={ix.id} className={broken ? 'link broken' : 'link'}>
                      <line x1={a2.x} y1={a2.y} x2={b.x} y2={b.y} strokeWidth={2 / zoom} markerEnd={`url(#arrow-${broken ? 'dc2626' : '7c3aed'})`} />
                    </g>
                  );
                }
                const scr = ix.targetScreenId ? project.screens.find((x) => x.id === ix.targetScreenId) : undefined;
                return (
                  <g key={ix.id} className={broken ? 'link broken' : 'link'}>
                    <circle cx={src.x + src.width} cy={src.y} r={7 / zoom} />
                    <text x={src.x + src.width + 10 / zoom} y={src.y + 4 / zoom} fontSize={12 / zoom}>
                      {broken ? '깨진 연결' : scr ? `→ ${scr.name}` : '동작'}
                    </text>
                  </g>
                );
              })}
            </g>
          )}
          {enteredGroup && byId.get(enteredGroup) && (
            <rect className="group-frame" {...rectOf(byId.get(enteredGroup)!)} strokeWidth={1.5 / zoom} pointerEvents="none" />
          )}
          {selected.map((el) =>
            el.type === 'connector' ? null : (
              <rect key={el.id} className={el.props.locked ? 'sel-box locked' : 'sel-box'} {...rectOf(el)} strokeWidth={1.5 / zoom} pointerEvents="none" />
            ),
          )}
          {single && single.type !== 'connector' && !single.props.locked &&
            HANDLES.map((h) => {
              const hp = handlePos(single, h);
              return <rect key={h} data-handle={h} className={`handle h-${h}`} x={hp.x - hs / 2} y={hp.y - hs / 2} width={hs} height={hs} strokeWidth={1 / zoom} />;
            })}
          {single && single.type === 'connector' &&
            (['a', 'b'] as const).map((h) => {
              const ends = connectorEnds(single);
              const hp = ends[h];
              return <circle key={h} data-handle={h} className="handle" cx={hp.x} cy={hp.y} r={hs * 0.7} strokeWidth={1 / zoom} />;
            })}
          {drag?.kind === 'marquee' && <rect className="marquee" {...normRect(drag.start, drag.cur)} strokeWidth={1 / zoom} />}
          {drag?.kind === 'connect' && byId.get(drag.sourceId) && (
            <line className="connect-line" x1={center(byId.get(drag.sourceId)!).x} y1={center(byId.get(drag.sourceId)!).y} x2={drag.cur.x} y2={drag.cur.y} strokeWidth={2 / zoom} markerEnd="url(#arrow-7c3aed)" />
          )}
        </g>
      </svg>
      {editing && byId.get(editing) && <InlineText el={byId.get(editing)!} zoom={zoom} pan={pan} onDone={() => setEditing(undefined)} />}
      {screen.elements.length === 0 && screen.strokes.length === 0 && (
        <div className="canvas-empty">
          왼쪽에서 요소를 끌어 놓거나 눌러서 추가하세요. 실제 개인정보 대신 <b>예시 값</b>을 넣어 주세요.
        </div>
      )}
      {/* 펜 설정은 작업판 위에 띄운다 -- 위쪽 막대 폭이 도구에 따라 바뀌지 않게 */}
      <div className="canvas-tools" data-testid="canvas-tools">
        {tool === 'pen' && (
          <>
            <label className="check" title="손으로 그린 네모·원·별·세모·마름모를 모형으로 바꿉니다">
              <input type="checkbox" checked={recognize} data-testid="recognize" onChange={(e) => { setState({ recognizeShapes: e.target.checked }); savePref('recognizeShapes', e.target.checked); }} /> 모형 인식
            </label>
            <select aria-label="펜 굵기" value={pen.width} onChange={(e) => setState({ pen: { ...pen, width: Number(e.target.value) } })}>
              {[1, 2, 3, 5, 8].map((w) => (
                <option key={w} value={w}>{w}px</option>
              ))}
            </select>
          </>
        )}
        <button className="btn small" onClick={onPenButtons} title="펜 옆 버튼 기능 설정">펜 버튼</button>
      </div>
      {picking && <div className="canvas-banner">작업판에서 동작의 대상 요소를 누르세요 (Esc: 취소)</div>}
      {tool === 'connect' && <div className="canvas-banner">동작 연결: 시작 요소를 눌러 대상 요소까지 끌어 놓으세요</div>}
    </div>
  );
}

function rectOf(el: Rect) {
  return { x: el.x, y: el.y, width: el.width, height: el.height };
}

/** 작업판 위에서 바로 글 고치기 (더블클릭) */
function InlineText({ el, zoom, pan, onDone }: { el: SketchElement; zoom: number; pan: Pt; onDone: () => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [value, setValue] = useState(el.text ?? '');
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const save = () => {
    if (value !== (el.text ?? '')) updateScreen((sc) => updateElement(sc, el.id, { text: value }));
    onDone();
  };
  const w = el.type === 'connector' ? 200 : Math.max(80, el.width);
  const h = el.type === 'connector' ? 40 : Math.max(32, el.height);
  return (
    <textarea
      ref={ref}
      className="inline-text"
      data-testid="inline-text"
      value={value}
      style={{ left: pan.x + el.x * zoom, top: pan.y + el.y * zoom, width: w * zoom, height: h * zoom, fontSize: Math.max(12, 14 * zoom) }}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onDone();
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save();
      }}
    />
  );
}
