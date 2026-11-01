// 최초 프로토타입 작업 카드의 완료 기준 5개를 실제 브라우저에서 확인한다 (light-check).
import { expect, test, type Page } from '@playwright/test';
import JSZip from 'jszip';
import { readFileSync } from 'node:fs';
import type { Project, SketchElement } from '@sketch/core';

const SHOTS = process.env.SHOTS;

interface Snap {
  project: Project;
  screenId: string;
  selection: string[];
  zoom: number;
  pan: { x: number; y: number };
  savedRevision: number;
  saveStatus: string;
}

async function snap(page: Page): Promise<Snap> {
  return page.evaluate(() => {
    const s = (window as unknown as { __sketch: { getState: () => Snap } }).__sketch.getState();
    return JSON.parse(JSON.stringify({ project: s.project, screenId: s.screenId, selection: s.selection, zoom: s.zoom, pan: s.pan, savedRevision: s.savedRevision, saveStatus: s.saveStatus }));
  });
}

/** 키 순서와 상관없이 비교 */
function canon(v: unknown): string {
  const norm = (x: unknown): unknown =>
    Array.isArray(x) ? x.map(norm) : x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, norm((x as Record<string, unknown>)[k])])) : x;
  return JSON.stringify(norm(v));
}

function screenOf(s: Snap) {
  return s.project.screens.find((x) => x.id === s.screenId)!;
}

async function ready(page: Page) {
  await page.goto('/');
  // 이 환경(소프트웨어 렌더링)에서는 브라우저를 띄운 뒤 첫 화면을 그리는 데 30초쯤 걸린다 -- 첫 프레임을 기다린다
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(page.getByTestId('save-status')).toContainText('저장됨');
}

async function waitSaved(page: Page) {
  await expect(page.getByTestId('save-status')).toContainText('저장됨', { timeout: 10_000 });
}

async function hitBox(page: Page, id: string) {
  const box = await page.locator(`[data-id="${id}"] .hit`).boundingBox();
  if (!box) throw new Error(`요소 ${id} 가 보이지 않습니다`);
  return box;
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 8) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

const center = (b: { x: number; y: number; width: number; height: number }) => ({ x: b.x + b.width / 2, y: b.y + b.height / 2 });

// 1x1 PNG
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('기준 1: 화면 여러 개, 모든 기본 요소·프리셋, 선택·이동·크기 조절', async ({ page }) => {
  await ready(page);
  // 화면 추가 (모바일)
  await page.locator('.left select').first().selectOption('mobile');
  await page.getByTestId('add-screen').click();
  let s = await snap(page);
  expect(s.project.screens).toHaveLength(2);
  expect(screenOf(s).width).toBe(390);
  await page.getByTestId('screen-list').getByText('화면 1').click();

  // 모든 기본 요소
  for (const t of ['region', 'text', 'button', 'input', 'list', 'card', 'note', 'connector']) {
    await page.getByTestId(`palette-${t}`).click();
  }
  await page.getByTestId('image-file').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: PNG_1PX });
  await expect.poll(async () => screenOf(await snap(page)).elements.some((e) => e.type === 'image')).toBe(true);
  await page.getByTestId('preset-calendar').click();
  await page.getByTestId('preset-task_list').click();
  s = await snap(page);
  const types = new Set(screenOf(s).elements.map((e) => e.type));
  for (const t of ['region', 'text', 'button', 'input', 'list', 'card', 'image', 'note', 'connector', 'group']) expect(types.has(t as SketchElement['type'])).toBe(true);
  expect(s.project.assets).toHaveLength(1);

  // 맞춤으로 전체를 보이게 한 뒤, 버튼을 끌어 옮긴다
  await page.getByRole('button', { name: '맞춤' }).click();
  await page.keyboard.press('Escape');
  s = await snap(page);
  const btn = screenOf(s).elements.find((e) => e.type === 'button' && !e.parentId)!;
  // 프리셋에 가려져 있으므로 검증 결과 목록에서 버튼을 골라 맨 앞으로
  await page.getByTestId('issues').getByText('] 버튼: 버튼에 연결된 동작이 없습니다').click();
  expect((await snap(page)).selection).toEqual([btn.id]);
  await page.getByRole('button', { name: '맨 앞', exact: true }).click();
  const b0 = await hitBox(page, btn.id);
  await drag(page, center(b0), { x: center(b0).x + 120, y: center(b0).y + 60 });
  s = await snap(page);
  const moved = screenOf(s).elements.find((e) => e.id === btn.id)!;
  const worldDx = 120 / s.zoom;
  expect(Math.abs(moved.x - btn.x - worldDx)).toBeLessThanOrEqual(8);
  expect(moved.x % 8).toBe(0); // 격자 맞춤

  // 오른쪽 아래 핸들로 크기 조절
  const h = await page.locator('.handle.h-se').boundingBox();
  await drag(page, center(h!), { x: center(h!).x + 40, y: center(h!).y + 20 });
  s = await snap(page);
  const resized = screenOf(s).elements.find((e) => e.id === btn.id)!;
  expect(resized.width).toBeGreaterThan(moved.width + 20);

  // 실행 취소로 크기가 돌아온다, 다시 실행으로 다시 커진다
  await page.keyboard.press('Control+z');
  expect(screenOf(await snap(page)).elements.find((e) => e.id === btn.id)!.width).toBe(moved.width);
  await page.keyboard.press('Control+Shift+z');
  expect(screenOf(await snap(page)).elements.find((e) => e.id === btn.id)!.width).toBe(resized.width);

  // 영역 선택(빈 곳에서 끌기)으로 여러 개 고르기
  const canvas = (await page.getByTestId('canvas').boundingBox())!;
  await page.keyboard.press('Escape');
  await drag(page, { x: canvas.x + 5, y: canvas.y + 5 }, { x: canvas.x + canvas.width - 5, y: canvas.y + canvas.height - 5 });
  expect((await snap(page)).selection.length).toBeGreaterThan(3);

  // 입력창을 고치는 중에는 Delete 가 요소를 지우지 않는다
  await page.locator(`[data-id="${btn.id}"] .hit`).click({ force: true });
  const before = screenOf(await snap(page)).elements.length;
  await page.getByTestId('el-name').click();
  await page.keyboard.press('Delete');
  expect(screenOf(await snap(page)).elements.length).toBe(before);
  // 작업판에서는 Delete 로 지운다
  await page.locator(`[data-id="${btn.id}"] .hit`).click({ force: true });
  await page.keyboard.press('Delete');
  expect(screenOf(await snap(page)).elements.length).toBe(before - 1);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/1-edit.png` });
});

test('기준 2: 확대·축소 후에도 펜 필기가 같은 자리에 있다', async ({ page }) => {
  await ready(page);
  await page.getByTestId('palette-region').click();
  let s = await snap(page);
  const region = screenOf(s).elements[0];
  // 200% 쯤으로 확대
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: '확대' }).click();
  s = await snap(page);
  expect(s.zoom).toBeGreaterThan(1.9);
  const rb = await hitBox(page, region.id);
  await page.keyboard.press('p');
  const c = center(rb);
  await page.mouse.move(c.x - 30, c.y - 10);
  await page.mouse.down();
  await page.mouse.move(c.x + 30, c.y + 10, { steps: 12 });
  await page.mouse.up();
  s = await snap(page);
  const stroke = screenOf(s).strokes[0];
  expect(stroke).toBeTruthy();
  // 필기 좌표(화면 좌표)가 영역 가운데 근처
  const mid = stroke.points[Math.floor(stroke.points.length / 2)];
  expect(Math.abs(mid[0] - (region.x + region.width / 2))).toBeLessThan(3);
  expect(Math.abs(mid[1] - (region.y + region.height / 2))).toBeLessThan(3);
  // 축소한 뒤에도 그려진 선이 영역 가운데에 있다
  for (let i = 0; i < 5; i++) await page.getByRole('button', { name: '축소' }).click();
  const pb = (await page.locator(`[data-stroke="${stroke.id}"]`).boundingBox())!;
  const rb2 = await hitBox(page, region.id);
  expect(Math.abs(center(pb).x - center(rb2).x)).toBeLessThan(3);
  expect(Math.abs(center(pb).y - center(rb2).y)).toBeLessThan(3);
  // 지우개로 지운다
  await page.keyboard.press('e');
  await page.mouse.click(center(pb).x, center(pb).y);
  expect(screenOf(await snap(page)).strokes).toHaveLength(0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/2-pen.png` });
});

test('기준 3: 작업 카드 → 시간 칸 드롭 동작과 빈 목록·오류 상태를 적는다', async ({ page }) => {
  await ready(page);
  await page.getByTestId('preset-calendar').click();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '맞춤' }).click();
  // 작업 목록은 캘린더 아래 빈 곳에 끌어 놓는다
  const cv = (await page.getByTestId('canvas').boundingBox())!;
  const art = (await page.locator('.artboard').boundingBox())!;
  await page.getByTestId('preset-task_list').dragTo(page.getByTestId('canvas'), { targetPosition: { x: art.x - cv.x + 20, y: art.y - cv.y + art.height * 0.62 } });
  let s = await snap(page);
  const sc = screenOf(s);
  const card = sc.elements.find((e) => e.semanticRole === 'task_card')!;
  const grid = sc.elements.find((e) => e.semanticRole === 'calendar_time_grid')!;
  expect(card && grid).toBeTruthy();

  // 동작 연결 도구로 카드에서 시간 칸까지 끌어 놓는다
  await page.keyboard.press('l');
  const cb = await hitBox(page, card.id);
  const gb = await hitBox(page, grid.id);
  await drag(page, center(cb), center(gb), 10);
  s = await snap(page);
  const ix = screenOf(s).interactions[0];
  expect(ix).toMatchObject({ sourceId: card.id, targetId: grid.id, trigger: 'drag_drop', action: 'create_item' });
  const cardUi = page.locator(`[data-ix="${ix.id}"]`);
  await cardUi.getByTestId('ix-condition').fill('작업이 완료 상태가 아님, 선행 작업 완료');
  await cardUi.getByTestId('ix-effect').fill('놓은 날짜와 시간에 작업 블록 생성');
  await cardUi.getByTestId('ix-data').fill('task 는 유지하고 schedule_block 생성');
  await cardUi.getByTestId('ix-error').fill('선행 미완료: 놓기 거부 / 시간 충돌: 확인 요청 / 저장 실패: 원위치');
  await cardUi.getByTestId('ix-acceptance').fill('새로고침 후 배치가 유지되고 마감일은 동일');
  s = await snap(page);
  expect(screenOf(s).interactions[0]).toMatchObject({
    condition: '작업이 완료 상태가 아님, 선행 작업 완료',
    errorState: '선행 미완료: 놓기 거부 / 시간 충돌: 확인 요청 / 저장 실패: 원위치',
    acceptance: '새로고침 후 배치가 유지되고 마감일은 동일',
  });

  // 검증 결과의 "빈 상태" 경고를 눌러 목록으로 가서 빈 상태·오류 상태를 붙인다
  await page.getByTestId('issues').getByText('목록의 빈 상태가 지정되지 않았습니다').click();
  await page.getByTestId('add-state-empty').click();
  await page.getByTestId('state-row').last().locator('textarea').fill('할 일이 없습니다 + 작업 추가 강조');
  await page.getByTestId('add-state-error').click();
  await page.getByTestId('state-row').last().locator('textarea').fill('목록을 불러오지 못했습니다');
  s = await snap(page);
  const states = screenOf(s).states;
  expect(states.map((x) => x.kind).sort()).toEqual(['empty', 'error']);
  await expect(page.getByTestId('issues')).not.toContainText('목록의 빈 상태가 지정되지 않았습니다');
  // 동작선이 작업판에 그려진다
  await expect(page.getByTestId('links').locator('.link')).toHaveCount(1);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/3-interaction.png` });
});

test('기준 4: 브라우저를 닫았다 열어도 마지막 저장 상태가 돌아온다', async ({ page, context }) => {
  await ready(page);
  await page.getByTestId('preset-task_list').click();
  await page.keyboard.press('p');
  const cv = (await page.getByTestId('canvas').boundingBox())!;
  await drag(page, { x: cv.x + 100, y: cv.y + 100 }, { x: cv.x + 200, y: cv.y + 160 });
  await page.keyboard.press('v');
  await page.locator('.title-input').fill('복원 시험');
  await waitSaved(page);
  const before = await snap(page);
  expect(before.savedRevision).toBeGreaterThan(1);
  await page.close();
  const page2 = await context.newPage();
  await ready(page2);
  const after = await snap(page2);
  expect(after.project.title).toBe('복원 시험');
  expect(after.savedRevision).toBe(before.savedRevision);
  expect(JSON.stringify(after.project.screens)).toBe(JSON.stringify(before.project.screens));
  await expect(page2.getByTestId('save-status')).toContainText(`r${before.savedRevision}`);
});

test('기준 5: ZIP(Light) 내보내기 → 다시 가져오면 위치·문구·필기·연결이 같다', async ({ page }, info) => {
  await ready(page);
  await page.getByRole('button', { name: '프로젝트 ▾' }).click();
  await page.getByTestId('open-example').click();
  await expect(page.locator('.title-input')).toHaveValue('AHNDA 할 일 및 일정');
  await page.getByRole('button', { name: '맞춤' }).click();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/5-example.png` });
  const original = (await snap(page)).project;

  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await page.getByTestId('profile-dev-light').check();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-zip').click()]);
  const zipPath = info.outputPath('bundle.zip');
  await download.saveAs(zipPath);
  expect(download.suggestedFilename()).toMatch(/^AHNDA-할-일-및-일정-r\d+-dev-light\.zip$/);
  const zip = await JSZip.loadAsync(readFileSync(zipPath));
  const names = Object.values(zip.files).filter((f) => !f.dir).map((f) => f.name);
  for (const n of ['project.json', 'manifest.json', 'requirements.md', 'validation-report.json', 'screens/01-main.png', 'screens/02-mobile.png', 'exports/dev-light/task-card.md', 'exports/dev-light/traceability.json']) {
    expect(names).toContain(n);
  }
  const png = await zip.file('screens/01-main.png')!.async('uint8array');
  expect([...png.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect(png.byteLength).toBeGreaterThan(5000);
  if (SHOTS) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(`${SHOTS}/5-export-main.png`, png);
    writeFileSync(`${SHOTS}/5-export-mobile.png`, await zip.file('screens/02-mobile.png')!.async('uint8array'));
    writeFileSync(`${SHOTS}/5-requirements.md`, await zip.file('requirements.md')!.async('string'));
    writeFileSync(`${SHOTS}/5-task-card.md`, await zip.file('exports/dev-light/task-card.md')!.async('string'));
  }
  const exported = JSON.parse(await zip.file('project.json')!.async('string')) as Project;
  const req = await zip.file('requirements.md')!.async('string');
  expect(req).toContain('ix_drop_task');
  expect(req).toContain('task_card_01');

  // 다시 가져오기 (새 프로젝트)
  await page.getByRole('button', { name: '가져오기' }).click();
  await page.getByTestId('import-file').setInputFiles(zipPath);
  await expect(page.getByTestId('import-ok')).toBeVisible();
  await page.getByTestId('import-new').click();
  await expect(page.locator('.title-input')).toHaveValue('AHNDA 할 일 및 일정 (가져옴)');
  const imported = (await snap(page)).project;
  expect(imported.id).not.toBe(original.id);
  expect(canon(imported.screens)).toBe(canon(original.screens));
  expect(canon(imported.screens)).toBe(canon(exported.screens));
  expect(imported.revision).toBe(exported.revision);

  // 시간 칸을 지우면 드롭 동작이 깨진 연결이 되고 내보내기가 막힌다
  // 더블클릭으로 캘린더 묶음 안에 들어가 시간 칸을 고른다
  await page.locator('[data-id="calendar_time_grid"] .hit').dblclick({ position: { x: 200, y: 200 } });
  await expect.poll(async () => (await snap(page)).selection).toEqual(['calendar_time_grid']);
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('links').locator('.link.broken').first()).toBeVisible();
  await page.getByRole('button', { name: '내보내기', exact: true }).click();
  await expect(page.getByTestId('export-blocked')).toBeVisible();
  await expect(page.getByTestId('export-zip')).toBeDisabled();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/5-blocked.png` });
});
