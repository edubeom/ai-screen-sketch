// 손으로 그린 선들이 막아 둔 자리 찾기 (채우기).
// 필기를 칸(cell)으로 찍고 누른 곳에서 퍼져 나가 본다 -- 화면 가장자리에 닿으면 막힌 곳이 아니다.
// 선 끝이 조금 떨어져 있어도 막힌 것으로 보도록 선을 조금 두껍게 찍는다.
import type { Stroke } from './types.ts';

export interface EnclosedRegion {
  /** 테두리 꼭짓점 (화면 좌표) */
  points: [number, number][];
  /** 넓이 (px²) */
  area: number;
}

const CELL = 3;

function simplify(pts: [number, number][], eps: number): [number, number][] {
  if (pts.length < 3) return pts;
  let idx = 0;
  let max = 0;
  const [ax, ay] = pts[0];
  const [bx, by] = pts[pts.length - 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((by - ay) * pts[i][0] - (bx - ax) * pts[i][1] + bx * ay - by * ax) / len;
    if (d > max) {
      max = d;
      idx = i;
    }
  }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}

/**
 * 점 p 를 필기가 둘러싸고 있으면 그 자리의 테두리를 돌려준다.
 * gapPx: 이 정도 벌어진 틈은 막힌 것으로 본다.
 */
export function enclosedRegion(strokes: Stroke[], width: number, height: number, p: { x: number; y: number }, gapPx = 10): EnclosedRegion | undefined {
  const gw = Math.ceil(width / CELL) + 2;
  const gh = Math.ceil(height / CELL) + 2;
  const at = (x: number, y: number) => y * gw + x;
  const toCell = (v: number) => Math.floor(v / CELL) + 1;
  const sx = toCell(p.x);
  const sy = toCell(p.y);
  if (sx < 1 || sy < 1 || sx >= gw - 1 || sy >= gh - 1) return undefined;

  // 1) 필기를 벽으로 찍는다
  const wall = new Uint8Array(gw * gh);
  for (const st of strokes) {
    const r = Math.max(st.width / 2 + gapPx / 2, 3) / CELL;
    const ri = Math.ceil(r);
    const stamp = (x: number, y: number) => {
      const cx = toCell(x);
      const cy = toCell(y);
      for (let dy = -ri; dy <= ri; dy++)
        for (let dx = -ri; dx <= ri; dx++) {
          if (dx * dx + dy * dy > r * r) continue;
          const X = cx + dx;
          const Y = cy + dy;
          if (X >= 1 && Y >= 1 && X < gw - 1 && Y < gh - 1) wall[at(X, Y)] = 1;
        }
    };
    const pts = st.points;
    if (pts.length === 1) stamp(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) {
      const [x0, y0] = pts[i - 1];
      const [x1, y1] = pts[i];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (CELL / 2)));
      for (let k = 0; k <= n; k++) stamp(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n);
    }
  }
  if (wall[at(sx, sy)]) return undefined;

  // 2) 누른 곳에서 퍼지기 -- 가장자리(바깥 한 칸)에 닿으면 열린 곳
  const fill = new Uint8Array(gw * gh);
  const queue = new Int32Array(gw * gh);
  let qh = 0;
  let qt = 0;
  queue[qt++] = at(sx, sy);
  fill[at(sx, sy)] = 1;
  let count = 0;
  const limit = gw * gh * 0.7;
  while (qh < qt) {
    const c = queue[qh++];
    count++;
    if (count > limit) return undefined;
    const x = c % gw;
    const y = (c - x) / gw;
    if (x <= 1 || y <= 1 || x >= gw - 2 || y >= gh - 2) return undefined;
    for (const n of [c - 1, c + 1, c - gw, c + gw]) {
      if (!fill[n] && !wall[n]) {
        fill[n] = 1;
        queue[qt++] = n;
      }
    }
  }

  // 3) 두껍게 찍은 만큼 벽 안쪽으로 넓혀 선 아래까지 칠한다 (틈 메운 두께의 절반쯤)
  const grow = Math.max(1, Math.round(gapPx / 2 / CELL));
  for (let g = 0; g < grow; g++) {
    const add: number[] = [];
    for (let i = 0; i < fill.length; i++) {
      if (fill[i] || !wall[i]) continue;
      if (fill[i - 1] || fill[i + 1] || fill[i - gw] || fill[i + gw]) add.push(i);
    }
    for (const i of add) fill[i] = 1;
  }

  // 4) 테두리 따라가기 (무어 이웃)
  let start = -1;
  for (let i = 0; i < fill.length; i++) if (fill[i]) {
    start = i;
    break;
  }
  const D = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
  const contour: [number, number][] = [];
  let cx = start % gw;
  let cy = (start - cx) / gw;
  let dir = 6; // 위쪽에서 들어왔다고 보고 시작
  const sx0 = cx;
  const sy0 = cy;
  for (let guard = 0; guard < gw * gh * 4; guard++) {
    contour.push([(cx - 1) * CELL + CELL / 2, (cy - 1) * CELL + CELL / 2]);
    let found = false;
    for (let k = 0; k < 8; k++) {
      const d = (dir + 6 + k) % 8; // 왼쪽 뒤부터 시계 방향으로
      const nx = cx + D[d][0];
      const ny = cy + D[d][1];
      if (fill[at(nx, ny)]) {
        cx = nx;
        cy = ny;
        dir = d;
        found = true;
        break;
      }
    }
    if (!found || (cx === sx0 && cy === sy0)) break;
  }
  if (contour.length < 3) return undefined;
  // 닫힌 선은 시작점에서 가장 먼 점으로 나눠 반씩 줄인다 (같은 점 두 개 사이로는 거리를 잴 수 없다)
  let far = 0;
  for (let i = 1; i < contour.length; i++) {
    if (Math.hypot(contour[i][0] - contour[0][0], contour[i][1] - contour[0][1]) > Math.hypot(contour[far][0] - contour[0][0], contour[far][1] - contour[0][1])) far = i;
  }
  const pts = [...simplify(contour.slice(0, far + 1), CELL * 1.6).slice(0, -1), ...simplify([...contour.slice(far), contour[0]], CELL * 1.6).slice(0, -1)];
  if (pts.length < 3) return undefined;
  return { points: pts.map(([x, y]) => [Math.round(x * 10) / 10, Math.round(y * 10) / 10]), area: count * CELL * CELL };
}
