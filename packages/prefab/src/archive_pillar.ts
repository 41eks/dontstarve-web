import { SpriteState } from '@dontstarve-web/display';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { MakeObstaclePhysics } from './standardcomponents';
import { Transform } from './transform';

export const ARCHIVE_PILLAR_ID = 'archive_pillar' as const;
/** The constructor's roll can pick either bank for any record, including one saved as not broken. */
export const ARCHIVE_PILLAR_ARCHIVES = ['pillar_archive.zip', 'pillar_archive_broken.zip'];

/** archive_pillar.lua fn. Its atriumpowered listener is commented out in the source. */
export class ArchivePillarInstance extends PrefabInstance {
  broken = false;
  /** SetBank / SetBuild: choosebroken only ever changes them to the broken pair. */
  bank = 'pillar_archive';

  constructor(position: ReadonlyVector3) {
    // PlayAnimation("idle", true): the constructor's clip loops, and both banks have it.
    super(ARCHIVE_PILLAR_ID, new SpriteState({ name: 'idle', billboard: true }), Transform.stationary());
    this.setPosition(position.x, 0, position.z);
    this.addTag('blocker'); // MakeObstaclePhysics
    this.addTag('archive_pillar');
    choosebroken(this);
    this.OnSave = (_inst, data) => { data.broken = this.broken; };
    this.OnLoad = (_inst, data) => { if (data.broken !== undefined) choosebroken(this, data.broken === true); };
  }
}

/**
 * As in the source, a false `broken` does not restore the bank: a pillar loaded as not broken still keeps the broken art
 * if its constructor's roll picked it.
 */
function choosebroken(inst: ArchivePillarInstance, broken: boolean = Math.random() < .2): void {
  inst.broken = broken;
  if (broken) inst.bank = 'pillar_archive_broken';
}

export function archivePillarPrefabs(): Readonly<Record<typeof ARCHIVE_PILLAR_ID, PrefabEntityDefinition<ArchivePillarInstance>>> {
  return {
    [ARCHIVE_PILLAR_ID]: {
      fn: position => new ArchivePillarInstance(position),
      instanceAssets: ({ bank }) => ({ animationArchive: `${bank}.zip`, buildArchives: [`${bank}.zip`], bank }),
      assetOptions: { instancedAnimations: ['idle'], staticBillboard: true },
      physics: {
        make: (inst, radius) => { MakeObstaclePhysics(inst, radius); inst.physics.SetCylinder(1.8, 6); },
        radius: 2.5,
      },
      minimapIcon: 'pillar_archive.png',
    },
  };
}
