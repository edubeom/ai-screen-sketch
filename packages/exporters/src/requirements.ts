// 구현 요청문(requirements.md). 화면 순서·핵심 영역·동작·예외·완료 기준을 적고 미정 사항을 따로 모은다.
// 비어 있는 칸은 AI 가 임의로 채우지 않도록 "미정"으로 내보낸다.
import {
  ACTION_LABELS,
  ELEMENT_LABELS,
  NOTE_LABELS,
  STATE_LABELS,
  TRIGGER_LABELS,
  UNDECIDED,
  checkSpec,
  sortedElements,
  type Interaction,
  type Project,
  type Screen,
  type SketchElement,
} from '@sketch/core';

/** 마크다운 표·목록에 넣을 글: 줄바꿈과 | 를 바꿔 표가 깨지지 않게. HTML 은 글자 그대로 둔다 */
export function mdCell(s: string | undefined): string {
  const t = (s ?? '').trim();
  if (!t) return UNDECIDED;
  return t.replace(/\|/g, '\\|').replace(/\r?\n/g, ' / ').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function elName(screen: Screen, id?: string): string {
  if (!id) return '-';
  const el = screen.elements.find((e) => e.id === id);
  return el ? `${mdCell(el.name)} (\`${el.id}\`)` : `⚠ 없는 요소 (\`${id}\`)`;
}

export interface RequirementsOptions {
  /** 화면별 PNG 파일 경로 (screenId → 경로) */
  pngPaths?: Record<string, string>;
  profile?: string;
}

/** 요청문에서 쓰는 검증 기준 id -- traceability.json 과 같다 */
export function acceptanceId(ix: Interaction): string {
  return `AC-${ix.id}`;
}

export function buildRequirements(project: Project, opts: RequirementsOptions = {}): string {
  const out: string[] = [];
  const undecided: string[] = [];
  const issues = checkSpec(project);
  out.push(`# 구현 요청: ${mdCell(project.title)}`);
  out.push('');
  out.push(`- 설계 id: \`${project.id}\` · revision ${project.revision} · 저장 시각 ${project.updatedAt}`);
  out.push(`- 화면 ${project.screens.length}개 · 동작 ${project.screens.reduce((n, s) => n + s.interactions.length, 0)}개`);
  if (opts.profile) out.push(`- 전달 profile: ${opts.profile}`);
  out.push('');
  out.push('> 이 문서는 화면 설계 도구가 만든 **설계**입니다. 구현된 사실이 아닙니다.');
  out.push('> 좌표·문구·동작의 정본은 `project.json` 이고, 그림(PNG)은 사람이 확인하는 기준입니다. 요소 id 는 이름이 바뀌어도 유지됩니다.');
  out.push(`> 칸이 **${UNDECIDED}** 인 항목은 정해지지 않은 것입니다. 임의 기능으로 채우지 말고 질문하거나 "미정 사항"에 남겨 두세요.`);
  out.push('> "API 호출" 등은 요구사항 메모일 뿐 이 도구가 실행하지 않았습니다.');
  out.push('');
  out.push('## 화면 순서');
  project.screens.forEach((s, i) => {
    const png = opts.pngPaths?.[s.id];
    out.push(`${i + 1}. **${mdCell(s.name)}** (\`${s.id}\`, ${s.width}×${s.height})${png ? ` -- 그림 \`${png}\`` : ''}`);
  });
  out.push('');

  project.screens.forEach((s, i) => {
    out.push(`## ${i + 1}. ${mdCell(s.name)} (\`${s.id}\`)`);
    out.push('');
    out.push(`크기 ${s.width}×${s.height}. 좌표는 왼쪽 위 기준 px.`);
    out.push('');
    // 핵심 영역: 최상위 요소(묶음 포함)
    const els = sortedElements(s).filter((e) => e.type !== 'connector');
    const top = els.filter((e) => !e.parentId);
    out.push('### 핵심 영역과 요소');
    out.push('');
    out.push('| id | 종류 | 이름 | 문구 | 역할 | 위치·크기 | 배치 의도 | 메모 |');
    out.push('|---|---|---|---|---|---|---|---|');
    const row = (e: SketchElement, depth: number) =>
      `| ${'↳ '.repeat(depth)}\`${e.id}\` | ${ELEMENT_LABELS[e.type]} | ${mdCell(e.name)} | ${e.text?.trim() ? mdCell(e.text) : '-'} | ${e.semanticRole.trim() ? mdCell(e.semanticRole) : '-'} | ${e.x},${e.y} ${e.width}×${e.height} | ${e.props.layoutIntent?.trim() ? mdCell(e.props.layoutIntent) : '-'} | ${e.notes.trim() ? mdCell(e.notes) : '-'}${e.props.dataBinding ? ` · 데이터: ${mdCell(e.props.dataBinding)}` : ''} |`;
    const walk = (e: SketchElement, depth: number) => {
      out.push(row(e, depth));
      for (const k of els.filter((x) => x.parentId === e.id)) walk(k, depth + 1);
    };
    for (const e of top) walk(e, 0);
    if (!els.length) out.push('| - | - | - | - | - | - | - | - |');
    out.push('');
    const connectors = s.elements.filter((e) => e.type === 'connector' && e.props.connectorKind !== 'plain');
    if (connectors.length) {
      out.push('연결선(그림 표시용 -- 동작은 아래 "동작" 표만 유효):');
      for (const c of connectors) out.push(`- ${c.props.connectorKind === 'navigation' ? '화면 이동' : '데이터 흐름'}: ${mdCell(c.text || c.name)} (\`${c.id}\`)`);
      out.push('');
    }

    out.push('### 동작');
    out.push('');
    if (!s.interactions.length) {
      out.push('(없음)');
      undecided.push(`${s.name}: 정의된 동작이 없습니다`);
    }
    for (const ix of s.interactions) {
      const target = ix.targetScreenId
        ? `화면 ${mdCell(project.screens.find((x) => x.id === ix.targetScreenId)?.name ?? `⚠ 없는 화면 ${ix.targetScreenId}`)} (\`${ix.targetScreenId}\`)`
        : elName(s, ix.targetId);
      out.push(`#### \`${ix.id}\` -- ${elName(s, ix.sourceId)} ${TRIGGER_LABELS[ix.trigger]} → ${ACTION_LABELS[ix.action]}`);
      out.push('');
      out.push('| 항목 | 내용 |');
      out.push('|---|---|');
      out.push(`| 시작 요소 | ${elName(s, ix.sourceId)} |`);
      out.push(`| 트리거 | ${TRIGGER_LABELS[ix.trigger]} (\`${ix.trigger}\`) |`);
      out.push(`| 대상 | ${target} |`);
      out.push(`| 사전 조건 | ${mdCell(ix.condition)} |`);
      out.push(`| 결과 | ${ACTION_LABELS[ix.action]}: ${mdCell(ix.effect)} |`);
      out.push(`| 데이터 변경 | ${mdCell(ix.dataChange)} |`);
      out.push(`| 예외·실패 | ${mdCell(ix.errorState)} |`);
      out.push(`| 검증 기준 (${acceptanceId(ix)}) | ${mdCell(ix.acceptance)} |`);
      if (ix.memo?.trim()) out.push(`| 요구사항 메모 | ${mdCell(ix.memo)} |`);
      out.push('');
      for (const [k, v] of [['사전 조건', ix.condition], ['결과', ix.effect], ['예외·실패', ix.errorState], ['검증 기준', ix.acceptance]] as const) {
        if (!v?.trim()) undecided.push(`${s.name} · \`${ix.id}\` 의 ${k}`);
      }
    }

    out.push('### 상태');
    out.push('');
    if (!s.states.length) out.push('(지정 없음)');
    for (const st of s.states) {
      out.push(`- **${STATE_LABELS[st.kind]}** -- ${st.targetId ? elName(s, st.targetId) : '화면 전체'}: ${mdCell(st.description)}${st.screenRef ? ` (상태 화면 \`${st.screenRef}\`)` : ''}`);
      if (!st.description.trim()) undecided.push(`${s.name}: ${STATE_LABELS[st.kind]} 상태 설명`);
    }
    out.push('');
    if (s.notes.length) {
      out.push('### 메모');
      out.push('');
      for (const n of s.notes) {
        out.push(`- [${NOTE_LABELS[n.kind]}] ${mdCell(n.text)}`);
        if (n.kind === 'undecided') undecided.push(`${s.name}: ${n.text.trim() || '(내용 없음)'}`);
      }
      out.push('');
    }
    const memos = s.elements.filter((e) => e.type === 'note' && e.text?.trim());
    if (memos.length) {
      out.push('### 작업판 메모');
      out.push('');
      for (const m of memos) out.push(`- ${mdCell(m.text)} (\`${m.id}\`)`);
      out.push('');
    }
    if (s.strokes.length) {
      out.push(`필기 ${s.strokes.length}개는 \`project.json\` 의 strokes 에 있습니다 (필기 인식은 하지 않음 -- 그림을 보고 확인하세요).`);
      out.push('');
    }
  });

  out.push('## 완료 기준 (검증 목록)');
  out.push('');
  let n = 0;
  for (const s of project.screens) {
    for (const ix of s.interactions) {
      n++;
      out.push(`- [ ] ${acceptanceId(ix)} (${mdCell(s.name)}) ${elName(s, ix.sourceId)} ${TRIGGER_LABELS[ix.trigger]}: ${mdCell(ix.acceptance)}${ix.errorState?.trim() ? ` -- 실패 시: ${mdCell(ix.errorState)}` : ''}`);
    }
  }
  if (!n) out.push('(동작이 없어 검증 목록이 비어 있습니다)');
  out.push('- [ ] 각 화면의 배치가 PNG 와 같다 (영역 위치·문구)');
  out.push('');

  out.push('## 미정 사항');
  out.push('');
  if (!undecided.length) out.push('(없음)');
  for (const u of undecided) out.push(`- ${mdCell(u)}`);
  out.push('');

  const warn = issues.filter((i) => i.level !== 'info');
  if (warn.length) {
    out.push('## 설계 검증 경고');
    out.push('');
    for (const i of warn) out.push(`- ${i.level === 'error' ? '⛔' : '⚠'} ${mdCell(i.message)}`);
    out.push('');
  }
  return out.join('\n');
}
