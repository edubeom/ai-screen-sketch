// 프로젝트 목록·내보내기·가져오기 대화상자.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { checkSpec, SCREEN_PRESETS, type Project } from '@sketch/core';
import type { ImportResult } from '@sketch/exporters';
import type { ProjectSummary } from '@sketch/storage';
import { getState, toast, useEditor } from './store.ts';
import { adoptProject, newProject, openProject, store } from './persistence.ts';
import { ADAPTERS, applyImport, exportJson, exportZip, readImportFile } from './exportFlow.ts';
import { aiStatus, aiToken, analyzeLocally, analyzeWithAi, applyImageImport, setAiToken, type AiStatus, type ImageMode, type ImageTarget, type LocalAnalysis } from './imageImport.ts';
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

const IMAGE_FILE = /^image\/(png|jpeg|webp|gif)$/;

export function ImportDialog({ onClose }: { onClose: () => void }) {
  const [res, setRes] = useState<ImportResult>();
  const [image, setImage] = useState<File>();
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
      <p className="muted">이 도구가 내보낸 ZIP·project.json, 또는 <b>화면 그림(PNG·JPEG·WebP·GIF)</b> 을 고르세요. 스크린샷·손그림 사진도 됩니다.</p>
      <input
        ref={fileRef}
        type="file"
        accept=".zip,.json,application/zip,application/json,image/png,image/jpeg,image/webp,image/gif"
        data-testid="import-file"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setRes(undefined);
          setImage(undefined);
          if (IMAGE_FILE.test(f.type)) return setImage(f);
          setBusy(true);
          setRes(await readImportFile(f));
          setBusy(false);
        }}
      />
      {busy && <p>읽는 중…</p>}
      {image && <ImageImportPanel file={image} onDone={onClose} />}
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
      {!image && (
        <footer className="row end">
          <button className="btn" disabled={!res?.ok || busy || !sameAsOpen} title={sameAsOpen ? '' : '열려 있는 프로젝트와 같은 id 일 때만 덮어쓸 수 있습니다'} onClick={() => go('overwrite')}>
            열린 프로젝트 덮어쓰기
          </button>
          <button className="btn primary" disabled={!res?.ok || busy} onClick={() => go('new')} data-testid="import-new">
            새 프로젝트로 가져오기
          </button>
        </footer>
      )}
    </Modal>
  );
}

function ImageImportPanel({ file, onDone }: { file: File; onDone: () => void }) {
  const [mode, setMode] = useState<ImageMode>('shapes');
  const [target, setTarget] = useState<ImageTarget>('new');
  const [background, setBackground] = useState(true);
  const [hint, setHint] = useState('');
  const [token, setToken] = useState(aiToken());
  const [status, setStatus] = useState<AiStatus>();
  const [local, setLocal] = useState<LocalAnalysis>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  // 미리보기 주소는 효과 안에서 만들고 지운다 (두 번 붙였다 떼는 개발 모드에서도 깨지지 않게)
  const [preview, setPreview] = useState('');
  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    void aiStatus().then(setStatus);
  }, []);
  // 모양 찾기는 공짜라 고르면 바로 미리 해 둔다
  useEffect(() => {
    if (mode === 'image' || local) return;
    setBusy('모양을 찾는 중… (브라우저에서, 토큰 없음)');
    analyzeLocally(file)
      .then(setLocal)
      .catch((e) => setError(`그림을 분석하지 못했습니다: ${(e as Error).message}`))
      .finally(() => setBusy(''));
  }, [mode, file, local]);

  const d = local?.detection;
  const summary = d
    ? [`모형 ${d.shapes.length}`, d.fills.length ? `칠한 상자 ${d.fills.length}` : '', `글 자리 ${d.textLines.length}`].filter(Boolean).join(' · ') + ` (${local!.ms}ms)`
    : '';
  const aiReady = !!status?.available && !!token;

  const run = async () => {
    setError('');
    try {
      let ai;
      if (mode === 'ai') {
        if (!local) return;
        setAiToken(token);
        setBusy('AI 가 종류와 글을 붙이는 중… (보통 10~20초)');
        ai = await analyzeWithAi(file, local, hint);
      }
      setBusy('화면에 넣는 중…');
      const r = await applyImageImport({ file, mode, target, background, local, ai });
      if (!r) return;
      const usage = ai?.usage ? ` · 토큰 입력 ${ai.usage.input.toLocaleString()}(캐시 ${ai.usage.cachedInput.toLocaleString()}) 출력 ${ai.usage.output.toLocaleString()}` : ai?.cached ? ' · 전에 분석한 그림이라 토큰 0' : '';
      toast(`그림을 가져왔습니다${r.count ? ` -- 요소 ${r.count}개` : ''}${usage}`);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="image-import" data-testid="image-import">
      {preview && <img className="image-preview" src={preview} alt="가져올 그림" data-testid="image-preview" />}
      <div className="row">
        <span className="muted">넣을 곳</span>
        <label className="check"><input type="radio" checked={target === 'new'} onChange={() => setTarget('new')} /> 새 화면</label>
        <label className="check"><input type="radio" checked={target === 'current'} onChange={() => setTarget('current')} /> 지금 화면</label>
      </div>
      <div className="radio-list">
        <label>
          <input type="radio" name="image-mode" checked={mode === 'image'} onChange={() => setMode('image')} data-testid="image-mode-image" />
          <b>그림만 넣기</b>
          <small>토큰 0 · 그림을 깔고 그 위에 직접 그립니다</small>
        </label>
        <label>
          <input type="radio" name="image-mode" checked={mode === 'shapes'} onChange={() => setMode('shapes')} data-testid="image-mode-shapes" />
          <b>모양 찾기</b>
          <small>토큰 0 · 브라우저가 네모·원·별·세모·칠한 상자·글 자리를 찾아 고칠 수 있는 요소로 만듭니다 (글 내용은 못 읽음)</small>
        </label>
        <label className={status && !status.available ? 'disabled' : ''}>
          <input type="radio" name="image-mode" checked={mode === 'ai'} disabled={!status?.available} onChange={() => setMode('ai')} data-testid="image-mode-ai" />
          <b>AI 분석 {status?.provider ? `(${status.provider})` : ''}</b>
          <small>
            {status?.available
              ? '모양 찾기 결과에 AI 가 요소 종류·글을 붙입니다 · 이 서버에 로그인한 계정의 사용량을 씁니다 (한 번에 약 1.3만 토큰, 같은 그림은 다시 0)'
              : status?.reason ?? 'AI 상태 확인 중…'}
          </small>
        </label>
      </div>
      {mode === 'ai' && status?.available && (
        <div className="ai-opts">
          <label className="field">
            <span>AI 토큰 (서버 컴퓨터에서 npm run ai-token -- 이 브라우저에 기억)</span>
            <input value={token} onChange={(e) => setToken(e.target.value)} placeholder="토큰" data-testid="ai-token" />
          </label>
          <label className="field">
            <span>AI 에게 한마디 (선택)</span>
            <input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="예: 할 일 앱의 메인 화면, 오른쪽은 상세 패널" />
          </label>
        </div>
      )}
      {mode !== 'image' && (
        <label className="check"><input type="checkbox" checked={background} onChange={(e) => setBackground(e.target.checked)} /> 원본 그림을 뒤에 깔기 (잠금, 나중에 지워도 됨)</label>
      )}
      {summary && mode !== 'image' && <p className="muted" data-testid="image-summary">찾음: {summary}</p>}
      {busy && <p data-testid="image-busy">{busy}</p>}
      {error && <div className="callout error">{error}</div>}
      <footer className="row end">
        <button className="btn primary" disabled={!!busy || (mode !== 'image' && !local) || (mode === 'ai' && !aiReady)} onClick={run} data-testid="image-import-go">
          {mode === 'ai' ? 'AI 분석하고 가져오기' : '가져오기'}
        </button>
      </footer>
    </div>
  );
}
