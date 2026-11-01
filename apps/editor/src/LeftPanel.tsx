// 왼쪽: 화면 목록과 요소 팔레트.
import { useRef, useState } from 'react';
import { ELEMENT_LABELS, PRESETS, SCREEN_PRESETS, type ElementType } from '@sketch/core';
import { useEditor } from './store.ts';
import {
  addElementAt,
  addImageFile,
  addPresetAt,
  addScreen,
  deleteScreen,
  duplicateCurrentScreen,
  moveScreen,
  selectScreen,
} from './actions.ts';

const PALETTE: ElementType[] = ['region', 'text', 'button', 'input', 'list', 'card', 'image', 'note', 'connector'];
const ICONS: Record<string, string> = { region: '▭', text: 'T', button: '◉', input: '⌨', list: '☰', card: '▤', image: '▨', note: '✎', connector: '↗' };

export function LeftPanel() {
  const screens = useEditor((s) => s.project.screens);
  const screenId = useEditor((s) => s.screenId);
  const [preset, setPreset] = useState<string>('desktop');
  const fileRef = useRef<HTMLInputElement>(null);

  const add = () => {
    const p = SCREEN_PRESETS.find((x) => x.key === preset) ?? SCREEN_PRESETS[0];
    addScreen(`화면 ${screens.length + 1}`, p.width, p.height);
  };

  return (
    <aside className="left">
      <section>
        <h3>화면</h3>
        <ol className="screen-list" data-testid="screen-list">
          {screens.map((s, i) => (
            <li key={s.id} className={s.id === screenId ? 'on' : ''}>
              <button className="screen-name" onClick={() => selectScreen(s.id)} title={`${s.width}×${s.height}`}>
                <span className="num">{i + 1}</span> {s.name}
                <small>{s.width}×{s.height}</small>
              </button>
              {s.id === screenId && (
                <span className="screen-ops">
                  <button onClick={() => moveScreen(s.id, -1)} disabled={i === 0} title="위로" aria-label="화면 위로">↑</button>
                  <button onClick={() => moveScreen(s.id, 1)} disabled={i === screens.length - 1} title="아래로" aria-label="화면 아래로">↓</button>
                  <button onClick={() => duplicateCurrentScreen()} title="복제 (상태 화면 만들기)" aria-label="화면 복제">⧉</button>
                  <button
                    onClick={() => {
                      if (confirm(`"${s.name}" 화면을 지울까요? (실행 취소로 되돌릴 수 있습니다)`)) deleteScreen(s.id);
                    }}
                    disabled={screens.length <= 1}
                    title="지우기"
                    aria-label="화면 지우기"
                  >
                    ✕
                  </button>
                </span>
              )}
            </li>
          ))}
        </ol>
        <div className="row">
          <select value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="새 화면 크기">
            {SCREEN_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label} {p.width}×{p.height}
              </option>
            ))}
          </select>
          <button className="btn small" onClick={add} data-testid="add-screen">+ 화면</button>
        </div>
      </section>
      <section>
        <h3>요소</h3>
        <div className="palette">
          {PALETTE.map((t) => (
            <button
              key={t}
              draggable
              data-testid={`palette-${t}`}
              onDragStart={(e) => {
                if (t === 'image') return e.preventDefault();
                e.dataTransfer.setData('application/x-sketch', t);
              }}
              onClick={() => (t === 'image' ? fileRef.current?.click() : addElementAt(t))}
              title={t === 'image' ? '이미지 파일 올리기 (PNG·JPEG·WebP·GIF)' : '눌러서 추가하거나 작업판으로 끌어 놓기'}
            >
              <span className="ico">{ICONS[t]}</span>
              {ELEMENT_LABELS[t]}
            </button>
          ))}
        </div>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept="image/png,image/jpeg,image/webp,image/gif"
          data-testid="image-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void addImageFile(f);
            e.target.value = '';
          }}
        />
        <h3>묶음 프리셋</h3>
        <div className="palette">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              draggable
              data-testid={`preset-${p.key}`}
              onDragStart={(e) => e.dataTransfer.setData('application/x-sketch', `preset:${p.key}`)}
              onClick={() => addPresetAt(p.key)}
              title="일반 요소의 묶음 -- 더블클릭으로 안쪽을 고치고, 묶음 풀기로 나눌 수 있습니다"
            >
              <span className="ico">▦</span>
              {p.label}
            </button>
          ))}
        </div>
      </section>
      <section className="help">
        <h3>단축키</h3>
        <ul>
          <li><kbd>V</kbd> 선택 · <kbd>P</kbd> 펜 · <kbd>E</kbd> 지우개 · <kbd>L</kbd> 동작 연결</li>
          <li><kbd>Del</kbd> 지우기 · 방향키 1px · <kbd>Shift</kbd>+방향키 10px</li>
          <li><kbd>Ctrl/⌘</kbd>+<kbd>Z</kbd> 실행 취소 · +<kbd>Shift</kbd> 다시 실행</li>
          <li><kbd>Ctrl/⌘</kbd>+<kbd>C</kbd>/<kbd>V</kbd>/<kbd>D</kbd> 복사·붙여넣기·복제</li>
          <li><kbd>Ctrl/⌘</kbd>+<kbd>G</kbd> 묶기 · +<kbd>Shift</kbd> 풀기</li>
          <li>스페이스+끌기 화면 이동 · <kbd>Ctrl/⌘</kbd>+휠 확대</li>
          <li>더블클릭: 글 고치기 · 묶음 안으로</li>
        </ul>
      </section>
    </aside>
  );
}
