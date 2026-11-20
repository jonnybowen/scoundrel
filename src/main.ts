/**
 * Entry point. Until createApp is implemented, draws a placeholder so the build and e2e smoke test have
 * something to load. Replace the placeholder with `createApp({ canvas, seed }).start()`.
 */
import { LOGICAL_HEIGHT, LOGICAL_WIDTH } from './render/types';

function drawPlaceholder(canvas: HTMLCanvasElement): void {
  canvas.width = LOGICAL_WIDTH;
  canvas.height = LOGICAL_HEIGHT;
  canvas.style.width = `${LOGICAL_WIDTH * 2}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.fillStyle = '#0b0b12';
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
  ctx.fillStyle = '#e8d8a8';
  ctx.font = '16px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('SCOUNDREL', LOGICAL_WIDTH / 2, LOGICAL_HEIGHT / 2);
}

const canvas = document.querySelector<HTMLCanvasElement>('#screen');
if (canvas) drawPlaceholder(canvas);
