import { ItemEntity } from '@dontstarve-web/inventory';
import { createSignal, readonlySignal, type HandEquipment, type HandEquipmentLifecycle, type Signal } from '@dontstarve-web/signals';
import { PlaySound, PreloadSounds, type SoundHandle, type SoundPosition } from './sound';
import { createGroundItemSprite } from './groundItems';
import { listenInventoryEvents } from './inventoryEvents';
import { setPrefabLocalLight } from './localLight';
import { LootFling } from './lootFling';
import { TILE_SIZE } from './tile';
import type { GroundItemFactory, GroundPrefabContext } from './groundPrefab';

export const TORCH_ID = 'torch';
/** tuning.lua: TORCH_FUEL = night_time * 1.25, with a default 30 * 2 second night. */
export const TORCH_FUEL = 30 * 2 * 1.25;
export const TORCH_SOUNDS = ['dontstarve/wilson/torch_swing', 'dontstarve/common/fireOut'] as const;

export interface TorchLifecycleOptions {
  soundPosition?: SoundPosition;
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
  private slotSignal: Signal<HandEquipment | null> | null = null;
  private equipment: HandEquipment | null = null;
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

  onequip(slotSignal: Signal<HandEquipment | null>): void {
    if (this.disposed) return;
    this.held = true;
    this.slotSignal = slotSignal;
    this.equipment = slotSignal.peek();
    this.ignite();
  }
  onunequip(): void {
    this.flushFuel();
    this.stopFire(true);
    this.held = false;
    this.slotSignal = null;
    this.equipment = null;
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
    const slotSignal = this.slotSignal, equipment = this.equipment;
    this.flushFuel();
    this.OnExtinguish();
    this.stopFire(true);
    const current = slotSignal?.peek();
    // A stale torch cannot clear the equipment that replaced it.
    if (slotSignal && current === equipment && current?.itemId === TORCH_ID) {
      slotSignal.set(null);
    }
  }

  /** torch.lua: pickup clears fire, restores idle and stops fuel without emptying it. */
  OnPutInInventory(ownerPosition?: SoundPosition): void {
    this.flushFuel();
    if (this.disposed) return;
    this.held = true;
    this.options.returnToIdle?.();
    this.stopFire(true, ownerPosition);
    this.slotSignal = null;
    this.equipment = null;
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
      return;
    }
    const next = Math.max(0, remaining - dt);
    if (next > 0) this.entity.setRemainingFuel(next);
    else {
      // Emit the final one-shot before Remove invokes component disposal.
      this.stopFire(true, this.options.soundPosition);
      if (this.entity.remove()) { this.extinguish(); this.dispose(); }
    }
  }

  dispose(): void {
    this.flushFuel();
    this.disposed = true;
    this.stopFire(false);
    this.held = false;
    this.slotSignal = null;
    this.equipment = null;
    this.stopOwnSounds();
  }

  private setBurning(burning: boolean): void {
    this.burningState.set(burning);
  }

  private stopFire(playSound: boolean, ownerPosition?: SoundPosition): void {
    const hadFire = this.hasFire;
    this.hasFire = false;
    this.setBurning(false);
    if (hadFire && playSound) this.playSound('dontstarve/common/fireOut', ownerPosition);
  }

  private playSound(path: typeof TORCH_SOUNDS[number], ownerPosition?: SoundPosition): void {
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
  options: { soundPosition?: SoundPosition; setLightActive(active: boolean): void },
): HandEquipmentLifecycle {
  const controller = getTorchController(entity);
  const presentation = { soundPosition: options.soundPosition };
  let stopBurning: (() => void) | undefined;
  return {
    onequip(slot) {
      const equipment = slot.peek();
      controller.setPresentation(presentation);
      stopBurning = controller.burning.subscribe(burning => options.setLightActive(burning));
      options.setLightActive(controller.isBurning);
      if (slot.peek() === equipment) controller.onequip(slot);
    },
    onunequip() {
      controller.onunequip();
      stopBurning?.(); stopBurning = undefined;
      controller.releasePresentation(presentation);
    },
    onFrame: dt => controller.onFrame(dt),
    flush: () => controller.flushFuel(),
  };
}

/** Preparing/replacing art never creates a second lifecycle for a live torch. */
export function createTorchGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  return {
    itemIds: [TORCH_ID],
    async create(item) {
      await PreloadSounds(...TORCH_SOUNDS);
      const sprite = await createGroundItemSprite(context.assets, TORCH_ID, item.skinId);
      let fling: LootFling | undefined;
      let state = item;
      let entity: ItemEntity | undefined;
      let standalone = false;
      let controller: TorchController | undefined;
      let stopBurning: (() => void) | undefined;
      const options: TorchLifecycleOptions = {
        soundPosition: sprite.model.position,
        returnToIdle: () => sprite.setAnimation('idle'),
        onGroundExtinguish: () => {
          const scale = TILE_SIZE / 4, angle = Math.random() * Math.PI * 2, speed = Math.random() * scale;
          fling = new LootFling(sprite.model.position);
          fling.position.copy(sprite.model.position);
          fling.height = 0.1 * scale;
          fling.velocity.set(Math.cos(angle) * speed, (8 + Math.random()) * scale, Math.sin(angle) * speed);
        },
      };
      const syncBurning = (burning: boolean) => {
        setPrefabLocalLight(sprite.model, burning ? {
          radius: 2 * (TILE_SIZE / 4) * 1.5, falloff: 0.5, intensity: 0.75,
          colour: [180 / 255, 195 / 255, 150 / 255],
        } : null);
        if (burning) sprite.setAnimation('land');
      };
      const bind = () => {
        if (!entity) {
          standalone = !state.entity;
          entity = state.entity ?? new ItemEntity(state);
          controller = getTorchController(entity);
          sprite.model.userData.torch = controller;
          stopBurning = controller.burning.subscribe(syncBurning);
        }
        controller!.setPresentation(options);
        syncBurning(controller!.isBurning);
      };
      const removeEvents = listenInventoryEvents(sprite.model, {
        onputininventory: () => { fling = undefined; controller?.OnPutInInventory(context.inventoryOwnerPosition); },
        onextinguish: () => controller?.extinguish(),
        ondropped: () => { bind(); controller!.OnDropped(); },
        onload: () => { bind(); controller!.OnDropped(); if (state.torchLit) controller!.ignite(false); },
      });
      return {
        model: sprite.model,
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
            fling.update(dt); sprite.model.position.copy(fling.position);
            sprite.model.children[0].position.y = fling.height;
            if (fling.settled) fling = undefined;
          }
        },
        dispose() {
          removeEvents(); stopBurning?.();
          controller?.releasePresentation(options);
          if (standalone) entity?.destroy();
          sprite.dispose();
        },
      };
    },
  };
}
