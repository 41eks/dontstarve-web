import type { Workable, WorkInst, WorkAction, Worker } from '../../componets/src/workable';
import type { Tool } from '../../componets/src/tool';
import type { SpellCasterComponent } from '../../componets/src/spellcaster';
import type { HandEquipment } from '../../signals/src';
import type { Lighter } from '../../componets/src/lighter';
import type { Burnable } from '../../componets/src/burnable';
import type { Propagator } from '../../componets/src/propagator';
import type { Vector3 } from 'three';
import { getDeconstructionRecipe } from '../../componets/src/recipes.ts';
import { ACTIONS, type MouseActionId } from './actions.ts';
import { FOODGROUP, FOODTYPE } from '../../componets/src/eater';

export interface ComponentActionEntity extends WorkInst {
  readonly _cached_reskinname?: Map<string, string | undefined>;
  readonly prefab: string;
  getPhysicsRadius?(): number;
  readonly components: {
    inventoryitem?: { readonly owner?: unknown };
    container?: import('../../prefab/src/containers').BuildingContainer;
    stewer?: import('../../componets/src/stewer').Stewer;
    worldmigrator?: import('../../componets/src/worldmigrator').WorldMigrator;
    sleepingbag?: import('../../componets/src/sleepingbag').SleepingBag;
    hauntable?: import('../../componets/src/hauntable').Hauntable;
    builder?: import('../../componets/src/builder').Builder;
    prototyper?: import('../../componets/src/prototyper').Prototyper;
    eater?: import('../../componets/src/eater').Eater;
    edible?: import('../../componets/src/edible').Edible;
    fuel?: import('../../componets/src/fuel').Fuel;
    farmplantable?: import('../../componets/src/farmplantable').FarmPlantable;
    pickable?: { CanBeFertilized(): boolean; Fertilize(item: import('../../componets/src/trader').TradeItem, doer?: unknown): boolean };
    workable?: Workable;
    tool?: Tool;
    spellcaster?: SpellCasterComponent;
    equippable?: { IsRestricted(): boolean };
    finiteuses?: { use?(amount: number): boolean; Use?(amount: number): void; GetUses?(): number; useForAction?(action: WorkAction): boolean };
    lighter?: Lighter;
    burnable?: Burnable;
    propagator?: Propagator;
    bathbombable?: import('../../componets/src/bathbombable').BathBombable;
    bathbomb?: import('../../componets/src/bathbomb').BathBomb;
    fertilizer?: import('../../componets/src/fertilizer').Fertilizer;
    shaver?: import('../../componets/src/shaver').Shaver;
    occupier?: object;
    heater?: import('../../componets/src/heater').Heater;
    beard?: import('../../componets/src/beard').Beard;
    health?: import('../../componets/src/health').Health;
    combat?: import('../../componets/src/combat').Combat;
    weapon?: import('../../componets/src/weapon').Weapon;
    repairable?: import('../../componets/src/repairable').Repairable;
    repairer?: import('../../componets/src/repairer').Repairer;
    fueled?: {
      CanAcceptFuelItem(item: Pick<import('../../componets/src/fuel').FuelItem, 'components'>): boolean;
      TakeFuelItem(item: import('../../componets/src/fuel').FuelItem, doer?: unknown): boolean;
    };
    trader?: import('../../componets/src/trader').Trader<import('../../componets/src/trader').TradeItem>;
    occupiable?: { CanOccupy(item: any): boolean; Occupy(item: any): boolean };
  };
}

export function equippedActionEntity(equipment: HandEquipment | null | undefined): ComponentActionEntity | undefined {
  const entity = equipment?.entity;
  return entity && 'hasTag' in entity && 'components' in entity ? entity as unknown as ComponentActionEntity : undefined;
}

/** constants.lua TOOLACTIONS, for the work actions ported here. */
const TOOLACTIONS = ['NET', 'HAMMER', 'MINE', 'CHOP', 'DIG'] as const;
export type ToolAction = typeof TOOLACTIONS[number];

/** The parts of an entity componentactions reads: its tags and the components it registered. */
export type ComponentActionTarget = Pick<ComponentActionEntity, 'hasTag' | 'isRemoved'> & {
  readonly prefab?: string;
  readonly components?: object;
};

type IsValidFn = (inst: ComponentActionTarget, action: string, right: boolean) => boolean;

/** The acting player as SCENE entries read it: its tags and inventory. */
export interface SceneActionDoer {
  hasTag(tag: string): boolean;
  readonly components?: { inventory?: { GetNumSlots(): number;
    GetActiveItem?(): import('../../inventory/src/entity').ItemEntity | null;
    CanAccessItem?(item: import('../../inventory/src/entity').ItemEntity): boolean;
  } };
}
export type SceneAction = 'PICKUP' | 'PICK' | 'HARVEST' | 'TURNON' | 'TURNOFF' | 'RUMMAGE' | 'SLEEPIN' | 'MIGRATE' | 'TAKEITEM' | 'HAUNT';
type SceneFn = (inst: ComponentActionEntity, doer: SceneActionDoer, actions: SceneAction[], right: boolean) => void;
type SceneComponents = {
  inventoryitem?: { CanBePickedUp(doer: object): boolean; readonly owner?: unknown };
  container?: { canbeopened: boolean };
  machine?: object;
};
/** The acting player as EQUIPPED / POINT entries read it. */
export interface EquippedActionDoer {
  hasTag(tag: string): boolean;
  readonly sg?: { HasStateTag(tag: string): boolean };
  readonly components?: { combat?: { CanLightTarget(target: never, weapon?: never): boolean } };
  /** TheWorld.Map, as deployable:CanDeploy reaches it. */
  readonly Map?: import('../../componets/src/deployable').DeployMap;
}
export type EquippedAction = ToolAction | 'CASTSPELL' | 'LIGHT' | 'ATTACK' | 'FISH' | 'REEL' | 'TERRAFORM' | 'TILL' | 'DEPLOY' | 'DEPLOY_TILEARRIVE';
export type UseItemAction = 'GIVE' | 'FEED' | 'ADDFUEL' | 'ADDWETFUEL' | 'PLANTSOIL' | 'FERTILIZE' | 'BATHBOMB' | 'REPAIR'
  | 'SHAVE' | 'STORE';
/** constants.lua MATERIALS: the repairable_<material> tags USEITEM.repairer looks for. */
const MATERIALS = ['wood', 'stone', 'hay', 'thulecite', 'gem', 'gears', 'moonrock', 'ice', 'carrot', 'sculpture', 'fossil',
  'moon_altar', 'kelp', 'shell', 'nightmare', 'dreadstone', 'salt', 'vitae'] as const;
/** constants.lua OCCUPANTTYPE. */
const OCCUPANTTYPE = ['bird'] as const;
export type InventoryAction = 'EAT' | 'PLAY' | 'READ';
type InventoryFn = (inst: ComponentActionEntity, doer: SceneActionDoer, actions: InventoryAction[], right: boolean) => void;
type UseItemFn = (inst: ComponentActionEntity, doer: SceneActionDoer, target: ComponentActionEntity,
  actions: UseItemAction[], right: boolean) => void;
type EquippedFn = (inst: ComponentActionEntity, doer: EquippedActionDoer | undefined, target: ComponentActionTarget,
  actions: EquippedAction[], right: boolean) => void;
type PointFn = (inst: ComponentActionEntity, doer: EquippedActionDoer & { readonly position?: Vector3 }, pos: Vector3,
  actions: EquippedAction[], right: boolean) => void;
type EquippedComponents = {
  deployable?: import('../../componets/src/deployable').Deployable;
  spellcaster?: SpellCasterComponent;
  terraformer?: { CanTerraformAtPoint(pt: Vector3): boolean };
  farmtiller?: { CanTillSoilAtPoint(pt: Vector3): boolean };
  fishingrod?: { readonly target?: unknown; HasCaughtFish(): boolean };
};

/** componentactions.lua COMPONENT_ACTIONS, for the component entries ported here. */
export const COMPONENT_ACTIONS: {
  readonly SCENE: Readonly<Record<string, SceneFn>>;
  readonly POINT: Readonly<Record<string, PointFn>>;
  readonly EQUIPPED: Readonly<Record<string, EquippedFn>>;
  readonly ISVALID: Readonly<Record<string, IsValidFn>>;
  readonly USEITEM: Readonly<Record<string, UseItemFn>>;
  readonly INVENTORY: Readonly<Record<string, InventoryFn>>;
} = {
  INVENTORY: {
    book: (_inst, doer, actions) => { if (doer.hasTag('reader')) actions.push('READ'); },
    // The rider's FEED branches are not ported: no doer has a mount.
    edible: (inst, doer, actions, right) => {
      if (!right && inst.components.equippable) return;
      const eats = Object.values(FOODGROUP).some(group => doer.hasTag(`${group.name}_eater`)
        && group.types.some(type => inst.hasTag(`edible_${type}`)))
        || FOODTYPE.some(type => inst.hasTag(`edible_${type}`) && doer.hasTag(`${type}_eater`));
      if (eats) actions.push('EAT');
    },
    instrument: (_inst, _doer, actions) => { actions.push('PLAY'); },
  },
  USEITEM: {
    // The rider gates of these entries are not ported: no doer has a mount.
    bathbomb: (inst, _doer, target, actions) => {
      if (inst.hasTag('bathbomb') && target.hasTag('bathbombable')) actions.push('BATHBOMB');
    },
    // The doer's self_fertilizable branch is not ported.
    fertilizer: (_inst, _doer, target, actions) => {
      if ((target.hasTag('notreadyforharvest') && !target.hasTag('withered')) || target.hasTag('fertile')
        || target.hasTag('infertile') || target.hasTag('barren') || target.hasTag('fertilizable')) actions.push('FERTILIZE');
    },
    occupier: (inst, _doer, target, actions) => {
      for (const type of OCCUPANTTYPE) {
        if (target.hasTag(`${type}_occupiable`) && inst.hasTag(type)) { actions.push('STORE'); return; }
      }
    },
    // The heavy-lifting gate and the freshen_ branch are not ported.
    repairer: (inst, _doer, target, actions, right) => {
      if (!right) return;
      for (const material of MATERIALS) {
        if (!target.hasTag(`repairable_${material}`)) continue;
        if ((inst.hasTag(`work_${material}`) && target.hasTag('workrepairable'))
          || (inst.hasTag(`health_${material}`) && target.hasTag('healthrepairable'))
          || (inst.hasTag(`finiteuses_${material}`) && target.hasTag('finiteusesrepairable'))) actions.push('REPAIR');
        return;
      }
    },
    // The unwrappable PEEKBUNDLE branch is not ported.
    shaver: (_inst, doer, target, actions) => {
      if (target.hasTag('bearded') && (!target.hasTag('spiderden') || doer.hasTag('spiderwhisperer'))) actions.push('SHAVE');
    },
    tradable: (_inst, _doer, target, actions) => {
      if (target.hasTag('trader') && !['player', 'ghost', 'possessedbody'].some(tag => target.hasTag(tag))) actions.push('GIVE');
    },
    edible: (inst, _doer, target, actions) => {
      // componentactions.lua edible: the held small-livestock branch (pets and riders are not ported).
      if ((target.hasTag('small_livestock') || target.hasTag('handfed')) && target.components.inventoryitem?.owner
        && target.components.eater?.CanEat(inst)) actions.push('FEED');
    },
    fuel: (inst, _doer, target, actions) => {
      const fuel = inst.components.fuel;
      if (fuel && target.hasTag(`${fuel.fueltype}_fueled`) && target.components.fueled?.CanAcceptFuelItem(inst)) {
        actions.push((inst as ComponentActionEntity & { GetIsWet?(): boolean }).GetIsWet?.() ? 'ADDWETFUEL' : 'ADDFUEL');
      }
    },
    farmplantable: (_inst, _doer, target, actions) => {
      if (target.hasTag('soil') && !target.hasTag('NOCLICK')) actions.push('PLANTSOIL');
    },
  },
  SCENE: {
    container: (inst, doer, actions) => {
      // The bundle branch (WRAPBUNDLE / APPLYCONSTRUCTION) is not ported.
      if (!inst.hasTag('bundle') && !inst.hasTag('burnt') && (inst.components as SceneComponents).container?.canbeopened
        && doer.components?.inventory) actions.push('RUMMAGE');
    },
    hauntable: (inst, _doer, actions) => {
      if (!inst.hasTag('haunted') && !inst.hasTag('catchable')) actions.push('HAUNT');
    },
    inventoryitem: (inst, doer, actions, right) => {
      const item = (inst.components as SceneComponents).inventoryitem;
      const inventory = doer.components?.inventory;
      if (item?.CanBePickedUp(doer) && inventory && (inventory.GetNumSlots() > 0 || !!inst.components.equippable)
        && !(inst.hasTag('catchable') || (inst.hasTag('fire') && !inst.hasTag('lighter')) || inst.hasTag('smolder'))
        && (!inst.hasTag('spider') || (doer.hasTag('spiderwhisperer') && right))
        && (right || !inst.hasTag('heavy') || inst.hasTag('heavylift_lmb'))
        && !(right && inst.components.container && !inst.components.equippable)) actions.push('PICKUP');
    },
    machine: (inst, _doer, actions, right) => {
      if (!right || ['cooldown', 'fueldepleted', 'alwayson', 'emergency'].some(tag => inst.hasTag(tag)) || !inst.hasTag('enabled')) return;
      // A held machine is only usable while equipped, and equipped items are not in the scene.
      if ((inst.components as SceneComponents).inventoryitem?.owner) return;
      actions.push(inst.hasTag('turnedon') ? 'TURNOFF' : 'TURNON');
    },
    occupiable: (inst, _doer, actions) => { if (inst.hasTag('occupied')) actions.push('HARVEST'); },
    pickable: (inst, _doer, actions) => {
      if (inst.hasTag('pickable') && !(inst.hasTag('fire') || inst.hasTag('intense'))) actions.push('PICK');
    },
    shelf: (inst, _doer, actions) => { if (inst.hasTag('takeshelfitem')) actions.push('TAKEITEM'); },
    sleepingbag: (inst, doer, actions) => {
      if (doer.hasTag('player') && !doer.hasTag('insomniac') && !inst.hasTag('hassleeper')
        && (!inst.hasTag('spiderden') || doer.hasTag('spiderwhisperer'))) actions.push('SLEEPIN');
    },
    // The readytocook / full-container COOK branch is the cook pot panel's.
    stewer: (inst, _doer, actions) => { if (!inst.hasTag('burnt') && inst.hasTag('donecooking')) actions.push('HARVEST'); },
    worldmigrator: (inst, _doer, actions) => { if (inst.hasTag('migrator')) actions.push('MIGRATE'); },
  },
  POINT: {
    deployable: (inst, doer, pos, actions, right) => {
      if (right && inst.components.inventoryitem && (inst.components as EquippedComponents).deployable?.CanDeploy(pos, doer.Map)) {
        actions.push(inst.hasTag('tile_deploy') ? 'DEPLOY_TILEARRIVE' : 'DEPLOY');
      }
    },
    farmtiller: (inst, _doer, pos, actions, right) => {
      if (right && (inst.components as EquippedComponents).farmtiller?.CanTillSoilAtPoint(pos)) actions.push('TILL');
    },
    // The plow branch (CanPlowAtPoint) is not ported.
    terraformer: (inst, _doer, pos, actions, right) => {
      if (right && (inst.components as EquippedComponents).terraformer?.CanTerraformAtPoint(pos)) actions.push('TERRAFORM');
    },
    // The SPELLTYPES (<type>_spellcaster / _spelluser) gate is not ported; spellcaster:CanCast stands in for the map's
    // IsAboveGroundAtPoint / IsOceanAtPoint and IsGroundTargetBlocked checks.
    spellcaster: (inst, doer, pos, actions, right) => {
      if (!right || !(inst.hasTag('castonpoint') || inst.hasTag('castonpointwater'))
        || doer.hasTag('steeringboat') || doer.hasTag('rotatingboat')) return;
      if ((inst.components as EquippedComponents).spellcaster?.canCast(doer as never, undefined, pos)) actions.push('CASTSPELL');
    },
  },
  EQUIPPED: {
    fishingrod: (inst, doer, target, actions) => {
      const rod = (inst.components as EquippedComponents).fishingrod;
      if (!rod || !target.hasTag('fishable') || rod.HasCaughtFish()) return;
      if (target !== rod.target) actions.push('FISH');
      else if (!doer?.sg || doer.sg.HasStateTag('fishing')) actions.push('REEL');
    },
    lighter: (_inst, _doer, target, actions, right) => {
      if (right && target.hasTag('canlight') && !((target.hasTag('fueldepleted') && !target.hasTag('burnableignorefuel'))
        || target.hasTag('INLIMBO'))) actions.push('LIGHT');
    },
    // The castonlocomotors, castonworkable, castoncombat and crushitemcast branches are not ported.
    spellcaster: (inst, _doer, target, actions, right) => {
      if (right && !target.hasTag('nomagic') && (inst.hasTag('castontargets')
        || (inst.hasTag('castonrecipes') && !!target.prefab && !!getDeconstructionRecipe(target.prefab)))) actions.push('CASTSPELL');
    },
    // Only the CanLightTarget (RANGEDLIGHT) branch is ported: there is no CanExtinguishTarget, and the left-button
    // attack on a combat target is not offered here.
    weapon: (inst, doer, target, actions, right) => {
      if (inst.hasTag('outofammo') || !doer?.components?.combat) return;
      if (right && doer.components.combat.CanLightTarget(target as never, inst.components.weapon as never)) actions.push('ATTACK');
    },
    tool: (inst, _doer, target, actions, right) => {
      if (target.hasTag('INLIMBO') || inst.components.equippable?.IsRestricted()) return;
      for (const action of TOOLACTIONS) {
        if (inst.hasTag(`${action}_tool`) && isActionValid(target, action, right)) { actions.push(action); return; }
      }
    },
  },
  ISVALID: {
    workable: (inst, action, right) => (right || action !== 'HAMMER') && inst.hasTag(`${action}_workable`),
  },
};

/** EntityScript:IsActionValid: an `rmb` action only on the right button, then any registered component's ISVALID. */
export function isActionValid(inst: ComponentActionTarget, action: string, right: boolean): boolean {
  if ((ACTIONS[action as MouseActionId] as { rmb?: boolean } | undefined)?.rmb === true && !right) return false;
  return Object.keys(inst.components ?? {}).some(name => COMPONENT_ACTIONS.ISVALID[name]?.(inst, action, right) === true);
}

/** EntityScript:CollectActions("SCENE", doer, actions, right): the actions an entity in the world offers the doer. */
export function collectSceneActions(inst: ComponentActionEntity, doer: SceneActionDoer, right: boolean): SceneAction[] {
  const actions: SceneAction[] = [];
  if (inst.isRemoved) return actions;
  for (const name of Object.keys(inst.components)) COMPONENT_ACTIONS.SCENE[name]?.(inst, doer, actions, right);
  return actions;
}

/** componentactions.lua CollectActions("USEITEM"): inspect the active inst's components and the actual target. */
export function collectUseItemActions(item: ComponentActionEntity, doer: SceneActionDoer, target: ComponentActionEntity,
  right: boolean): UseItemAction[] {
  const actions: UseItemAction[] = [];
  if (item.isRemoved || target.isRemoved) return actions;
  for (const name of Object.keys(item.components)) COMPONENT_ACTIONS.USEITEM[name]?.(item, doer, target, actions, right);
  return actions;
}

/** EntityScript:CollectActions("INVENTORY", doer, actions, right): what the item does used from its inventory slot. */
export function collectInventoryActions(item: ComponentActionEntity, doer: SceneActionDoer, right: boolean): InventoryAction[] {
  const actions: InventoryAction[] = [];
  if (item.isRemoved) return actions;
  for (const name of Object.keys(item.components)) COMPONENT_ACTIONS.INVENTORY[name]?.(item, doer, actions, right);
  return actions;
}

/** EntityScript:CollectActions("EQUIPPED", doer, target, actions, right) for the item in the doer's hands. */
export function collectEquippedItemActions(item: ComponentActionEntity | undefined, doer: EquippedActionDoer | undefined,
  target: ComponentActionTarget, right: boolean): EquippedAction[] {
  const actions: EquippedAction[] = [];
  if (!item || item.isRemoved || target.isRemoved) return actions;
  for (const name of Object.keys(item.components)) COMPONENT_ACTIONS.EQUIPPED[name]?.(item, doer, target, actions, right);
  return actions;
}

/** EntityScript:CollectActions("POINT", doer, pos, actions, right) for the item in the doer's hands. */
export function collectPointActions(item: ComponentActionEntity | undefined, doer: EquippedActionDoer, pos: Vector3,
  right: boolean): EquippedAction[] {
  const actions: EquippedAction[] = [];
  if (!item || item.isRemoved) return actions;
  for (const name of Object.keys(item.components)) COMPONENT_ACTIONS.POINT[name]?.(item, doer, pos, actions, right);
  return actions;
}

/** actions.lua LIGHT: the doer event precedes delegation to the lighter component. */
export function performLightAction(tool: ComponentActionEntity, target: ComponentActionEntity, doer: WorkInst): boolean {
  if (tool.isRemoved || target.isRemoved || !tool.components.lighter) return false;
  doer.PushEvent?.('onstartedfire', { target });
  tool.components.lighter.Light(target, doer);
  return true;
}

/** actions.lua revalidates the component at impact, after client tag-based selection. */
export function performToolWork(action: WorkAction, target: ComponentActionEntity, worker: Worker, tool?: ComponentActionEntity): boolean {
  const workable = target.components.workable;
  if (target.isRemoved || !workable?.CanBeWorked() || workable.GetWorkAction() !== action
    || tool?.isRemoved || tool?.components.equippable?.IsRestricted()) return false;
  const worked = workable.WorkedBy(worker, action === 'NET' ? 1 : tool?.components.tool?.GetEffectiveness(action) ?? 1);
  // BufferedAction:Do → inst:OnUsedAsItem → finiteuses:OnUsedAsItem, after successful work.
  if (worked) {
    const uses = tool?.components.finiteuses;
    if (uses?.useForAction) uses.useForAction(action);
    else if (uses?.use) uses.use(1);
    else uses?.Use?.(1);
  }
  return worked;
}
