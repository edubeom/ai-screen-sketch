// 두 가지 검사:
// 1) parseProject -- 가져오는 JSON 의 스키마·참조·좌표 범위 검사 (기획서 6장 "개발 안전 조건")
// 2) checkSpec   -- 하단 검증 결과·내보내기 차단에 쓰는 명세 검사 (미연결 동작, 누락 상태, 빈 예외)
import {
  ACTIONS,
  ELEMENT_TYPES,
  NOTE_KINDS_LIST,
  SCHEMA_VERSION,
  SHAPE_KINDS,
  STATE_KINDS,
  TRIGGERS,
  type ActionKind,
  type Asset,
  type Interaction,
  type Project,
  type Screen,
  type ScreenNote,
  type ScreenState,
  type SketchElement,
  type Stroke,
} from './types.ts';
import { ACTION_LABELS } from './labels.ts';

export const LIMITS = {
  coord: 100_000,
  screenSize: 20_000,
  screens: 200,
  elementsPerScreen: 5_000,
  strokesPerScreen: 5_000,
  pointsPerStroke: 20_000,
  text: 20_000,
  assets: 500,
};

export interface ParseResult {
  ok: boolean;
  project?: Project;
  errors: string[];
  /** 이전 schemaVersion 에서 옮겼으면 그 버전 */
  migratedFrom?: number;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const ID_RE = /^[A-Za-z0-9_.:-]{1,80}$/;
/** 색: #rgb·#rrggbb(aa) 또는 none·transparent 같은 이름 */
export const COLOR_RE = /^#[0-9a-fA-F]{3,8}$|^[a-z]{3,20}$/;

class Reader {
  errors: string[] = [];
  private path: string;
  constructor(path: string) {
    this.path = path;
  }
  at(sub: string | number): Reader {
    const r = new Reader(`${this.path}${typeof sub === 'number' ? `[${sub}]` : `.${sub}`}`);
    r.errors = this.errors;
    return r;
  }
  fail(msg: string) {
    if (this.errors.length < 50) this.errors.push(`${this.path}: ${msg}`);
  }
  str(o: Obj, key: string, opts: { optional?: boolean; max?: number } = {}): string | undefined {
    const v = o[key];
    if (v === undefined || v === null) {
      if (!opts.optional) this.at(key).fail('필수 문자열이 없습니다');
      return undefined;
    }
    if (typeof v !== 'string') {
      this.at(key).fail('문자열이어야 합니다');
      return undefined;
    }
    if (v.length > (opts.max ?? LIMITS.text)) {
      this.at(key).fail('너무 깁니다');
      return undefined;
    }
    return v;
  }
  id(o: Obj, key: string, optional = false): string | undefined {
    const v = this.str(o, key, { optional, max: 80 });
    if (v !== undefined && !ID_RE.test(v)) {
      this.at(key).fail('id 형식이 아닙니다 (영문·숫자·_.:- 80자 이내)');
      return undefined;
    }
    return v;
  }
  num(o: Obj, key: string, min: number, max: number, optional = false): number | undefined {
    const v = o[key];
    if (v === undefined || v === null) {
      if (!optional) this.at(key).fail('필수 숫자가 없습니다');
      return undefined;
    }
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      this.at(key).fail('숫자여야 합니다');
      return undefined;
    }
    if (v < min || v > max) {
      this.at(key).fail(`범위(${min}~${max})를 벗어났습니다`);
      return undefined;
    }
    return v;
  }
  arr(o: Obj, key: string, max: number, optional = false): unknown[] {
    const v = o[key];
    if (v === undefined && optional) return [];
    if (!Array.isArray(v)) {
      this.at(key).fail('배열이어야 합니다');
      return [];
    }
    if (v.length > max) {
      this.at(key).fail(`항목이 너무 많습니다 (최대 ${max})`);
      return [];
    }
    return v;
  }
  oneOf<T extends string>(o: Obj, key: string, allowed: readonly T[], optional = false): T | undefined {
    const v = this.str(o, key, { optional, max: 40 });
    if (v === undefined) return undefined;
    if (!(allowed as readonly string[]).includes(v)) {
      this.at(key).fail(`허용되지 않은 값 "${v}"`);
      return undefined;
    }
    return v as T;
  }
}

function readElement(r: Reader, raw: unknown): SketchElement | undefined {
  if (!isObj(raw)) {
    r.fail('객체여야 합니다');
    return undefined;
  }
  const C = LIMITS.coord;
  const id = r.id(raw, 'id');
  const type = r.oneOf(raw, 'type', ELEMENT_TYPES);
  const x = r.num(raw, 'x', -C, C);
  const y = r.num(raw, 'y', -C, C);
  const width = r.num(raw, 'width', 0, C);
  const height = r.num(raw, 'height', 0, C);
  const zIndex = r.num(raw, 'zIndex', -C, C);
  const parentId = r.id(raw, 'parentId', true);
  const text = r.str(raw, 'text', { optional: true });
  const name = r.str(raw, 'name', { optional: true, max: 200 });
  const semanticRole = r.str(raw, 'semanticRole', { max: 200 });
  const notes = r.str(raw, 'notes');
  const propsRaw = raw.props;
  if (!isObj(propsRaw)) r.at('props').fail('객체여야 합니다');
  const props: Obj = {};
  if (isObj(propsRaw)) {
    const pr = r.at('props');
    const sk = pr.oneOf(propsRaw, 'shapeKind', SHAPE_KINDS, true);
    if (sk) props.shapeKind = sk;
    for (const k of ['fill', 'stroke'] as const) {
      const v = pr.str(propsRaw, k, { optional: true, max: 40 });
      if (v !== undefined && !COLOR_RE.test(v)) pr.at(k).fail('색 형식이 아닙니다');
    }
    for (const k of ['layoutIntent', 'placeholder', 'dataBinding', 'fill', 'stroke'] as const) {
      const v = pr.str(propsRaw, k, { optional: true, max: 2000 });
      if (v !== undefined) props[k] = v;
    }
    const assetId = pr.id(propsRaw, 'assetId', true);
    if (assetId) props.assetId = assetId;
    const ck = pr.oneOf(propsRaw, 'connectorKind', ['navigation', 'dataflow', 'plain'] as const, true);
    if (ck) props.connectorKind = ck;
    if (typeof propsRaw.locked === 'boolean') props.locked = propsRaw.locked;
    if (typeof propsRaw.flip === 'boolean') props.flip = propsRaw.flip;
    if (typeof propsRaw.reverse === 'boolean') props.reverse = propsRaw.reverse;
  }
  if (!id || !type || x === undefined || y === undefined || width === undefined || height === undefined || zIndex === undefined || semanticRole === undefined || notes === undefined) return undefined;
  const el: SketchElement = { id, type, name: name ?? id, x, y, width, height, zIndex, props, semanticRole, notes };
  if (parentId) el.parentId = parentId;
  if (text !== undefined) el.text = text;
  return el;
}

function readInteraction(r: Reader, raw: unknown): Interaction | undefined {
  if (!isObj(raw)) {
    r.fail('객체여야 합니다');
    return undefined;
  }
  const id = r.id(raw, 'id');
  const sourceId = r.id(raw, 'sourceId');
  const trigger = r.oneOf(raw, 'trigger', TRIGGERS);
  const action = r.oneOf<ActionKind>(raw, 'action', ACTIONS);
  const effect = r.str(raw, 'effect');
  const acceptance = r.str(raw, 'acceptance');
  if (!id || !sourceId || !trigger || !action || effect === undefined || acceptance === undefined) return undefined;
  const ix: Interaction = { id, sourceId, trigger, action, effect, acceptance };
  const targetId = r.id(raw, 'targetId', true);
  const targetScreenId = r.id(raw, 'targetScreenId', true);
  if (targetId) ix.targetId = targetId;
  if (targetScreenId) ix.targetScreenId = targetScreenId;
  for (const k of ['condition', 'dataChange', 'errorState', 'memo'] as const) {
    const v = r.str(raw, k, { optional: true });
    if (v !== undefined) ix[k] = v;
  }
  return ix;
}

function readStroke(r: Reader, raw: unknown): Stroke | undefined {
  if (!isObj(raw)) {
    r.fail('객체여야 합니다');
    return undefined;
  }
  const id = r.id(raw, 'id');
  const color = r.str(raw, 'color', { max: 40 });
  const width = r.num(raw, 'width', 0.1, 200);
  const pts = r.arr(raw, 'points', LIMITS.pointsPerStroke);
  const points: Stroke['points'] = [];
  const C = LIMITS.coord;
  for (const p of pts) {
    // [x, y, pressure?] 배열과 {x, y, pressure?} 객체 둘 다 받는다
    const [x, y, pressure] = Array.isArray(p) ? p : isObj(p) ? [p.x, p.y, p.pressure] : [];
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > C || Math.abs(y) > C) {
      r.at('points').fail('점 좌표가 올바르지 않습니다');
      return undefined;
    }
    points.push(typeof pressure === 'number' && pressure >= 0 && pressure <= 1 ? [x, y, pressure] : [x, y]);
  }
  if (!id || !color || width === undefined) return undefined;
  if (!COLOR_RE.test(color)) {
    r.at('color').fail('색 형식이 아닙니다');
    return undefined;
  }
  return { id, color, width, points };
}

function readScreen(r: Reader, raw: unknown): Screen | undefined {
  if (!isObj(raw)) {
    r.fail('객체여야 합니다');
    return undefined;
  }
  const id = r.id(raw, 'id');
  const name = r.str(raw, 'name', { max: 200 });
  const width = r.num(raw, 'width', 1, LIMITS.screenSize);
  const height = r.num(raw, 'height', 1, LIMITS.screenSize);
  const elements = r
    .arr(raw, 'elements', LIMITS.elementsPerScreen)
    .map((e, i) => readElement(r.at('elements').at(i), e))
    .filter((e): e is SketchElement => !!e);
  const interactions = r
    .arr(raw, 'interactions', LIMITS.elementsPerScreen)
    .map((e, i) => readInteraction(r.at('interactions').at(i), e))
    .filter((e): e is Interaction => !!e);
  const notes: ScreenNote[] = [];
  r.arr(raw, 'notes', 1000).forEach((n, i) => {
    const nr = r.at('notes').at(i);
    // 이전 형식(문자열 배열)도 받는다
    if (typeof n === 'string') {
      notes.push({ id: `note_${i}`, kind: 'general', text: n.slice(0, LIMITS.text) });
      return;
    }
    if (!isObj(n)) return nr.fail('객체여야 합니다');
    const nid = nr.id(n, 'id');
    const kind = nr.oneOf(n, 'kind', NOTE_KINDS_LIST);
    const text = nr.str(n, 'text');
    if (nid && kind && text !== undefined) notes.push({ id: nid, kind, text });
  });
  const states: ScreenState[] = [];
  r.arr(raw, 'states', 1000).forEach((s, i) => {
    const sr = r.at('states').at(i);
    if (!isObj(s)) return sr.fail('객체여야 합니다');
    const sid = sr.id(s, 'id');
    const kind = sr.oneOf(s, 'kind', STATE_KINDS);
    const description = sr.str(s, 'description');
    const targetId = sr.id(s, 'targetId', true);
    const screenRef = sr.id(s, 'screenRef', true);
    if (!sid || !kind || description === undefined) return;
    const st: ScreenState = { id: sid, kind, description };
    if (targetId) st.targetId = targetId;
    if (screenRef) st.screenRef = screenRef;
    states.push(st);
  });
  const strokes = r
    .arr(raw, 'strokes', LIMITS.strokesPerScreen, true)
    .map((e, i) => readStroke(r.at('strokes').at(i), e))
    .filter((e): e is Stroke => !!e);
  const background = r.str(raw, 'background', { optional: true, max: 40 });
  if (background !== undefined && !COLOR_RE.test(background)) r.at('background').fail('색 형식이 아닙니다');
  if (!id || name === undefined || width === undefined || height === undefined) return undefined;
  const screen: Screen = { id, name, width, height, elements, interactions, notes, states, strokes };
  if (background !== undefined && COLOR_RE.test(background)) screen.background = background;
  return screen;
}

function readAsset(r: Reader, raw: unknown): Asset | undefined {
  if (!isObj(raw)) {
    r.fail('객체여야 합니다');
    return undefined;
  }
  const id = r.id(raw, 'id');
  const relativePath = r.str(raw, 'relativePath', { max: 200 });
  const mimeType = r.oneOf(raw, 'mimeType', ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const);
  const sha256 = r.str(raw, 'sha256', { max: 64 });
  const width = r.num(raw, 'width', 0, LIMITS.screenSize);
  const height = r.num(raw, 'height', 0, LIMITS.screenSize);
  if (relativePath !== undefined && !isSafeRelativePath(relativePath)) r.at('relativePath').fail('안전하지 않은 경로입니다');
  if (sha256 !== undefined && !/^[0-9a-f]{64}$/.test(sha256)) r.at('sha256').fail('sha256 형식이 아닙니다');
  if (!id || !relativePath || !mimeType || !sha256 || width === undefined || height === undefined) return undefined;
  if (!isSafeRelativePath(relativePath) || !/^[0-9a-f]{64}$/.test(sha256)) return undefined;
  return { id, relativePath, mimeType, sha256, width, height };
}

/** ZIP 경로 탈출 막기: 상대 경로이고 .. 나 절대 경로·역슬래시가 없어야 한다 */
export function isSafeRelativePath(p: string): boolean {
  if (!p || p.length > 300) return false;
  if (p.startsWith('/') || p.includes('\\') || /^[A-Za-z]:/.test(p)) return false;
  if (p.includes('\0')) return false;
  return p.split('/').every((seg) => seg !== '..' && seg !== '.' && seg !== '');
}

/** 이전 버전 JSON 을 지금 버전으로 옮긴다. 옮길 수 없으면 오류 */
function migrate(raw: Obj, errors: string[]): { data?: Obj; from?: number } {
  const v = raw.schemaVersion;
  if (typeof v !== 'number') {
    errors.push('schemaVersion 이 없습니다 -- 이 도구가 만든 project.json 이 아닙니다');
    return {};
  }
  if (v > SCHEMA_VERSION) {
    errors.push(`schemaVersion ${v} 은(는) 이 도구(${SCHEMA_VERSION})보다 새 버전입니다 -- 도구를 업데이트해 주세요`);
    return {};
  }
  if (v < 1) {
    errors.push(`schemaVersion ${v} 은(는) 옮길 수 없는 버전입니다`);
    return {};
  }
  return { data: raw, from: v === SCHEMA_VERSION ? undefined : v };
}

/** 가져오는 JSON(이미 파싱된 값)을 검사해 Project 로 만든다 */
export function parseProject(input: unknown): ParseResult {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ['JSON 최상위가 객체가 아닙니다'] };
  const { data, from } = migrate(input, errors);
  if (!data) return { ok: false, errors };
  const r = new Reader('project');
  r.errors = errors;
  const id = r.id(data, 'id');
  const title = r.str(data, 'title', { max: 200 });
  const revision = r.num(data, 'revision', 0, Number.MAX_SAFE_INTEGER);
  const updatedAt = r.str(data, 'updatedAt', { max: 40 });
  if (updatedAt !== undefined && Number.isNaN(Date.parse(updatedAt))) r.at('updatedAt').fail('날짜 형식이 아닙니다');
  const screens = r
    .arr(data, 'screens', LIMITS.screens)
    .map((s, i) => readScreen(r.at('screens').at(i), s))
    .filter((s): s is Screen => !!s);
  const assets = r
    .arr(data, 'assets', LIMITS.assets)
    .map((a, i) => readAsset(r.at('assets').at(i), a))
    .filter((a): a is Asset => !!a);
  if (!screens.length && !errors.length) errors.push('화면이 하나도 없습니다');

  // 참조 검사
  const screenIds = new Set<string>();
  const allElementIds = new Set<string>();
  for (const s of screens) {
    if (screenIds.has(s.id)) errors.push(`화면 id 중복: ${s.id}`);
    screenIds.add(s.id);
    const ids = new Set<string>();
    for (const e of s.elements) {
      if (ids.has(e.id)) errors.push(`화면 ${s.id}: 요소 id 중복 ${e.id}`);
      ids.add(e.id);
      allElementIds.add(e.id);
    }
    for (const e of s.elements) {
      if (e.parentId && !ids.has(e.parentId)) errors.push(`화면 ${s.id}: 요소 ${e.id} 의 parentId(${e.parentId})가 없습니다`);
      if (e.parentId === e.id) errors.push(`화면 ${s.id}: 요소 ${e.id} 가 자기 자신을 묶음으로 가리킵니다`);
      if (e.props.assetId && !assets.some((a) => a.id === e.props.assetId)) errors.push(`화면 ${s.id}: 요소 ${e.id} 의 자산(${e.props.assetId})이 없습니다`);
    }
    // 묶음 순환 막기
    const byId = new Map(s.elements.map((e) => [e.id, e]));
    for (const e of s.elements) {
      const seen = new Set<string>();
      let cur: SketchElement | undefined = e;
      while (cur?.parentId) {
        if (seen.has(cur.id)) {
          errors.push(`화면 ${s.id}: 묶음이 순환합니다 (${e.id})`);
          break;
        }
        seen.add(cur.id);
        cur = byId.get(cur.parentId);
      }
    }
    const ixIds = new Set<string>();
    for (const i of s.interactions) {
      if (ixIds.has(i.id)) errors.push(`화면 ${s.id}: 동작 id 중복 ${i.id}`);
      ixIds.add(i.id);
      if (!ids.has(i.sourceId)) errors.push(`화면 ${s.id}: 동작 ${i.id} 의 시작 요소(${i.sourceId})가 없습니다`);
      // targetId·targetScreenId 가 없는 것은 "깨진 연결"로 허용하고 checkSpec 이 알린다
    }
  }
  const assetIds = new Set<string>();
  for (const a of assets) {
    if (assetIds.has(a.id)) errors.push(`자산 id 중복: ${a.id}`);
    assetIds.add(a.id);
  }
  if (errors.length || !id || title === undefined || revision === undefined || updatedAt === undefined) {
    return { ok: false, errors: errors.length ? errors : ['프로젝트 필수 필드가 없습니다'] };
  }
  return {
    ok: true,
    errors: [],
    migratedFrom: from,
    project: { schemaVersion: SCHEMA_VERSION, id, title, revision, screens, assets, updatedAt },
  };
}

// ---------------------------------------------------------------------------
// 명세 검사

export type IssueLevel = 'error' | 'warning' | 'info';

export interface SpecIssue {
  level: IssueLevel;
  code: string;
  message: string;
  screenId: string;
  elementId?: string;
  interactionId?: string;
}

/** 대상 요소가 꼭 있어야 하는 동작 */
const NEEDS_TARGET: ActionKind[] = ['open_panel', 'expand_list', 'set_value'];

export function interactionTargetProblem(project: Project, screen: Screen, ix: Interaction): string | undefined {
  const has = (id?: string) => !!id && screen.elements.some((e) => e.id === id);
  if (ix.targetId && !has(ix.targetId)) return `대상 요소(${ix.targetId})가 지워졌습니다 -- 깨진 연결`;
  if (ix.targetScreenId && !project.screens.some((s) => s.id === ix.targetScreenId)) return `이동할 화면(${ix.targetScreenId})이 지워졌습니다 -- 깨진 연결`;
  if (ix.action === 'navigate' && !ix.targetScreenId) return '화면 이동에는 이동할 화면이 필요합니다';
  if (ix.trigger === 'drag_drop' && !ix.targetId) return '드래그 앤 드롭에는 놓을 대상 요소가 필요합니다';
  if (NEEDS_TARGET.includes(ix.action) && !ix.targetId) return `${ACTION_LABELS[ix.action]}에는 대상 요소가 필요합니다`;
  return undefined;
}

export function checkSpec(project: Project): SpecIssue[] {
  const issues: SpecIssue[] = [];
  for (const s of project.screens) {
    const name = (id: string) => s.elements.find((e) => e.id === id)?.name ?? id;
    for (const ix of s.interactions) {
      const base = { screenId: s.id, elementId: ix.sourceId, interactionId: ix.id };
      const problem = interactionTargetProblem(project, s, ix);
      if (problem) issues.push({ ...base, level: 'error', code: 'interaction.target', message: `${name(ix.sourceId)}: ${problem}` });
      if (!ix.effect.trim()) issues.push({ ...base, level: 'warning', code: 'interaction.effect', message: `${name(ix.sourceId)}: 동작 결과가 비어 있습니다 (미정으로 내보냄)` });
      if (!ix.errorState?.trim()) issues.push({ ...base, level: 'warning', code: 'interaction.error', message: `${name(ix.sourceId)}: 예외·실패 상태가 비어 있습니다 (미정으로 내보냄)` });
      if (!ix.acceptance.trim()) issues.push({ ...base, level: 'warning', code: 'interaction.acceptance', message: `${name(ix.sourceId)}: 검증 기준이 비어 있습니다 (미정으로 내보냄)` });
      if (ix.action === 'external_link' && !ix.memo?.trim()) issues.push({ ...base, level: 'warning', code: 'interaction.link', message: `${name(ix.sourceId)}: 외부 링크 주소가 비어 있습니다` });
    }
    for (const e of s.elements) {
      const base = { screenId: s.id, elementId: e.id };
      if (e.type === 'button' && !s.interactions.some((i) => i.sourceId === e.id)) {
        issues.push({ ...base, level: 'info', code: 'element.unlinked', message: `${e.name}: 버튼에 연결된 동작이 없습니다` });
      }
      if (e.type === 'list' && !s.states.some((st) => st.kind === 'empty' && (st.targetId === e.id || st.targetId === e.parentId))) {
        issues.push({ ...base, level: 'warning', code: 'state.empty', message: `${e.name}: 목록의 빈 상태가 지정되지 않았습니다` });
      }
      if (e.type === 'image' && (!e.props.assetId || !project.assets.some((a) => a.id === e.props.assetId))) {
        issues.push({ ...base, level: 'warning', code: 'image.asset', message: `${e.name}: 이미지 파일이 없습니다` });
      }
    }
    for (const st of s.states) {
      if (st.targetId && !s.elements.some((e) => e.id === st.targetId)) {
        issues.push({ screenId: s.id, level: 'warning', code: 'state.target', message: `상태 "${st.description || st.kind}" 의 대상 요소가 없습니다` });
      }
    }
  }
  return issues;
}

export function hasBlockingIssues(issues: SpecIssue[]): boolean {
  return issues.some((i) => i.level === 'error');
}
