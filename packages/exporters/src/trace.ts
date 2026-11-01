// 공통 교환 계약 traceability.json (기획서 10장). 어댑터마다 profile 만 다르다.
import type { Project } from '@sketch/core';
import { acceptanceId } from './requirements.ts';
import type { AdapterContext } from './bundle.ts';

export interface Traceability {
  integration: { profile: string; adapterVersion: string };
  hostProjectId: string | null;
  hostTaskId: string | null;
  designId: string;
  revision: number;
  digest: string;
  generatedAt: string;
  featureRefs: { screenId: string; name: string; featureId: string | null; status: 'unconfirmed' | 'confirmed' }[];
  termRefs: { elementId: string; screenText: string; codeName: string | null; status: 'proposed' | 'confirmed' }[];
  acceptanceRefs: { interactionId: string; acceptanceId: string; screenId: string; text: string | null }[];
  evidenceRefs: { acceptanceId: string; evidence: string | null; verdict: 'unverified' }[];
  approval: { status: 'draft'; approvedBy: null; approvedAt: null; revision: number };
  warnings: string[];
}

export function buildTraceability(project: Project, ctx: AdapterContext, profile: string, adapterVersion: string): Traceability {
  const acceptanceRefs: Traceability['acceptanceRefs'] = [];
  const termRefs: Traceability['termRefs'] = [];
  const warnings: string[] = [];
  for (const s of project.screens) {
    for (const ix of s.interactions) {
      acceptanceRefs.push({ interactionId: ix.id, acceptanceId: acceptanceId(ix), screenId: s.id, text: ix.acceptance.trim() || null });
      if (!ix.acceptance.trim()) warnings.push(`${ix.id}: 검증 기준이 비어 있습니다 (미정)`);
    }
    for (const e of s.elements) {
      const t = (e.text ?? '').trim();
      if (!t || e.type === 'note' || e.type === 'input') continue;
      termRefs.push({ elementId: e.id, screenText: t.slice(0, 80), codeName: e.semanticRole.trim() || null, status: 'proposed' });
    }
  }
  if (termRefs.length) warnings.push('termRefs 는 화면 문구와 코드 이름의 후보입니다 -- 기존 이름표(NAMES·용어사전)를 우선해 확정하세요');
  warnings.push('featureRefs 는 미확정입니다 -- 실제 코드를 확인한 뒤 기능 id 를 연결하세요');
  return {
    integration: { profile, adapterVersion },
    hostProjectId: ctx.hostProjectId ?? null,
    hostTaskId: ctx.hostTaskId ?? null,
    designId: project.id,
    revision: project.revision,
    digest: ctx.digest,
    generatedAt: ctx.generatedAt,
    featureRefs: project.screens.map((s) => ({ screenId: s.id, name: s.name, featureId: null, status: 'unconfirmed' })),
    termRefs,
    acceptanceRefs,
    // 설계 수정 후 이전 revision 의 승인·증거는 넘겨받지 않는다 -- 언제나 미검증·초안에서 시작
    evidenceRefs: acceptanceRefs.map((a) => ({ acceptanceId: a.acceptanceId, evidence: null, verdict: 'unverified' })),
    approval: { status: 'draft', approvedBy: null, approvedAt: null, revision: project.revision },
    warnings,
  };
}
