// 화면 하나를 SVG 문자열로 그린다 (PNG 내보내기용). 글자는 모두 이스케이프해 글자로만 다룬다.
import { sortedElements, type Screen } from '@sketch/core';
import { describeElement, FONT_FAMILY, strokePath, type Shape } from './shapes.ts';

export function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const n = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(2));

export function shapeToSvg(s: Shape): string {
  switch (s.kind) {
    case 'rect':
      return `<rect x="${n(s.x)}" y="${n(s.y)}" width="${n(s.width)}" height="${n(s.height)}"${s.rx ? ` rx="${s.rx}"` : ''} fill="${escapeXml(s.fill)}"${s.stroke ? ` stroke="${escapeXml(s.stroke)}" stroke-width="${s.strokeWidth ?? 1}"` : ''}${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}/>`;
    case 'line':
      return `<line x1="${n(s.x1)}" y1="${n(s.y1)}" x2="${n(s.x2)}" y2="${n(s.y2)}" stroke="${escapeXml(s.stroke)}" stroke-width="${s.strokeWidth}"${s.dash ? ` stroke-dasharray="${s.dash}"` : ''}${s.arrow ? ` marker-end="url(#arrow-${s.stroke.replace('#', '')})"` : ''}/>`;
    case 'text': {
      const lh = s.lineHeight ?? Math.round(s.fontSize * 1.35);
      const tspans = s.lines.map((l, i) => `<tspan x="${n(s.x)}" dy="${i ? lh : 0}">${escapeXml(l)}</tspan>`).join('');
      return `<text x="${n(s.x)}" y="${n(s.y)}" font-size="${s.fontSize}" fill="${escapeXml(s.fill)}"${s.anchor === 'middle' ? ' text-anchor="middle"' : ''}${s.weight ? ` font-weight="${s.weight}"` : ''}>${tspans}</text>`;
    }
    case 'image':
      return `<image x="${n(s.x)}" y="${n(s.y)}" width="${n(s.width)}" height="${n(s.height)}" href="${escapeXml(s.href)}" preserveAspectRatio="xMidYMid meet"/>`;
  }
}

export interface RenderOptions {
  /** 필기를 그림에 넣을지 */
  includeStrokes: boolean;
  /** 메모(note) 요소를 그림에 넣을지 -- 요구사항 메모는 JSON·요청문에 늘 남는다 */
  includeNotes: boolean;
  /** 자산 id → 그림 주소(data: URL) */
  assetHrefs?: Record<string, string>;
}

export function arrowMarkers(colors: string[]): string {
  return colors
    .map((c) => `<marker id="arrow-${c.replace('#', '')}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`)
    .join('');
}

export function renderScreenSvg(screen: Screen, opts: RenderOptions): string {
  const parts: string[] = [];
  for (const el of sortedElements(screen)) {
    if (el.type === 'note' && !opts.includeNotes) continue;
    const href = el.props.assetId ? opts.assetHrefs?.[el.props.assetId] : undefined;
    for (const s of describeElement(el, href)) parts.push(shapeToSvg(s));
  }
  if (opts.includeStrokes) {
    for (const st of screen.strokes) {
      const { d, width } = strokePath(st);
      parts.push(`<path d="${d}" fill="none" stroke="${escapeXml(st.color)}" stroke-width="${n(width)}" stroke-linecap="round" stroke-linejoin="round"/>`);
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${screen.width}" height="${screen.height}" viewBox="0 0 ${screen.width} ${screen.height}" font-family="${escapeXml(FONT_FAMILY)}">`,
    `<defs>${arrowMarkers(['#2563eb', '#16a34a', '#475569'])}</defs>`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    ...parts,
    '</svg>',
  ].join('');
}
