import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { PrefabDisplayGroup, SpriteResources, SpriteState } from '@dontstarve-web/display';
import { bindInstance, createArchiveEntity, PrefabInstance } from './prefabInstance';
import { WorldContentKey, watchSignal, type GetWatchWorldContent, type TileStateQuery } from '@dontstarve-web/signals';
import { BlowInWind } from '../../componets/src/blowinwind';
import { ComponentTimer } from '../../componets/src/timer';
import { DEFAULT_RUN_SPEED, DEFAULT_WALK_SPEED, LocoMotor, type LocoMotorInst } from '../../componets/src/locomotor';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { WorldWind, WorldWindChange } from '../../componets/src/worldwind';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { MakeCharacterPhysics, WORLD_SCALE } from './standardcomponents';
import { watchTileActivity } from './tileActivity';

export const TUMBLEWEED_ID = 'tumbleweed' as const;
const FRAMES = 1 / 30;
const DEGREES = Math.PI / 180;
const ANGLE_VARIANCE = 10;

export interface TumbleweedRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: Record<string, never>;
}

/** tumbleweed.lua MakeLoot: weights as written. Chess sketches need chessunlocks, which is absent here. */
export const TUMBLEWEED_LOOT: readonly { chance: number; item: string; aggro?: true }[] = [
  { chance: 40, item: 'cutgrass' }, { chance: 40, item: 'twigs' }, { chance: 1, item: 'petals' },
  { chance: 1, item: 'foliage' }, { chance: 1, item: 'silk' }, { chance: 1, item: 'rope' },
  { chance: 2, item: 'seeds' }, { chance: 0.01, item: 'purplegem' }, { chance: 0.04, item: 'bluegem' },
  { chance: 0.02, item: 'redgem' }, { chance: 0.02, item: 'orangegem' }, { chance: 0.01, item: 'yellowgem' },
  { chance: 0.02, item: 'greengem' }, { chance: 0.5, item: 'trinket_6' }, { chance: 0.5, item: 'trinket_4' },
  { chance: 1, item: 'cutreeds' }, { chance: 0.33, item: 'feather_crow' }, { chance: 0.33, item: 'feather_robin' },
  { chance: 0.33, item: 'feather_robin_winter' }, { chance: 0.33, item: 'feather_canary' },
  { chance: 1, item: 'trinket_3' }, { chance: 1, item: 'beefalowool' }, { chance: 0.1, item: 'rabbit' },
  { chance: 0.1, item: 'mole' }, { chance: 0.1, item: 'spider', aggro: true }, { chance: 0.1, item: 'frog', aggro: true },
  { chance: 0.1, item: 'bee', aggro: true }, { chance: 0.1, item: 'mosquito', aggro: true },
  { chance: 1, item: 'butterflywings' }, { chance: .02, item: 'beardhair' }, { chance: 1, item: 'berries' },
  { chance: 1, item: 'blueprint' }, { chance: 1, item: 'petals_evil' }, { chance: 1, item: 'trinket_8' },
  { chance: 1, item: 'houndstooth' }, { chance: 1, item: 'stinger' }, { chance: 1, item: 'gears' },
  { chance: 0.1, item: 'boneshard' }, { chance: 0.25, item: 'cookingrecipecard' }, { chance: 0.25, item: 'scrapbook_page' },
];

/** Three independent weighted rolls, as tumbleweed.lua's `while num_loots > 0` loop. */
export function rollTumbleweedLoot(random: () => number = Math.random): string[] {
  const total = TUMBLEWEED_LOOT.reduce((sum, entry) => sum + entry.chance, 0);
  const loot: string[] = [];
  while (loot.length < 3) {
    let roll = random() * total;
    for (const entry of TUMBLEWEED_LOOT) {
      roll -= entry.chance;
      if (roll <= 0) { loot.push(entry.item); break; }
    }
  }
  return loot;
}

export interface TumbleweedWorld {
  getWatchWorldContent?: GetWatchWorldContent;
  tickingarea?: TileStateQuery;
  scheduler: GameTimeScheduler;
  /** `TheWorld.components.worldwind`. */
  wind?: WorldWind;
  isOnValidGround(position: THREE.Vector3): boolean;
  constrainPosition(position: THREE.Vector3): void;
  /** Spawn the rolled loot items at the tumbleweed's position. Items the world cannot spawn are the caller's concern. */
  dropLoot(items: readonly string[], position: THREE.Vector3): void;
  random?: () => number;
}

/** math.clamp(GetRandomWithVariance(angle, 10), 0, 360). */
const varyAngle = (angle: number, random: () => number) =>
  Math.min(360, Math.max(0, angle + random() * 2 * ANGLE_VARIANCE - ANGLE_VARIANCE));

/** tumbleweed.lua fn(): wind-driven and four-faced, picked for its three loot rolls. Burning, sounds and haunting are not ported. */
export class TumbleweedInstance extends PrefabInstance {
  readonly blowinwind: BlowInWind;
  readonly locomotor: LocoMotor;
  /** MakeLoot: rolled once when the entity is created. */
  readonly loot: readonly string[];
  private angle?: number;
  /** OnEntitySleep ran last: tasks are cancelled, and wind changes and pending animover are ignored. */
  private asleep = false;
  private readonly world: TumbleweedWorld;
  private readonly random: () => number;
  private readonly spawnBreakFx: (position: THREE.Vector3) => void;
  private readonly groundCheck: ComponentTimer;
  private groundCheckArmed = false;
  private readonly restartMovement: ComponentTimer;

  constructor(world: TumbleweedWorld, spawnBreakFx: (position: THREE.Vector3) => void) {
    super(TUMBLEWEED_ID, new SpriteState({ name: 'move_loop', billboard: true }));
    this.world = world; this.spawnBreakFx = spawnBreakFx;
    const random = this.random = world.random ?? Math.random;
    this.sprite.setFacingRotation(0, 4);
    MakeCharacterPhysics(this, .5, 1);
    this.addTag('pickable');
    const motor: LocoMotorInst = {
      isValid: () => !this.isRemoved, getPosition: () => ({ x: this.body.position.x, y: 0, z: this.body.position.z }),
      getPhysicsRadius: () => WORLD_SCALE, setRotation: degrees => this.setRotationDegrees(degrees),
      getAngleToPoint: () => this.rotation,
      setMotorSpeed: speed => this.setMotorSpeed(speed),
      components: {}, PushEvent: () => undefined, PushBufferedAction: () => undefined,
    };
    this.locomotor = new LocoMotor(motor);
    this.locomotor.walkspeed = DEFAULT_WALK_SPEED * WORLD_SCALE; this.locomotor.runspeed = DEFAULT_RUN_SPEED * WORLD_SCALE;
    this.blowinwind = new BlowInWind(motor, (DEFAULT_RUN_SPEED + DEFAULT_WALK_SPEED) / 2 * WORLD_SCALE, this.locomotor, random);
    this.groundCheck = new ComponentTimer(world.scheduler, () => this.onGroundCheck());
    this.restartMovement = new ComponentTimer(world.scheduler, () => this.onRestartMovement());
    this.loot = rollTumbleweedLoot(random);
    Object.assign(this.components, { pickable: {
      canBePicked: true, quickpick: false, product: undefined,
      pick: () => this.onpickup(),
    } });
    const cleanups: (() => void)[] = [];
    // inst:ListenForEvent("startlongaction", OnLongAction) — PICK's long action pushes it on the target.
    cleanups.push(this.ListenForEvent('startlongaction', () => this.OnLongAction()));
    const wind = world.getWatchWorldContent
      ? world.getWatchWorldContent(WorldContentKey.Wind, stop => cleanups.push(stop))
      : world.wind ? watchSignal(world.wind.windchange, stop => cleanups.push(stop)) : undefined;
    if (wind) {
      this.angle = varyAngle(wind.peek().angle, random);
      this.blowinwind.Start(this.angle * DEGREES);
      wind.subscribe(change => this.DoDirectionChange(change));
    }
    this.onRemove(() => {
      this.blowinwind.dispose();
      this.CancelRunningTasks();
      for (const cleanup of cleanups.splice(0)) cleanup();
    });
  }

  /** MakeCharacterPhysics's body, which the wind drives and the entity follows; the manager binds it at the spawn position. */
  private get body(): CANNON.Body { return this.physicsBody!; }

  private setRotationDegrees(degrees: number): void {
    this.setRotation(degrees);
    this.sprite.setFacingRotation(degrees, 4);
  }

  private setMotorSpeed(speed: number): void {
    const radians = this.rotation * DEGREES;
    this.body.velocity.x = Math.cos(radians) * speed;
    this.body.velocity.z = -Math.sin(radians) * speed;
  }

  private DoDirectionChange(change: WorldWindChange): void {
    if (this.asleep || this.isRemoved) return;
    const first = this.angle === undefined;
    this.angle = varyAngle(change.angle, this.random);
    if (first) this.blowinwind.Start(this.angle * DEGREES, change.velocity);
    else this.blowinwind.ChangeDirection(this.angle * DEGREES, change.velocity);
  }

  /** The bounce tasks of startmoving / OnEntityWake: their sounds are not ported, so only CheckGround remains. */
  private armGroundCheck(): void {
    this.groundCheckArmed = false;
    this.groundCheck.start(10 * FRAMES);
  }
  private onGroundCheck(): void {
    if (!this.groundCheckArmed) { this.groundCheckArmed = true; this.groundCheck.start(24 * FRAMES); return; }
    this.groundCheck.start(24 * FRAMES);
    if (!this.world.isOnValidGround(this.position)) this.remove();
  }

  private startmoving(): void {
    if (this.asleep || this.isRemoved) return;
    this.sprite.start('move_loop');
    this.armGroundCheck();
    this.blowinwind.Start();
  }

  private stopPhysics(): void {
    this.locomotor.StopMoving();
    const body = this.physicsBody;
    if (body) body.velocity.set(0, body.velocity.y, 0);
    this.blowinwind.Stop();
  }

  private CancelRunningTasks(): void {
    this.groundCheck.stop();
    this.restartMovement.stop();
  }

  /** OnEntitySleep comes first so a clip the sleep settles cannot start moving; OnEntityWake plays once the display is awake. */
  setAwake(active: boolean): void {
    if (active) {
      this.asleep = false;
      this.setActive(true);
      this.sprite.start('move_loop');
      this.armGroundCheck();
      this.blowinwind.OnEntityWake();
    } else {
      this.asleep = true;
      this.CancelRunningTasks();
      this.stopPhysics();
      this.setActive(false);
    }
  }

  /** OnLongAction: stop, settle, and roll again after two to six seconds. */
  private OnLongAction(): void {
    if (this.isRemoved) return;
    this.stopPhysics();
    this.CancelRunningTasks();
    this.sprite.playOnce('move_pst');
    this.sprite.pushAnimation('idle', true);
    this.restartMovement.start(2 + Math.floor(this.random() * 5));
  }
  private onRestartMovement(): void {
    this.sprite.playOnce('move_pre', () => this.startmoving());
  }

  /** onpickup: loot at the tumbleweed, the break fx, and no item for the picker. */
  private onpickup(): boolean {
    if (this.isRemoved) return false;
    const position = this.position.clone();
    this.world.dropLoot(this.loot, position);
    this.spawnBreakFx(position);
    this.remove();
    return true;
  }

  /** Before physics: wind integration sets the walk speed, then cannon applies the motor velocity. */
  update(dt: number): void { this.blowinwind.Update(dt); }

  /** After physics: the entity follows its body. */
  sync(): void {
    this.setPosition(this.body.position.x, 0, this.body.position.z);
    this.world.constrainPosition(this.position);
    this.tileTracker.sync();
  }
}

/** The tumbleweeds and their break fx: the collection, injected world and shared tumbleweed.zip. */
export class TumbleweedManager {
  private readonly resources = new SpriteResources(undefined, TUMBLEWEED_ID);
  private readonly tumbleweeds = new Set<TumbleweedInstance>();
  private readonly breakFx = new Set<PrefabInstance>();
  private readonly displays: PrefabDisplayGroup;
  private readonly physics: CANNON.World;
  private readonly world: TumbleweedWorld;
  private disposed = false;

  constructor(scene: THREE.Scene, physics: CANNON.World, world: TumbleweedWorld) {
    this.displays = new PrefabDisplayGroup(scene); this.physics = physics; this.world = world;
  }

  private get archive() {
    return this.resources.archive({ animationArchive: 'tumbleweed.zip', buildArchives: ['tumbleweed.zip'], bank: 'tumbleweed',
      // swap_fire is the burn fx attach point (AddBurnFX); it has no art in the build.
      hiddenSymbols: ['swap_fire'] });
  }

  spawn(position: THREE.Vector3, saved?: TumbleweedRecord): TumbleweedInstance {
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid tumbleweed position');
    if (this.disposed) throw new Error('Tumbleweed manager has been disposed');
    const instance = new TumbleweedInstance(this.world, at => this.spawnBreakFx(at));
    const display = this.displays.add({ root: instance.transform.model, name: TUMBLEWEED_ID, archive: this.archive, status: instance.status, sprite: instance.sprite, light: instance.light });
    bindInstance(display.model, instance);
    instance.setPosition(position.x, 0, position.z);
    this.world.constrainPosition(instance.position);
    instance.entityId = saved?.id ?? newEntityId();
    instance.bindPhysics(this.physics);
    actionEntity(display.model, TUMBLEWEED_ID);
    this.tumbleweeds.add(instance);
    const stopActivity = watchTileActivity(display.model, this.world.tickingarea, active => instance.setAwake(active));
    instance.onRemove(() => { stopActivity(); this.tumbleweeds.delete(instance); });
    return instance;
  }

  /** tumbleweedbreakfx: FX, not persistent, removed by its own animover. */
  private spawnBreakFx(position: THREE.Vector3): void {
    if (this.disposed) return;
    const { instance, display } = createArchiveEntity('tumbleweedbreakfx', this.archive, { name: 'break', held: true, billboard: true }, 'tumbleweedbreakfx', inst => {
      inst.addTag('FX');
      inst.persists = false;
      inst.sprite.setFacingRotation(0, 4);
      // Declared before the display binds: the one-shot waits for its first drawn frame.
      inst.sprite.playOnce('break', () => inst.remove());
    });
    instance.setPosition(position.x, position.y, position.z);
    this.breakFx.add(instance);
    instance.onRemove(() => this.breakFx.delete(instance));
    this.displays.mount(display);
  }

  /** Before physics: wind integration sets each walk speed, then cannon applies the motor velocity. */
  beforePhysics(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt < 0) return;
    for (const tumbleweed of this.tumbleweeds) tumbleweed.update(Math.min(dt, .1));
    // The display group advances the tumbleweeds and their break effects.
    this.displays.update(Math.min(dt, .1));
  }
  sync(): void {
    for (const tumbleweed of this.tumbleweeds) tumbleweed.sync();
  }

  get renderEntities() { return this.displays.renderEntities; }

  exportRecords(): TumbleweedRecord[] {
    return [...this.tumbleweeds].filter(weed => weed.persists).map(weed => ({ id: String(weed.entityId),
      transform: { position: [weed.position.x, 0, weed.position.z], rotationY: 0 }, components: {} }));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const instance of [...this.tumbleweeds, ...this.breakFx]) instance.remove();
    // Every display returns its sprite before the shared resources go.
    this.displays.dispose();
    this.resources.dispose();
  }
}
