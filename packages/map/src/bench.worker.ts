import { runBench, runThreeBench } from './bench';

type Request = { canvases: [string, OffscreenCanvas, boolean][] } | { three: OffscreenCanvas; heading: number };

self.onmessage = async ({ data }: MessageEvent<Request>) => {
  if ('three' in data) { (self as any).postMessage(await runThreeBench(data.three, data.heading)); return; }
  const screens = data.canvases.map(([name, canvas, willRead]) =>
    [name, canvas.getContext('2d', willRead ? { willReadFrequently: true } : undefined)!] as [string, OffscreenCanvasRenderingContext2D]);
  (self as any).postMessage(await runBench(screens));
};
