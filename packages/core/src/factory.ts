// 프로젝트·화면·요소를 새로 만드는 함수와 묶음 프리셋(캘린더·작업 목록).
import {
  SCHEMA_VERSION,
  type ElementType,
  type Project,
  type Screen,
  type SketchElement,
} from './types.ts';
import { ELEMENT_LABELS } from './labels.ts';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** 짧고 읽기 쉬운 id. 이름·순서를 바꿔도 유지된다 */
export function newId(prefix: string): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
  return `${prefix}_${s}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function createProject(title: string, id?: string): Project {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: id ?? newId('prj'),
    title,
    revision: 0,
    screens: [createScreen('화면 1', 1440, 900)],
    assets: [],
    updatedAt: nowIso(),
  };
}

export function createScreen(name: string, width: number, height: number): Screen {
  return {
    id: newId('scr'),
    name,
    width,
    height,
    elements: [],
    interactions: [],
    notes: [],
    states: [],
    strokes: [],
  };
}

const DEFAULT_SIZE: Record<ElementType, [number, number]> = {
  region: [320, 200],
  text: [200, 32],
  button: [120, 40],
  input: [240, 40],
  list: [320, 240],
  card: [280, 72],
  image: [200, 150],
  note: [200, 120],
  connector: [160, 0],
  group: [200, 200],
};

const DEFAULT_TEXT: Partial<Record<ElementType, string>> = {
  text: '텍스트',
  button: '버튼',
  input: '',
  card: '카드 제목',
  note: '메모를 적으세요',
};

export function createElement(
  type: ElementType,
  x: number,
  y: number,
  patch: Partial<SketchElement> = {},
): SketchElement {
  const [width, height] = DEFAULT_SIZE[type];
  const el: SketchElement = {
    id: newId(type),
    type,
    name: ELEMENT_LABELS[type],
    x: Math.round(x),
    y: Math.round(y),
    width,
    height,
    zIndex: 0,
    props: {},
    semanticRole: '',
    notes: '',
    ...patch,
  };
  if (el.text === undefined && DEFAULT_TEXT[type] !== undefined) el.text = DEFAULT_TEXT[type];
  if (type === 'input' && el.props.placeholder === undefined) el.props = { ...el.props, placeholder: '예시 값' };
  if (type === 'connector' && !el.props.connectorKind) el.props = { ...el.props, connectorKind: 'plain' };
  return el;
}

export type PresetKey = 'calendar' | 'task_list' | 'detail_panel';

export const PRESETS: { key: PresetKey; label: string }[] = [
  { key: 'calendar', label: '캘린더' },
  { key: 'task_list', label: '작업 목록' },
  { key: 'detail_panel', label: '상세 패널' },
];

/**
 * 일반 요소의 묶음 프리셋. 업무 로직은 넣지 않고, 묶음을 풀어 고칠 수 있다.
 * 첫 요소가 묶음(group)이고 나머지는 parentId 로 묶음을 가리킨다.
 */
export function createPreset(key: PresetKey, x: number, y: number): SketchElement[] {
  const ox = Math.round(x);
  const oy = Math.round(y);
  if (key === 'calendar') {
    const w = 700;
    const h = 420;
    const group = createElement('group', ox, oy, { name: '캘린더', width: w, height: h, semanticRole: 'calendar' });
    const kids: SketchElement[] = [
      createElement('region', ox, oy, { name: '캘린더 틀', width: w, height: h }),
      createElement('text', ox + 16, oy + 12, { name: '캘린더 제목', text: '2026년 11월', width: 200 }),
      createElement('button', ox + w - 196, oy + 10, { name: '일 보기', text: '일', width: 56, height: 32 }),
      createElement('button', ox + w - 132, oy + 10, { name: '주 보기', text: '주', width: 56, height: 32 }),
      createElement('button', ox + w - 68, oy + 10, { name: '월 보기', text: '월', width: 56, height: 32 }),
      createElement('region', ox + 16, oy + 56, {
        name: '시간 칸',
        width: w - 32,
        height: h - 72,
        semanticRole: 'calendar_time_grid',
        text: '시간 칸 (작업을 끌어 놓는 곳)',
      }),
    ];
    for (const k of kids) k.parentId = group.id;
    return [group, ...kids];
  }
  if (key === 'task_list') {
    const w = 320;
    const h = 300;
    const group = createElement('group', ox, oy, { name: '작업 목록', width: w, height: h, semanticRole: 'task_list' });
    const kids: SketchElement[] = [
      createElement('list', ox, oy, { name: '작업 목록 틀', width: w, height: h }),
      createElement('text', ox + 16, oy + 12, { name: '작업 목록 제목', text: '할 일', width: 160 }),
      createElement('card', ox + 16, oy + 56, { name: '작업 카드 1', text: '예시 작업 1', width: w - 32, semanticRole: 'task_card' }),
      createElement('card', ox + 16, oy + 136, { name: '작업 카드 2', text: '예시 작업 2', width: w - 32, semanticRole: 'task_card' }),
      createElement('button', ox + 16, oy + h - 52, { name: '작업 추가', text: '+ 작업 추가', width: w - 32 }),
    ];
    for (const k of kids) k.parentId = group.id;
    return [group, ...kids];
  }
  const w = 320;
  const h = 400;
  const group = createElement('group', ox, oy, { name: '상세 패널', width: w, height: h, semanticRole: 'detail_panel' });
  const kids: SketchElement[] = [
    createElement('region', ox, oy, { name: '상세 패널 틀', width: w, height: h }),
    createElement('text', ox + 16, oy + 12, { name: '상세 제목', text: '작업 상세', width: 200 }),
    createElement('input', ox + 16, oy + 56, { name: '제목 입력', width: w - 32 }),
    createElement('input', ox + 16, oy + 108, { name: '마감일 입력', width: w - 32, props: { placeholder: '2026-11-30' } }),
    createElement('button', ox + 16, oy + h - 56, { name: '저장', text: '저장', width: w - 32 }),
  ];
  for (const k of kids) k.parentId = group.id;
  return [group, ...kids];
}
