/**
 * Render fallback and CRT hit-testing (Adama's render-ui approval follow-ups a and c). Folded in from the scratch
 * probes fallback-probe.mjs (Tyrol) and reprobe.mjs (Adama).
 *
 * Contract: the display canvas (#screen) only ever gets a 2D context. The CRT renders on its own detached WebGL
 * canvas; any WebGL failure (compile, link, createProgram, no context, getContext throwing, context loss) falls
 * back to a plain blit, so every frame is still lit. hitTest warps only while the CRT is actually presenting.
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { litFraction, seedSettings, toCss } from './util';

declare global {
  interface Window {
    __gls: WebGLRenderingContext[];
    __ctxKinds: { t: string; display: boolean; ok: boolean }[];
    __ext: WEBGL_lose_context | null;
  }
}

/** Records every getContext call (kind, whether it was the display canvas) and keeps WebGL contexts. */
const track = (): void => {
  window.__gls = [];
  window.__ctxKinds = [];
  const o = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, t: string, ...a: unknown[]) {
    // Record before calling, so a request is seen even when a (scenario) getContext throws.
    const rec = { t: String(t), display: this.id === 'screen', ok: false };
    window.__ctxKinds.push(rec);
    const c = (o as (...x: unknown[]) => RenderingContext | null).call(this, t, ...a);
    rec.ok = !!c;
    if (c && String(t).startsWith('webgl')) window.__gls.push(c as WebGLRenderingContext);
    return c;
  } as typeof HTMLCanvasElement.prototype.getContext;
};

/** Forced failures, injected before any app script runs. Each is a self-contained function (serialised). */
const SCENARIOS: Record<string, () => void> = {
  shaderCompileFail: () => {
    const P = WebGLRenderingContext.prototype;
    const o = P.getShaderParameter;
    P.getShaderParameter = function (this: WebGLRenderingContext, s: WebGLShader, p: number) {
      return p === this.COMPILE_STATUS ? false : o.call(this, s, p);
    };
  },
  fragmentCompileFailOnly: () => {
    const P = WebGLRenderingContext.prototype;
    const o = P.getShaderParameter;
    const os = P.shaderSource;
    const frag = new WeakSet<WebGLShader>();
    P.shaderSource = function (this: WebGLRenderingContext, s: WebGLShader, src: string) {
      if (src.includes('gl_FragColor')) frag.add(s);
      return os.call(this, s, src);
    };
    P.getShaderParameter = function (this: WebGLRenderingContext, s: WebGLShader, p: number) {
      return p === this.COMPILE_STATUS && frag.has(s) ? false : o.call(this, s, p);
    };
  },
  linkFail: () => {
    const P = WebGLRenderingContext.prototype;
    const o = P.getProgramParameter;
    P.getProgramParameter = function (this: WebGLRenderingContext, s: WebGLProgram, p: number) {
      return p === this.LINK_STATUS ? false : o.call(this, s, p);
    };
  },
  createProgramNull: () => {
    WebGLRenderingContext.prototype.createProgram = function (): WebGLProgram {
      return null as unknown as WebGLProgram;
    };
  },
  noWebgl: () => {
    const o = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, t: string, ...a: unknown[]) {
      return String(t).startsWith('webgl') ? null : (o as (...x: unknown[]) => RenderingContext | null).call(this, t, ...a);
    } as typeof HTMLCanvasElement.prototype.getContext;
  },
  webglThrows: () => {
    const o = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, t: string, ...a: unknown[]) {
      if (String(t).startsWith('webgl')) throw new Error('boom');
      return (o as (...x: unknown[]) => RenderingContext | null).call(this, t, ...a);
    } as typeof HTMLCanvasElement.prototype.getContext;
  },
};

const LIT = 0.2;

async function boot(context: BrowserContext, scenario?: () => void): Promise<{ page: Page; errors: string[] }> {
  // Scenario first, tracker second: the tracker wraps the sabotaged getContext and sees every request.
  if (scenario) await context.addInitScript(scenario);
  await context.addInitScript(track);
  const page = await context.newPage();
  await seedSettings(page, { tutorialSeen: true }); // Enter on the title means PLAY, not the tutorial offer
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/?seed=7');
  await expect(page.locator('canvas#screen')).toBeVisible();
  return { page, errors };
}

async function displayWebglRequests(page: Page): Promise<number> {
  return page.evaluate(() => window.__ctxKinds.filter((k) => k.display && k.t.startsWith('webgl')).length);
}

test.describe('render fallback: every failure still presents a lit frame', () => {
  test.use({ reducedMotion: 'reduce' });

  test('normal: lit, and the display canvas never asks for WebGL (the CRT uses its own canvas)', async ({ context }) => {
    const { page, errors } = await boot(context);
    await expect.poll(() => litFraction(page)).toBeGreaterThan(LIT);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2_000);
    expect(await litFraction(page)).toBeGreaterThan(LIT);
    // Sanity: the tracker really saw the CRT's WebGL context (else the next assertion proves nothing).
    expect(await page.evaluate(() => window.__gls.length)).toBeGreaterThan(0);
    expect(await displayWebglRequests(page)).toBe(0);
    expect(errors).toEqual([]);
  });

  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    test(`${name}: title and game are lit, no page errors, display canvas never asks for WebGL`, async ({ context }) => {
      const { page, errors } = await boot(context, scenario);
      await expect.poll(() => litFraction(page)).toBeGreaterThan(LIT);
      await page.keyboard.press('Enter');
      await page.waitForTimeout(2_000);
      expect(await litFraction(page), 'game frame lit').toBeGreaterThan(LIT);
      expect(await displayWebglRequests(page)).toBe(0);
      expect(errors).toEqual([]);
    });
  }

  test('context lost mid-game: still lit and playable; restored: lit again', async ({ context }) => {
    const { page, errors } = await boot(context);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2_000);
    const lost = await page.evaluate(() => {
      const g = window.__gls[0];
      if (!g) return false;
      window.__ext = g.getExtension('WEBGL_lose_context');
      window.__ext?.loseContext();
      return !!window.__ext;
    });
    expect(lost, 'WEBGL_lose_context available').toBe(true);
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.__gls[0]!.isContextLost())).toBe(true);
    expect(await litFraction(page), 'lit while lost').toBeGreaterThan(LIT);
    await page.keyboard.press('1');
    await page.waitForTimeout(1_200);
    expect(await litFraction(page), 'lit after an action while lost').toBeGreaterThan(LIT);
    await page.evaluate(() => window.__ext!.restoreContext());
    await page.waitForTimeout(600);
    expect(await litFraction(page), 'lit after restore').toBeGreaterThan(LIT);
    expect(await displayWebglRequests(page)).toBe(0);
    expect(errors).toEqual([]);
  });
});

/**
 * Hit-testing under CRT curvature (landscape only: the logical points are in the 480x270 frame).
 * Seed 7, room 1 = H2 H9 D2 S10. Point A (178.5,69) lies in the gap between slot 1 and slot 2 on the flat image,
 * but the curved CRT draws slot 2 there. Point B (168.8,69) lies inside slot 1 on the flat image, but the curve
 * shows a gap there. So with the CRT on, A must hit and B must miss; with it off (or lost) the reverse.
 * A hover changes the frame (highlight/tooltip), so "hits" = the screenshot changes when the pointer moves there.
 */
test.describe('hit-testing follows the CRT curvature', () => {
  test.use({ viewport: { width: 960, height: 540 }, reducedMotion: 'reduce' });

  const A: [number, number] = [178.5, 69];
  const B: [number, number] = [168.8, 69];

  async function hovers(page: Page, [lx, ly]: [number, number]): Promise<boolean> {
    const [bx, by] = await toCss(page, 5, 262); // a neutral corner
    await page.mouse.move(bx, by);
    await page.waitForTimeout(800);
    const before = await page.locator('#screen').screenshot();
    const [x, y] = await toCss(page, lx, ly);
    await page.mouse.move(x, y);
    await page.waitForTimeout(250);
    const after = await page.locator('#screen').screenshot();
    return !before.equals(after);
  }

  test('CRT on: A hits, B misses; CRT off: A misses, B hits; context lost: unwarped; restored: warped again', async ({ context }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'landscape layout only');
    test.setTimeout(90_000);
    const { page, errors } = await boot(context);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2_500);

    // Control: a neutral-to-neutral move must not change the frame, else "hovers" is meaningless.
    expect(await hovers(page, [5, 262]), 'neutral move changes nothing').toBe(false);

    expect(await hovers(page, A), 'CRT on: A hits').toBe(true);
    expect(await hovers(page, B), 'CRT on: B misses').toBe(false);

    await page.keyboard.press('c'); // CRT off
    await page.waitForTimeout(2_200); // toast fades
    expect(await hovers(page, A), 'CRT off: A misses').toBe(false);
    expect(await hovers(page, B), 'CRT off: B hits').toBe(true);
    await page.keyboard.press('c'); // CRT back on
    await page.waitForTimeout(2_200);

    await page.evaluate(() => {
      window.__ext = window.__gls[0]!.getExtension('WEBGL_lose_context');
      window.__ext!.loseContext();
    });
    await page.waitForTimeout(400);
    expect(await hovers(page, A), 'lost: A misses').toBe(false);
    expect(await hovers(page, B), 'lost: B hits').toBe(true);

    await page.evaluate(() => window.__ext!.restoreContext());
    await page.waitForTimeout(600);
    expect(await hovers(page, A), 'restored: A hits again').toBe(true);
    expect(errors).toEqual([]);
  });

  test('with a forced shader failure the image is flat, so hit-testing must not warp', async ({ context }, info) => {
    test.skip(info.project.name !== 'desktop-chromium', 'landscape layout only');
    const { page } = await boot(context, SCENARIOS['linkFail']);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2_500);
    expect(await hovers(page, A), 'flat: A misses').toBe(false);
    expect(await hovers(page, B), 'flat: B hits').toBe(true);
  });
});
