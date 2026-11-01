// dev-process-framework(전문판) profile -- "전달 초안 지원".
// 전문판의 내부 계약(명령 옵션·디렉터리)은 아직 확인하지 못했다 (기획서 8·10장). 공개 대응표의 개념만 쓰고,
// 전문판 파일에 직접 쓰거나 명령을 실행하지 않는다. 완전 호환이라고 표시하지 않는다.
import { TRIGGER_LABELS, UNDECIDED, type Project } from '@sketch/core';
import { acceptanceId, buildTraceability, mdCell, type Adapter, type AdapterContext } from '@sketch/exporters';

export function buildFrameworkDraft(project: Project, ctx: AdapterContext): string {
  const L: string[] = [];
  const ixs = project.screens.flatMap((s) => s.interactions.map((ix) => ({ s, ix })));
  L.push(`# 전문판 전달 초안 -- ${mdCell(project.title)}`);
  L.push('');
  L.push('> **전달 초안 지원**: dev-process-framework 의 실제 계약을 확인하기 전의 교환 파일입니다. 완전 호환이 아닙니다.');
  L.push(`> 설계 ${project.id} · revision ${project.revision} · digest \`${ctx.digest.slice(0, 16)}…\` · 승인 상태: 초안`);
  L.push('');
  L.push('## task-new (작업 생성)');
  L.push('');
  L.push(`- 제목: ${mdCell(project.title)} 화면 구현 (설계 r${project.revision})`);
  L.push(`- 범위: 화면 ${project.screens.map((s) => mdCell(s.name)).join(', ')}`);
  L.push(`- hostProjectId: ${ctx.hostProjectId ?? 'null (미연결)'} · hostTaskId: ${ctx.hostTaskId ?? 'null (미연결)'}`);
  L.push('');
  L.push('## accept (완료 기준)');
  L.push('');
  for (const { s, ix } of ixs) L.push(`- ${acceptanceId(ix)} [${mdCell(s.name)}] ${TRIGGER_LABELS[ix.trigger]}: ${mdCell(ix.acceptance)} (실패: ${mdCell(ix.errorState)})`);
  if (!ixs.length) L.push(`- ${UNDECIDED}`);
  L.push('');
  L.push('## verify (실행 증거)');
  L.push('');
  L.push('traceability.json 의 evidenceRefs 에 검증 기준 id 별 실행 결과·스크린샷·판정을 연결합니다. 지금은 모두 unverified 입니다.');
  L.push('');
  L.push('## finish (커밋·보고서·인수인계)');
  L.push('');
  L.push(`- 보고서에 설계 revision ${project.revision} 과 digest 를 적습니다. 설계가 바뀌면 새 revision 의 승인·증거를 새로 받습니다 (자동 승계 없음).`);
  return L.join('\n');
}

export const devFrameworkAdapter: Adapter = {
  profile: 'dev-framework',
  label: '전문판 (전달 초안)',
  adapterVersion: '0.1.0-draft',
  async files(project, ctx) {
    const trace = buildTraceability(project, ctx, 'dev-framework', this.adapterVersion);
    return [
      { path: 'exports/dev-framework/task-draft.md', data: buildFrameworkDraft(project, ctx) },
      { path: 'exports/dev-framework/traceability.json', data: JSON.stringify(trace, null, 2) },
    ];
  },
};
