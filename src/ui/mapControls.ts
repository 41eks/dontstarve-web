const mapAsset = (name: string) => `${import.meta.env.BASE_URL}dst/ui/map/${name}`;

export function mountMapControls() {
  if (document.querySelector('.map-controls')) return;

  const controls = document.createElement('section');
  controls.className = 'map-controls';
  controls.setAttribute('aria-label', '地图控制');
  controls.innerHTML = `
    <button class="map-controls__map" type="button" aria-label="打开地图" aria-pressed="false">
      <img src="${mapAsset('map_button.tex.png')}" alt="" draggable="false" />
    </button>
    <div class="map-controls__actions">
      <button class="map-controls__turn map-controls__turn--left" type="button" aria-label="向左旋转视角">
        <img src="${mapAsset('turnarrow_icon.png')}" alt="" draggable="false" />
      </button>
      <button class="map-controls__pause" type="button" aria-label="暂停游戏" aria-pressed="false">
        <img src="${mapAsset('pause.png')}" alt="" draggable="false" />
      </button>
      <button class="map-controls__turn map-controls__turn--right" type="button" aria-label="向右旋转视角">
        <img src="${mapAsset('turnarrow_icon.png')}" alt="" draggable="false" />
      </button>
    </div>
  `;

  const mapButton = controls.querySelector<HTMLButtonElement>('.map-controls__map')!;
  const pauseButton = controls.querySelector<HTMLButtonElement>('.map-controls__pause')!;

  mapButton.addEventListener('click', () => {
    const isOpen = mapButton.getAttribute('aria-pressed') !== 'true';
    mapButton.setAttribute('aria-pressed', String(isOpen));
    mapButton.setAttribute('aria-label', isOpen ? '关闭地图' : '打开地图');
    window.dispatchEvent(new CustomEvent('game:map-toggle', { detail: { isOpen } }));
  });

  pauseButton.addEventListener('click', () => {
    const isPaused = pauseButton.getAttribute('aria-pressed') !== 'true';
    pauseButton.setAttribute('aria-pressed', String(isPaused));
    pauseButton.setAttribute('aria-label', isPaused ? '继续游戏' : '暂停游戏');
    window.dispatchEvent(new CustomEvent('game:pause-toggle', { detail: { isPaused } }));
  });

  controls.querySelectorAll<HTMLButtonElement>('.map-controls__turn').forEach((button) => {
    button.addEventListener('click', () => {
      const direction = button.classList.contains('map-controls__turn--left') ? 'left' : 'right';
      window.dispatchEvent(new CustomEvent('game:camera-turn', { detail: { direction } }));
    });
  });

  document.body.append(controls);
}

mountMapControls();
