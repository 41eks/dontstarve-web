import type { Workable, WorkInst, WorkAction, Worker } from '../../componets/src/workable';
import type { Tool } from '../../componets/src/tool';
import type { SpellCasterComponent } from '../../componets/src/spellcaster';
import type { HandEquipment } from '../../signals/src';
import type { Lighter } from '../../componets/src/lighter';
import type { Burnable } from '../../componets/src/burnable';
import type { Propagator } from '../../componets/src/propagator';
import { getDeconstructionRecipe } from '../../componets/src/recipes.ts';

export interface ComponentActionEntity extends WorkInst {
  readonly _cached_reskinname?: Map<string, string | undefined>;
  readonly prefab: string;
  getPhysicsRadius?(): number;
  readonly components: {
    builder?: import('../../componets/src/builder').Builder;
    prototyper?: import('../../componets/src/prototyper').Prototyper;
    eater?: import('../../componets/src/eater').Eater;
    pickable?: { CanBeFertilized(): boolean; Fertilize(item: import('../../componets/src/trader').TradeItem): boolean };
    workable?: Workable;
    tool?: Tool;
    spellcaster?: SpellCasterComponent;
    equippable?: { IsRestricted(): boolean };
    finiteuses?: { use(amount: number): boolean; useForAction?(action: WorkAction): boolean };
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

/** EQUIPPED.tool + ISVALID.workable, for the supported tool actions. */
export function collectEquippedActions(tool: ComponentActionEntity | undefined, target: Pick<ComponentActionEntity, 'hasTag' | 'isRemoved'> & { readonly prefab?: string }, right: boolean): ('NET' | 'HAMMER' | 'MINE' | 'CHOP' | 'DIG' | 'CASTSPELL' | 'LIGHT')[] {
  if (!tool || tool.isRemoved || target.isRemoved || target.hasTag('INLIMBO')) return [];
  const actions: ('NET' | 'HAMMER' | 'MINE' | 'CHOP' | 'DIG' | 'CASTSPELL' | 'LIGHT')[] = [];
  if (tool.components.tool) {
    for (const action of ['NET', 'HAMMER', 'MINE', 'CHOP', 'DIG'] as const) {
      if (tool.hasTag(`${action}_tool`) && (right || (action !== 'HAMMER' && action !== 'DIG'))
        && target.hasTag(`${action}_workable`)) { actions.push(action); break; }
    }
  }
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
    else uses?.use(1);
  }
  return worked;
}
