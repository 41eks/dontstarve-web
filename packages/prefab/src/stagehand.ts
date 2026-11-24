import { definePrefabIds } from './prefabRegistration';
import { SpriteState } from '@dontstarve-web/display';
import { WorldContentKey, type ReadonlySignal, type WorldMoonState, type WorldPhase } from '@dontstarve-web/signals';
import { MathUtils, type Vector3 } from 'three';
import { StagehandBrain } from '../../brains/src/stagehandbrain';
import { AnimState } from '../../componets/src/animstate';
import { Burnable } from '../../componets/src/burnable';
import type { ComponentUpdates } from '../../componets/src/componentUpdates';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/inspectable';
import { LocoMotor } from '../../componets/src/locomotor';
import { LootDropper, SetSharedLootTable, type LootSpawn } from '../../componets/src/lootdropper';
import { LunarHailBuildup } from '../../componets/src/lunarhailbuildup';
import { Propagator, PROPAGATOR_CANT_TAGS } from '../../componets/src/propagator';
import { Workable } from '../../componets/src/workable';
import { StagehandStateGraph, type StagehandStateInst } from '../../stategraphs/src/SGstagehand';
import { addComponent } from './components';
import {
  STAGEHAND_CONFIG as CONFIG,
  type CanStandUp as CanStandUpCallback,
  type ChangePhysics as ChangePhysicsCallback,
  type fn as StagehandConstructor,
  type getstatus as GetStatusCallback,
  type onworked as OnWorkedCallback,
} from './generated/stagehand.schema';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { SoundEmitter } from './soundEmitter';
import { declareLunarHailBuildup } from './standardcomponents';
import { WORLD_SCALE } from './tile';
import type { ReadonlyVector3 } from './transform';
import type { PrefabWorldContext } from './worldContext';

export const STAGEHAND_ID = CONFIG.prefab;

type StagehandWorld = Pick<
  PrefabWorldContext,
  'scheduler' | 'fire' | 'physics' | 'pathfinder' | 'fx' | 'getWatchWorldContent'
> & {
  componentUpdates?: ComponentUpdates;
  getLightLevel(position: Vector3): number;
  spawnLoot: LootSpawn;
};

const LENGTHS = new Map(Object.entries(CONFIG.clipSeconds));
const SNOW_ARCHIVE = `${CONFIG.snow.build}.zip`;
export const STAGEHAND_ART = {
  animationArchive: CONFIG.archive,
  buildArchives: [CONFIG.archive, SNOW_ARCHIVE],
  bank: CONFIG.bank,
};
SetSharedLootTable(CONFIG.loot.table, [[CONFIG.loot.prefab, CONFIG.loot.chance]]);

export class StagehandInstance extends PrefabInstance implements StagehandStateInst {
  declare readonly components: PrefabInstance['components'] & {
    burnable: Burnable;
    propagator: Propagator;
    lunarhailbuildup: LunarHailBuildup;
    workable: Workable<StagehandInstance>;
    locomotor: LocoMotor;
    inspectable: Inspectable;
    lootdropper: LootDropper;
  };
  declare sg: ReturnType<typeof StagehandStateGraph>;
  declare SoundEmitter: SoundEmitter;
  animstate!: AnimState;
  sounds!: typeof CONFIG.sounds;
  scrapbook_speechstatus?: string;
  CanStandUp!: CanStandUpCallback;
  ChangePhysics!: ChangePhysicsCallback;
  cycle?: ReadonlySignal<WorldPhase>;
  moon?: ReadonlySignal<WorldMoonState>;
  inLight = true;
  getLightLevel!: StagehandWorld['getLightLevel'];
  collapseAt!: StagehandStateInst['collapseAt'];

  // conventions-allow instance-method: GetTime(), read by the entity's brain.
  getTime(): number {
    return this.GetTime();
  }

  // conventions-allow instance-method: math.random(), read by the entity's brain.
  random(): number {
    return Math.random();
  }

  // conventions-allow instance-method: the world phase read by the entity's Lua stategraph and brain.
  get phase(): WorldPhase {
    return this.cycle?.peek() ?? 'day';
  }

  // conventions-allow instance-method: Transform:SetRotation drives the source's four facings.
  override setRotation(degrees: number): void {
    super.setRotation(degrees);
    this.sprite.setFacingRotation(degrees, CONFIG.facings);
  }

  // conventions-allow instance-method: Physics:SetMotorVel and Physics:Stop, called by locomotor and the stategraph.
  setMotorSpeed(speed: number): void {
    const body = this.physicsBody;
    if (body) {
      const heading = MathUtils.degToRad(this.transform.rotation);
      body.velocity.x = Math.cos(heading) * speed;
      body.velocity.z = -Math.sin(heading) * speed;
    }
  }
}

const onworked: OnWorkedCallback = inst => {
  inst.components.workable.SetWorkLeft(CONFIG.workable.workLeft);
};

const getstatus: GetStatusCallback = inst => (inst.sg.hasStateTag('hiding') ? CONFIG.scrapbookSpeechStatus : 'AWAKE');

const CanStandUp: CanStandUpCallback = inst => {
  // EntityScript:IsInLight without a LightWatcher uses the default dual thresholds.
  const level = inst.getLightLevel(inst.getPosition());
  inst.inLight = inst.inLight ? level > 0.05 : level >= 0.1;
  return (
    !inst.inLight ||
    (inst.phase === 'night' &&
      inst.moon?.peek().phase !== 'full' &&
      inst.TheSim.FindEntities(inst.position, 30 * WORLD_SCALE, ['player']).length === 0)
  );
};

const ChangePhysics: ChangePhysicsCallback = (inst, standing) => {
  const { blocker, hiding, standing: awake } = CONFIG.physics;
  if (standing) {
    if (inst.hasTag(blocker)) {
      inst.removeTag(blocker);
      inst.physics.SetMass(awake.mass);
      inst.physics.SetCollisionGroup(awake.group);
      inst.physics.CollidesWith(awake.collidesWith);
    }
  } else if (!inst.hasTag(blocker)) {
    inst.addTag(blocker);
    inst.physics.SetMass(hiding.mass);
    inst.physics.SetCollisionGroup(hiding.group);
    inst.physics.SetCollisionMask(...hiding.mask);
  }
};

function OnUpdate(inst: StagehandInstance, dt: number): void {
  if (inst.status.peek() !== 'active') {
    return;
  }
  const body = inst.physicsBody;
  if (
    body &&
    inst.physics.GetMass() > 0 &&
    (inst.position.x !== body.position.x || inst.position.z !== body.position.z)
  ) {
    inst.setPosition(body.position.x, 0, body.position.z);
  }
  inst.brain?.tick(inst.GetTime());
  inst.components.locomotor.update(dt);
}

/** The factory receives the world and position from the shared manager. */
function fn(world: StagehandWorld, position: ReadonlyVector3): ReturnType<StagehandConstructor> {
  const { scheduler, fire } = world;
  if (!scheduler || !fire) {
    throw new Error('Stagehand needs the world scheduler and fire effects');
  }

  const inst = new StagehandInstance(
    STAGEHAND_ID,
    new SpriteState({ name: CONFIG.clips[CONFIG.initialClip].name, billboard: true }),
  );
  inst.setPosition(position.x, 0, position.z);
  inst.BindScheduler(scheduler);
  inst.AddSoundEmitter();
  inst.setRotation(0);
  inst.physics.SetFriction(CONFIG.physics.friction);
  inst.physics.SetDamping(CONFIG.physics.damping);
  ChangePhysics(inst, false);
  inst.physics.SetCapsule(...CONFIG.physics.capsule);
  if (world.physics) {
    inst.bindPhysics(world.physics);
  }
  inst.animstate = new AnimState(scheduler, LENGTHS, name => inst.PushEvent(name));
  inst.onRemove(() => inst.animstate.dispose());
  inst.animstate.PlayAnimation(CONFIG.clips[CONFIG.initialClip].name, false);
  inst.AnimState.PlayAnimation(CONFIG.clips[CONFIG.initialClip].name, false);

  for (const tag of CONFIG.tags) {
    inst.addTag(tag);
  }
  inst.sprite.setSymbolOverride(CONFIG.snow.symbol, SNOW_ARCHIVE, CONFIG.snow.source);
  inst.addTag(CONFIG.snow.tag);
  inst.sprite.hideLayer(CONFIG.snow.layer);

  inst.scrapbook_speechstatus = CONFIG.scrapbookSpeechStatus;
  addComponent(
    inst,
    'propagator',
    Propagator,
    CONFIG.propagator,
    range => inst.TheSim.FindEntities(inst.position, range, undefined, PROPAGATOR_CANT_TAGS),
    WORLD_SCALE,
    scheduler,
    world.getWatchWorldContent,
  );
  const hauntable = addComponent(inst, 'hauntable', Hauntable, scheduler);
  hauntable.SetCooldown(CONFIG.hauntCooldown);
  hauntable.SetOnHauntFn(() => false); // MakeHauntableWork's work branch is commented out.

  const cleanup = (stop: () => void) => inst.onRemove(stop);
  // MakeSnowCovered's MakeLunarHailBuildup; its UpdateLunarHailBuildup is the display's, from the declared symbols.
  const hail = addComponent(
    inst,
    'lunarhailbuildup',
    LunarHailBuildup,
    scheduler,
    CONFIG.lunarHail.decayPeriod,
    CONFIG.lunarHail.decayRate,
  );
  declareLunarHailBuildup(inst, CONFIG.snow, hail);
  hail.SetTotalWorkAmount(CONFIG.lunarHail.totalWork);
  hail.SetMoonGlassAmount(CONFIG.lunarHail.moonGlass);

  const burnable = addComponent(inst, 'burnable', Burnable, scheduler);
  burnable.SetFXLevel(CONFIG.burnable.fxLevel);
  burnable.SetBurnTime(CONFIG.burnable.burnTime);
  burnable.AddBurnFX(CONFIG.burnable.fxPrefab, CONFIG.burnable.offset, CONFIG.burnable.followSymbol);
  burnable.SetFXSpawner(data => fire.spawnCampfire(inst, data));

  const workable = addComponent(inst, 'workable', Workable<StagehandInstance>);
  workable.SetWorkAction(CONFIG.workable.action);
  workable.SetWorkLeft(CONFIG.workable.workLeft);
  workable.SetOnWorkCallback(onworked);

  const locomotor = addComponent(inst, 'locomotor', LocoMotor, {
    arriveDistance: 0.15 * WORLD_SCALE,
    pathfinder: world.pathfinder,
    pathcaps: CONFIG.locomotor.pathCaps,
  });
  locomotor.walkspeed = CONFIG.locomotor.walkSpeed * WORLD_SCALE;
  locomotor.SetTriggersCreep(CONFIG.locomotor.triggersCreep);
  inst.sounds = CONFIG.sounds;
  inst.CanStandUp = CanStandUp;
  inst.ChangePhysics = ChangePhysics;
  inst.getLightLevel = world.getLightLevel;
  inst.collapseAt = position => world.fx?.collapse?.('small', position, 'pot');
  inst.cycle = world.getWatchWorldContent?.(WorldContentKey.Cycle, cleanup);
  inst.moon = world.getWatchWorldContent?.(WorldContentKey.Moon, cleanup);

  inst.SetStateGraph(entity => StagehandStateGraph(entity, scheduler));
  inst.SetBrain(entity => new StagehandBrain(entity));

  addComponent(inst, 'inspectable', Inspectable).getstatus = () => getstatus(inst);
  addComponent(inst, 'lootdropper', LootDropper, world.spawnLoot).SetChanceLootTable(CONFIG.loot.table);

  inst.onRemove(
    inst.status.subscribe(status => {
      if (status === 'asleep') {
        inst.sg.pause();
        inst.animstate.pause();
      } else if (status === 'active') {
        inst.sg.resume();
        inst.animstate.resume();
      }
    }),
  );
  if (world.componentUpdates) {
    inst.onRemove(world.componentUpdates.register({ OnUpdate: dt => OnUpdate(inst, dt) }));
  }
  return inst;
}

export function stagehandPrefabs(
  world: StagehandWorld,
): Record<typeof STAGEHAND_ID, PrefabEntityDefinition<StagehandInstance>> {
  return {
    [STAGEHAND_ID]: {
      fn: position => fn(world, position),
      assets: STAGEHAND_ART,
      skins: CONFIG.skins,
      baseSymbols: CONFIG.skinSymbolOverrides,
      onSpawned: inst => inst.sprite.setFacingRotation(inst.transform.rotation, CONFIG.facings),
    },
  };
}

export const stagehandRegistration = {
  create: stagehandPrefabs,
  families: { stagehand: definePrefabIds([STAGEHAND_ID], true) },
};
