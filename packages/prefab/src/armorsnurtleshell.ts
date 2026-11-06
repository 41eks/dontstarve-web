import type { ItemEntity, ItemRuntimeComponent } from '@dontstarve-web/inventory';
import type { EquipmentOwner } from '@dontstarve-web/signals';
import { Armor } from '../../componets/src/armor';
import type { Combat } from '../../componets/src/combat';
import { Equippable } from '../../componets/src/equippable';
import { ComponentTimer } from '../../componets/src/timer';
import { UseableItem } from '../../componets/src/useableitem';
import { FindEntities } from './actionEntity';
import { wornOwner, type EquipmentVisualOwner } from './equipmentVisual';

export const ARMORSNURTLESHELL_ID = 'armorsnurtleshell';
// tuning.lua: ARMORSNURTLESHELL = wilson_health * 7 * multiplayer_armor_durability_modifier,
// ARMORSNURTLESHELL_ABSORPTION = .6 * multiplayer_armor_absorption_modifier, FULL_ABSORPTION = 1.
export const ARMORSNURTLESHELL = 150 * 7 * 0.7;
export const ARMORSNURTLESHELL_ABSORPTION = 0.6;
export const FULL_ABSORPTION = 1;
/** onuse: inst:DoTaskInTime(5, droptargets). */
const DROPTARGETS_DELAY = 5;
/** droptargets: TheSim:FindEntities(x, y, z, 20, TARGET_MUST_TAGS, TARGET_CANT_TAGS). */
const DROPTARGETS_RANGE = 20;
const TARGET_CANT_TAGS = ['INLIMBO'];

/**
 * armor_snurtleshell.lua's local functions and `inst.task`, kept on the inst. `owner` is
 * inst.components.inventoryitem.owner while worn: equippable:Equip passes it to onequip, and onunequip releases it.
 */
class ArmorSnurtleshell implements ItemRuntimeComponent {
  private readonly inst: ItemEntity;
  private owner?: EquipmentOwner;
  private worn?: EquipmentVisualOwner;
  private task?: ComponentTimer;
  private readonly ownerListeners: (() => void)[] = [];

  constructor(inst: ItemEntity) { this.inst = inst; }

  /** OnBlocked */
  private readonly OnBlocked = (): void => { this.owner?.SoundEmitter?.PlaySound('dontstarve/wilson/hit_armour'); };

  /** ProtectionLevels: the owner's equipped body armor follows whether its state is a shell state. */
  private readonly ProtectionLevels = (): void => {
    const owner = this.owner;
    const equippedArmor = owner?.components?.inventory?.GetEquippedItem('body');
    if (!owner || !equippedArmor) return;
    if (owner.HasStateTag?.('shell')) equippedArmor.components.armor?.SetAbsorption(FULL_ABSORPTION);
    else {
      equippedArmor.components.armor?.SetAbsorption(ARMORSNURTLESHELL_ABSORPTION);
      equippedArmor.components.useableitem?.StopUsingItem();
    }
  };

  /** droptargets: combat entities around a hiding owner stop targeting it. */
  private droptargets(): void {
    this.task = undefined;
    const owner = this.owner, position = owner?.getPosition?.();
    if (!owner || !position || !owner.HasStateTag?.('shell')) return;
    // TARGET_MUST_TAGS { "_combat" } is the combat component's replica tag.
    for (const v of FindEntities(position, DROPTARGETS_RANGE, [], TARGET_CANT_TAGS)) {
      const combat = (v.components as { combat?: Combat }).combat;
      if ((combat?.target as object | undefined) === owner) combat!.DropTarget();
    }
  }

  onuse(): void {
    const owner = this.owner;
    if (!owner) return;
    owner.GoToState?.('shell_enter');
    this.task?.stop();
    const scheduler = this.inst.components.perishable.scheduler;
    if (!scheduler) return;
    const task: ComponentTimer = this.task = new ComponentTimer(scheduler, () => { if (this.task === task) this.droptargets(); });
    task.start(DROPTARGETS_DELAY);
  }

  onstopuse(): void {
    this.task?.stop();
    this.task = undefined;
  }

  onequip(owner: EquipmentOwner): void {
    this.onunequip();
    this.owner = owner;
    // owner.AnimState:OverrideSymbol("swap_body_tall", "armor_slurtleshell", "swap_body_tall")
    this.worn = wornOwner(owner);
    this.worn?.AnimState.OverrideSymbol('swap_body_tall', 'armor_slurtleshell', 'swap_body_tall');
    if (owner.ListenForEvent) {
      this.ownerListeners.push(owner.ListenForEvent('blocked', this.OnBlocked), owner.ListenForEvent('newstate', this.ProtectionLevels));
    }
    // The slurtlehat pairing achievement is not ported.
  }

  onunequip(): void {
    this.worn?.AnimState.ClearOverrideSymbol('swap_body_tall');
    this.worn = undefined;
    this.ownerListeners.splice(0).forEach(stop => stop());
    this.onstopuse();
    this.owner = undefined;
  }

  dispose(): void { this.onunequip(); }
}

/** armor_snurtleshell.lua fn: tags, armor, a body equippable with onequip/onunequip and the useableitem's onuse/onstopuse. */
export function configureArmorSnurtleshellEntity(inst: ItemEntity): void {
  inst.addTag('shell');
  inst.addTag('hardarmor');
  // The inventory configures an inst again on every commit; components are added once, as AddComponent in fn.
  if (inst.getComponent('armorsnurtleshell')) return;
  const shell = inst.component('armorsnurtleshell', () => new ArmorSnurtleshell(inst));
  (inst.components.armor = new Armor(inst)).InitCondition(ARMORSNURTLESHELL, ARMORSNURTLESHELL_ABSORPTION);
  const equippable = inst.components.equippable ??= new Equippable<ItemEntity>(inst, 'body');
  equippable.SetOnEquip((_inst, owner) => shell.onequip(owner));
  equippable.SetOnUnequip(() => shell.onunequip());
  const useableitem = inst.components.useableitem = new UseableItem({
    addTag: tag => inst.addTag(tag),
    removeTag: tag => inst.removeTag(tag),
    isEquipped: () => equippable.IsEquipped(),
  });
  useableitem.SetOnUseFn(() => shell.onuse());
  useableitem.SetOnStopUseFn(() => shell.onstopuse());
}
