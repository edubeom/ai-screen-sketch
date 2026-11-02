import { describe, expect, it } from 'vitest';
import { addElements, createElement, createProject, deleteElements, groupElements, hitAt, recognizeShape, type StrokePoint } from '@sketch/core';

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
  it('글씨·열린 선·작은 고리·낙서는 바꾸지 않는다', () => {
    expect(recognizeShape(trace([[100, 100], [140, 160], [180, 100], [220, 160], [260, 100]], 15, 2, 3, false))).toBeUndefined();
    expect(recognizeShape(ellipse(200, 200, 80, 80, 2, 0.6))).toBeUndefined();
    expect(recognizeShape(ellipse(200, 200, 12, 12))).toBeUndefined();
    expect(recognizeShape(trace([[100, 100], [300, 102]], 30, 2, 4, false))).toBeUndefined();
    const scribble = [...ellipse(200, 200, 80, 80), ...ellipse(200, 200, 70, 75), ...ellipse(200, 200, 85, 60)];
    expect(recognizeShape(scribble)).toBeUndefined();
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
