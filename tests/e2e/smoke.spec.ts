/** Placeholder e2e smoke test (scaffold). Tigh owns real e2e coverage. */
import { expect, test } from '@playwright/test';

test('app loads and shows the game canvas', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Scoundrel');
  await expect(page.locator('canvas#screen')).toBeVisible();
});
