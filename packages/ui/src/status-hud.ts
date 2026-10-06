import { AssetElement } from './assets';
import { INITIAL_CLOCK_STATE, WorldClock, type WorldClockState } from './world-clock';
import styles from './styles/status-hud.css?inline';

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
  private clock?: WorldClock;
  private clockState: WorldClockState = INITIAL_CLOCK_STATE;
  private stats = Object.fromEntries(meters.map(({ kind, value }) => [kind, value]));

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  disconnectedCallback(): void {
    this.clock?.dispose();
    this.clock = undefined;
  }

  setClock(state: WorldClockState, dt = 0): void {
    this.clockState = { ...state };
    this.clock?.update(this.clockState, dt);
  }

  setStats(stats: { health: number; hunger: number; sanity: number }): void {
    this.stats = { ...stats };
    for (const { kind, label } of meters) {
      const meter = this.shadowRoot?.querySelector(`.survival-meter--${kind}`);
      const value = Math.round(this.stats[kind]);
      meter?.setAttribute('aria-label', `${label} ${value}`);
      const output = meter?.querySelector('output');
      if (output) output.textContent = String(value);
    }
  }

  protected render(): void {
    this.clock?.dispose();
    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>${styles}</style>
      <section class="survival-hud" aria-label="生存状态">
        <div class="survival-hud__calendar">
          <div class="world-clock" role="img" tabindex="0" aria-label="世界第 ${this.clockState.cycles + 1} 日">
            <canvas class="world-clock__animation" aria-hidden="true"></canvas>
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

    this.clock = new WorldClock(root.querySelector<HTMLCanvasElement>('.world-clock__animation')!, this.dataAsset(''));
    this.clock.update(this.clockState);

    const meterRow = root.querySelector<HTMLElement>('.survival-hud__meters')!;
    meters.forEach((meter) => meterRow.append(this.createMeter({ ...meter, value: Math.round(this.stats[meter.kind]) })));
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
