import { definePrefabIds } from './prefabRegistration';
import { SpriteState } from '@dontstarve-web/display';
import { DistanceFade } from '../../componets/src/watertreePillarSignatures';
import { addComponent } from './components';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { EntityPersistData } from './saveRecord';

export const OCEANVINE_DECO_ID = 'oceanvine_deco' as const;
/** math.random(1, 6): the idle_N clips of vine_rainforest_border. */
export const OCEANVINE_DECO_ANIMNUMS = [1, 2, 3, 4, 5, 6] as const;
export type OceanVineDecoAnimNum = (typeof OCEANVINE_DECO_ANIMNUMS)[number];

/** oceanvine_deco.lua commonfn: inst.animnum picks the loop. */
export class OceanVineDecoInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { distancefade: DistanceFade };
  declare animnum: OceanVineDecoAnimNum;
}

function onsave(inst: OceanVineDecoInstance, data: EntityPersistData): void {
  data.animnum = inst.animnum;
}

function onload(inst: OceanVineDecoInstance, data: EntityPersistData): void {
  if (data.animnum === undefined) {
    return;
  }
  inst.animnum = data.animnum;
  inst.AnimState.PlayAnimation(`idle_${inst.animnum}`, true);
}

/** oceanvine_deco.lua commonfn. distancefade is a constructor signature, so Setup(15, 25) is not called. */
function commonfn(): OceanVineDecoInstance {
  // SetBank("vine_rainforest_border"), SetBuild("waterforest_vines").
  const animnum = OCEANVINE_DECO_ANIMNUMS[Math.floor(Math.random() * OCEANVINE_DECO_ANIMNUMS.length)]!;
  const inst = new OceanVineDecoInstance(
    OCEANVINE_DECO_ID,
    new SpriteState({ name: `idle_${animnum}`, billboard: true }),
  );
  inst.animnum = animnum;
  inst.addTag('NOBLOCK');
  inst.addTag('NOCLICK');
  inst.addTag('flying');
  addComponent(inst, 'distancefade', DistanceFade);
  inst.OnSave = onsave;
  inst.OnLoad = onload;
  return inst;
}

/** The oceanvine_deco Prefab oceanvine_deco.lua returns. */
export function oceanVineDecoPrefabs(): Readonly<
  Record<typeof OCEANVINE_DECO_ID, PrefabEntityDefinition<OceanVineDecoInstance>>
> {
  return {
    [OCEANVINE_DECO_ID]: {
      fn: commonfn,
      assets: {
        animationArchive: 'waterforest_vines.zip',
        buildArchives: ['waterforest_vines.zip'],
        bank: 'vine_rainforest_border',
      },
      // Not instanced: an instance batch draws precomposed frames, and the six 72-frame idle_N loops of this large art
      // composed into about 5.7 GB of atlas pages for the 66 vines of an imported world, which ran the GPU process out
      // of memory while loading. Ordinary sprites draw the parts straight from the shared build atlas.
    },
  };
}

export const oceanVineDecoRegistration = {
  create: oceanVineDecoPrefabs,
  families: { oceanVineDecos: definePrefabIds([OCEANVINE_DECO_ID], true) },
};
