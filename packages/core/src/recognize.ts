// 손으로 그린 선(여러 획도 가능)을 모형(네모·원·별·세모·마름모)으로 알아본다.
// 획 순서·방향과 상관없이, 점들이 모형 테두리 "위에" 있는지(정확도)와 테두리를 "빠짐없이" 덮는지(완성도)로 본다.
// 그래서 네모를 ㄷ+| 두 획으로 그리거나, 끝이 삐져나오거나, 조금 덜 닫혀도 알아본다.
import type { ShapeKind, StrokePoint } from './types.ts';

export interface RecognizedShape {
  kind: ShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 세모 꼭짓점 (상자 0~1 기준) */
  vertices?: [number, number][];
}

interface P {
  x: number;
  y: number;
}

/** 이보다 작은 선은 글씨로 보고 바꾸지 않는다 (화면 좌표 px) */
export const MIN_SHAPE_SIZE = 40;
/** 테두리에서 이만큼(크기 대비) 안에 있으면 테두리 위로 본다 */
const TOL = 0.09;
/** 점의 이 비율 이상이 테두리 위에 있어야 (삐져나온 꼬리는 나머지) */
const MIN_INLIER = 0.85;
/** 테두리의 이 비율 이상이 점으로 덮여야 (빈 변이 있으면 안 됨) */
const MIN_COVER = 0.9;

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

function segDist(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 획 하나를 step 간격 점으로 */
function resample(pts: P[], step: number): P[] {
  if (pts.length < 2) return pts.slice();
  const out: P[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let d = dist(a, b);
    while (carry + d >= step) {
      const t = (step - carry) / d;
      a = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      out.push(a);
      d = dist(a, b);
      carry = 0;
    }
    carry += d;
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** 0~1 상자 기준 닫힌 다각형들 (선분 목록) */
type Template = { kind: ShapeKind; polys: [number, number][][]; vertices?: [number, number][] };

function ellipsePoly(): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    out.push([0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a)]);
  }
  return out;
}

const STAR = shapeOutline('star')!;
const FIXED_TEMPLATES: Template[] = [
  { kind: 'rect', polys: [[[0, 0], [1, 0], [1, 1], [0, 1]]] },
  { kind: 'ellipse', polys: [ellipsePoly()] },
  { kind: 'diamond', polys: [[[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]]] },
  { kind: 'star', polys: [STAR] },
  // 한붓 오각별: 바깥 꼭짓점을 하나 건너 잇는 선
  { kind: 'star', polys: [[0, 4, 8, 2, 6].map((i) => STAR[i])] },
];

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function cross(o: P, a: P, b: P) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHull(pts: P[]): P[] {
  const s = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  const lower: P[] = [];
  for (const p of s) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: P[] = [];
  for (let i = s.length - 1; i >= 0; i--) {
    const p = s[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** 껍질 위에서 넓이가 가장 큰 세모 */
function biggestTriangle(hull: P[]): [P, P, P] | undefined {
  const n = hull.length;
  if (n < 3) return undefined;
  const h = n > 40 ? hull.filter((_, i) => i % Math.ceil(n / 40) === 0) : hull;
  let best: [P, P, P] | undefined;
  let area = 0;
  for (let i = 0; i < h.length; i++)
    for (let j = i + 1; j < h.length; j++)
      for (let k = j + 1; k < h.length; k++) {
        const a = Math.abs(cross(h[i], h[j], h[k]));
        if (a > area) {
          area = a;
          best = [h[i], h[j], h[k]];
        }
      }
  return best;
}

/** 획들의 상자가 margin 안으로 서로 이어져 있는지 */
function connected(strokes: P[][], margin: number): boolean {
  const boxes = strokes.map((s) => ({
    x0: Math.min(...s.map((p) => p.x)) - margin,
    y0: Math.min(...s.map((p) => p.y)) - margin,
    x1: Math.max(...s.map((p) => p.x)) + margin,
    y1: Math.max(...s.map((p) => p.y)) + margin,
  }));
  const seen = new Set([0]);
  const stack = [0];
  while (stack.length) {
    const i = stack.pop()!;
    boxes.forEach((b, j) => {
      const a = boxes[i];
      if (!seen.has(j) && a.x0 <= b.x1 && b.x0 <= a.x1 && a.y0 <= b.y1 && b.y0 <= a.y1) {
        seen.add(j);
        stack.push(j);
      }
    });
  }
  return seen.size === strokes.length;
}

function percentile(sorted: number[], q: number) {
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))];
}

interface Score {
  inlier: number;
  cover: number;
  err: number;
}

function score(data: P[], segs: [P, P][], samples: P[], tol: number): Score {
  let inl = 0;
  let err = 0;
  for (const p of data) {
    let m = Infinity;
    for (const [a, b] of segs) m = Math.min(m, segDist(p, a, b));
    if (m <= tol) inl++;
    err += Math.min(m, tol * 2);
  }
  let cov = 0;
  for (const q of samples) {
    for (const p of data) {
      if (Math.abs(p.x - q.x) <= tol && Math.abs(p.y - q.y) <= tol && dist(p, q) <= tol) {
        cov++;
        break;
      }
    }
  }
  return { inlier: inl / data.length, cover: cov / samples.length, err: err / data.length };
}

function place(polys: [number, number][][], box: Box, step: number): { segs: [P, P][]; samples: P[] } {
  const segs: [P, P][] = [];
  const samples: P[] = [];
  for (const poly of polys) {
    const pts = poly.map(([u, v]) => ({ x: box.x + u * box.w, y: box.y + v * box.h }));
    for (let i = 0; i < pts.length; i++) segs.push([pts[i], pts[(i + 1) % pts.length]]);
    samples.push(...resample([...pts, pts[0]], step));
  }
  return { segs, samples };
}

/** 획 여러 개(또는 하나)를 모형으로 알아본다. 못 알아보면 undefined */
export function recognizeShape(strokes: StrokePoint[][] | StrokePoint[]): RecognizedShape | undefined {
  const list: StrokePoint[][] = strokes.length && typeof (strokes as StrokePoint[])[0][0] === 'number' ? [strokes as StrokePoint[]] : (strokes as StrokePoint[][]);
  const raw = list.map((s) => s.map(([x, y]) => ({ x, y })));
  const all = raw.flat();
  if (all.length < 6) return undefined;
  const xs = all.map((p) => p.x).sort((a, b) => a - b);
  const ys = all.map((p) => p.y).sort((a, b) => a - b);
  const size0 = Math.max(xs[xs.length - 1] - xs[0], ys[ys.length - 1] - ys[0]);
  if (size0 < MIN_SHAPE_SIZE) return undefined;
  // 여러 획이면 서로 닿거나 겹쳐야 한 모형이다 (따로 떨어진 그림은 묶지 않는다)
  if (raw.length > 1 && !connected(raw, size0 * 0.08)) return undefined;
  const step = size0 / 60;
  let data = raw.flatMap((s) => resample(s, step));
  if (data.length > 160) data = data.filter((_, i) => i % Math.ceil(data.length / 160) === 0);

  // 삐져나온 꼬리를 빼 보는 상자 후보 (양 끝을 0·4·8·13% 잘라 봄)
  const trims = [0, 0.04, 0.08, 0.13];
  const xRanges = trims.flatMap((lo) => trims.map((hi) => [percentile(xs, lo), percentile(xs, 1 - hi)] as const));
  const yRanges = trims.flatMap((lo) => trims.map((hi) => [percentile(ys, lo), percentile(ys, 1 - hi)] as const));

  let best: { kind: ShapeKind; box: Box; err: number; vertices?: [number, number][] } | undefined;
  const consider = (t: Template, box: Box) => {
    const size = Math.max(box.w, box.h);
    const minSide = Math.min(box.w, box.h);
    if (size < MIN_SHAPE_SIZE || minSide < size * 0.2) return;
    // 별은 대체로 가로세로가 비슷하다
    if (t.kind === 'star' && (box.w / box.h < 0.6 || box.w / box.h > 1.7)) return;
    // 긴 상자에서 허용 거리가 짧은 변에 비해 너무 크지 않게
    const tol = Math.min(size, minSide * 3) * TOL;
    const { segs, samples } = place(t.polys, box, size / 40);
    const sc = score(data, segs, samples, tol);
    if (sc.inlier < MIN_INLIER || sc.cover < MIN_COVER) return;
    const err = sc.err / size;
    if (!best || err < best.err - 0.002) best = { kind: t.kind, box, err, vertices: t.vertices };
  };

  for (const [x0, x1] of xRanges) {
    for (const [y0, y1] of yRanges) {
      const box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      for (const t of FIXED_TEMPLATES) consider(t, box);
    }
    if (best && best.err < 0.015) break; // 충분히 잘 맞으면 더 찾지 않는다
  }

  // 세모: 꼭짓점이 어디든 (직각삼각형 등) -- 껍질의 가장 큰 세모를 틀로
  const tri = biggestTriangle(convexHull(data));
  if (tri) {
    const bx0 = Math.min(...tri.map((p) => p.x));
    const by0 = Math.min(...tri.map((p) => p.y));
    const bw = Math.max(...tri.map((p) => p.x)) - bx0;
    const bh = Math.max(...tri.map((p) => p.y)) - by0;
    if (bw > 0 && bh > 0) {
      const vertices = tri.map((p) => [(p.x - bx0) / bw, (p.y - by0) / bh] as [number, number]);
      consider({ kind: 'triangle', polys: [vertices], vertices }, { x: bx0, y: by0, w: bw, h: bh });
    }
  }
  if (!best) return undefined;
  const b: { kind: ShapeKind; box: Box; vertices?: [number, number][] } = best;
  const out: RecognizedShape = { kind: b.kind, x: Math.round(b.box.x), y: Math.round(b.box.y), width: Math.round(b.box.w), height: Math.round(b.box.h) };
  if (b.kind === 'triangle' && b.vertices) out.vertices = b.vertices.map(([u, v]) => [Math.round(u * 1000) / 1000, Math.round(v * 1000) / 1000]);
  return out;
}

/** 모형 테두리 점 (0~1 상자 기준) -- 그리기·PNG 공용. 네모·원은 따로 그린다 */
export function shapeOutline(kind: ShapeKind, vertices?: [number, number][]): [number, number][] | undefined {
  if (vertices && vertices.length >= 3 && (kind === 'triangle' || kind === 'polygon')) return vertices;
  switch (kind) {
    case 'triangle':
      return [[0.5, 0], [1, 1], [0, 1]];
    case 'diamond':
      return [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
    case 'star': {
      // 정오각별(안쪽 반지름 0.382)을 상자에 꽉 차게 늘린다: 가로 ±0.951R, 세로 -R ~ 0.809R
      const pts: [number, number][] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 === 0 ? 1 : 0.382;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push([(r * Math.cos(a)) / 1.902 + 0.5, (r * Math.sin(a) + 1) / 1.809]);
      }
      return pts;
    }
    default:
      return undefined;
  }
}
