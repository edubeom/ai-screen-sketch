import { describe, expect, it } from 'vitest';
import { IDBFactory } from 'fake-indexeddb';
import { createProject } from '@sketch/core';
import { SketchStore } from '@sketch/storage';

describe('브라우저 저장소', () => {
  it('저장·열기·목록·마지막 프로젝트·자산·지우기', async () => {
    const store = new SketchStore(new IDBFactory());
    const a = { ...createProject('A'), revision: 1, updatedAt: '2026-11-01T00:00:00.000Z' };
    const b = { ...createProject('B'), revision: 4, updatedAt: '2026-11-02T00:00:00.000Z' };
    await store.saveProject(a);
    await store.saveProject(b);
    expect((await store.listProjects()).map((p) => p.title)).toEqual(['B', 'A']);
    expect(await store.lastProjectId()).toBe(b.id);
    expect((await store.loadProject(a.id))?.title).toBe('A');
    await store.putAsset(a.id, 'asset_1', new Blob(['png']), 'image/png');
    expect((await store.listAssets(a.id)).map((x) => x.assetId)).toEqual(['asset_1']);
    await store.setLastProjectId(a.id);
    await store.deleteProject(a.id);
    expect(await store.hasProject(a.id)).toBe(false);
    expect(await store.listAssets(a.id)).toEqual([]);
    expect(await store.lastProjectId()).toBeUndefined();
  });
});
