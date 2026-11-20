import { SpriteState } from '@dontstarve-web/display';
import { DistanceFade } from '../../componets/src/watertreePillarSignatures';
import { addComponent } from './components';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { EntityPersistData } from './saveRecord';

export const OCEANVINE_DECO_ID = 'oceanvine_deco' as const;
/** math.random(1, 6): the idle_N clips of vine_rainforest_border. */
export const OCEANVINE_DECO_ANIMNUMS = [1, 2, 3, 4, 5, 6] as const;
export type OceanVineDecoAnimNum = typeof OCEANVINE_DECO_ANIMNUMS[number];

/** oceanvine_deco.lua commonfn: inst.animnum picks the loop. */
export class OceanVineDecoInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { distancefade: DistanceFade };
  declare animnum: OceanVineDecoAnimNum;
}

function onsave(inst: OceanVineDecoInstance, data: EntityPersistData): void {
  data.animnum = inst.animnum;
}

function onload(inst: OceanVineDecoInstance, data: EntityPersistData): void {
  if (data.animnum === undefined) { return; }
  inst.animnum = data.animnum;
  inst.AnimState.PlayAnimation(`idle_${inst.animnum}`, true);
}

/** oceanvine_deco.lua commonfn. distancefade is a constructor signature, so Setup(15, 25) is not called. */
function commonfn(): OceanVineDecoInstance {
  // SetBank("vine_rainforest_border"), SetBuild("waterforest_vines").
  const animnum = OCEANVINE_DECO_ANIMNUMS[Math.floor(Math.random() * OCEANVINE_DECO_ANIMNUMS.length)]!;
  const inst = new OceanVineDecoInstance(OCEANVINE_DECO_ID, new SpriteState({ name: `idle_${animnum}`, billboard: true }));
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
export function oceanVineDecoPrefabs(): Readonly<Record<typeof OCEANVINE_DECO_ID, PrefabEntityDefinition<OceanVineDecoInstance>>> {
  return {
    [OCEANVINE_DECO_ID]: {
      fn: commonfn,
      assets: { animationArchive: 'waterforest_vines.zip', buildArchives: ['waterforest_vines.zip'], bank: 'vine_rainforest_border' },
      // Every idle_N loops; the 66 vines of an imported world share their batches.
      assetOptions: { instancedAnimations: OCEANVINE_DECO_ANIMNUMS.map(n => `idle_${n}`) },
    },
  };
}
