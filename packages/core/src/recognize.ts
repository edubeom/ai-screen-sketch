// 손으로 그린 선 하나를 모형(네모·원·별·세모·마름모)으로 알아본다.
// 닫힌 선이고 충분히 클 때만 바꾼다 -- 글씨·열린 선은 그대로 필기로 둔다.
import type { ShapeKind, StrokePoint } from './types.ts';

export interface RecognizedShape {
  kind: ShapeKind;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface P {
  x: number;
  y: number;
}

/** 이보다 작은 선은 글씨로 보고 바꾸지 않는다 (화면 좌표 px) */
export const MIN_SHAPE_SIZE = 40;

const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.y - b.y);

function segDist(p: P, a: P, b: P): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 닫힌 경로를 n 개의 같은 간격 점으로 */
function resampleClosed(pts: P[], n: number): P[] {
  const ring = [...pts, pts[0]];
  let total = 0;
  for (let i = 1; i < ring.length; i++) total += dist(ring[i - 1], ring[i]);
  const step = total / n;
  const out: P[] = [ring[0]];
  let acc = 0;
  for (let i = 1; i < ring.length && out.length < n; i++) {
    let a = ring[i - 1];
    const b = ring[i];
    let d = dist(a, b);
    while (acc + d >= step && out.length < n) {
      const t = (step - acc) / d;
      const q = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
      out.push(q);
      a = q;
      d = dist(a, b);
      acc = 0;
    }
    acc += d;
  }
  return out;
}

function douglasPeucker(pts: P[], eps: number): P[] {
  if (pts.length < 3) return pts;
  let idx = 0;
  let max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  const left = douglasPeucker(pts.slice(0, idx + 1), eps);
  const right = douglasPeucker(pts.slice(idx), eps);
  return [...left.slice(0, -1), ...right];
}

/** 닫힌 경로의 꼭짓점: 가장 먼 두 점으로 나눠 양쪽을 줄인다 */
function corners(ring: P[], eps: number): P[] {
  let a = 0;
  let b = 0;
  let max = 0;
  for (let i = 0; i < ring.length; i++) {
    const d = dist(ring[0], ring[i]);
    if (d > max) {
      max = d;
      b = i;
    }
  }
  max = 0;
  for (let i = 0; i < ring.length; i++) {
    const d = dist(ring[b], ring[i]);
    if (d > max) {
      max = d;
      a = i;
    }
  }
  const [s, e] = a < b ? [a, b] : [b, a];
  const half1 = douglasPeucker(ring.slice(s, e + 1), eps);
  const half2 = douglasPeucker([...ring.slice(e), ...ring.slice(0, s + 1)], eps);
  const poly = [...half1.slice(0, -1), ...half2.slice(0, -1)];
  // 너무 가까운 꼭짓점은 하나로
  const out: P[] = [];
  for (const p of poly) if (!out.some((q) => dist(p, q) < eps * 1.5)) out.push(p);
  return out;
}

function segmentsCross(a: P, b: P, c: P, d: P): boolean {
  const o = (p: P, q: P, r: P) => Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

function selfIntersects(poly: P[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** 점들이 다각형 변에서 평균적으로 얼마나 떨어졌나 (크기 대비) */
function polygonFit(ring: P[], poly: P[], size: number): number {
  let sum = 0;
  for (const p of ring) {
    let m = Infinity;
    for (let i = 0; i < poly.length; i++) m = Math.min(m, segDist(p, poly[i], poly[(i + 1) % poly.length]));
    sum += m;
  }
  return sum / ring.length / size;
}

export function recognizeShape(points: StrokePoint[]): RecognizedShape | undefined {
  if (points.length < 8) return undefined;
  const raw: P[] = points.map(([x, y]) => ({ x, y }));
  const xs = raw.map((p) => p.x);
  const ys = raw.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  const w = Math.max(...xs) - x;
  const h = Math.max(...ys) - y;
  const size = Math.max(w, h);
  if (size < MIN_SHAPE_SIZE || Math.min(w, h) < size * 0.2) return undefined;
  // 닫힌 선인지: 끝점이 시작점 가까이 (또는 지나서 겹침)
  let gap = dist(raw[0], raw[raw.length - 1]);
  for (let i = Math.floor(raw.length * 0.75); i < raw.length; i++) gap = Math.min(gap, dist(raw[0], raw[i]));
  if (gap > size * 0.3) return undefined;
  let length = 0;
  for (let i = 1; i < raw.length; i++) length += dist(raw[i - 1], raw[i]);
  if (length > (w + h) * 2 * 2.2) return undefined; // 여러 번 덧그린 낙서

  const ring = resampleClosed(raw, 96);
  const box = { x, y, width: Math.round(w), height: Math.round(h) };
  const out = (kind: ShapeKind): RecognizedShape => ({ kind, x: Math.round(box.x), y: Math.round(box.y), width: box.width, height: box.height });

  const cx = x + w / 2;
  const cy = y + h / 2;
  const eEllipse = ring.reduce((s, p) => s + Math.abs(Math.hypot((p.x - cx) / (w / 2), (p.y - cy) / (h / 2)) - 1), 0) / ring.length;
  const eRect = ring.reduce((s, p) => s + Math.min(p.x - x, x + w - p.x, p.y - y, y + h - p.y), 0) / ring.length / (Math.min(w, h) / 2);
  const poly = corners(ring, size * 0.07);
  const n = poly.length;
  const fit = polygonFit(ring, poly, size);

  // 별: 한 번에 긋는 오각별(선이 엇갈림) 또는 안팎이 번갈아 나오는 10꼭짓점
  if (n === 5 && selfIntersects(poly) && fit < 0.05) return out('star');
  if (n >= 8 && n <= 12 && fit < 0.05) {
    const pc = { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
    const r = poly.map((p) => dist(p, pc));
    const even = r.filter((_, i) => i % 2 === 0);
    const odd = r.filter((_, i) => i % 2 === 1);
    const avg = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
    const [outer, inner] = avg(even) > avg(odd) ? [even, odd] : [odd, even];
    if (Math.max(...inner) < Math.min(...outer) * 0.85 && avg(inner) / avg(outer) < 0.7) return out('star');
  }
  if (eEllipse < 0.12 && eEllipse < eRect) return out('ellipse');
  if (eRect < 0.12 && eRect <= eEllipse) return out('rect');
  if (n === 3 && fit < 0.05) return out('triangle');
  if (n === 4 && fit < 0.05) {
    const mids = [
      { x: cx, y },
      { x: x + w, y: cy },
      { x: cx, y: y + h },
      { x, y: cy },
    ];
    if (poly.every((p) => mids.some((m) => dist(p, m) < size * 0.2))) return out('diamond');
    return out('rect');
  }
  return undefined;
}

/** 모형 테두리 점 (0~1 상자 기준) -- 그리기·PNG 공용 */
export function shapeOutline(kind: ShapeKind): [number, number][] | undefined {
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
