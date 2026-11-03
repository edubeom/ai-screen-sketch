// 이미지 가져오기: 그림만 넣기 · 모양 찾기(토큰 0) · AI 분석(시험에서는 가짜 AI)
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import type { Project } from '@sketch/core';

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(page.getByTestId('save-status')).toContainText('저장됨');
}

async function project(page: Page): Promise<Project & { _screenId: string }> {
  return page.evaluate(() => {
    const s = (window as unknown as { __sketch: { getState: () => { project: Project; screenId: string } } }).__sketch.getState();
    return JSON.parse(JSON.stringify({ ...s.project, _screenId: s.screenId }));
  });
}

/** 브라우저에서 와이어프레임 그림(PNG)을 그려 파일로 */
async function wireframePng(page: Page): Promise<Buffer> {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 800;
    c.height = 520;
    const g = c.getContext('2d')!;
    g.fillStyle = '#fff';
    g.fillRect(0, 0, 800, 520);
    g.strokeStyle = '#1e293b';
    g.lineWidth = 3;
    g.strokeRect(28, 22, 738, 476);
    g.strokeRect(100, 78, 590, 123);
    g.strokeRect(334, 120, 60, 46);
    g.beginPath();
    g.ellipse(234, 300, 56, 20, 0, 0, Math.PI * 2);
    g.stroke();
    g.fillStyle = '#2563eb';
    g.fillRect(500, 380, 140, 44); // 칠한 버튼
    g.fillStyle = '#1e293b';
    g.font = 'bold 20px sans-serif';
    g.fillText('Login Title', 130, 110);
    return c.toDataURL('image/png');
  });
  return Buffer.from(dataUrl.split(',')[1], 'base64');
}

async function openImageImport(page: Page, png: Buffer) {
  await page.getByRole('button', { name: '가져오기' }).click();
  await page.getByTestId('import-file').setInputFiles({ name: 'wireframe.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByTestId('image-import')).toBeVisible();
  // 미리보기 그림이 실제로 그려졌는지
  await expect.poll(() => page.getByTestId('image-preview').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
}

test('모양 찾기(토큰 0): 새 화면에 모형·칠한 상자·글 자리와 잠근 원본 그림', async ({ page }) => {
  await ready(page);
  const png = await wireframePng(page);
  await openImageImport(page, png);
  await expect(page.getByTestId('image-summary')).toContainText('모형 4');
  await expect(page.getByTestId('image-summary')).toContainText('칠한 상자 1');
  await expect(page.getByTestId('image-summary')).toContainText('글 자리 1');
  await page.getByTestId('image-import-go').click();
  await expect(page.getByTestId('toast')).toContainText('요소 6개');
  const p = await project(page);
  expect(p.screens).toHaveLength(2);
  const sc = p.screens.find((s) => s.id === p._screenId)!;
  expect(sc.width).toBe(800);
  const bg = sc.elements.find((e) => e.type === 'image')!;
  expect(bg.props.locked).toBe(true);
  expect(sc.elements[0].id).toBe(bg.id); // 맨 뒤
  const kinds = sc.elements.filter((e) => e.type === 'shape').map((e) => e.props.shapeKind).sort();
  expect(kinds).toEqual(['ellipse', 'rect', 'rect', 'rect', 'rect']);
  expect(sc.elements.some((e) => e.type === 'text' && e.text === '(글)')).toBe(true);
  expect(p.assets).toHaveLength(1);
});

test('그림만 넣기: 원본 그림 하나 (잠그지 않음)', async ({ page }) => {
  await ready(page);
  await openImageImport(page, await wireframePng(page));
  await page.getByTestId('image-mode-image').check();
  await page.getByTestId('image-import-go').click();
  await expect(page.getByTestId('toast')).toContainText('그림을 가져왔습니다');
  const p = await project(page);
  const sc = p.screens.find((s) => s.id === p._screenId)!;
  expect(sc.elements).toHaveLength(1);
  expect(sc.elements[0].type).toBe('image');
  expect(sc.elements[0].props.locked).toBe(false);
});

test('AI 분석: 토큰이 틀리면 거절, 맞으면 종류·글이 붙고 같은 그림은 캐시', async ({ page }) => {
  await ready(page);
  const png = await wireframePng(page);
  await openImageImport(page, png);
  await expect(page.getByTestId('image-mode-ai')).toBeEnabled();
  await page.getByTestId('image-mode-ai').check();
  await expect(page.getByTestId('image-summary')).toContainText('모형');
  await page.getByTestId('ai-token').fill('wrong');
  await page.getByTestId('image-import-go').click();
  await expect(page.getByTestId('image-import')).toContainText('토큰이 맞지 않습니다');
  const token = readFileSync(`${homedir()}/.config/ai-screen-sketch/ai-token`, 'utf8').trim();
  await page.getByTestId('ai-token').fill(token);
  await page.getByTestId('image-import-go').click();
  await expect(page.getByTestId('toast')).toContainText('그림을 가져왔습니다');
  const p = await project(page);
  const sc = p.screens.find((s) => s.id === p._screenId)!;
  expect(sc.elements.some((e) => e.type === 'button' && e.text === '버튼')).toBe(true); // 칠한 상자 → 버튼 (가짜 AI)
  expect(sc.elements.some((e) => e.type === 'text' && !!e.text?.startsWith('글 '))).toBe(true);
  expect(sc.elements.filter((e) => e.type === 'region').length).toBeGreaterThanOrEqual(4);
  // 토큰은 이 브라우저에 기억 -- 다시 열면 채워져 있다
  await openImageImport(page, png);
  await page.getByTestId('image-mode-ai').check();
  await expect(page.getByTestId('ai-token')).toHaveValue(token);
});
