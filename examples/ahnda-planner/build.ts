// AHNDA "할 일 및 일정" 인수 사례 (기획서 1·6장) -- project.json 을 다시 만든다.
// 실행: node examples/ahnda-planner/build.ts   (Node 22.18+ 는 TypeScript 를 바로 실행)
import { writeFileSync } from 'node:fs';
import { createElement as el, parseProject, type Interaction, type Project, type SketchElement } from '../../packages/core/src/index.ts';

const g = (id: string, name: string, kids: SketchElement[], patch: Partial<SketchElement> = {}): SketchElement[] => {
  const x = Math.min(...kids.map((k) => k.x));
  const y = Math.min(...kids.map((k) => k.y));
  const r = Math.max(...kids.map((k) => k.x + k.width));
  const b = Math.max(...kids.map((k) => k.y + k.height));
  return [el('group', x, y, { id, name, width: r - x, height: b - y, ...patch }), ...kids.map((k) => ({ ...k, parentId: id }))];
};

// ---- 화면 1: 데스크톱 ----
const desktop: SketchElement[] = [
  el('text', 24, 16, { id: 'page_title', name: '페이지 제목', text: 'AHNDA 할 일 및 일정', width: 420, height: 36, semanticRole: 'page_title' }),
  ...g('calendar', '캘린더', [
    el('region', 24, 64, { id: 'calendar_frame', name: '캘린더 틀', width: 1040, height: 460, text: ' ' }),
    el('text', 40, 76, { id: 'calendar_title', name: '캘린더 제목', text: '2026년 11월 2주', width: 240 }),
    el('button', 868, 74, { id: 'view_day', name: '일 보기', text: '일', width: 56, height: 32 }),
    el('button', 932, 74, { id: 'view_week', name: '주 보기', text: '주', width: 56, height: 32 }),
    el('button', 996, 74, { id: 'view_month', name: '월 보기', text: '월', width: 56, height: 32 }),
    el('region', 40, 120, { id: 'calendar_time_grid', name: '시간 칸', width: 1008, height: 388, text: '시간 칸 -- 월~일 × 09:00~18:00 (작업을 끌어 놓는 곳)', semanticRole: 'calendar_time_grid' }),
    el('card', 196, 200, { id: 'schedule_block_sample', name: '작업 블록 예시', text: '회의 준비 10:00-11:00', width: 132, height: 56, semanticRole: 'schedule_block', props: { fill: '#dbeafe' } }),
  ], { semanticRole: 'calendar', notes: '일 주 월 전환', props: { layoutIntent: '캘린더는 위, 작업 목록은 아래. 둘 사이 경계선을 끌어 높이를 조절' } }),
  el('connector', 24, 536, { id: 'split_handle', name: '경계선', width: 1040, height: 0, text: '경계선 -- 끌어서 높이 조절', props: { connectorKind: 'plain' }, semanticRole: 'split_handle' }),
  ...g('task_list', '작업 목록', [
    el('list', 24, 548, { id: 'task_list_frame', name: '작업 목록 틀', width: 1040, height: 328, text: ' ' }),
    el('text', 40, 560, { id: 'task_list_title', name: '작업 목록 제목', text: '할 일', width: 120 }),
    el('button', 912, 556, { id: 'add_task', name: '작업 추가', text: '+ 작업 추가', width: 136, height: 36 }),
    el('card', 40, 608, { id: 'task_card_01', name: '작업 카드 1', text: '기획서 검토 · 마감 11/5', width: 1008, height: 64, semanticRole: 'task_card' }),
    el('card', 40, 684, { id: 'task_card_02', name: '작업 카드 2', text: '디자인 초안 · 선행: 기획서 검토 · 마감 11/7', width: 1008, height: 64, semanticRole: 'task_card' }),
    el('card', 40, 760, { id: 'task_card_03', name: '작업 카드 3 (완료)', text: '✓ 회의실 예약 (완료)', width: 1008, height: 64, semanticRole: 'task_card', props: { fill: '#f1f5f9' } }),
  ], { semanticRole: 'task_list' }),
  ...g('detail_panel', '상세 패널', [
    el('region', 1088, 64, { id: 'detail_frame', name: '상세 패널 틀', width: 328, height: 812, text: ' ' }),
    el('text', 1104, 76, { id: 'detail_title', name: '상세 제목', text: '작업 상세', width: 200 }),
    el('input', 1104, 124, { id: 'detail_task_title', name: '제목 입력', text: '기획서 검토', width: 296, props: { placeholder: '작업 제목', dataBinding: 'task.title' } }),
    el('input', 1104, 176, { id: 'detail_due', name: '마감일 입력', text: '2026-11-05', width: 296, props: { placeholder: 'YYYY-MM-DD', dataBinding: 'task.due_date' } }),
    el('input', 1104, 228, { id: 'detail_prereq', name: '선행 작업 선택', width: 296, props: { placeholder: '선행 작업 (선택)', dataBinding: 'task.prerequisite_id' } }),
    el('button', 1104, 820, { id: 'detail_save', name: '저장', text: '저장', width: 296, height: 40 }),
  ], { semanticRole: 'detail_panel', props: { layoutIntent: '오른쪽 고정 폭 328px, 작업을 고르면 내용이 바뀜' } }),
  el('note', 700, 16, { id: 'memo_layout', name: '배치 메모', text: '위는 달력, 아래는 할 일', width: 220, height: 40 }),
];

const ix = (i: Interaction) => i;
const desktopIx: Interaction[] = [
  ix({
    id: 'ix_drop_task', sourceId: 'task_card_01', trigger: 'drag_drop', targetId: 'calendar_time_grid', action: 'create_item',
    condition: '작업이 완료 상태가 아니고, 선행 작업이 모두 완료됨',
    effect: '놓은 날짜와 시간에 작업 블록 생성 (기본 길이 1시간)',
    dataChange: 'task 는 유지하고 schedule_block 생성 (task_id, start_at, end_at)',
    errorState: '선행 미완료: 놓기를 거부하고 "선행 작업을 먼저 끝내세요" 안내 / 시간 충돌: 겹치는 블록을 강조하고 그래도 둘지 확인 / 마감 이후 배치: 경고 표시 / 저장 실패: 카드를 원위치하고 오류 문구',
    acceptance: '새로고침 후 배치가 유지되고 작업의 마감일은 그대로다',
  }),
  ix({
    id: 'ix_drop_blocked', sourceId: 'task_card_02', trigger: 'drag_drop', targetId: 'calendar_time_grid', action: 'create_item',
    condition: '선행 작업(기획서 검토)이 미완료',
    effect: '작업 블록을 만들지 않음',
    dataChange: '변경 없음',
    errorState: '선행 미완료 안내: "기획서 검토를 먼저 끝내세요" -- 카드는 목록 자리로 돌아감',
    acceptance: '선행이 미완료인 카드를 놓으면 블록이 생기지 않고 안내가 보인다',
  }),
  ix({
    id: 'ix_open_detail', sourceId: 'task_card_01', trigger: 'click', targetId: 'detail_panel', action: 'open_panel',
    effect: '오른쪽 상세 패널에 고른 작업의 제목·마감일·선행 작업 표시',
    errorState: '작업을 불러오지 못하면 패널에 오류 상태 표시',
    acceptance: '카드를 누르면 상세 패널 내용이 그 작업으로 바뀐다',
  }),
  ix({
    id: 'ix_add_task', sourceId: 'add_task', trigger: 'click', targetId: 'task_list_frame', action: 'create_item',
    effect: '목록 맨 위에 빈 작업 카드를 추가하고 상세 패널의 제목 입력에 커서',
    dataChange: 'task 생성 (title 빈 값은 저장하지 않음)',
    errorState: '저장 실패 시 추가한 카드에 오류 표시, 다시 시도 버튼',
    acceptance: '작업 추가 후 제목을 적고 저장하면 새로고침해도 목록에 남는다',
  }),
  ix({
    id: 'ix_save_detail', sourceId: 'detail_save', trigger: 'click', targetId: 'task_card_01', action: 'set_value',
    condition: '제목이 비어 있지 않음',
    effect: '입력한 제목·마감일을 작업 카드와 캘린더 블록에 반영',
    dataChange: 'task.title, task.due_date 변경',
    errorState: '제목이 비면 저장 버튼 비활성 / 저장 실패 시 입력값 유지 + 오류 문구',
    acceptance: '저장 후 목록 카드 문구가 바뀌고 새로고침해도 유지된다',
  }),
  ix({
    id: 'ix_view_week', sourceId: 'view_week', trigger: 'click', targetId: 'calendar_time_grid', action: 'set_value',
    effect: '시간 칸을 주 보기로 전환 (일·월 버튼도 같은 방식)',
    errorState: '',
    acceptance: '주 버튼을 누르면 7일 칸이 보인다',
  }),
];

// ---- 화면 2: 모바일 ----
const mobile: SketchElement[] = [
  el('text', 16, 16, { id: 'm_title', name: '페이지 제목', text: 'AHNDA', width: 200, height: 32 }),
  el('button', 16, 64, { id: 'm_tab_calendar', name: '달력 탭', text: '달력', width: 171, height: 40 }),
  el('button', 203, 64, { id: 'm_tab_tasks', name: '할 일 탭', text: '할 일', width: 171, height: 40, props: { fill: '#cbd5e1' } }),
  ...g('m_task_list', '작업 목록 (모바일)', [
    el('list', 16, 120, { id: 'm_task_list_frame', name: '작업 목록 틀', width: 358, height: 600, text: ' ' }),
    el('card', 28, 136, { id: 'm_task_card_01', name: '작업 카드 1', text: '기획서 검토 · 마감 11/5', width: 334, height: 72, semanticRole: 'task_card' }),
    el('button', 246, 168, { id: 'm_assign_time', name: '시간 배정', text: '시간 배정', width: 104, height: 32 }),
  ], { semanticRole: 'task_list' }),
  el('note', 16, 736, { id: 'm_memo', name: '모바일 메모', text: '모바일: 목록 탭 전환, 드래그 대신 시간 배정 버튼', width: 358, height: 64 }),
];
const mobileIx: Interaction[] = [
  ix({
    id: 'ix_m_tab_calendar', sourceId: 'm_tab_calendar', trigger: 'click', targetScreenId: 'main', action: 'navigate',
    effect: '달력 탭으로 전환 (데스크톱 캘린더와 같은 내용, 한 열)',
    errorState: '',
    acceptance: '탭을 누르면 달력이 보이고 할 일 탭 선택이 풀린다',
  }),
  ix({
    id: 'ix_m_assign', sourceId: 'm_assign_time', trigger: 'click', targetId: 'm_task_card_01', action: 'open_panel',
    condition: '작업이 완료 상태가 아니고 선행 작업이 모두 완료됨',
    effect: '날짜·시간 고르기 시트를 열고, 고르면 작업 블록 생성 (데스크톱의 드롭과 같은 결과)',
    dataChange: 'schedule_block 생성',
    errorState: '선행 미완료·시간 충돌·저장 실패는 데스크톱 드롭과 같게 안내',
    acceptance: '시간을 고르면 달력 탭에 블록이 보이고 새로고침 후에도 유지된다',
  }),
];

const project: Project = {
  schemaVersion: 1,
  id: 'ahnda-planner',
  title: 'AHNDA 할 일 및 일정',
  revision: 1,
  updatedAt: '2026-11-02T00:00:00.000Z',
  assets: [],
  screens: [
    {
      id: 'main',
      name: '일정과 할 일',
      width: 1440,
      height: 900,
      elements: desktop.map((e, i) => ({ ...e, zIndex: i })),
      interactions: desktopIx,
      states: [
        { id: 'st_list_empty', kind: 'empty', targetId: 'task_list_frame', description: '"할 일이 없습니다" 문구와 작업 추가 버튼 강조' },
        { id: 'st_cal_loading', kind: 'loading', targetId: 'calendar_time_grid', description: '시간 칸에 회색 블록 자리 표시' },
        { id: 'st_list_error', kind: 'error', targetId: 'task_list_frame', description: '"목록을 불러오지 못했습니다" + 다시 시도 버튼' },
        { id: 'st_done_card', kind: 'disabled', targetId: 'task_card_03', description: '완료된 작업은 흐리게, 끌 수 없음' },
      ],
      notes: [
        { id: 'note_resp', kind: 'responsive', text: '태블릿은 상세 패널을 아래 시트로. 모바일은 목록 탭 전환, 드래그 대신 시간 배정 버튼 (화면 2)' },
        { id: 'note_undecided', kind: 'undecided', text: '주 보기 시간 칸 단위(30분/1시간)는 미정' },
      ],
      strokes: [
        { id: 'stk_arrow', color: '#7c3aed', width: 3, points: [[540, 640], [520, 600], [480, 520], [420, 420], [360, 300], [330, 262]] },
        { id: 'stk_arrow_head', color: '#7c3aed', width: 3, points: [[312, 284], [330, 262], [344, 290]] },
      ],
    },
    {
      id: 'mobile',
      name: '모바일 일정과 할 일',
      width: 390,
      height: 844,
      elements: mobile.map((e, i) => ({ ...e, zIndex: i })),
      interactions: mobileIx,
      states: [{ id: 'st_m_empty', kind: 'empty', targetId: 'm_task_list_frame', description: '"할 일이 없습니다"' }],
      notes: [],
      strokes: [],
    },
  ],
};

const check = parseProject(JSON.parse(JSON.stringify(project)));
if (!check.ok) {
  console.error(check.errors);
  process.exit(1);
}
writeFileSync(new URL('./project.json', import.meta.url), JSON.stringify(project, null, 2) + '\n');
console.log('examples/ahnda-planner/project.json 을 만들었습니다');
