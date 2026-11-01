// 단독 profile: 중립 전달물만 (requirements.md·project.json·PNG 는 공통). 프레임워크가 없어도 그대로 AI 에게 넘긴다.
import { buildTraceability, type Adapter } from '@sketch/exporters';

export const standaloneAdapter: Adapter = {
  profile: 'standalone',
  label: '단독',
  adapterVersion: '0.1.0',
  async files(project, ctx) {
    return [{ path: 'traceability.json', data: JSON.stringify(buildTraceability(project, ctx, 'standalone', this.adapterVersion), null, 2) }];
  },
};
