// 요소의 겉모습을 기본 도형 목록으로 설명한다.
// 편집기(React)와 PNG 출력(SVG 문자열)이 같은 설명을 써서 화면과 내보낸 그림이 같게 보인다.
import { connectorEnds, shapeOutline, type SketchElement, type Stroke } from '@sketch/core';

export type Shape =
  | { kind: 'rect'; x: number; y: number; width: number; height: number; rx?: number; fill: string; stroke?: string; strokeWidth?: number; dash?: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; strokeWidth: number; dash?: string; arrow?: boolean }
  | { kind: 'text'; x: number; y: number; lines: string[]; fontSize: number; fill: string; anchor?: 'start' | 'middle'; weight?: number; lineHeight?: number }
  | { kind: 'image'; x: number; y: number; width: number; height: number; href: string }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; fill: string; stroke: string; strokeWidth: number }
  | { kind: 'polygon'; points: [number, number][]; fill: string; stroke: string; strokeWidth: number };

export const FONT_FAMILY = "'Pretendard', 'Apple SD Gothic Neo', 'Malgun Gothic', 'Noto Sans KR', 'Noto Sans CJK KR', sans-serif";

/** 글자 폭 어림값 (한글·전각은 넓게) */
function charWidth(ch: string, fontSize: number): number {
  const c = ch.codePointAt(0) ?? 0;
  if (c >= 0x1100 && (c <= 0x115f || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) || (c >= 0xff00 && c <= 0xff60))) return fontSize * 0.95;
  if (ch === ' ') return fontSize * 0.3;
  return fontSize * 0.56;
}

/** 폭에 맞춰 줄을 나눈다. 높이를 넘는 줄은 … 으로 줄인다 */
export function wrapText(text: string, maxWidth: number, fontSize: number, maxLines = Infinity): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    let w = 0;
    for (const ch of para) {
      const cw = charWidth(ch, fontSize);
      if (w + cw > maxWidth && line) {
        out.push(line);
        line = '';
        w = 0;
        if (ch === ' ') continue;
      }
      line += ch;
      w += cw;
    }
    out.push(line);
  }
  if (out.length > maxLines) {
    const cut = out.slice(0, Math.max(1, maxLines));
    cut[cut.length - 1] = cut[cut.length - 1].replace(/.$/u, '') + '…';
    return cut;
  }
  return out;
}

const C = {
  ink: '#1e293b',
  muted: '#64748b',
  line: '#94a3b8',
  frame: '#475569',
  paper: '#ffffff',
  region: '#f1f5f9',
  button: '#e2e8f0',
  note: '#fef3c7',
  noteLine: '#d97706',
  nav: '#2563eb',
  data: '#16a34a',
};

export const CONNECTOR_COLORS = { navigation: C.nav, dataflow: C.data, plain: C.frame } as const;

export function describeElement(el: SketchElement, assetHref?: string): Shape[] {
  const { x, y, width: w, height: h } = el;
  const pad = 10;
  const label = el.text ?? '';
  const fill = el.props.fill;
  switch (el.type) {
    case 'group':
      return [];
    case 'shape': {
      const kind = el.props.shapeKind ?? 'rect';
      const stroke = el.props.stroke ?? C.ink;
      const sf = fill ?? 'none';
      const shapes: Shape[] = [];
      if (kind === 'rect') shapes.push({ kind: 'rect', x, y, width: w, height: h, rx: 3, fill: sf, stroke, strokeWidth: 2 });
      else if (kind === 'ellipse') shapes.push({ kind: 'ellipse', cx: x + w / 2, cy: y + h / 2, rx: w / 2, ry: h / 2, fill: sf, stroke, strokeWidth: 2 });
      else shapes.push({ kind: 'polygon', points: (shapeOutline(kind) ?? []).map(([u, v]) => [x + u * w, y + v * h]), fill: sf, stroke, strokeWidth: 2 });
      if (label) {
        // 모형 안쪽 가운데에 글 (별·세모는 안쪽이 좁다)
        const inner = kind === 'rect' ? 0.86 : kind === 'ellipse' || kind === 'diamond' ? 0.68 : 0.46;
        const fs = Math.max(11, Math.min(20, Math.round(Math.min(w, h) * 0.16)));
        const lh = Math.round(fs * 1.3);
        const lines = wrapText(label, w * inner, fs, Math.max(1, Math.floor((h * inner) / lh)));
        const cyText = y + h * (kind === 'triangle' ? 0.66 : kind === 'star' ? 0.56 : 0.5);
        shapes.push({ kind: 'text', x: x + w / 2, y: cyText - ((lines.length - 1) * lh) / 2 + fs * 0.35, lines, fontSize: fs, fill: C.ink, anchor: 'middle', lineHeight: lh });
      }
      return shapes;
    }
    case 'region': {
      const shapes: Shape[] = [{ kind: 'rect', x, y, width: w, height: h, rx: 4, fill: fill ?? C.region, stroke: C.line, strokeWidth: 1.5, dash: '6 4' }];
      const t = label || el.name;
      if (t) shapes.push({ kind: 'text', x: x + pad, y: y + pad + 13, lines: wrapText(t, w - pad * 2, 13, Math.max(1, Math.floor((h - pad) / 18))), fontSize: 13, fill: C.muted });
      return shapes;
    }
    case 'text': {
      const fs = Math.max(10, Math.min(48, Math.round(h * 0.55)));
      return [{ kind: 'text', x, y: y + fs, lines: wrapText(label, w, fs, Math.max(1, Math.floor(h / (fs * 1.3)))), fontSize: fs, fill: fill ?? C.ink, weight: 600 }];
    }
    case 'button':
      return [
        { kind: 'rect', x, y, width: w, height: h, rx: 6, fill: fill ?? C.button, stroke: C.frame, strokeWidth: 1.5 },
        { kind: 'text', x: x + w / 2, y: y + h / 2 + 5, lines: wrapText(label, w - 8, 14, 1), fontSize: 14, fill: C.ink, anchor: 'middle', weight: 600 },
      ];
    case 'input': {
      const ph = label || el.props.placeholder || '';
      return [
        { kind: 'rect', x, y, width: w, height: h, rx: 4, fill: fill ?? C.paper, stroke: C.frame, strokeWidth: 1.5 },
        { kind: 'text', x: x + pad, y: y + h / 2 + 5, lines: wrapText(ph, w - pad * 2, 14, 1), fontSize: 14, fill: label ? C.ink : C.line },
      ];
    }
    case 'list': {
      const shapes: Shape[] = [{ kind: 'rect', x, y, width: w, height: h, rx: 6, fill: fill ?? C.paper, stroke: C.frame, strokeWidth: 1.5 }];
      if (label) shapes.push({ kind: 'text', x: x + pad, y: y + pad + 13, lines: wrapText(label, w - pad * 2, 13, 1), fontSize: 13, fill: C.muted });
      return shapes;
    }
    case 'card':
      return [
        { kind: 'rect', x, y, width: w, height: h, rx: 8, fill: fill ?? C.paper, stroke: C.line, strokeWidth: 1.5 },
        { kind: 'text', x: x + pad + 2, y: y + pad + 14, lines: wrapText(label, w - pad * 2, 14, Math.max(1, Math.floor((h - pad) / 20))), fontSize: 14, fill: C.ink, lineHeight: 20 },
      ];
    case 'image':
      if (assetHref) return [{ kind: 'image', x, y, width: w, height: h, href: assetHref }, { kind: 'rect', x, y, width: w, height: h, fill: 'none', stroke: C.line, strokeWidth: 1 }];
      return [
        { kind: 'rect', x, y, width: w, height: h, fill: C.region, stroke: C.line, strokeWidth: 1.5 },
        { kind: 'line', x1: x, y1: y, x2: x + w, y2: y + h, stroke: C.line, strokeWidth: 1 },
        { kind: 'line', x1: x + w, y1: y, x2: x, y2: y + h, stroke: C.line, strokeWidth: 1 },
        { kind: 'text', x: x + w / 2, y: y + h / 2 + 5, lines: ['이미지'], fontSize: 13, fill: C.muted, anchor: 'middle' },
      ];
    case 'note':
      return [
        { kind: 'rect', x, y, width: w, height: h, rx: 2, fill: fill ?? C.note, stroke: C.noteLine, strokeWidth: 1 },
        { kind: 'text', x: x + pad, y: y + pad + 13, lines: wrapText(label, w - pad * 2, 13, Math.max(1, Math.floor((h - pad) / 18))), fontSize: 13, fill: '#78350f', lineHeight: 18 },
      ];
    case 'connector': {
      const { a, b } = connectorEnds(el);
      const kind = el.props.connectorKind ?? 'plain';
      const shapes: Shape[] = [{ kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: el.props.stroke ?? CONNECTOR_COLORS[kind], strokeWidth: 2, dash: kind === 'dataflow' ? '7 5' : undefined, arrow: kind !== 'plain' }];
      if (label) shapes.push({ kind: 'text', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 6, lines: [label], fontSize: 12, fill: CONNECTOR_COLORS[kind], anchor: 'middle' });
      return shapes;
    }
  }
}

/** 필기 선 하나를 SVG path 로. 필압이 있으면 평균 필압으로 굵기를 정한다 */
export function strokePath(stroke: Stroke): { d: string; width: number } {
  const pts = stroke.points;
  if (!pts.length) return { d: '', width: stroke.width };
  let d = `M${pts[0][0]} ${pts[0][1]}`;
  if (pts.length === 1) d += ` L${pts[0][0] + 0.01} ${pts[0][1]}`;
  for (let i = 1; i < pts.length; i++) {
    // 중점 2차 곡선으로 부드럽게
    if (i < pts.length - 1) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      d += ` Q${pts[i][0]} ${pts[i][1]} ${mx} ${my}`;
    } else d += ` L${pts[i][0]} ${pts[i][1]}`;
  }
  const ps = pts.map((p) => p[2]).filter((p): p is number => typeof p === 'number');
  const avg = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0.5;
  return { d, width: Math.max(0.5, stroke.width * (ps.length ? 0.5 + avg : 1)) };
}
