import { createGeneratingWorldThreeStage } from './threeStage';

export type StageWorkerRequest =
  | {
      type: 'init';
      canvas: OffscreenCanvas;
      assetBaseUrl: string;
      isCave: boolean;
      width: number;
      height: number;
      pixelRatio: number;
    }
  | { type: 'resize'; width: number; height: number };

export type StageWorkerResponse = { type: 'ready' } | { type: 'error'; message: string };

const postMessage = (message: StageWorkerResponse): void => self.postMessage(message);

let stage: Awaited<ReturnType<typeof createGeneratingWorldThreeStage>> | undefined;
let size = { width: 1, height: 1 };

async function init(request: Extract<StageWorkerRequest, { type: 'init' }>) {
  try {
    const created = await createGeneratingWorldThreeStage(
      request.canvas,
      request.assetBaseUrl,
      request.isCave,
      request.pixelRatio,
    );
    stage = created;
    created.resize(size.width, size.height);
    created.render(0);
    postMessage({ type: 'ready' });

    let previous = performance.now();
    const tick = (time: number) => {
      created.render((time - previous) / 1000);
      previous = time;
      self.requestAnimationFrame(tick);
    };
    self.requestAnimationFrame(tick);
  } catch (reason) {
    postMessage({ type: 'error', message: reason instanceof Error ? reason.message : String(reason) });
  }
}

self.addEventListener('message', ({ data }: MessageEvent<StageWorkerRequest>) => {
  if (data.type === 'init') {
    size = { width: data.width, height: data.height };
    void init(data);
  } else {
    size = { width: data.width, height: data.height };
    stage?.resize(data.width, data.height);
  }
});
