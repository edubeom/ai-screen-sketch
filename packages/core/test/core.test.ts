import { describe, expect, it } from 'vitest';
import {
  addElements,
  addInteraction,
  alignElements,
  bringToFront,
  checkSpec,
  createElement,
  createPreset,
  createProject,
  deleteElements,
  duplicateElements,
  duplicateScreen,
  groupElements,
  hasBlockingIssues,
  isSafeRelativePath,
  mapScreen,
  moveElements,
  parseProject,
  resizeElement,
  sortedElements,
  stableStringify,
  ungroup,
  type Interaction,
  type Project,
} from '@sketch/core';

function projectWith(...types: Parameters<typeof createElement>[0][]): Project {
  const p = createProject('테스트');
  const els = types.map((t, i) => createElement(t, 100 * i, 50, { id: `${t}_${i}` }));
  return mapScreen(p, p.screens[0].id, (s) => addElements(s, els));
}

describe('편집 명령', () => {
  it('요소 이동은 묶음의 자식까지 옮기고 묶음 상자를 맞춘다', () => {
    const p = createProject('t');
    const preset = createPreset('calendar', 100, 100);
    let s = addElements(p.screens[0], preset);
    const group = preset[0];
    s = moveElements(s, [group.id], 10, 20);
    const g = s.elements.find((e) => e.id === group.id)!;
    expect(g.x).toBe(110);
    expect(g.y).toBe(120);
    for (const k of s.elements.filter((e) => e.parentId === group.id)) {
      const before = preset.find((e) => e.id === k.id)!;
      expect(k.x - before.x).toBe(10);
      expect(k.y - before.y).toBe(20);
    }
  });

  it('잠근 요소는 움직이지 않는다', () => {
    const p = projectWith('button');
    let s = p.screens[0];
    s = { ...s, elements: s.elements.map((e) => ({ ...e, props: { locked: true } })) };
    expect(moveElements(s, ['button_0'], 5, 5).elements[0].x).toBe(0);
  });

  it('대상을 지우면 동작은 남아 깨진 연결로 표시된다', () => {
    const p = projectWith('card', 'region');
    const ix: Interaction = {
      id: 'ix_1', sourceId: 'card_0', trigger: 'drag_drop', targetId: 'region_1', action: 'create_item',
      effect: '블록 생성', errorState: '원위치', acceptance: '유지됨',
    };
    let s = addInteraction(p.screens[0], ix);
    s = deleteElements(s, ['region_1']);
    expect(s.interactions).toHaveLength(1);
    const issues = checkSpec({ ...p, screens: [s] });
    expect(issues.some((i) => i.code === 'interaction.target' && i.level === 'error')).toBe(true);
    expect(hasBlockingIssues(issues)).toBe(true);
    // 시작 요소를 지우면 동작도 지워진다
    expect(deleteElements(s, ['card_0']).interactions).toHaveLength(0);
  });

  it('복제는 새 id 를 매기고 안쪽 동작을 새 id 로 옮긴다', () => {
    const p = projectWith('button', 'region');
    let s = addInteraction(p.screens[0], {
      id: 'ix_1', sourceId: 'button_0', trigger: 'click', targetId: 'region_1', action: 'open_panel',
      effect: '열림', acceptance: '보임',
    });
    const r = duplicateElements(s, ['button_0', 'region_1']);
    s = r.screen;
    expect(s.elements).toHaveLength(4);
    expect(r.newIds).toHaveLength(2);
    const copyIx = s.interactions.find((i) => i.id !== 'ix_1')!;
    expect(r.newIds).toContain(copyIx.sourceId);
    expect(r.newIds).toContain(copyIx.targetId);
  });

  it('묶기와 풀기, 앞으로 가져오기, 정렬', () => {
    const p = projectWith('button', 'text', 'card');
    let s = p.screens[0];
    const g = groupElements(s, ['button_0', 'text_1']);
    s = g.screen;
    expect(s.elements.filter((e) => e.parentId === g.groupId)).toHaveLength(2);
    s = bringToFront(s, [g.groupId!]);
    const order = sortedElements(s).map((e) => e.id);
    expect(order[0]).toBe('card_2');
    const u = ungroup(s, g.groupId!);
    expect(u.screen.elements.some((e) => e.type === 'group')).toBe(false);
    expect(u.childIds.sort()).toEqual(['button_0', 'text_1']);
    s = alignElements(u.screen, ['button_0', 'card_2'], 'left');
    expect(s.elements.find((e) => e.id === 'card_2')!.x).toBe(0);
  });

  it('묶음 크기를 바꾸면 자식이 같은 비율로 바뀐다', () => {
    const p = createProject('t');
    const preset = createPreset('task_list', 0, 0);
    let s = addElements(p.screens[0], preset);
    const g = preset[0];
    s = resizeElement(s, g.id, { x: 0, y: 0, width: g.width * 2, height: g.height });
    const frame = s.elements.find((e) => e.id === preset[1].id)!;
    expect(frame.width).toBe(preset[1].width * 2);
  });

  it('화면 복제는 요소 id 를 모두 새로 매기고 상태 대상도 옮긴다', () => {
    let p = projectWith('list');
    p = mapScreen(p, p.screens[0].id, (s) => ({ ...s, states: [{ id: 'st_1', kind: 'empty', targetId: 'list_0', description: '할 일이 없습니다' }] }));
    const r = duplicateScreen(p, p.screens[0].id, '빈 상태');
    const copy = r.project.screens[1];
    expect(copy.name).toBe('빈 상태');
    expect(copy.elements[0].id).not.toBe('list_0');
    expect(copy.states[0].targetId).toBe(copy.elements[0].id);
  });
});

describe('가져오기 검사', () => {
  it('정상 JSON 을 그대로 읽는다 (왕복)', () => {
    const p = projectWith('button', 'list');
    const s = { ...p.screens[0], strokes: [{ id: 'stk_1', color: '#222', width: 2, points: [[1, 2, 0.5], [3, 4]] as [number, number, number?][] }] };
    const src = { ...p, screens: [s] } as Project;
    const r = parseProject(JSON.parse(JSON.stringify(src)));
    expect(r.errors).toEqual([]);
    expect(stableStringify(r.project)).toBe(stableStringify(src));
  });

  it('기획서 예시 JSON 을 읽는다', () => {
    const r = parseProject({ schemaVersion: 1, id: 'ahnda-planner', title: 'AHNDA', revision: 3, screens: [{ id: 'main', name: '일정과 할 일', width: 1440, height: 900, elements: [{ id: 'calendar', type: 'region', x: 220, y: 80, width: 1180, height: 420, zIndex: 1, semanticRole: 'calendar', notes: '일 주 월 전환', props: {} }], interactions: [], notes: [], states: [] }], assets: [], updatedAt: '2026-10-27T00:00:00Z' });
    expect(r.ok).toBe(true);
    expect(r.project!.screens[0].strokes).toEqual([]);
  });

  it('새 버전·잘못된 참조·좌표 범위·경로 탈출을 막는다', () => {
    const p = projectWith('button');
    expect(parseProject({ ...p, schemaVersion: 99 }).ok).toBe(false);
    const bad = JSON.parse(JSON.stringify(p));
    bad.screens[0].elements[0].x = 1e9;
    expect(parseProject(bad).ok).toBe(false);
    const bad2 = JSON.parse(JSON.stringify(p));
    bad2.screens[0].interactions.push({ id: 'ix', sourceId: 'nope', trigger: 'click', action: 'custom', effect: '', acceptance: '' });
    expect(parseProject(bad2).errors.join()).toContain('시작 요소');
    const bad3 = JSON.parse(JSON.stringify(p));
    bad3.assets.push({ id: 'a1', relativePath: '../../etc/passwd', mimeType: 'image/png', sha256: 'a'.repeat(64), width: 1, height: 1 });
    expect(parseProject(bad3).ok).toBe(false);
    const bad4 = JSON.parse(JSON.stringify(p));
    bad4.screens[0].elements[0].parentId = bad4.screens[0].elements[0].id;
    expect(parseProject(bad4).ok).toBe(false);
    expect(isSafeRelativePath('assets/a.png')).toBe(true);
    expect(isSafeRelativePath('../a.png')).toBe(false);
    expect(isSafeRelativePath('/abs.png')).toBe(false);
    expect(isSafeRelativePath('a\\b.png')).toBe(false);
  });

  it('HTML·스크립트 문구는 글자 그대로 보존한다', () => {
    const p = projectWith('text');
    p.screens[0].elements[0].text = '<script>alert(1)</script>';
    const r = parseProject(JSON.parse(JSON.stringify(p)));
    expect(r.project!.screens[0].elements[0].text).toBe('<script>alert(1)</script>');
  });
});

describe('명세 검사', () => {
  it('빈 예외는 경고, 대상 없는 화면 이동은 차단', () => {
    const p = projectWith('button');
    const s = addInteraction(p.screens[0], { id: 'ix', sourceId: 'button_0', trigger: 'click', action: 'navigate', effect: '이동', acceptance: '' });
    const issues = checkSpec({ ...p, screens: [s] });
    expect(issues.find((i) => i.code === 'interaction.target')?.level).toBe('error');
    expect(issues.find((i) => i.code === 'interaction.error')?.level).toBe('warning');
    expect(issues.find((i) => i.code === 'interaction.acceptance')?.level).toBe('warning');
  });

  it('목록에 빈 상태가 없으면 경고', () => {
    const p = projectWith('list');
    expect(checkSpec(p).some((i) => i.code === 'state.empty')).toBe(true);
  });
});
