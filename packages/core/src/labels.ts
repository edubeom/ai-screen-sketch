// 화면과 요청문에 쓰는 한국어 이름표. NAMES.md 와 같은 말을 쓴다.
import type { ActionKind, ElementType, NoteKind, ShapeKind, StateKind, Trigger } from './types.ts';

export const ELEMENT_LABELS: Record<ElementType, string> = {
  region: '영역',
  text: '텍스트',
  button: '버튼',
  input: '입력창',
  list: '목록',
  card: '카드',
  image: '이미지',
  note: '메모',
  connector: '연결선',
  shape: '모형',
  group: '묶음',
};

export const SHAPE_LABELS: Record<ShapeKind, string> = {
  rect: '네모',
  ellipse: '원',
  star: '별',
  triangle: '세모',
  diamond: '마름모',
};

export const TRIGGER_LABELS: Record<Trigger, string> = {
  click: '클릭',
  double_click: '더블클릭',
  input: '입력',
  change: '선택 변경',
  drag_drop: '드래그 앤 드롭',
};

export const ACTION_LABELS: Record<ActionKind, string> = {
  navigate: '화면 이동',
  open_panel: '패널 열기',
  expand_list: '목록 펼치기',
  set_value: '값 변경',
  create_item: '항목 생성',
  delete_item: '항목 삭제',
  external_link: '외부 링크',
  custom: '사용자 정의 설명',
};

export const STATE_LABELS: Record<StateKind, string> = {
  normal: '정상',
  empty: '빈 화면',
  loading: '불러오는 중',
  error: '오류',
  disabled: '비활성',
};

export const NOTE_LABELS: Record<NoteKind, string> = {
  general: '메모',
  responsive: '반응형',
  undecided: '미정',
};

/** 비어 있는 명세 칸은 AI 가 임의로 채우지 않도록 "미정"으로 내보낸다 */
export const UNDECIDED = '미정';
