import { definePrefabIds } from './prefabRegistration';
import { Pickable } from './components/pickable';
import { addComponent } from './components';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { SpriteState } from '@dontstarve-web/display';
import { PrefabInstance, type EntityTask, type PrefabEntityDefinition } from './prefabInstance';
import {
  createRenderEffect,
  untrack,
  watchSignal,
  WorldContentKey,
  type GetWatchWorldContent,
} from '@dontstarve-web/signals';
import type { ComponentUpdates } from '../../componets/src/componentUpdates';
import { BlowInWind } from '../../componets/src/blowinwind';
import { DEFAULT_RUN_SPEED, DEFAULT_WALK_SPEED, LocoMotor } from '../../componets/src/locomotor';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { WorldWind, WorldWindChange } from '../../componets/src/worldwind';
import { MakeCharacterPhysics, WORLD_SCALE } from './standardcomponents';

export const TUMBLEWEED_ID = 'tumbleweed' as const;
export const TUMBLEWEED_BREAKFX_ID = 'tumbleweedbreakfx' as const;
export type TumbleweedPrefabId = typeof TUMBLEWEED_ID | typeof TUMBLEWEED_BREAKFX_ID;
const FRAMES = 1 / 30;
const DEGREES = Math.PI / 180;
const ANGLE_VARIANCE = 10;

/** tumbleweed.lua MakeLoot: weights as written. Chess sketches need chessunlocks, which is absent here. */
export const TUMBLEWEED_LOOT: readonly { chance: number; item: string; aggro?: true }[] = [
  { chance: 40, item: 'cutgrass' },
  { chance: 40, item: 'twigs' },
  { chance: 1, item: 'petals' },
  { chance: 1, item: 'foliage' },
  { chance: 1, item: 'silk' },
  { chance: 1, item: 'rope' },
  { chance: 2, item: 'seeds' },
  { chance: 0.01, item: 'purplegem' },
  { chance: 0.04, item: 'bluegem' },
  { chance: 0.02, item: 'redgem' },
  { chance: 0.02, item: 'orangegem' },
  { chance: 0.01, item: 'yellowgem' },
  { chance: 0.02, item: 'greengem' },
  { chance: 0.5, item: 'trinket_6' },
  { chance: 0.5, item: 'trinket_4' },
  { chance: 1, item: 'cutreeds' },
  { chance: 0.33, item: 'feather_crow' },
  { chance: 0.33, item: 'feather_robin' },
  { chance: 0.33, item: 'feather_robin_winter' },
  { chance: 0.33, item: 'feather_canary' },
  { chance: 1, item: 'trinket_3' },
  { chance: 1, item: 'beefalowool' },
  { chance: 0.1, item: 'rabbit' },
  { chance: 0.1, item: 'mole' },
  { chance: 0.1, item: 'spider', aggro: true },
  { chance: 0.1, item: 'frog', aggro: true },
  { chance: 0.1, item: 'bee', aggro: true },
  { chance: 0.1, item: 'mosquito', aggro: true },
  { chance: 1, item: 'butterflywings' },
  { chance: 0.02, item: 'beardhair' },
  { chance: 1, item: 'berries' },
  { chance: 1, item: 'blueprint' },
  { chance: 1, item: 'petals_evil' },
  { chance: 1, item: 'trinket_8' },
  { chance: 1, item: 'houndstooth' },
  { chance: 1, item: 'stinger' },
  { chance: 1, item: 'gears' },
  { chance: 0.1, item: 'boneshard' },
  { chance: 0.25, item: 'cookingrecipecard' },
  { chance: 0.25, item: 'scrapbook_page' },
];

/** Three independent weighted rolls, as tumbleweed.lua's `while num_loots > 0` loop. */
export function rollTumbleweedLoot(random: () => number = Math.random): string[] {
  const total = TUMBLEWEED_LOOT.reduce((sum, entry) => sum + entry.chance, 0);
  const loot: string[] = [];
  while (loot.length < 3) {
    let roll = random() * total;
    for (const entry of TUMBLEWEED_LOOT) {
      roll -= entry.chance;
      if (roll <= 0) {
        loot.push(entry.item);
        break;
      }
    }
  }
  return loot;
}

export interface TumbleweedWorld {
  getWatchWorldContent?: GetWatchWorldContent;
  scheduler: GameTimeScheduler;
  /** StartUpdatingComponent: blowinwind's OnUpdate and the entity following its body each frame, after the physics step. */
  componentUpdates: ComponentUpdates;
  /** SpawnPrefab("tumbleweedbreakfx"). */
  spawnPrefab(prefab: typeof TUMBLEWEED_BREAKFX_ID, position: ReadonlyVector3): unknown;
  /** `TheWorld.components.worldwind`. */
  wind?: WorldWind;
  isOnValidGround(position: ReadonlyVector3): boolean;
  constrainPosition(position: THREE.Vector3): void;
  /** Spawn the rolled loot items at the tumbleweed's position. Items the world cannot spawn are the caller's concern. */
  dropLoot(items: readonly string[], position: ReadonlyVector3): void;
  random?: () => number;
}

/** math.clamp(GetRandomWithVariance(angle, 10), 0, 360). */
const varyAngle = (angle: number, random: () => number) =>
  Math.min(360, Math.max(0, angle + random() * 2 * ANGLE_VARIANCE - ANGLE_VARIANCE));

/** tumbleweed.lua fn(): wind-driven and four-faced, picked for its three loot rolls. Burning, sounds and haunting are not ported. */
export class TumbleweedInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { blowinwind: BlowInWind };
  readonly locomotor: LocoMotor;
  /** MakeLoot: rolled once when the entity is created. */
  readonly loot: readonly string[];
  private angle?: number;
  private readonly world: TumbleweedWorld;
  private readonly random: () => number;
  bouncepretask?: EntityTask;
  bouncetask?: EntityTask;
  restartmovementtask?: EntityTask;

  constructor(world: TumbleweedWorld) {
    super(TUMBLEWEED_ID, new SpriteState({ name: 'move_loop', billboard: true }));
    this.world = world;
    this.BindScheduler(world.scheduler);
    const random = (this.random = world.random ?? Math.random);
    this.sprite.setFacingRotation(0, 4);
    // AddComponent("locomotor") on the inst itself.
    this.locomotor = new LocoMotor(this);
    this.locomotor.walkspeed = DEFAULT_WALK_SPEED * WORLD_SCALE;
    this.locomotor.runspeed = DEFAULT_RUN_SPEED * WORLD_SCALE;
    addComponent(
      this,
      'blowinwind',
      BlowInWind,
      ((DEFAULT_RUN_SPEED + DEFAULT_WALK_SPEED) / 2) * WORLD_SCALE,
      this.locomotor,
      random,
    );
    this.loot = rollTumbleweedLoot(random);
    // AddComponent("pickable"): onpickedfn = onpickup, remove_when_picked, canbepicked = true.
    const pickable = addComponent(
      this,
      'pickable',
      Pickable,
      undefined,
      undefined,
      1,
      () => {
        this.onpickup();
      },
      undefined,
      undefined,
      { scheduler: world.scheduler },
    );
    pickable.picksound = 'dontstarve/wilson/harvest_sticks';
    pickable.remove_when_picked = true;
    const cleanups: (() => void)[] = [world.componentUpdates.register({ OnUpdate: dt => this.OnUpdate(dt) })];
    // inst:ListenForEvent("startlongaction", OnLongAction) — PICK's long action pushes it on the target.
    cleanups.push(this.ListenForEvent('startlongaction', () => this.OnLongAction()));
    const wind = world.getWatchWorldContent
      ? world.getWatchWorldContent(WorldContentKey.Wind, stop => cleanups.push(stop))
      : world.wind
        ? watchSignal(world.wind.windchange, stop => cleanups.push(stop))
        : undefined;
    if (wind) {
      this.angle = varyAngle(wind.value.angle, random);
      this.components.blowinwind.Start(this.angle * DEGREES);
      let windChange = wind.value;
      // Owned by the watched wind, so its cleanup releases it.
      createRenderEffect(() => {
        const change = wind.get();
        if (change === windChange) {
          return;
        }
        windChange = change;
        untrack(() => this.DoDirectionChange(change));
      });
    }
    this.OnEntityWake = OnEntityWake;
    this.OnEntitySleep = OnEntitySleep;
    this.onRemove(() => {
      for (const cleanup of cleanups.splice(0)) {
        cleanup();
      }
    });
  }

  /** MakeCharacterPhysics's body, which the wind drives and the entity follows; the manager binds it at the spawn position. */
  private get body(): CANNON.Body {
    return this.physicsBody!;
  }

  /** The spawn point inside the world's edge; the body moves with it. */
  placeOnSpawn(): void {
    const placed = this.position.clone();
    this.world.constrainPosition(placed);
    if (placed.equals(this.position)) {
      return;
    }
    this.copyPosition(placed);
    this.physics.Teleport();
  }

  /** Transform:SetRotation on a four-faced inst: the facing follows the heading. */
  override setRotation(degrees: number): void {
    super.setRotation(degrees);
    this.sprite.setFacingRotation(degrees, 4);
  }

  /** Physics:SetMotorVel: the wind drives the body forward along the heading. */
  setMotorSpeed(speed: number): void {
    const radians = this.rotation * DEGREES;
    this.body.velocity.x = Math.cos(radians) * speed;
    this.body.velocity.z = -Math.sin(radians) * speed;
  }

  private DoDirectionChange(change: WorldWindChange): void {
    if (this.IsAsleep() || this.isRemoved) {
      return;
    }
    const first = this.angle === undefined;
    this.angle = varyAngle(change.angle, this.random);
    if (first) {
      this.components.blowinwind.Start(this.angle * DEGREES, change.velocity);
    } else {
      this.components.blowinwind.ChangeDirection(this.angle * DEGREES, change.velocity);
    }
  }

  /** The bounce tasks of startmoving / OnEntityWake: their sounds are not ported, so only CheckGround remains. */
  armGroundCheck(): void {
    this.bouncepretask = this.DoTaskInTime(10 * FRAMES, () => {
      this.bouncetask = this.DoPeriodicTask(24 * FRAMES, () => this.CheckGround());
    });
  }
  private CheckGround(): void {
    if (!this.world.isOnValidGround(this.position)) {
      this.remove();
    }
  }

  private startmoving(): void {
    if (this.IsAsleep() || this.isRemoved) {
      return;
    }
    this.sprite.start('move_loop');
    this.armGroundCheck();
    this.components.blowinwind.Start();
  }

  /** Physics:Stop: the body halts where it is. */
  stopBody(): void {
    this.locomotor.StopMoving();
    const body = this.physicsBody;
    if (body) {
      body.velocity.set(0, body.velocity.y, 0);
    }
  }

  /** OnLongAction: stop, settle, and roll again after two to six seconds. */
  private OnLongAction(): void {
    if (this.isRemoved) {
      return;
    }
    this.stopBody();
    this.components.blowinwind.Stop();
    CancelRunningTasks(this);
    this.sprite.playOnce('move_pst');
    this.sprite.pushAnimation('idle', true);
    this.restartmovementtask = this.DoTaskInTime(2 + Math.floor(this.random() * 5), () => {
      this.restartmovementtask = undefined;
      this.sprite.playOnce('move_pre', () => this.startmoving());
    });
  }

  /** onpickup: loot at the tumbleweed, the break fx, and no item for the picker. */
  private onpickup(): boolean {
    if (this.isRemoved) {
      return false;
    }
    const position = this.position.clone();
    this.world.dropLoot(this.loot, position);
    this.world.spawnPrefab(TUMBLEWEED_BREAKFX_ID, position);
    this.remove();
    return true;
  }

  /**
   * After the physics step the entity follows its body; blowinwind's OnUpdate then sets the walk speed and motor
   * velocity that the next step applies.
   */
  private OnUpdate(dt: number): void {
    if (!Number.isFinite(dt) || dt < 0) {
      return;
    }
    const body = this.physicsBody;
    if (body) {
      const position = new THREE.Vector3(body.position.x, 0, body.position.z);
      this.world.constrainPosition(position);
      this.copyPosition(position);
    }
    this.components.blowinwind.Update(Math.min(dt, 0.1));
  }
}

/** CancelRunningTasks: the bounce and restart tasks stop. */
function CancelRunningTasks(inst: TumbleweedInstance): void {
  inst.bouncepretask?.Cancel();
  inst.bouncepretask = undefined;
  inst.bouncetask?.Cancel();
  inst.bouncetask = undefined;
  inst.restartmovementtask?.Cancel();
  inst.restartmovementtask = undefined;
}

/**
 * inst.OnEntitySleep = CancelRunningTasks; blowinwind's own OnEntitySleep then stops the wind. Nothing drives the body
 * while the entity sleeps, so it halts where it is.
 */
function OnEntitySleep(inst: TumbleweedInstance): void {
  CancelRunningTasks(inst);
  inst.stopBody();
}

/** OnEntityWake: move_loop again and the bounce tasks; blowinwind's own OnEntityWake then restarts the wind. */
function OnEntityWake(inst: TumbleweedInstance): void {
  inst.sprite.start('move_loop');
  inst.armGroundCheck();
}

/** tumbleweedbreakfx (burntfxfn's sibling fxfn): FX, not persistent, removed by its own animover. */
function breakfxfn(): PrefabInstance {
  const inst = new PrefabInstance(
    TUMBLEWEED_BREAKFX_ID,
    new SpriteState({ name: 'break', held: true, billboard: true }),
  );
  inst.addTag('FX');
  inst.persists = false;
  inst.sprite.setFacingRotation(0, 4);
  // Declared before the display binds: the one-shot waits for its first drawn frame.
  inst.sprite.playOnce('break', () => inst.remove());
  return inst;
}

/** The Prefab table tumbleweed.lua returns. */
export function tumbleweedPrefabs(
  world: TumbleweedWorld,
): Readonly<Record<TumbleweedPrefabId, PrefabEntityDefinition<PrefabInstance>>> {
  const assets = {
    animationArchive: 'tumbleweed.zip',
    buildArchives: ['tumbleweed.zip'],
    bank: 'tumbleweed',
    // swap_fire is the burn fx attach point (AddBurnFX); it has no art in the build.
    hiddenSymbols: ['swap_fire'],
  };
  return {
    [TUMBLEWEED_ID]: {
      fn: () => new TumbleweedInstance(world),
      assets,
      // MakeCharacterPhysics(inst, .5, 1).
      physics: { make: (inst, radius) => MakeCharacterPhysics(inst, 0.5, radius), radius: 1 },
      onSpawned: inst => inst.placeOnSpawn(),
    } satisfies PrefabEntityDefinition<TumbleweedInstance>,
    [TUMBLEWEED_BREAKFX_ID]: { fn: breakfxfn, assets, targetable: false },
  };
}

export const tumbleweedRegistration = {
  create: tumbleweedPrefabs,
  families: { tumbleweeds: definePrefabIds([TUMBLEWEED_ID], true) },
};
