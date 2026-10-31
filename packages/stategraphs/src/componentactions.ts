import type { Workable, WorkInst, WorkAction, Worker } from '../../componets/src/workable';
import type { Tool } from '../../componets/src/tool';
import type { SpellCasterComponent } from '../../componets/src/spellcaster';
import type { HandEquipment } from '../../signals/src';
import type { Lighter } from '../../componets/src/lighter';
import type { Burnable } from '../../componets/src/burnable';
import type { Propagator } from '../../componets/src/propagator';
import { getDeconstructionRecipe } from '../../componets/src/recipes.ts';
import { ACTIONS, type MouseActionId } from './actions.ts';

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
    pickable?: { CanBeFertilized(): boolean; Fertilize(item: import('../../componets/src/trader').TradeItem): boolean };
    workable?: Workable;
    tool?: Tool;
    spellcaster?: SpellCasterComponent;
    equippable?: { IsRestricted(): boolean };
    finiteuses?: { use?(amount: number): boolean; Use?(amount: number): void; GetUses?(): number; useForAction?(action: WorkAction): boolean };
    lighter?: Lighter;
    burnable?: Burnable;
    propagator?: Propagator;
    bathbombable?: import('../../componets/src/bathbombable').BathBombable;
    heater?: import('../../componets/src/heater').Heater;
    beard?: import('../../componets/src/beard').Beard;
    health?: import('../../componets/src/health').Health;
    combat?: import('../../componets/src/combat').Combat;
    weapon?: import('../../componets/src/weapon').Weapon;
    repairable?: import('../../componets/src/repairable').Repairable;
    repairer?: import('../../componets/src/repairer').Repairer;
    fueled?: {
      CanAcceptFuelItem(item: Pick<import('../../componets/src/fuel').FuelItem, 'components'>): boolean;
      TakeFuelItem(item: import('../../componets/src/fuel').FuelItem): boolean;
    };
    trader?: import('../../componets/src/trader').Trader<import('../../componets/src/trader').TradeItem>;
    occupiable?: { readonly occupanttype: string | undefined; CanOccupy(item: any): boolean; Occupy(item: any): boolean };
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
type EquippedFn = (inst: ComponentActionEntity, doer: unknown, target: ComponentActionTarget, actions: ToolAction[], right: boolean) => void;

/** componentactions.lua COMPONENT_ACTIONS, for the component entries ported here. */
export const COMPONENT_ACTIONS: { readonly EQUIPPED: Readonly<Record<string, EquippedFn>>; readonly ISVALID: Readonly<Record<string, IsValidFn>> } = {
  EQUIPPED: {
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

/** EntityScript:IsActionValid: rmb actions only on the right button, then any registered component's ISVALID. */
export function isActionValid(inst: ComponentActionTarget, action: string, right: boolean): boolean {
  const rmb = (ACTIONS[action as MouseActionId] as { rmb?: boolean } | undefined)?.rmb;
  if (rmb !== undefined && rmb !== right) return false;
  return Object.keys(inst.components ?? {}).some(name => COMPONENT_ACTIONS.ISVALID[name]?.(inst, action, right) === true);
}

/** EntityScript:CollectActions("EQUIPPED", doer, target, actions, right) for the item in the doer's hands. */
export function collectEquippedItemActions(item: ComponentActionEntity | undefined, doer: unknown,
  target: ComponentActionTarget, right: boolean): ToolAction[] {
  const actions: ToolAction[] = [];
  if (!item || item.isRemoved || target.isRemoved) return actions;
  for (const name of Object.keys(item.components)) COMPONENT_ACTIONS.EQUIPPED[name]?.(item, doer, target, actions, right);
  return actions;
}

/** EQUIPPED.tool, plus the spellcaster and lighter branches not yet moved into COMPONENT_ACTIONS. */
export function collectEquippedActions(tool: ComponentActionEntity | undefined, target: ComponentActionTarget, right: boolean): (ToolAction | 'CASTSPELL' | 'LIGHT')[] {
  if (!tool || tool.isRemoved || target.isRemoved || target.hasTag('INLIMBO')) return [];
  const actions: (ToolAction | 'CASTSPELL' | 'LIGHT')[] = collectEquippedItemActions(tool, undefined, target, right);
  if (right && tool.components.spellcaster && !target.hasTag('nomagic') && (tool.hasTag('castontargets')
    || (tool.hasTag('castonrecipes') && target.prefab && getDeconstructionRecipe(target.prefab)))) actions.push('CASTSPELL');
  if (right && tool.components.lighter && target.hasTag('canlight')
    && !(target.hasTag('fueldepleted') && !target.hasTag('burnableignorefuel'))) actions.push('LIGHT');
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
