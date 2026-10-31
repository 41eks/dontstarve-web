import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { MinimapIconView } from '../../ui/src/minimap-icon-view';
import { MinimapView } from '../../ui/src/minimap-view';
import type { MiniMapMarker } from '../../map/src/minimapEntities';
import type { MinimapIcon } from '../../map/src/minimapIcons';
import { MinimapIcons } from '../../map/src/minimapIcons';
import { readFile } from 'node:fs/promises';

const image = {} as HTMLImageElement;
const icon: MinimapIcon = { image, imageUrl: 'blob:atlas', x: 40, y: 80, width: 64, height: 128, atlasWidth: 512, atlasHeight: 512 };
const marker = (x = 0, z = 0, priority = 0): MiniMapMarker => ({ position: new Vector3(x, 0, z), priority,
  icon: 'willow.png', enabled: true, canUseCache: false, drawOverFogOfWar: true });
const context = { setTransform: vi.fn(), clearRect: vi.fn(), drawImage: vi.fn() };
let frames: Map<number, FrameRequestCallback>, nextFrame: number;
const flush = () => {
  const pending = [...frames.values()]; frames.clear();
  for (const callback of pending) callback(0);
};

beforeEach(() => {
  vi.clearAllMocks(); frames = new Map(); nextFrame = 0;
  vi.stubGlobal('window', { devicePixelRatio: 2 });
  vi.stubGlobal('document', { createElement: () => ({ style: {}, width: 0, height: 0,
    append: vi.fn(), remove: vi.fn(), getContext: () => context }) });
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('scales upright atlas icons with the terrain at DPR 2 and draws stable source priorities above terrain', () => {
  const display = new MinimapIconView(), view = new MinimapView(1000, 800, 600);
  const low = marker(0, 0, -1), high = marker(0, 0, 10);
  const square = { ...icon, x: 120, height: 64 };
  display.set(high, square); display.set(low, icon);
  display.start();
  for (const [heading, zoom] of [[-90, 1], [45, 8], [135, 20]]) {
    view.heading = heading; view.zoom = zoom; view.center(2, -3);
    display.update(view); flush();
    const point = view.worldToScreen(0, 0);
    const size = 32 * 3 / zoom;
    expect(context.drawImage.mock.calls.slice(-2)).toEqual([
      [image, 40, 80, 64, 128, point.x - size / 2, point.z - size, size, size * 2],
      [image, 120, 80, 64, 64, point.x - size / 2, point.z - size / 2, size, size],
    ]);
    expect(display.canvas.width).toBe(1600); expect(display.canvas.height).toBe(1200);
    expect(context.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
  }
  const raised = marker(0, 0, 20);
  display.delete(low); display.set(raised, icon); flush();
  expect(context.drawImage.mock.calls.slice(-2).map(call => call[1])).toEqual([120, 40]);
  display.dispose();
});

it('keeps partially visible icons and culls fully offscreen icons after rotation, pan and zoom', () => {
  const display = new MinimapIconView(), view = new MinimapView(1000, 800, 600);
  view.heading = 45; view.zoom = 8; view.center(50, -30);
  const edge = view.screenToWorld(-5, 200), outside = view.screenToWorld(-7, 200);
  display.set(marker(edge.x, edge.z), icon); display.set(marker(outside.x, outside.z), icon);
  display.update(view); display.start(); flush();
  expect(context.drawImage).toHaveBeenCalledTimes(1);
  expect(context.drawImage.mock.calls[0][5]).toBeCloseTo(-11);
  view.pan(50, 0); display.update(view); flush();
  expect(context.drawImage).toHaveBeenCalledTimes(3);
  display.dispose();
});

it('coalesces entity and view updates, retains sampled positions while closed and releases pending draws', () => {
  const display = new MinimapIconView(), view = new MinimapView(1000, 800, 600), entity = marker();
  display.set(entity, icon); display.update(view); display.start();
  display.update(view); display.set(entity, icon);
  expect(frames.size).toBe(1); flush(); expect(frames.size).toBe(0);
  entity.position.set(20, 0, 30);
  // Moving the source vector alone does not bypass TileTracker notifications.
  display.update(view); flush();
  expect(context.drawImage.mock.lastCall?.slice(5)).toEqual([384, 268, 32, 64]);
  display.set(entity, icon); display.stop();
  expect(frames.size).toBe(0); expect([...display.entities()]).toContain(entity);
  display.update(view); expect(frames.size).toBe(0);
  display.start(); flush();
  const point = view.worldToScreen(20, 30);
  expect(context.drawImage.mock.lastCall?.slice(5)).toEqual([point.x - 16, point.z - 32, 32, 64]);
  display.delete(entity); flush();
  expect([...display.entities()]).not.toContain(entity);
  display.set(entity, icon); expect(frames.size).toBe(1);
  display.dispose(); display.start(); display.update(view); display.set(entity, icon);
  expect(frames.size).toBe(0); expect(display.canvas.width).toBe(0); expect(display.canvas.height).toBe(0);
  expect([...display.entities()]).toEqual([]);
});

it('prewarms two shared atlas images, reuses them across icon requests and releases their URLs', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(
    `../../../public${new URL(url).pathname}`, import.meta.url))));
  const decode = vi.fn(async () => {}), revoke = vi.spyOn(URL, 'revokeObjectURL');
  vi.stubGlobal('Image', class { src = ''; decode = decode; });
  vi.stubGlobal('ImageData', class {});
  vi.stubGlobal('OffscreenCanvas', class {
    getContext() { return { putImageData() {} }; }
    async convertToBlob() { return new Blob(['atlas']); }
  });
  const icons = new MinimapIcons('http://map.test/dst/data');
  const pending = icons.prewarm();
  expect(icons.prewarm()).toBe(pending);
  await pending;
  expect(icons.ready).toBe(true); expect(decode).toHaveBeenCalledTimes(2);
  const player = icons.get(icons.index('willow.png'))!, backpack = icons.get(icons.index('backpack.png'))!;
  expect(player.image).toBe(backpack.image); expect(player.imageUrl).toBe(backpack.imageUrl);
  expect(player.width).toBeGreaterThan(0); expect(player.height).toBeGreaterThan(0);
  await icons.prewarm(); expect(decode).toHaveBeenCalledTimes(2);
  icons.dispose();
  expect(revoke).toHaveBeenCalledTimes(2); expect(icons.ready).toBe(false);
  expect(icons.index('willow.png')).toBeUndefined();
  const completions: (() => void)[] = [];
  decode.mockImplementation(() => new Promise<void>(resolve => { completions.push(resolve); }));
  const interrupted = new MinimapIcons('http://map.test/dst/data'), preparing = interrupted.prewarm();
  await vi.waitFor(() => expect(completions).toHaveLength(2));
  interrupted.dispose();
  for (const resolve of completions) resolve();
  await preparing;
  expect(interrupted.ready).toBe(false); expect(interrupted.index('willow.png')).toBeUndefined();
  expect(revoke).toHaveBeenCalledTimes(4);
});
