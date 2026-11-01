// 프로젝트 목록·내보내기·가져오기 대화상자.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { checkSpec, SCREEN_PRESETS, type Project } from '@sketch/core';
import type { ImportResult } from '@sketch/exporters';
import type { ProjectSummary } from '@sketch/storage';
import { getState, toast, useEditor } from './store.ts';
import { adoptProject, newProject, openProject, store } from './persistence.ts';
import { ADAPTERS, applyImport, exportJson, exportZip, readImportFile } from './exportFlow.ts';
import ahndaExample from '../../../examples/ahnda-planner/project.json';

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className="btn icon" onClick={onClose} aria-label="닫기">✕</button>
        </header>
        {children}
      </div>
    </div>
  );
}

export function ProjectsDialog({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<ProjectSummary[]>([]);
  const [title, setTitle] = useState('새 프로젝트');
  const [preset, setPreset] = useState('desktop');
  const currentId = useEditor((s) => s.project.id);
  const reload = () => store.listProjects().then(setList).catch((e) => toast(`목록을 읽지 못했습니다: ${e.message}`, 'error'));
  useEffect(() => void reload(), []);
  return (
    <Modal title="프로젝트" onClose={onClose}>
      <section>
        <h3>새로 만들기</h3>
        <div className="row">
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="새 프로젝트 이름" data-testid="new-project-title" />
          <select value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="첫 화면 크기">
            {SCREEN_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>{p.label} {p.width}×{p.height}</option>
            ))}
          </select>
          <button
            className="btn primary"
            data-testid="create-project"
            onClick={async () => {
              const p = SCREEN_PRESETS.find((x) => x.key === preset)!;
              await newProject(title.trim() || '새 프로젝트', p.width, p.height, p.key === 'desktop' ? '데스크톱' : p.label);
              onClose();
            }}
          >
            만들기
          </button>
        </div>
        <button
          className="btn"
          data-testid="open-example"
          onClick={async () => {
            const ex = structuredClone(ahndaExample) as unknown as Project;
            if (await store.hasProject(ex.id)) {
              if (!confirm('예시 프로젝트가 이미 있습니다. 처음 상태로 되돌려 열까요? (아니오: 있던 것을 엽니다)')) {
                await openProject(ex.id);
                return onClose();
              }
            }
            await adoptProject(ex, []);
            onClose();
          }}
        >
          예시 열기: AHNDA 할 일 및 일정
        </button>
      </section>
      <section>
        <h3>이 브라우저에 저장된 프로젝트</h3>
        <p className="muted">브라우저 저장은 기기 간 공유·영구 백업을 보장하지 않습니다. 중요한 설계는 내보내기로 파일을 보관하세요.</p>
        <ul className="project-list">
          {list.map((p) => (
            <li key={p.id} className={p.id === currentId ? 'on' : ''}>
              <button className="grow-btn" onClick={async () => { await openProject(p.id); onClose(); }}>
                <b>{p.title}</b>
                <small>화면 {p.screenCount} · r{p.revision} · {new Date(p.updatedAt).toLocaleString('ko-KR')}</small>
              </button>
              <button
                className="btn small danger"
                disabled={p.id === currentId}
                title={p.id === currentId ? '열려 있는 프로젝트는 지울 수 없습니다' : '지우기'}
                onClick={async () => {
                  if (!confirm(`"${p.title}" 을(를) 이 브라우저에서 지울까요? 되돌릴 수 없습니다.`)) return;
                  await store.deleteProject(p.id);
                  void reload();
                }}
              >
                지우기
              </button>
            </li>
          ))}
        </ul>
      </section>
    </Modal>
  );
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const issues = useMemo(() => checkSpec(project), [project]);
  const errors = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');
  const [profile, setProfile] = useState<string>('standalone');
  const [includeStrokes, setIncludeStrokes] = useState(true);
  const [includeNotes, setIncludeNotes] = useState(true);
  const [hostTaskId, setHostTaskId] = useState('');
  const [busy, setBusy] = useState(false);
  const adapter = ADAPTERS.find((a) => a.profile === profile)!;
  return (
    <Modal title="내보내기" onClose={onClose}>
      <p className="muted">
        저장된 revision 으로 ZIP 을 만듭니다: project.json · 화면별 PNG · assets · requirements.md(구현 요청문) · manifest.json · validation-report.json
      </p>
      <h3>전달 방식</h3>
      <div className="radio-list">
        {ADAPTERS.map((a) => (
          <label key={a.profile}>
            <input type="radio" name="profile" value={a.profile} checked={profile === a.profile} onChange={() => setProfile(a.profile)} data-testid={`profile-${a.profile}`} />
            <b>{a.label}</b>
            <small>
              {a.profile === 'standalone' && '중립 묶음 -- 프레임워크 없이 AI 에게 그대로 전달'}
              {a.profile === 'dev-light' && '+ exports/dev-light/task-card.md(작업 카드 초안)·traceability.json. design/sketch/<프로젝트 id>/ 에 풀어 두세요'}
              {a.profile === 'dev-framework' && '+ exports/dev-framework/task-draft.md -- 전달 초안 지원 (전문판 계약 미확인, 완전 호환 아님)'}
            </small>
          </label>
        ))}
      </div>
      {profile !== 'standalone' && (
        <label className="field">
          <span>개발 작업 id (선택, 없으면 null)</span>
          <input value={hostTaskId} onChange={(e) => setHostTaskId(e.target.value)} placeholder="예: 작업 카드 제목 또는 task id" />
        </label>
      )}
      <h3>그림(PNG)</h3>
      <label className="check"><input type="checkbox" checked={includeStrokes} onChange={(e) => setIncludeStrokes(e.target.checked)} /> 필기 포함</label>
      <label className="check"><input type="checkbox" checked={includeNotes} onChange={(e) => setIncludeNotes(e.target.checked)} /> 메모 요소 포함</label>
      <p className="muted">빼더라도 요구사항 메모는 JSON 과 요청문에 항상 남습니다.</p>
      {errors.length > 0 && (
        <div className="callout error" data-testid="export-blocked">
          <b>내보내기 차단 {errors.length}건</b> -- 필수 대상이 없는 동작을 고치세요:
          <ul>{errors.map((e, i) => <li key={i}>{e.message}</li>)}</ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="callout warning">
          <b>경고 {warnings.length}건</b> -- 비어 있는 칸은 "미정"으로 내보냅니다.
          <ul>{warnings.slice(0, 8).map((e, i) => <li key={i}>{e.message}</li>)}{warnings.length > 8 && <li>… 외 {warnings.length - 8}건</li>}</ul>
        </div>
      )}
      <footer className="row end">
        <button className="btn" disabled={busy} onClick={async () => {
          try { await exportJson(); toast('project.json 을 내보냈습니다'); } catch (e) { toast((e as Error).message, 'error'); }
        }}>JSON 만</button>
        <button
          className="btn primary"
          data-testid="export-zip"
          disabled={busy || errors.length > 0}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await exportZip(adapter, { includeStrokes, includeNotes }, { hostTaskId });
              toast(`${r.fileName} 을(를) 내보냈습니다 (파일 ${r.manifest.files.length + 1}개)`);
              onClose();
            } catch (e) {
              toast((e as Error).message, 'error');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '만드는 중…' : 'ZIP 내보내기'}
        </button>
      </footer>
    </Modal>
  );
}

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [res, setRes] = useState<ImportResult>();
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const currentId = getState().project.id;
  const sameAsOpen = res?.project?.id === currentId;
  const go = async (mode: 'new' | 'overwrite') => {
    if (!res) return;
    if (mode === 'overwrite' && !confirm('열려 있는 프로젝트를 가져온 내용으로 덮어씁니다. 계속할까요?')) return;
    setBusy(true);
    try {
      const p = await applyImport(res, mode);
      toast(`"${p.title}" 을(를) 가져왔습니다`);
      onClose();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="가져오기" onClose={onClose}>
      <p className="muted">이 도구가 내보낸 ZIP 또는 project.json 을 고르세요. 가져오기는 기본적으로 새 프로젝트로 만듭니다.</p>
      <input
        ref={fileRef}
        type="file"
        accept=".zip,.json,application/zip,application/json"
        data-testid="import-file"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          setRes(await readImportFile(f));
          setBusy(false);
        }}
      />
      {busy && <p>읽는 중…</p>}
      {res && !res.ok && (
        <div className="callout error" data-testid="import-errors">
          <b>가져올 수 없습니다</b>
          <ul>{res.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {res?.ok && res.project && (
        <div className="callout" data-testid="import-ok">
          <b>{res.project.title}</b> · 화면 {res.project.screens.length}개 · revision {res.project.revision} · 이미지 {res.assets.length}개
          {res.warnings.length > 0 && <ul>{res.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}</ul>}
        </div>
      )}
      <footer className="row end">
        <button className="btn" disabled={!res?.ok || busy || !sameAsOpen} title={sameAsOpen ? '' : '열려 있는 프로젝트와 같은 id 일 때만 덮어쓸 수 있습니다'} onClick={() => go('overwrite')}>
          열린 프로젝트 덮어쓰기
        </button>
        <button className="btn primary" disabled={!res?.ok || busy} onClick={() => go('new')} data-testid="import-new">
          새 프로젝트로 가져오기
        </button>
      </footer>
    </Modal>
  );
}
