import { SpriteState } from '@dontstarve-web/display';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { MakeObstaclePhysics } from './standardcomponents';
import { Transform } from './transform';

export const PILLAR_RUINS_ID = 'pillar_ruins' as const;
const PHYSICS_RADIUS = 2.35;

/** pillar.lua makefn("pillar_ruins", true). Its shake listener (doshake) and the sibling pillars are not ported. */
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

export function pillarPrefabs(): Readonly<Record<typeof PILLAR_RUINS_ID, PrefabEntityDefinition<PrefabInstance>>> {
  return {
    [PILLAR_RUINS_ID]: {
      fn: createPillarRuins,
      assets: { animationArchive: 'pillar_ruins.zip', buildArchives: ['pillar_ruins.zip'], bank: 'pillar_ruins' },
      physics: { make: MakeObstaclePhysics, radius: PHYSICS_RADIUS },
    },
  };
}
