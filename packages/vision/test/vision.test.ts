import { describe, expect, it } from 'vitest';
import { detectShapes } from '@sketch/vision';

/** 흰 바탕 RGBA 그림에 선을 그리는 작은 도우미 */
function canvas(w: number, h: number) {
  const px = new Uint8ClampedArray(w * h * 4).fill(255);
  const dot = (x: number, y: number, t = 2, c = [30, 41, 59]) => {
    for (let dy = -t; dy <= t; dy++)
      for (let dx = -t; dx <= t; dx++) {
        const X = Math.round(x + dx);
        const Y = Math.round(y + dy);
        if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
        const i = (Y * w + X) * 4;
        px[i] = c[0];
        px[i + 1] = c[1];
        px[i + 2] = c[2];
      }
  };
  const line = (x0: number, y0: number, x1: number, y1: number, t = 1) => {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let k = 0; k <= n; k++) dot(x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n, t);
  };
  const rect = (x: number, y: number, rw: number, rh: number) => {
    line(x, y, x + rw, y);
    line(x + rw, y, x + rw, y + rh);
    line(x + rw, y + rh, x, y + rh);
    line(x, y + rh, x, y);
  };
  const ellipse = (cx: number, cy: number, rx: number, ry: number) => {
    for (let a = 0; a < 720; a++) dot(cx + rx * Math.cos((a / 720) * Math.PI * 2), cy + ry * Math.sin((a / 720) * Math.PI * 2), 1);
  };
  const fill = (x: number, y: number, fw: number, fh: number, c: number[]) => {
    for (let yy = y; yy < y + fh; yy++) for (let xx = x; xx < x + fw; xx++) dot(xx, yy, 0, c);
  };
  return { px, line, rect, ellipse, fill, dot };
}

describe('그림에서 모양 찾기 (토큰 없이)', () => {
  it('사용자 그림처럼 겹친 네모·띠·원·글 자리', () => {
    const c = canvas(800, 520);
    c.rect(28, 22, 738, 476); // 바깥 큰 네모
    c.rect(100, 78, 590, 123); // 위 띠
    c.rect(118, 212, 572, 114); // 가운데 띠
    c.rect(98, 342, 560, 112); // 아래 띠
    c.rect(334, 120, 60, 46); // 작은 네모
    c.rect(455, 117, 59, 46);
    c.ellipse(234, 291, 56, 20); // 원
    // 글 같은 작은 덩어리 한 줄
    for (let i = 0; i < 6; i++) c.fill(140 + i * 14, 100, 9, 12, [30, 41, 59]);
    const d = detectShapes(c.px, 800, 520);
    const kinds = d.shapes.map((s) => s.kind).sort();
    expect(kinds.filter((k) => k === 'rect').length).toBe(6);
    expect(kinds).toContain('ellipse');
    const oval = d.shapes.find((s) => s.kind === 'ellipse')!;
    expect(Math.abs(oval.x - 178)).toBeLessThan(6);
    expect(Math.abs(oval.width - 112)).toBeLessThan(10);
    expect(d.textLines.length).toBe(1);
    expect(d.textLines[0].width).toBeGreaterThan(70);
  });

  it('어두운 칠한 버튼은 칠한 상자로', () => {
    const c = canvas(400, 200);
    c.fill(50, 60, 120, 40, [37, 99, 235]);
    const d = detectShapes(c.px, 400, 200);
    expect(d.fills).toHaveLength(1);
    expect(d.fills[0].color).toBe('#2563eb');
    expect(d.shapes).toHaveLength(0);
  });

  it('빈 그림과 그림 전체 테두리', () => {
    const empty = canvas(300, 200);
    expect(detectShapes(empty.px, 300, 200)).toMatchObject({ shapes: [], fills: [], textLines: [] });
    const framed = canvas(300, 200);
    framed.rect(1, 1, 297, 197);
    expect(detectShapes(framed.px, 300, 200).shapes.map((s) => s.kind)).toEqual(['rect']);
  });
});
