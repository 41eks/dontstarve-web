import { ItemEntity } from '@dontstarve-web/inventory';
import { createSignal, readonlySignal, type EquipmentLifecycle, type EquipmentOwner, type HandEquipment } from '@dontstarve-web/signals';
import type * as THREE from 'three';
import { Lighter } from '../../componets/src/lighter';
import { handEquipmentVisual, type PrepareEquipmentVisual } from './equipmentVisual';
import { createResidentGroundItem, GROUND_ITEM_DEFINITIONS } from './groundItems';
import type { GroundItemFactory, GroundPrefabContext } from './groundPrefab';
import { listenInventoryEvents } from './inventoryEvents';
import { attachPrefabLight, setPrefabLocalLight, type PrefabLocalLight } from './localLight';
import { LootFling } from './lootFling';
import { PlaySound, PreloadSounds, type SoundHandle } from './sound';
import { TILE_SIZE } from './tile';
import { TORCH_FIRE_OFFSET_Y, TorchFireEffect } from './torchfire';

export function configureTorchEntity(entity: ItemEntity): void {
  entity.components.lighter = entity.component('lighter', () => new Lighter(entity));
}

export const TORCH_ID = 'torch';
/** tuning.lua: TORCH_FUEL = night_time * 1.25, with a default 30 * 2 second night. */
export const TORCH_FUEL = 30 * 2 * 1.25;
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
  private pendingFrames = 0;
  private pendingSeconds = 0;
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
  flush(): void { this.flushFuel(); }
  private remainingFuel(): number | null {
    return this.entity.isRemoved ? null : this.entity.components.fueled.remaining ?? TORCH_FUEL;
  }

  onequip(owner?: EquipmentOwner): void {
    if (this.disposed) return;
    this.held = true;
    this.owner = owner ?? null;
    this.ignite();
  }
  onunequip(): void {
    this.flushFuel();
    this.stopFire(true);
    this.held = false;
    this.owner = null;
  }

  ignite(playSound = true): void {
    if (this.disposed || this.isBurning) return;
    const remaining = this.remainingFuel();
    if (remaining !== null && remaining > 0) {
      this.hasFire = true;
      this.setBurning(true);
      if (playSound) this.playSound('dontstarve/wilson/torch_swing');
    }
  }

  extinguish(): void {
    this.flushFuel();
    this.OnExtinguish();
    this.stopFire(true);
  }

  /** torch.lua: pickup clears fire, restores idle and stops fuel without emptying it. */
  OnPutInInventory(ownerPosition?: THREE.Vector3): void {
    this.flushFuel();
    if (this.disposed) return;
    this.held = true;
    this.options.returnToIdle?.();
    this.stopFire(true, ownerPosition);
    this.owner = null;
    this.stopOwnSounds();
  }

  /** External ground extinguishing; held or depleted torches use their own cleanup path. */
  OnExtinguish(): void {
    this.flushFuel();
    if (this.disposed || this.held || !this.hasFire || (this.remainingFuel() ?? 0) <= 0) return;
    this.stopFire(true);
    this.options.returnToIdle?.();
    this.options.onGroundExtinguish?.();
  }

  /** Frame scheduling only; fuel updates use the elapsed time of each 60-frame batch. */
  onFrame(dt: number): void {
    if (!this.isBurning || this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    this.pendingSeconds += dt;
    if (++this.pendingFrames === 60) this.flushFuel();
  }

  /** Settle a partial batch before saving, transferring or stopping this torch. */
  flushFuel(): void {
    const elapsed = this.pendingSeconds;
    // Clear first: update may synchronously remove the item and invoke onunequip/dispose.
    this.pendingSeconds = 0;
    this.pendingFrames = 0;
    if (elapsed > 0) this.update(elapsed);
  }

  update(dt: number): void {
    if (!this.isBurning || this.disposed || !Number.isFinite(dt) || dt <= 0) return;
    const remaining = this.remainingFuel();
    if (remaining === null) {
      this.extinguish();
      this.dispose();
      return;
    }
    const next = Math.max(0, remaining - dt);
    if (next > 0) this.entity.setRemainingFuel(next);
    else {
      // Emit the final one-shot before Remove invokes component disposal.
      this.stopFire(true, this.options.soundPosition);
      // Removal unequips this controller and releases the owner, so take it first.
      const owner = this.owner;
      if (!this.entity.isRemoved) this.entity.remove();
      // torch.lua onfuelchange: Remove before itemranout so the owner can re-equip another torch.
      if (this.entity.isRemoved) owner?.PushEvent('itemranout', { prefab: TORCH_ID, equipslot: 'hand', announce: 'ANNOUNCE_TORCH_OUT' });
      if (this.entity.isRemoved) this.dispose();
    }
  }

  dispose(): void {
    this.flushFuel();
    this.disposed = true;
    this.stopFire(false);
    this.held = false;
    this.owner = null;
    this.stopOwnSounds();
  }

  private setBurning(burning: boolean): void {
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
    lightParent: THREE.Object3D;
    followSymbol?(symbol: string, offsetX: number, offsetY: number): { node: THREE.Object3D; remove(): void };
    dataBaseUrl?: string;
  },
): EquipmentLifecycle {
  const controller = getTorchController(entity);
  const presentation = { soundPosition: options.soundPosition };
  let stopBurning: (() => void) | undefined;
  let removeLight: (() => void) | undefined;
  let removeFire: (() => void) | undefined;
  let fire: TorchFireEffect | undefined;
  // torch.lua onequip: torchfire follows swap_object and AttachLightTo(owner); both leave when it stops burning.
  const syncLight = (burning: boolean) => {
    removeLight?.(); removeLight = undefined;
    fire?.dispose(); fire = undefined;
    removeFire?.(); removeFire = undefined;
    if (!burning) return;
    removeLight = attachPrefabLight(options.lightParent, 'TorchFireLight', TORCH_LIGHT);
    if (options.followSymbol && options.dataBaseUrl !== undefined) {
      const follower = options.followSymbol('swap_object', 0, TORCH_FIRE_OFFSET_Y);
      removeFire = follower.remove;
      fire = new TorchFireEffect(follower.node, options.dataBaseUrl);
    }
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
    onFrame: dt => { controller.onFrame(dt); fire?.update(dt); },
    flush: () => controller.flushFuel(),
  };
}

/** Preparing/replacing art never creates a second lifecycle for a live torch. */
export function createTorchGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  return {
    itemIds: [TORCH_ID],
    configureEntity: configureTorchEntity,
    async create(item) {
      await PreloadSounds(...TORCH_SOUNDS);
      const { visual, instance } = await createResidentGroundItem(context, item);
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
        setPrefabLocalLight(model, burning ? TORCH_LIGHT : null);
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
        model, instance,
        isRemoved: () => entity?.isRemoved ?? false,
        setDefinition: (definition) => {
          state = definition;
          if (standalone && entity) entity.apply(definition);
        },
        getDefinition: () => {
          controller?.flushFuel();
          return { remainingFuel: entity?.components.fueled.remaining ?? state.remainingFuel, torchLit: controller?.isBurning ?? false };
        },
        update(dt: number) {
          controller?.onFrame(dt); sprite.update(dt);
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

export const prepareTorchVisual: PrepareEquipmentVisual = async (assets, item) => {
  const archive = item.skinId ? GROUND_ITEM_DEFINITIONS.torch.skinArchives[item.skinId] : undefined;
  if (item.skinId && !archive) throw new Error(`Unknown torch skin: ${item.skinId}`);
  const [base, skin] = await Promise.all([assets.loadBuild('swap_torch.zip'), archive ? assets.loadBuild(archive) : undefined]);
  return handEquipmentVisual(item, skin ? [skin, base] : [base], 'swap_torch');
};
