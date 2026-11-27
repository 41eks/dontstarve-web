import { SpriteState } from '@dontstarve-web/display';
import type { World } from 'cannon-es';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ATRIUM_FENCE_CONFIG as CONFIG } from './generated/atrium_fence.schema';
import type * as Lua from './generated/atrium_fence.schema';
import { PrefabInstance, type EntityTask, type PrefabEntityDefinition } from './prefabInstance';
import type { SoundEmitter } from './soundEmitter';
import { definePrefabIds } from './prefabRegistration';
import { MakeObstaclePhysics, WORLD_SCALE } from './standardcomponents';
import type { WorldEventEmitter } from './worldContext';

export const ATRIUM_FENCE_ID = CONFIG.prefab;
export const ATRIUM_FENCE_ARCHIVE = CONFIG.archive;
export const ATRIUM_FENCE_SHAPE_ID = CONFIG.shapeId;

interface AtriumFenceWorld {
  readonly scheduler: GameTimeScheduler;
  readonly physics?: World;
  readonly worldEvents: Pick<WorldEventEmitter, 'on'>;
  getPlayers(): readonly Pick<PrefabInstance, 'position' | 'IsVisible'>[];
}

export class AtriumFenceInstance extends PrefabInstance {
  declare world: AtriumFenceWorld;
  declare SoundEmitter: SoundEmitter;
  declare fenceid: number;
  declare closed: boolean;
  declare locked?: boolean;
  declare closingtask?: EntityTask;
  declare openingtask?: EntityTask;
}

const { nearSq, farSq, period, initialDelay } = CONFIG.proximity;
const near = nearSq * WORLD_SCALE ** 2;
const far = farSq * WORLD_SCALE ** 2;

function randomDelay({ min, maxExclusive }: { min: number; maxExclusive: number }): number {
  return min + Math.random() * (maxExclusive - min);
}

function shapeOf(inst: AtriumFenceInstance) {
  return CONFIG.shapes[inst.fenceid - CONFIG.shapeId.min];
}

const setclosedphysics: Lua.setclosedphysics = inst => {
  inst.physics.SetCollisionGroup(CONFIG.physics.group);
  inst.physics.SetCollisionMask(...CONFIG.physics.closedMask);
};

const setopenedphysics: Lua.setopenedphysics = inst => {
  inst.physics.SetCollisionGroup(CONFIG.physics.group);
  inst.physics.SetCollisionMask(...CONFIG.physics.openMask);
};

const transitionclosed: Lua.transitionclosed = inst => {
  inst.closed = true;
  const { grow, idle, active } = shapeOf(inst);
  inst.AnimState.PlayAnimation(CONFIG.clips[grow].name, false);
  inst.AnimState.PushAnimation(CONFIG.clips[inst.locked ? active : idle].name, false);
  setclosedphysics(inst);
  inst.SoundEmitter.PlaySound(CONFIG.sounds.close);
};

const transitionopened: Lua.transitionopened = inst => {
  inst.closed = false;
  inst.AnimState.PlayAnimation(CONFIG.clips[shapeOf(inst).shrink].name, false);
  inst.AnimState.PushAnimation(CONFIG.clips[CONFIG.opened].name, false);
  setopenedphysics(inst);
  inst.SoundEmitter.PlaySound(CONFIG.sounds.open);
};

const setclosed: Lua.setclosed = inst => {
  if (!inst.closed && inst.closingtask === undefined) {
    if (inst.openingtask !== undefined) {
      inst.openingtask.Cancel();
      inst.openingtask = undefined;
    }
    inst.closingtask = inst.DoTaskInTime(randomDelay(CONFIG.transitionDelay), transitionclosed);
  }
};

const setopened: Lua.setopened = inst => {
  if (inst.closed && inst.openingtask === undefined) {
    if (inst.closingtask !== undefined) {
      inst.closingtask.Cancel();
      inst.closingtask = undefined;
    }
    inst.openingtask = inst.DoTaskInTime(randomDelay(CONFIG.transitionDelay), transitionopened);
  }
};

/** simutil.lua IsAnyPlayerInRangeSq with isalive omitted. */
function IsAnyPlayerInRangeSq(inst: AtriumFenceInstance, rangeSq: number): boolean {
  return inst.world
    .getPlayers()
    .some(player => player.IsVisible() && inst.position.distanceToSquared(player.position) < rangeSq);
}

const onupdate: Lua.onupdate = inst => {
  if (inst.closed) {
    if (!inst.locked && IsAnyPlayerInRangeSq(inst, near)) {
      setopened(inst);
    }
  } else if (inst.locked || !IsAnyPlayerInRangeSq(inst, far)) {
    setclosed(inst);
  }
};

const OnPoweredFn: Lua.OnPoweredFn = (inst, ispowered) => {
  if (inst.locked !== ispowered) {
    inst.locked = ispowered;
    if (inst.closed) {
      const { idle, active } = shapeOf(inst);
      inst.AnimState.PushAnimation(CONFIG.clips[inst.locked ? active : idle].name, false);
    }
    onupdate(inst);
  }
};

const OnSave: Lua.OnSave = (inst, data) => {
  data.fenceid = inst.fenceid;
};

const OnLoad: Lua.OnLoad = (inst, data) => {
  if (data?.fenceid !== undefined) {
    inst.fenceid = data.fenceid;
  }
};

function fn(world: AtriumFenceWorld, position: ReadonlyVector3): ReturnType<Lua.fn> {
  const inst = new AtriumFenceInstance(
    ATRIUM_FENCE_ID,
    new SpriteState({ name: CONFIG.clips[CONFIG.initialClip].name, held: true, billboard: true }),
  );
  inst.world = world;
  inst.setPosition(position.x, 0, position.z);
  inst.AddSoundEmitter();
  for (const tag of CONFIG.tags) {
    inst.addTag(tag);
  }
  MakeObstaclePhysics(inst, CONFIG.physics.radius, CONFIG.physics.height);
  setopenedphysics(inst);
  if (world.physics) {
    inst.bindPhysics(world.physics);
  }

  const { min, max } = CONFIG.shapeId;
  inst.fenceid = min + Math.floor(Math.random() * (max - min + 1));
  inst.closed = false;
  inst.OnSave = OnSave;
  inst.OnLoad = OnLoad;
  inst.onRemove(world.worldEvents.on('atriumpowered', ispowered => OnPoweredFn(inst, ispowered)));
  inst.BindScheduler(world.scheduler);
  inst.DoPeriodicTask(period, onupdate, randomDelay(initialDelay));
  return inst;
}

export function atriumFencePrefabs(
  world: AtriumFenceWorld,
): Record<typeof ATRIUM_FENCE_ID, PrefabEntityDefinition<AtriumFenceInstance>> {
  return {
    [ATRIUM_FENCE_ID]: {
      fn: position => fn(world, position),
      assets: { animationArchive: CONFIG.archive, buildArchives: [CONFIG.archive], bank: CONFIG.bank },
    },
  };
}

export const atriumFenceRegistration = {
  create: atriumFencePrefabs,
  families: { atriumFences: definePrefabIds([ATRIUM_FENCE_ID], true) },
};
