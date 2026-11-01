// 내보내기·가져오기 (브라우저 쪽). 내보내기는 먼저 저장해 "저장된 같은 revision" 으로 JSON·PNG 를 만든다.
import { newId, type Project } from '@sketch/core';
import {
  exportBundle,
  importBundle,
  importJsonText,
  renderScreenSvg,
  safeFileName,
  type Adapter,
  type ImportResult,
} from '@sketch/exporters';
import { standaloneAdapter } from '@sketch/adapter-standalone';
import { devLightAdapter } from '@sketch/adapter-dev-light';
import { devFrameworkAdapter } from '@sketch/adapter-dev-framework';
import { adoptProject, saveNow, savedProject, store } from './persistence.ts';
import { getState } from './store.ts';

export const ADAPTERS: Adapter[] = [standaloneAdapter, devLightAdapter, devFrameworkAdapter];

export interface PngOptions {
  includeStrokes: boolean;
  includeNotes: boolean;
}

function blobToDataUrl(b: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(b);
  });
}

async function assetBlobs(project: Project): Promise<Record<string, Blob>> {
  const out: Record<string, Blob> = {};
  for (const a of await store.listAssets(project.id)) out[a.assetId] = a.blob;
  return out;
}

export async function renderPng(svg: string, width: number, height: number): Promise<Uint8Array> {
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'sync';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('화면 그림을 만들지 못했습니다'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    if (!blob) throw new Error('PNG 를 만들지 못했습니다');
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function download(data: Uint8Array | string, fileName: string, mime: string) {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export async function exportZip(adapter: Adapter, png: PngOptions, host?: { hostProjectId?: string; hostTaskId?: string }) {
  if (!(await saveNow())) throw new Error('저장하지 못해 내보낼 수 없습니다 -- 저장 상태를 확인하세요');
  const project = savedProject();
  const blobs = await assetBlobs(project);
  const hrefs: Record<string, string> = {};
  const assets: Record<string, Uint8Array> = {};
  for (const [id, b] of Object.entries(blobs)) {
    hrefs[id] = await blobToDataUrl(b);
    assets[id] = new Uint8Array(await b.arrayBuffer());
  }
  const pngs: Record<string, Uint8Array> = {};
  for (const s of project.screens) {
    pngs[s.id] = await renderPng(renderScreenSvg(s, { ...png, assetHrefs: hrefs }), s.width, s.height);
  }
  const res = await exportBundle({ project, adapter, pngs, assets, hostProjectId: host?.hostProjectId || null, hostTaskId: host?.hostTaskId || null });
  download(res.zip, res.fileName, 'application/zip');
  return res;
}

export async function exportJson() {
  if (!(await saveNow())) throw new Error('저장하지 못해 내보낼 수 없습니다');
  const project = savedProject();
  download(JSON.stringify(project, null, 2), `${safeFileName(project.title)}-r${project.revision}.json`, 'application/json');
}

export async function readImportFile(file: File): Promise<ImportResult> {
  if (file.name.toLowerCase().endsWith('.json') || file.type === 'application/json') return importJsonText(await file.text());
  return importBundle(new Uint8Array(await file.arrayBuffer()));
}

/**
 * 가져온 프로젝트를 저장하고 연다. 기본은 새 프로젝트(같은 id 가 있으면 새 id),
 * overwrite 이면 같은 id 의 프로젝트를 덮어쓴다 (명시적으로 고른 경우만).
 */
export async function applyImport(res: ImportResult, mode: 'new' | 'overwrite') {
  if (!res.ok || !res.project) throw new Error(res.errors.join(' / '));
  let project = res.project;
  if (mode === 'new' && (await store.hasProject(project.id))) {
    project = { ...project, id: newId('prj'), title: `${project.title} (가져옴)` };
  }
  await adoptProject(
    project,
    res.assets.map((a) => ({ id: a.id, mimeType: a.mimeType, blob: new Blob([a.data as BlobPart], { type: a.mimeType }) })),
  );
  return project;
}

export function currentProjectId() {
  return getState().project.id;
}
