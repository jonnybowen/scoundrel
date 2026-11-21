/**
 * Full-screen on 19.5:9 phones (Galaxy S22+ class: 412x892 CSS at dpr 2.625), portrait and landscape.
 * The logical canvas now follows the aspect (270x585 / 585x270), so the display canvas must cover > 95% of the
 * viewport (it covered ~82% with the fixed 16:9 frame), and touch taps must still land on PLAY, a room card and the
 * fight buttons with the CRT warp on. Tap points come from the same layout frame the game uses, pushed through the
 * inverse of the CRT barrel warp, so a mismatch between drawn scene, layout and hitTest fails here.
 * Set SCREENSHOT_DIR to also save a screenshot of each orientation (title and mid-fight).
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

/** Screen uv that the CRT warp maps onto scene uv (u, v): invert warpUv by fixed-point iteration. */
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

for (const [name, width, height] of [['portrait', 412, 892], ['landscape', 892, 412]] as const) {
  test.describe(`19.5:9 ${name} (${width}x${height} @ 2.625)`, () => {
    test.use({ viewport: { width, height }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true });

    const vp: Viewport = { cssWidth: width, cssHeight: height, devicePixelRatio: 2.625, orientation: name };
    const geo = screenGeometry(vp);
    const frame = frameFor(name, { w: geo.w, h: geo.h }, geo.safe);

    async function tapRect(page: Page, r: Rect): Promise<void> {
      const box = (await screen(page).boundingBox())!;
      const [u, v] = unwarp((r.x + r.w / 2) / geo.w, (r.y + r.h / 2) / geo.h);
      await page.touchscreen.tap(box.x + u * box.width, box.y + v * box.height);
    }
    const idle = (page: Page) => expect(screen(page)).toHaveAttribute('data-fx', 'idle', { timeout: 15_000 });

    test('the canvas fills the screen and taps land on PLAY, a room card and the fight buttons', async ({ page }, info) => {
      test.skip(info.project.name !== 'desktop-chromium', 'sets its own device; once is enough');
      // A 2340x1080 CRT pass on software GL is slow when the suite runs in parallel.
      test.setTimeout(120_000);
      const errors: Error[] = [];
      page.on('pageerror', (e) => errors.push(e));
      await seedSettings(page, { tutorialSeen: true });
      await page.goto('/?seed=7'); // room 1 = H2 H9 D2 S10
      await expect(screen(page)).toHaveAttribute('data-screen', 'title', { timeout: 10_000 });

      const m = await page.evaluate(() => {
        const c = document.querySelector('#screen') as HTMLCanvasElement;
        const b = c.getBoundingClientRect();
        return { w: b.width, h: b.height, vw: window.innerWidth, vh: window.innerHeight, cw: c.width, ch: c.height };
      });
      const fill = (m.w * m.h) / (m.vw * m.vh);
      info.annotations.push({ type: 'fill', description: `${(fill * 100).toFixed(1)}% (${m.cw}x${m.ch} device px)` });
      expect(fill, 'canvas covers the viewport').toBeGreaterThan(0.95);
      // Logical size follows the aspect: the backing store is an exact 4x of 270 x 585.
      expect([m.cw, m.ch]).toEqual(name === 'portrait' ? [1080, 2340] : [2340, 1080]);

      await page.waitForTimeout(400);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `s22-${name}-title.png`) });

      await tapRect(page, frame.play);
      await expect(screen(page)).toHaveAttribute('data-screen', 'game', { timeout: 10_000 });
      await idle(page);
      await expect(screen(page)).toHaveAttribute('data-room', 'H2,H9,D2,S10');

      // Equip the 2 of diamonds (slot 2).
      await tapRect(page, { x: frame.roomX[2]!, y: frame.roomY, w: 56, h: 78 });
      await expect(screen(page)).toHaveAttribute('data-room', 'H2,H9,-,S10', { timeout: 10_000 });
      await idle(page);

      // The 10 of spades opens the weapon / fists choice; fight it with the 2 (10 - 2 = 8 damage).
      await tapRect(page, { x: frame.roomX[3]!, y: frame.roomY, w: 56, h: 78 });
      await page.waitForTimeout(300);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `s22-${name}-fight.png`) });
      await tapRect(page, frame.actions.fightWeapon);
      await expect(screen(page)).toHaveAttribute('data-hp', '12', { timeout: 10_000 });
      await expect(screen(page)).toHaveAttribute('data-room', 'H2,H9,-,-');
      await idle(page);
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `s22-${name}-game.png`) });
      expect(errors).toEqual([]);
    });
  });
}

test.describe('resize then tap before the next frame', () => {
  test.use({ viewport: { width: 892, height: 412 }, deviceScaleFactor: 1 });

  test('hitTest uses the new layout immediately after a resize', async ({ page }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'sets its own viewport; once is enough');
    await seedSettings(page, { tutorialSeen: true, crtEnabled: false });
    await page.goto('/?seed=7');
    await expect(screen(page)).toHaveAttribute('data-screen', 'title', { timeout: 10_000 });
    await page.waitForTimeout(200);

    const before = screenGeometry({ cssWidth: 892, cssHeight: 412, devicePixelRatio: 1, orientation: 'landscape' });
    const after = screenGeometry({ cssWidth: 1280, cssHeight: 720, devicePixelRatio: 1, orientation: 'landscape' });
    expect(before.w, 'the resize changes the logical size').not.toBe(after.w);
    const oldF = frameFor('landscape', { w: before.w, h: before.h }, before.safe);
    const newF = frameFor('landscape', { w: after.w, h: after.h }, after.safe);
    // A point just inside the left edge of PLAY in the new layout...
    const u = (newF.play.x + 3) / after.w;
    const v = (newF.play.y + newF.play.h / 2) / after.h;
    // ...that maps outside PLAY and TUTORIAL when read with the previous logical size (so a stale layout misses).
    const inRect = (r: Rect, x: number, y: number): boolean => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
    expect(inRect(oldF.play, u * before.w, v * before.h) || inRect(oldF.tutorial, u * before.w, v * before.h)).toBe(false);

    // Tap from inside the resize event itself (after the app's own resize listener, before any animation frame).
    await page.evaluate(([tu, tv]) => {
      const w = window as unknown as { __tapFrames?: number };
      w.__tapFrames = -1;
      let frames = 0;
      const count = (): void => {
        frames++;
        requestAnimationFrame(count);
      };
      requestAnimationFrame(count);
      window.addEventListener('resize', () => {
        const c = document.querySelector('#screen') as HTMLCanvasElement;
        const b = c.getBoundingClientRect();
        const at = { clientX: b.x + tu! * b.width, clientY: b.y + tv! * b.height, bubbles: true, cancelable: true, pointerType: 'mouse', isPrimary: true };
        const start = frames;
        c.dispatchEvent(new PointerEvent('pointerdown', at));
        w.__tapFrames = frames - start;
      }, { once: true });
    }, [u, v]);
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(screen(page)).toHaveAttribute('data-screen', 'game', { timeout: 5_000 });
    expect(await page.evaluate(() => (window as unknown as { __tapFrames?: number }).__tapFrames)).toBe(0);
  });
});