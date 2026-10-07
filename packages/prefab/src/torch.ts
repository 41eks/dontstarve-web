import { createSignal, readonlySignal, type HandEquipment, type Signal } from '@dontstarve-web/signals';
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

/** A torch's persistent state; the application supplies its authoritative storage. */
export interface TorchFuelState {
  getRemainingFuel(): number | null;
  setRemainingFuel(seconds: number): boolean;
  remove(): boolean;
}

/** torch.lua's onequip/onunequip and burnable/fueled lifecycle. */
export class TorchController implements HandEquipment {
  public readonly itemId = TORCH_ID;
  public readonly EQUIPSLOTS: 'HANDS' = 'HANDS';
  private readonly burningState = createSignal(false);
  readonly burning = readonlySignal(this.burningState);
  private disposed = false;
  private readonly fuel: TorchFuelState;
  private slotSignal: Signal<HandEquipment | null> | null = null;
  private equipment: HandEquipment | null = null;
  private held = false;
  private hasFire = false;
  private pendingFrames = 0;
  private pendingSeconds = 0;
  private readonly options: TorchLifecycleOptions;
  private readonly ownSounds = new Set<SoundHandle>();

  constructor(fuel: TorchFuelState, options: TorchLifecycleOptions = {}) {
    this.fuel = fuel;
    this.options = options;
  }

  get isBurning(): boolean { return this.burning.peek(); }

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
    const remaining = this.fuel.getRemainingFuel();
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
    if (this.disposed || this.held || !this.hasFire || (this.fuel.getRemainingFuel() ?? 0) <= 0) return;
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
    const remaining = this.fuel.getRemainingFuel();
    if (remaining === null) {
      this.extinguish();
      return;
    }
    const next = Math.max(0, remaining - dt);
    if (next > 0) this.fuel.setRemainingFuel(next);
    else if (this.fuel.remove()) {
      // The final one-shot outlives the removed ground entity, as during Lua's erode.
      this.stopFire(true, this.options.soundPosition);
      this.extinguish();
      this.dispose();
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

/** Ordinary drops are unlit; a lit restored ground torch owns its fuel and light. */
export function createTorchGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  return {
    itemIds: [TORCH_ID],
    async create(item) {
      await PreloadSounds(...TORCH_SOUNDS);
      const sprite = await createGroundItemSprite(context.assets, TORCH_ID, item.skinId);
      let removed = false, fling: LootFling | undefined, state = item;
      const controller = new TorchController({
        getRemainingFuel: () => removed ? null : state.remainingFuel ?? TORCH_FUEL,
        setRemainingFuel: (seconds) => { state.remainingFuel = seconds; return true; },
        remove: () => { removed = true; return true; },
      }, {
        soundPosition: sprite.model.position,
        returnToIdle: () => sprite.setAnimation('idle'),
        onGroundExtinguish: () => {
          const scale = TILE_SIZE / 4, angle = Math.random() * Math.PI * 2, speed = Math.random() * scale;
          fling = new LootFling(sprite.model.position);
          fling.position.copy(sprite.model.position);
          fling.height = 0.1 * scale;
          fling.velocity.set(Math.cos(angle) * speed, (8 + Math.random()) * scale, Math.sin(angle) * speed);
        },
      });
      sprite.model.userData.torch = controller;
      const stopBurning = controller.burning.subscribe((burning) => {
        setPrefabLocalLight(sprite.model, burning ? {
          radius: 2 * (TILE_SIZE / 4) * 1.5, falloff: 0.5, intensity: 0.75,
          colour: [180 / 255, 195 / 255, 150 / 255],
        } : null);
        if (burning) sprite.setAnimation('land');
      });
      const removeEvents = listenInventoryEvents(sprite.model, {
        onputininventory: () => { fling = undefined; controller.OnPutInInventory(context.inventoryOwnerPosition); },
        onextinguish: () => controller.extinguish(),
        onload: () => { if (state.torchLit) controller.ignite(false); },
      });
      return {
        model: sprite.model,
        isRemoved: () => removed,
        setDefinition: (definition) => { state = definition; },
        getDefinition: () => {
          controller.flushFuel();
          return { remainingFuel: state.remainingFuel, torchLit: controller.isBurning };
        },
        update(dt: number) {
          controller.onFrame(dt); sprite.update(dt);
          if (fling) {
            fling.update(dt); sprite.model.position.copy(fling.position);
            sprite.model.children[0].position.y = fling.height;
            if (fling.settled) fling = undefined;
          }
        },
        dispose() { removeEvents(); controller.dispose(); stopBurning(); sprite.dispose(); },
      };
    },
  };
}
