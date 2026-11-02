// 요소·필기를 SVG 로 그린다. 모양은 exporters 의 describeElement 와 같아서 PNG 와 화면이 같다.
import { memo } from 'react';
import { connectorEnds, type SketchElement, type Stroke } from '@sketch/core';
import { describeElement, strokePath, type Shape } from '@sketch/exporters';

function ShapeView({ s }: { s: Shape }) {
  switch (s.kind) {
    case 'rect':
      return <rect x={s.x} y={s.y} width={s.width} height={s.height} rx={s.rx} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} strokeDasharray={s.dash} />;
    case 'line':
      return (
        <line
          x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2}
          stroke={s.stroke} strokeWidth={s.strokeWidth} strokeDasharray={s.dash}
          markerEnd={s.arrow ? `url(#arrow-${s.stroke.replace('#', '')})` : undefined}
        />
      );
    case 'text': {
      const lh = s.lineHeight ?? Math.round(s.fontSize * 1.35);
      return (
        <text x={s.x} y={s.y} fontSize={s.fontSize} fill={s.fill} textAnchor={s.anchor === 'middle' ? 'middle' : undefined} fontWeight={s.weight}>
          {s.lines.map((l, i) => (
            <tspan key={i} x={s.x} dy={i ? lh : 0}>
              {l}
            </tspan>
          ))}
        </text>
      );
    }
    case 'ellipse':
      return <ellipse cx={s.cx} cy={s.cy} rx={s.rx} ry={s.ry} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} />;
    case 'polygon':
      return <polygon points={s.points.map((p) => p.join(',')).join(' ')} fill={s.fill} stroke={s.stroke} strokeWidth={s.strokeWidth} strokeLinejoin="round" />;
    case 'image':
      return <image x={s.x} y={s.y} width={s.width} height={s.height} href={s.href} preserveAspectRatio="xMidYMid meet" />;
  }
}

export const ElementView = memo(function ElementView({ el, href, dim }: { el: SketchElement; href?: string; dim?: boolean }) {
  const shapes = describeElement(el, href);
  let hit;
  if (el.type === 'connector') {
    const { a, b } = connectorEnds(el);
    hit = <line className="hit" x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={14} />;
  } else if (el.type !== 'group') {
    hit = <rect className="hit" x={el.x} y={el.y} width={el.width} height={el.height} />;
  }
  return (
    <g data-id={el.id} data-type={el.type} className={dim ? 'el dim' : 'el'}>
      {shapes.map((s, i) => (
        <ShapeView key={i} s={s} />
      ))}
      {hit}
    </g>
  );
});

export const StrokeView = memo(function StrokeView({ stroke }: { stroke: Stroke }) {
  const { d, width } = strokePath(stroke);
  return <path d={d} fill="none" stroke={stroke.color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" data-stroke={stroke.id} />;
});
