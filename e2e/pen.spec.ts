// 펜 작업 개선 작업 카드의 완료 기준 (저장 표시 · 지우개 · 모형 인식 · 채우기/색 · 펜 버튼)
import { expect, test, type Page } from '@playwright/test';
import type { Project, Screen } from '@sketch/core';

const SHOTS = process.env.SHOTS;

async function ready(page: Page) {
  await page.goto('/');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(page.getByTestId('save-status')).toContainText('저장됨');
}

async function state(page: Page) {
  return page.evaluate(() => {
    const s = (window as unknown as { __sketch: { getState: () => { project: Project; screenId: string; tool: string; pen: { color: string }; recentColors: string[]; colorPopup?: unknown; zoom: number } } }).__sketch.getState();
    return JSON.parse(JSON.stringify({ project: s.project, screenId: s.screenId, tool: s.tool, color: s.pen.color, recent: s.recentColors, popup: !!s.colorPopup, zoom: s.zoom }));
  }) as Promise<{ project: Project; screenId: string; tool: string; color: string; recent: string[]; popup: boolean; zoom: number }>;
}
const screenOf = (s: { project: Project; screenId: string }): Screen => s.project.screens.find((x) => x.id === s.screenId)!;

/** 작업판 좌표(px) → 화면 좌표 */
async function toClient(page: Page, x: number, y: number) {
  const art = (await page.locator('.artboard').boundingBox())!;
  const s = await state(page);
  return { x: art.x + x * s.zoom, y: art.y + y * s.zoom };
}

async function drawPath(page: Page, pts: [number, number][]) {
  const c0 = await toClient(page, pts[0][0], pts[0][1]);
  await page.mouse.move(c0.x, c0.y);
  await page.mouse.down();
  for (const [x, y] of pts.slice(1)) {
    const c = await toClient(page, x, y);
    await page.mouse.move(c.x, c.y, { steps: 3 });
  }
  await page.mouse.up();
}

function polyPath(vs: [number, number][], per = 8): [number, number][] {
  const out: [number, number][] = [];
  const ring = [...vs, vs[0]];
  for (let i = 1; i < ring.length; i++) for (let k = 0; k < per; k++) out.push([ring[i - 1][0] + ((ring[i][0] - ring[i - 1][0]) * k) / per, ring[i - 1][1] + ((ring[i][1] - ring[i - 1][1]) * k) / per]);
  out.push(ring[ring.length - 1]);
  return out;
}

async function penPress(page: Page, button: number, times: number) {
  await page.evaluate(
    ({ button, times }) => {
      for (let i = 0; i < times; i++) {
        window.dispatchEvent(new PointerEvent('pointerdown', { button, buttons: 0, pointerType: 'pen', clientX: 700, clientY: 400, bubbles: true }));
      }
    },
    { button, times },
  );
  await page.waitForTimeout(500);
}

test('저장 표시는 가져오기 왼쪽, 저장 상태가 바뀌어도 위쪽 버튼이 움직이지 않는다', async ({ page }) => {
  await ready(page);
  const badge = (await page.getByTestId('save-status').boundingBox())!;
  const imp = (await page.getByRole('button', { name: '가져오기' }).boundingBox())!;
  expect(badge.x + badge.width).toBeLessThanOrEqual(imp.x + 1);
  expect(imp.x - (badge.x + badge.width)).toBeLessThan(20);
  const positions = async () => Promise.all(['선택', '펜', '가져오기', '내보내기'].map(async (n) => (await page.getByRole(n === '선택' || n === '펜' ? 'radio' : 'button', { name: n, exact: true }).boundingBox())!.x));
  const before = await positions();
  const badgeW = badge.width;
  // 바꾸는 중(변경됨 · 저장 중)과 저장됨 사이에서 위치·폭이 같아야 한다
  await page.getByTestId('palette-region').click();
  const during = await positions();
  const wDuring = (await page.getByTestId('save-status').boundingBox())!.width;
  await expect(page.getByTestId('save-status')).toContainText('저장됨');
  const after = await positions();
  expect(during).toEqual(before);
  expect(after).toEqual(before);
  expect(wDuring).toBe(badgeW);
  // 도구를 바꿔도(펜 설정이 나타나도) 위쪽 버튼은 그대로이고 내보내기가 잘리지 않는다
  await page.keyboard.press('p');
  expect(await positions()).toEqual(before);
  const exp = (await page.getByRole('button', { name: '내보내기', exact: true }).boundingBox())!;
  expect(exp.x + exp.width).toBeLessThanOrEqual(1600);
  await expect(page.getByTestId('recognize')).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pen-topbar.png` });
});

test('지우개로 필기·텍스트·상자 무엇이든 지우고, 실행 취소로 돌아온다', async ({ page }) => {
  await ready(page);
  await page.getByTestId('palette-text').click();
  await page.getByTestId('palette-region').click();
  await page.keyboard.press('Escape');
  let s = await state(page);
  const [text] = screenOf(s).elements;
  await page.keyboard.press('p');
  await drawPath(page, [[60, 60], [90, 70], [120, 60], [150, 75]]);
  s = await state(page);
  expect(screenOf(s).strokes).toHaveLength(1);
  await page.keyboard.press('e');
  // 필기 지우기
  let c = await toClient(page, 90, 70);
  await page.mouse.click(c.x, c.y);
  // 같은 자리를 두 번: 위에 있는 영역(나중에 놓음)이 먼저, 그다음 아래의 텍스트
  c = await toClient(page, text.x + text.width / 2, text.y + text.height / 2);
  await page.mouse.click(c.x, c.y);
  s = await state(page);
  expect(screenOf(s).strokes).toHaveLength(0);
  expect(screenOf(s).elements.map((e) => e.id)).toEqual([text.id]);
  await page.mouse.click(c.x, c.y);
  expect(screenOf(await state(page)).elements).toHaveLength(0);
  await page.keyboard.press('Control+z');
  expect(screenOf(await state(page)).elements.map((e) => e.id)).toEqual([text.id]);
});

test('손으로 그린 네모·원·별이 모형이 되고, 가운데를 누르면 글을 쓴다', async ({ page }) => {
  await ready(page);
  await page.keyboard.press('p');
  await drawPath(page, polyPath([[100, 100], [300, 100], [300, 220], [100, 220]]));
  const circle: [number, number][] = [];
  for (let i = 0; i <= 40; i++) circle.push([500 + 80 * Math.cos((i / 40) * Math.PI * 2), 200 + 80 * Math.sin((i / 40) * Math.PI * 2)]);
  await drawPath(page, circle);
  const star: [number, number][] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 100 : 40;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    star.push([850 + r * Math.cos(a), 220 + r * Math.sin(a)]);
  }
  await drawPath(page, polyPath(star, 5));
  let s = await state(page);
  const shapes = screenOf(s).elements.filter((e) => e.type === 'shape');
  expect(shapes.map((e) => e.props.shapeKind)).toEqual(['rect', 'ellipse', 'star']);
  expect(screenOf(s).strokes).toHaveLength(0);
  const rect = shapes[0];
  expect(Math.abs(rect.x - 100)).toBeLessThan(6);
  expect(Math.abs(rect.width - 200)).toBeLessThan(10);
  // 펜으로 원 가운데를 톡 → 글 쓰기
  const c = await toClient(page, 500, 200);
  await page.mouse.click(c.x, c.y);
  await expect(page.getByTestId('inline-text')).toBeVisible();
  await page.getByTestId('inline-text').fill('로그인');
  await page.keyboard.press('Control+Enter');
  s = await state(page);
  expect(screenOf(s).elements.find((e) => e.props.shapeKind === 'ellipse')!.text).toBe('로그인');
  // Ctrl+Z 를 거듭하면 모형 → 손그림으로 돌아간다
  await page.keyboard.press('Control+z'); // 글
  await page.keyboard.press('Control+z'); // 별 → 손그림
  s = await state(page);
  expect(screenOf(s).elements.filter((e) => e.type === 'shape')).toHaveLength(2);
  expect(screenOf(s).strokes).toHaveLength(1);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pen-shapes.png` });
});

test('채우기·색 팝업·스포이트, 바탕 칠하기', async ({ page }) => {
  await ready(page);
  await page.keyboard.press('p');
  await drawPath(page, polyPath([[100, 100], [300, 100], [300, 220], [100, 220]]));
  // 색 팝업: 최근 4 · 기본 16 · 색 판
  await page.getByTestId('current-color').click();
  const popup = page.getByTestId('color-popup');
  await expect(popup).toBeVisible();
  await expect(popup.locator('.cp-grid .swatch')).toHaveCount(16);
  await expect(popup.locator('.cp-row').first().locator('.swatch')).toHaveCount(4);
  await expect(popup.locator('.cp-sv')).toBeVisible();
  await popup.getByLabel('색 #ef4444').click();
  let s = await state(page);
  expect(s.color).toBe('#ef4444');
  expect(s.recent[0]).toBe('#ef4444');
  // 채우기: 모형 안을 누르면 그 모형, 빈 곳을 누르면 바탕
  await page.keyboard.press('f');
  let c = await toClient(page, 200, 160);
  await page.mouse.click(c.x, c.y);
  await page.getByTestId('current-color').click();
  await page.getByTestId('color-popup').getByLabel('색 #3b82f6').click();
  c = await toClient(page, 700, 600);
  await page.mouse.click(c.x, c.y);
  s = await state(page);
  expect(screenOf(s).elements[0].props.fill).toBe('#ef4444');
  expect(screenOf(s).background).toBe('#3b82f6');
  // 스포이트(먼 버튼 3번): 커서 자리 색을 가져온다
  const at = await toClient(page, 200, 160);
  await page.mouse.move(at.x, at.y);
  await page.evaluate(({ x, y }) => {
    for (let i = 0; i < 3; i++) window.dispatchEvent(new PointerEvent('pointerdown', { button: 5, pointerType: 'pen', clientX: x, clientY: y }));
  }, at);
  await page.waitForTimeout(500);
  expect((await state(page)).color).toBe('#ef4444');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pen-fill.png` });
});

test('펜 버튼: 가까운 버튼 1·2·3번 = 실행 취소·다시 실행·지우개 전환, 먼 버튼 1·2번 = 채우기·색 팝업, 키 등록', async ({ page }) => {
  await ready(page);
  await page.getByTestId('palette-button').click();
  expect(screenOf(await state(page)).elements).toHaveLength(1);
  await penPress(page, 2, 1);
  expect(screenOf(await state(page)).elements).toHaveLength(0);
  await penPress(page, 2, 2);
  expect(screenOf(await state(page)).elements).toHaveLength(1);
  await page.keyboard.press('p');
  await penPress(page, 2, 3);
  expect((await state(page)).tool).toBe('eraser');
  await penPress(page, 2, 3);
  expect((await state(page)).tool).toBe('pen');
  // 먼 버튼 1번 = 채우기 한 번 → 칠하고 나면 펜으로 돌아간다
  await penPress(page, 5, 1);
  expect((await state(page)).tool).toBe('fill');
  const c = await toClient(page, 700, 600);
  await page.mouse.click(c.x, c.y);
  expect((await state(page)).tool).toBe('pen');
  // 먼 버튼 2번 = 커서 자리에 색 팝업
  await penPress(page, 5, 2);
  await expect(page.getByTestId('color-popup')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('color-popup')).toHaveCount(0);
  // 드라이버가 키보드 키(F9)로 보내는 경우: 등록 후 F9 한 번 = 채우기
  await page.getByRole('button', { name: '펜 버튼' }).click();
  await page.getByTestId('learn-far').click();
  await page.keyboard.press('F9');
  await expect(page.getByTestId('pen-buttons')).toContainText('키보드 F9');
  await page.getByRole('button', { name: '닫기' }).last().click();
  await page.keyboard.press('v');
  await page.keyboard.press('F9');
  await page.waitForTimeout(500);
  expect((await state(page)).tool).toBe('fill');
});
