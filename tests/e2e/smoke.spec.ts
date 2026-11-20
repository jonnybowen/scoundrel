/**
 * Smoke e2e (owner: Tigh). Fresh storage now shows the first-launch tutorial offer (Design Review 2), so
 * real-run tests seed tutorialSeen: true before the app boots.
 */
import { expect, test } from '@playwright/test';
import { seedSettings } from './util';

test('app loads and shows the game canvas', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('Scoundrel');
  await expect(page.locator('canvas#screen')).toBeVisible();
});

test('fresh storage: the first-launch offer is up, the coach mirror exists and is idle', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('canvas#screen')).toBeVisible();
  const live = page.locator('#coach-live');
  await expect(live).toBeAttached();
  await expect(live).toHaveAttribute('aria-live', 'polite');
  await expect(live).not.toHaveAttribute('data-phase', /.*/);
  await expect(live).toBeEmpty();
  // The offer intercepts Enter (TEACH ME) instead of PLAY.
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await expect(live).toHaveAttribute('data-phase', 'coaching', { timeout: 10_000 });
});

test('with tutorialSeen, Enter on the title starts a real run (no tutorial)', async ({ page }) => {
  await seedSettings(page, { tutorialSeen: true });
  await page.goto('/?seed=7');
  await expect(page.locator('canvas#screen')).toBeVisible();
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1_000);
  await expect(page.locator('#coach-live')).not.toHaveAttribute('data-phase', /.*/);
});
