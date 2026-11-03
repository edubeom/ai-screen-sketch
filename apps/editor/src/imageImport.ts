// 이미지 가져오기: 그림만 넣기 / 모양 찾기(브라우저, 토큰 0) / AI 분석(서버의 Codex, 모양 찾기 결과에 종류·글을 붙임).
// AI 에는 줄인 흑백 그림 + 찾은 상자 목록만 보낸다 -- 모양·자리는 브라우저가 이미 찾았으므로 AI 는 이름표만 붙인다.
import {
  addElements,
  createElement,
  createScreen,
  sendToBack,
  type ElementType,
  type SketchElement,
} from '@sketch/core';
import { detectShapes, type Detection } from '@sketch/vision';
import { storeImageAsset } from './actions.ts';
import { commit, getState, loadPref, savePref, setState } from './store.ts';

export type ImageMode = 'image' | 'shapes' | 'ai';
export type ImageTarget = 'new' | 'current';

/** 분석할 때 그림의 긴 변 (px) -- 더 크면 줄여서 본다 */
const ANALYZE_MAX = 1600;
/** AI 에 보낼 그림의 긴 변 -- 작을수록 토큰이 적다 */
const AI_MAX = 1024;

export interface LocalAnalysis {
  detection: Detection;
  /** 분석 그림 px → 원본 그림 px */
  scale: number;
  ms: number;
}

export interface AiStatus {
  available: boolean;
  provider?: string;
  model?: string | null;
  reason?: string | null;
}

export interface AiElementOut {
  candidate: number | null;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  role: string;
}

export interface AiResponse {
  screenName: string;
  elements: AiElementOut[];
  usage?: { input: number; cachedInput: number; output: number } | null;
  cached: boolean;
  ms: number;
}

function drawScaled(bmp: ImageBitmap, max: number, gray = false): { canvas: HTMLCanvasElement; scale: number } {
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (gray) ctx.filter = 'grayscale(1)';
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return { canvas, scale };
}

export async function analyzeLocally(file: File): Promise<LocalAnalysis> {
  const t0 = performance.now();
  const bmp = await createImageBitmap(file);
  try {
    const { canvas, scale } = drawScaled(bmp, ANALYZE_MAX);
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height);
    // 화면이 멈추지 않게 한 번 숨을 돌린 뒤 계산
    await new Promise((r) => setTimeout(r, 0));
    const detection = detectShapes(data.data, canvas.width, canvas.height);
    return { detection, scale: 1 / scale, ms: Math.round(performance.now() - t0) };
  } finally {
    bmp.close();
  }
}

export async function aiStatus(): Promise<AiStatus> {
  try {
    const r = await fetch('api/ai/status', { cache: 'no-store' });
    if (!r.ok) return { available: false, reason: '이 서버에는 AI 분석이 없습니다 (정적 호스팅)' };
    return (await r.json()) as AiStatus;
  } catch {
    return { available: false, reason: '서버에 연결할 수 없습니다' };
  }
}

export function aiToken(): string {
  return loadPref<string>('aiToken', '');
}
export function setAiToken(t: string) {
  savePref('aiToken', t.trim());
}

/** 찾은 것들에 번호를 붙인 후보 목록 (AI 가 이 번호로 답한다) */
function candidatesOf(d: Detection, k: number) {
  const out: { id: number; kind: string; x: number; y: number; w: number; h: number }[] = [];
  d.shapes.forEach((s, i) => out.push({ id: i, kind: s.kind, x: s.x * k, y: s.y * k, w: s.width * k, h: s.height * k }));
  d.fills.forEach((s, i) => out.push({ id: 500 + i, kind: 'fill', x: s.x * k, y: s.y * k, w: s.width * k, h: s.height * k }));
  d.textLines.forEach((s, i) => out.push({ id: 1000 + i, kind: 'text', x: s.x * k, y: s.y * k, w: s.width * k, h: s.height * k }));
  return out;
}

export async function analyzeWithAi(file: File, local: LocalAnalysis, hint: string): Promise<AiResponse & { aiScale: number }> {
  const bmp = await createImageBitmap(file);
  let image: string;
  let aiScale: number;
  let width: number;
  let height: number;
  try {
    // 토큰 줄이기: 긴 변 1024px, 흑백, JPEG
    const { canvas, scale } = drawScaled(bmp, AI_MAX, true);
    image = canvas.toDataURL('image/jpeg', 0.72);
    aiScale = scale;
    width = canvas.width;
    height = canvas.height;
  } finally {
    bmp.close();
  }
  // 분석 그림 좌표 → AI 그림 좌표
  const k = local.scale * aiScale;
  const r = await fetch('api/ai/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-sketch-token': aiToken() },
    body: JSON.stringify({ image, width, height, candidates: candidatesOf(local.detection, k), hint }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error ?? `AI 분석 실패 (${r.status})`);
  return { ...(body as AiResponse), aiScale };
}

const AI_TYPES: ElementType[] = ['region', 'text', 'button', 'input', 'list', 'card', 'image', 'note', 'shape'];

/** 찾은 것 → 요소. k: 원본 그림 px → 화면 px */
function elementsFromDetection(d: Detection, k: number): SketchElement[] {
  const els: SketchElement[] = [];
  for (const s of d.shapes) {
    els.push(
      createElement('shape', s.x * k, s.y * k, {
        width: Math.round(s.width * k),
        height: Math.round(s.height * k),
        name: '찾은 모형',
        text: '',
        props: { shapeKind: s.kind, stroke: s.color, ...(s.vertices ? { vertices: s.vertices } : {}) },
      }),
    );
  }
  for (const f of d.fills) {
    els.push(createElement('shape', f.x * k, f.y * k, { width: Math.round(f.width * k), height: Math.round(f.height * k), name: '찾은 칠한 상자', text: '', props: { shapeKind: 'rect', fill: f.color, stroke: f.color } }));
  }
  for (const t of d.textLines) {
    els.push(createElement('text', t.x * k, t.y * k, { width: Math.round(t.width * k), height: Math.round(t.height * k), name: '글 자리', text: '(글)', notes: '그림에서 찾은 글 자리 -- 문구를 적어 주세요' }));
  }
  return els;
}

function elementsFromAi(ai: AiResponse, d: Detection, k: number): SketchElement[] {
  // k: AI 그림 px → 화면 px
  const shapeById = new Map(d.shapes.map((s, i) => [i, s]));
  return ai.elements.map((e) => {
    const type = AI_TYPES.includes(e.type as ElementType) ? (e.type as ElementType) : 'region';
    const base = { width: Math.max(4, Math.round(e.w * k)), height: Math.max(4, Math.round(e.h * k)), name: e.text.trim().slice(0, 30) || e.role || type, semanticRole: e.role, notes: 'AI 분석으로 만든 요소' };
    if (type === 'shape') {
      const src = e.candidate !== null ? shapeById.get(e.candidate) : undefined;
      return createElement('shape', e.x * k, e.y * k, { ...base, text: e.text, props: { shapeKind: src?.kind ?? 'rect', stroke: src?.color ?? '#1e293b', ...(src?.vertices ? { vertices: src.vertices } : {}) } });
    }
    return createElement(type, e.x * k, e.y * k, { ...base, ...(type === 'image' ? {} : { text: e.text }) });
  });
}

export interface ImageImportResult {
  count: number;
  screenId: string;
}

/**
 * 가져온 그림을 화면에 넣는다. 원본 그림은 잠근 "원본 그림" 요소로 맨 뒤에 깐다 (끄면 안 깐다).
 * 새 화면이면 그림 크기에 맞춘 화면을 만든다 (너비 390~1920 사이로).
 */
export async function applyImageImport(opts: {
  file: File;
  mode: ImageMode;
  target: ImageTarget;
  background: boolean;
  local?: LocalAnalysis;
  ai?: AiResponse & { aiScale: number };
  name?: string;
}): Promise<ImageImportResult | undefined> {
  const stored = await storeImageAsset(opts.file);
  if (!stored) return undefined;
  const { assetId, width: iw, height: ih } = stored;
  let project = stored.project;
  let screen = project.screens.find((s) => s.id === getState().screenId) ?? project.screens[0];
  let k: number; // 원본 그림 px → 화면 px
  if (opts.target === 'new') {
    const w = Math.min(1920, Math.max(390, iw));
    k = w / iw;
    const name = (opts.name || opts.ai?.screenName || opts.file.name.replace(/\.[^.]+$/, '')).slice(0, 60) || '가져온 화면';
    screen = createScreen(name, Math.round(w), Math.max(100, Math.round(ih * k)));
    project = { ...project, screens: [...project.screens, screen] };
  } else {
    k = Math.min(screen.width / iw, screen.height / ih, 1);
  }

  let els: SketchElement[] = [];
  if (opts.mode === 'ai' && opts.ai && opts.local) els = elementsFromAi(opts.ai, opts.local.detection, k / opts.ai.aiScale);
  else if (opts.mode !== 'image' && opts.local) els = elementsFromDetection(opts.local.detection, k * opts.local.scale);
  // 큰 것이 아래로 (틀 안에 작은 것이 보이게)
  els.sort((a, b) => b.width * b.height - a.width * a.height);

  const bg =
    opts.background || opts.mode === 'image'
      ? createElement('image', 0, 0, { width: Math.round(iw * k), height: Math.round(ih * k), name: '원본 그림', props: { assetId, locked: opts.mode !== 'image' } })
      : undefined;
  let next = addElements(screen, [...(bg ? [bg] : []), ...els]);
  if (bg) next = sendToBack(next, [bg.id]);
  project = { ...project, screens: project.screens.map((s) => (s.id === next.id ? next : s)) };
  commit(project, { selection: [] });
  setState({ screenId: next.id, selection: [], enteredGroup: undefined });
  return { count: els.length, screenId: next.id };
}
