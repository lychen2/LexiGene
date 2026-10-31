import { test, expect } from '@playwright/test';
test('radius evidence', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1050 });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  await page.screenshot({ path: 'artifacts/radius-home.png' });
  // Crop the sheet corner to show the curve at 3x.
  await page.locator('.study-sheet').screenshot({ path: 'artifacts/radius-sheet.png' });
  await page.locator('.workspace-link').nth(2).click();
  await page.waitForTimeout(700);
  await page.getByRole('dialog').screenshot({ path: 'artifacts/radius-desk.png' });
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(700);
  await page.screenshot({ path: 'artifacts/radius-mobile.png' });
});
