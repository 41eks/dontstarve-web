import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createSharedArchiveSprite, ArchiveSpriteAssets } from '@dontstarve-web/animation/archiveSprite';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import { createArchiveEntity, type PrefabInstance, prefabInstance } from './prefabInstance';
import { fourFacingFromRotation } from '@dontstarve-web/animation/facing';
import { WorldContentKey, watchSignal, type ReadonlySignal } from '@dontstarve-web/signals';
import { BlowInWind } from '../../componets/src/blowinwind';
import { ComponentTimer } from '../../componets/src/timer';
import { DEFAULT_RUN_SPEED, DEFAULT_WALK_SPEED, LocoMotor, type LocoMotorInst } from '../../componets/src/locomotor';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { WorldWind, WorldWindChange } from '../../componets/src/worldwind';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { MakeCharacterPhysics, WORLD_SCALE } from './standardcomponents';

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
  getWatchWorldContent?: import('@dontstarve-web/signals').GetWatchWorldContent;
  scheduler: GameTimeScheduler;
  /** `TheWorld.components.worldwind`; absent worlds leave tumbleweeds idle until a long action restarts them. */
  wind?: WorldWind;
  cameraHeading: ReadonlySignal<number>;
  isOnValidGround(position: THREE.Vector3): boolean;
  constrainPosition(position: THREE.Vector3): void;
  /** Spawn the rolled loot items at the tumbleweed's position. Items the world cannot spawn are the caller's concern. */
  dropLoot(items: readonly string[], position: THREE.Vector3): void;
  random?: () => number;
}

/** math.clamp(GetRandomWithVariance(angle, 10), 0, 360). */
const varyAngle = (angle: number, random: () => number) =>
  Math.min(360, Math.max(0, angle + random() * 2 * ANGLE_VARIANCE - ANGLE_VARIANCE));

interface DrawnEntity { readonly instance: PrefabInstance<ArchiveSpriteCommands>; readonly display: PrefabDisplay }

class Tumbleweed {
  readonly entity: DrawnEntity;
  readonly sprite: ArchiveSpriteCommands;
  readonly model: THREE.Group;
  /** tumbleweed.lua MakeCharacterPhysics(inst, .5, 1); the instance's binding owns the body the wind drives. */
  readonly body: CANNON.Body;
  readonly blowinwind: BlowInWind;
  readonly locomotor: LocoMotor;
  private angle?: number;
  private rotation = 0;
  private removed = false;
  private readonly world: TumbleweedWorld;
  private readonly random: () => number;
  private readonly groundCheck: ComponentTimer;
  private groundCheckArmed = false;
  private readonly restartMovement: ComponentTimer;
  private readonly cleanups: (() => void)[] = [];
  private readonly heading;
  private readonly breakFx: DrawnEntity;
  private readonly onRemove: (tumbleweed: Tumbleweed, picked: boolean) => void;
  private facing?: number;

  constructor(entity: DrawnEntity, breakFx: DrawnEntity, physics: CANNON.World, world: TumbleweedWorld,
    onRemove: (tumbleweed: Tumbleweed, picked: boolean) => void) {
    this.entity = entity; this.sprite = entity.instance.sprite; this.model = entity.display.model; this.breakFx = breakFx; this.world = world;
    MakeCharacterPhysics(entity.instance, .5, 1);
    entity.instance.bindPhysics(physics);
    const body = this.body = entity.instance.physicsBody!;
    this.random = world.random ?? Math.random; this.onRemove = onRemove;
    const inst = actionEntity(this.model, TUMBLEWEED_ID);
    inst.addTag('pickable');
    const motor: LocoMotorInst = {
      isValid: () => !this.removed, getPosition: () => ({ x: body.position.x, y: 0, z: body.position.z }),
      getPhysicsRadius: () => WORLD_SCALE, setRotation: degrees => { this.rotation = degrees; },
      getAngleToPoint: () => this.rotation,
      setMotorSpeed: speed => this.setMotorSpeed(speed),
      components: {}, PushEvent: () => undefined, PushBufferedAction: () => undefined,
    };
    this.locomotor = new LocoMotor(motor);
    this.locomotor.walkspeed = DEFAULT_WALK_SPEED * WORLD_SCALE; this.locomotor.runspeed = DEFAULT_RUN_SPEED * WORLD_SCALE;
    this.blowinwind = new BlowInWind(motor, (DEFAULT_RUN_SPEED + DEFAULT_WALK_SPEED) / 2 * WORLD_SCALE, this.locomotor, this.random);
    this.groundCheck = new ComponentTimer(world.scheduler, () => this.onGroundCheck());
    this.restartMovement = new ComponentTimer(world.scheduler, () => this.onRestartMovement());
    this.heading = watchSignal(world.cameraHeading, stop => this.cleanups.push(stop));
    Object.assign(prefabInstance(this.model)!.components, { pickable: {
      canBePicked: true, quickpick: false, product: undefined,
      pick: () => this.pickup(),
    } });
    this.model.userData.tumbleweed = this;
    // inst:ListenForEvent("startlongaction", OnLongAction) — PICK's long action pushes it on the target.
    const onLongAction = () => this.onLongAction();
    this.model.addEventListener('startlongaction' as never, onLongAction);
    this.cleanups.push(() => this.model.removeEventListener('startlongaction' as never, onLongAction));
    const wind = world.getWatchWorldContent
      ? world.getWatchWorldContent(WorldContentKey.Wind, stop => this.cleanups.push(stop))
      : world.wind ? watchSignal(world.wind.windchange, stop => this.cleanups.push(stop)) : undefined;
    if (wind) {
      this.angle = varyAngle(wind.peek().angle, this.random);
      this.blowinwind.Start(this.angle * DEGREES);
      wind.subscribe(change => this.doDirectionChange(change));
    }
    this.sprite.start('move_loop');
    this.armGroundCheck();
  }

  get isRemoved(): boolean { return this.removed; }

  private setMotorSpeed(speed: number): void {
    const radians = this.rotation * DEGREES;
    this.body.velocity.x = Math.cos(radians) * speed;
    this.body.velocity.z = -Math.sin(radians) * speed;
  }

  /** tumbleweed.lua DoDirectionChange. */
  private doDirectionChange(change: WorldWindChange): void {
    if (this.removed) return;
    const first = this.angle === undefined;
    this.angle = varyAngle(change.angle, this.random);
    if (first) this.blowinwind.Start(this.angle * DEGREES, change.velocity);
    else this.blowinwind.ChangeDirection(this.angle * DEGREES, change.velocity);
  }

  /** startmoving / OnEntityWake: bounce sounds are not ported, so only the ground check remains. */
  private armGroundCheck(): void {
    this.groundCheckArmed = false;
    this.groundCheck.start(10 * FRAMES);
  }
  private onGroundCheck(): void {
    if (this.removed) return;
    if (!this.groundCheckArmed) { this.groundCheckArmed = true; this.groundCheck.start(24 * FRAMES); return; }
    this.groundCheck.start(24 * FRAMES);
    if (!this.world.isOnValidGround(this.model.position)) this.onRemove(this, false);
  }

  private startMoving(): void {
    if (this.removed) return;
    this.sprite.start('move_loop');
    this.armGroundCheck();
    this.blowinwind.Start();
  }

  private stopMoving(): void {
    this.locomotor.StopMoving();
    this.body.velocity.set(0, this.body.velocity.y, 0);
    this.blowinwind.Stop();
    this.groundCheck.stop();
  }

  /** tumbleweed.lua OnLongAction: stop, settle, and roll again after two to six seconds. */
  private onLongAction(): void {
    if (this.removed) return;
    this.stopMoving();
    this.sprite.playOnce('move_pst', () => this.sprite.start('idle'));
    this.restartMovement.start(2 + Math.floor(this.random() * 5));
  }
  private onRestartMovement(): void {
    if (this.removed) return;
    this.sprite.playOnce('move_pre', () => this.startMoving());
  }

  /** tumbleweed.lua onpickup: loot at the tumbleweed, the break fx, and no item for the picker. */
  private pickup(): boolean {
    if (this.removed) return false;
    this.world.dropLoot(rollTumbleweedLoot(this.random), this.model.position.clone());
    this.onRemove(this, true);
    return true;
  }

  update(dt: number): void {
    if (this.removed) return;
    this.blowinwind.Update(dt);
  }
  sync(): void {
    if (this.removed) return;
    this.model.position.set(this.body.position.x, 0, this.body.position.z);
    this.world.constrainPosition(this.model.position);
    const facing = fourFacingFromRotation(this.rotation, this.heading.peek());
    if (facing !== this.facing) this.sprite.setFacing(this.facing = facing);
  }

  /** Take over a final break pose for the fx, then release timers, listeners and the sprite. */
  dispose(picked: boolean): THREE.Group | undefined {
    if (this.removed) return undefined;
    this.removed = true;
    this.model.userData.removed = true;
    this.blowinwind.dispose();
    this.groundCheck.stop(); this.restartMovement.stop();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    delete prefabInstance(this.model)!.components.pickable;
    const fx = picked ? this.breakFx.display.model : undefined;
    if (!picked) this.disposeBreak();
    this.entity.instance.remove(); this.entity.display.dispose();
    return fx;
  }
  setBreakFacing(heading: number): void { this.breakFx.instance.sprite.setFacing(fourFacingFromRotation(this.rotation, heading)); }
  playBreak(onDone: () => void): void { this.breakFx.instance.sprite.playOnce('break', onDone); }
  disposeBreak(): void { this.breakFx.instance.remove(); this.breakFx.display.dispose(); }
}

/** tumbleweed.lua: wind-driven, four-faced, picked for three loot rolls. Burning, sounds and haunting are not ported. */
export class TumbleweedManager {
  private readonly assets: ArchiveSpriteAssets;
  private readonly tumbleweeds = new Map<THREE.Group, Tumbleweed>();
  private readonly breaking = new Set<{ tumbleweed: Tumbleweed; model: THREE.Group }>();
  private readonly displays: PrefabDisplayGroup;
  private readonly physics: CANNON.World;
  private readonly world: TumbleweedWorld;
  private disposed = false;

  constructor(scene: THREE.Scene, physics: CANNON.World, world: TumbleweedWorld) {
    this.displays = new PrefabDisplayGroup(scene); this.physics = physics; this.world = world;
    this.assets = new ArchiveSpriteAssets('tumbleweed');
  }

  private async createEntity(prefab: string, animation: string, loop: boolean): Promise<DrawnEntity> {
    const create = (clip: { name: string; loop: boolean }) => createSharedArchiveSprite(this.assets, { animationArchive: 'tumbleweed.zip',
      buildArchives: ['tumbleweed.zip'], bank: 'tumbleweed', animation: clip.name, loop: clip.loop,
      // swap_fire is the burn fx attach point (AddBurnFX); it has no art in the build.
      hiddenSymbols: ['swap_fire'] }, { name: prefab });
    return createArchiveEntity(prefab, { create, initial: await create({ name: animation, loop }) }, { name: animation, held: !loop, billboard: true }, prefab);
  }

  async spawn(position: THREE.Vector3, saved?: TumbleweedRecord): Promise<THREE.Group> {
    if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid tumbleweed position');
    if (this.disposed) throw new Error('Tumbleweed manager has been disposed');
    const [entity, breakFx] = await Promise.all([
      this.createEntity(TUMBLEWEED_ID, 'move_loop', true), this.createEntity('tumbleweedbreakfx', 'break', false)]);
    if (this.disposed) {
      for (const { instance, display } of [entity, breakFx]) { instance.remove(); display.dispose(); }
      throw new Error('Tumbleweed manager has been disposed');
    }
    // tumbleweedbreakfx: FX, not persistent.
    breakFx.instance.addTag('FX'); breakFx.instance.persists = false;
    const model = entity.display.model;
    model.position.copy(position).setY(0);
    this.world.constrainPosition(model.position);
    entity.instance.entityId = saved?.id ?? newEntityId();
    const tumbleweed = new Tumbleweed(entity, breakFx, this.physics, this.world, (target, picked) => this.remove(target.model, picked));
    this.tumbleweeds.set(model, tumbleweed);
    model.userData.remove = () => this.remove(model, false);
    this.displays.mount(prefabDisplay(model)!);
    return model;
  }

  /** Before physics: wind integration sets each walk speed, then cannon applies the motor velocity. */
  beforePhysics(dt: number): void {
    if (this.disposed || !Number.isFinite(dt) || dt < 0) return;
    for (const tumbleweed of this.tumbleweeds.values()) tumbleweed.update(Math.min(dt, .1));
    // The display group advances the tumbleweeds and their break effects.
    this.displays.update(Math.min(dt, .1));
  }
  sync(): void {
    for (const tumbleweed of this.tumbleweeds.values()) tumbleweed.sync();
  }

  get renderEntities() {
    return [...this.tumbleweeds.keys(), ...[...this.breaking].map(entry => entry.model)]
      .map(object => ({ object, footPosition: object.position, cameraDepth: 0 }));
  }

  exportRecords(): TumbleweedRecord[] {
    return [...this.tumbleweeds].map(([model, weed]) => ({ id: String(weed.entity.instance.entityId),
      transform: { position: [model.position.x, 0, model.position.z], rotationY: 0 }, components: {} }));
  }

  /** Picking leaves the one-shot `break` fx behind; any other removal discards it. */
  remove(model: THREE.Group, picked = false): void {
    const tumbleweed = this.tumbleweeds.get(model);
    if (!tumbleweed) return;
    this.tumbleweeds.delete(model);
    const position = model.position.clone();
    const fx = tumbleweed.dispose(picked);
    model.removeFromParent();
    if (!fx) return;
    fx.position.copy(position);
    this.displays.mount(prefabDisplay(fx)!);
    const entry = { tumbleweed, model: fx };
    this.breaking.add(entry);
    tumbleweed.setBreakFacing(this.world.cameraHeading.peek());
    tumbleweed.playBreak(() => {
      this.breaking.delete(entry); fx.removeFromParent(); tumbleweed.disposeBreak();
    });
  }

  dispose(): void {
    if (this.disposed) return;
    for (const model of [...this.tumbleweeds.keys()]) this.remove(model, false);
    for (const entry of [...this.breaking]) { entry.model.removeFromParent(); entry.tumbleweed.disposeBreak(); }
    this.breaking.clear();
    this.disposed = true;
    this.displays.dispose();
    this.assets.dispose();
  }
}
