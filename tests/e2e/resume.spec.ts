/**
 * Resume-on-reload e2e (src/ui/save.ts, key 'scoundrel.run.v1'). Driven by the canvas run mirror in app.ts:
 * #screen[data-screen, data-phase, data-hp, data-room, data-fx]. Seeded URLs (?seed=) never resume by design, so
 * these tests use the plain URL. tutorialSeen is pre-seeded so the first-launch offer does not intercept Enter.
 */
import { expect, test, type Page } from '@playwright/test';
import { seedSettings } from './util';

const RUN_KEY = 'scoundrel.run.v1';
const screen = (page: Page) => page.locator('canvas#screen');

async function boot(page: Page): Promise<void> {
  await page.goto('/');
  await expect(screen(page)).toBeVisible();
  await expect(screen(page)).toHaveAttribute('data-screen', 'title', { timeout: 10_000 });
}

async function idle(page: Page): Promise<void> {
  await expect(screen(page)).toHaveAttribute('data-fx', 'idle', { timeout: 15_000 });
}

/** Collect uncaught page errors for the whole test. */
function trackErrors(page: Page): Error[] {
  const errors: Error[] = [];
  page.on('pageerror', (e) => errors.push(e));
  return errors;
}

test.describe('resume on reload', () => {
  test('a real run with 2 moves resumes on reload with the same hp and room', async ({ page }) => {
    const errors = trackErrors(page);
    await seedSettings(page, { tutorialSeen: true });
    await boot(page);
    await page.waitForTimeout(300);
    await page.keyboard.press('Enter'); // PLAY
    await expect(screen(page)).toHaveAttribute('data-screen', 'game', { timeout: 10_000 });
    await idle(page);

    // Move 1: avoid the first room.
    const room0 = await screen(page).getAttribute('data-room');
    await page.keyboard.press('a');
    await expect(screen(page)).not.toHaveAttribute('data-room', room0 ?? '', { timeout: 10_000 });
    await idle(page);

    // Move 2: take slot 1 (fight barehanded if it is a monster; 'b' is ignored otherwise).
    const room1 = await screen(page).getAttribute('data-room');
    await page.keyboard.press('1');
    await page.waitForTimeout(150);
    await page.keyboard.press('b');
    await expect(screen(page)).not.toHaveAttribute('data-room', room1 ?? '', { timeout: 10_000 });
    await idle(page);

    const hp = await screen(page).getAttribute('data-hp');
    const room = await screen(page).getAttribute('data-room');
    expect(hp).toMatch(/^\d+$/);
    expect(room).toBeTruthy();
    expect(await page.evaluate((k) => localStorage.getItem(k), RUN_KEY)).not.toBeNull();

    await page.reload();
    await expect(screen(page)).toHaveAttribute('data-screen', 'game', { timeout: 10_000 });
    await expect(screen(page)).toHaveAttribute('data-hp', hp!);
    await expect(screen(page)).toHaveAttribute('data-room', room!);
    expect(errors).toEqual([]);
  });

  test('the tutorial is never resumed: reload lands on the title', async ({ page }) => {
    await seedSettings(page, { tutorialSeen: true });
    await boot(page);
    await page.waitForTimeout(300);
    await page.keyboard.press('t'); // start the tutorial from the title
    await expect(page.locator('#coach-live')).toHaveAttribute('data-phase', 'coaching', { timeout: 10_000 });
    await expect(screen(page)).toHaveAttribute('data-screen', 'game');
    await page.reload();
    await expect(screen(page)).toHaveAttribute('data-screen', 'title', { timeout: 10_000 });
  });

  test('a localStorage that throws on access still boots to the title with no page errors', async ({ page }) => {
    const errors = trackErrors(page);
    await page.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    });
    await boot(page);
    await page.waitForTimeout(500);
    expect(errors).toEqual([]);
  });

  test('a corrupt save value boots to the title', async ({ page }) => {
    const errors = trackErrors(page);
    await seedSettings(page, { tutorialSeen: true });
    await page.addInitScript((k) => {
      try {
        localStorage.setItem(k, '{"version":1,"seed":"nope","actions":[{]');
      } catch {
        // storage blocked
      }
    }, RUN_KEY);
    await boot(page);
    await page.waitForTimeout(500);
    await expect(screen(page)).toHaveAttribute('data-screen', 'title');
    expect(errors).toEqual([]);
  });
});
