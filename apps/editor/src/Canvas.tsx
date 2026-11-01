// 작업판: 선택·이동·크기 조절·영역 선택·확대/축소·이동(pan)·펜·지우개·동작 연결.
// 모든 포인터 좌표는 SVG 의 CTM 역행렬로 화면 좌표로 바꾼다 -- 확대·축소해도 펜 좌표가 어긋나지 않는다.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import {
  addStroke,
  connectorEnds,
  connectorFromEnds,
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
  setState,
  toast,
  updateScreen,
  useEditor,
} from './store.ts';
import { addElementAt, addImageFile, addPresetAt, GRID, setViewportSize, zoomTo } from './actions.ts';

type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'a' | 'b';

type Drag =
  | { kind: 'move'; start: Pt; ids: string[]; anchor: Rect; moved: boolean }
  | { kind: 'resize'; start: Pt; id: string; handle: Handle; orig: SketchElement }
  | { kind: 'marquee'; start: Pt; cur: Pt; additive: boolean }
  | { kind: 'pan'; startClient: Pt; startPan: Pt }
  | { kind: 'pen'; points: StrokePoint[] }
  | { kind: 'erase'; erased: boolean }
  | { kind: 'connect'; sourceId: string; cur: Pt };

interface Pt {
  x: number;
  y: number;
}

const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

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

export function Canvas() {
  const svgRef = useRef<SVGSVGElement>(null);
  const worldRef = useRef<SVGGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag>();
  const dragRef = useRef<Drag | undefined>(undefined);
  const spaceDown = useRef(false);
  const penSeen = useRef(false);
  const [editing, setEditing] = useState<string>();

  const screen = useEditor((s) => currentScreen(s));
  const project = useEditor((s) => s.project);
  const selection = useEditor((s) => s.selection);
  const tool = useEditor((s) => s.tool);
  const zoom = useEditor((s) => s.zoom);
  const pan = useEditor((s) => s.pan);
  const grid = useEditor((s) => s.grid);
  const showLinks = useEditor((s) => s.showLinks);
  const pen = useEditor((s) => s.pen);
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
      setD({ kind: 'pen', points: [pointOf(e, p)] });
      return;
    }
    if (s.tool === 'eraser') {
      svg.setPointerCapture(e.pointerId);
      beginGesture();
      setD({ kind: 'erase', erased: false });
      eraseAt(p);
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
      setD({ kind: 'move', start: p, ids: sel, anchor: { x: anchor.x, y: anchor.y, width: anchor.width, height: anchor.height }, moved: false });
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

  const eraseAt = (p: Pt) => {
    const sc = currentScreen();
    const tol = 6 / getState().zoom;
    const hits = sc.strokes.filter((st) => strokeHit(st, p, tol));
    if (!hits.length) return;
    let next = sc;
    for (const h of hits) next = deleteStroke(next, h.id);
    previewGesture(mapScreen(getState().project, sc.id, () => next));
    if (dragRef.current?.kind === 'erase') dragRef.current.erased = true;
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
        setD({ kind: 'pen', points: [...d.points, ...pts] });
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
        if (d.points.length) {
          const stroke = { id: newId('stk'), points: d.points, color: s.pen.color, width: s.pen.width };
          updateScreen((sc) => addStroke(sc, stroke));
        }
        break;
      case 'erase':
      case 'move':
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
    const hitId = (e.target as Element).closest?.('[data-id]')?.getAttribute('data-id');
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
  const cursor = tool === 'pen' ? 'crosshair' : tool === 'eraser' ? 'cell' : tool === 'connect' || picking ? 'alias' : drag?.kind === 'pan' ? 'grabbing' : 'default';

  const center = (el: SketchElement): Pt => ({ x: el.x + el.width / 2, y: el.y + el.height / 2 });

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
          <rect className="artboard" x={0} y={0} width={screen.width} height={screen.height} />
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
                  const b = center(tgt);
                  return (
                    <g key={ix.id} className={broken ? 'link broken' : 'link'}>
                      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={2 / zoom} markerEnd={`url(#arrow-${broken ? 'dc2626' : '7c3aed'})`} />
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
