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

function createMeter({ kind, label, value }: MeterDefinition) {
  const meter = document.createElement('div');
  meter.className = `survival-meter survival-meter--${kind}`;
  meter.setAttribute('aria-label', `${label} ${value}`);
  meter.innerHTML = `
    <div class="survival-meter__dial" aria-hidden="true">
      <img class="survival-meter__asset" src="${import.meta.env.BASE_URL}dst/ui/status/status_${kind}.tex.png" alt="" />
    </div>
    <output class="survival-meter__value">${value}</output>
  `;
  return meter;
}

export function mountStatusHUD() {
  if (document.querySelector('.survival-hud')) return;

  const hud = document.createElement('section');
  hud.className = 'survival-hud';
  hud.setAttribute('aria-label', '生存状态');
  hud.innerHTML = `
    <div class="survival-hud__calendar">
      <div class="world-clock" aria-label="世界第 32 日">
        <div class="world-clock__moon" aria-hidden="true"><i></i></div>
        <div class="world-clock__link" aria-hidden="true"><i></i><i></i></div>
        <div class="world-clock__dial" aria-hidden="true">
          <img class="world-clock__hand" src="${import.meta.env.BASE_URL}dst/ui/status/clock_hand.tex.png" alt="" />
          <span class="world-clock__copy"><b>世界</b><strong>32日</strong></span>
        </div>
      </div>
      <div class="season-clock" aria-label="当前季节：冬">
        <img class="season-clock__hand" src="${import.meta.env.BASE_URL}dst/ui/status/clock_hand.tex.png" alt="" />
        <strong>冬</strong>
      </div>
    </div>
    <div class="survival-hud__meters"></div>
    <div class="temperature" aria-label="温度 45 度">
      <span class="temperature__face" aria-hidden="true"><i></i></span>
      <output>45°</output>
    </div>
  `;

  const meterRow = hud.querySelector<HTMLElement>('.survival-hud__meters')!;
  meters.forEach((meter) => meterRow.append(createMeter(meter)));
  document.body.append(hud);
}

mountStatusHUD();
