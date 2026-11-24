import { definePrefabIds } from './prefabRegistration';
import { SpriteState } from '@dontstarve-web/display';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Hauntable, HAUNT_COOLDOWN_SMALL } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/inspectable';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import type { Floater } from '../../componets/src/floater';
import { UPGRADETYPES, Upgradeable } from '../../componets/src/upgradeable';
import { WaterPhysics } from '../../componets/src/watertreePillarSignatures';
import { Workable } from '../../componets/src/workable';
import { addComponent } from './components';
import { POPULATING, PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { type EntityPersistData } from './saveRecord';
import { MakeInventoryFloatable, MakeWaterObstaclePhysics } from './standardcomponents';

export const SEASTACK_ID = 'seastack' as const;
/** seastack.lua assets: one archive holds the water_rock01 bank and the water_rock_01 build. */
export const SEASTACK_ARCHIVES = ['water_rock_01.zip'];
const SEASTACK_BANK = 'water_rock01';
/** tuning.lua SEASTACK_MINE. */
export const SEASTACK_MINE = 9;
/** seastack.lua NUM_STACK_TYPES: the stack shapes whose clips the bank holds. */
export const SEASTACK_STACK_TYPES = 5;

SetSharedLootTable('seastack', [
  ['rocks', 1],
  ['rocks', 1],
  ['rocks', 1],
  ['rocks', 1],
]);

/** What the scene injects into every sea stack. */
export interface SeastackWorld {
  scheduler: GameTimeScheduler;
}

/** seastack.lua fn: the components it adds. */
export class SeastackInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    waterphysics: WaterPhysics;
    floater: Floater;
    inspectable: Inspectable;
    lootdropper: LootDropper;
    workable: Workable<SeastackInstance>;
    upgradeable: Upgradeable;
    hauntable: Hauntable;
  };
  /** inst.stackid: 1..NUM_STACK_TYPES, choosing the bank's `<stackid>_full` / `_low` clips. */
  stackid!: number;
  /** inst.tinted: the powder-monkey paint layer and the painted minimap icon. */
  tinted = false;
  /** inst.has_medium_state: no source sets it, so UpdateArt never picks the `_med` clips. */
  has_medium_state = false;
  /** seastack.lua's scrapbook fields; no scrapbook is rendered. */
  scrapbook_anim = '1_full';
  scrapbook_hide = ['paint_A', 'paint_B'];
}

/**
 * UpdateArt: the full clip above 6 work left, otherwise low (the medium branch needs has_medium_state, which is nil in
 * the source). PlayAnimation is non-looping, as in seastack.lua.
 */
function UpdateArt(inst: SeastackInstance): void {
  const workleft = inst.components.workable.workleft.peek();
  const suffix = workleft > 6 ? 'full' : workleft > 3 && inst.has_medium_state ? 'med' : 'low';
  inst.AnimState.PlayAnimation(`${inst.stackid}_${suffix}`);
}

/** OnSave: the stack shape and powder-monkey tint. */
export function saveSeastack(inst: SeastackInstance, data: EntityPersistData): void {
  data.stackid = inst.stackid;
  data.tinted = inst.tinted;
}

/**
 * OnLoad: the saved tint and stack shape, then the art. TestForPowderMonkeyTint, which the source schedules when an old
 * record has no tint, is not ported: a new stack stays untinted.
 */
export function loadSeastack(inst: SeastackInstance, data: EntityPersistData): void {
  if (data.tinted !== undefined) {
    inst.tinted = data.tinted;
  }
  if (inst.tinted) {
    inst.sprite.showLayer(Math.random() > 0.5 ? 'paint_A' : 'paint_B');
    inst.minimap.SetIcon('seastack_painted.png');
  }
  inst.stackid = data.stackid ?? inst.stackid ?? 1 + Math.floor(Math.random() * SEASTACK_STACK_TYPES);
  UpdateArt(inst);
}

function fn(world: SeastackWorld): SeastackInstance {
  const inst = new SeastackInstance(SEASTACK_ID, new SpriteState({ name: '1_full', held: true, billboard: true }));
  // SetBank("water_rock01"), SetBuild("water_rock_01") and PlayAnimation("1_full") are the definition's assets and clip.
  inst.AddSoundEmitter();
  inst.minimap.SetIcon('seastack.png');
  inst.physicsRadiusOverride = 2.35;
  // MakeWaterObstaclePhysics(inst, 0.80, 2, 0.75): the tag and signature component here, the body from the definition.
  inst.addTag('blocker');
  addComponent(inst, 'waterphysics', WaterPhysics);

  inst.addTag('ignorewalkableplatforms');
  inst.addTag('seastack');

  inst.sprite.hideLayer('paint_A');
  inst.sprite.hideLayer('paint_B');

  const floater = MakeInventoryFloatable(inst, 'med', 0.1, [1.1, 0.9, 1.1]);
  floater.SetIsObstacle();
  floater.bob_percent = 0;
  // The DoTaskInTime that calls floater:OnLandedServer() is skipped: the sea stack's world binds no map or ripples.

  addComponent(inst, 'inspectable', Inspectable);

  const lootdropper = addComponent(inst, 'lootdropper', LootDropper, () => undefined);
  lootdropper.SetChanceLootTable('seastack');
  lootdropper.y_speed = 14; // the other fling fields have no ported owner

  const workable = addComponent(inst, 'workable', Workable<SeastackInstance>);
  workable.SetWorkAction('MINE');
  workable.SetWorkLeft(SEASTACK_MINE);
  // workable:SetOnWorkCallback(OnWork) is a prefab callback, not registered here.
  workable.savestate = true;

  const upgradeable = addComponent(inst, 'upgradeable', Upgradeable);
  upgradeable.upgradetype = UPGRADETYPES.WATERPLANT;
  // upgradeable.onupgradefn = OnUpgraded is a prefab callback, not registered here.

  // inst:ListenForEvent("on_collide", inst._OnCollide) is an unported event listener.

  // For console spawning, as in the source; a loaded entity gets its stackid in OnLoad.
  if (!POPULATING) {
    inst.stackid = 1 + Math.floor(Math.random() * SEASTACK_STACK_TYPES);
    UpdateArt(inst);
  }

  inst.OnSave = saveSeastack;
  inst.OnLoad = loadSeastack;

  // MakeHauntableWork: the component and its small cooldown; its haunt callback is not registered.
  addComponent(inst, 'hauntable', Hauntable, world.scheduler).SetCooldown(HAUNT_COOLDOWN_SMALL);

  return inst;
}

/** The Prefab seastack.lua returns; the two seastack_spawner_* entities are not ported. */
export function seastackPrefabs(
  world: SeastackWorld,
): Readonly<Record<typeof SEASTACK_ID, PrefabEntityDefinition<SeastackInstance>>> {
  return {
    [SEASTACK_ID]: {
      fn: () => fn(world),
      assets: {
        animationArchive: 'water_rock_01.zip',
        buildArchives: SEASTACK_ARCHIVES,
        bank: SEASTACK_BANK,
      },
      physics: { make: MakeWaterObstaclePhysics, radius: 0.8, height: 2 },
      minimapIcon: 'seastack.png',
    },
  };
}

export const seastackRegistration = {
  create: seastackPrefabs,
  families: { seastacks: definePrefabIds([SEASTACK_ID], true) },
};
