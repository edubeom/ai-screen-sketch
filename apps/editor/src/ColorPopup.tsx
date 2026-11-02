// 색 고르기 팝업: 맨 위 최근 4색, 기본 16색, 마지막에 색 판(채도·명도 네모 + 색상 막대 + 코드).
import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { pickColor, setState, useEditor } from './store.ts';

export const BASIC_COLORS = [
  '#000000', '#475569', '#94a3b8', '#ffffff',
  '#ef4444', '#f97316', '#facc15', '#84cc16',
  '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
  '#6366f1', '#a855f7', '#ec4899', '#92400e',
];

function hexToHsv(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.length === 4 ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}` : hex);
  if (!m) return [0, 0, 0];
  const n = parseInt(m[1], 16);
  const r = (n >> 16) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, max ? d / max : 0, max];
}

function hsvToHex(h: number, s: number, v: number): string {
  const f = (k: number) => {
    const kk = (k + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(kk, 4 - kk, 1));
  };
  return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

export function ColorPopup() {
  const at = useEditor((s) => s.colorPopup);
  const current = useEditor((s) => s.pen.color);
  const recent = useEditor((s) => s.recentColors);
  const ref = useRef<HTMLDivElement>(null);
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(current));
  const [hex, setHex] = useState(current);

  useEffect(() => {
    if (!at) return;
    const [h, s, v] = hexToHsv(current);
    setHsv([h, s, v]);
    setHex(current);
    // 팝업이 열려 있는 동안 바깥을 누르거나 Esc 면 닫는다
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setState({ colorPopup: undefined });
    };
    const t = setTimeout(() => window.addEventListener('pointerdown', close, true));
    window.addEventListener('keydown', close);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close);
    };
  }, [at]); // 열릴 때만 지금 색으로 맞춘다

  if (!at) return null;
  const choose = (c: string) => {
    pickColor(c);
    setState({ colorPopup: undefined });
  };
  const fromPanel = (h: number, s: number, v: number) => {
    setHsv([h, s, v]);
    setHex(hsvToHex(h, s, v));
  };
  const dragIn = (e: RPointerEvent<HTMLDivElement>, fn: (fx: number, fy: number) => void) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const apply = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      fn(Math.max(0, Math.min(1, (cx - r.left) / r.width)), Math.max(0, Math.min(1, (cy - r.top) / r.height)));
    };
    apply(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => apply(ev.clientX, ev.clientY);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
  const W = 248;
  const H = 360;
  const left = Math.max(8, Math.min(at.x + 12, window.innerWidth - W - 8));
  const top = Math.max(8, Math.min(at.y + 12, window.innerHeight - H - 8));
  const [h, s, v] = hsv;
  const validHex = /^#[0-9a-f]{6}$/i.test(hex);
  return (
    <div className="color-popup" ref={ref} style={{ left, top, width: W }} data-testid="color-popup" role="dialog" aria-label="색 고르기">
      <div className="cp-label">최근 색</div>
      <div className="cp-row">
        {[0, 1, 2, 3].map((i) =>
          recent[i] ? (
            <button key={i} className="swatch" style={{ background: recent[i] }} title={recent[i]} aria-label={`최근 색 ${recent[i]}`} onClick={() => choose(recent[i])} />
          ) : (
            <span key={i} className="swatch empty" />
          ),
        )}
      </div>
      <div className="cp-label">기본 색</div>
      <div className="cp-grid">
        {BASIC_COLORS.map((c) => (
          <button key={c} className={c.toLowerCase() === current.toLowerCase() ? 'swatch on' : 'swatch'} style={{ background: c }} title={c} aria-label={`색 ${c}`} onClick={() => choose(c)} />
        ))}
      </div>
      <div className="cp-label">색 판</div>
      <div
        className="cp-sv"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${h} 100% 50%))` }}
        onPointerDown={(e) => dragIn(e, (fx, fy) => fromPanel(h, fx, 1 - fy))}
      >
        <span className="cp-knob" style={{ left: `${s * 100}%`, top: `${(1 - v) * 100}%` }} />
      </div>
      <div className="cp-hue" onPointerDown={(e) => dragIn(e, (fx) => fromPanel(fx * 360, s, v))}>
        <span className="cp-knob" style={{ left: `${(h / 360) * 100}%`, top: '50%' }} />
      </div>
      <div className="cp-row">
        <span className="swatch" style={{ background: validHex ? hex : current }} />
        <input className="cp-hex" value={hex} aria-label="색 코드" onChange={(e) => {
          setHex(e.target.value);
          if (/^#[0-9a-f]{6}$/i.test(e.target.value)) setHsv(hexToHsv(e.target.value));
        }} />
        <button className="btn small primary" disabled={!validHex} onClick={() => choose(hex.toLowerCase())}>적용</button>
      </div>
    </div>
  );
}
