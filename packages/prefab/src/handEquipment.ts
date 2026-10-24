import type { ItemEntity } from '@dontstarve-web/inventory';
import type { HandEquipmentLifecycle } from '@dontstarve-web/signals';
import type { ActionDescription } from '@dontstarve-web/stategraphs';
import type { WilsonCarryItem } from './player';
import { configureTorchEntity, createTorchHandLifecycle, TORCH_SOUNDS } from './torch';
import { createLanternHandLifecycle, LANTERN_FUEL } from './lantern';
import { PreloadSounds, type SoundPosition } from './sound';
import { getLightStaffController, type LightStaffWorld } from './yellowstaff';
import { configureBugNetEntity } from './bugnet';
import { configureHammerEntity } from './hammer';
import { configureReskinToolEntity } from './reskin_tool';
import { getGreenStaffController, GREENSTAFF_USES, type GreenStaffWorld } from './greenstaff';
import { configureShovelEntity, SHOVEL_USES } from './shovel';
import { configurePickaxeEntity, getPickaxeLifecycle, PICKAXE_USES } from './pickaxe';
import { AXE_USES, configureAxeEntity, getAxeLifecycle } from './axe';
import { configureNightswordEntity } from './nightsword';
import { Weapon } from '../../componets/src/weapon';

// tuning.lua: wilson_attack = 34; GOLDENTOOLFACTOR = 4 lowers golden tools' attackwear.
const WILSON_ATTACK = 34;
const GOLDEN_ATTACKWEAR = 1 / 4;

export interface HandEquipmentContext {
  soundPosition?: SoundPosition;
  setLightActive(active: boolean): void;
  /** The holder's lantern light and LANTERN_OVERLAY follow machine.ison and fuel percent. */
  setLanternLight?(ison: boolean, fuelPercent: number): void;
  lightStaffWorld?: LightStaffWorld;
  greenStaffWorld?: GreenStaffWorld;
}
export interface HandEquipmentDefinition {
  readonly maxUses?: number;
  readonly useStep?: number;
  readonly maxFuel?: number;
  /** The prefab's weapon component: SetDamage and attackwear. */
  readonly weapon?: { readonly damage: number; readonly attackwear?: number };
  /** Source tags read by SGwilson's attack branches ("light", "nopunch"). */
  readonly tags?: readonly string[];
  configureEntity?(entity: ItemEntity): void;
  readonly handAction?: ActionDescription;
  preload?(): Promise<void>;
  createLifecycle?(entity: ItemEntity, context: HandEquipmentContext): HandEquipmentLifecycle | undefined;
}

/** Source hand prefabs declare their presentation and equip lifecycle together. */
const definitions: Record<WilsonCarryItem, HandEquipmentDefinition> = {
  torch: { weapon: { damage: WILSON_ATTACK * .5 }, configureEntity: configureTorchEntity, preload: () => PreloadSounds(...TORCH_SOUNDS), createLifecycle: createTorchHandLifecycle },
  lantern: { tags: ['light'], maxFuel: LANTERN_FUEL, createLifecycle: createLanternHandLifecycle },
  yellowstaff: { tags: ['nopunch'], createLifecycle: (entity, context) => context.lightStaffWorld ? getLightStaffController(entity, context.lightStaffWorld) : undefined },
  opalstaff: { tags: ['nopunch'], createLifecycle: (entity, context) => context.lightStaffWorld ? getLightStaffController(entity, context.lightStaffWorld) : undefined },
  greenstaff: { tags: ['nopunch'], maxUses: GREENSTAFF_USES, createLifecycle: (entity, context) => context.greenStaffWorld ? getGreenStaffController(entity, context.greenStaffWorld) : undefined },
  bugnet: { maxUses: 10, weapon: { damage: WILSON_ATTACK * .125, attackwear: 3 }, configureEntity: configureBugNetEntity },
  hammer: { maxUses: 75, weapon: { damage: WILSON_ATTACK * .5 }, configureEntity: configureHammerEntity },
  // nightsword.lua: NIGHTSWORD_DAMAGE = wilson_attack * 2, NIGHTSWORD_USES = 100.
  nightsword: { maxUses: 100, tags: ['shadow', 'sharp'], weapon: { damage: WILSON_ATTACK * 2 }, configureEntity: configureNightswordEntity },
  reskin_tool: { tags: ['nopunch'], configureEntity: configureReskinToolEntity },
  pickaxe: { maxUses: PICKAXE_USES, weapon: { damage: WILSON_ATTACK * .8 }, configureEntity: configurePickaxeEntity, createLifecycle: getPickaxeLifecycle },
  goldenpickaxe: { maxUses: PICKAXE_USES, useStep: .25, weapon: { damage: WILSON_ATTACK * .8, attackwear: GOLDEN_ATTACKWEAR }, configureEntity: configurePickaxeEntity, createLifecycle: getPickaxeLifecycle },
  // axe.lua: TUNING.AXE_DAMAGE = wilson_attack * .8; golden attackwear = 1 / GOLDENTOOLFACTOR.
  axe: { maxUses: AXE_USES, weapon: { damage: WILSON_ATTACK * .8 }, configureEntity: configureAxeEntity, createLifecycle: getAxeLifecycle },
  goldenaxe: { maxUses: AXE_USES, useStep: .25, weapon: { damage: WILSON_ATTACK * .8, attackwear: GOLDEN_ATTACKWEAR }, configureEntity: configureAxeEntity, createLifecycle: getAxeLifecycle },
  // tuning.lua MOONGLASSAXE: DAMAGE = wilson_attack, ATTACKWEAR = 2.
  moonglassaxe: { maxUses: AXE_USES, weapon: { damage: WILSON_ATTACK, attackwear: 2 }, configureEntity: configureAxeEntity, createLifecycle: getAxeLifecycle },
  pitchfork: { weapon: { damage: WILSON_ATTACK * .5 } },
  goldenpitchfork: { weapon: { damage: WILSON_ATTACK * .5, attackwear: GOLDEN_ATTACKWEAR } },
  farm_hoe: { weapon: { damage: WILSON_ATTACK * .5 } },
  golden_farm_hoe: { weapon: { damage: WILSON_ATTACK * .5, attackwear: GOLDEN_ATTACKWEAR } },
  shovel: { maxUses: SHOVEL_USES, weapon: { damage: WILSON_ATTACK * .5 }, configureEntity: configureShovelEntity },
  goldenshovel: { maxUses: SHOVEL_USES, useStep: .25, weapon: { damage: WILSON_ATTACK * .5, attackwear: GOLDEN_ATTACKWEAR },
    configureEntity: configureShovelEntity },
};

/** Prefab configuration for a hand inst: its own configureEntity, source tags and weapon component. */
export function configureHandEquipmentEntity(entity: ItemEntity): void {
  const entry = getHandEquipmentDefinition(entity.prefab);
  if (!entry) return;
  const { definition } = entry;
  definition.configureEntity?.(entity);
  for (const tag of definition.tags ?? []) entity.addTag(tag);
  if (definition.weapon && !entity.components.weapon) {
    // weapon.lua adds the "weapon" tag; weapon:OnAttack wears finiteuses only when the inst has them.
    const weapon = new Weapon(entity, () => definition.maxUses === undefined ? undefined : entity.components.finiteuses);
    weapon.SetDamage(definition.weapon.damage);
    if (definition.weapon.attackwear !== undefined) weapon.attackwear = definition.weapon.attackwear;
    entity.components.weapon = weapon;
    entity.addTag('weapon');
  }
}

export function getHandEquipmentDefinition(itemId: string): { carryItem: WilsonCarryItem; definition: HandEquipmentDefinition } | undefined {
  if (!Object.hasOwn(definitions, itemId)) return undefined;
  const carryItem = itemId as WilsonCarryItem;
  return { carryItem, definition: definitions[carryItem] };
}

export async function preloadHandEquipment(): Promise<void> {
  await Promise.all(Object.values(definitions).map(definition => definition.preload?.()));
}
