// 설계 정본(project.json)의 데이터 계약 -- 기획서 4장 "내보내기와 데이터 계약".
// 좌표는 모두 확대율과 무관한 화면 좌표(px)다.

export const SCHEMA_VERSION = 1;

export type ElementType =
  | 'region'
  | 'text'
  | 'button'
  | 'input'
  | 'list'
  | 'card'
  | 'image'
  | 'note'
  | 'connector'
  | 'group';

export const ELEMENT_TYPES: ElementType[] = [
  'region', 'text', 'button', 'input', 'list', 'card', 'image', 'note', 'connector', 'group',
];

export interface ElementProps {
  /** 정렬·배치 의도. 예: "캘린더는 위, 작업 목록은 아래" */
  layoutIntent?: string;
  /** image 요소가 가리키는 자산 */
  assetId?: string;
  /** connector: 화면 이동(navigation) / 데이터 흐름(dataflow) / 단순 선(plain) */
  connectorKind?: 'navigation' | 'dataflow' | 'plain';
  /** connector: 선이 왼쪽 아래→오른쪽 위 대각선이면 true (상자 x,y,width,height 기준) */
  flip?: boolean;
  /** connector: 화살표가 시작점(왼쪽) 쪽에 있으면 true */
  reverse?: boolean;
  /** 입력창 예시 값 등 */
  placeholder?: string;
  /** 업무 데이터 정본(data/model.light.json 등)의 표·칸 참조. 실제 DB 를 바꾸지 않는다 */
  dataBinding?: string;
  locked?: boolean;
  /** 색 지정(선택). 없으면 요소 종류 기본색 */
  fill?: string;
}

export interface SketchElement {
  id: string;
  type: ElementType;
  /** 사람이 읽는 이름. 바꿔도 id 는 유지된다 */
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  parentId?: string;
  text?: string;
  props: ElementProps;
  semanticRole: string;
  notes: string;
}

export type Trigger = 'click' | 'double_click' | 'input' | 'change' | 'drag_drop';
export const TRIGGERS: Trigger[] = ['click', 'double_click', 'input', 'change', 'drag_drop'];

export type ActionKind =
  | 'navigate'
  | 'open_panel'
  | 'expand_list'
  | 'set_value'
  | 'create_item'
  | 'delete_item'
  | 'external_link'
  | 'custom';
export const ACTIONS: ActionKind[] = [
  'navigate', 'open_panel', 'expand_list', 'set_value', 'create_item', 'delete_item', 'external_link', 'custom',
];

export interface Interaction {
  id: string;
  sourceId: string;
  trigger: Trigger;
  targetId?: string;
  targetScreenId?: string;
  condition?: string;
  action: ActionKind;
  /** 결과: 사용자가 보게 되는 일 */
  effect: string;
  /** 데이터 변경 (예: task 유지, schedule_block 생성) */
  dataChange?: string;
  /** 예외·실패 상태 */
  errorState?: string;
  /** 검증 기준 */
  acceptance: string;
  /** external_link 의 주소, API 호출 등 요구사항 메모 (실행하지 않는다) */
  memo?: string;
}

export type StateKind = 'normal' | 'empty' | 'loading' | 'error' | 'disabled';
export const STATE_KINDS: StateKind[] = ['normal', 'empty', 'loading', 'error', 'disabled'];

export interface ScreenState {
  id: string;
  kind: StateKind;
  /** 요소에 붙이면 요소 id, 화면 전체면 없음 */
  targetId?: string;
  description: string;
  /** 상세 표현을 위해 복제한 상태 화면 */
  screenRef?: string;
}

export type NoteKind = 'general' | 'responsive' | 'undecided';
export const NOTE_KINDS_LIST: NoteKind[] = ['general', 'responsive', 'undecided'];
export interface ScreenNote {
  id: string;
  kind: NoteKind;
  text: string;
}

/** [x, y, pressure?] -- 화면 좌표. 필압은 0~1, 지원하지 않는 기기에서는 없음 */
export type StrokePoint = [number, number] | [number, number, number];

export interface Stroke {
  id: string;
  points: StrokePoint[];
  color: string;
  width: number;
}

export interface Screen {
  id: string;
  name: string;
  width: number;
  height: number;
  elements: SketchElement[];
  interactions: Interaction[];
  notes: ScreenNote[];
  states: ScreenState[];
  strokes: Stroke[];
}

export interface Asset {
  id: string;
  relativePath: string;
  mimeType: string;
  sha256: string;
  width: number;
  height: number;
}

export interface Project {
  schemaVersion: number;
  id: string;
  title: string;
  revision: number;
  screens: Screen[];
  assets: Asset[];
  updatedAt: string;
}

export interface ManifestEntry {
  path: string;
  size: number;
  sha256: string;
}

export interface Manifest {
  schemaVersion: number;
  projectId: string;
  revision: number;
  profile: string;
  generatedAt: string;
  files: ManifestEntry[];
}

export const SCREEN_PRESETS = [
  { key: 'desktop', label: '데스크톱', width: 1440, height: 900 },
  { key: 'tablet', label: '태블릿', width: 1024, height: 768 },
  { key: 'mobile', label: '모바일', width: 390, height: 844 },
] as const;
