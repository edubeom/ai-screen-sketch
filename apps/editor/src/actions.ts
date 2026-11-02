// 편집기 명령 -- 단축키·상단 막대·속성 패널이 같이 쓴다.
import {
  addElements,
  addScreen as addScreenOp,
  alignElements,
  bringToFront,
  cloneElements,
  createElement,
  createPreset,
  deleteElements,
  deleteScreen as deleteScreenOp,
  duplicateElements,
  duplicateScreen as duplicateScreenOp,
  groupElements,
  enclosedRegion,
  hitAt,
  mapScreen,
  sortedElements as sortedEls,
  moveElements,
  moveScreen as moveScreenOp,
  newId,
  sendToBack,
  sha256Hex,
  shiftOrder,
  sortedElements,
  ungroup,
  withDescendants,
  type AlignMode,
  type ElementType,
  type Interaction,
  type PresetKey,
  type SketchElement,
} from '@sketch/core';
import { describeElement } from '@sketch/exporters';
import { commit, currentScreen, getState, pickColor, setState, toast, updateScreen, type Tool } from './store.ts';
import { store } from './persistence.ts';

export const GRID = 8;

/** 지금 보이는 화면 가운데(작업판 좌표). 작업판 크기는 Canvas 가 알려 준다 */
let viewport = { width: 1000, height: 700 };
export function setViewportSize(width: number, height: number) {
  viewport = { width, height };
}

function viewCenter() {
  const s = getState();
  const screen = currentScreen(s);
  const cx = (viewport.width / 2 - s.pan.x) / s.zoom;
  const cy = (viewport.height / 2 - s.pan.y) / s.zoom;
  return { x: Math.max(0, Math.min(screen.width - 40, cx)), y: Math.max(0, Math.min(screen.height - 40, cy)) };
}

export function addElementAt(type: ElementType, point?: { x: number; y: number }) {
  const p = point ?? viewCenter();
  const el = createElement(type, 0, 0);
  el.x = Math.round((point ? p.x : p.x - el.width / 2) / GRID) * GRID;
  el.y = Math.round((point ? p.y : p.y - el.height / 2) / GRID) * GRID;
  updateScreen((s) => addElements(s, [el]), { selection: [el.id] });
  setState({ tool: 'select', enteredGroup: undefined });
  return el.id;
}

export function addPresetAt(key: PresetKey, point?: { x: number; y: number }) {
  const p = point ?? viewCenter();
  let els = createPreset(key, 0, 0);
  // 지점을 주지 않으면 보이는 화면 가운데에 둔다
  const ox = point ? p.x : p.x - els[0].width / 2;
  const oy = point ? p.y : p.y - els[0].height / 2;
  els = createPreset(key, Math.max(0, Math.round(ox / GRID) * GRID), Math.max(0, Math.round(oy / GRID) * GRID));
  updateScreen((s) => addElements(s, els), { selection: [els[0].id] });
  setState({ tool: 'select', enteredGroup: undefined });
}

export function deleteSelection() {
  const { selection } = getState();
  if (!selection.length) return;
  updateScreen((s) => deleteElements(s, selection), { selection: [] });
}

export function duplicateSelection() {
  const { selection } = getState();
  if (!selection.length) return;
  let newIds: string[] = [];
  updateScreen((s) => {
    const r = duplicateElements(s, selection, GRID * 2);
    newIds = r.newIds;
    return r.screen;
  });
  setState({ selection: newIds });
}

let clipboard: { elements: SketchElement[]; interactions: Interaction[]; pastes: number } | undefined;

export function copySelection() {
  const s = getState();
  const screen = currentScreen(s);
  const all = withDescendants(screen, s.selection);
  if (!all.size) return;
  clipboard = {
    elements: sortedElements(screen).filter((e) => all.has(e.id)),
    interactions: screen.interactions.filter((i) => all.has(i.sourceId)),
    pastes: 0,
  };
  toast(`${s.selection.length}개 복사함`);
}

export function cutSelection() {
  copySelection();
  deleteSelection();
}

export function paste() {
  if (!clipboard) return;
  clipboard.pastes += 1;
  const off = GRID * 2 * clipboard.pastes;
  const { elements, interactions } = cloneElements(clipboard.elements, clipboard.interactions, off, off);
  const roots = elements.filter((e) => !e.parentId).map((e) => e.id);
  updateScreen((s) => ({ ...addElements(s, elements), interactions: [...s.interactions, ...interactions] }), { selection: roots });
}

export function groupSelection() {
  const { selection } = getState();
  if (selection.length < 2) return;
  let gid: string | undefined;
  updateScreen((s) => {
    const r = groupElements(s, selection);
    gid = r.groupId;
    return r.screen;
  });
  if (gid) setState({ selection: [gid] });
}

export function ungroupSelection() {
  const s = getState();
  const screen = currentScreen(s);
  const groups = s.selection.filter((id) => screen.elements.find((e) => e.id === id)?.type === 'group');
  if (!groups.length) return;
  let kids: string[] = [];
  updateScreen((sc) => {
    let next = sc;
    for (const g of groups) {
      const r = ungroup(next, g);
      next = r.screen;
      kids = kids.concat(r.childIds);
    }
    return next;
  });
  setState({ selection: kids, enteredGroup: undefined });
}

export function reorder(kind: 'front' | 'back' | 'forward' | 'backward') {
  const { selection } = getState();
  if (!selection.length) return;
  updateScreen((s) =>
    kind === 'front' ? bringToFront(s, selection) : kind === 'back' ? sendToBack(s, selection) : shiftOrder(s, selection, kind === 'forward' ? 1 : -1),
  );
}

export function align(mode: AlignMode) {
  const { selection } = getState();
  updateScreen((s) => alignElements(s, selection, mode));
}

export function toggleLock() {
  const s = getState();
  const screen = currentScreen(s);
  const els = screen.elements.filter((e) => s.selection.includes(e.id));
  if (!els.length) return;
  const lock = !els.every((e) => e.props.locked);
  updateScreen((sc) => ({
    ...sc,
    elements: sc.elements.map((e) => (s.selection.includes(e.id) ? { ...e, props: { ...e.props, locked: lock } } : e)),
  }));
  toast(lock ? '잠금' : '잠금 풂');
}

export function nudge(dx: number, dy: number) {
  const { selection } = getState();
  if (!selection.length) return;
  updateScreen((s) => moveElements(s, selection, dx, dy), { coalesce: 'nudge' });
}

export function selectAll() {
  const s = getState();
  const screen = currentScreen(s);
  const ids = screen.elements.filter((e) => (s.enteredGroup ? e.parentId === s.enteredGroup : !e.parentId)).map((e) => e.id);
  setState({ selection: ids });
}

export function setTool(tool: Tool) {
  const s = getState();
  setState({
    tool,
    fillOnce: false,
    prevTool: tool !== s.tool && s.tool !== 'eraser' ? s.tool : s.prevTool,
    pickingTargetFor: undefined,
    selection: tool === 'select' || tool === 'connect' ? s.selection : [],
  });
}

/** 지우개 ↔ 이전 도구 */
export function toggleEraser() {
  const s = getState();
  if (s.tool === 'eraser') setTool(s.prevTool === 'eraser' ? 'pen' : s.prevTool);
  else setTool('eraser');
}

// ---- 화면 ----

export function selectScreen(screenId: string) {
  setState({ screenId, selection: [], enteredGroup: undefined, pickingTargetFor: undefined });
}

export function addScreen(name: string, width: number, height: number) {
  const r = addScreenOp(getState().project, name, width, height);
  commit(r.project, { selection: [] });
  selectScreen(r.screenId);
}

export function duplicateCurrentScreen(name?: string) {
  const s = getState();
  const r = duplicateScreenOp(s.project, s.screenId, name);
  commit(r.project, { selection: [] });
  if (r.screenId) selectScreen(r.screenId);
  return r.screenId;
}

export function deleteScreen(screenId: string) {
  const s = getState();
  if (s.project.screens.length <= 1) {
    toast('화면이 하나뿐이라 지울 수 없습니다', 'error');
    return;
  }
  const idx = s.project.screens.findIndex((x) => x.id === screenId);
  const next = deleteScreenOp(s.project, screenId);
  commit(next, { selection: [] });
  if (s.screenId === screenId) selectScreen(next.screens[Math.max(0, idx - 1)].id);
}

export function moveScreen(screenId: string, dir: 1 | -1) {
  commit(moveScreenOp(getState().project, screenId, dir));
}

// ---- 확대·축소 ----

export function zoomTo(zoom: number, anchor?: { x: number; y: number }) {
  const s = getState();
  const z = Math.max(0.1, Math.min(4, zoom));
  const a = anchor ?? { x: viewport.width / 2, y: viewport.height / 2 };
  const wx = (a.x - s.pan.x) / s.zoom;
  const wy = (a.y - s.pan.y) / s.zoom;
  setState({ zoom: z, pan: { x: a.x - wx * z, y: a.y - wy * z } });
}

export function fitScreen() {
  const screen = currentScreen();
  const pad = 40;
  const z = Math.max(0.1, Math.min(2, Math.min((viewport.width - pad * 2) / screen.width, (viewport.height - pad * 2) / screen.height)));
  setState({ zoom: z, pan: { x: (viewport.width - screen.width * z) / 2, y: (viewport.height - screen.height * z) / 2 } });
}

// ---- 이미지 ----

const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** 이미지 파일을 자산으로 저장하고 이미지 요소를 놓는다 (SVG·외부 URL 은 받지 않는다) */
export async function addImageFile(file: File, point?: { x: number; y: number }, replaceElementId?: string) {
  if (!IMAGE_TYPES.includes(file.type)) {
    toast('PNG·JPEG·WebP·GIF 이미지만 넣을 수 있습니다 (SVG 는 아직 지원하지 않음)', 'error');
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    toast('이미지가 10MB 보다 큽니다', 'error');
    return;
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha256 = await sha256Hex(bytes);
  let width = 0;
  let height = 0;
  try {
    const bmp = await createImageBitmap(file);
    width = bmp.width;
    height = bmp.height;
    bmp.close();
  } catch {
    toast('이미지를 읽을 수 없습니다', 'error');
    return;
  }
  const s = getState();
  const existing = s.project.assets.find((a) => a.sha256 === sha256);
  const assetId = existing?.id ?? newId('asset');
  const ext = file.type.split('/')[1].replace('jpeg', 'jpg');
  if (!existing) {
    try {
      await store.putAsset(s.project.id, assetId, file, file.type);
    } catch (e) {
      toast(`이미지를 저장하지 못했습니다: ${(e as Error).message}`, 'error');
      return;
    }
  }
  const url = getState().assetUrls[assetId] ?? URL.createObjectURL(file);
  setState((st) => ({ assetUrls: { ...st.assetUrls, [assetId]: url } }));
  const latest = getState().project;
  const project = existing
    ? latest
    : { ...latest, assets: [...latest.assets, { id: assetId, relativePath: `assets/${assetId}.${ext}`, mimeType: file.type, sha256, width, height }] };
  const scale = Math.min(1, 400 / Math.max(width, height));
  if (replaceElementId) {
    commit({
      ...project,
      screens: project.screens.map((sc) =>
        sc.id !== s.screenId ? sc : { ...sc, elements: sc.elements.map((e) => (e.id === replaceElementId ? { ...e, props: { ...e.props, assetId } } : e)) },
      ),
    });
    return;
  }
  const p = point ?? viewCenter();
  const el = createElement('image', p.x, p.y, { width: Math.round(width * scale), height: Math.round(height * scale), name: file.name.slice(0, 60), props: { assetId } });
  commit(
    {
      ...project,
      screens: project.screens.map((sc) => (sc.id === s.screenId ? addElements(sc, [el]) : sc)),
    },
    { selection: [el.id] },
  );
}

// ---- 색 (채우기 · 스포이트) ----

/** 작업판이 알려 주는 좌표 변환 · 글 고치기 (펜 버튼이 쓴다) */
interface CanvasApi {
  toWorld: (clientX: number, clientY: number) => { x: number; y: number };
  editText: (id: string) => void;
}
let canvasApi: CanvasApi | undefined;
export function setCanvasApi(api: CanvasApi) {
  canvasApi = api;
}
export function getCanvasApi() {
  return canvasApi;
}

/** 채우기: 펜 아래 모형·요소·필기에 지금 색을, 빈 곳이면 화면 바탕 전체에 */
export function fillAt(p: { x: number; y: number }) {
  const s = getState();
  const color = s.pen.color;
  const sc = currentScreen(s);
  const hit = hitAt(sc, p, 4 / s.zoom);
  pickColor(color);
  if (hit && 'stroke' in hit) {
    const id = hit.stroke.id;
    updateScreen((x) => ({ ...x, strokes: x.strokes.map((st) => (st.id === id ? { ...st, color } : st)) }));
    return;
  }
  // 손으로 그린 선이 둘러싼 곳이면 그 자리만 칠한다 (그 안에 있는 요소보다 좁을 때)
  const region = enclosedRegion(sc.strokes, sc.width, sc.height, p);
  const hitEl = hit && 'element' in hit ? hit.element : undefined;
  const hitArea = hitEl ? hitEl.width * hitEl.height : Infinity;
  // 이미 칠한 영역을 다시 누르면 그 색만 바꾼다
  const refill = hitEl?.type === 'shape' && hitEl.props.shapeKind === 'polygon';
  if (region && !refill && region.area < hitArea) {
    const xs = region.points.map((q) => q[0]);
    const ys = region.points.map((q) => q[1]);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    const w = Math.max(1, Math.max(...xs) - x);
    const h = Math.max(1, Math.max(...ys) - y);
    const el = createElement('shape', x, y, {
      width: Math.round(w),
      height: Math.round(h),
      name: '칠한 영역',
      text: '',
      props: { shapeKind: 'polygon', fill: color, stroke: 'none', vertices: region.points.map(([px, py]) => [Math.round(((px - x) / w) * 1000) / 1000, Math.round(((py - y) / h) * 1000) / 1000]) },
    });
    // createElement 가 반올림한 자리를 테두리 그대로로 되돌린다
    el.x = x;
    el.y = y;
    el.width = w;
    el.height = h;
    updateScreen((x2) => addElements(x2, [el]));
    return;
  }
  if (hit && 'element' in hit) {
    const el = hit.element;
    if (el.props.locked) return toast('잠긴 요소입니다', 'error');
    const props = el.type === 'connector' ? { stroke: color } : { fill: color };
    updateScreen((x) => ({ ...x, elements: x.elements.map((e) => (e.id === el.id ? { ...e, props: { ...e.props, ...props } } : e)) }));
    return;
  }
  commit(mapScreen(s.project, sc.id, (x) => ({ ...x, background: color })));
}

/** 스포이트: 지금 커서 아래 보이는 색 (필기 → 위의 요소부터 → 바탕) */
export function colorAt(p: { x: number; y: number }): string {
  const s = getState();
  const sc = currentScreen(s);
  const tol = 3 / s.zoom;
  const hit = hitAt(sc, p, tol);
  if (hit && 'stroke' in hit) return hit.stroke.color;
  const els = sortedEls(sc);
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i];
    if (el.type === 'group' || el.type === 'text' || el.type === 'image') continue;
    const inside = p.x >= el.x - tol && p.x <= el.x + el.width + tol && p.y >= el.y - tol && p.y <= el.y + el.height + tol;
    if (!inside) continue;
    const first = describeElement(el)[0];
    if (!first) continue;
    if (first.kind === 'line') return first.stroke;
    if ((first.kind === 'rect' || first.kind === 'ellipse' || first.kind === 'polygon') && first.fill !== 'none') return first.fill;
  }
  return sc.background ?? '#ffffff';
}

export function eyedropAt(p: { x: number; y: number }) {
  const c = colorAt(p);
  pickColor(c);
  toast(`색을 가져왔습니다 ${c}`);
}
