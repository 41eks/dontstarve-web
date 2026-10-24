import { createSanityState } from '@dontstarve-web/signals';
import { Sanity } from '../../componets/src/sanity';
import { SanityVignette } from '../src/sanity-vignette';

export async function checkSanityVignette() {
  const current = createSanityState(200, 200);
  const sanity = new Sanity({ components: { inventory: { GetEquippedItem: () => null } }, hasTag: () => false }, current);
  const vignette = await SanityVignette.create(sanity.sane, '/dst/data/anim');
  document.body.append(vignette.canvas);
  const context = vignette.canvas.getContext('2d')!;
  const pixels = () => context.getImageData(0, 0, 1280, 720).data;
  const basic = pixels();
  current.set(20);
  // Sanity state effect and its presentation effect settle in separate microtasks.
  await Promise.resolve(); await Promise.resolve();
  const initialFrame = vignette.canvas.dataset.frame;
  const insane = pixels();
  let edgeRedPixels = 0, centreAlpha = 0;
  for (let y = 0; y < 720; y++) for (let x = 0; x < 1280; x++) {
    const i = (y * 1280 + x) * 4;
    if (x > 480 && x < 800 && y > 270 && y < 450) centreAlpha = Math.max(centreAlpha, insane[i + 3]);
    if ((x < 128 || x >= 1152 || y < 72 || y >= 648)
      && insane[i + 3] > 20 && insane[i] > insane[i + 1] + 25 && insane[i] > insane[i + 2] + 25) edgeRedPixels++;
  }
  vignette.update(1 / 12);
  const animated = pixels().some((v, i) => v !== insane[i]);
  const advancedFrame = vignette.canvas.dataset.frame;
  const beforePause = pixels();
  vignette.update(0);
  const paused = pixels().every((v, i) => v === beforePause[i]);
  // Recovery within the hysteresis band leaves the UI animation running.
  current.set(32);
  await Promise.resolve(); await Promise.resolve();
  const stillInsane = vignette.canvas.dataset.animation;
  current.set(35);
  await Promise.resolve(); await Promise.resolve();
  const restored = pixels().every((v, i) => v === basic[i]);
  const restoredAnimation = vignette.canvas.dataset.animation;
  const hit = document.elementFromPoint(10, 10);
  const blocksInput = hit === vignette.canvas;
  vignette.dispose();
  current.set(0);
  await Promise.resolve(); await Promise.resolve();
  vignette.update(1);
  const disposed = !vignette.canvas.isConnected && vignette.canvas.width === 0
    && vignette.canvas.dataset.animation === restoredAnimation;
  sanity.dispose();
  return { edgeRedPixels, centreAlpha, initialFrame, advancedFrame, animated, paused, stillInsane, restored, restoredAnimation, blocksInput, disposed };
}
