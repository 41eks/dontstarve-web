import { loadImageAtlas, type ImageAtlas } from '@three-roaming/animation/imageAtlas';
import { AssetElement } from './assets';
import styles from './styles/status-hud.css?inline';

const atlasRequests = new Map<string, Promise<ImageAtlas>>();

function requestAtlas(archiveUrl: string, atlasPath: string) {
  const key = `${archiveUrl}\n${atlasPath}`;
  let request = atlasRequests.get(key);
  if (!request) {
    request = loadImageAtlas(archiveUrl, atlasPath);
    atlasRequests.set(key, request);
  }
  return request;
}

type MeterDefinition = {
  kind: 'hunger' | 'sanity' | 'health';
  label: string;
  value: number;
};

const meters: MeterDefinition[] = [
  { kind: 'hunger', label: '饱食度', value: 105 },
  { kind: 'sanity', label: '精神值', value: 35 },
  { kind: 'health', label: '生命值', value: 150 },
];

export class DstStatusHudElement extends AssetElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  protected render(): void {
    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>${styles}</style>
      <section class="survival-hud" aria-label="生存状态">
        <div class="survival-hud__calendar">
          <div class="world-clock" aria-label="世界第 32 日">
            <div class="world-clock__moon" aria-hidden="true"><i></i></div>
            <div class="world-clock__link" aria-hidden="true"><i></i><i></i></div>
            <div class="world-clock__dial" aria-hidden="true">
              <img class="world-clock__hand" src="${this.asset('status/clock_hand.tex.png')}" alt="" />
              <span class="world-clock__copy"><b>世界</b><strong>32日</strong></span>
            </div>
          </div>
          <div class="season-clock" aria-label="当前季节：冬">
            <img class="season-clock__hand" src="${this.asset('status/clock_hand.tex.png')}" alt="" />
            <strong>冬</strong>
          </div>
        </div>
        <div class="survival-hud__meters"></div>
        <div class="temperature" aria-label="温度 45 度">
          <span class="temperature__face" aria-hidden="true"><i></i></span>
          <output>45°</output>
        </div>
      </section>
    `;

    root.querySelector('.world-clock__dial')!.prepend(this.atlasImage(
      'world-clock__rim',
      'images/hud.xml',
      'clock_rim.tex',
    ));

    const meterRow = root.querySelector<HTMLElement>('.survival-hud__meters')!;
    meters.forEach((meter) => meterRow.append(this.createMeter(meter)));
  }

  private atlasImage(className: string, atlasPath: string, elementName: string): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    const archiveUrl = this.dataAsset('databundles/images.zip');
    canvas.className = className;
    canvas.width = 1;
    canvas.height = 1;
    canvas.dataset.archive = archiveUrl;
    canvas.dataset.atlas = atlasPath;
    canvas.dataset.element = elementName;
    canvas.setAttribute('aria-hidden', 'true');

    void requestAtlas(archiveUrl, atlasPath).then((atlas) => {
      if (!canvas.isConnected) return;
      const sprite = atlas.require(elementName);
      canvas.width = sprite.width;
      canvas.height = sprite.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Canvas 2D context is unavailable');
      context.putImageData(
        new ImageData(Uint8ClampedArray.from(sprite.pixels), sprite.width, sprite.height),
        0,
        0,
      );
      canvas.dataset.loaded = 'true';
    }).catch((error: unknown) => {
      canvas.dataset.error = error instanceof Error ? error.message : String(error);
      canvas.dispatchEvent(new Event('error'));
    });
    return canvas;
  }

  private createMeter({ kind, label, value }: MeterDefinition): HTMLElement {
    const meter = document.createElement('div');
    meter.className = `survival-meter survival-meter--${kind}`;
    meter.setAttribute('aria-label', `${label} ${value}`);
    meter.innerHTML = `
      <div class="survival-meter__dial" aria-hidden="true">
        <img class="survival-meter__asset" src="${this.asset(`status/status_${kind}.tex.png`)}" alt="" />
      </div>
      <output class="survival-meter__value">${value}</output>
    `;
    return meter;
  }
}
