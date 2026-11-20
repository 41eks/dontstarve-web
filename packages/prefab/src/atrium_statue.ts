import { addComponent } from './components';
import { SpriteState } from '@dontstarve-web/display';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { RoseInspectable } from '../../componets/src/pandoraschestSignatures';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { MakeObstaclePhysics } from './standardcomponents';

export const ATRIUM_STATUE_ID = 'atrium_statue' as const;

export class AtriumStatueInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    inspectable: Inspectable;
    roseinspectable: RoseInspectable;
  };
  /** inst._suffix: "_night" while the nightmare phase is wild. */
  declare _suffix: string;
}

/**
 * atrium_statue.lua MakeStatue("atrium_statue", false). Its workable and lootdropper are commented out in the source,
 * so the statue cannot be mined; it adds no tags, has no skins and writes no OnSave data.
 */
function fn(): AtriumStatueInstance {
  // SetBank / SetBuild("atrium_statue"), PlayAnimation("idle_full") without looping.
  const inst = new AtriumStatueInstance(
    ATRIUM_STATUE_ID,
    new SpriteState({ name: 'idle_full', held: true, billboard: true }),
  );
  inst.minimap.SetIcon('atrium_statue.png');
  addComponent(inst, 'inspectable', Inspectable);
  inst._suffix = '';
  // OnNightmarePhaseChanged(inst, TheWorld.state.nightmarephase, true) -> ShowPhaseState(instant) -> OnWorked with
  // MARBLEPILLAR_MINE: PlayAnimation("idle_full" .. _suffix, true). The nightmarephase watch, its `_night` clips and
  // DoFx are not ported, so the suffix stays "". There is no OnLoad, so a loaded statue declares the same clip.
  inst.sprite.start(`idle_full${inst._suffix}`);
  // MakeRoseTarget_CreateFuel_IncreasedHorror.
  addComponent(inst, 'roseinspectable', RoseInspectable);
  return inst;
}

/** The Prefab atrium_statue.lua returns for atrium_statue; atrium_statue_facing (savedrotation) is not ported. */
export function atriumStatuePrefabs(): Readonly<
  Record<typeof ATRIUM_STATUE_ID, PrefabEntityDefinition<AtriumStatueInstance>>
> {
  return {
    [ATRIUM_STATUE_ID]: {
      fn,
      assets: { animationArchive: 'atrium_statue.zip', buildArchives: ['atrium_statue.zip'], bank: 'atrium_statue' },
      assetOptions: { instancedAnimations: 'all' },
      physics: { make: MakeObstaclePhysics, radius: 0.45 },
    },
  };
}
