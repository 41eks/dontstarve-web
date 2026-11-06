import { SpriteState } from '@dontstarve-web/display';
import * as THREE from 'three';
import type { GetWatchWorldContent } from '@dontstarve-web/signals';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
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
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { MakeFlyingGiantCharacterPhysics, WORLD_SCALE } from './standardcomponents';
import { Transform } from './transform';

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
export interface DragonflyWorld {
  scheduler: GameTimeScheduler;
  getWatchWorldContent: GetWatchWorldContent;
}

/** A dragonfly never saved: fn's component defaults. */
const NEW_DRAGONFLY: DragonflySaveState = {
  health: { health: 27500 }, inventory: { items: {}, equip: {} }, moisture: { moisture: 0 },
  rampingspawner: { current_wave: 0, wave_num: 0, spawning_on: false },
};

/**
 * dragonfly.lua fn and OnLoad: saved combat state has no load-time animation transition. Its brain, stategraph and
 * fight are outside this saved-display port, so the records of components without behaviour here are kept as loaded.
 */
export class DragonflyInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { health: Health; knownlocations: KnownLocations; timer: Timer };
  /** The loaded record; health, knownlocations and timer are saved from their components. */
  private saved: DragonflySaveState = structuredClone(NEW_DRAGONFLY);

  constructor(world: DragonflyWorld, position: ReadonlyVector3) {
    super(DRAGONFLY_ID, new SpriteState({ name: 'idle', billboard: true }), new Transform());
    this.setPosition(position.x, 0, position.z);
    this.scale.setScalar(1.3);
    for (const tag of ['epic', 'noepicmusic', 'monster', 'hostile', 'dragonfly', 'scarytoprey',
      'largecreature', 'flying', 'ignorewalkableplatformdrowning']) this.addTag(tag);
    this.sprite.start('idle'); // AnimState:PlayAnimation('idle', true) in fn.
    const model = this.transform.model, components = this.components;
    const pushEvent = (name: string, data?: unknown) => this.PushEvent(name, data);
    const isValid = () => !this.isRemoved;
    const health = new Health(27500, this);
    const knownlocations = new KnownLocations();
    const timer = new Timer(world.scheduler, () => undefined, ['groundpound_cd']);
    const combatActor: CombatActor = {
      getPosition: () => model.position, getPhysicsRadius: () => this.getPhysicsRadius(0),
      hasTag: tag => this.hasTag(tag), get components() { return components; }, PushEvent: pushEvent,
    };
    const combat = new Combat(combatActor, () => world.scheduler.now);
    combat.SetDefaultDamage(150); combat.SetAttackPeriod(4); combat.SetRange(4 * WORLD_SCALE, 5 * WORLD_SCALE);
    const self = this;
    // The entity's id is assigned once fn returns.
    const inventory = new Inventory({ get id() { return String(self.entityId); }, getPosition: () => model.position }, 15,
      () => { throw new Error('Dragonfly inventory drops are outside the saved-display scope'); });
    const lootdropper = new LootDropper(this, () => undefined);
    lootdropper.SetChanceLootTable('dragonfly');
    const motorInst: LocoMotorInst = {
      isValid, getPosition: () => model.position,
      getPhysicsRadius: () => this.getPhysicsRadius(0),
      setRotation: degrees => { model.rotation.y = THREE.MathUtils.degToRad(degrees); },
      getAngleToPoint: (x, _y, z) => THREE.MathUtils.radToDeg(Math.atan2(model.position.z - z, x - model.position.x)),
      setMotorSpeed: speed => {
        const body = this.physicsBody;
        if (body) { body.velocity.x = Math.cos(model.rotation.y) * speed; body.velocity.z = -Math.sin(model.rotation.y) * speed; }
      },
      components, PushEvent: pushEvent,
      PushBufferedAction: () => { throw new Error('Dragonfly stategraph actions are outside the saved-display scope'); },
    };
    const locomotor = new LocoMotor(motorInst);
    locomotor.walkspeed = 5 * WORLD_SCALE;
    const sleeper = new Sleeper({ isValid, PushEvent: pushEvent, get components() { return components; } }, world.getWatchWorldContent);
    sleeper.SetResistance(4); sleeper.sleeptestfn = () => false; sleeper.waketestfn = () => true;
    const freezable = new Freezable({
      isValid, isDead: () => health.IsDead(),
      addTag: tag => this.addTag(tag), removeTag: tag => this.removeTag(tag), PushEvent: pushEvent,
      ListenForEvent: (name, fn) => this.ListenForEvent(name, fn),
      stopBrain: () => undefined, restartBrain: () => undefined,
      get components() { return components; },
    }, world.scheduler);
    freezable.resistance = 8;
    const propagator = new Propagator(this, 'large', () => [], WORLD_SCALE, world.scheduler, world.getWatchWorldContent);
    propagator.decayrate = 0;
    Object.assign(components, { health, knownlocations, timer,
      combat, inventory, lootdropper, locomotor, sleeper, freezable, propagator,
      damagetracker: new DamageTracker(this), explosiveresist: new ExplosiveResist(this),
      groundpounder: new GroundPounder(this), grouptargeter: new GroupTargeter(this),
      healthtrigger: new HealthTrigger(this), inspectable: new Inspectable(this),
      moisture: new Moisture(this), rampingspawner: new RampingSpawner(this),
      stuckdetection: new StuckDetection(this), stunnable: new Stunnable(this),
      stategraph: new DragonflyStateGraph(this), brain: new DragonflyBrain(this) });

    // This project's record nests every component record under data.dragonfly; the components' own top-level
    // records are folded into it.
    this.OnSave = (_inst, data) => {
      const { timer: _timer, knownlocations: _locations, ...saved } = this.saved;
      const locations = knownlocations.OnSave(), cooldown = timer.OnSave()?.timers.groundpound_cd;
      for (const key of Object.keys(data)) delete (data as Record<string, unknown>)[key];
      data.dragonfly = { ...structuredClone(saved), health: { ...this.saved.health, health: health.currenthealth },
        ...locations ? { knownlocations: locations } : {},
        ...cooldown ? { timer: { timers: { groundpound_cd: cooldown } } } : {} };
    };
    this.OnLoad = (_inst, data) => {
      if (!data.dragonfly) return;
      this.saved = structuredClone(data.dragonfly);
      health.OnLoad(this.saved.health);
      knownlocations.OnLoad(this.saved.knownlocations);
      timer.OnLoad(this.saved.timer);
    };
    this.onRemove(() => { timer.dispose(); inventory.dispose(); sleeper.dispose(); freezable.dispose(); propagator.dispose(); });
  }
}

/** The Prefab dragonfly.lua returns. */
export function dragonflyPrefabs(world: DragonflyWorld): Readonly<Record<typeof DRAGONFLY_ID, PrefabEntityDefinition<DragonflyInstance>>> {
  return {
    [DRAGONFLY_ID]: {
      fn: position => new DragonflyInstance(world, position),
      assets: { animationArchive: 'dragonfly_basic.zip', extraAnimationArchives: ['dragonfly_actions.zip'],
        buildArchives: ['dragonfly_build.zip', 'dragonfly_fire_build.zip', 'dragonfly_yule_build.zip', 'dragonfly_fire_yule_build.zip'],
        bank: 'dragonfly' },
      assetOptions: { instancedAnimations: 'all' },
      // MakeFlyingGiantCharacterPhysics(inst, 500, 1.4).
      physics: { make: (inst, radius) => MakeFlyingGiantCharacterPhysics(inst, 500, radius), radius: 1.4 },
    },
  };
}
