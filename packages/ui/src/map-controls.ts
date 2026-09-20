import { AssetElement } from './assets';
import styles from './styles/map-controls.css?inline';

export type CameraTurnDirection = 'left' | 'right';

export class DstMapControlsElement extends AssetElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  protected render(): void {
    const root = this.shadowRoot!;
    root.innerHTML = `
      <style>${styles}</style>
      <section class="map-controls" aria-label="地图控制">
        <button class="map-controls__map" type="button" aria-label="打开地图" aria-pressed="false">
          <img src="${this.asset('map/map_button.tex.png')}" alt="" draggable="false" />
        </button>
        <div class="map-controls__actions">
          <button class="map-controls__turn map-controls__turn--left" type="button" aria-label="向左旋转视角">
            <img src="${this.asset('map/turnarrow_icon.png')}" alt="" draggable="false" />
          </button>
          <button class="map-controls__pause" type="button" aria-label="暂停游戏" aria-pressed="false">
            <img src="${this.asset('map/pause.png')}" alt="" draggable="false" />
          </button>
          <button class="map-controls__turn map-controls__turn--right" type="button" aria-label="向右旋转视角">
            <img src="${this.asset('map/turnarrow_icon.png')}" alt="" draggable="false" />
          </button>
        </div>
      </section>
    `;

    const mapButton = root.querySelector<HTMLButtonElement>('.map-controls__map')!;
    const pauseButton = root.querySelector<HTMLButtonElement>('.map-controls__pause')!;

    mapButton.addEventListener('click', () => {
      const isOpen = mapButton.getAttribute('aria-pressed') !== 'true';
      mapButton.setAttribute('aria-pressed', String(isOpen));
      mapButton.setAttribute('aria-label', isOpen ? '关闭地图' : '打开地图');
      this.emit('game:map-toggle', { isOpen });
    });

    pauseButton.addEventListener('click', () => {
      const isPaused = pauseButton.getAttribute('aria-pressed') !== 'true';
      pauseButton.setAttribute('aria-pressed', String(isPaused));
      pauseButton.setAttribute('aria-label', isPaused ? '继续游戏' : '暂停游戏');
      this.emit('game:pause-toggle', { isPaused });
    });

    root.querySelectorAll<HTMLButtonElement>('.map-controls__turn').forEach((button) => {
      button.addEventListener('click', () => {
        const direction: CameraTurnDirection = button.classList.contains('map-controls__turn--left')
          ? 'left'
          : 'right';
        this.emit('game:camera-turn', { direction });
      });
    });
  }

  private emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail }));
  }
}
