import { SpriteState } from '@dontstarve-web/display';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/inspectable';
import { RoseInspectable } from '../../componets/src/pandoraschestSignatures';
import { addComponent } from './components';
import {
  ATRIUM_RUBBLE_CONFIG as CONFIG,
  type fn as FnSignature,
  type getstatus as GetStatusSignature,
  type OnLoad as OnLoadSignature,
  type OnSave as OnSaveSignature,
  type SetAnimId as SetAnimIdSignature,
} from './generated/atrium_rubble.schema';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { definePrefabIds } from './prefabRegistration';
import { MakeObstaclePhysics } from './standardcomponents';

export const ATRIUM_RUBBLE_ID = 'atrium_rubble' as const;
/** Asset("ANIM", "anim/atrium_rubble.zip"): the bank and the build. */
export const ATRIUM_RUBBLE_ARCHIVES = [CONFIG.archive];
/** NUM_STORY_LINES: getstatus hands out LINE_1..LINE_5. */
export const ATRIUM_RUBBLE_STORY_LINES = CONFIG.storyLines;
/** inst.animid: math.random(2), the idle<animid> clip. */
export type AtriumRubbleAnimId = (typeof CONFIG.animIds)[number];
export const ATRIUM_RUBBLE_ANIM_IDS: readonly AtriumRubbleAnimId[] = CONFIG.animIds;

/** OnSave's fields: animid always, storyprogress once getstatus or OnLoad assigned it. */
export interface AtriumRubbleSaveState {
  animid: AtriumRubbleAnimId;
  storyprogress?: number;
}

/** atrium_rubble.lua fn: the fields it sets on inst. */
export class AtriumRubbleInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    inspectable: Inspectable;
    hauntable: Hauntable;
    roseinspectable: RoseInspectable;
  };
  declare animid: AtriumRubbleAnimId;
  /** inst.storyprogress: getstatus assigns it on the first inspection; OnLoad restores it. */
  declare storyprogress?: number;
  declare scrapbook_specialinfo: string;
  declare scrapbook_speechstatus: string;
}

/** The file's `local _storyprogress`: the story line last handed out, shared by every rubble of this Lua state. */
let _storyprogress = 0;

const CLIPS = CONFIG.clips;

const SetAnimId: SetAnimIdSignature = (inst, id) => {
  if (inst.animid !== id) {
    inst.animid = id;
    // PlayAnimation("idle"..tostring(id)) without a loop argument: played once.
    inst.AnimState.PlayAnimation(CLIPS[`idle${id}`].name);
  }
};

const getstatus: GetStatusSignature = inst => {
  if (inst.storyprogress === undefined) {
    _storyprogress = (_storyprogress % CONFIG.storyLines) + 1;
    inst.storyprogress = _storyprogress;
  }
  return `LINE_${inst.storyprogress}`;
};

const OnSave: OnSaveSignature = (inst, data) => {
  data.atriumRubble = {
    animid: inst.animid,
    ...(inst.storyprogress !== undefined ? { storyprogress: inst.storyprogress } : {}),
  };
};

const OnLoad: OnLoadSignature = (inst, data) => {
  const saved = data.atriumRubble;
  if (saved?.animid !== undefined) {
    SetAnimId(inst, saved.animid);
  }
  if (saved?.storyprogress !== undefined) {
    inst.storyprogress = saved.storyprogress;
    _storyprogress = (_storyprogress % CONFIG.storyLines) + 1;
  }
};

/**
 * atrium_rubble.lua fn. The project runs the master simulation, so the client-only `return inst` before SetPristine's
 * master branch does not apply. Not ported: roseinspectable's SetOnResidueActivated
 * (OnResidueActivated_Fuel_IncreasedHorror) and SetForcedInduceCooldownOnActivate, as RoseInspectable is a constructor
 * signature; Network and the scrapbook UI.
 */
function fn(world: AtriumRubbleWorld): AtriumRubbleInstance {
  const { scheduler } = world;
  if (!scheduler) {
    throw new Error("An atrium_rubble needs the world's scheduler for its hauntable");
  }
  // CreateEntity, SetBank / SetBuild("atrium_rubble") (the definition's assets), PlayAnimation("idle1") without looping.
  const inst: ReturnType<FnSignature> = new AtriumRubbleInstance(
    ATRIUM_RUBBLE_ID,
    new SpriteState({ name: CLIPS[CONFIG.initialClip].name, held: true, billboard: true }),
  );
  inst.scrapbook_specialinfo = CONFIG.scrapbook.specialinfo;
  // MakeObstaclePhysics(inst, .5): the tag here, the body from the definition's physics.
  for (const tag of CONFIG.tags) {
    inst.addTag(tag);
  }
  // MiniMapEntity:SetIcon: the definition's minimapIcon.

  inst.scrapbook_speechstatus = CONFIG.scrapbook.speechstatus;

  addComponent(inst, 'inspectable', Inspectable).getstatus = viewed =>
    viewed instanceof AtriumRubbleInstance ? getstatus(viewed) : undefined;

  // MakeHauntableWork(inst): its work attempt is commented out (#HAUNTFIX), so the haunt returns false.
  const hauntable = addComponent(inst, 'hauntable', Hauntable, scheduler);
  hauntable.SetCooldown(CONFIG.hauntCooldown);
  hauntable.SetOnHauntFn(() => false);

  inst.animid = CONFIG.defaultAnimId;
  SetAnimId(inst, CONFIG.animIds[Math.floor(Math.random() * CONFIG.animIds.length)]!);

  inst.OnSave = OnSave;
  inst.OnLoad = OnLoad;
  // MakeRoseTarget_CreateFuel_IncreasedHorror.
  addComponent(inst, 'roseinspectable', RoseInspectable);

  return inst;
}

/** What fn needs from the world: the game-time scheduler of the hauntable's cooldown. */
export interface AtriumRubbleWorld {
  readonly scheduler?: GameTimeScheduler;
}

/** The atrium_rubble Prefab atrium_rubble.lua returns. */
export function atriumRubblePrefabs(
  world: AtriumRubbleWorld,
): Readonly<Record<typeof ATRIUM_RUBBLE_ID, PrefabEntityDefinition<AtriumRubbleInstance>>> {
  return {
    [ATRIUM_RUBBLE_ID]: {
      fn: () => fn(world),
      assets: { animationArchive: CONFIG.archive, buildArchives: ATRIUM_RUBBLE_ARCHIVES, bank: CONFIG.bank },
      physics: { make: MakeObstaclePhysics, radius: CONFIG.physicsRadius },
      minimapIcon: CONFIG.minimapIcon,
    },
  };
}

export const atriumRubbleRegistration = {
  create: atriumRubblePrefabs,
  families: { atriumRubbles: definePrefabIds([ATRIUM_RUBBLE_ID], true) },
};
