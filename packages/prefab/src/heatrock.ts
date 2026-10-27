import type { ItemEntity } from '@dontstarve-web/inventory';
import catalog from './groundItems.json' with { type: 'json' };
import { createEffect, createMemo, createSignal, readonlySignal, watchSignal } from '@dontstarve-web/signals';
import type { ArchiveSpriteCommands } from '@dontstarve-web/display';
import { Heater } from '../../componets/src/heater';

export const HEATROCK_ID = 'heatrock';
export const HEATROCK_FUEL = 100;
/** tuning.lua HEATROCK_NUMUSES. */
const HEATROCK_NUMUSES = 8;
export const HEATROCK_IMAGES = catalog.items.heatrock.inventoryImageVariants;

const THRESHOLDS = [-30, -10, 10, 30];
const EMITTED_TEMPERATURES = [-10, 10, 25, 40, 60];
export function GetHeatRockRange(temperature: number, ambient: number): number {
  return 1 + THRESHOLDS.filter(threshold => temperature > ambient + threshold).length;
}

/** heatrock.lua TemperatureChange owns extremum tracking and charge consumption. */
export class HeatRock {
  private readonly currentTemperature;
  private readonly ambientTemperature;
  private readonly skinState = createSignal<string | undefined>(undefined);
  private readonly rangeMemo;
  readonly range;
  // Last domain event's range, so usage accounting also works inside an open signal batch.
  private previousRange = 3;
  private readonly cleanups: (() => void)[] = [];
  private readonly stopTemperature: () => void;
  private readonly stopImage: () => void;
  private readonly temperature;
  private readonly heater;
  private readonly entity: ItemEntity;
  constructor(entity: ItemEntity) {
    this.entity = entity;
    this.temperature = entity.AddTemperature();
    this.temperature.inherentinsulation = 120;
    this.temperature.inherentsummerinsulation = 120;
    this.temperature.IgnoreTags('heatrock');
    this.currentTemperature = watchSignal(this.temperature.current, stop => this.cleanups.push(stop));
    this.ambientTemperature = createSignal(this.temperature.GetAmbientTemperature());
    this.rangeMemo = createMemo(() => GetHeatRockRange(this.currentTemperature.get(), this.ambientTemperature.get()));
    this.range = readonlySignal(this.rangeMemo);
    this.skinState.set(entity.skinId);
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
    this.stopImage = createEffect(() => {
      const imageName = `${this.skinState.get() ?? 'heat_rock'}${this.rangeMemo.get()}.tex`;
      const image = HEATROCK_IMAGES[imageName as keyof typeof HEATROCK_IMAGES];
      if (!image) throw new Error(`Missing thermal stone image: ${imageName}`);
      entity.components.inventoryitem.ChangeImageName(image.icon, image.atlas);
      entity.components.inventoryitem.owner?.changed();
    });
  }
  RefreshSkin(): void { this.skinState.set(this.entity.skinId); }
  private TemperatureChange(hasrate: boolean): void {
    const current = this.temperature.GetCurrent(), ambient = this.temperature.GetAmbientTemperature();
    // Sample GetLocalTemperature on every event, including when current stays clamped or unchanged.
    this.ambientTemperature.set(ambient);
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
    if (range === this.previousRange) return;
    this.previousRange = range;
    if (hasrate && ((entity.lowTemp !== undefined && range >= 3) || (entity.highTemp !== undefined && range <= 3))) {
      entity.lowTemp = undefined; entity.highTemp = undefined;
      // Each use costs 1 / HEATROCK_NUMUSES; SetDepletedFn(inst.Remove) removes a spent rock.
      const fueled = entity.components.fueled!;
      fueled.SetPercent(fueled.GetPercent() - 1 / HEATROCK_NUMUSES);
    }
  }
  dispose(): void {
    this.stopTemperature();
    this.stopImage();
    this.cleanups.splice(0).forEach(stop => stop());
  }
}

/** heatrock.lua: the ground animation is the stone's range, `1`..`5`. */
export function declareHeatRockSprite(entity: ItemEntity, sprite: ArchiveSpriteCommands): void {
  const rock = entity.getComponent<HeatRock>('heatrock');
  if (rock) sprite.followAnimation(rock.range);
}

export function configureHeatRockEntity(entity: ItemEntity): void {
  for (const tag of ['heatrock', 'icebox_valid', 'bait', 'molebait', 'HASHEATER', 'tradable']) entity.addTag(tag);
  if (!entity.components.fueled) {
    const fueled = entity.AddFueled();
    fueled.fueltype = 'USAGE';
    fueled.InitializeFuelLevel(HEATROCK_FUEL);
    fueled.SetDepletedFn(inst => { inst.remove(); });
  }
  entity.component('heatrock', () => new HeatRock(entity)).RefreshSkin();
}
