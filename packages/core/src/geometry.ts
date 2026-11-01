// 좌표 계산 도우미 (화면 좌표 기준)
import type { SketchElement, Stroke } from './types.ts';
import type { Rect } from './ops.ts';

export interface Point {
  x: number;
  y: number;
}

/** 연결선의 시작점·끝점(화살표 쪽) */
export function connectorEnds(el: SketchElement): { a: Point; b: Point } {
  const { x, y, width: w, height: h } = el;
  let a = el.props.flip ? { x, y: y + h } : { x, y };
  let b = el.props.flip ? { x: x + w, y } : { x: x + w, y: y + h };
  if (el.props.reverse) [a, b] = [b, a];
  return { a, b };
}

/** 두 점에서 연결선 상자·방향을 만든다 */
export function connectorFromEnds(a: Point, b: Point): Pick<SketchElement, 'x' | 'y' | 'width' | 'height'> & { flip: boolean; reverse: boolean } {
  const x = Math.round(Math.min(a.x, b.x));
  const y = Math.round(Math.min(a.y, b.y));
  const width = Math.round(Math.abs(b.x - a.x));
  const height = Math.round(Math.abs(b.y - a.y));
  // 왼쪽 점이 아래에 있으면 flip
  const left = a.x < b.x || (a.x === b.x && a.y <= b.y) ? a : b;
  const right = left === a ? b : a;
  const flip = left.y > right.y;
  const reverse = left === b;
  return { x, y, width, height, flip, reverse };
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

export function normRect(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) };
}

export function unionRect(rects: Rect[]): Rect | undefined {
  if (!rects.length) return undefined;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const r = Math.max(...rects.map((q) => q.x + q.width));
  const b = Math.max(...rects.map((q) => q.y + q.height));
  return { x, y, width: r - x, height: b - y };
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** 필기 선이 점 근처를 지나는지 (지우개) */
export function strokeHit(stroke: Stroke, p: Point, tolerance: number): boolean {
  const pts = stroke.points;
  if (pts.length === 1) return Math.hypot(pts[0][0] - p.x, pts[0][1] - p.y) <= tolerance + stroke.width;
  for (let i = 1; i < pts.length; i++) {
    const d = distToSegment(p, { x: pts[i - 1][0], y: pts[i - 1][1] }, { x: pts[i][0], y: pts[i][1] });
    if (d <= tolerance + stroke.width / 2) return true;
  }
  return false;
}

export function snap(v: number, grid: number): number {
  return Math.round(v / grid) * grid;
}
