import type { AnimState } from '@dontstarve-web/animation/animState';
import type { ItemEntity, ItemRuntimeComponent } from '@dontstarve-web/inventory';
import { createEffect, createMemo, createSignal, readonlySignal, watchSignal, type EquipmentLifecycle, type EquipmentOwner, type ReadonlySignal } from '@dontstarve-web/signals';
import * as THREE from 'three';
import { handEquipmentVisual, type PrepareEquipmentVisual } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS, GroundItemAssets, createGroundItemSprite } from './groundItems';
import type { GroundItemFactory, GroundItemVisual, GroundPrefabContext } from './groundPrefab';
import { listenInventoryEvents } from './inventoryEvents';
import { setPrefabLocalLight } from './localLight';
import { TILE_SIZE } from './tile';

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
  readonly light = new LanternLightController();
  private ground?: THREE.Object3D;
  private hand?: LanternHandContext;
  private owner?: EquipmentOwner;
  private stopTrackingOwner?: () => void;
  private readonly cleanups: (() => void)[] = [];
  private equipped = false;
  private disposed = false;

  constructor(entity: ItemEntity) {
    if (entity.prefab !== LANTERN_ID) throw new Error('LanternController requires a lantern entity');
    this.entity = entity;
    const fuel = watchSignal(entity.components.fueled.fuel, stop => this.cleanups.push(stop));
    this.fuelPercentMemo = createMemo(() =>
      Math.max(0, Math.min(1, (fuel.get() ?? LANTERN_FUEL) / LANTERN_FUEL)));
    createEffect(() => this.light.setFuelPercent(
      Math.max(0, Math.min(1, (fuel.get() ?? LANTERN_FUEL) / LANTERN_FUEL))));
    entity.components.inventoryitem.SetOnPutInInventoryFn(() => this.OnPutInInventory());
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
    this.light.setFuelPercent(this.fuelPercent.peek());
    this.light.setLit(true);
    if (this.equipped) this.hand?.AnimState?.Show('LANTERN_OVERLAY');
    this.isOnState.set(true);
  }

  /** turnoff: settles elapsed time; StopConsuming cancels an uncharged first period. */
  TurnOff(): void {
    if (this.disposed) return;
    this.stopTrackingOwner?.();
    this.stopTrackingOwner = undefined;
    this.flushFuel();
    this.consuming = false;
    this.firstPeriod = 0;
    this.light.setLit(false);
    if (this.equipped) this.hand?.AnimState?.Hide('LANTERN_OVERLAY');
    this.isOnState.set(false);
  }

  /** inventoryitem:SetOnDroppedFn(ondropped): turnoff, then turnon. */
  OnDropped(): void { this.TurnOff(); this.light.setParent(this.ground); this.TurnOn(); }

  /** Visual replacement only reattaches the existing light; it does not change machine/fueled state. */
  bindGround(model: THREE.Object3D): void {
    this.ground = model;
    if (!this.equipped) this.light.setParent(model);
  }
  releaseGround(model: THREE.Object3D): void {
    if (this.ground !== model) return;
    this.ground = undefined;
    if (!this.equipped && this.light.parent === model) this.light.setParent(undefined);
  }
  /** inventoryitem:SetOnPutInInventoryFn(turnoff). */
  OnPutInInventory(): void { this.TurnOff(); }
  /** machine:OnLoad restores the saved switch. */
  OnLoad(ison: boolean): void { if (ison) this.TurnOn(); else this.TurnOff(); }

  onequip(owner?: EquipmentOwner, context?: LanternHandContext): void {
    if (this.disposed) return;
    this.equipped = true;
    this.owner = owner;
    this.hand = context;
    this.light.setParent(context?.lightParent);
    if (!this.IsEmpty()) this.TurnOn();
    else context?.AnimState?.Hide('LANTERN_OVERLAY');
  }
  /** mininglantern.lua only clears worn art here; pocket/drop/equip events decide when to turn off. */
  onunequip(): void {
    this.flushFuel();
    this.hand?.AnimState?.Hide('LANTERN_OVERLAY');
    this.stopTrackingOwner?.();
    this.stopTrackingOwner = this.isOn ? this.owner?.ListenForEvent?.('equip', data => {
      const event = data as { item?: { hasTag?(tag: string): boolean }; eslot?: string };
      if (event.item !== this.entity && (event.eslot === 'HANDS'
        || (event.eslot === 'BODY' && event.item?.hasTag?.('heavy')))) this.TurnOff();
    }) : undefined;
    this.equipped = false;
    this.owner = undefined;
    this.hand = undefined;
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
    this.stopTrackingOwner?.();
    this.stopTrackingOwner = undefined;
    this.light.dispose();
    for (const stop of this.cleanups) stop();
    this.owner = undefined;
    this.hand = undefined;
    this.ground = undefined;
  }

  private nofuel(): void {
    this.consuming = false;
    this.firstPeriod = 0;
    const owner = this.equipped ? this.owner : undefined;
    this.TurnOff();
    owner?.PushEvent('torchranout', { prefab: this.entity.prefab, equipslot: 'HANDS' });
  }

  private currentFuel(): number { return this.entity.components.fueled.remaining ?? LANTERN_FUEL; }
}

/** One machine/fueled lifecycle per inst, independent of its holder and art. */
export function getLanternController(entity: ItemEntity): LanternController {
  return entity.component('lantern', () => new LanternController(entity));
}

/** mininglantern.lua: CAVE fuel; ontakefuel turns on only an equipped lantern. */
export function configureLanternEntity(entity: ItemEntity): void {
  const controller = getLanternController(entity);
  const fueled = entity.components.fueled;
  fueled.setMaxFuel(LANTERN_FUEL);
  fueled.fueltype = 'CAVE';
  fueled.accepting = true;
  fueled.SetTakeFuelFn(() => { if (controller.isEquipped) controller.TurnOn(); });
}

/** fuelupdate's light: radius 3 → 5 and intensity 0.4 → 0.6 with fuel percent. */
export class LanternLightController {
  private fuelPercent = 1;
  private requestedOn = false;

  private node?: THREE.Object3D;
  private owner?: THREE.Object3D;
  constructor(owner?: THREE.Object3D) { this.owner = owner; }

  get parent(): THREE.Object3D | undefined { return this.owner; }
  setParent(parent?: THREE.Object3D): void {
    this.owner = parent;
    this.node?.removeFromParent();
    if (parent && this.node) parent.add(this.node);
  }

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
    this.owner = undefined;
  }

  private refresh(): void {
    if (!this.isLit) {
      if (this.node) setPrefabLocalLight(this.node, null);
      this.node?.removeFromParent();
      this.node = undefined;
      return;
    }
    if (!this.node) {
      this.node = new THREE.Object3D();
      this.node.name = 'lanternlight';
      this.owner?.add(this.node);
    }
    setPrefabLocalLight(this.node, {
      radius: THREE.MathUtils.lerp(3, 5, this.fuelPercent) * (TILE_SIZE / 4),
      intensity: THREE.MathUtils.lerp(0.4, 0.6, this.fuelPercent),
      falloff: 0.9,
      colour: LANTERN_COLOUR,
    });
  }
}

export interface LanternHandContext {
  lightParent: THREE.Object3D;
  AnimState?: Pick<AnimState, 'Show' | 'Hide'>;
}

/** The item owns the light; equipping only supplies its parent and AnimState overlay interface. */
export function createLanternHandLifecycle(entity: ItemEntity, context: LanternHandContext): EquipmentLifecycle {
  const controller = getLanternController(entity);
  return {
    onequip: owner => controller.onequip(owner, context),
    onunequip: () => controller.onunequip(),
    onFrame: dt => controller.onFrame(dt),
    flush: () => controller.flushFuel(),
  };
}

/** Ground art binds to the inst's lantern lifecycle; it starts unlit until a drop or load event. */
export async function createLanternGroundSprite(assets: GroundItemAssets, skinId?: string): Promise<GroundItemVisual & {
  readonly light: LanternLightController;
}> {
  const sprite = await createGroundItemSprite(assets, LANTERN_ID, skinId);
  let controller: LanternController | undefined;
  let stopState: (() => void) | undefined;
  let savedOn: boolean | undefined;
  const removeInventoryEvents = listenInventoryEvents(sprite.model, {
    ondropped: () => controller?.OnDropped(),
    // Older saves predate machine.ison; their ground lanterns were dropped, hence on.
    onload: () => controller?.OnLoad(savedOn ?? true),
  });
  return {
    model: sprite.model,
    get light() { return controller!.light; },
    bindEntity(entity) {
      stopState?.();
      controller = getLanternController(entity);
      controller.bindGround(sprite.model);
      const ison = watchSignal(controller.ison, stop => { stopState = stop; });
      createEffect(() => sprite.setAnimation(ison.get() ? 'idle_on' : 'idle_off'));
    },
    setDefinition(definition) { savedOn = definition.lanternOn; },
    getDefinition() {
      controller?.flushFuel();
      return controller ? { lanternOn: controller.isOn } : {};
    },
    update(dt: number) { controller?.onFrame(dt); sprite.update(dt); },
    dispose() { removeInventoryEvents(); stopState?.(); controller?.releaseGround(sprite.model); sprite.dispose(); },
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

export function createLanternGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  return {
    itemIds: [LANTERN_ID],
    configureEntity: configureLanternEntity,
    create: (item) => createLanternGroundSprite(context.assets, item.skinId),
  };
}

/** Source prefab onequip/onunequip: prepared art is applied through the owner's AnimState. */
export const prepareLanternVisual: PrepareEquipmentVisual = async (assets, item) => {
  const equipment = await loadLanternEquipment(assets, item.skinId);
  return handEquipmentVisual(item, equipment.builds, 'swap_lantern', [{ symbol: 'lantern_overlay', source: 'lantern_overlay' }]);
};
