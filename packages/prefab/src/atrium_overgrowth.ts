import { definePrefabIds } from './prefabRegistration';
import { SpriteState } from '@dontstarve-web/display';
import { Inspectable } from '../../componets/src/inspectable';
import { RoseInspectable } from '../../componets/src/pandoraschestSignatures';
import { SanityAura, SANITYAURA_SUPERHUGE } from '../../componets/src/sanityaura';
import { addComponent } from './components';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { EntityPersistData } from './saveRecord';
import { MakeObstaclePhysics } from './standardcomponents';

export const ATRIUM_OVERGROWTH_ID = 'atrium_overgrowth' as const;
/** Asset("ANIM", "anim/atrium_overgrowth.zip"): the bank and the build. */
export const ATRIUM_OVERGROWTH_ARCHIVES = ['atrium_overgrowth.zip'];
/** NUM_STORY_LINES: storyprogress runs 1..5. */
export const ATRIUM_OVERGROWTH_STORY_LINES = 5;

/** rune_onsave's field. */
export interface AtriumOvergrowthSaveState {
  storyprogress?: number;
}

/** atrium_overgrowth.lua fn: the fields it sets on inst. */
export class AtriumOvergrowthInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    sanityaura: SanityAura;
    inspectable: Inspectable;
    roseinspectable: RoseInspectable;
  };
  /** inst.storyprogress: rune_AdvanceStory assigns it on the first inspection, which is not ported; OnLoad restores it. */
  declare storyprogress?: number;
}

/** The file's `local _storyprogress`: the highest story line handed out or loaded in this Lua state. */
let _storyprogress = 0;

function rune_onsave(inst: AtriumOvergrowthInstance, data: EntityPersistData): void {
  if (inst.storyprogress !== undefined) {
    data.atriumOvergrowth = { storyprogress: inst.storyprogress };
  }
}

function rune_onload(inst: AtriumOvergrowthInstance, data: EntityPersistData): void {
  const saved = data.atriumOvergrowth;
  if (saved?.storyprogress !== undefined) {
    inst.storyprogress = saved.storyprogress;
    _storyprogress = Math.max(_storyprogress, inst.storyprogress);
  }
}

/**
 * atrium_overgrowth.lua fn("atrium_overgrowth"), for loading, drawing and saving. Not ported: inspectable's getstatus
 * (rune_getstatus) and descriptionfn (rune_getdescription), so nothing calls rune_AdvanceStory; roseinspectable is a
 * constructor-only signature, so MakeRoseTarget_CreateFuel_IncreasedHorror's SetOnResidueActivated and
 * SetForcedInduceCooldownOnActivate are skipped; sanityaura's GetAura is not ported; the SoundEmitter. The deprecated
 * atrium_idol is not ported.
 */
function fn(): AtriumOvergrowthInstance {
  // SetBuild / SetBank("atrium_overgrowth"), PlayAnimation("idle") without looping.
  const inst = new AtriumOvergrowthInstance(
    ATRIUM_OVERGROWTH_ID,
    new SpriteState({ name: 'idle', held: true, billboard: true }),
  );
  inst.addTag('ancient_text');
  // MakeObstaclePhysics(inst, 1.5): the tag here, the body from the definition's physics.
  inst.addTag('blocker');

  addComponent(inst, 'sanityaura', SanityAura).aura = -SANITYAURA_SUPERHUGE;
  addComponent(inst, 'inspectable', Inspectable);
  // MakeRoseTarget_CreateFuel_IncreasedHorror.
  addComponent(inst, 'roseinspectable', RoseInspectable);

  inst.OnSave = rune_onsave;
  inst.OnLoad = rune_onload;
  return inst;
}

/** The atrium_overgrowth Prefab atrium_overgrowth.lua returns; the deprecated atrium_idol is not ported. */
export function atriumOvergrowthPrefabs(): Readonly<
  Record<typeof ATRIUM_OVERGROWTH_ID, PrefabEntityDefinition<AtriumOvergrowthInstance>>
> {
  return {
    [ATRIUM_OVERGROWTH_ID]: {
      fn,
      assets: {
        animationArchive: 'atrium_overgrowth.zip',
        buildArchives: ['atrium_overgrowth.zip'],
        bank: 'atrium_overgrowth',
      },
      physics: { make: MakeObstaclePhysics, radius: 1.5 },
      minimapIcon: 'atrium_overgrowth.png',
    },
  };
}

export const atriumOvergrowthRegistration = {
  create: atriumOvergrowthPrefabs,
  families: { atriumOvergrowths: definePrefabIds([ATRIUM_OVERGROWTH_ID], true) },
};
