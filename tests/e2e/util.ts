/** Shared e2e helpers (owner: Tigh). */
import type { Page } from '@playwright/test';

export const SETTINGS_KEY = 'scoundrel.settings.v1';

/** Write settings into localStorage before the app boots (every navigation in this page). */
export async function seedSettings(page: Page, s: Record<string, unknown>): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      try {
        const prev = JSON.parse(localStorage.getItem(key as string) ?? '{}') as Record<string, unknown>;
        localStorage.setItem(key as string, JSON.stringify({ ...prev, ...(value as Record<string, unknown>) }));
      } catch {
        // storage blocked: nothing to seed
      }
    },
    [SETTINGS_KEY, s] as const,
  );
}

/** Logical point to page CSS coordinates on #screen. Assumes the 480x270 frame: use a 16:9 viewport (render/screen.ts). */
export async function toCss(page: Page, lx: number, ly: number): Promise<[number, number]> {
  const r = await page.evaluate(() => {
    const b = document.querySelector('#screen')!.getBoundingClientRect();
    return { x: b.x, y: b.y, w: b.width, h: b.height };
  });
  return [r.x + (lx / 480) * r.w, r.y + (ly / 270) * r.h];
}

/** Fraction of sampled display pixels that are not near-black, read back from the 2D display canvas. -1 if no 2D context. */
export async function litFraction(page: Page): Promise<number> {
  return page.evaluate(() => {
    const c = document.querySelector('#screen') as HTMLCanvasElement;
    const x = c.getContext('2d');
    if (!x) return -1;
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    let on = 0;
    for (let i = 0; i < d.length; i += 4 * 89) {
      n++;
      if (d[i]! + d[i + 1]! + d[i + 2]! > 60) on++;
    }
    return on / n;
  });
}
