import * as THREE from 'three';
import type { ItemEntity, ItemRuntimeComponent } from '@dontstarve-web/inventory';
import { createMemo, createSignal, readonlySignal, type HandEquipmentLifecycle, type ReadonlySignal } from '@dontstarve-web/signals';
import { findImage, smallHash, type AnimElement, type ResolvedSprite } from '@dontstarve-web/animation/animationAssets';
import { GROUND_ITEM_DEFINITIONS, GroundItemAssets, createGroundItemSprite } from './groundItems';
import { setPrefabLocalLight } from './localLight';
import { TILE_SIZE } from './tile';
import { listenInventoryEvents } from './inventoryEvents';
import type { GroundItemFactory, GroundItemVisual, GroundPrefabContext } from './groundPrefab';

export const LANTERN_ID = 'lantern';
export const LANTERN_COLOUR = [180 / 255, 195 / 255, 150 / 255] as const;
/** tuning.lua: LANTERN_LIGHTTIME = (night_time + dusk_time) * 2.6 with 2 night and 4 dusk segments. */
export const LANTERN_FUEL = (30 * 2 + 30 * 4) * 2.6;
// tuning.lua: fueled:SetFirstPeriod(TURNON_FUELED_CONSUMPTION, TURNON_FULL_FUELED_CONSUMPTION).
const TURNON_FUELED_CONSUMPTION = .5;
const TURNON_FULL_FUELED_CONSUMPTION = 1 / 60;
const SETTLEMENT_FRAMES = 60;

/**
 * mininglantern.lua's machine and fueled lifecycle on the inst. Unlike the torch,
 * running out of fuel only turns the lantern off; the empty item remains.
 */
export class LanternController implements ItemRuntimeComponent {
  private readonly isOnState = createSignal(false);
  /** machine.ison */
  readonly ison = readonlySignal(this.isOnState);
  /** fueled:GetPercent(); a missing saved fuel value is a full lantern. */
  readonly fuelPercent: ReadonlySignal<number>;
  private readonly fuelPercentMemo;
  private readonly entity: ItemEntity;
  private consuming = false;
  private firstPeriod = 0;
  private pendingSeconds = 0;
  private pendingFrames = 0;
  private equipped = false;
  private disposed = false;

  constructor(entity: ItemEntity) {
    if (entity.prefab !== LANTERN_ID) throw new Error('LanternController requires a lantern entity');
    this.entity = entity;
    this.fuelPercentMemo = createMemo(() =>
      Math.max(0, Math.min(1, (entity.components.fueled.fuel.get() ?? LANTERN_FUEL) / LANTERN_FUEL)));
    this.fuelPercent = readonlySignal(this.fuelPercentMemo);
  }

  get isOn(): boolean { return this.isOnState.peek(); }
  IsEmpty(): boolean { return this.currentFuel() <= 0; }

  /** turnon: only a fuelled lantern starts consuming. */
  TurnOn(): void {
    if (this.disposed || this.entity.isRemoved || this.IsEmpty()) return;
    if (!this.consuming) {
      this.consuming = true;
      // fueled:StartConsuming charges the first period once, on top of elapsed time.
      this.firstPeriod = this.currentFuel() >= LANTERN_FUEL ? TURNON_FULL_FUELED_CONSUMPTION : TURNON_FUELED_CONSUMPTION;
    }
    this.isOnState.set(true);
  }

  /** turnoff: settles elapsed time; StopConsuming cancels an uncharged first period. */
  TurnOff(): void {
    if (this.disposed) return;
    this.flushFuel();
    this.consuming = false;
    this.firstPeriod = 0;
    this.isOnState.set(false);
  }

  /** inventoryitem:SetOnDroppedFn(ondropped): turnoff, then turnon. */
  OnDropped(): void { this.TurnOff(); this.TurnOn(); }
  /** inventoryitem:SetOnPutInInventoryFn(turnoff). */
  OnPutInInventory(): void { this.TurnOff(); }
  /** machine:OnLoad restores the saved switch. */
  OnLoad(ison: boolean): void { if (ison) this.TurnOn(); else this.TurnOff(); }

  onequip(): void {
    this.equipped = true;
    if (!this.IsEmpty()) this.TurnOn();
  }
  /** The receiving slot or ground decides the next switch state; held items do not consume. */
  onunequip(): void {
    this.equipped = false;
    this.TurnOff();
  }
  get isEquipped(): boolean { return this.equipped; }

  /** Frame scheduling only accumulates; fuel changes once per 60 active frames. */
  onFrame(dt: number): void {
    if (!this.consuming || this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    this.pendingSeconds += dt;
    if (++this.pendingFrames >= SETTLEMENT_FRAMES) this.flushFuel();
  }

  /** Settle a partial batch before saving, transferring, dropping or switching off. */
  flushFuel(): void {
    const elapsed = this.pendingSeconds + this.firstPeriod;
    this.pendingSeconds = 0;
    this.pendingFrames = 0;
    this.firstPeriod = 0;
    if (!this.consuming || elapsed <= 0 || this.entity.isRemoved) return;
    const next = Math.max(0, this.currentFuel() - elapsed);
    this.entity.setRemainingFuel(next);
    // fueled:DoUpdate stops consuming when empty; SetDepletedFn(nofuel) turns the lantern off.
    if (next <= 0) this.nofuel();
  }

  flush(): void { this.flushFuel(); }

  dispose(): void {
    if (this.disposed) return;
    this.flushFuel();
    this.consuming = false;
    this.isOnState.set(false);
    this.disposed = true;
    this.fuelPercentMemo.dispose();
  }

  private nofuel(): void {
    this.consuming = false;
    this.firstPeriod = 0;
    this.isOnState.set(false);
  }

  private currentFuel(): number { return this.entity.components.fueled.remaining ?? LANTERN_FUEL; }
}

/** One machine/fueled lifecycle per inst, independent of its holder and art. */
export function getLanternController(entity: ItemEntity): LanternController {
  return entity.component('lantern', () => new LanternController(entity));
}

/** fuelupdate's light: radius 3 → 5 and intensity 0.4 → 0.6 with fuel percent. */
export class LanternLightController {
  private fuelPercent = 1;
  private requestedOn = false;

  constructor(owner: THREE.Object3D, onChange?: (lit: boolean) => void) {
    this.owner = owner;
    this.onChange = onChange;
  }

  private readonly owner: THREE.Object3D;
  private readonly onChange?: (lit: boolean) => void;

  get isLit(): boolean { return this.requestedOn && this.fuelPercent > 0; }

  setLit(lit: boolean): void {
    this.requestedOn = lit;
    this.refresh();
  }

  setFuelPercent(percent: number): void {
    if (!Number.isFinite(percent)) throw new RangeError('Lantern fuel percent must be finite');
    this.fuelPercent = THREE.MathUtils.clamp(percent, 0, 1);
    this.refresh();
  }

  dispose(): void {
    this.setLit(false);
  }

  private refresh(): void {
    setPrefabLocalLight(this.owner, this.isLit ? {
      radius: THREE.MathUtils.lerp(3, 5, this.fuelPercent) * (TILE_SIZE / 4),
      intensity: THREE.MathUtils.lerp(0.4, 0.6, this.fuelPercent),
      falloff: 0.9,
      colour: LANTERN_COLOUR,
    } : null);
    this.onChange?.(this.isLit);
  }
}

/** Presentation subscribes to the inst's switch and fuel; it never writes them. */
function bindLanternState(controller: LanternController, present: (ison: boolean, fuelPercent: number) => void): () => void {
  const sync = () => present(controller.ison.peek(), controller.fuelPercent.peek());
  const stops = [controller.ison.subscribe(sync), controller.fuelPercent.subscribe(sync)];
  sync();
  return () => stops.forEach(stop => stop());
}

export interface LanternHandContext {
  setLanternLight?(ison: boolean, fuelPercent: number): void;
}

/** Equipment-scoped light binding; the controller stays on the item entity. */
export function createLanternHandLifecycle(entity: ItemEntity, context: LanternHandContext): HandEquipmentLifecycle {
  const controller = getLanternController(entity);
  let stop: (() => void) | undefined;
  return {
    onequip() {
      controller.onequip();
      stop?.();
      stop = bindLanternState(controller, (ison, percent) => context.setLanternLight?.(ison, percent));
    },
    onunequip() {
      controller.onunequip();
      stop?.(); stop = undefined;
      context.setLanternLight?.(false, controller.fuelPercent.peek());
    },
    onFrame: dt => controller.onFrame(dt),
    flush: () => controller.flushFuel(),
  };
}

/** Ground art binds to the inst's lantern lifecycle; it starts unlit until a drop or load event. */
export async function createLanternGroundSprite(assets: GroundItemAssets, skinId?: string): Promise<GroundItemVisual & {
  readonly light: LanternLightController;
}> {
  const sprite = await createGroundItemSprite(assets, LANTERN_ID, skinId);
  const light = new LanternLightController(sprite.model, (lit) => sprite.setAnimation(lit ? 'idle_on' : 'idle_off'));
  let controller: LanternController | undefined;
  let stopState: (() => void) | undefined;
  let savedOn: boolean | undefined;
  const removeInventoryEvents = listenInventoryEvents(sprite.model, {
    ondropped: () => controller?.OnDropped(),
    onputininventory: () => controller?.OnPutInInventory(),
    // Older saves predate machine.ison; their ground lanterns were dropped, hence on.
    onload: () => controller?.OnLoad(savedOn ?? true),
  });
  return {
    model: sprite.model,
    light,
    bindEntity(entity) {
      stopState?.();
      controller = getLanternController(entity);
      stopState = bindLanternState(controller, (ison, percent) => { light.setFuelPercent(percent); light.setLit(ison); });
    },
    setDefinition(definition) { savedOn = definition.lanternOn; },
    getDefinition() {
      controller?.flushFuel();
      return controller ? { lanternOn: controller.isOn } : {};
    },
    update(dt: number) { controller?.onFrame(dt); sprite.update(dt); },
    dispose() { removeInventoryEvents(); stopState?.(); light.dispose(); sprite.dispose(); },
  };
}

type LanternBuild = Awaited<ReturnType<GroundItemAssets['loadBuild']>>;
export interface LanternEquipment { readonly builds: readonly LanternBuild[]; }

export async function loadLanternEquipment(assets: GroundItemAssets, skinId?: string): Promise<LanternEquipment> {
  const skinArchive = skinId ? GROUND_ITEM_DEFINITIONS.lantern.skinArchives[skinId] : undefined;
  if (skinId && !skinArchive) throw new Error(`Unknown lantern skin: ${skinId}`);
  const base = await assets.loadBuild('swap_lantern.zip');
  const skin = skinArchive ? await assets.loadBuild(skinArchive) : undefined;
  return { builds: skin ? [skin, base] : [base] };
}

/** Worn art uses swap_lantern and lantern_overlay, never the ground idle pose. */
export function resolveLanternPlayerSprite(equipment: LanternEquipment, element: AnimElement): ResolvedSprite[] {
  const hash = element.imageHash === smallHash('swap_object') ? smallHash('swap_lantern')
    : smallHash('lantern_overlay');
  for (const source of equipment.builds) {
    const image = findImage(source.build, hash, element.imageIndex);
    if (image) return [{ element, image, materials: source.materials }];
  }
  return [];
}

export function createLanternGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  return {
    itemIds: [LANTERN_ID],
    create: (item) => createLanternGroundSprite(context.assets, item.skinId),
  };
}
