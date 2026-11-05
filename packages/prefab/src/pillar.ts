import { SpriteState } from '@dontstarve-web/display';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { MakeObstaclePhysics } from './standardcomponents';
import { Transform } from './transform';

export const PILLAR_RUINS_ID = 'pillar_ruins' as const;
/** pillar.lua's other pillar(name, true) entries: identical except for the name that is their bank and build. */
export const CAVE_PILLAR_IDS = ['pillar_cave', 'pillar_cave_flintless', 'pillar_cave_rock', 'pillar_algae'] as const;
export type CavePillarId = typeof CAVE_PILLAR_IDS[number];
const PHYSICS_RADIUS = 2.35;

/** pillar.lua makefn("pillar_ruins", true). Its shake listener (doshake) is not ported. */
function createPillarRuins(position: ReadonlyVector3): PrefabInstance {
  // PlayAnimation("idle", true): the constructor's clip loops.
  const inst = new PrefabInstance(PILLAR_RUINS_ID, new SpriteState({ name: 'idle', billboard: true }), Transform.stationary());
  inst.setPosition(position.x, 0, position.z);
  inst.addTag('charge_barrier');
  inst.addTag('quake_on_charge');
  // standardcomponents.lua MakeObstaclePhysics adds this tag; its TypeScript counterpart only declares the collider.
  inst.addTag('blocker');
  return inst;
}

/** pillar.lua makefn(name, true) without pillar_ruins' tags. Its shake listener (doshake) is not ported. */
function createCavePillar(prefab: CavePillarId, position: ReadonlyVector3): PrefabInstance {
  // PlayAnimation("idle", true): the constructor's clip loops.
  const inst = new PrefabInstance(prefab, new SpriteState({ name: 'idle', billboard: true }), Transform.stationary());
  inst.setPosition(position.x, 0, position.z);
  inst.addTag('blocker'); // MakeObstaclePhysics
  return inst;
}

export function pillarPrefabs(): Readonly<Record<typeof PILLAR_RUINS_ID | CavePillarId, PrefabEntityDefinition<PrefabInstance>>> {
  const cavePillar = (prefab: CavePillarId): PrefabEntityDefinition<PrefabInstance> => ({
    fn: position => createCavePillar(prefab, position),
    assets: { animationArchive: `${prefab}.zip`, buildArchives: [`${prefab}.zip`], bank: prefab },
    assetOptions: { instancedAnimations: ['idle'], staticBillboard: true },
    physics: { make: MakeObstaclePhysics, radius: PHYSICS_RADIUS },
  });
  return {
    pillar_cave: cavePillar('pillar_cave'),
    pillar_cave_flintless: cavePillar('pillar_cave_flintless'),
    pillar_cave_rock: cavePillar('pillar_cave_rock'),
    pillar_algae: cavePillar('pillar_algae'),
    [PILLAR_RUINS_ID]: {
      fn: createPillarRuins,
      assets: { animationArchive: 'pillar_ruins.zip', buildArchives: ['pillar_ruins.zip'], bank: 'pillar_ruins' },
      physics: { make: MakeObstaclePhysics, radius: PHYSICS_RADIUS },
    },
  };
}
