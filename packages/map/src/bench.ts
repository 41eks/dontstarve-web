import { TurfMap, WORLD_TILES } from '../../prefab/src/turfMap';
import { MinimapTerrainLayer } from '../../ui/src/minimap-terrain-layer';
import { MinimapView } from '../../ui/src/minimap-view';
import { ThreeTerrainRenderer } from './three';
import { DomMap, type ChunkElement } from './dom';

type Context = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
const ms = (t: number) => Math.round(performance.now() - t);

/** `screens` are canvas contexts the caller prepared (e.g. transferred from the page). */
export async function prepareLayer(log: Record<string, unknown>, heading: number) {
  const small = new TurfMap(96, [], WORLD_TILES.DECIDUOUS);
  await small.createVisual('/dst/data');
  const tiles = [];
  for (let row = -395; row < 395; row++) for (let col = -395; col < 395; col++) {
    if ((col * 7 + row * 13) % 41 === 0) tiles.push({ col, row, tileId: WORLD_TILES.WOODFLOOR });
    else if (Math.abs(col) > 380 || Math.abs(row) > 380) tiles.push({ col, row, tileId: WORLD_TILES.OCEAN_COASTAL });
  }
  const big = new TurfMap(9480, tiles, WORLD_TILES.DECIDUOUS);
  big.tileLayerImages = () => small.tileLayerImages();
  big.minimapOcean = () => small.minimapOcean();
  let t = performance.now();
  const layer = new MinimapTerrainLayer(big, 12);
  await layer.prepare();
  log.prepareMs = ms(t);
  const view = new MinimapView((layer.max - layer.min) * 12, 1280, 720);
  view.zoom = 20;
  view.heading = heading;
  return { layer, view };
}

export async function runBench(screens: [string, Context][], heading = -90): Promise<Record<string, unknown>> {
  const log: Record<string, unknown> = {};
  const { layer, view } = await prepareLayer(log, heading);
  let jitter = 0;
  const draw = (context: Context) => {
    view.center(jitter += 1, 0);
    const start = performance.now();
    layer.draw(context, view);
    const recorded = ms(start);
    context.getImageData(0, 0, 1, 1);
    return { recorded, withFlush: ms(start) };
  };
  for (const [name, context] of [...screens, ['offscreen willRead', new OffscreenCanvas(1280, 720).getContext('2d', { willReadFrequently: true })!] as [string, Context]]) {
    log[name] = { first: draw(context), second: draw(context) };
  }
  log.done = true;
  return log;
}

/** Same terrain, drawn as WebGL textured quads. Times are in ms; `flush` waits for the GPU. */
export async function runThreeBench(canvas: HTMLCanvasElement | OffscreenCanvas, heading = -90): Promise<Record<string, unknown>> {
  const log: Record<string, unknown> = {};
  const { layer, view } = await prepareLayer(log, heading);
  let t = performance.now();
  const renderer = new ThreeTerrainRenderer(canvas, 12);
  renderer.resize(1280, 720);
  const chunks = [...(layer as any).overview.values()];
  renderer.setChunks(chunks);
  log.setupMs = ms(t);
  let jitter = 0;
  const frame = () => {
    view.center(jitter += 1, 0);
    const start = performance.now();
    renderer.render(view);
    const recorded = ms(start);
    renderer.flush();
    return { recorded, withFlush: ms(start) };
  };
  log.three = { first: frame(), second: frame(), third: frame() };
  log.chunks = chunks.length;
  log.done = true;
  return log;
}

/** Drives the DOM map through a zoom-and-pan sweep and reports main-thread cost and frame pacing. */
export async function runDomBench(host: HTMLElement, element: ChunkElement, heading = -90, iconCount = 200): Promise<Record<string, unknown>> {
  const log: Record<string, unknown> = {};
  const { layer, view } = await prepareLayer(log, heading);
  const map = new DomMap(host, 12, 1280, 720, view.worldSize);
  log.mountMs = await map.setChunks((layer as any).overview.values(), element);
  log.element = element;
  map.setIcons(Array.from({ length: iconCount }, (_, i) => ({ x: ((i * 37) % 800 - 400) * 12, z: ((i * 91) % 800 - 400) * 12 })));
  map.update(view);
  await new Promise(resolve => requestAnimationFrame(() => resolve(undefined)));
  const frames = 180, intervals: number[] = [], js: number[] = [];
  let previous = performance.now();
  for (let i = 0; i < frames; i++) {
    await new Promise<void>(resolve => requestAnimationFrame(now => {
      intervals.push(now - previous); previous = now;
      const phase = i / frames;
      view.zoomAt(640, 360, 20 - 17 * Math.sin(phase * Math.PI));
      view.pan(3, 1);
      const start = performance.now();
      map.update(view);
      js.push(performance.now() - start);
      resolve();
    }));
  }
  const stats = (values: number[]) => {
    const sorted = [...values].sort((x, y) => x - y);
    return { mean: +(values.reduce((s, v) => s + v, 0) / values.length).toFixed(2), p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(2), max: +sorted[sorted.length - 1].toFixed(2) };
  };
  log.frameIntervalMs = stats(intervals);
  log.updateJsMs = stats(js);
  log.final = { zoom: view.zoom };
  log.done = true;
  return log;
}
