// 좌표 계산 도우미 (화면 좌표 기준)
import type { Screen, SketchElement, Stroke } from './types.ts';
import { sortedElements, type Rect } from './ops.ts';
import { shapeOutline } from './recognize.ts';

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

/** 채우지 않은 모형인가 -- 안쪽이 비어 보여서, 지우개는 테두리를 건드릴 때만 지운다 */
function hollowShape(el: SketchElement): boolean {
  return el.type === 'shape' && (!el.props.fill || el.props.fill === 'none' || el.props.fill === 'transparent');
}

/** 모형 테두리까지 거리 (화면 px) */
export function shapeOutlineDistance(el: SketchElement, p: Point): number {
  const { x, y, width: w, height: h } = el;
  const kind = el.props.shapeKind ?? 'rect';
  if (kind === 'rect') {
    const inside = p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h;
    if (inside) return Math.min(p.x - x, x + w - p.x, p.y - y, y + h - p.y);
    const dx = Math.max(x - p.x, 0, p.x - (x + w));
    const dy = Math.max(y - p.y, 0, p.y - (y + h));
    return Math.hypot(dx, dy);
  }
  if (kind === 'ellipse') {
    const rx = w / 2;
    const ry = h / 2;
    if (!rx || !ry) return Infinity;
    const r = Math.hypot((p.x - x - rx) / rx, (p.y - y - ry) / ry);
    return Math.abs(r - 1) * Math.min(rx, ry);
  }
  const outline = shapeOutline(kind, el.props.vertices) ?? [];
  const pts = outline.map(([u, v]) => ({ x: x + u * w, y: y + v * h }));
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) m = Math.min(m, distToSegment(p, pts[i], pts[(i + 1) % pts.length]));
  return m;
}

/**
 * 점 아래에 보이는 것 중 가장 위의 것 -- 필기가 요소보다 위에 그려진다. 묶음 자체는 고르지 않는다.
 * ink: 지우개처럼 "보이는 잉크"만 -- 채우지 않은 모형은 테두리 근처에서만 맞는다.
 * skip: 이 요소들은 건너뛴다.
 */
export function hitAt(
  screen: Screen,
  p: Point,
  tolerance: number,
  opts: { ink?: boolean; skip?: Set<string> } = {},
): { stroke: Stroke } | { element: SketchElement } | undefined {
  for (let i = screen.strokes.length - 1; i >= 0; i--) {
    if (strokeHit(screen.strokes[i], p, tolerance)) return { stroke: screen.strokes[i] };
  }
  const els = sortedElements(screen);
  for (let i = els.length - 1; i >= 0; i--) {
    const el = els[i];
    if (el.type === 'group' || opts.skip?.has(el.id)) continue;
    if (el.type === 'connector') {
      const { a, b } = connectorEnds(el);
      if (distToSegment(p, a, b) <= tolerance + 4) return { element: el };
      continue;
    }
    if (opts.ink && hollowShape(el)) {
      if (shapeOutlineDistance(el, p) <= tolerance + 4) return { element: el };
      continue;
    }
    if (p.x >= el.x - tolerance && p.x <= el.x + el.width + tolerance && p.y >= el.y - tolerance && p.y <= el.y + el.height + tolerance) return { element: el };
  }
  return undefined;
}

/** 점을 품은 요소들 (묶음 제외) */
export function elementsContaining(screen: Screen, p: Point): string[] {
  return screen.elements.filter((e) => e.type !== 'group' && p.x >= e.x && p.x <= e.x + e.width && p.y >= e.y && p.y <= e.y + e.height).map((e) => e.id);
}

/** 요소 가운데 부분(가로·세로 가운데 60%)인지 -- 모형 안에 글 쓰기 */
export function inCenter(el: Rect, p: Point): boolean {
  return Math.abs(p.x - (el.x + el.width / 2)) <= el.width * 0.3 && Math.abs(p.y - (el.y + el.height / 2)) <= el.height * 0.3;
}
