import * as THREE from 'three';
import type { World } from 'cannon-es';
import { ArchiveSpriteAssets, createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import type { GetWatchWorldContent, TileStateQuery } from '@dontstarve-web/signals';
import { Combat, type CombatActor } from '../../componets/src/combat';
import { Health } from '../../componets/src/health';
import { KnownLocations } from '../../componets/src/knownlocations';
import { Inventory } from '../../componets/src/inventory';
import { LootDropper } from '../../componets/src/lootdropper';
import { LocoMotor, type LocoMotorInst } from '../../componets/src/locomotor';
import { Sleeper } from '../../componets/src/sleeper';
import { Freezable } from '../../componets/src/freezable';
import { Propagator } from '../../componets/src/propagator';
import { Timer } from '../../componets/src/timer';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { DamageTracker, ExplosiveResist, GroundPounder, GroupTargeter, HealthTrigger,
  Inspectable, Moisture, RampingSpawner, StuckDetection, Stunnable } from '../../componets/src/dragonflySignatures';
import { DragonflyBrain } from '../../brains/src/dragonflybrain';
import { DragonflyStateGraph } from '../../stategraphs/src/SGdragonfly';
import { createArchiveEntity, type PrefabInstance } from './prefabInstance';
import { actionEntity } from './actionEntity';
import { MakeFlyingGiantCharacterPhysics, WORLD_SCALE } from './standardcomponents';
import { watchTileActivity } from './tileActivity';
import { newEntityId } from './saveRecord';
import type { DisplayDrivenPrefabManager, DisplayManagerWorld } from './manager';

export const DRAGONFLY_ID = 'dragonfly' as const;
export interface DragonflySaveState {
  playercombat?: true;
  health: { health: number; penalty?: number; maxhealth?: number };
  inventory: { items: Record<string, unknown>; equip: Record<string, unknown>; activeitem?: unknown };
  knownlocations?: { locations: { name: string; x: number; y: number; z: number }[] };
  moisture: { moisture: number };
  rampingspawner: { current_wave: number; wave_num: number; spawning_on: boolean; spawns?: number[] };
  timer?: { timers: { groundpound_cd: { timeleft: number; paused: boolean; initial_time: number } } };
  sleeper?: { extraresist: number };
  freezable?: { extraresist: number };
  explosiveresist?: { resistance: number };
}
export interface DragonflyRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { dragonfly: DragonflySaveState };
}
interface Dragonfly {
  instance: PrefabInstance<ArchiveSpriteCommands>;
  display: PrefabDisplay;
  health: Health;
  knownlocations: KnownLocations;
  timer: Timer;
  inventory: Inventory;
  sleeper: Sleeper;
  freezable: Freezable;
  propagator: Propagator;
  save: DragonflySaveState;
  stopActivity?: () => void;
}
export interface DragonflyWorld extends DisplayManagerWorld {
  tickingarea?: TileStateQuery;
  physics?: World;
  scheduler: GameTimeScheduler;
  getWatchWorldContent: GetWatchWorldContent;
}

/** dragonfly.lua fn / OnLoad: saved combat state has no load-time animation transition. */
export class DragonflyManager implements DisplayDrivenPrefabManager<{ prefabId: typeof DRAGONFLY_ID; record: DragonflyRecord }> {
  private readonly assets = new ArchiveSpriteAssets(DRAGONFLY_ID);
  private readonly entities = new Map<THREE.Group, Dragonfly>();
  private disposed = false;
  private readonly scene: THREE.Scene;
  private readonly world: DragonflyWorld;
  constructor(scene: THREE.Scene, world: DragonflyWorld) { this.scene = scene; this.world = world; }

  spawn(position: THREE.Vector3, saved?: DragonflyRecord): THREE.Group {
    if (this.disposed) throw new Error('Dragonflies have been disposed');
    // PrefabDisplay calls this shared loader after the tile becomes active.
    const build = (clip: { name: string; loop: boolean }) => createSharedArchiveSprite(this.assets, {
      animationArchive: 'dragonfly_basic.zip', extraAnimationArchives: ['dragonfly_actions.zip'],
      buildArchives: ['dragonfly_build.zip', 'dragonfly_fire_build.zip', 'dragonfly_yule_build.zip', 'dragonfly_fire_yule_build.zip'],
      bank: 'dragonfly', animation: clip.name, loop: clip.loop,
    }, { name: DRAGONFLY_ID, instancedAnimations: 'all' });
    const { instance, display } = createArchiveEntity(DRAGONFLY_ID, { create: build },
      { name: 'idle', billboard: true }, DRAGONFLY_ID);
    const model = display.model;
    instance.entityId = saved?.id ?? newEntityId();
    instance.position.set(position.x, 0, position.z);
    model.rotation.y = saved?.transform.rotationY ?? 0;
    instance.scale.setScalar(1.3);
    MakeFlyingGiantCharacterPhysics(instance, 500, 1.4);
    if (this.world.physics) instance.bindPhysics(this.world.physics);
    for (const tag of ['epic', 'noepicmusic', 'monster', 'hostile', 'dragonfly', 'scarytoprey',
      'largecreature', 'flying', 'ignorewalkableplatformdrowning']) instance.addTag(tag);
    instance.sprite.start('idle'); // AnimState:PlayAnimation('idle', true) in fn.
    const health = new Health(27500, instance);
    const knownlocations = new KnownLocations();
    const timer = new Timer(this.world.scheduler, () => undefined, ['groundpound_cd']);
    const components = model.userData.components ??= {};
    const inst = actionEntity(model, DRAGONFLY_ID);
    const pushEvent = (name: string, data?: unknown) => inst.PushEvent?.(name, data);
    const combatActor: CombatActor = {
      getPosition: () => model.position, getPhysicsRadius: () => instance.getPhysicsRadius(0),
      hasTag: tag => instance.hasTag(tag), get components() { return components; }, PushEvent: pushEvent,
    };
    const combat = new Combat(combatActor, () => this.world.scheduler.now);
    combat.SetDefaultDamage(150); combat.SetAttackPeriod(4); combat.SetRange(4 * WORLD_SCALE, 5 * WORLD_SCALE);
    const inventory = new Inventory({ id: String(instance.entityId), getPosition: () => model.position }, 15,
      () => { throw new Error('Dragonfly inventory drops are outside the saved-display scope'); });
    const lootdropper = new LootDropper(inst, () => undefined);
    lootdropper.SetChanceLootTable('dragonfly');
    const motorInst: LocoMotorInst = {
      isValid: () => instance.status.peek() !== 'removed', getPosition: () => model.position,
      getPhysicsRadius: () => instance.getPhysicsRadius(0),
      setRotation: degrees => { model.rotation.y = THREE.MathUtils.degToRad(degrees); },
      getAngleToPoint: (x, _y, z) => THREE.MathUtils.radToDeg(Math.atan2(model.position.z - z, x - model.position.x)),
      setMotorSpeed: speed => {
        const body = instance.physicsBody;
        if (body) { body.velocity.x = Math.cos(model.rotation.y) * speed; body.velocity.z = -Math.sin(model.rotation.y) * speed; }
      },
      components, PushEvent: pushEvent,
      PushBufferedAction: () => { throw new Error('Dragonfly stategraph actions are outside the saved-display scope'); },
    };
    const locomotor = new LocoMotor(motorInst);
    locomotor.walkspeed = 5 * WORLD_SCALE;
    const sleeper = new Sleeper({
      isValid: () => instance.status.peek() !== 'removed', PushEvent: pushEvent,
      get components() { return components; },
    }, this.world.getWatchWorldContent);
    sleeper.SetResistance(4); sleeper.sleeptestfn = () => false; sleeper.waketestfn = () => true;
    const freezable = new Freezable({
      isValid: () => instance.status.peek() !== 'removed', isDead: () => health.IsDead(),
      addTag: tag => instance.addTag(tag), removeTag: tag => instance.removeTag(tag), PushEvent: pushEvent,
      ListenForEvent: (name, fn) => {
        const listener = (event: THREE.Event) => fn(event);
        model.addEventListener(name as never, listener as never);
        return () => model.removeEventListener(name as never, listener as never);
      },
      stopBrain: () => undefined, restartBrain: () => undefined,
      get components() { return components; },
    }, this.world.scheduler);
    freezable.resistance = 8;
    const propagator = new Propagator(inst, 'large', () => [], WORLD_SCALE, this.world.scheduler, this.world.getWatchWorldContent);
    propagator.decayrate = 0;
    Object.assign(components, { health, knownlocations, timer,
      combat, inventory, lootdropper, locomotor, sleeper, freezable, propagator,
      damagetracker: new DamageTracker(instance), explosiveresist: new ExplosiveResist(instance),
      groundpounder: new GroundPounder(instance), grouptargeter: new GroupTargeter(instance),
      healthtrigger: new HealthTrigger(instance), inspectable: new Inspectable(instance),
      moisture: new Moisture(instance), rampingspawner: new RampingSpawner(instance),
      stuckdetection: new StuckDetection(instance), stunnable: new Stunnable(instance),
      stategraph: new DragonflyStateGraph(instance), brain: new DragonflyBrain(instance) });
    const save = structuredClone(saved?.components.dragonfly ?? {
      health: { health: 27500 }, inventory: { items: {}, equip: {} }, moisture: { moisture: 0 },
      rampingspawner: { current_wave: 0, wave_num: 0, spawning_on: false },
    });
    // OnLoad restores component fields and playercombat; the source does not change idle's clip here.
    health.OnLoad(save.health);
    knownlocations.OnLoad(save.knownlocations);
    timer.OnLoad(save.timer);
    const entity: Dragonfly = { instance, display, health, knownlocations, timer, inventory,
      sleeper, freezable, propagator, save };
    this.entities.set(model, entity);
    display.mount(this.scene);
    this.world.trackDisplay(display);
    entity.stopActivity = watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active));
    instance.onRemove(() => {
      this.entities.delete(model);
      entity.stopActivity?.(); timer.dispose(); inventory.dispose(); sleeper.dispose();
      freezable.dispose(); propagator.dispose();
    });
    return model;
  }

  getById(id: string): THREE.Group | undefined {
    return [...this.entities].find(([, entity]) => entity.instance.entityId === id)?.[0];
  }
  get renderEntities() { return [...this.entities].filter(([, entity]) => entity.instance.sprite.loaded)
    .map(([object]) => ({ object, footPosition: object.position, cameraDepth: 0 })); }
  exportRecords(): { prefabId: typeof DRAGONFLY_ID; record: DragonflyRecord }[] {
    return [...this.entities].map(([model, entity]) => {
      const { timer: _oldTimer, knownlocations: _oldLocations, ...saved } = entity.save;
      const cooldown = entity.timer.OnSave()?.timers.groundpound_cd;
      return { prefabId: DRAGONFLY_ID, record: {
      id: String(entity.instance.entityId),
      transform: { position: [model.position.x, model.position.y, model.position.z], rotationY: model.rotation.y },
      components: { dragonfly: { ...structuredClone(saved), health: {
        ...entity.save.health, health: entity.health.currenthealth,
      }, ...(entity.knownlocations.OnSave() ? { knownlocations: entity.knownlocations.OnSave() } : {}),
      ...(cooldown ? { timer: { timers: { groundpound_cd: cooldown } } } : {}) } },
    } };
    });
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entity of this.entities.values()) { entity.instance.remove(); entity.display.dispose(); }
    this.assets.dispose();
  }
}
