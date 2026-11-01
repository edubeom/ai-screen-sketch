// 하단: 검증 결과 -- 미연결 동작, 누락 상태, 내보내기 경고. 누르면 그 요소로 간다.
import { useMemo, useState } from 'react';
import { checkSpec } from '@sketch/core';
import { setState, useEditor } from './store.ts';

const ICON = { error: '✖', warning: '⚠', info: 'ℹ' } as const;

export function IssuesPanel() {
  const project = useEditor((s) => s.project);
  const issues = useMemo(() => checkSpec(project), [project]);
  const [open, setOpen] = useState(true);
  const count = (l: string) => issues.filter((i) => i.level === l).length;
  return (
    <footer className={open ? 'issues open' : 'issues'} data-testid="issues">
      <button className="issues-head" onClick={() => setOpen(!open)}>
        <b>검증 결과</b>
        <span className="pill error">{ICON.error} 차단 {count('error')}</span>
        <span className="pill warning">{ICON.warning} 경고 {count('warning')}</span>
        <span className="pill info">{ICON.info} 안내 {count('info')}</span>
        <span className="grow" />
        <span>{open ? '접기 ▾' : '펼치기 ▴'}</span>
      </button>
      {open && (
        <ul>
          {issues.length === 0 && <li className="muted">문제가 없습니다.</li>}
          {issues.map((i, n) => (
            <li key={n} className={i.level}>
              <button
                onClick={() =>
                  setState({
                    screenId: i.screenId,
                    selection: i.elementId ? [i.elementId] : [],
                    enteredGroup: undefined,
                    focusInteraction: i.interactionId,
                  })
                }
              >
                {ICON[i.level]} [{project.screens.find((s) => s.id === i.screenId)?.name}] {i.message}
              </button>
            </li>
          ))}
        </ul>
      )}
    </footer>
  );
}
