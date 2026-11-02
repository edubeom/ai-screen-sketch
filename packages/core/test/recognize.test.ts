import { describe, expect, it } from 'vitest';
import { addElements, createElement, createProject, deleteElements, enclosedRegion, groupElements, hitAt, recognizeShape, type Stroke, type StrokePoint } from '@sketch/core';

// 손떨림 흉내: 고정 씨앗 난수
function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff - 0.5;
  };
}

function trace(vertices: [number, number][], perEdge = 20, jitter = 2, seed = 1, close = true): StrokePoint[] {
  const r = rng(seed);
  const pts: StrokePoint[] = [];
  const vs = close ? [...vertices, vertices[0]] : vertices;
  for (let i = 1; i < vs.length; i++) {
    for (let k = 0; k < perEdge; k++) {
      const t = k / perEdge;
      pts.push([vs[i - 1][0] + t * (vs[i][0] - vs[i - 1][0]) + r() * jitter, vs[i - 1][1] + t * (vs[i][1] - vs[i - 1][1]) + r() * jitter]);
    }
  }
  pts.push([vs[vs.length - 1][0], vs[vs.length - 1][1]]);
  return pts;
}

function ellipse(cx: number, cy: number, rx: number, ry: number, jitter = 2, sweep = 1.0): StrokePoint[] {
  const r = rng(7);
  const pts: StrokePoint[] = [];
  for (let i = 0; i <= 80 * sweep; i++) {
    const a = (i / 80) * Math.PI * 2;
    pts.push([cx + rx * Math.cos(a) + r() * jitter, cy + ry * Math.sin(a) + r() * jitter]);
  }
  return pts;
}

function starOutline(cx: number, cy: number, R: number): [number, number][] {
  const v: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? R : R * 0.4;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    v.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]);
  }
  return v;
}

function pentagram(cx: number, cy: number, R: number): [number, number][] {
  const v: [number, number][] = [];
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
    v.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  return v;
}

describe('모형 인식', () => {
  it('네모', () => {
    const s = recognizeShape(trace([[100, 100], [300, 100], [300, 220], [100, 220]]));
    expect(s?.kind).toBe('rect');
    expect(Math.abs(s!.x - 100)).toBeLessThan(5);
    expect(Math.abs(s!.width - 200)).toBeLessThan(8);
  });
  it('가로로 긴 막대 네모 (화면 설계의 띠)', () => {
    expect(recognizeShape(trace([[118, 212], [690, 212], [690, 326], [118, 326]]))?.kind).toBe('rect');
    expect(recognizeShape(trace([[100, 100], [700, 100], [700, 150], [100, 150]], 30))?.kind).toBe('rect');
  });
  it('원·타원 (끝이 조금 겹치거나 덜 닫혀도)', () => {
    expect(recognizeShape(ellipse(200, 200, 80, 80))?.kind).toBe('ellipse');
    expect(recognizeShape(ellipse(200, 200, 120, 60, 3, 1.05))?.kind).toBe('ellipse');
    expect(recognizeShape(ellipse(200, 200, 90, 90, 2, 0.93))?.kind).toBe('ellipse');
  });
  it('별 -- 바깥선과 한붓 오각별 둘 다', () => {
    expect(recognizeShape(trace(starOutline(200, 200, 100), 10))?.kind).toBe('star');
    expect(recognizeShape(trace(pentagram(200, 200, 100), 25))?.kind).toBe('star');
  });
  it('세모·마름모', () => {
    expect(recognizeShape(trace([[200, 100], [300, 260], [100, 260]]))?.kind).toBe('triangle');
    expect(recognizeShape(trace([[200, 100], [300, 200], [200, 300], [100, 200]]))?.kind).toBe('diamond');
  });
  it('글씨·열린 선·작은 고리는 바꾸지 않는다', () => {
    expect(recognizeShape(trace([[100, 100], [140, 160], [180, 100], [220, 160], [260, 100]], 15, 2, 3, false))).toBeUndefined();
    expect(recognizeShape(ellipse(200, 200, 80, 80, 2, 0.6))).toBeUndefined();
    expect(recognizeShape(ellipse(200, 200, 12, 12))).toBeUndefined();
    expect(recognizeShape(trace([[100, 100], [300, 102]], 30, 2, 4, false))).toBeUndefined();
    // 따로 떨어진 네모·원·별을 한꺼번에 보면 아무것도 아니다 (2026-11-02 브라우저 시험에서 넓은 별로 잘못 봄)
    const rectS = trace([[100, 100], [300, 100], [300, 220], [100, 220]], 8, 0, 9);
    expect(recognizeShape([rectS, ellipse(500, 200, 80, 80), trace(starOutline(850, 220, 100), 5, 0, 9)])).toBeUndefined();
    // ㄷ 만 (왼쪽 변 없음) 은 네모가 아니다
    expect(recognizeShape([trace([[100, 100], [260, 100], [260, 220], [100, 220]], 20, 2, 5, false)])).toBeUndefined();
  });
});

// 사용자 그림(2026-11-02)에서 본 그리기 방식
describe('여러 획·삐져나온 꼬리', () => {
  const open = (vs: [number, number][], seed: number) => trace(vs, 20, 3, seed, false);
  it('네모를 ㄷ + | 두 획으로 (세로선이 위아래로 삐져나옴)', () => {
    const s = recognizeShape([open([[110, 100], [260, 100], [262, 220], [110, 222]], 11), open([[105, 85], [106, 235]], 12)]);
    expect(s?.kind).toBe('rect');
    expect(Math.abs(s!.y - 100)).toBeLessThan(12);
    expect(Math.abs(s!.height - 120)).toBeLessThan(20);
  });
  it('네모를 ㄱ + ㄴ, 네 변 따로, 아랫변이 길게 삐져나옴', () => {
    expect(recognizeShape([open([[100, 100], [250, 98], [252, 230]], 13), open([[100, 100], [101, 230], [250, 231]], 14)])?.kind).toBe('rect');
    expect(
      recognizeShape([open([[100, 100], [250, 100]], 1), open([[250, 95], [250, 230]], 2), open([[255, 230], [100, 230]], 3), open([[100, 235], [100, 100]], 4)])?.kind,
    ).toBe('rect');
    expect(recognizeShape([open([[100, 100], [100, 230]], 5), open([[100, 100], [240, 100], [240, 220]], 6), open([[110, 228], [290, 222]], 7)])?.kind).toBe('rect');
  });
  it('직각 세모를 두 획으로 -- 꼭짓점이 그린 대로', () => {
    const s = recognizeShape([open([[200, 100], [120, 220], [260, 218]], 21), open([[195, 95], [262, 222]], 22)]);
    expect(s?.kind).toBe('triangle');
    expect(s!.vertices).toHaveLength(3);
  });
  it('한붓 오각별의 마지막 획이 시작점을 지나 삐져나와도 별', () => {
    const v = (i: number): [number, number] => {
      const a = -Math.PI / 2 + (i * 4 * Math.PI) / 5;
      return [200 + 100 * Math.cos(a), 200 + 100 * Math.sin(a)];
    };
    const pts = trace([v(0), v(1), v(2), v(3), v(4), v(0)], 25, 3, 31, false);
    const [x0, y0] = v(0);
    const [x1, y1] = v(1);
    pts.push([x0 + (x1 - x0) * 0.2, y0 + (y1 - y0) * 0.2]); // 다시 한 번 그어 넘침
    expect(recognizeShape(pts)?.kind).toBe('star');
  });
  it('끝에 갈고리가 달린 타원', () => {
    const pts = ellipse(200, 200, 110, 60, 3, 1.0);
    pts.unshift([300, 140], [305, 150]);
    expect(recognizeShape(pts)?.kind).toBe('ellipse');
  });
});

describe('막힌 곳 채우기', () => {
  const loop = (pts: [number, number][]): Stroke => ({ id: 's' + pts.length, color: '#000', width: 3, points: pts });
  it('손으로 그린 닫힌 네모 안은 막힌 곳 -- 테두리와 넓이', () => {
    const r = enclosedRegion([loop([[100, 100], [300, 100], [300, 200], [100, 200], [100, 100]])], 1440, 900, { x: 200, y: 150 });
    expect(r).toBeTruthy();
    expect(r!.area).toBeGreaterThan(150 * 70);
    const xs = r!.points.map((p) => p[0]);
    expect(Math.min(...xs)).toBeLessThan(110);
    expect(Math.max(...xs)).toBeGreaterThan(290);
  });
  it('조금 떨어진 틈(8px)은 막힌 것으로, 크게 열린 곳은 아니다', () => {
    const gap = [loop([[100, 100], [300, 100], [300, 200], [100, 200], [100, 108]])];
    expect(enclosedRegion(gap, 1440, 900, { x: 200, y: 150 })).toBeTruthy();
    const open = [loop([[100, 100], [300, 100], [300, 200], [100, 200], [100, 160]])];
    expect(enclosedRegion(open, 1440, 900, { x: 200, y: 150 })).toBeUndefined();
    expect(enclosedRegion(gap, 1440, 900, { x: 600, y: 600 })).toBeUndefined();
  });
  it('여러 획으로 둘러싼 곳도 막힌 곳', () => {
    const s = [loop([[100, 100], [300, 100], [300, 200]]), { ...loop([[300, 200], [100, 200], [100, 100]]), id: 'b' }];
    expect(enclosedRegion(s, 1440, 900, { x: 200, y: 150 })).toBeTruthy();
  });
});

describe('지우개·채우기가 쓰는 hitAt', () => {
  it('필기가 요소보다 먼저, 요소는 위에 있는 것부터, 묶음 자체는 고르지 않는다', () => {
    const p = createProject('t');
    const a = createElement('region', 0, 0, { id: 'a', width: 200, height: 200 });
    const b = createElement('text', 50, 50, { id: 'b', width: 100, height: 30 });
    let s = addElements(p.screens[0], [a, b]);
    expect((hitAt(s, { x: 60, y: 60 }, 2) as { element: { id: string } }).element.id).toBe('b');
    expect((hitAt(s, { x: 10, y: 10 }, 2) as { element: { id: string } }).element.id).toBe('a');
    s = { ...s, strokes: [{ id: 'k', color: '#000', width: 3, points: [[55, 55], [70, 70]] }] };
    expect('stroke' in hitAt(s, { x: 60, y: 60 }, 2)!).toBe(true);
    expect(hitAt(s, { x: 500, y: 500 }, 2)).toBeUndefined();
  });
  it('지우개(ink): 채우지 않은 모형은 테두리 근처에서만 맞고, skip 은 건너뛴다', () => {
    const p = createProject('t');
    const outer = createElement('shape', 0, 0, { id: 'outer', width: 700, height: 500, props: { shapeKind: 'rect' } });
    const mid = createElement('shape', 100, 200, { id: 'mid', width: 570, height: 115, props: { shapeKind: 'rect' } });
    const oval = createElement('shape', 160, 260, { id: 'oval', width: 110, height: 40, props: { shapeKind: 'ellipse' } });
    const s = addElements(p.screens[0], [outer, mid, oval]);
    const id = (h: ReturnType<typeof hitAt>) => (h && 'element' in h ? h.element.id : undefined);
    expect(id(hitAt(s, { x: 215, y: 260 }, 2, { ink: true }))).toBe('oval'); // 원 테두리
    expect(id(hitAt(s, { x: 215, y: 280 }, 2, { ink: true }))).toBeUndefined(); // 원 안쪽 빈 곳
    expect(id(hitAt(s, { x: 400, y: 250 }, 2, { ink: true }))).toBeUndefined(); // 가운데 네모 안쪽 빈 곳
    expect(id(hitAt(s, { x: 400, y: 201 }, 2, { ink: true }))).toBe('mid'); // 가운데 네모 테두리
    expect(id(hitAt(s, { x: 400, y: 201 }, 2, { ink: true, skip: new Set(['mid']) }))).toBeUndefined();
    // 채우기(ink 아님)는 안쪽 어디든
    expect(id(hitAt(s, { x: 400, y: 250 }, 2))).toBe('mid');
    // 칠한 모형은 안쪽도 잉크
    const filled = { ...s, elements: s.elements.map((e) => (e.id === 'mid' ? { ...e, props: { ...e.props, fill: '#ff0000' } } : e)) };
    expect(id(hitAt(filled, { x: 400, y: 250 }, 2, { ink: true }))).toBe('mid');
  });
  it('묶음의 마지막 자식을 지우면 묶음도 사라진다', () => {
    const p = createProject('t');
    let s = addElements(p.screens[0], [createElement('text', 0, 0, { id: 'x' }), createElement('text', 0, 50, { id: 'y' })]);
    s = groupElements(s, ['x', 'y']).screen;
    s = deleteElements(s, ['x']);
    expect(s.elements.some((e) => e.type === 'group')).toBe(true);
    s = deleteElements(s, ['y']);
    expect(s.elements).toHaveLength(0);
  });
});
