// dev-process-light profile (기획서 9장).
// 프로젝트 기록(NOW·FEATURES·NAMES·DECISIONS)을 직접 바꾸지 않고, 사람이 검토할 "초안"만 만든다.
// 묶음을 풀 곳(제안): design/sketch/<project-id>/  →  exports/dev-light/task-card.md, traceability.json
import {
  ACTION_LABELS,
  TRIGGER_LABELS,
  UNDECIDED,
  type Project,
} from '@sketch/core';
import { acceptanceId, buildTraceability, mdCell, type Adapter, type AdapterContext } from '@sketch/exporters';

export function buildLightTaskCard(project: Project, ctx: AdapterContext): string {
  const L: string[] = [];
  const ixs = project.screens.flatMap((s) => s.interactions.map((ix) => ({ s, ix })));
  const name = (sid: string, id?: string) => {
    const s = project.screens.find((x) => x.id === sid);
    return s?.elements.find((e) => e.id === id)?.name ?? id ?? '-';
  };
  L.push(`# Light 작업 카드 초안 -- ${mdCell(project.title)}`);
  L.push('');
  L.push('> **초안입니다 (승인 전).** 이 파일은 `NOW.md` 를 덮지 않습니다. `light-start` 에서 사용자에게 보여 주고 확인받은 뒤 카드로 옮기세요.');
  L.push(`> 설계 정본: \`design/sketch/${project.id}/project.json\` · revision ${project.revision} · digest \`${ctx.digest.slice(0, 16)}…\``);
  L.push('> 이 설계를 구현 사실로 적지 마세요 (설명서·기록은 구현 확인 뒤).');
  L.push('');
  L.push('## NOW.md 에 제안할 작업 카드');
  L.push('');
  L.push('```');
  L.push(`### 작업: ${project.title} 화면 구현 (설계 r${project.revision})`);
  L.push(`- 목표: 설계 묶음(design/sketch/${project.id}, revision ${project.revision})의 화면 ${project.screens.length}개와 동작 ${ixs.length}개를 구현한다`);
  L.push('- 완료 기준:');
  for (const { s, ix } of ixs) {
    L.push(`  - [ ] ${acceptanceId(ix)} ${s.name} · ${name(s.id, ix.sourceId)} ${TRIGGER_LABELS[ix.trigger]} → ${ix.acceptance.trim() || UNDECIDED}`);
  }
  L.push('  - [ ] 화면 배치가 설계 PNG 와 같다 (사람 확인)');
  L.push('- 건드릴 기능: (AI 가 FEATURES.md 와 실제 코드를 확인한 뒤 확정)');
  L.push('- 영향 받을 수 있는 기능: (확인 후)');
  L.push('- 설명서: 장 추가 또는 고침 -- 구현 확인 뒤 작성');
  const bindings = project.screens.flatMap((s) => s.elements.filter((e) => e.props.dataBinding?.trim()).map((e) => `${e.name}=${e.props.dataBinding}`));
  L.push(`- 데이터: ${bindings.length ? `읽기만/표 바꿈 확인 필요 (${bindings.join(', ')}) -- 표를 새로 만들거나 바꾸면 data-light 로` : '미정 -- 저장할 데이터가 생기면 data-light 로'}`);
  L.push(`- 설계 revision: ${project.revision}`);
  L.push('- 진행: 계획');
  L.push('```');
  L.push('');
  L.push('## light-check 에 넘길 동작별 검증');
  L.push('');
  L.push('| 검증 id | 화면 | 동작 | 기준 | 실패 상태 | 확인 방법 |');
  L.push('|---|---|---|---|---|---|');
  for (const { s, ix } of ixs) {
    const how = ix.trigger === 'drag_drop' ? '직접 확인 (브라우저 도구로 끌어 놓기) 또는 사람 확인' : '직접 확인';
    L.push(`| ${acceptanceId(ix)} | ${mdCell(s.name)} | ${mdCell(name(s.id, ix.sourceId))} ${TRIGGER_LABELS[ix.trigger]} → ${ACTION_LABELS[ix.action]} | ${mdCell(ix.acceptance)} | ${mdCell(ix.errorState)} | ${how} |`);
  }
  if (!ixs.length) L.push(`| - | - | 동작 없음 | ${UNDECIDED} | ${UNDECIDED} | - |`);
  L.push('');
  L.push('결과는 ✅ 직접 확인 · 👀 사람 확인 · ❓ 확인 못 함 으로 나눠 적고, 증거는 traceability.json 의 evidenceRefs 에 연결합니다.');
  L.push('UI 배치만 맞고 드롭 같은 동작이 빠지면 검증 실패입니다.');
  L.push('');
  L.push('## FEATURES.md 제안 (화면 → 기능)');
  L.push('');
  L.push('| 화면 | 설계 id | 기능 이름(제안) | 쓰는 파일 |');
  L.push('|---|---|---|---|');
  for (const s of project.screens) L.push(`| ${mdCell(s.name)} | \`${s.id}\` | ${mdCell(s.name)} (제안) | AI 가 코드 확인 후 확정 |`);
  L.push('');
  L.push('## NAMES.md 후보 (화면 문구 ↔ 코드 이름)');
  L.push('');
  L.push('기존 이름이 있으면 기존 이름을 우선합니다. 아래는 **제안**입니다.');
  L.push('');
  L.push('| 화면에 보이는 말 | 코드 이름(제안) | 메모 |');
  L.push('|---|---|---|');
  const seen = new Set<string>();
  for (const s of project.screens) {
    for (const e of s.elements) {
      const t = (e.text ?? '').trim();
      if (!t || e.type === 'note' || e.type === 'input' || seen.has(t)) continue;
      seen.add(t);
      L.push(`| ${mdCell(t)} | ${e.semanticRole.trim() ? `\`${mdCell(e.semanticRole)}\`` : '(미정)'} | 요소 \`${e.id}\` · 제안 |`);
    }
  }
  L.push('');
  L.push('## DECISIONS.md 에 옮길 때');
  L.push('');
  L.push('- 이 설계에 적힌 문구·동작·예외는 **사용자가 설계 도구에 적은 내용**입니다 → `[사용자]` 로 옮기되, 사용자가 카드에서 확인한 것만.');
  L.push('- AI 가 채운 추론(기능 id·파일 관계·이름 확정)은 `[AI]` 로 이유와 함께 따로 적습니다. 섞지 않습니다.');
  L.push('');
  L.push('## 저장·포털');
  L.push('');
  L.push(`- light-save 때 설계 revision(${project.revision})과 결과 파일·검증 증거를 기록에 함께 남깁니다.`);
  L.push('- 포털(outputs/site)은 생성물이므로 직접 고치지 않습니다. 설계 그림을 공개본에 넣는 것은 별도 선택입니다.');
  return L.join('\n');
}

export const devLightAdapter: Adapter = {
  profile: 'dev-light',
  label: 'dev-process-light',
  adapterVersion: '0.1.0',
  async files(project, ctx) {
    const trace = buildTraceability(project, ctx, 'dev-light', this.adapterVersion);
    return [
      { path: 'exports/dev-light/task-card.md', data: buildLightTaskCard(project, ctx) },
      { path: 'exports/dev-light/traceability.json', data: JSON.stringify(trace, null, 2) },
    ];
  },
};
