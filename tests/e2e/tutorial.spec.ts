/**
 * Tutorial e2e (Design Review 2, docs/TUTORIAL.md "Tests"). Driven by the #coach-live mirror:
 * before each key, wait for #coach-live[data-ready="true"][data-step="<id>"] (and the right data-page).
 * Runs on desktop-chromium and mobile-chromium (Pixel 7) via playwright.config.ts projects.
 */
import { expect, test, type Page } from '@playwright/test';

const SETTINGS_KEY = 'scoundrel.settings.v1';

/** Canonical keys per step, from the doc's e2e key sequence (30 groups). */
const KEYS: [string, string[]][] = [
  ['welcome', ['Enter', 'Enter']],
  ['monsters', ['Enter']],
  ['weapons', ['Enter']],
  ['potions', ['Enter']],
  ['roomRule', ['Enter', 'Enter']],
  ['r1Equip', ['1']],
  ['r1Fight', ['2', 'w']],
  ['r1FightDone', ['Enter']],
  ['r1Potion', ['4']],
  ['r1Cleared', ['Enter', 'Enter']],
  ['r2Look', ['Enter', 'Enter']],
  ['r2Avoid', ['a']],
  ['r3TryAvoid', ['a']],
  ['r3Refused', ['Enter']],
  ['r3Fight6', ['1', 'w']],
  ['r3Dull', ['Enter', 'Enter']],
  ['r3TooDull', ['2']],
  ['r3Fight4', ['3', 'w']],
  ['r4Drink', ['Enter', '4']],
  ['r4Waste', ['2']],
  ['r4Wasted', ['Enter']],
  ['r4NewWeapon', ['1']],
  ['r5Return', ['Enter']],
  ['r5Losing', ['Enter', 'Enter']],
  ['r5Ace', ['1', 'w']],
  ['r5Seven', ['2', 'w']],
  ['r5Three', ['4', 'w']],
  ['r6Final', ['Enter']],
  ['r6Two', ['3', 'w']],
  ['r6Potion', ['1']],
];

/** Keys that page within a step (NEXT on a non-last page) as opposed to select-then-choose pairs. */
const isNext = (k: string): boolean => k === 'Enter';

const live = (page: Page) => page.locator('#coach-live');

async function waitReady(page: Page, step: string, pageNo?: number): Promise<void> {
  const sel = `#coach-live[data-ready="true"][data-step="${step}"]` + (pageNo === undefined ? '' : `[data-page="${pageNo}"]`);
  await expect(page.locator(sel), `waiting for ${step} p${pageNo ?? '*'}`).toHaveCount(1, { timeout: 15_000 });
}

/** Fresh storage: the first-launch offer is up (data-phase absent until the tutorial starts). */
async function openFresh(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('canvas#screen')).toBeVisible();
  await expect(live(page)).toBeAttached();
  await expect(live(page)).not.toHaveAttribute('data-phase', /.*/);
}

async function playThrough(page: Page): Promise<void> {
  for (const [step, keys] of KEYS) {
    let pageNo = 0;
    await waitReady(page, step, 0);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i]!;
      await waitReady(page, step, pageNo);
      await page.keyboard.press(k);
      const last = i === keys.length - 1;
      if (!last && isNext(k)) pageNo++;
      if (!last && !isNext(k)) {
        // Select opened the sword/fists choice: same step, same page.
        await waitReady(page, step, pageNo);
      }
    }
  }
}

async function settings(page: Page): Promise<Record<string, unknown> | null> {
  return page.evaluate((key) => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
  }, SETTINGS_KEY);
}

test.describe('tutorial', () => {
  test('first launch: offer, Enter accepts, full keyboard playthrough, recap, Enter starts a real run', async ({ page }) => {
    test.setTimeout(300_000);
    await openFresh(page);
    await page.keyboard.press('Enter'); // TEACH ME
    await waitReady(page, 'welcome', 0);
    await expect(live(page)).toHaveAttribute('data-phase', 'coaching');
    await expect(live(page)).toContainText('WELCOME, SCOUNDREL.');
    expect((await settings(page))?.['tutorialSeen']).toBe(true);

    await playThrough(page);

    await expect(page.locator('#coach-live[data-phase="recap"][data-ready="true"]')).toHaveCount(1, { timeout: 15_000 });
    await expect(live(page)).toContainText('DUNGEON CLEARED!');
    await page.keyboard.press('Enter'); // PLAY A REAL RUN
    await expect(live(page)).not.toHaveAttribute('data-phase', /.*/);
    await expect(live(page)).toBeEmpty();
  });

  test('a wrong move shows a nudge and the step stays the same', async ({ page }) => {
    await openFresh(page);
    await page.keyboard.press('Enter');
    for (const [step, keys] of KEYS.slice(0, 5)) {
      let p = 0;
      for (const k of keys) {
        await waitReady(page, step, p++);
        await page.keyboard.press(k);
      }
    }
    await waitReady(page, 'r1Equip', 0);
    await page.keyboard.press('3'); // the 3 of clubs, not the 5 of diamonds
    await expect(live(page)).toContainText('FIRST, PICK UP THE 5 OF DIAMONDS (KEY 1).');
    await expect(live(page)).toHaveAttribute('data-step', 'r1Equip');
    // N (new game) is ignored in the tutorial.
    await page.keyboard.press('n');
    await waitReady(page, 'r1Equip', 0);
    await expect(live(page)).toHaveAttribute('data-phase', 'coaching');
    // The right move still works afterwards.
    await page.keyboard.press('1');
    await waitReady(page, 'r1Fight', 0);
  });

  test('X leaves mid-tutorial for the title; reload does not bring the offer back', async ({ page }) => {
    await openFresh(page);
    await page.keyboard.press('Enter');
    await waitReady(page, 'welcome', 0);
    await page.keyboard.press('Enter');
    await waitReady(page, 'welcome', 1);
    await page.keyboard.press('x');
    await expect(live(page)).not.toHaveAttribute('data-phase', /.*/);
    expect((await settings(page))?.['tutorialSeen']).toBe(true);

    await page.reload();
    await expect(page.locator('canvas#screen')).toBeVisible();
    // No offer: Enter is PLAY (a real run), not TEACH ME, so the tutorial does not start.
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1_000);
    await expect(live(page)).not.toHaveAttribute('data-phase', /.*/);
    // T on the title still starts the tutorial on demand.
    await page.goto('/');
    await page.waitForTimeout(500);
    await page.keyboard.press('t');
    await waitReady(page, 'welcome', 0);
  });

  test('declining the offer (Esc) persists tutorialSeen and stays on the title', async ({ page }) => {
    await openFresh(page);
    await page.waitForTimeout(300);
    await page.keyboard.press('Escape');
    await expect.poll(async () => (await settings(page))?.['tutorialSeen']).toBe(true);
    await expect(live(page)).not.toHaveAttribute('data-phase', /.*/);
    await page.reload();
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter'); // PLAY, not the offer
    await page.waitForTimeout(1_000);
    await expect(live(page)).not.toHaveAttribute('data-phase', /.*/);
  });

  test('data-ready never flags a finished action step as ready again (no latched-text ready frame)', async ({ page }) => {
    test.setTimeout(120_000);
    // docs/TUTORIAL.md: data-ready="true" only when FX is idle AND the chrome is not latched. On the frame where the
    // action's FX goes idle the mirrored text must already be the next step, never the step that just finished.
    await page.addInitScript(() => {
      const w = window as unknown as { __coachSeq: string[] };
      w.__coachSeq = [];
      const start = (): void => {
        const el = document.getElementById('coach-live');
        if (!el) {
          setTimeout(start, 5);
          return;
        }
        const rec = (): void => {
          const s = `${el.getAttribute('data-step')}|${el.getAttribute('data-ready')}`;
          if (w.__coachSeq[w.__coachSeq.length - 1] !== s) w.__coachSeq.push(s);
        };
        rec();
        new MutationObserver(rec).observe(el, { attributes: true, childList: true, characterData: true });
      };
      document.addEventListener('DOMContentLoaded', start);
    });
    await openFresh(page);
    await page.keyboard.press('Enter');
    const seqLen = (): Promise<number> => page.evaluate(() => (window as unknown as { __coachSeq: string[] }).__coachSeq.length);
    /** Index into the log at which each action step's final (animated) key was pressed. */
    const actionMarks: [string, number][] = [];
    for (const [step, keys] of KEYS.slice(0, 10)) {
      let p = 0;
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]!;
        await waitReady(page, step, p);
        const last = i === keys.length - 1;
        if (last && !isNext(k)) actionMarks.push([step, await seqLen()]);
        await page.keyboard.press(k);
        if (isNext(k)) p++;
      }
    }
    await waitReady(page, 'r2Look', 0);
    const seq = await page.evaluate(() => (window as unknown as { __coachSeq: string[] }).__coachSeq);
    expect(actionMarks.map(([s]) => s)).toEqual(['r1Equip', 'r1Fight', 'r1Potion']);
    for (const [step, from] of actionMarks) {
      const after = seq.slice(from);
      const busyAt = after.indexOf(`${step}|false`);
      expect(busyAt, `${step}: ready never went false after its action key (${after.join(' ')})`).toBeGreaterThanOrEqual(0);
      expect(after.slice(busyAt), `${step}: stale ready=true after FX (${after.join(' ')})`).not.toContain(`${step}|true`);
    }
  });

  test('an older save without tutorialSeen still shows the offer once', async ({ page }) => {
    await page.addInitScript((key) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem(key, JSON.stringify({ muted: true, crtEnabled: true }));
        sessionStorage.setItem('seeded', '1');
      }
    }, SETTINGS_KEY);
    await page.goto('/');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await waitReady(page, 'welcome', 0);
  });
});

test.describe('tutorial, reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('completes with the same keys', async ({ page }) => {
    test.setTimeout(300_000);
    await openFresh(page);
    await page.keyboard.press('Enter');
    await playThrough(page);
    await expect(page.locator('#coach-live[data-phase="recap"][data-ready="true"]')).toHaveCount(1, { timeout: 15_000 });
  });
});
