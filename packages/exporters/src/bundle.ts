// 설계 묶음(ZIP) 만들기와 가져오기.
// ZIP 안: project.json · screens/*.png · assets/* · requirements.md · validation-report.json · manifest.json (+ profile 별 exports/<profile>/*)
import JSZip from 'jszip';
import {
  checkSpec,
  hasBlockingIssues,
  isSafeRelativePath,
  parseProject,
  sha256Hex,
  stableStringify,
  type Manifest,
  type Project,
  type SpecIssue,
} from '@sketch/core';
import { buildRequirements } from './requirements.ts';

export interface BundleFile {
  path: string;
  data: Uint8Array | string;
}

/** 각 개발 흐름(standalone · dev-light · dev-framework)의 전달물을 만드는 어댑터 */
export interface Adapter {
  profile: 'standalone' | 'dev-light' | 'dev-framework';
  label: string;
  adapterVersion: string;
  files(project: Project, ctx: AdapterContext): Promise<BundleFile[]>;
}

export interface AdapterContext {
  digest: string;
  issues: SpecIssue[];
  generatedAt: string;
  pngPaths: Record<string, string>;
  /** 사용자가 고른 호스트 컨텍스트 (없으면 null) */
  hostProjectId?: string | null;
  hostTaskId?: string | null;
}

export interface ExportInput {
  project: Project;
  adapter: Adapter;
  /** 화면 id → PNG 바이트 (브라우저에서 그려 넘긴다. 없으면 PNG 없이) */
  pngs?: Record<string, Uint8Array>;
  /** 자산 id → 바이트 */
  assets?: Record<string, Uint8Array>;
  generatedAt?: string;
  hostProjectId?: string | null;
  hostTaskId?: string | null;
}

export interface ExportResult {
  zip: Uint8Array;
  manifest: Manifest;
  issues: SpecIssue[];
  digest: string;
  fileName: string;
}

export class ExportBlockedError extends Error {
  issues: SpecIssue[];
  constructor(issues: SpecIssue[]) {
    super(`내보낼 수 없습니다: ${issues.filter((i) => i.level === 'error').map((i) => i.message).join(' / ')}`);
    this.issues = issues;
  }
}

const enc = new TextEncoder();
const bytesOf = (d: Uint8Array | string) => (typeof d === 'string' ? enc.encode(d) : d);

/** 설계 내용 해시 (revision·저장 시각은 빼고 내용만) */
export async function designDigest(project: Project): Promise<string> {
  const { revision: _r, updatedAt: _u, ...content } = project;
  return sha256Hex(stableStringify(content, 0));
}

export function screenPngPath(project: Project, screenId: string): string {
  const i = project.screens.findIndex((s) => s.id === screenId);
  return `screens/${String(i + 1).padStart(2, '0')}-${screenId}.png`;
}

export function safeFileName(s: string): string {
  return s.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'sketch';
}

export async function exportBundle(input: ExportInput): Promise<ExportResult> {
  const { project, adapter } = input;
  const issues = checkSpec(project);
  if (hasBlockingIssues(issues)) throw new ExportBlockedError(issues);
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const digest = await designDigest(project);
  const pngPaths: Record<string, string> = {};
  for (const s of project.screens) if (input.pngs?.[s.id]) pngPaths[s.id] = screenPngPath(project, s.id);

  const files: BundleFile[] = [];
  files.push({ path: 'project.json', data: JSON.stringify(project, null, 2) });
  for (const s of project.screens) if (input.pngs?.[s.id]) files.push({ path: pngPaths[s.id], data: input.pngs[s.id] });
  for (const a of project.assets) {
    const data = input.assets?.[a.id];
    if (data) files.push({ path: a.relativePath, data });
  }
  files.push({ path: 'requirements.md', data: buildRequirements(project, { pngPaths, profile: adapter.profile }) });
  files.push({
    path: 'validation-report.json',
    data: JSON.stringify({ designId: project.id, revision: project.revision, digest, generatedAt, blocking: false, issues }, null, 2),
  });
  const ctx: AdapterContext = { digest, issues, generatedAt, pngPaths, hostProjectId: input.hostProjectId ?? null, hostTaskId: input.hostTaskId ?? null };
  files.push(...(await adapter.files(project, ctx)));

  const zip = new JSZip();
  const entries = [];
  for (const f of files) {
    if (!isSafeRelativePath(f.path)) throw new Error(`안전하지 않은 경로: ${f.path}`);
    const b = bytesOf(f.data);
    zip.file(f.path, b, { date: new Date(generatedAt) });
    entries.push({ path: f.path, size: b.byteLength, sha256: await sha256Hex(b) });
  }
  const manifest: Manifest = {
    schemaVersion: project.schemaVersion,
    projectId: project.id,
    revision: project.revision,
    profile: adapter.profile,
    generatedAt,
    files: entries,
  };
  zip.file('manifest.json', JSON.stringify({ ...manifest, digest, adapterVersion: adapter.adapterVersion }, null, 2), { date: new Date(generatedAt) });
  const out = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { zip: out, manifest, issues, digest, fileName: `${safeFileName(project.title)}-r${project.revision}-${adapter.profile}.zip` };
}

// ---------------------------------------------------------------------------
// 가져오기

export const IMPORT_LIMITS = {
  files: 1000,
  totalBytes: 200 * 1024 * 1024,
  fileBytes: 50 * 1024 * 1024,
  jsonBytes: 20 * 1024 * 1024,
};

export interface ImportedAsset {
  id: string;
  mimeType: string;
  data: Uint8Array;
}

export interface ImportResult {
  ok: boolean;
  project?: Project;
  assets: ImportedAsset[];
  errors: string[];
  warnings: string[];
}

export async function importJsonText(text: string): Promise<ImportResult> {
  if (text.length > IMPORT_LIMITS.jsonBytes) return { ok: false, assets: [], errors: ['JSON 이 너무 큽니다'], warnings: [] };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { ok: false, assets: [], errors: [`JSON 을 읽을 수 없습니다: ${(e as Error).message}`], warnings: [] };
  }
  const r = parseProject(raw);
  const warnings: string[] = [];
  if (r.migratedFrom) warnings.push(`schemaVersion ${r.migratedFrom} 에서 옮겼습니다`);
  if (r.ok && r.project!.assets.length) warnings.push('JSON 만 가져와 이미지 파일은 없습니다 -- 이미지까지 옮기려면 ZIP 을 가져오세요');
  return { ok: r.ok, project: r.project, assets: [], errors: r.errors, warnings };
}

/** ZIP 가져오기: 파일 수·크기 제한, 경로 탈출 차단, manifest·자산 해시 확인 */
export async function importBundle(data: Uint8Array | ArrayBuffer): Promise<ImportResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch (e) {
    return { ok: false, assets: [], errors: [`ZIP 을 열 수 없습니다: ${(e as Error).message}`], warnings };
  }
  const all = Object.values(zip.files);
  const entries = all.filter((f) => !f.dir);
  if (entries.length > IMPORT_LIMITS.files) return { ok: false, assets: [], errors: [`파일이 너무 많습니다 (${entries.length}개)`], warnings };
  for (const f of all) {
    // JSZip 은 ../ 를 조용히 정리하므로 원래 이름(unsafeOriginalName)으로 검사한다
    const original = (f as unknown as { unsafeOriginalName?: string }).unsafeOriginalName ?? f.name;
    const path = f.dir ? original.replace(/\/$/, '') : original;
    if (!isSafeRelativePath(path)) return { ok: false, assets: [], errors: [`안전하지 않은 경로가 있습니다: ${original}`], warnings };
  }
  // 압축 해제 크기 확인 (JSZip 내부 값 -- 없으면 읽으면서 센다)
  let total = 0;
  const read = async (name: string): Promise<Uint8Array | undefined> => {
    const f = zip.file(name);
    if (!f) return undefined;
    const declared = (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize;
    if (declared !== undefined && declared > IMPORT_LIMITS.fileBytes) throw new Error(`${name} 이(가) 너무 큽니다`);
    const b = await f.async('uint8array');
    total += b.byteLength;
    if (b.byteLength > IMPORT_LIMITS.fileBytes) throw new Error(`${name} 이(가) 너무 큽니다`);
    if (total > IMPORT_LIMITS.totalBytes) throw new Error('ZIP 전체 크기가 너무 큽니다');
    return b;
  };
  try {
    const pj = await read('project.json');
    if (!pj) return { ok: false, assets: [], errors: ['ZIP 에 project.json 이 없습니다'], warnings };
    const res = await importJsonText(new TextDecoder().decode(pj));
    if (!res.ok || !res.project) return res;
    warnings.push(...res.warnings.filter((w) => !w.startsWith('JSON 만')));
    const project = res.project;

    const mf = await read('manifest.json');
    if (!mf) warnings.push('manifest.json 이 없어 파일 해시를 확인하지 못했습니다');
    else {
      try {
        const m = JSON.parse(new TextDecoder().decode(mf)) as Manifest;
        if (m.revision !== project.revision) warnings.push(`manifest revision(${m.revision})과 project.json revision(${project.revision})이 다릅니다`);
        for (const e of m.files ?? []) {
          if (typeof e?.path !== 'string' || !isSafeRelativePath(e.path)) continue;
          const b = await read(e.path);
          if (!b) warnings.push(`manifest 의 ${e.path} 가 ZIP 에 없습니다`);
          else if ((await sha256Hex(b)) !== e.sha256) warnings.push(`${e.path} 의 해시가 manifest 와 다릅니다 (파일이 바뀌었을 수 있음)`);
        }
      } catch {
        warnings.push('manifest.json 을 읽을 수 없습니다');
      }
    }

    const assets: ImportedAsset[] = [];
    for (const a of project.assets) {
      const b = await read(a.relativePath);
      if (!b) {
        warnings.push(`이미지 ${a.relativePath} 가 ZIP 에 없습니다`);
        continue;
      }
      if ((await sha256Hex(b)) !== a.sha256) {
        errors.push(`이미지 ${a.relativePath} 의 해시가 project.json 과 다릅니다`);
        continue;
      }
      assets.push({ id: a.id, mimeType: a.mimeType, data: b });
    }
    if (errors.length) return { ok: false, assets: [], errors, warnings };
    return { ok: true, project, assets, errors, warnings };
  } catch (e) {
    return { ok: false, assets: [], errors: [(e as Error).message], warnings };
  }
}
