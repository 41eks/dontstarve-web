import { SpriteState } from '@dontstarve-web/display';
import { createRenderEffect } from '@dontstarve-web/signals';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/inspectable';
import { LootDropper } from '../../componets/src/lootdropper';
import { SavedRotation } from '../../componets/src/savedrotation';
import { Sittable } from '../../componets/src/sittable';
import { Workable } from '../../componets/src/workable';
import { buildingPlacer, buildingPrefab, SaveBuilding, type BuildingDeclaration } from './building';
import { addComponent, removeComponent } from './components';
import definitions from './definitions.json' with { type: 'json' };
import {
  WOOD_CHAIR_CONFIG,
  type _PlayAnimation as PlayAnimationFn,
  type _PushAnimation as PushAnimationFn,
  type backfn as BackFn,
  type CancelSitterAnimOver as CancelSitterAnimOverFn,
  type fn as Fn,
  type GetStatus as GetStatusFn,
  type OnBuilt as OnBuiltFn,
  type OnChairBurnt as OnChairBurntFn,
  type OnHammered as OnHammeredFn,
  type OnHit as OnHitFn,
  type OnLoad as OnLoadFn,
  type OnSave as OnSaveFn,
} from './generated/wood_chair.schema';
import { PrefabInstance, type PrefabComponents, type PrefabEntityDefinition } from './prefabInstance';
import type { SoundEmitter } from './soundEmitter';
import { DefaultBurntStructureFn, onloadBurnt, onsaveBurnt, WORLD_SCALE } from './standardcomponents';
import { spawnStructureLoot, STRUCTURE_LOOT_RECIPES } from './structureLoot';
import type { ReadonlyVector3 } from './transform';
import { BurnableBinding, type FireFxHost } from './treeFire';
import type { PrefabWorldContext } from './worldContext';

export const WOOD_CHAIR_ID = 'wood_chair' as const;
export const WOOD_CHAIR_BACK_ID = WOOD_CHAIR_CONFIG.back.prefab;
const CONFIG = WOOD_CHAIR_CONFIG;
const FACINGS = CONFIG.facings;

const declaration: BuildingDeclaration = {
  ...definitions.animatedBuildings.wood_chair,
  archive: CONFIG.archive,
  buildArchive: CONFIG.buildArchive,
  idleAnimation: CONFIG.idleAnimation,
};
/** skinprefabs.lua's wood_chair skins: each init_fn is wood_chair_init_fn's basic_init_fn SetSkin on the chair. */
export const WOOD_CHAIR_SKIN_ARCHIVES: Readonly<Record<string, string>> = declaration.skinArchives!;
/**
 * prefabskin.lua wood_chair_init_fn: the back keeps its base build except chair01_parts, which
 * OverrideItemSkinSymbol takes from the skin build.
 */
const BACK_SKIN_SYMBOLS = ['chair01_parts'] as const;
/** MakePlacer("wood_chair_placer", bank, build, "idle", ..., 15, "four"); the fixed camera offset is not ported. */
export const WOOD_CHAIR_PLACER = buildingPlacer(declaration, CONFIG.bank);

export interface WoodChairWorld extends PrefabWorldContext {
  /** SpawnPrefab(name.."_back"): the back joins the same world, whose display loads its art. */
  spawnPrefab(prefab: typeof WOOD_CHAIR_BACK_ID, position: ReadonlyVector3): PrefabInstance;
}

/** backfn's inst: an FX child that never saves. */
export class WoodChairBackInstance extends PrefabInstance {}

/** furniture_chairs.lua fn's inst, with the fields the Lua sets on it. */
export class WoodChairInstance extends PrefabInstance {
  declare readonly components: PrefabComponents & {
    inspectable: Inspectable;
    lootdropper: LootDropper;
    sittable?: Sittable;
    savedrotation: SavedRotation;
    workable: Workable<WoodChairInstance>;
    hauntable: Hauntable;
  };
  declare SoundEmitter: SoundEmitter;
  _burnable?: boolean;
  back?: WoodChairBackInstance;
  highlightchildren?: readonly PrefabInstance[];
  scrapbook_facing?: number;
  /** OnSyncChairRocking's sitter animover listener; only rocking chairs register it. */
  _onsitteranimover?: (sitter: PrefabInstance) => void;
  _onsitteranimover_sitter?: PrefabInstance;

  /**
   * Transform:SetRotation of a four-faced inst: the root's heading, which SetFourFaced draws with four facings, and the
   * back that entity:SetParent made a child of this transform.
   */
  // conventions-allow instance-method: the engine's Transform:SetRotation, which savedrotation calls on inst.
  override setRotation(degrees: number): void {
    super.setRotation(degrees);
    this.sprite.setFacingRotation(degrees, FACINGS);
    this.back?.sprite.setFacingRotation(degrees, FACINGS);
  }
}

const _PlayAnimation: PlayAnimationFn = (inst, anim, loop) => {
  inst.AnimState.PlayAnimation(anim, loop);
  if (inst.back) {
    inst.back.AnimState.PlayAnimation(anim, loop);
  }
};

const _PushAnimation: PushAnimationFn = (inst, anim, loop) => {
  inst.AnimState.PushAnimation(anim, loop);
  if (inst.back) {
    inst.back.AnimState.PushAnimation(anim, loop);
  }
};

const OnHit: OnHitFn = inst => {
  if (!inst.hasTag('burnt')) {
    _PlayAnimation(inst, 'hit', undefined);
    _PushAnimation(inst, 'idle', false);
    inst.components.sittable!.EjectOccupier();
  }
};

const OnHammered: OnHammeredFn = inst => {
  // SpawnPrefab("collapse_small") at the chair, SetMaterial(inst._burnable and "wood" or "stone").
  inst.worldServices?.fx?.collapse?.('small', inst.position, inst._burnable ? 'wood' : 'stone');
  inst.components.lootdropper.DropLoot();
  inst.remove();
};

/**
 * Not ported: SoundEmitter:PlaySound("dontstarve/common/repair_stonefurniture"), which sound.ts does not map yet, and
 * TheWorld:PushEvent("CHEVO_makechair", { target, doer }), which only the unported Carnival event listens for.
 */
const OnBuilt: OnBuiltFn = inst => {
  _PlayAnimation(inst, 'place', undefined);
  _PushAnimation(inst, 'idle', false);
};

const CancelSitterAnimOver: CancelSitterAnimOverFn = inst => {
  if (inst._onsitteranimover) {
    inst.RemoveEventCallback('animover', inst._onsitteranimover, inst._onsitteranimover_sitter);
    inst._onsitteranimover = undefined;
    inst._onsitteranimover_sitter = undefined;
  }
};

/** Its RemoveEventCallback("ms_sync_chair_rocking", OnSyncChairRocking) has nothing to remove on a non-rocking chair. */
const OnChairBurnt: OnChairBurntFn = inst => {
  DefaultBurntStructureFn(inst);
  if (inst.back !== undefined) {
    inst.back.AnimState.PlayAnimation('burnt');
  }
  CancelSitterAnimOver(inst);
  removeComponent(inst, 'sittable');
};

const GetStatus: GetStatusFn = inst =>
  (inst.hasTag('burnt') && 'BURNT') || (inst.components.sittable!.IsOccupied() && 'OCCUPIED') || undefined;

/** data.burnt is this project's building.burnt; every building record carries `building`. */
const OnSave: OnSaveFn = (inst, data) => {
  SaveBuilding(inst, data);
  onsaveBurnt(inst, data);
};

const OnLoad: OnLoadFn = (inst, data) => {
  onloadBurnt(inst, data);
};

/** furniture_chairs.lua AddChair("wood_chair", "wood_chair", "wood_chair_chair", 4, true, .875, true, "WOOD_CHAIR"). */
function AddChair(world: WoodChairWorld): { fn: Fn; backfn: BackFn } {
  const backfn: BackFn = () => {
    // AnimState:PlayAnimation("idle"), not looping.
    const inst = new WoodChairBackInstance(
      WOOD_CHAIR_BACK_ID,
      new SpriteState({ name: CONFIG.back.idleAnimation, held: true, billboard: true }),
    );
    // Transform:SetFourFaced, at rotation 0 until the parent's SetRotation.
    inst.sprite.setFacingRotation(0, CONFIG.back.facings);
    for (const tag of CONFIG.back.tags) {
      inst.addTag(tag);
    }
    // SetFinalOffset(3): in front of the chair at the same foot.
    inst.sprite.setDepthOffset(CONFIG.back.finalOffset > 0);
    for (const layer of CONFIG.back.hiddenLayers) {
      inst.sprite.hideLayer(layer);
    }
    // The client's OnEntityReplicated (highlightchildren from the parent) has no client to run on.
    inst.persists = CONFIG.back.persists;
    return inst;
  };

  const fn: Fn = () => {
    const { fire, scheduler } = world;
    if (!fire || !scheduler) {
      throw new Error("A wood_chair needs the world's fire effects and scheduler");
    }
    const burnEnvironment: { fire: FireFxHost; scheduler: GameTimeScheduler } = { fire, scheduler };
    // AnimState:PlayAnimation("idle"), not looping; SetBank / SetBuild come from the definition's assets.
    const inst = new WoodChairInstance(
      WOOD_CHAIR_ID,
      new SpriteState({ name: CONFIG.idleAnimation, held: true, billboard: true }),
    );
    inst.worldServices = world;
    inst.BindScheduler(scheduler);
    inst.AddSoundEmitter();
    inst.deploySmartRadius = CONFIG.deployRadius * WORLD_SCALE;
    // MakeObstaclePhysics(inst, 0.25): the definition's physics builds the body; its blocker tag is the first below.
    // Transform:SetFourFaced.
    inst.setRotation(0);
    for (const tag of CONFIG.tags) {
      inst.addTag(tag);
    }
    // SetFinalOffset(-1): behind the other entities at the same foot.
    inst.sprite.setBehindFoot(CONFIG.finalOffset < 0);
    for (const layer of CONFIG.hiddenLayers) {
      inst.sprite.hideLayer(layer);
    }

    inst._burnable = CONFIG.burnable;
    // SpawnPrefab(name.."_back") and entity:SetParent: the definition's onSpawned moves it onto the chair's position.
    const back = world.spawnPrefab(WOOD_CHAIR_BACK_ID, inst.position);
    if (!(back instanceof WoodChairBackInstance)) {
      throw new Error(`${WOOD_CHAIR_BACK_ID} did not spawn its backfn inst`);
    }
    inst.back = back;
    back.entityParent = inst;
    inst.highlightchildren = [back];
    inst.scrapbook_facing = CONFIG.scrapbookFacing;

    const inspectable = addComponent(inst, 'inspectable', Inspectable);
    inspectable.nameoverride = CONFIG.inspectable.nameoverride;
    inspectable.getstatus = viewed => (viewed instanceof WoodChairInstance ? GetStatus(viewed) : undefined);

    addComponent(inst, 'lootdropper', LootDropper, spawnStructureLoot(inst), STRUCTURE_LOOT_RECIPES);
    addComponent(inst, 'sittable', Sittable);
    addComponent(inst, 'savedrotation', SavedRotation).dodelayedpostpassapply =
      CONFIG.savedrotation.dodelayedpostpassapply;

    const workable = addComponent(inst, 'workable', Workable<WoodChairInstance>);
    workable.SetWorkAction(CONFIG.workable.action);
    workable.SetWorkLeft(CONFIG.workable.workLeft);
    workable.SetOnWorkCallback(OnHit);
    workable.SetOnFinishCallback(OnHammered);

    inst.ListenForEvent('onbuilt', (_inst, data) => OnBuilt(inst, data));

    // MakeHauntableWork(inst): its work callback is commented out in Lua, so the haunt returns false.
    const hauntable = addComponent(inst, 'hauntable', Hauntable, scheduler);
    hauntable.SetCooldown(CONFIG.hauntable.cooldown);
    hauntable.SetOnHauntFn(() => false);

    if (CONFIG.burnable) {
      // MakeSmallBurnable(inst, nil, nil, true) with SetOnBurntFn(OnChairBurnt), and MakeSmallPropagator. The
      // structure's DefaultBurnFn / DefaultExtinguishFn change nothing; RemoveComponent("burnable") is the binding's.
      const burn = new BurnableBinding(
        inst,
        {
          burnTime: CONFIG.burnfx.burnTime,
          fxLevel: CONFIG.burnfx.level,
          propagator: CONFIG.propagator,
          onBurnt: () => {
            OnChairBurnt(inst);
            burn.dispose();
          },
        },
        burnEnvironment,
      );
      inst.onRemove(() => burn.dispose());
    }

    inst.OnLoad = OnLoad;
    inst.OnSave = OnSave;

    // wood_chair_init_fn / wood_chair_clear_fn, which run when the skin is set after fn: the back follows the chair's skin.
    inst.onRemove(
      createRenderEffect(() => {
        back.skinId = inst.sprite.skinId.get();
      }),
    );
    return inst;
  };
  return { fn, backfn };
}

/**
 * The back takes the chair's position, as its entity:SetParent transform does. A saved heading is restored by
 * savedrotation's LoadPostPass in the load's post pass.
 */
function onSpawned(inst: WoodChairInstance): void {
  inst.back?.copyPosition(inst.position);
}

/** The Prefabs furniture_chairs.lua returns for wood_chair and its back; the other chairs and the placer item are not ported. */
export function woodChairPrefabs(world: WoodChairWorld): {
  readonly [WOOD_CHAIR_ID]: PrefabEntityDefinition<WoodChairInstance>;
  readonly [WOOD_CHAIR_BACK_ID]: PrefabEntityDefinition<WoodChairBackInstance>;
} {
  const { fn, backfn } = AddChair(world);
  const chair = buildingPrefab(declaration, CONFIG.bank, CONFIG.physicsRadius, () => fn(), world);
  return {
    [WOOD_CHAIR_ID]: {
      ...chair,
      onSpawned: inst => {
        chair.onSpawned?.(inst);
        onSpawned(inst);
      },
    },
    [WOOD_CHAIR_BACK_ID]: {
      fn: () => backfn(),
      assets: { animationArchive: CONFIG.archive, buildArchives: [CONFIG.buildArchive], bank: CONFIG.bank },
      skins: WOOD_CHAIR_SKIN_ARCHIVES,
      skinSymbols: BACK_SKIN_SYMBOLS,
      targetable: false,
    },
  };
}
