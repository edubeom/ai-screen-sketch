// 자동 저장과 프로젝트 열기. 연속 이동·필기는 잠시 모았다가 한 번에 저장한다.
import { createProject, nowIso, type Project } from '@sketch/core';
import { SketchStore } from '@sketch/storage';
import { getState, loadProject, setState, subscribe, toast } from './store.ts';

export const store = new SketchStore();

const SAVE_DELAY = 700;
let timer: ReturnType<typeof setTimeout> | undefined;
let saving: Promise<void> | undefined;

/** 저장할 때 쓰는 프로젝트 -- 히스토리와 분리된 revision·시각을 붙인다 */
export function projectForSave(revision: number, updatedAt: string): Project {
  return { ...getState().project, revision, updatedAt };
}

/** 마지막으로 저장된 상태의 프로젝트 (내보내기 기준) */
export function savedProject(): Project {
  const s = getState();
  return { ...s.project, revision: s.savedRevision, updatedAt: s.lastSavedAt ?? s.project.updatedAt };
}

export async function saveNow(): Promise<boolean> {
  clearTimeout(timer);
  timer = undefined;
  if (saving) await saving;
  const s = getState();
  if (!s.dirty && s.saveStatus === 'saved') return true;
  const snapshot = s.project;
  const revision = s.savedRevision + 1;
  const updatedAt = nowIso();
  setState({ saveStatus: 'saving' });
  let ok = false;
  saving = store
    .saveProject({ ...snapshot, revision, updatedAt })
    .then(() => {
      ok = true;
      setState((st) => ({
        savedRevision: revision,
        lastSavedAt: updatedAt,
        saveStatus: 'saved',
        saveError: undefined,
        // 저장하는 동안 또 바뀌었으면 다시 저장해야 한다
        dirty: st.project !== snapshot,
      }));
    })
    .catch((e: unknown) => {
      const err = e as Error;
      const quota = err?.name === 'QuotaExceededError';
      setState({
        saveStatus: 'failed',
        saveError: quota ? '저장 공간이 부족합니다 -- 파일로 내보내 두세요' : `저장 실패: ${err?.message ?? e}`,
      });
    })
    .finally(() => {
      saving = undefined;
    });
  await saving;
  if (ok && getState().dirty) schedule();
  return ok;
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(() => void saveNow(), SAVE_DELAY);
}

let lastProject: Project | undefined;

export function startAutosave() {
  lastProject = getState().project;
  subscribe(() => {
    const s = getState();
    if (s.project !== lastProject) {
      lastProject = s.project;
      if (s.dirty) schedule();
    }
  });
  window.addEventListener('beforeunload', (e) => {
    const s = getState();
    if (s.dirty || s.saveStatus === 'saving' || s.saveStatus === 'failed') {
      void saveNow();
      e.preventDefault();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && getState().dirty) void saveNow();
  });
}

async function assetUrlsFor(projectId: string): Promise<Record<string, string>> {
  const urls: Record<string, string> = {};
  try {
    for (const a of await store.listAssets(projectId)) urls[a.assetId] = URL.createObjectURL(a.blob);
  } catch {
    // 자산을 못 읽어도 프로젝트는 연다 (이미지 자리만 비어 보인다)
  }
  return urls;
}

export async function openProject(id: string): Promise<boolean> {
  if (getState().dirty) await saveNow();
  const p = await store.loadProject(id);
  if (!p) {
    toast('프로젝트를 찾을 수 없습니다', 'error');
    return false;
  }
  loadProject(p, await assetUrlsFor(id));
  lastProject = getState().project;
  await store.setLastProjectId(id).catch(() => undefined);
  return true;
}

export async function newProject(title: string, width: number, height: number, screenName = '화면 1') {
  if (getState().dirty) await saveNow();
  const p = createProject(title);
  p.screens[0] = { ...p.screens[0], name: screenName, width, height };
  p.revision = 1;
  loadProject(p, {});
  lastProject = getState().project;
  setState({ dirty: true });
  await saveNow();
}

/** 다른 곳에서 만든 프로젝트(가져오기·예시)를 저장하고 연다 */
export async function adoptProject(p: Project, assets: { id: string; blob: Blob; mimeType: string }[]) {
  if (getState().dirty) await saveNow();
  for (const a of assets) await store.putAsset(p.id, a.id, a.blob, a.mimeType);
  await store.saveProject(p);
  return openProject(p.id);
}

export async function boot() {
  try {
    const last = await store.lastProjectId();
    if (last && (await openProject(last))) return;
    const list = await store.listProjects();
    if (list.length && (await openProject(list[0].id))) return;
    await newProject('새 프로젝트', 1440, 900);
  } catch (e) {
    setState({ saveStatus: 'failed', saveError: `브라우저 저장소를 열 수 없습니다: ${(e as Error).message} -- 파일로 내보내 보관하세요` });
  }
}
