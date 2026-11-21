/**
 * Tall portrait (Galaxy S22+ class, 270x585 logical; 22:9, 270x660): the action dock sits low, in thumb reach, and
 * taps on it still land through the CRT warp (which is strongest near the screen edge). Owner: Starbuck.
 * Set SCREENSHOT_DIR to save title, game, fight, coach (tutorial) and settings screenshots for each size.
 */
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { warpUv } from '../../src/render/crt';
import { frameFor } from '../../src/render/layout';
import { screenGeometry } from '../../src/render/screen';
import { DEFAULT_CRT } from '../../src/render/theme';
import type { Viewport } from '../../src/render/types';
import type { Rect } from '../../src/ui/view';
import { seedSettings } from './util';

const screen = (page: Page) => page.locator('canvas#screen');
const SHOTS = process.env['SCREENSHOT_DIR'];

function unwarp(u: number, v: number): [number, number] {
  let su = u;
  let sv = v;
  for (let i = 0; i < 30; i++) {
    const [wu, wv] = warpUv(su, sv, DEFAULT_CRT.curvature);
    su -= wu - u;
    sv -= wv - v;
  }
  return [su, sv];
}

const SIZES = [
  ['s22', 412, 892, 2.625],
  ['22x9', 360, 880, 3],
  ['16x9', 360, 640, 3],
] as const;

for (const [name, width, height, dpr] of SIZES) {
  test.describe(`portrait ${name} (${width}x${height} @ ${dpr})`, () => {
    test.use({ viewport: { width, height }, deviceScaleFactor: dpr, isMobile: true, hasTouch: true });

    const vp: Viewport = { cssWidth: width, cssHeight: height, devicePixelRatio: dpr, orientation: 'portrait' };
    const geo = screenGeometry(vp);
    const frame = frameFor('portrait', { w: geo.w, h: geo.h }, geo.safe);

    /** Tap a logical point through the inverse CRT warp. */
    async function tapAt(page: Page, x: number, y: number): Promise<void> {
      const box = (await screen(page).boundingBox())!;
      const [u, v] = unwarp(x / geo.w, y / geo.h);
      await page.touchscreen.tap(box.x + u * box.width, box.y + v * box.height);
    }
    const tapRect = (page: Page, r: Rect): Promise<void> => tapAt(page, r.x + r.w / 2, r.y + r.h / 2);
    const idle = (page: Page) => expect(screen(page)).toHaveAttribute('data-fx', 'idle', { timeout: 15_000 });
    const shot = async (page: Page, what: string): Promise<void> => {
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `portrait-${name}-${what}.png`) });
    };

    test('play: the low AVOID and fight buttons take taps; screenshots', async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop-chromium', 'sets its own device; once is enough');
      test.setTimeout(120_000);
      const errors: Error[] = [];
      page.on('pageerror', (e) => errors.push(e));
      await seedSettings(page, { tutorialSeen: true, reducedMotion: true });
      await page.goto('/?seed=7'); // room 1 = H2 H9 D2 S10
      await expect(screen(page)).toHaveAttribute('data-screen', 'title', { timeout: 10_000 });
      await page.waitForTimeout(300);
      await shot(page, 'title');

      await tapRect(page, frame.play);
      await expect(screen(page)).toHaveAttribute('data-screen', 'game', { timeout: 10_000 });
      await idle(page);
      await expect(screen(page)).toHaveAttribute('data-room', 'H2,H9,D2,S10');
      await shot(page, 'game');

      // Equip the 2 of diamonds, then open the fight choice on the 10 of spades.
      await tapRect(page, { x: frame.roomX[2]!, y: frame.roomY, w: 56, h: 78 });
      await expect(screen(page)).toHaveAttribute('data-room', 'H2,H9,-,S10', { timeout: 10_000 });
      await idle(page);
      await tapRect(page, { x: frame.roomX[3]!, y: frame.roomY, w: 56, h: 78 });
      await page.waitForTimeout(300);
      await shot(page, 'fight');
      // CANCEL is the lowest button on screen: tap near its bottom edge, where the warp is strongest.
      const cancel = frame.actions.cancel;
      await tapAt(page, cancel.x + cancel.w / 2, cancel.y + cancel.h - 3);
      await page.waitForTimeout(300);
      await tapRect(page, { x: frame.roomX[3]!, y: frame.roomY, w: 56, h: 78 });
      await page.waitForTimeout(300);
      await tapRect(page, frame.actions.fightWeapon);
      await expect(screen(page)).toHaveAttribute('data-hp', '12', { timeout: 10_000 });
      await idle(page);
      await shot(page, 'game-armed');

      // Settings menu.
      await tapRect(page, frame.settings);
      await page.waitForTimeout(300);
      await shot(page, 'settings');
      expect(errors).toEqual([]);
    });

    test('a fresh room: AVOID near the bottom edge takes a tap', async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop-chromium', 'sets its own device; once is enough');
      test.setTimeout(120_000);
      await seedSettings(page, { tutorialSeen: true, reducedMotion: true });
      await page.goto('/?seed=7');
      await expect(screen(page)).toHaveAttribute('data-screen', 'title', { timeout: 10_000 });
      await tapRect(page, frame.play);
      await idle(page);
      await expect(screen(page)).toHaveAttribute('data-room', 'H2,H9,D2,S10');
      const avoid = frame.actions.avoid;
      await tapAt(page, avoid.x + avoid.w / 2, avoid.y + avoid.h - 3);
      await expect(screen(page)).not.toHaveAttribute('data-room', 'H2,H9,D2,S10', { timeout: 10_000 });
    });

    test('tutorial: coach strip and recap screenshots', async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop-chromium' || !SHOTS, 'screenshots only');
      test.setTimeout(120_000);
      await seedSettings(page, { tutorialSeen: true, reducedMotion: true });
      await page.goto('/');
      await expect(screen(page)).toHaveAttribute('data-screen', 'title', { timeout: 10_000 });
      await page.keyboard.press('t');
      const ready = (step: string) =>
        expect(page.locator(`#coach-live[data-ready="true"][data-step="${step}"]`)).toHaveCount(1, { timeout: 15_000 });
      await ready('welcome');
      await page.waitForTimeout(300);
      await shot(page, 'coach-welcome');
      for (const [step, keys] of [['welcome', ['Enter', 'Enter']], ['monsters', ['Enter']], ['weapons', ['Enter']], ['potions', ['Enter']], ['roomRule', ['Enter', 'Enter']]] as const) {
        await ready(step);
        for (const k of keys) {
          await page.keyboard.press(k);
          await page.waitForTimeout(150);
        }
      }
      await ready('r1Equip');
      await page.waitForTimeout(300);
      await shot(page, 'coach-r1');
      await page.keyboard.press('1');
      await ready('r1Fight');
      await page.keyboard.press('2');
      await page.waitForTimeout(400);
      await shot(page, 'coach-fight');
    });

    test('first-launch offer screenshot', async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop-chromium' || !SHOTS, 'screenshots only');
      await seedSettings(page, { reducedMotion: true });
      await page.goto('/');
      await expect(screen(page)).toHaveAttribute('data-screen', 'title', { timeout: 10_000 });
      await page.waitForTimeout(400);
      await shot(page, 'offer');
    });
  });
}
