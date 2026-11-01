// 브라우저 IndexedDB 저장소. 저장 이름은 dev-notes/NAMES.md 에 적혀 있다 -- 바꾸면 쓰던 프로젝트가 안 보인다.
// 한 번의 저장은 한 트랜잭션이라, 실패(저장 공간 부족 등)해도 마지막 성공 저장이 그대로 남는다.
import type { Project } from '@sketch/core';

export const DB_NAME = 'ai-screen-sketch';
const DB_VERSION = 1;
const PROJECTS = 'projects';
const ASSETS = 'assets';
const META = 'meta';

export interface ProjectSummary {
  id: string;
  title: string;
  revision: number;
  updatedAt: string;
  screenCount: number;
}

interface ProjectRecord extends ProjectSummary {
  data: Project;
}

export interface StoredAsset {
  /** `${projectId}/${assetId}` */
  key: string;
  projectId: string;
  assetId: string;
  mimeType: string;
  blob: Blob;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('저장이 취소되었습니다'));
  });
}

export class SketchStore {
  private dbp?: Promise<IDBDatabase>;
  private factory: IDBFactory;
  private name: string;

  constructor(factory: IDBFactory = globalThis.indexedDB, name = DB_NAME) {
    this.factory = factory;
    this.name = name;
  }

  private db(): Promise<IDBDatabase> {
    if (!this.dbp) {
      this.dbp = new Promise((resolve, reject) => {
        if (!this.factory) return reject(new Error('이 브라우저는 IndexedDB 를 쓸 수 없습니다'));
        const open = this.factory.open(this.name, DB_VERSION);
        open.onupgradeneeded = () => {
          const db = open.result;
          if (!db.objectStoreNames.contains(PROJECTS)) db.createObjectStore(PROJECTS, { keyPath: 'id' });
          if (!db.objectStoreNames.contains(ASSETS)) db.createObjectStore(ASSETS, { keyPath: 'key' }).createIndex('projectId', 'projectId');
          if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
        };
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
        open.onblocked = () => reject(new Error('다른 탭이 저장소를 쓰고 있습니다'));
      });
      this.dbp.catch(() => (this.dbp = undefined));
    }
    return this.dbp;
  }

  async saveProject(project: Project): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([PROJECTS, META], 'readwrite');
    const rec: ProjectRecord = {
      id: project.id,
      title: project.title,
      revision: project.revision,
      updatedAt: project.updatedAt,
      screenCount: project.screens.length,
      data: project,
    };
    tx.objectStore(PROJECTS).put(rec);
    tx.objectStore(META).put(project.id, 'lastProjectId');
    await done(tx);
  }

  async loadProject(id: string): Promise<Project | undefined> {
    const db = await this.db();
    const rec = await req<ProjectRecord | undefined>(db.transaction(PROJECTS).objectStore(PROJECTS).get(id));
    return rec?.data;
  }

  async listProjects(): Promise<ProjectSummary[]> {
    const db = await this.db();
    const recs = await req<ProjectRecord[]>(db.transaction(PROJECTS).objectStore(PROJECTS).getAll());
    return recs
      .map(({ id, title, revision, updatedAt, screenCount }) => ({ id, title, revision, updatedAt, screenCount }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async hasProject(id: string): Promise<boolean> {
    const db = await this.db();
    const key = await req(db.transaction(PROJECTS).objectStore(PROJECTS).getKey(id));
    return key !== undefined;
  }

  async deleteProject(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction([PROJECTS, ASSETS, META], 'readwrite');
    tx.objectStore(PROJECTS).delete(id);
    const idx = tx.objectStore(ASSETS).index('projectId');
    const keys = await req(idx.getAllKeys(id));
    for (const k of keys) tx.objectStore(ASSETS).delete(k);
    const last = await req(tx.objectStore(META).get('lastProjectId'));
    if (last === id) tx.objectStore(META).delete('lastProjectId');
    await done(tx);
  }

  async lastProjectId(): Promise<string | undefined> {
    const db = await this.db();
    return (await req(db.transaction(META).objectStore(META).get('lastProjectId'))) as string | undefined;
  }

  async setLastProjectId(id: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(META, 'readwrite');
    tx.objectStore(META).put(id, 'lastProjectId');
    await done(tx);
  }

  async putAsset(projectId: string, assetId: string, blob: Blob, mimeType: string): Promise<void> {
    const db = await this.db();
    const tx = db.transaction(ASSETS, 'readwrite');
    const rec: StoredAsset = { key: `${projectId}/${assetId}`, projectId, assetId, mimeType, blob };
    tx.objectStore(ASSETS).put(rec);
    await done(tx);
  }

  async getAsset(projectId: string, assetId: string): Promise<StoredAsset | undefined> {
    const db = await this.db();
    return req<StoredAsset | undefined>(db.transaction(ASSETS).objectStore(ASSETS).get(`${projectId}/${assetId}`));
  }

  async listAssets(projectId: string): Promise<StoredAsset[]> {
    const db = await this.db();
    return req<StoredAsset[]>(db.transaction(ASSETS).objectStore(ASSETS).index('projectId').getAll(projectId));
  }

  /** 대략적인 사용량 (브라우저가 알려 줄 때만) */
  async estimate(): Promise<{ usage?: number; quota?: number }> {
    try {
      return (await navigator.storage?.estimate?.()) ?? {};
    } catch {
      return {};
    }
  }
}
