import { SpriteState } from '@dontstarve-web/display';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { MakeObstaclePhysics } from './standardcomponents';
import { Transform } from './transform';

export const PILLAR_ATRIUM_ID = 'pillar_atrium' as const;

/** atrium_pillar.lua fn. Its atriumpowered listener (OnPoweredFn) is not ported. */
function createAtriumPillar(position: ReadonlyVector3): PrefabInstance {
  // PlayAnimation("idle", true): the constructor's clip loops.
  const inst = new PrefabInstance(PILLAR_ATRIUM_ID, new SpriteState({ name: 'idle', billboard: true }), Transform.stationary());
  inst.setPosition(position.x, 0, position.z);
  inst.addTag('blocker'); // MakeObstaclePhysics
  inst.addTag('groundhole');
  inst.addTag('pillar_atrium');
  return inst;
}

export function atriumPillarPrefabs(): Readonly<Record<typeof PILLAR_ATRIUM_ID, PrefabEntityDefinition<PrefabInstance>>> {
  return {
    [PILLAR_ATRIUM_ID]: {
      fn: createAtriumPillar,
      assets: { animationArchive: 'pillar_atrium.zip', buildArchives: ['pillar_atrium.zip'], bank: 'pillar_atrium' },
      assetOptions: { instancedAnimations: ['idle'], staticBillboard: true },
      physics: {
        make: (inst, radius) => { MakeObstaclePhysics(inst, radius); inst.physics.SetCylinder(2.35, 6); },
        radius: 2.5,
      },
    },
  };
}
