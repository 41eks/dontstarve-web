import type { ItemEntity } from '@dontstarve-web/inventory';
import catalog from './groundItems.json' with { type: 'json' };
import { createSignal, readonlySignal } from '@dontstarve-web/signals';
import { Heater } from '../../componets/src/heater';

export const HEATROCK_ID = 'heatrock';
export const HEATROCK_FUEL = 100;
export const HEATROCK_IMAGES = catalog.items.heatrock.inventoryImageVariants;

const THRESHOLDS = [-30, -10, 10, 30];
const EMITTED_TEMPERATURES = [-10, 10, 25, 40, 60];
export function GetHeatRockRange(temperature: number, ambient: number): number {
  return 1 + THRESHOLDS.filter(threshold => temperature > ambient + threshold).length;
}

/** heatrock.lua TemperatureChange owns extremum tracking and charge consumption. */
export class HeatRock {
  private readonly rangeState = createSignal(3);
  readonly range = readonlySignal(this.rangeState);
  private readonly stopTemperature: () => void;
  private readonly temperature;
  private readonly heater;
  private readonly entity: ItemEntity;
  constructor(entity: ItemEntity) {
    this.entity = entity;
    this.temperature = entity.AddTemperature();
    this.temperature.inherentinsulation = 120;
    this.temperature.inherentsummerinsulation = 120;
    this.temperature.IgnoreTags('heatrock');
    this.heater = entity.components.heater = entity.component('heater', () => new Heater(entity));
    this.heater.SetThermics(false, false);
    this.heater.SetHeatFn(() => {
      const range = GetHeatRockRange(this.temperature.GetCurrent(), this.temperature.GetAmbientTemperature());
      this.heater.SetThermics(range >= 4, range <= 2);
      return EMITTED_TEMPERATURES[range - 1];
    });
    this.stopTemperature = entity.ListenForEvent('temperaturedelta', data => this.TemperatureChange((data as { hasrate?: boolean })?.hasrate === true));
    // Evaluate restored temperature without spending a charge; fresh stones remain neutral.
    this.TemperatureChange(false);
    this.RefreshImage();
  }
  RefreshImage(): void {
    const imageName = `${this.entity.skinId ?? 'heat_rock'}${this.rangeState.peek()}.tex`;
    const image = HEATROCK_IMAGES[imageName as keyof typeof HEATROCK_IMAGES];
    if (!image) throw new Error(`Missing thermal stone image: ${imageName}`);
    this.entity.components.inventoryitem.ChangeImageName(image.icon, image.atlas);
  }
  private TemperatureChange(hasrate: boolean): void {
    const current = this.temperature.GetCurrent(), ambient = this.temperature.GetAmbientTemperature();
    const range = GetHeatRockRange(current, ambient), entity = this.entity;
    if (range <= 1) {
      if (entity.lowTemp === undefined || entity.lowTemp > current) entity.lowTemp = Math.floor(current);
      entity.highTemp = undefined;
    } else if (range >= 5) {
      if (entity.highTemp === undefined || entity.highTemp < current) entity.highTemp = Math.ceil(current);
      entity.lowTemp = undefined;
    } else if (entity.lowTemp !== undefined) {
      if (GetHeatRockRange(entity.lowTemp, ambient) >= 3) entity.lowTemp = undefined;
    } else if (entity.highTemp !== undefined && GetHeatRockRange(entity.highTemp, ambient) <= 3) entity.highTemp = undefined;
    if (range === this.rangeState.peek()) return;
    this.rangeState.set(range);
    this.RefreshImage();
    if (hasrate && ((entity.lowTemp !== undefined && range >= 3) || (entity.highTemp !== undefined && range <= 3))) {
      entity.lowTemp = undefined; entity.highTemp = undefined;
      const fuel = Math.max(0, (entity.components.fueled.remaining ?? HEATROCK_FUEL) - HEATROCK_FUEL / 8);
      entity.components.fueled.remaining = fuel;
      if (fuel === 0) { entity.remove(); return; }
    }
    entity.components.inventoryitem.owner?.changed();
  }
  dispose(): void { this.stopTemperature(); }
}

export function configureHeatRockEntity(entity: ItemEntity): void {
  for (const tag of ['heatrock', 'icebox_valid', 'bait', 'molebait', 'HASHEATER', 'tradable']) entity.addTag(tag);
  entity.components.fueled.setMaxFuel(HEATROCK_FUEL);
  if (entity.components.fueled.remaining === undefined) entity.components.fueled.remaining = HEATROCK_FUEL;
  entity.component('heatrock', () => new HeatRock(entity)).RefreshImage();
}
