/**
 * Entry point: boot the app on #screen. `?seed=123` fixes the first dungeon's shuffle (e2e, sharing runs).
 */
import { createApp } from './ui/app';

function seedFromUrl(): number | undefined {
  const raw = new URLSearchParams(window.location.search).get('seed');
  if (raw === null || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n >>> 0 : undefined;
}

const canvas = document.querySelector<HTMLCanvasElement>('#screen');
if (canvas) {
  const seed = seedFromUrl();
  const app = createApp(seed === undefined ? { canvas } : { canvas, seed });
  app.start();
}
