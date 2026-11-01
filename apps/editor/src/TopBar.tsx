// 상단: 프로젝트와 작업 명령 -- 저장 상태, 실행 취소/다시 실행, 도구, 확대·축소, 내보내기.
import { redo, setState, undo, useEditor, type Tool } from './store.ts';
import { fitScreen, setTool, zoomTo } from './actions.ts';
import { saveNow } from './persistence.ts';

const TOOLS: { key: Tool; label: string; hint: string }[] = [
  { key: 'select', label: '선택', hint: '선택·이동·크기 (V)' },
  { key: 'pen', label: '펜', hint: '자유 필기 (P)' },
  { key: 'eraser', label: '지우개', hint: '필기 지우기 (E)' },
  { key: 'connect', label: '동작 연결', hint: '시작 요소에서 대상 요소로 끌기 (L)' },
];

const STATUS_TEXT = { idle: '저장 전', saving: '저장 중…', saved: '저장됨', failed: '저장 실패' } as const;

function timeOf(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function TopBar({ onProjects, onExport, onImport }: { onProjects: () => void; onExport: () => void; onImport: () => void }) {
  const title = useEditor((s) => s.project.title);
  const status = useEditor((s) => s.saveStatus);
  const dirty = useEditor((s) => s.dirty);
  const error = useEditor((s) => s.saveError);
  const revision = useEditor((s) => s.savedRevision);
  const lastSavedAt = useEditor((s) => s.lastSavedAt);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const tool = useEditor((s) => s.tool);
  const zoom = useEditor((s) => s.zoom);
  const grid = useEditor((s) => s.grid);
  const showLinks = useEditor((s) => s.showLinks);
  const pen = useEditor((s) => s.pen);

  const shownStatus = status === 'saved' && dirty ? 'idle' : status;

  return (
    <header className="topbar">
      <div className="brand" title="AI 화면 설명 스케치 도구">스케치</div>
      <button className="btn ghost" onClick={onProjects} title="프로젝트 목록·새로 만들기">프로젝트 ▾</button>
      <input
        className="title-input"
        aria-label="프로젝트 이름"
        value={title}
        onChange={(e) => setState((s) => ({ project: { ...s.project, title: e.target.value }, dirty: true }))}
      />
      <span
        className={`save-badge ${shownStatus}`}
        data-testid="save-status"
        title={error ?? (lastSavedAt ? `마지막 저장 ${timeOf(lastSavedAt)} · revision ${revision}` : '')}
      >
        {shownStatus === 'idle' && dirty ? '변경됨' : STATUS_TEXT[shownStatus]}
        {shownStatus === 'saved' && <small> r{revision} · {timeOf(lastSavedAt)}</small>}
      </span>
      {status === 'failed' && (
        <button className="btn small" onClick={() => void saveNow()} title={error}>다시 저장</button>
      )}
      <div className="sep" />
      <button className="btn icon" onClick={undo} disabled={!canUndo} title="실행 취소 (Ctrl/Cmd+Z)" aria-label="실행 취소">↶</button>
      <button className="btn icon" onClick={redo} disabled={!canRedo} title="다시 실행 (Ctrl/Cmd+Shift+Z)" aria-label="다시 실행">↷</button>
      <div className="sep" />
      <div className="seg" role="radiogroup" aria-label="도구">
        {TOOLS.map((t) => (
          <button key={t.key} role="radio" aria-checked={tool === t.key} className={tool === t.key ? 'on' : ''} onClick={() => setTool(t.key)} title={t.hint}>
            {t.label}
          </button>
        ))}
      </div>
      {tool === 'pen' && (
        <div className="pen-opts">
          <input type="color" aria-label="펜 색" value={pen.color} onChange={(e) => setState({ pen: { ...pen, color: e.target.value } })} />
          <select aria-label="펜 굵기" value={pen.width} onChange={(e) => setState({ pen: { ...pen, width: Number(e.target.value) } })}>
            {[1, 2, 3, 5, 8].map((w) => (
              <option key={w} value={w}>{w}px</option>
            ))}
          </select>
        </div>
      )}
      <div className="sep" />
      <button className="btn icon" onClick={() => zoomTo(zoom / 1.25)} title="축소 (Ctrl/Cmd+-)" aria-label="축소">−</button>
      <button className="btn zoom" onClick={() => zoomTo(1)} title="100%" data-testid="zoom">{Math.round(zoom * 100)}%</button>
      <button className="btn icon" onClick={() => zoomTo(zoom * 1.25)} title="확대 (Ctrl/Cmd+=)" aria-label="확대">+</button>
      <button className="btn small" onClick={fitScreen} title="화면 맞춤 (Shift+1)">맞춤</button>
      <label className="check" title="격자 맞춤 (8px)">
        <input type="checkbox" checked={grid} onChange={(e) => setState({ grid: e.target.checked })} /> 격자
      </label>
      <label className="check" title="동작 연결선 보기">
        <input type="checkbox" checked={showLinks} onChange={(e) => setState({ showLinks: e.target.checked })} /> 동작선
      </label>
      <div className="grow" />
      <button className="btn" onClick={onImport}>가져오기</button>
      <button className="btn primary" onClick={onExport}>내보내기</button>
    </header>
  );
}
