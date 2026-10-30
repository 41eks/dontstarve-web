import { ItemEntity } from '@dontstarve-web/inventory';
import { createSignal, readonlySignal, type EquipmentLifecycle, type EquipmentOwner, type HandEquipment } from '@dontstarve-web/signals';
import type * as THREE from 'three';
import type { FollowerFx } from '@dontstarve-web/display';
import { Lighter } from '../../componets/src/lighter';
import { handEquipmentVisual, skinArchive, type EquipmentVisualFactory } from './equipmentVisual';
import { createResidentGroundItem, GROUND_ITEM_DEFINITIONS } from './groundItems';
import type { GroundItemFactory, GroundPrefabContext } from './groundPrefab';
import { listenInventoryEvents } from './inventoryEvents';
import { spawnLightEntity, type PrefabLocalLight } from './localLight';
import { LootFling } from './lootFling';
import { PlaySound, type SoundHandle } from './sound';
import { TILE_SIZE } from './tile';
import { TORCH_FIRE_OFFSET_Y, TORCH_FIRE_VFX } from './torchfire';
import { prefabInstance, type PrefabInstance } from './prefabInstance';

export function configureTorchEntity(entity: ItemEntity): void {
  entity.components.lighter = entity.component('lighter', () => new Lighter(entity));
  if (entity.components.fueled) return;
  const fueled = entity.AddFueled();
  fueled.SetSectionCallback(newsection => getTorchController(entity).onfuelchange(newsection));
  fueled.InitializeFuelLevel(TORCH_FUEL);
  fueled.SetDepletedFn(inst => { inst.remove(); });
  fueled.SetFirstPeriod(TURNON_FUELED_CONSUMPTION, TURNON_FULL_FUELED_CONSUMPTION);
}

export const TORCH_ID = 'torch';
/** tuning.lua: TORCH_FUEL = night_time * 1.25, with a default 30 * 2 second night. */
export const TORCH_FUEL = 30 * 2 * 1.25;
/** tuning.lua TURNON_FUELED_CONSUMPTION / TURNON_FULL_FUELED_CONSUMPTION. */
export const TURNON_FUELED_CONSUMPTION = .5;
export const TURNON_FULL_FUELED_CONSUMPTION = 1 / 60;
/** torchfire_common.lua CreateLight with TUNING.TORCH_RADIUS[1] and TORCH_FALLOFF[1]. */
export const TORCH_LIGHT: PrefabLocalLight = {
  radius: 2 * (TILE_SIZE / 4), falloff: 0.5, intensity: 0.75,
  colour: [180 / 255, 195 / 255, 150 / 255],
};
export const TORCH_SOUNDS = ['dontstarve/wilson/torch_swing', 'dontstarve/common/fireOut'] as const;

export interface TorchLifecycleOptions {
  soundPosition?: THREE.Vector3;
  returnToIdle?(): void;
  onGroundExtinguish?(): void;
}

/** torch.lua's onequip/onunequip and burnable/fueled lifecycle. */
export class TorchController implements HandEquipment {
  public readonly itemId = TORCH_ID;
  public readonly EQUIPSLOTS: 'HANDS' = 'HANDS';
  private readonly burningState = createSignal(false);
  readonly burning = readonlySignal(this.burningState);
  private disposed = false;
  readonly entity: ItemEntity;
  private owner: EquipmentOwner | null = null;
  private held = false;
  private hasFire = false;
  private options: TorchLifecycleOptions;
  private readonly ownSounds = new Set<SoundHandle>();

  constructor(entity: ItemEntity, options: TorchLifecycleOptions = {}) {
    if (entity.prefab !== TORCH_ID) throw new Error('TorchController requires a torch entity');
    this.entity = entity;
    this.options = options;
  }

  get isBurning(): boolean { return this.burning.peek(); }
  setPresentation(options: TorchLifecycleOptions): void { this.options = options; }
  releasePresentation(options: TorchLifecycleOptions): void {
    if (this.options === options) this.options = {};
  }
  OnDropped(): void { this.held = false; }
  private get fueled() { return this.entity.isRemoved ? undefined : this.entity.components.fueled; }

  onequip(owner?: EquipmentOwner): void {
    if (this.disposed) return;
    this.held = true;
    this.owner = owner ?? null;
    this.ignite();
  }
  onunequip(): void {
    this.stopFire(true);
    this.held = false;
    this.owner = null;
  }

  ignite(playSound = true): void {
    if (this.disposed || this.isBurning) return;
    const fueled = this.fueled;
    if (fueled && !fueled.IsEmpty()) {
      this.hasFire = true;
      this.setBurning(true);
      if (playSound) this.playSound('dontstarve/wilson/torch_swing');
    }
  }

  extinguish(): void {
    this.OnExtinguish();
    this.stopFire(true);
  }

  /** torch.lua: pickup clears fire, restores idle and stops fuel without emptying it. */
  OnPutInInventory(ownerPosition?: THREE.Vector3): void {
    if (this.disposed) return;
    this.held = true;
    this.options.returnToIdle?.();
    this.stopFire(true, ownerPosition);
    this.owner = null;
    this.stopOwnSounds();
  }

  /** External ground extinguishing; held or depleted torches use their own cleanup path. */
  OnExtinguish(): void {
    this.fueled?.Settle();
    if (this.disposed || this.held || !this.hasFire || (this.fueled?.IsEmpty() ?? true)) return;
    this.stopFire(true);
    this.options.returnToIdle?.();
    this.options.onGroundExtinguish?.();
  }

  /** torch.lua onfuelchange: burning out extinguishes, then removes the inst before the owner's itemranout. */
  onfuelchange(newsection: number): void {
    if (newsection > 0 || this.disposed) return;
    const owner = this.owner;
    this.stopFire(true, this.options.soundPosition);
    this.entity.remove();
    // Remove before itemranout so the owner can re-equip another torch.
    if (this.entity.isRemoved) owner?.PushEvent('itemranout', { prefab: TORCH_ID, equipslot: 'hand', announce: 'ANNOUNCE_TORCH_OUT' });
    if (this.entity.isRemoved) this.dispose();
  }

  dispose(): void {
    this.disposed = true;
    this.stopFire(false);
    this.held = false;
    this.owner = null;
    this.stopOwnSounds();
  }

  /** burnable:Ignite / Extinguish start and stop fueled consumption on the item's game time. */
  private setBurning(burning: boolean): void {
    if (burning) this.fueled?.StartConsuming();
    else this.fueled?.StopConsuming();
    this.burningState.set(burning);
  }

  private stopFire(playSound: boolean, ownerPosition?: THREE.Vector3): void {
    const hadFire = this.hasFire;
    this.hasFire = false;
    this.setBurning(false);
    if (hadFire && playSound) this.playSound('dontstarve/common/fireOut', ownerPosition);
  }

  private playSound(path: typeof TORCH_SOUNDS[number], ownerPosition?: THREE.Vector3): void {
    const handle = PlaySound(path, ownerPosition ?? this.options.soundPosition);
    // Equipped/pickup sounds belong to the player, so their one-shots can finish.
    if (!this.held && ownerPosition === undefined) this.ownSounds.add(handle);
  }

  private stopOwnSounds(): void {
    for (const sound of this.ownSounds) sound.stop();
    this.ownSounds.clear();
  }
}

/** One burnable/fueled lifecycle per inst, independent of its current owner and art. */
export function getTorchController(entity: ItemEntity): TorchController {
  return entity.component('torch', () => new TorchController(entity));
}

/** Equipment-scoped presentation bindings; the controller stays on the item entity. */
export function createTorchHandLifecycle(
  entity: ItemEntity,
  options: {
    soundPosition?: THREE.Vector3;
    lightParent: PrefabInstance;
    followSymbol?(symbol: string, offsetX: number, offsetY: number, fx?: FollowerFx): { node: THREE.Object3D; remove(): void };
  },
): EquipmentLifecycle {
  const controller = getTorchController(entity);
  const presentation = { soundPosition: options.soundPosition };
  let stopBurning: (() => void) | undefined;
  let removeLight: (() => void) | undefined;
  let removeFire: (() => void) | undefined;
  // torch.lua onequip: torchfire follows swap_object and AttachLightTo(owner); both leave when it stops burning.
  const syncLight = (burning: boolean) => {
    removeLight?.(); removeLight = undefined;
    removeFire?.(); removeFire = undefined;
    if (!burning) return;
    // torchfire_common.lua CreateLight + AttachLightTo(owner): a player owner's light is also a playerlight.
    const light = spawnLightEntity('torchfire_light', options.lightParent);
    if (options.lightParent.hasTag('player')) light.instance.addTag('playerlight');
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

/** Preparing/replacing art never creates a second lifecycle for a live torch. */
export function createTorchGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  return {
    itemIds: [TORCH_ID],
    configureEntity: configureTorchEntity,
    create(item) {

      const { visual, instance, display } = createResidentGroundItem(context, item);
      const sprite = instance.sprite;
      const model = visual.model;
      let fling: LootFling | undefined;
      let state = item;
      let entity: ItemEntity | undefined;
      let standalone = false;
      let controller: TorchController | undefined;
      let stopBurning: (() => void) | undefined;
      const options: TorchLifecycleOptions = {
        soundPosition: model.position,
        returnToIdle: () => sprite.playOnce('idle'),
        onGroundExtinguish: () => {
          if (!entity) return;
          const scale = TILE_SIZE / 4, angle = Math.random() * Math.PI * 2, speed = Math.random() * scale;
          const position = entity.transform.position.clone();
          fling = new LootFling(entity.transform);
          entity.transform.position.copy(position);
          fling.height = 0.1 * scale;
          fling.velocity.set(Math.cos(angle) * speed, (8 + Math.random()) * scale, Math.sin(angle) * speed);
        },
      };
      const syncBurning = (burning: boolean) => {
        prefabInstance(model)!.light.set(burning ? TORCH_LIGHT : null);
        if (burning) sprite.playOnce('land');
      };
      const bind = () => {
        if (!entity) {
          standalone = !state.entity;
          entity = state.entity ?? new ItemEntity(state);
          controller = getTorchController(entity);
          model.userData.torch = controller;
          stopBurning = controller.burning.subscribe(syncBurning);
        }
        controller!.setPresentation(options);
        syncBurning(controller!.isBurning);
      };
      const removeEvents = listenInventoryEvents(model, {
        onputininventory: () => { fling = undefined; controller?.OnPutInInventory(context.inventoryOwnerPosition); },
        onextinguish: () => controller?.extinguish(),
        ondropped: () => { bind(); controller!.OnDropped(); },
        onload: () => { bind(); controller!.OnDropped(); if (state.torchLit) controller!.ignite(false); },
      });
      // No `active`: a burning torch keeps consuming fuel while its tile only releases the sprite.
      return {
        model, instance, display,
        isRemoved: () => entity?.isRemoved ?? false,
        setDefinition: (definition) => {
          state = definition;
          if (standalone && entity) entity.apply(definition);
        },
        getDefinition: () => {
          const fueled = entity?.components.fueled;
          fueled?.Settle();
          return { remainingFuel: fueled ? fueled.OnSave()?.fuel : state.remainingFuel, torchLit: controller?.isBurning ?? false };
        },
        update(dt: number) {
          if (fling) {
            fling.update(dt);
            model.children[0].position.y = fling.height;
            if (fling.settled) fling = undefined;
          }
        },
        dispose() {
          removeEvents(); stopBurning?.();
          controller?.releasePresentation(options);
          if (standalone) entity?.destroy();
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
