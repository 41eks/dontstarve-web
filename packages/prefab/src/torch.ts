import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { ItemEntity } from '@dontstarve-web/inventory';
import { getBoundWatchWorldContent, WorldContentKey, type EquipmentOwner, type HandEquipment, type ReadonlySignal } from '@dontstarve-web/signals';
import type * as THREE from 'three';
import type { FollowerFx } from '@dontstarve-web/display';
import { Burnable } from '../../componets/src/burnable';
import { ErodeAway } from '../../componets/src/erodeaway';
import { Lighter } from '../../componets/src/lighter';
import type { WorkInst } from '../../componets/src/workable';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory, type HeldEquipFunctions } from './equipmentVisual';
import { createResidentGroundItem, GROUND_ITEM_DEFINITIONS } from './groundItems';
import type { GroundItemFactory, GroundPrefabContext } from './groundPrefab';
import { listenInventoryEvents } from './inventoryEvents';
import { spawnLightEntity, type PrefabLocalLight } from './localLight';
import type { LootLaunch } from './lootFling';
import { PlaySound } from './sound';
import { TILE_SIZE } from './tile';
import { TORCH_FIRE_OFFSET_Y, TORCH_FIRE_VFX } from './torchfire';
import type { PrefabInstance } from './prefabInstance';

/** torch.lua fn(): the components the source adds and the callbacks it registers on them, on the item's own instance. */
export function configureTorchEntity(entity: ItemEntity): void {
  entity.components.lighter = entity.component('lighter', () => new Lighter(entity));
  if (entity.components.fueled) return;
  const burnable = entity.components.burnable = entity.component('burnable', () => new Burnable(entity));
  burnable.canlight = false;
  burnable.SetOnExtinguishFn(() => getTorchController(entity).OnExtinguish());
  const fueled = entity.AddFueled();
  fueled.SetSectionCallback(newsection => getTorchController(entity).onfuelchange(newsection));
  fueled.InitializeFuelLevel(TORCH_FUEL);
  fueled.SetDepletedFn(inst => { inst.remove(); });
  fueled.SetFirstPeriod(TURNON_FUELED_CONSUMPTION, TURNON_FULL_FUELED_CONSUMPTION);
  entity.onRemove(() => burnable.OnRemoveEntity());
}

export const TORCH_ID = 'torch';
/** tuning.lua: TORCH_FUEL = night_time * 1.25, with a default 30 * 2 second night. */
export const TORCH_FUEL = 30 * 2 * 1.25;
/** tuning.lua TURNON_FUELED_CONSUMPTION / TURNON_FULL_FUELED_CONSUMPTION. */
export const TURNON_FUELED_CONSUMPTION = .5;
export const TURNON_FULL_FUELED_CONSUMPTION = 1 / 60;
/** tuning.lua TORCH_ATTACK_IGNITE_PERCENT / TORCH_RAIN_RATE. */
const TORCH_ATTACK_IGNITE_PERCENT = 1;
const TORCH_RAIN_RATE = 1.5;
/** torchfire_common.lua CreateLight with TUNING.TORCH_RADIUS[1] and TORCH_FALLOFF[1]. */
export const TORCH_LIGHT: PrefabLocalLight = {
  radius: 2 * (TILE_SIZE / 4), falloff: 0.5, intensity: 0.75,
  colour: [180 / 255, 195 / 255, 150 / 255],
};
export const TORCH_SOUNDS = ['dontstarve/wilson/torch_swing', 'dontstarve/common/fireOut'] as const;

export interface TorchLifecycleOptions { soundPosition?: ReadonlyVector3 }

/** torch.lua's onattack. TryLuckRoll is the plain chance: this project has no luck stat. */
export function onattack(_weapon: object, attacker: object, target: object): void {
  const { isRemoved, components } = target as { isRemoved?: boolean; components?: { burnable?: Burnable } };
  const burnable = components?.burnable;
  if (!isRemoved && burnable && Math.random() < TORCH_ATTACK_IGNITE_PERCENT * burnable.flammability) burnable.Ignite(undefined, attacker as WorkInst);
}

/**
 * torch.lua's callbacks on the inst. Burning is `components.burnable`, which also starts and stops fueled; `fires` is
 * Lua's inst.fires: set from onequip or IgniteTossed until the source clears it, whatever the burnable does meanwhile.
 */
export class TorchController implements HandEquipment {
  public readonly itemId = TORCH_ID;
  public readonly EQUIPSLOTS: 'HANDS' = 'HANDS';
  private disposed = false;
  readonly entity: ItemEntity;
  private owner: EquipmentOwner | null = null;
  private held = false;
  private fires = false;
  /** What IgniteTossed draws on the inst; the hand's torchfire belongs to the hand lifecycle. */
  private tossedFire?: { remove(): void };
  private options: TorchLifecycleOptions = {};
  private cancelIgniteSound?: () => void;
  private cancelExtinguishSound?: () => void;
  private fuelratemult?: number;
  private readonly rainStops: (() => void)[] = [];
  private precipitationRate?: ReadonlySignal<number>;
  private preciptype?: ReadonlySignal<string>;

  constructor(entity: ItemEntity) {
    if (entity.prefab !== TORCH_ID) throw new Error('TorchController requires a torch entity');
    this.entity = entity;
    entity.onRemove(() => this.dispose());
  }

  private get burnable(): Burnable { return this.entity.components.burnable!; }
  private get fueled() { return this.entity.isRemoved ? undefined : this.entity.components.fueled; }
  get burning(): ReadonlySignal<boolean> { return this.burnable.burning; }
  get isBurning(): boolean { return this.burnable.IsBurning(); }
  setPresentation(options: TorchLifecycleOptions): void { this.options = options; }
  releasePresentation(options: TorchLifecycleOptions): void { if (this.options === options) this.options = {}; }
  OnDropped(): void { this.held = false; }

  /** A held torch sounds from its holder, one on the ground from its own transform. */
  private soundPosition(ownerPosition?: ReadonlyVector3): ReadonlyVector3 | undefined {
    return ownerPosition ?? this.options.soundPosition ?? (this.held ? undefined : this.entity.position);
  }
  /** inst:DoTaskInTime(0, ...): the next game-time step, or at once for an inst outside a world. */
  private inNextStep(run: () => void): (() => void) | undefined {
    const scheduler = this.entity.components.perishable.scheduler;
    if (scheduler) return scheduler.schedule(0, run);
    run();
    return undefined;
  }

  private DoIgniteSound(position?: ReadonlyVector3): void {
    this.cancelIgniteSound = undefined;
    PlaySound('dontstarve/wilson/torch_swing', position);
  }
  private DoExtinguishSound(position?: ReadonlyVector3): void {
    this.cancelExtinguishSound = undefined;
    PlaySound('dontstarve/common/fireOut', position);
  }
  private PlayIgniteSound(position: ReadonlyVector3 | undefined, instant: boolean, force: boolean): void {
    if (this.cancelExtinguishSound) {
      this.cancelExtinguishSound();
      this.cancelExtinguishSound = undefined;
      if (!force) return;
    }
    if (instant) {
      this.cancelIgniteSound?.();
      this.DoIgniteSound(position);
    } else this.cancelIgniteSound ??= this.inNextStep(() => this.DoIgniteSound(position));
  }
  private PlayExtinguishSound(position: ReadonlyVector3 | undefined, instant: boolean, force: boolean): void {
    if (this.cancelIgniteSound) {
      this.cancelIgniteSound();
      this.cancelIgniteSound = undefined;
      if (!force) return;
    }
    if (instant) {
      this.cancelExtinguishSound?.();
      this.DoExtinguishSound(position);
    } else this.cancelExtinguishSound ??= this.inNextStep(() => this.DoExtinguishSound(position));
  }

  /**
   * WatchWorldState("israining", onisraining). Started with the first fire rather than in fn(): only a consuming torch
   * reads the rate, and a saved inventory is configured before its world is bound.
   */
  private watchRain(): void {
    const watch = getBoundWatchWorldContent();
    if (this.preciptype || !watch) return;
    this.precipitationRate = watch(WorldContentKey.PrecipitationRate, stop => this.rainStops.push(stop));
    const preciptype = this.preciptype = watch(WorldContentKey.PrecipType, stop => this.rainStops.push(stop));
    preciptype.subscribe(type => this.onisraining(type === 'rain'));
    this.onisraining(preciptype.peek() === 'rain');
  }
  private onupdatefueledraining(): void {
    const fueled = this.fueled;
    if (!fueled) return;
    const owner = this.entity.components.inventoryitem.owner as { components?: { sheltered?: { sheltered?: boolean }; rainimmunity?: object } } | null;
    const ownerProtected = owner?.components?.sheltered?.sheltered || owner?.components?.rainimmunity !== undefined;
    const mult = this.fuelratemult ?? 1;
    fueled.rate = ownerProtected || (this.entity.components as { rainimmunity?: object }).rainimmunity !== undefined ? mult
      : (1 + TORCH_RAIN_RATE * (this.precipitationRate?.peek() ?? 0)) * mult;
  }
  private onisraining(israining: boolean): void {
    const fueled = this.fueled;
    if (!fueled) return;
    if (israining) {
      fueled.SetUpdateFn(() => this.onupdatefueledraining());
      this.onupdatefueledraining();
    } else {
      fueled.SetUpdateFn();
      fueled.rate = this.fuelratemult ?? 1;
    }
  }
  SetFuelRateMult(mult: number): void {
    const next = mult !== 1 ? mult : undefined;
    if (this.fuelratemult === next) return;
    this.fuelratemult = next;
    this.onisraining(this.preciptype?.peek() === 'rain');
  }

  onequip(owner?: EquipmentOwner): void {
    if (this.disposed || this.fires) return;
    this.held = true;
    this.owner = owner ?? null;
    this.watchRain();
    this.burnable.Ignite();
    this.PlayIgniteSound(this.soundPosition(), true, false);
    this.fires = true;
  }
  onunequip(): void {
    if (this.fires && !this.disposed) this.PlayExtinguishSound(this.soundPosition(), false, false);
    this.fires = false;
    this.burnable.Extinguish();
    this.held = false;
    this.owner = null;
  }

  /** IgniteTossed: burning on the inst itself, its torchfire on swap_torch and the light attached to the inst. */
  IgniteTossed(): void {
    if (this.disposed) return;
    this.watchRain();
    this.burnable.Ignite();
    this.fires = true;
    if (this.tossedFire) return;
    this.tossedFire = this.entity.sprite.followSymbol('swap_torch', 0, TORCH_FIRE_OFFSET_Y, TORCH_FIRE_VFX);
    this.entity.light.set(TORCH_LIGHT);
  }
  /** The drawn fx leave with the display drawing them; `fires` and the burnable stay with the inst. */
  releaseTossedFire(): void {
    this.tossedFire?.remove();
    this.tossedFire = undefined;
    this.entity.light.set(null);
  }

  /** Burnable:Extinguish, as flingo, waterballoon or icestaff do from outside. */
  extinguish(): void { this.burnable.Extinguish(); }

  /** OnPutInInventory: back to idle, the fire goes and fuel stops without emptying it. */
  OnPutInInventory(ownerPosition?: ReadonlyVector3): void {
    if (this.disposed) return;
    this.held = true;
    this.entity.sprite.playOnce('idle');
    if (this.fires) {
      this.fires = false;
      this.releaseTossedFire();
      this.PlayExtinguishSound(this.soundPosition(ownerPosition), false, false);
    }
    this.burnable.Extinguish();
    this.owner = null;
  }

  /** burnable's onextinguish: handles being extinguished from outside while stuck in the ground. */
  OnExtinguish(): void {
    if (this.disposed || !this.fires || this.held || (this.fueled?.IsEmpty() ?? true)) return;
    this.fires = false;
    this.releaseTossedFire();
    this.PlayExtinguishSound(this.soundPosition(), true, false);
    this.entity.sprite.playOnce('idle');
    // Physics:Teleport(x, max(.1, y), z) and SetVel(speed * cos, 8 + random, -speed * sin) with speed = random.
    this.entity.PushEvent('launch', { angle: Math.random() * Math.PI * 2, height: .1,
      speed: { min: 0, range: 1 }, ySpeed: { min: 8, range: 1 } } satisfies LootLaunch);
  }

  /** onfuelchange: burning out. */
  onfuelchange(newsection: number): void {
    if (newsection > 0 || this.disposed) return;
    this.burnable.Extinguish();
    const { owner, entity } = this;
    if (owner) {
      this.PlayExtinguishSound(this.soundPosition(), true, false);
      entity.remove(); // need to remove before "itemranout" for auto-reequip to work
      owner.PushEvent('itemranout', { prefab: TORCH_ID, equipslot: 'hand', announce: 'ANNOUNCE_TORCH_OUT' });
    } else if (!this.held && this.fires) {
      this.fires = false;
      this.releaseTossedFire();
      this.PlayExtinguishSound(this.soundPosition(), true, false);
      entity.persists = false;
      entity.addTag('NOCLICK');
      // As in Lua, fueled:DoDelta then runs SetDepletedFn(inst.Remove) in this same call, which ends the erosion at once.
      const scheduler = entity.components.perishable.scheduler;
      if (scheduler) {
        const erode = new ErodeAway(scheduler, amount => entity.sprite.setErosion(amount), () => entity.remove());
        entity.onRemove(() => erode.dispose());
        erode.start();
      }
    } else entity.remove();
  }

  /** OnRemoveEntity: pending sound tasks stop, which also covers an unequip arriving after removal. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.fueled?.StopConsuming();
    this.burnable.OnRemoveEntity();
    this.cancelIgniteSound?.(); this.cancelIgniteSound = undefined;
    this.cancelExtinguishSound?.(); this.cancelExtinguishSound = undefined;
    for (const stop of this.rainStops.splice(0)) stop();
    this.releaseTossedFire();
    this.fires = false;
    this.held = false;
    this.owner = null;
  }
}

/** One burnable/fueled lifecycle per inst, independent of its current owner and art. */
export function getTorchController(entity: ItemEntity): TorchController {
  configureTorchEntity(entity);
  return entity.component('torch', () => new TorchController(entity));
}

/** Equipment-scoped presentation bindings; the controller stays on the item entity. */
export function createTorchHandLifecycle(
  entity: ItemEntity,
  options: {
    soundPosition?: ReadonlyVector3;
    lightParent?: PrefabInstance;
    followSymbol?(symbol: string, offsetX: number, offsetY: number, fx?: FollowerFx): { node: THREE.Object3D; remove(): void };
  },
): HeldEquipFunctions {
  const controller = getTorchController(entity);
  const presentation = { soundPosition: options.soundPosition };
  let stopBurning: (() => void) | undefined;
  let removeLight: (() => void) | undefined;
  let removeFire: (() => void) | undefined;
  // torch.lua onequip: torchfire follows swap_object and AttachLightTo(owner); both leave when it stops burning.
  const syncLight = (burning: boolean) => {
    removeLight?.(); removeLight = undefined;
    removeFire?.(); removeFire = undefined;
    const parent = options.lightParent;
    if (!burning || !parent) return;
    // torchfire_common.lua CreateLight + AttachLightTo(owner): a player owner's light is also a playerlight.
    const light = spawnLightEntity('torchfire_light', parent);
    if (parent.hasTag('player')) light.instance.addTag('playerlight');
    light.instance.light.set(TORCH_LIGHT);
    removeLight = light.remove;
    // The holder's display loads the particle textures, draws the effect and advances it each frame.
    removeFire = options.followSymbol?.('swap_object', 0, TORCH_FIRE_OFFSET_Y, TORCH_FIRE_VFX).remove;
  };
  return {
    onequip(owner) {
      controller.setPresentation(presentation);
      stopBurning = controller.burning.subscribe(syncLight);
      syncLight(controller.isBurning);
      controller.onequip(owner);
    },
    onunequip() {
      controller.onunequip();
      stopBurning?.(); stopBurning = undefined;
      syncLight(false);
      controller.releasePresentation(presentation);
    },
    flush: () => entity.components.fueled?.Settle(),
  };
}

/** The ground half of the torch's lifecycle, on the item's own instance; its fuel runs on game time, whatever the tile does. */
export function createTorchGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  return {
    itemIds: [TORCH_ID],
    configureEntity: configureTorchEntity,
    create(item, inst) {
      const { visual } = createResidentGroundItem(context, { ...item, entity: inst });
      const controller = getTorchController(inst);
      let state = item;
      const removeEvents = listenInventoryEvents(inst, {
        onputininventory: () => controller.OnPutInInventory(context.inventoryOwnerPosition),
        ondropped: () => controller.OnDropped(),
        // OnLoad: PlayAnimation("land"), then IgniteTossed.
        onload: () => {
          controller.OnDropped();
          if (state.torchLit) { inst.sprite.playOnce('land'); controller.IgniteTossed(); }
        },
      });
      return {
        ...visual,
        setDefinition: definition => { state = definition; },
        getDefinition: () => {
          const fueled = inst.components.fueled;
          fueled?.Settle();
          return { remainingFuel: fueled ? fueled.OnSave()?.fuel : state.remainingFuel, torchLit: controller.isBurning };
        },
        dispose() {
          removeEvents();
          controller.releaseTossedFire();
          visual.dispose();
        },
      };
    },
  };
}

export const torchVisual: EquipmentVisualFactory = item => {
  const skin = skinArchive('torch', GROUND_ITEM_DEFINITIONS.torch.skinArchives, item.skinId);
  return handEquipmentVisual(item, [...skin ? [skin] : [], 'swap_torch'], 'swap_torch');
};
