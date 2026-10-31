import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import { createSignal } from '../../signals/src';
import { MiniMapEntity } from '../../prefab/src/minimapEntity';
import { MinimapDomRenderer } from '../../ui/src/minimap-dom';
import { MinimapView } from '../../ui/src/minimap-view';
import type { MinimapOptions } from '../../ui/src/minimap';

vi.mock('../../map/src/miniMapRenderer', () => ({ MiniMapRenderer: class {
  readonly canvas = {};
  ready = true;
  start() {} stop() {} update() {} dispose() {} isLandAt() { return true; }
  async prepare() {}
} }));
vi.mock('../../map/src/minimapIcons', () => ({ MinimapIcons: class {
  ready = false;
  readonly region = { image: {}, x: 0, y: 0, width: 64, height: 64 };
  index(name: string) { return this.ready && name !== 'missing.png' ? 0 : undefined; }
  get(index: number | undefined) { return index === undefined ? undefined : this.region; }
  async prewarm() { this.ready = true; }
  dispose() { this.ready = false; }
} }));

let frames: Map<number, FrameRequestCallback>, nextFrame: number;
const flush = () => { const pending = [...frames.values()]; frames.clear(); for (const fn of pending) fn(-100); };
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
const options = (): MinimapOptions => ({ terrain: {} as MinimapOptions['terrain'], cellSize: 12,
  getPlayerPosition: () => ({ x: 0, z: 0 }), cameraHeading: createSignal(-90) });

beforeEach(() => {
  frames = new Map(); nextFrame = 0;
  vi.stubGlobal('window', { devicePixelRatio: 1, removeEventListener() {} });
  vi.stubGlobal('document', { baseURI: 'http://map.test/', createElement: () => ({ style: {}, width: 0, height: 0,
    append() {}, prepend() {}, remove() {}, getContext: () => ({ setTransform() {}, clearRect() {}, drawImage() {} }) }) });
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => { frames.set(++nextFrame, fn); return nextFrame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('reconciles declarations after prewarm and reopening, and stops draws on removal and disposal', async () => {
  const entity = new MiniMapEntity(new Vector3()); entity.SetIcon('willow.png');
  const renderer = new MinimapDomRenderer(options(), '/dst/data');
  try {
    renderer.start(); renderer.update(new MinimapView(1000, 800, 600));
    expect([...renderer.dom.entities()]).toHaveLength(0);
    await renderer.prepare(); await settle(); flush();
    expect([...renderer.dom.entities()]).toHaveLength(1);
    const identity = [...renderer.dom.entities()][0];
    entity.SetEnabled(false); await settle();
    expect([...renderer.dom.entities()]).toHaveLength(0);
    entity.SetEnabled(true); await settle();
    expect([...renderer.dom.entities()]).toEqual([identity]);
    entity.SetIcon('missing.png'); await settle();
    expect([...renderer.dom.entities()]).toHaveLength(0);
    renderer.stop(); expect(frames.size).toBe(0);
    entity.SetIcon('backpack.png'); entity.position.set(24, 0, -36); entity.tileTracker.sync(); await settle();
    expect([...renderer.dom.entities()]).toHaveLength(0);
    renderer.start();
    expect([...renderer.dom.entities()]).toEqual([identity]);
    expect(renderer.inspect()).toMatchObject({ ready: true, icons: ['willow.png', 'backpack.png'] });
    entity.dispose(); await settle(); flush();
    expect([...renderer.dom.entities()]).toHaveLength(0);
    renderer.dispose(); renderer.start();
    expect(renderer.isListening).toBe(false); expect(frames.size).toBe(0);
  } finally { entity.dispose(); renderer.dispose(); }
});

it('keeps cursor zoom monotonic with repeated input and stale RAF timestamps, then cancels on close', async () => {
  vi.stubGlobal('HTMLElement', class extends EventTarget { attachShadow() {} getAttribute() { return null; } });
  const { DstMinimapElement } = await import('../../ui/src/minimap');
  const map = new DstMinimapElement();
  const internals = map as any;
  let now = 100;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  map.bind({ ...options(), terrain: { cellRange: () => ({ min: -50, max: 50 }) } as MinimapOptions['terrain'] });
  internals.root = { clientWidth: 800, clientHeight: 600, classList: { toggle() {}, remove() {} },
    getBoundingClientRect: () => ({ left: 0, top: 0 }) };
  map.setOpen(true);
  try {
    for (const direction of [-1, 1]) {
      map.setView({ x: 0, z: 0, zoom: 3 });
      const anchor = map.view!.screenToWorld(420, 310);
      let previous = map.view!.zoom;
      for (let i = 0; i < 6; i++) {
        internals.onWheel({ preventDefault() {}, clientX: 420, clientY: 310, deltaY: direction * 100 });
        now += 20; flush();
        expect(direction * (map.view!.zoom - previous)).toBeGreaterThanOrEqual(0);
        expect(map.view!.screenToWorld(420, 310)).toEqual({ x: expect.closeTo(anchor.x), z: expect.closeTo(anchor.z) });
        previous = map.view!.zoom;
      }
      now += 100; flush(); flush(); expect(frames.size).toBe(0);
    }
    internals.onWheel({ preventDefault() {}, clientX: 420, clientY: 310, deltaY: -100 });
    const zoom = map.view!.zoom;
    map.setOpen(false); now += 100; flush();
    expect(map.view!.zoom).toBe(zoom); expect(frames.size).toBe(0);
  } finally { map.dispose(); }
});
