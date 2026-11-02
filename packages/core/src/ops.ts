// 편집 명령. 모두 순수 함수로, 바꾼 새 Project/Screen 을 돌려준다 (실행 취소는 이전 값을 보관해 처리).
import { createScreen, newId } from './factory.ts';
import type {
  Interaction,
  Project,
  Screen,
  ScreenNote,
  ScreenState,
  SketchElement,
  Stroke,
} from './types.ts';

export function mapScreen(project: Project, screenId: string, fn: (s: Screen) => Screen): Project {
  let changed = false;
  const screens = project.screens.map((s) => {
    if (s.id !== screenId) return s;
    const next = fn(s);
    if (next !== s) changed = true;
    return next;
  });
  return changed ? { ...project, screens } : project;
}

export function findScreen(project: Project, screenId: string): Screen | undefined {
  return project.screens.find((s) => s.id === screenId);
}

/** zIndex 순서(같으면 배열 순서)로 정렬한 요소 */
export function sortedElements(screen: Screen): SketchElement[] {
  return screen.elements
    .map((e, i) => [e, i] as const)
    .sort((a, b) => a[0].zIndex - b[0].zIndex || a[1] - b[1])
    .map(([e]) => e);
}

/** zIndex 를 0,1,2... 로 다시 매긴다 */
function renumber(elements: SketchElement[]): SketchElement[] {
  return elements.map((e, i) => (e.zIndex === i ? e : { ...e, zIndex: i }));
}

/** 요소와 그 안의 자식(묶음)까지 */
export function withDescendants(screen: Screen, ids: Iterable<string>): Set<string> {
  const out = new Set(ids);
  let grew = true;
  while (grew) {
    grew = false;
    for (const e of screen.elements) {
      if (e.parentId && out.has(e.parentId) && !out.has(e.id)) {
        out.add(e.id);
        grew = true;
      }
    }
  }
  return out;
}

/** 가장 바깥 묶음 */
export function rootOf(screen: Screen, id: string): string {
  const byId = new Map(screen.elements.map((e) => [e.id, e]));
  let cur = byId.get(id);
  const seen = new Set<string>();
  while (cur?.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = byId.get(cur.parentId);
  }
  return cur?.id ?? id;
}

/** 묶음 상자를 자식에 맞춘다 */
export function fitGroups(screen: Screen): Screen {
  const groups = screen.elements.filter((e) => e.type === 'group');
  if (!groups.length) return screen;
  let elements = screen.elements;
  // 안쪽 묶음부터 맞추도록 여러 번 돈다 (깊이가 얕아 충분)
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    elements = elements.map((g) => {
      if (g.type !== 'group') return g;
      const kids = elements.filter((e) => e.parentId === g.id);
      if (!kids.length) return g;
      const x = Math.min(...kids.map((k) => k.x));
      const y = Math.min(...kids.map((k) => k.y));
      const r = Math.max(...kids.map((k) => k.x + k.width));
      const b = Math.max(...kids.map((k) => k.y + k.height));
      if (g.x === x && g.y === y && g.width === r - x && g.height === b - y) return g;
      changed = true;
      return { ...g, x, y, width: r - x, height: b - y };
    });
    if (!changed) break;
  }
  return elements === screen.elements ? screen : { ...screen, elements };
}

export function addElements(screen: Screen, els: SketchElement[]): Screen {
  const base = screen.elements.length;
  const added = els.map((e, i) => ({ ...e, zIndex: base + i }));
  return fitGroups({ ...screen, elements: renumber([...sortedElements(screen), ...added]) });
}

export function updateElement(screen: Screen, id: string, patch: Partial<SketchElement>): Screen {
  let found = false;
  const elements = screen.elements.map((e) => {
    if (e.id !== id) return e;
    found = true;
    return { ...e, ...patch, props: patch.props ? { ...e.props, ...patch.props } : e.props };
  });
  return found ? fitGroups({ ...screen, elements }) : screen;
}

export function moveElements(screen: Screen, ids: Iterable<string>, dx: number, dy: number): Screen {
  if (!dx && !dy) return screen;
  const all = withDescendants(screen, ids);
  const elements = screen.elements.map((e) =>
    all.has(e.id) && !e.props.locked ? { ...e, x: Math.round(e.x + dx), y: Math.round(e.y + dy) } : e,
  );
  return fitGroups({ ...screen, elements });
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 요소 하나의 크기를 바꾼다. 묶음이면 자식을 같은 비율로 늘린다 */
export function resizeElement(screen: Screen, id: string, rect: Rect): Screen {
  const el = screen.elements.find((e) => e.id === id);
  if (!el || el.props.locked) return screen;
  const next: Rect = {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(el.type === 'connector' ? 0 : 4, Math.round(rect.width)),
    height: Math.max(el.type === 'connector' ? 0 : 4, Math.round(rect.height)),
  };
  if (el.type !== 'group') return updateElement(screen, id, next);
  const sx = el.width ? next.width / el.width : 1;
  const sy = el.height ? next.height / el.height : 1;
  const kids = withDescendants(screen, [id]);
  kids.delete(id);
  const elements = screen.elements.map((e) => {
    if (e.id === id) return { ...e, ...next };
    if (!kids.has(e.id)) return e;
    return {
      ...e,
      x: Math.round(next.x + (e.x - el.x) * sx),
      y: Math.round(next.y + (e.y - el.y) * sy),
      width: Math.round(e.width * sx),
      height: Math.round(e.height * sy),
    };
  });
  return fitGroups({ ...screen, elements });
}

/**
 * 요소를 지운다. 지운 요소에서 시작하는 동작은 함께 지우고,
 * 지운 요소를 대상으로 하던 동작은 남겨 "깨진 연결"로 표시되게 한다 (기획서 3장).
 */
export function deleteElements(screen: Screen, ids: Iterable<string>): Screen {
  const all = withDescendants(screen, ids);
  if (!all.size) return screen;
  // 자식이 모두 지워진 묶음도 함께 지운다
  for (let grew = true; grew; ) {
    grew = false;
    for (const g of screen.elements) {
      if (g.type !== 'group' || all.has(g.id)) continue;
      const kids = screen.elements.filter((e) => e.parentId === g.id);
      if (kids.length && kids.every((k) => all.has(k.id))) {
        all.add(g.id);
        grew = true;
      }
    }
  }
  const elements = renumber(sortedElements(screen).filter((e) => !all.has(e.id)));
  const interactions = screen.interactions.filter((i) => !all.has(i.sourceId));
  const states = screen.states.filter((s) => !s.targetId || !all.has(s.targetId));
  return fitGroups({ ...screen, elements, interactions, states });
}

/** 복제·붙여넣기. 새 id 를 매기고 묶음 관계·안쪽 동작을 새 id 로 옮긴다 */
export function cloneElements(
  source: SketchElement[],
  sourceInteractions: Interaction[],
  dx: number,
  dy: number,
): { elements: SketchElement[]; interactions: Interaction[] } {
  const idMap = new Map<string, string>();
  for (const e of source) idMap.set(e.id, newId(e.type));
  const elements = source.map((e) => ({
    ...e,
    id: idMap.get(e.id)!,
    x: e.x + dx,
    y: e.y + dy,
    parentId: e.parentId && idMap.has(e.parentId) ? idMap.get(e.parentId) : undefined,
    props: { ...e.props },
  }));
  const interactions = sourceInteractions
    .filter((i) => idMap.has(i.sourceId))
    .map((i) => ({
      ...i,
      id: newId('ix'),
      sourceId: idMap.get(i.sourceId)!,
      targetId: i.targetId && idMap.has(i.targetId) ? idMap.get(i.targetId) : i.targetId,
    }));
  return { elements, interactions };
}

export function duplicateElements(screen: Screen, ids: Iterable<string>, offset = 16): { screen: Screen; newIds: string[] } {
  const all = withDescendants(screen, ids);
  const src = sortedElements(screen).filter((e) => all.has(e.id));
  if (!src.length) return { screen, newIds: [] };
  const { elements, interactions } = cloneElements(src, screen.interactions, offset, offset);
  let next = addElements(screen, elements);
  next = { ...next, interactions: [...next.interactions, ...interactions] };
  const roots = elements.filter((e) => !e.parentId || !elements.some((o) => o.id === e.parentId)).map((e) => e.id);
  return { screen: next, newIds: roots };
}

export function bringToFront(screen: Screen, ids: Iterable<string>): Screen {
  const all = withDescendants(screen, ids);
  const sorted = sortedElements(screen);
  return { ...screen, elements: renumber([...sorted.filter((e) => !all.has(e.id)), ...sorted.filter((e) => all.has(e.id))]) };
}

export function sendToBack(screen: Screen, ids: Iterable<string>): Screen {
  const all = withDescendants(screen, ids);
  const sorted = sortedElements(screen);
  return { ...screen, elements: renumber([...sorted.filter((e) => all.has(e.id)), ...sorted.filter((e) => !all.has(e.id))]) };
}

/** 한 칸 앞으로(+1) 또는 뒤로(-1) */
export function shiftOrder(screen: Screen, ids: Iterable<string>, dir: 1 | -1): Screen {
  const all = withDescendants(screen, ids);
  const sorted = sortedElements(screen);
  const arr = [...sorted];
  if (dir === 1) {
    for (let i = arr.length - 2; i >= 0; i--) {
      if (all.has(arr[i].id) && !all.has(arr[i + 1].id)) [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
    }
  } else {
    for (let i = 1; i < arr.length; i++) {
      if (all.has(arr[i].id) && !all.has(arr[i - 1].id)) [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
    }
  }
  return { ...screen, elements: renumber(arr) };
}

export function groupElements(screen: Screen, ids: string[], name = '묶음'): { screen: Screen; groupId?: string } {
  const roots = [...new Set(ids.map((id) => rootOf(screen, id)))];
  if (roots.length < 2) return { screen };
  const groupId = newId('group');
  const members = screen.elements.filter((e) => roots.includes(e.id));
  const group: SketchElement = {
    id: groupId,
    type: 'group',
    name,
    x: Math.min(...members.map((m) => m.x)),
    y: Math.min(...members.map((m) => m.y)),
    width: 0,
    height: 0,
    zIndex: 0,
    props: {},
    semanticRole: '',
    notes: '',
  };
  const maxZ = Math.max(...members.map((m) => m.zIndex));
  const elements = screen.elements.map((e) => (roots.includes(e.id) ? { ...e, parentId: groupId } : e));
  // 묶음 요소 자체는 가장 위의 구성원 바로 아래 순서에 둔다
  const sorted = sortedElements({ ...screen, elements });
  const at = sorted.findIndex((e) => e.zIndex === maxZ);
  sorted.splice(at + 1, 0, group);
  return { screen: fitGroups({ ...screen, elements: renumber(sorted) }), groupId };
}

export function ungroup(screen: Screen, groupId: string): { screen: Screen; childIds: string[] } {
  const g = screen.elements.find((e) => e.id === groupId && e.type === 'group');
  if (!g) return { screen, childIds: [] };
  const childIds = screen.elements.filter((e) => e.parentId === groupId).map((e) => e.id);
  const elements = renumber(
    sortedElements(screen)
      .filter((e) => e.id !== groupId)
      .map((e) => (e.parentId === groupId ? { ...e, parentId: g.parentId } : e)),
  );
  // 묶음을 가리키던 동작·상태는 깨진 연결이 되지 않게 그대로 둔다 (검증에서 알린다)
  const interactions = screen.interactions.filter((i) => i.sourceId !== groupId);
  return { screen: fitGroups({ ...screen, elements, interactions }), childIds };
}

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export function alignElements(screen: Screen, ids: string[], mode: AlignMode): Screen {
  const els = screen.elements.filter((e) => ids.includes(e.id));
  if (els.length < 2) return screen;
  const L = Math.min(...els.map((e) => e.x));
  const T = Math.min(...els.map((e) => e.y));
  const R = Math.max(...els.map((e) => e.x + e.width));
  const B = Math.max(...els.map((e) => e.y + e.height));
  let next = screen;
  for (const e of els) {
    let dx = 0;
    let dy = 0;
    if (mode === 'left') dx = L - e.x;
    if (mode === 'right') dx = R - (e.x + e.width);
    if (mode === 'hcenter') dx = Math.round((L + R) / 2 - (e.x + e.width / 2));
    if (mode === 'top') dy = T - e.y;
    if (mode === 'bottom') dy = B - (e.y + e.height);
    if (mode === 'vcenter') dy = Math.round((T + B) / 2 - (e.y + e.height / 2));
    next = moveElements(next, [e.id], dx, dy);
  }
  return next;
}

// ---- 동작·상태·메모·필기 ----

export function addInteraction(screen: Screen, ix: Interaction): Screen {
  return { ...screen, interactions: [...screen.interactions, ix] };
}

export function updateInteraction(screen: Screen, id: string, patch: Partial<Interaction>): Screen {
  return { ...screen, interactions: screen.interactions.map((i) => (i.id === id ? { ...i, ...patch } : i)) };
}

export function deleteInteraction(screen: Screen, id: string): Screen {
  return { ...screen, interactions: screen.interactions.filter((i) => i.id !== id) };
}

export function addState(screen: Screen, st: ScreenState): Screen {
  return { ...screen, states: [...screen.states, st] };
}

export function updateState(screen: Screen, id: string, patch: Partial<ScreenState>): Screen {
  return { ...screen, states: screen.states.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

export function deleteState(screen: Screen, id: string): Screen {
  return { ...screen, states: screen.states.filter((s) => s.id !== id) };
}

export function addNote(screen: Screen, note: ScreenNote): Screen {
  return { ...screen, notes: [...screen.notes, note] };
}

export function updateNote(screen: Screen, id: string, patch: Partial<ScreenNote>): Screen {
  return { ...screen, notes: screen.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) };
}

export function deleteNote(screen: Screen, id: string): Screen {
  return { ...screen, notes: screen.notes.filter((n) => n.id !== id) };
}

export function addStroke(screen: Screen, stroke: Stroke): Screen {
  return { ...screen, strokes: [...screen.strokes, stroke] };
}

export function deleteStroke(screen: Screen, id: string): Screen {
  return { ...screen, strokes: screen.strokes.filter((s) => s.id !== id) };
}

// ---- 화면 ----

export function addScreen(project: Project, name: string, width: number, height: number): { project: Project; screenId: string } {
  const s = createScreen(name, width, height);
  return { project: { ...project, screens: [...project.screens, s] }, screenId: s.id };
}

/** 상태 화면 등을 위해 화면을 복제한다. 안쪽 id 는 모두 새로 매긴다 */
export function duplicateScreen(project: Project, screenId: string, name?: string): { project: Project; screenId?: string } {
  const src = findScreen(project, screenId);
  if (!src) return { project };
  const { elements, interactions } = cloneElements(src.elements, src.interactions, 0, 0);
  const idMap = new Map(src.elements.map((e, i) => [e.id, elements[i].id]));
  const copy: Screen = {
    ...src,
    id: newId('scr'),
    name: name ?? `${src.name} 사본`,
    elements,
    interactions,
    notes: src.notes.map((n) => ({ ...n, id: newId('note') })),
    states: src.states.map((s) => ({ ...s, id: newId('st'), targetId: s.targetId ? idMap.get(s.targetId) ?? s.targetId : undefined })),
    strokes: src.strokes.map((s) => ({ ...s, id: newId('stk'), points: s.points.map((p) => [...p] as typeof p) })),
  };
  const idx = project.screens.findIndex((s) => s.id === screenId);
  const screens = [...project.screens];
  screens.splice(idx + 1, 0, copy);
  return { project: { ...project, screens }, screenId: copy.id };
}

/** 화면을 지운다. 이 화면으로 이동하던 동작은 깨진 연결로 남는다 */
export function deleteScreen(project: Project, screenId: string): Project {
  if (project.screens.length <= 1) return project;
  return { ...project, screens: project.screens.filter((s) => s.id !== screenId) };
}

export function moveScreen(project: Project, screenId: string, dir: 1 | -1): Project {
  const i = project.screens.findIndex((s) => s.id === screenId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= project.screens.length) return project;
  const screens = [...project.screens];
  [screens[i], screens[j]] = [screens[j], screens[i]];
  return { ...project, screens };
}

export function updateScreen(project: Project, screenId: string, patch: Partial<Pick<Screen, 'name' | 'width' | 'height'>>): Project {
  return mapScreen(project, screenId, (s) => ({ ...s, ...patch }));
}

/** 요소 id 가 어느 화면에 있는지 */
export function locateElement(project: Project, elementId: string): { screen: Screen; element: SketchElement } | undefined {
  for (const screen of project.screens) {
    const element = screen.elements.find((e) => e.id === elementId);
    if (element) return { screen, element };
  }
  return undefined;
}
