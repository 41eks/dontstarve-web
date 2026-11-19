import { SpriteState, type SpriteResources } from '@dontstarve-web/display';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { MakeObstaclePhysics } from './standardcomponents';

export const ARCHIVE_PILLAR_ID = 'archive_pillar' as const;
/** The constructor's roll can pick either bank for any record, including one saved as not broken. */
export const ARCHIVE_PILLAR_ARCHIVES = ['pillar_archive.zip', 'pillar_archive_broken.zip'];

/** archive_pillar.lua fn. Its atriumpowered listener is commented out in the source. */
export class ArchivePillarInstance extends PrefabInstance {
  broken = false;

  constructor(position: ReadonlyVector3, art: SpriteResources['archives']) {
    // PlayAnimation("idle", true): the constructor's clip loops, and both banks have it.
    super(ARCHIVE_PILLAR_ID, new SpriteState({ name: 'idle', billboard: true }));
    this.AnimState.DeclareAnimationAssets(ARCHIVE_PILLAR_ARCHIVES, art);
    this.AnimState.SetBank('pillar_archive');
    this.AnimState.SetBuild('pillar_archive.zip');
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
  if (broken) {
    inst.AnimState.SetBank('pillar_archive_broken');
    inst.AnimState.SetBuild('pillar_archive_broken.zip');
  }
}

export function archivePillarPrefabs(): Readonly<Record<typeof ARCHIVE_PILLAR_ID, PrefabEntityDefinition<ArchivePillarInstance>>> {
  return {
    [ARCHIVE_PILLAR_ID]: {
      fn: (position, sprites) => new ArchivePillarInstance(position, sprites.archives),
      // fn's pillar_archive bank and build; choosebroken's SetBank / SetBuild picks the drawn one.
      assets: { animationArchive: 'pillar_archive.zip', buildArchives: ['pillar_archive.zip'], bank: 'pillar_archive' },
      assetOptions: { instancedAnimations: ['idle'], staticBillboard: true },
      physics: {
        make: (inst, radius) => { MakeObstaclePhysics(inst, radius); inst.physics.SetCylinder(1.8, 6); },
        radius: 2.5,
      },
      minimapIcon: 'pillar_archive.png',
    },
  };
}
