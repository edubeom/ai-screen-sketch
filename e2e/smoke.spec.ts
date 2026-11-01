import { expect, test } from '@playwright/test';

test('앱이 열리고 콘솔 오류가 없다', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await expect(page.getByTestId('save-status')).toContainText('저장됨');
  await page.getByTestId('preset-calendar').click();
  await page.getByTestId('palette-button').click();
  if (process.env.SHOTS) await page.screenshot({ path: `${process.env.SHOTS}/smoke.png` });
  expect(errors).toEqual([]);
});
