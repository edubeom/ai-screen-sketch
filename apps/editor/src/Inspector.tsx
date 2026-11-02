// 오른쪽: 선택 요소 속성 -- 이름, 문구, 역할, 동작, 상태, 메모. 선택이 없으면 화면 속성.
import { useEffect, useRef, type ReactNode } from 'react';
import {
  ACTION_LABELS,
  ACTIONS,
  ELEMENT_LABELS,
  NOTE_LABELS,
  NOTE_KINDS_LIST,
  SCREEN_PRESETS,
  SHAPE_KINDS,
  SHAPE_LABELS,
  STATE_KINDS,
  STATE_LABELS,
  TRIGGER_LABELS,
  TRIGGERS,
  addInteraction,
  addNote,
  addState,
  deleteInteraction,
  deleteNote,
  deleteState,
  interactionTargetProblem,
  mapScreen,
  newId,
  resizeElement,
  sortedElements,
  updateElement,
  updateInteraction,
  updateNote,
  updateScreen as updateScreenOp,
  updateState,
  type Interaction,
  type Screen,
  type SketchElement,
  type StateKind,
} from '@sketch/core';
import { commit, currentScreen, getState, setState, updateScreen, useEditor } from './store.ts';
import { addImageFile, align, deleteSelection, duplicateCurrentScreen, groupSelection, reorder, toggleLock, ungroupSelection } from './actions.ts';

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field" title={hint}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function Text({ value, onChange, placeholder, multiline, testId }: { value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; testId?: string }) {
  return multiline ? (
    <textarea value={value} placeholder={placeholder} rows={2} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
  ) : (
    <input value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} data-testid={testId} />
  );
}

function Num({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  return (
    <label className="num-field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
    </label>
  );
}

export function Inspector() {
  const screen = useEditor((s) => currentScreen(s));
  const selection = useEditor((s) => s.selection);
  const els = selection.map((id) => screen.elements.find((e) => e.id === id)).filter((e): e is SketchElement => !!e);
  return (
    <aside className="right" data-testid="inspector">
      {els.length === 0 && <ScreenProps screen={screen} />}
      {els.length === 1 && <ElementProps el={els[0]} screen={screen} />}
      {els.length > 1 && <MultiProps els={els} />}
    </aside>
  );
}

// ---------------------------------------------------------------------------

function ScreenProps({ screen }: { screen: Screen }) {
  const presetKey = SCREEN_PRESETS.find((p) => p.width === screen.width && p.height === screen.height)?.key ?? 'custom';
  const set = (patch: Partial<Pick<Screen, 'name' | 'width' | 'height'>>, key: string) =>
    commit(updateScreenOp(getState().project, screen.id, patch), { coalesce: `screen:${screen.id}:${key}` });
  return (
    <div className="panel">
      <h2>화면</h2>
      <Field label="화면 이름">
        <Text value={screen.name} onChange={(v) => set({ name: v }, 'name')} testId="screen-name" />
      </Field>
      <Field label="크기">
        <select
          value={presetKey}
          onChange={(e) => {
            const p = SCREEN_PRESETS.find((x) => x.key === e.target.value);
            if (p) set({ width: p.width, height: p.height }, 'size');
          }}
        >
          {SCREEN_PRESETS.map((p) => (
            <option key={p.key} value={p.key}>{p.label} {p.width}×{p.height}</option>
          ))}
          <option value="custom">직접 입력</option>
        </select>
      </Field>
      <div className="row">
        <Num label="너비" value={screen.width} onChange={(v) => set({ width: Math.max(100, Math.min(20000, Math.round(v))) }, 'w')} />
        <Num label="높이" value={screen.height} onChange={(v) => set({ height: Math.max(100, Math.min(20000, Math.round(v))) }, 'h')} />
      </div>
      {screen.background && (
        <div className="row">
          <span className="swatch" style={{ background: screen.background }} />
          <span className="muted grow">바탕색 {screen.background}</span>
          <button className="btn small" onClick={() => commit(mapScreen(getState().project, screen.id, (x) => ({ ...x, background: undefined })))}>바탕색 없애기</button>
        </div>
      )}
      <p className="muted">크기가 다른 화면은 따로 설계합니다. 상세 상태를 그리려면 화면을 복제하세요.</p>
      <button className="btn small" onClick={() => duplicateCurrentScreen(`${screen.name} (상태)`)}>상태 화면으로 복제</button>

      <StatesEditor screen={screen} />

      <h3>화면 메모</h3>
      <p className="muted">반응형 차이(예: "모바일은 목록 탭 전환, 드래그 대신 시간 배정 버튼")나 미정 사항을 적으세요. 미정은 요청문에 따로 모입니다.</p>
      {screen.notes.map((n) => (
        <div key={n.id} className="note-row">
          <select value={n.kind} onChange={(e) => updateScreen((s) => updateNote(s, n.id, { kind: e.target.value as typeof n.kind }))}>
            {NOTE_KINDS_LIST.map((k) => (
              <option key={k} value={k}>{NOTE_LABELS[k]}</option>
            ))}
          </select>
          <textarea value={n.text} rows={2} onChange={(e) => updateScreen((s) => updateNote(s, n.id, { text: e.target.value }), { coalesce: `note:${n.id}` })} />
          <button className="btn icon" onClick={() => updateScreen((s) => deleteNote(s, n.id))} aria-label="메모 지우기">✕</button>
        </div>
      ))}
      <div className="row">
        {NOTE_KINDS_LIST.map((k) => (
          <button key={k} className="btn small" onClick={() => updateScreen((s) => addNote(s, { id: newId('note'), kind: k, text: '' }))}>
            + {NOTE_LABELS[k]}
          </button>
        ))}
      </div>
      <h3>요약</h3>
      <p className="muted">
        요소 {screen.elements.length}개 · 동작 {screen.interactions.length}개 · 상태 {screen.states.length}개 · 필기 {screen.strokes.length}개
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ElementProps({ el, screen }: { el: SketchElement; screen: Screen }) {
  const set = (patch: Partial<SketchElement>, key: string) => updateScreen((s) => updateElement(s, el.id, patch), { coalesce: `el:${el.id}:${key}` });
  const fileRef = useRef<HTMLInputElement>(null);
  const parent = el.parentId ? screen.elements.find((e) => e.id === el.parentId) : undefined;
  const hasText = el.type !== 'image' && el.type !== 'group';
  return (
    <div className="panel">
      <h2>
        {ELEMENT_LABELS[el.type]} <code className="id" title="요소 id -- 이름을 바꿔도 유지됩니다">{el.id}</code>
      </h2>
      {parent && (
        <p className="muted">
          묶음 "{parent.name}" 안 ·{' '}
          <button className="link-btn" onClick={() => setState({ selection: [parent.id], enteredGroup: undefined })}>묶음 고르기</button>
        </p>
      )}
      <Field label="이름">
        <Text value={el.name} onChange={(v) => set({ name: v }, 'name')} testId="el-name" />
      </Field>
      {hasText && (
        <Field label={el.type === 'note' ? '메모 내용' : el.type === 'input' ? '입력된 값(예시)' : '문구'}>
          <Text value={el.text ?? ''} multiline onChange={(v) => set({ text: v }, 'text')} testId="el-text" />
        </Field>
      )}
      {el.type === 'input' && (
        <Field label="안내 문구(placeholder)">
          <Text value={el.props.placeholder ?? ''} onChange={(v) => set({ props: { placeholder: v } }, 'ph')} />
        </Field>
      )}
      <Field label="역할 (semanticRole)" hint="코드에서 쓸 이름 후보. 예: calendar, task_card, calendar_time_grid">
        <Text value={el.semanticRole} placeholder="예: task_card" onChange={(v) => set({ semanticRole: v }, 'role')} testId="el-role" />
      </Field>
      <Field label="배치 의도" hint="절대 좌표 대신 의도를 남깁니다">
        <Text value={el.props.layoutIntent ?? ''} placeholder="예: 캘린더는 위, 경계선으로 높이 조절" onChange={(v) => set({ props: { layoutIntent: v } }, 'intent')} />
      </Field>
      {el.type === 'shape' && (
        <Field label="모형">
          <select value={el.props.shapeKind ?? 'rect'} data-testid="shape-kind" onChange={(e) => set({ props: { shapeKind: e.target.value as typeof SHAPE_KINDS[number] } }, 'sk')}>
            {SHAPE_KINDS.map((k) => (
              <option key={k} value={k}>{SHAPE_LABELS[k]}</option>
            ))}
          </select>
        </Field>
      )}
      {el.props.fill && (
        <div className="row">
          <span className="swatch" style={{ background: el.props.fill }} />
          <span className="muted grow">채운 색 {el.props.fill}</span>
          <button className="btn small" onClick={() => set({ props: { fill: undefined } }, 'fill')}>색 없애기</button>
        </div>
      )}
      {el.type === 'connector' && (
        <Field label="연결선 종류" hint="그림일 뿐 동작은 '동작' 칸에서 만든 것만 명세에 들어갑니다">
          <select value={el.props.connectorKind ?? 'plain'} onChange={(e) => set({ props: { connectorKind: e.target.value as 'plain' } }, 'ck')}>
            <option value="plain">단순 선</option>
            <option value="navigation">화면 이동</option>
            <option value="dataflow">데이터 흐름</option>
          </select>
        </Field>
      )}
      {el.type === 'image' && (
        <>
          <button className="btn small" onClick={() => fileRef.current?.click()}>이미지 바꾸기</button>
          <input ref={fileRef} type="file" hidden accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void addImageFile(f, undefined, el.id);
            e.target.value = '';
          }} />
        </>
      )}
      <Field label="데이터 연결 (표·칸 참조)" hint="업무 데이터 정본(data/model.light.json 등)의 표.칸 -- 실제 DB 는 바꾸지 않습니다">
        <Text value={el.props.dataBinding ?? ''} placeholder="예: task.title" onChange={(v) => set({ props: { dataBinding: v } }, 'bind')} />
      </Field>
      <Field label="메모">
        <Text value={el.notes} multiline onChange={(v) => set({ notes: v }, 'notes')} testId="el-notes" />
      </Field>
      <div className="row geo">
        <Num label="X" value={el.x} onChange={(v) => updateScreen((s) => resizeElement(s, el.id, { ...el, x: v }), { coalesce: `geo:${el.id}` })} />
        <Num label="Y" value={el.y} onChange={(v) => updateScreen((s) => resizeElement(s, el.id, { ...el, y: v }), { coalesce: `geo:${el.id}` })} />
        <Num label="W" value={el.width} onChange={(v) => updateScreen((s) => resizeElement(s, el.id, { ...el, width: v }), { coalesce: `geo:${el.id}` })} />
        <Num label="H" value={el.height} onChange={(v) => updateScreen((s) => resizeElement(s, el.id, { ...el, height: v }), { coalesce: `geo:${el.id}` })} />
      </div>
      <div className="row wrap">
        <button className="btn small" onClick={toggleLock}>{el.props.locked ? '잠금 풀기' : '잠금'}</button>
        <button className="btn small" onClick={() => reorder('front')} title="맨 앞으로">맨 앞</button>
        <button className="btn small" onClick={() => reorder('forward')} title="한 칸 앞으로">앞</button>
        <button className="btn small" onClick={() => reorder('backward')} title="한 칸 뒤로">뒤</button>
        <button className="btn small" onClick={() => reorder('back')} title="맨 뒤로">맨 뒤</button>
        {el.type === 'group' && <button className="btn small" onClick={ungroupSelection}>묶음 풀기</button>}
        <button className="btn small danger" onClick={deleteSelection}>지우기</button>
      </div>

      <InteractionsEditor el={el} screen={screen} />
      <ElementStates el={el} screen={screen} />
    </div>
  );
}

function MultiProps({ els }: { els: SketchElement[] }) {
  return (
    <div className="panel">
      <h2>{els.length}개 선택</h2>
      <h3>정렬</h3>
      <div className="row wrap">
        <button className="btn small" onClick={() => align('left')}>왼쪽</button>
        <button className="btn small" onClick={() => align('hcenter')}>가운데</button>
        <button className="btn small" onClick={() => align('right')}>오른쪽</button>
        <button className="btn small" onClick={() => align('top')}>위</button>
        <button className="btn small" onClick={() => align('vcenter')}>중간</button>
        <button className="btn small" onClick={() => align('bottom')}>아래</button>
      </div>
      <div className="row wrap">
        <button className="btn small" onClick={groupSelection}>묶기</button>
        <button className="btn small" onClick={toggleLock}>잠금 전환</button>
        <button className="btn small" onClick={() => reorder('front')}>맨 앞</button>
        <button className="btn small" onClick={() => reorder('back')}>맨 뒤</button>
        <button className="btn small danger" onClick={deleteSelection}>지우기</button>
      </div>
      <ul className="muted">
        {els.map((e) => (
          <li key={e.id}>{ELEMENT_LABELS[e.type]} · {e.name}</li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 동작 명세

function InteractionsEditor({ el, screen }: { el: SketchElement; screen: Screen }) {
  const list = screen.interactions.filter((i) => i.sourceId === el.id);
  const incoming = screen.interactions.filter((i) => i.targetId === el.id);
  const add = () => {
    const ix: Interaction = { id: newId('ix'), sourceId: el.id, trigger: 'click', action: 'custom', effect: '', acceptance: '' };
    updateScreen((s) => addInteraction(s, ix));
    setState({ focusInteraction: ix.id });
  };
  return (
    <section className="ix-section">
      <h3>동작 <small>트리거 → 결과</small></h3>
      {list.map((ix) => (
        <InteractionCard key={ix.id} ix={ix} screen={screen} />
      ))}
      <button className="btn small" onClick={add} data-testid="add-interaction">+ 동작 추가</button>
      {incoming.length > 0 && (
        <p className="muted">
          이 요소를 대상으로 하는 동작 {incoming.length}개:{' '}
          {incoming.map((i) => (
            <button key={i.id} className="link-btn" onClick={() => setState({ selection: [i.sourceId], focusInteraction: i.id })}>
              {screen.elements.find((e) => e.id === i.sourceId)?.name ?? i.sourceId}
            </button>
          ))}
        </p>
      )}
    </section>
  );
}

function InteractionCard({ ix, screen }: { ix: Interaction; screen: Screen }) {
  const project = useEditor((s) => s.project);
  const focus = useEditor((s) => s.focusInteraction);
  const picking = useEditor((s) => s.pickingTargetFor);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus === ix.id) {
      ref.current?.scrollIntoView({ block: 'nearest' });
      ref.current?.querySelector<HTMLTextAreaElement>('textarea')?.focus();
      setState({ focusInteraction: undefined });
    }
  }, [focus, ix.id]);
  const set = (patch: Partial<Interaction>, key: string) => updateScreen((s) => updateInteraction(s, ix.id, patch), { coalesce: `ix:${ix.id}:${key}` });
  const problem = interactionTargetProblem(project, screen, ix);
  const targets = sortedElements(screen).filter((e) => e.id !== ix.sourceId && e.type !== 'connector');
  const broken = !!ix.targetId && !screen.elements.some((e) => e.id === ix.targetId);
  return (
    <div className={problem ? 'ix-card bad' : 'ix-card'} ref={ref} data-testid="ix-card" data-ix={ix.id}>
      <div className="row">
        <select aria-label="트리거" value={ix.trigger} onChange={(e) => set({ trigger: e.target.value as Interaction['trigger'] }, 'trigger')} data-testid="ix-trigger">
          {TRIGGERS.map((t) => (
            <option key={t} value={t}>{TRIGGER_LABELS[t]}</option>
          ))}
        </select>
        <span>→</span>
        <select aria-label="결과 종류" value={ix.action} onChange={(e) => set({ action: e.target.value as Interaction['action'] }, 'action')} data-testid="ix-action">
          {ACTIONS.map((a) => (
            <option key={a} value={a}>{ACTION_LABELS[a]}</option>
          ))}
        </select>
        <button className="btn icon" title="동작 지우기" aria-label="동작 지우기" onClick={() => updateScreen((s) => deleteInteraction(s, ix.id))}>✕</button>
      </div>
      {problem && <p className="error-text">✖ {problem}</p>}
      {ix.action === 'navigate' ? (
        <Field label="이동할 화면">
          <select value={ix.targetScreenId ?? ''} onChange={(e) => set({ targetScreenId: e.target.value || undefined }, 'tscr')} data-testid="ix-target-screen">
            <option value="">(고르세요)</option>
            {project.screens.filter((s) => s.id !== screen.id).map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
            {ix.targetScreenId && !project.screens.some((s) => s.id === ix.targetScreenId) && <option value={ix.targetScreenId}>⚠ 지워진 화면</option>}
          </select>
        </Field>
      ) : (
        <Field label="대상 요소">
          <div className="row">
            <select value={ix.targetId ?? ''} onChange={(e) => set({ targetId: e.target.value || undefined }, 'tgt')} data-testid="ix-target">
              <option value="">(없음)</option>
              {targets.map((e) => (
                <option key={e.id} value={e.id}>{e.name} · {ELEMENT_LABELS[e.type]}</option>
              ))}
              {broken && <option value={ix.targetId}>⚠ 지워진 요소 ({ix.targetId})</option>}
            </select>
            <button
              className={picking === ix.id ? 'btn small on' : 'btn small'}
              title="작업판에서 대상 고르기"
              onClick={() => setState({ pickingTargetFor: picking === ix.id ? undefined : ix.id, tool: 'select' })}
            >
              ⌖
            </button>
          </div>
        </Field>
      )}
      {broken && (
        <div className="row">
          <span className="error-text">깨진 연결: 새 대상을 고르거나</span>
          <button className="btn small danger" onClick={() => updateScreen((s) => deleteInteraction(s, ix.id))}>동작 제거</button>
        </div>
      )}
      <Field label="사전 조건"><Text multiline value={ix.condition ?? ''} placeholder="예: 작업이 완료 상태가 아님" onChange={(v) => set({ condition: v }, 'cond')} testId="ix-condition" /></Field>
      <Field label="결과"><Text multiline value={ix.effect} placeholder="예: 놓은 날짜와 시간에 작업 블록 생성" onChange={(v) => set({ effect: v }, 'effect')} testId="ix-effect" /></Field>
      <Field label="데이터 변경"><Text multiline value={ix.dataChange ?? ''} placeholder="예: task 는 유지하고 schedule_block 생성" onChange={(v) => set({ dataChange: v }, 'data')} testId="ix-data" /></Field>
      <Field label="예외·실패 상태"><Text multiline value={ix.errorState ?? ''} placeholder="예: 저장 실패 시 원위치" onChange={(v) => set({ errorState: v }, 'err')} testId="ix-error" /></Field>
      <Field label="검증 기준"><Text multiline value={ix.acceptance} placeholder="예: 새로고침 후 배치가 유지된다" onChange={(v) => set({ acceptance: v }, 'acc')} testId="ix-acceptance" /></Field>
      <Field label={ix.action === 'external_link' ? '링크 주소' : '요구사항 메모 (API 등 -- 실행하지 않음)'}>
        <Text value={ix.memo ?? ''} onChange={(v) => set({ memo: v }, 'memo')} />
      </Field>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 상태

function StateRows({ screen, targetId }: { screen: Screen; targetId?: string }) {
  const rows = screen.states.filter((s) => (targetId ? s.targetId === targetId : !s.targetId));
  const others = getState().project.screens.filter((s) => s.id !== screen.id);
  return (
    <>
      {rows.map((st) => (
        <div key={st.id} className="state-row" data-testid="state-row">
          <select value={st.kind} onChange={(e) => updateScreen((s) => updateState(s, st.id, { kind: e.target.value as StateKind }))}>
            {STATE_KINDS.map((k) => (
              <option key={k} value={k}>{STATE_LABELS[k]}</option>
            ))}
          </select>
          <textarea rows={1} value={st.description} placeholder="이 상태에서 보이는 것" onChange={(e) => updateScreen((s) => updateState(s, st.id, { description: e.target.value }), { coalesce: `st:${st.id}` })} />
          <select title="상태 화면 연결" value={st.screenRef ?? ''} onChange={(e) => updateScreen((s) => updateState(s, st.id, { screenRef: e.target.value || undefined }))}>
            <option value="">상태 화면 없음</option>
            {others.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button className="btn icon" aria-label="상태 지우기" onClick={() => updateScreen((s) => deleteState(s, st.id))}>✕</button>
        </div>
      ))}
    </>
  );
}

function AddStateButtons({ targetId }: { targetId?: string }) {
  return (
    <div className="row wrap">
      {STATE_KINDS.filter((k) => k !== 'normal').map((k) => (
        <button key={k} className="btn small" data-testid={`add-state-${k}`} onClick={() => updateScreen((s) => addState(s, { id: newId('st'), kind: k, targetId, description: '' }))}>
          + {STATE_LABELS[k]}
        </button>
      ))}
    </div>
  );
}

function ElementStates({ el, screen }: { el: SketchElement; screen: Screen }) {
  return (
    <section>
      <h3>상태 <small>정상·빈 화면·불러오는 중·오류·비활성</small></h3>
      <StateRows screen={screen} targetId={el.id} />
      <AddStateButtons targetId={el.id} />
    </section>
  );
}

function StatesEditor({ screen }: { screen: Screen }) {
  return (
    <section>
      <h3>화면 상태</h3>
      <StateRows screen={screen} />
      <AddStateButtons />
    </section>
  );
}
