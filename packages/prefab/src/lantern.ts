import type { SpriteState } from '@dontstarve-web/display';
import type { AnimState } from '@dontstarve-web/animation/animState';
import type { ItemEntity, ItemRuntimeComponent } from '@dontstarve-web/inventory';
import { createEffect, watchSignal, type EquipmentLifecycle, type EquipmentOwner, type ReadonlySignal } from '@dontstarve-web/signals';
import * as THREE from 'three';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory } from './equipmentVisual';
import { GROUND_ITEM_DEFINITIONS, createResidentGroundItem } from './groundItems';
import type { GroundItemFactory, GroundItemVisual, GroundPrefabContext } from './groundPrefab';
import { listenInventoryEvents } from './inventoryEvents';
import { TILE_SIZE } from './tile';
import { spawnLightEntity, type LightEntity, type LightParent } from './localLight';
import { Machine } from '../../componets/src/machine';
import { TURNON_FULL_FUELED_CONSUMPTION, TURNON_FUELED_CONSUMPTION } from './torch';

export const LANTERN_ID = 'lantern';
export const LANTERN_COLOUR = [180 / 255, 195 / 255, 150 / 255] as const;
/** tuning.lua: LANTERN_LIGHTTIME = (night_time + dusk_time) * 2.6 with 2 night and 4 dusk segments. */
export const LANTERN_FUEL = (30 * 2 + 30 * 4) * 2.6;

/**
 * mininglantern.lua's machine and fueled lifecycle on the inst. Unlike the torch,
 * running out of fuel only turns the lantern off; the empty item remains.
 */
export class LanternController implements ItemRuntimeComponent {
  /** mininglantern.lua's machine: TURNON / TURNOFF run turnon / turnoff, with no cooldown. */
  private readonly machine: Machine;
  /** machine.ison */
  readonly ison: ReadonlySignal<boolean>;
  private readonly entity: ItemEntity;
  readonly light = new LanternLightController();
  private ground?: LightParent;
  private hand?: LanternHandContext;
  private owner?: EquipmentOwner;
  private stopTrackingOwner?: () => void;
  private equipped = false;
  private disposed = false;

  constructor(entity: ItemEntity) {
    if (entity.prefab !== LANTERN_ID) throw new Error('LanternController requires a lantern entity');
    this.entity = entity;
    this.machine = entity.components.machine = new Machine(entity, () => entity.components.perishable.scheduler);
    this.machine.turnonfn = () => this.TurnOn();
    this.machine.turnofffn = () => this.TurnOff();
    this.machine.cooldowntime = 0;
    this.ison = this.machine.ison;
    entity.components.inventoryitem.SetOnPutInInventoryFn(() => this.OnPutInInventory());
  }

  private get fueled() { return this.entity.isRemoved ? undefined : this.entity.components.fueled; }
  get isOn(): boolean { return this.machine.IsOn(); }
  IsEmpty(): boolean { return this.fueled?.IsEmpty() ?? true; }

  /** turnon: only a fuelled lantern starts consuming. */
  TurnOn(): void {
    if (this.disposed || this.IsEmpty()) return;
    this.fueled!.StartConsuming();
    this.fuelupdate();
    this.light.setLit(true);
    if (this.equipped) this.hand?.AnimState?.Show('LANTERN_OVERLAY');
    this.machine.isOn = true;
  }

  /** turnoff: StopConsuming settles elapsed time and cancels an uncharged first period. */
  TurnOff(): void {
    if (this.disposed) return;
    this.stopTrackingOwner?.();
    this.stopTrackingOwner = undefined;
    this.fueled?.StopConsuming();
    this.light.setLit(false);
    if (this.equipped) this.hand?.AnimState?.Hide('LANTERN_OVERLAY');
    this.machine.isOn = false;
  }

  /** inventoryitem:SetOnDroppedFn(ondropped): turnoff, then turnon. */
  OnDropped(): void { this.TurnOff(); this.light.setParent(this.ground); this.TurnOn(); }

  /** Visual replacement only reattaches the existing light; it does not change machine/fueled state. */
  bindGround(ground: LightParent): void {
    this.ground = ground;
    if (!this.equipped) this.light.setParent(ground);
  }
  releaseGround(ground: LightParent): void {
    if (this.ground !== ground) return;
    this.ground = undefined;
    if (!this.equipped && this.light.parent === ground) this.light.setParent(undefined);
  }
  /** inventoryitem:SetOnPutInInventoryFn(turnoff). */
  OnPutInInventory(): void { this.TurnOff(); }
  /** machine:OnLoad restores the saved switch. */
  OnLoad(ison: boolean): void { this.machine.OnLoad({ ison }); }

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

  /** fueled:SetUpdateFn(fuelupdate): the light follows the fuel percent. */
  fuelupdate(): void {
    const fueled = this.fueled;
    if (fueled) this.light.setFuelPercent(fueled.GetPercent());
  }

  dispose(): void {
    if (this.disposed) return;
    this.fueled?.StopConsuming();
    this.machine.isOn = false;
    this.machine.dispose();
    if (this.entity.components.machine === this.machine) delete this.entity.components.machine;
    this.disposed = true;
    this.stopTrackingOwner?.();
    this.stopTrackingOwner = undefined;
    this.light.dispose();
    this.owner = undefined;
    this.hand = undefined;
    this.ground = undefined;
  }

  /** fueled:SetDepletedFn(nofuel): an equipped lantern tells its owner it ran out. */
  nofuel(): void {
    const owner = this.equipped ? this.owner : undefined;
    this.TurnOff();
    owner?.PushEvent('torchranout', { prefab: this.entity.prefab, equipslot: 'HANDS' });
  }
}

/** One machine/fueled lifecycle per inst, independent of its holder and art. */
export function getLanternController(entity: ItemEntity): LanternController {
  return entity.component('lantern', () => new LanternController(entity));
}

/** mininglantern.lua: CAVE fuel; ontakefuel turns on only an equipped lantern. */
export function configureLanternEntity(entity: ItemEntity): void {
  if (!entity.components.fueled) {
    const fueled = entity.AddFueled();
    fueled.fueltype = 'CAVE';
    fueled.InitializeFuelLevel(LANTERN_FUEL);
    fueled.SetDepletedFn(() => getLanternController(entity).nofuel());
    fueled.SetUpdateFn(() => getLanternController(entity).fuelupdate());
    fueled.SetTakeFuelFn(() => { if (getLanternController(entity).isEquipped) getLanternController(entity).TurnOn(); });
    fueled.SetFirstPeriod(TURNON_FUELED_CONSUMPTION, TURNON_FULL_FUELED_CONSUMPTION);
    fueled.accepting = true;
  }
  getLanternController(entity);
}

/** fuelupdate's light: radius 3 → 5 and intensity 0.4 → 0.6 with fuel percent. */
export class LanternLightController {
  private fuelPercent = 1;
  private requestedOn = false;

  /** mininglantern.lua's lanternlight, parented to the lantern's owner while lit. */
  private light?: LightEntity;
  private owner?: LightParent;
  constructor(owner?: LightParent) { this.owner = owner; }

  get parent(): LightParent | undefined { return this.owner; }
  setParent(parent?: LightParent): void {
    this.owner = parent;
    this.light?.setParent(parent);
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
      this.light?.remove();
      this.light = undefined;
      return;
    }
    this.light ??= spawnLightEntity('lanternlight', this.owner);
    this.light.instance.light.set({
      radius: THREE.MathUtils.lerp(3, 5, this.fuelPercent) * (TILE_SIZE / 4),
      intensity: THREE.MathUtils.lerp(0.4, 0.6, this.fuelPercent),
      falloff: 0.9,
      colour: LANTERN_COLOUR,
    });
  }
}

export interface LanternHandContext {
  lightParent: LightParent;
  AnimState?: Pick<AnimState, 'Show' | 'Hide'>;
}

/** The item owns the light; equipping only supplies its parent and AnimState overlay interface. */
export function createLanternHandLifecycle(entity: ItemEntity, context: LanternHandContext): EquipmentLifecycle {
  const controller = getLanternController(entity);
  return {
    onequip: owner => controller.onequip(owner, context),
    onunequip: () => controller.onunequip(),
    flush: () => entity.components.fueled?.Settle(),
  };
}

/** Ground art binds to the inst's lantern lifecycle; it starts unlit until a drop or load event. */
/** `skin` is the item's own sprite json, whose skin it keeps, or the skin of a sprite of the visual's own. */
export function createLanternGroundSprite(context: Pick<GroundPrefabContext, 'assets' | 'tickingarea'>, skin?: string | SpriteState): GroundItemVisual & {
  readonly light: LanternLightController;
} {
  const { visual, instance, display } = createResidentGroundItem(context, typeof skin === 'object'
    ? { itemId: LANTERN_ID, sprite: skin } : { itemId: LANTERN_ID, skinId: skin });
  const model = display.model, sprite = instance.sprite;
  instance.addTag('light');
  let controller: LanternController | undefined;
  let bound: ItemEntity | undefined;
  let stopState: (() => void) | undefined;
  let savedOn: boolean | undefined;
  const removeInventoryEvents = listenInventoryEvents(model, {
    ondropped: () => controller?.OnDropped(),
    // Older saves predate machine.ison; their ground lanterns were dropped, hence on.
    onload: () => controller?.OnLoad(savedOn ?? true),
  });
  return {
    ...visual,
    // Fuel settlement continues while the display releases its off-tile sprite.
    active: undefined,
    model,
    get light() { return controller!.light; },
    bindEntity(entity) {
      stopState?.();
      bound = entity;
      controller = getLanternController(entity);
      controller.bindGround(instance);
      const ison = watchSignal(controller.ison, stop => { stopState = stop; });
      createEffect(() => sprite.playOnce(ison.get() ? 'idle_on' : 'idle_off'));
    },
    setDefinition(definition) { savedOn = definition.lanternOn; },
    getDefinition() {
      bound?.components.fueled?.Settle();
      return controller ? { lanternOn: controller.isOn } : {};
    },
    dispose() { removeInventoryEvents(); stopState?.(); controller?.releaseGround(instance); visual.dispose(); },
  };
}

export function createLanternGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  return {
    itemIds: [LANTERN_ID],
    configureEntity: configureLanternEntity,
    create: (_item, entity) => createLanternGroundSprite(context, entity.sprite),
  };
}

/** Source prefab onequip/onunequip: swap_lantern, or the skin's, named on the owner's AnimState. */
export const lanternVisual: EquipmentVisualFactory = item => {
  const skin = skinArchive('lantern', GROUND_ITEM_DEFINITIONS.lantern.skinArchives, item.skinId);
  return handEquipmentVisual(item, [...skin ? [skin] : [], 'swap_lantern'], 'swap_lantern', [{ symbol: 'lantern_overlay', source: 'lantern_overlay' }]);
};
