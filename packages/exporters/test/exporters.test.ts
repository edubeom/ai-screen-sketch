import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import { deleteElements, mapScreen, parseProject, sha256Hex, stableStringify, type Project } from '@sketch/core';
import {
  ExportBlockedError,
  buildRequirements,
  exportBundle,
  importBundle,
  renderScreenSvg,
  wrapText,
} from '@sketch/exporters';
import { standaloneAdapter } from '@sketch/adapter-standalone';
import { devLightAdapter } from '@sketch/adapter-dev-light';
import { devFrameworkAdapter } from '@sketch/adapter-dev-framework';

const example = (): Project => {
  const r = parseProject(JSON.parse(readFileSync(new URL('../../../examples/ahnda-planner/project.json', import.meta.url), 'utf8')));
  if (!r.ok) throw new Error(r.errors.join());
  return r.project!;
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

describe('구현 요청문', () => {
  it('화면 순서·동작·예외·검증 기준을 담고 빈 칸은 미정으로 모은다', () => {
    const md = buildRequirements(example());
    expect(md).toContain('## 화면 순서');
    expect(md).toContain('`ix_drop_task`');
    expect(md).toContain('calendar_time_grid');
    expect(md).toContain('선행 미완료');
    expect(md).toContain('AC-ix_drop_task');
    // ix_view_week 의 예외가 비어 있다 -> 미정
    expect(md).toMatch(/## 미정 사항[\s\S]*ix_view_week/);
    expect(md).toContain('주 보기 시간 칸 단위');
  });

  it('HTML 은 글자로만 남긴다', () => {
    const p = example();
    p.screens[0].elements[0].text = '<script>alert(1)</script>';
    const md = buildRequirements(p);
    expect(md).not.toContain('<script>');
    expect(renderScreenSvg(p.screens[0], { includeStrokes: true, includeNotes: true })).not.toContain('<script>');
  });

  it('글 줄바꿈', () => {
    expect(wrapText('가나다라마바사', 40, 13).length).toBeGreaterThan(1);
    expect(wrapText('abc', 1000, 13)).toEqual(['abc']);
    expect(wrapText('a\nb\nc\nd', 1000, 13, 2)).toHaveLength(2);
  });
});

describe('설계 묶음 ZIP', () => {
  it('Light profile 로 내보내고 다시 가져오면 같은 프로젝트다', async () => {
    const p = example();
    const pngs = Object.fromEntries(p.screens.map((s) => [s.id, PNG]));
    const res = await exportBundle({ project: p, adapter: devLightAdapter, pngs, generatedAt: '2026-11-02T00:00:00.000Z' });
    const zip = await JSZip.loadAsync(res.zip);
    const names = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name).sort();
    expect(names).toEqual(
      [
        'exports/dev-light/task-card.md',
        'exports/dev-light/traceability.json',
        'manifest.json',
        'project.json',
        'requirements.md',
        'screens/01-main.png',
        'screens/02-mobile.png',
        'validation-report.json',
      ].sort(),
    );
    const manifest = JSON.parse(await zip.file('manifest.json')!.async('string'));
    expect(manifest.revision).toBe(p.revision);
    for (const f of manifest.files) {
      const b = await zip.file(f.path)!.async('uint8array');
      expect(await sha256Hex(b)).toBe(f.sha256);
      expect(b.byteLength).toBe(f.size);
    }
    const trace = JSON.parse(await zip.file('exports/dev-light/traceability.json')!.async('string'));
    expect(trace.integration.profile).toBe('dev-light');
    expect(trace.designId).toBe('ahnda-planner');
    expect(trace.acceptanceRefs.map((a: { interactionId: string }) => a.interactionId)).toContain('ix_drop_task');
    expect(trace.approval.status).toBe('draft');
    expect(trace.evidenceRefs.every((e: { verdict: string }) => e.verdict === 'unverified')).toBe(true);
    const card = await zip.file('exports/dev-light/task-card.md')!.async('string');
    expect(card).toContain('`NOW.md` 를 덮지 않습니다');
    expect(card).toContain('AC-ix_drop_task');

    const back = await importBundle(res.zip);
    expect(back.errors).toEqual([]);
    expect(back.warnings).toEqual([]);
    expect(stableStringify(back.project)).toBe(stableStringify(p));
  });

  it('같은 설계를 단독·Light·전문판으로 내보내도 요소·동작 id 와 revision 이 같다', async () => {
    const p = example();
    const ids: string[] = [];
    for (const adapter of [standaloneAdapter, devLightAdapter, devFrameworkAdapter]) {
      const res = await exportBundle({ project: p, adapter });
      const back = await importBundle(res.zip);
      ids.push(stableStringify({ r: back.project!.revision, d: res.digest, e: back.project!.screens.map((s) => [s.elements.map((e) => e.id), s.interactions.map((i) => i.id)]) }));
    }
    expect(new Set(ids).size).toBe(1);
    const fw = await JSZip.loadAsync((await exportBundle({ project: p, adapter: devFrameworkAdapter })).zip);
    expect(await fw.file('exports/dev-framework/task-draft.md')!.async('string')).toContain('전달 초안 지원');
  });

  it('필수 대상이 없는 동작이 있으면 내보내기를 막는다', async () => {
    const p = example();
    const broken = mapScreen(p, 'main', (s) => deleteElements(s, ['calendar_time_grid']));
    await expect(exportBundle({ project: broken, adapter: standaloneAdapter })).rejects.toBeInstanceOf(ExportBlockedError);
  });

  it('경로 탈출·이미지 해시 불일치·project.json 없는 ZIP 을 막는다', async () => {
    const evil = new JSZip();
    evil.file('project.json', JSON.stringify(example()));
    evil.file('../../evil.txt', 'x');
    const r1 = await importBundle(await evil.generateAsync({ type: 'uint8array' }));
    expect(r1.ok).toBe(false);
    expect(r1.errors.join()).toContain('안전하지 않은 경로');

    const p = example();
    p.assets.push({ id: 'asset_1', relativePath: 'assets/asset_1.png', mimeType: 'image/png', sha256: await sha256Hex(PNG), width: 1, height: 1 });
    const okZip = await exportBundle({ project: p, adapter: standaloneAdapter, assets: { asset_1: PNG } });
    const good = await importBundle(okZip.zip);
    expect(good.ok).toBe(true);
    expect(good.assets[0].data).toEqual(PNG);
    const z = await JSZip.loadAsync(okZip.zip);
    z.file('assets/asset_1.png', new Uint8Array([1, 2, 3]));
    const bad = await importBundle(await z.generateAsync({ type: 'uint8array' }));
    expect(bad.ok).toBe(false);

    const empty = new JSZip();
    empty.file('readme.txt', 'x');
    expect((await importBundle(await empty.generateAsync({ type: 'uint8array' }))).errors.join()).toContain('project.json');
  });
});
