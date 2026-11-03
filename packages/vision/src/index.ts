// 그림(스크린샷·손그림 사진)에서 모형·글 자리·칠한 상자를 찾는다 -- 브라우저 안에서, AI·토큰 없이.
// 순서: 잉크(주변보다 어두운 점) 찾기 → 이어진 덩어리 → 덩어리마다 모형 틀 맞추기 → 남은 작은 덩어리는 글 줄로 묶기.
import { recognizePointCloud, type ShapeKind } from '@sketch/core';

export interface DetectedBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedShape extends DetectedBox {
  kind: ShapeKind;
  vertices?: [number, number][];
  /** 잉크 색 (#rrggbb) */
  color: string;
}

export interface DetectedFill extends DetectedBox {
  color: string;
}

export interface Detection {
  width: number;
  height: number;
  shapes: DetectedShape[];
  /** 글이 있을 것 같은 줄 */
  textLines: DetectedBox[];
  /** 꽉 칠한 상자 (어두운 버튼 등) */
  fills: DetectedFill[];
}

export interface DetectOptions {
  /** 주변 평균보다 이만큼 어두우면 잉크 (0~255) */
  contrast?: number;
  /** 이보다 작은 모형은 찾지 않는다 (px) */
  minShape?: number;
}

interface Comp {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  count: number;
  r: number;
  g: number;
  b: number;
  pts: [number, number][];
}

const hex = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');

/** RGBA 픽셀(캔버스 getImageData 결과)을 분석한다 */
export function detectShapes(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number, opts: DetectOptions = {}): Detection {
  const contrast = opts.contrast ?? 40;
  const minShape = opts.minShape ?? 24;
  const n = width * height;
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    // 투명한 곳은 흰 바탕으로 본다
    gray[i] = (0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2]) * a + 255 * (1 - a);
  }
  // 주변 평균 (적분 영상) -- 그림자·조명이 고르지 않은 사진도 견디게
  const W = width + 1;
  const integral = new Float64Array(W * (height + 1));
  for (let y = 0; y < height; y++) {
    let row = 0;
    for (let x = 0; x < width; x++) {
      row += gray[y * width + x];
      integral[(y + 1) * W + x + 1] = integral[y * W + x + 1] + row;
    }
  }
  const R = Math.max(8, Math.round(Math.min(width, height) / 40));
  const ink = new Uint8Array(n);
  for (let y = 0; y < height; y++) {
    const ya = Math.max(0, y - R);
    const yb = Math.min(height, y + R + 1);
    for (let x = 0; x < width; x++) {
      const xa = Math.max(0, x - R);
      const xb = Math.min(width, x + R + 1);
      const sum = integral[yb * W + xb] - integral[ya * W + xb] - integral[yb * W + xa] + integral[ya * W + xa];
      const mean = sum / ((yb - ya) * (xb - xa));
      const v = gray[y * width + x];
      // 주변보다 어둡거나, 바탕이 밝은데 꽤 어두우면 잉크
      if (v < mean - contrast || (v < 110 && mean > 150)) ink[y * width + x] = 1;
    }
  }
  // 넓게 칠한 상자는 안쪽이 주변 평균과 같아져 비어 보인다 -- 아주 어둡거나, 바탕색과 색이 크게 다르면 잉크로 본다.
  // 바탕색 = 그림 전체에 고르게 뽑은 픽셀의 중앙값 (그림 대부분은 바탕이다)
  const edge: number[][] = [];
  const stepS = Math.max(1, Math.floor(Math.sqrt(n / 4000)));
  for (let y = 0; y < height; y += stepS) for (let x = 0; x < width; x += stepS) edge.push([x, y]);
  const med = (k: number) => {
    const v = edge.map(([x, y]) => rgba[(y * width + x) * 4 + k]).sort((a, b) => a - b);
    return v[v.length >> 1];
  };
  const bg = [med(0), med(1), med(2)];
  for (let i = 0; i < n; i++) {
    if (gray[i] < 90) ink[i] = 1;
    else if (rgba[i * 4 + 3] > 128) {
      const d = Math.abs(rgba[i * 4] - bg[0]) + Math.abs(rgba[i * 4 + 1] - bg[1]) + Math.abs(rgba[i * 4 + 2] - bg[2]);
      if (d > 150) ink[i] = 1;
    }
  }

  // 이어진 덩어리 (8방향)
  const label = new Int32Array(n).fill(-1);
  const comps: Comp[] = [];
  const stack = new Int32Array(n);
  // 같은 그림이면 같은 결과가 나오게 고정 씨앗 난수
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < n; i++) {
    if (!ink[i] || label[i] >= 0) continue;
    const id = comps.length;
    const c: Comp = { x0: width, y0: height, x1: 0, y1: 0, count: 0, r: 0, g: 0, b: 0, pts: [] };
    let sp = 0;
    stack[sp++] = i;
    label[i] = id;
    while (sp) {
      const p = stack[--sp];
      const x = p % width;
      const y = (p - x) / width;
      c.count++;
      if (x < c.x0) c.x0 = x;
      if (x > c.x1) c.x1 = x;
      if (y < c.y0) c.y0 = y;
      if (y > c.y1) c.y1 = y;
      c.r += rgba[p * 4];
      c.g += rgba[p * 4 + 1];
      c.b += rgba[p * 4 + 2];
      // 점 표본 (최대 600개, 고르게)
      if (c.pts.length < 600) c.pts.push([x, y]);
      else {
        const k = Math.floor(rand() * c.count);
        if (k < 600) c.pts[k] = [x, y];
      }
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const q = yy * width + xx;
          if (ink[q] && label[q] < 0) {
            label[q] = id;
            stack[sp++] = q;
          }
        }
      }
    }
    comps.push(c);
  }

  const shapes: DetectedShape[] = [];
  const fills: DetectedFill[] = [];
  const small: Comp[] = [];
  for (const c of comps) {
    const w = c.x1 - c.x0 + 1;
    const h = c.y1 - c.y0 + 1;
    if (Math.max(w, h) < 4 || c.count < 4) continue; // 먼지
    // 그림 전체를 덮는 덩어리(테두리 프레임이 아닌 어두운 바탕)는 건너뛴다
    if (w > width * 0.98 && h > height * 0.98 && c.count > n * 0.5) continue;
    const color = `#${hex(c.r / c.count)}${hex(c.g / c.count)}${hex(c.b / c.count)}`;
    const fillRatio = c.count / (w * h);
    if (fillRatio > 0.6 && Math.min(w, h) >= 12 && w * h >= 600) {
      fills.push({ x: c.x0, y: c.y0, width: w, height: h, color });
      continue;
    }
    if (Math.max(w, h) >= minShape) {
      const s = recognizePointCloud(c.pts, minShape);
      if (s) {
        const shape: DetectedShape = { kind: s.kind, x: s.x, y: s.y, width: s.width, height: s.height, color };
        if (s.vertices) shape.vertices = s.vertices;
        shapes.push(shape);
        continue;
      }
    }
    // 글자 크기 덩어리 → 글 줄 후보
    if (h <= Math.max(48, height * 0.06) && w <= width * 0.6) small.push(c);
  }

  return { width, height, shapes, fills, textLines: groupLines(small) };
}

/** 가로로 가까운 작은 덩어리를 한 줄로 묶는다 */
function groupLines(cs: Comp[]): DetectedBox[] {
  const boxes = cs.map((c) => ({ x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1 })).sort((a, b) => a.x0 - b.x0);
  const lines: { x0: number; y0: number; x1: number; y1: number; parts: number }[] = [];
  for (const b of boxes) {
    const h = b.y1 - b.y0 + 1;
    const line = lines.find((l) => {
      const lh = l.y1 - l.y0 + 1;
      const overlap = Math.min(l.y1, b.y1) - Math.max(l.y0, b.y0);
      return overlap > Math.min(h, lh) * 0.4 && b.x0 - l.x1 < Math.max(h, lh) * 1.6 && b.x0 >= l.x0 - 2;
    });
    if (line) {
      line.x1 = Math.max(line.x1, b.x1);
      line.y0 = Math.min(line.y0, b.y0);
      line.y1 = Math.max(line.y1, b.y1);
      line.parts++;
    } else lines.push({ ...b, parts: 1 });
  }
  return lines
    .filter((l) => l.x1 - l.x0 + 1 >= 10 && l.y1 - l.y0 + 1 >= 6)
    .map((l) => ({ x: l.x0, y: l.y0, width: l.x1 - l.x0 + 1, height: l.y1 - l.y0 + 1 }));
}
