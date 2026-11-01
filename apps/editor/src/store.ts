// 편집기 상태. 실행 취소 히스토리(past/future)와 저장 revision 은 따로 둔다 (기획서 5장).
import { useSyncExternalStore } from 'react';
import { createProject, type Project, type Screen } from '@sketch/core';

export type Tool = 'select' | 'pen' | 'eraser' | 'connect';
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

export interface EditorState {
  project: Project;
  past: Project[];
  future: Project[];
  screenId: string;
  selection: string[];
  /** 묶음 안으로 들어가 개별 요소를 고르는 중이면 그 묶음 id */
  enteredGroup?: string;
  tool: Tool;
  zoom: number;
  pan: { x: number; y: number };
  grid: boolean;
  showLinks: boolean;
  pen: { color: string; width: number };
  /** 저장된 revision (project.revision 과 같게 유지) */
  savedRevision: number;
  saveStatus: SaveStatus;
  saveError?: string;
  lastSavedAt?: string;
  /** 마지막 저장 뒤 바뀌었는지 */
  dirty: boolean;
  /** 자산 id → 화면에 쓰는 object URL */
  assetUrls: Record<string, string>;
  /** 작업판에서 동작 대상을 고르는 중이면 그 동작 id */
  pickingTargetFor?: string;
  /** 동작 편집기에서 펼칠 동작 */
  focusInteraction?: string;
  toast?: { text: string; kind: 'info' | 'error' };
}

const HISTORY_LIMIT = 150;

type Listener = () => void;
const listeners = new Set<Listener>();

function initial(): EditorState {
  const project = createProject('새 프로젝트');
  return {
    project,
    past: [],
    future: [],
    screenId: project.screens[0].id,
    selection: [],
    tool: 'select',
    zoom: 1,
    pan: { x: 40, y: 40 },
    grid: true,
    showLinks: true,
    pen: { color: '#1e293b', width: 3 },
    savedRevision: project.revision,
    saveStatus: 'idle',
    dirty: false,
    assetUrls: {},
  };
}

let state: EditorState = initial();

export function getState(): EditorState {
  return state;
}

export function setState(patch: Partial<EditorState> | ((s: EditorState) => Partial<EditorState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  for (const l of listeners) l();
}

export function subscribe(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useEditor<T>(select: (s: EditorState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

export function currentScreen(s: EditorState = state): Screen {
  return s.project.screens.find((x) => x.id === s.screenId) ?? s.project.screens[0];
}

// ---- 히스토리 ----

let lastCoalesce: { key: string; at: number } | undefined;
let gestureBase: Project | undefined;

function cleanSelection(project: Project, screenId: string, sel: string[]): string[] {
  const screen = project.screens.find((s) => s.id === screenId);
  if (!screen) return [];
  return sel.filter((id) => screen.elements.some((e) => e.id === id));
}

/** 바뀐 프로젝트를 히스토리에 넣으며 적용한다. coalesce 키가 같으면 짧은 시간 안의 변경을 한 번으로 묶는다 */
export function commit(next: Project, opts: { coalesce?: string; selection?: string[] } = {}) {
  if (next === state.project) {
    if (opts.selection) setState({ selection: opts.selection });
    return;
  }
  const now = Date.now();
  const merge = opts.coalesce && lastCoalesce?.key === opts.coalesce && now - lastCoalesce.at < 800;
  lastCoalesce = opts.coalesce ? { key: opts.coalesce, at: now } : undefined;
  const past = merge ? state.past : [...state.past, state.project].slice(-HISTORY_LIMIT);
  const screenId = next.screens.some((s) => s.id === state.screenId) ? state.screenId : next.screens[0].id;
  setState({
    project: next,
    past,
    future: [],
    dirty: true,
    screenId,
    selection: cleanSelection(next, screenId, opts.selection ?? state.selection),
  });
}

export function updateScreen(fn: (s: Screen) => Screen, opts: { coalesce?: string; selection?: string[] } = {}) {
  const p = state.project;
  const screens = p.screens.map((s) => (s.id === state.screenId ? fn(s) : s));
  const changed = screens.some((s, i) => s !== p.screens[i]);
  commit(changed ? { ...p, screens } : p, opts);
}

/** 끌기처럼 계속 바뀌는 조작: 시작 → 미리보기(히스토리 없이) → 끝(한 번만 기록) */
export function beginGesture() {
  gestureBase = state.project;
}
export function previewGesture(next: Project) {
  setState({ project: next, dirty: true });
}
export function gestureBaseProject(): Project {
  return gestureBase ?? state.project;
}
export function endGesture() {
  const base = gestureBase;
  gestureBase = undefined;
  lastCoalesce = undefined;
  if (!base || base === state.project) return;
  setState({ past: [...state.past, base].slice(-HISTORY_LIMIT), future: [] });
}

export function undo() {
  const prev = state.past[state.past.length - 1];
  if (!prev) return;
  lastCoalesce = undefined;
  const screenId = prev.screens.some((s) => s.id === state.screenId) ? state.screenId : prev.screens[0].id;
  setState({
    project: prev,
    past: state.past.slice(0, -1),
    future: [state.project, ...state.future],
    dirty: true,
    screenId,
    selection: cleanSelection(prev, screenId, state.selection),
  });
}

export function redo() {
  const next = state.future[0];
  if (!next) return;
  lastCoalesce = undefined;
  const screenId = next.screens.some((s) => s.id === state.screenId) ? state.screenId : next.screens[0].id;
  setState({
    project: next,
    past: [...state.past, state.project],
    future: state.future.slice(1),
    dirty: true,
    screenId,
    selection: cleanSelection(next, screenId, state.selection),
  });
}

/** 다른 프로젝트를 열 때 (히스토리를 비운다) */
export function loadProject(project: Project, assetUrls: Record<string, string>) {
  for (const url of Object.values(state.assetUrls)) URL.revokeObjectURL(url);
  setState({
    project,
    past: [],
    future: [],
    screenId: project.screens[0].id,
    selection: [],
    enteredGroup: undefined,
    savedRevision: project.revision,
    saveStatus: 'saved',
    saveError: undefined,
    lastSavedAt: project.updatedAt,
    dirty: false,
    assetUrls,
    pickingTargetFor: undefined,
    focusInteraction: undefined,
    zoom: 1,
    pan: { x: 40, y: 40 },
  });
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
export function toast(text: string, kind: 'info' | 'error' = 'info') {
  setState({ toast: { text, kind } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setState({ toast: undefined }), kind === 'error' ? 6000 : 3000);
}
