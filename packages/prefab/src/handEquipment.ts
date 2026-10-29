import type { AnimState } from '@dontstarve-web/animation/animState';
import type { FollowerFx } from '@dontstarve-web/display';
import type { ItemEntity } from '@dontstarve-web/inventory';
import type { EquipmentLifecycle, EquipmentOwner } from '@dontstarve-web/signals';
import type { ActionDescription } from '@dontstarve-web/stategraphs';
import type * as THREE from 'three';
import { Weapon } from '../../componets/src/weapon';
import { AXE_USES, configureAxeEntity, getAxeLifecycle, axeVisual } from './axe';
import { configureBugNetEntity, bugnetVisual } from './bugnet';
import { configureFishingRodEntity, FISHINGROD_USES, fishingRodVisual } from './fishingrod';
import type { EquipmentVisual, EquipmentVisualFactory } from './equipmentVisual';
import { farmHoeVisual } from './farm_hoe';
import { FIRESTAFF_TAGS, FIRESTAFF_USES, getFireStaffController, fireStaffVisual, type FireStaffWorld } from './firestaff';
import { getGreenStaffController, GREENSTAFF_USES, type GreenStaffWorld } from './greenstaff';
import { configureHammerEntity, hammerVisual } from './hammer';
import { configureLanternEntity, createLanternHandLifecycle, LANTERN_FUEL, lanternVisual } from './lantern';
import { configureNightswordEntity, nightswordVisual } from './nightsword';
import { configurePickaxeEntity, getPickaxeLifecycle, PICKAXE_USES, pickaxeVisual } from './pickaxe';
import { pitchforkVisual } from './pitchfork';
import type { WilsonCarryItem } from './player';
import { configureReskinToolEntity, reskinToolVisual } from './reskin_tool';
import { configureShovelEntity, shovelVisual, SHOVEL_USES } from './shovel';
import { configureTorchEntity, createTorchHandLifecycle, torchVisual } from './torch';
import { getTridentController, tridentVisual, TRIDENT_DAMAGE, TRIDENT_USES, type TridentWorld } from './trident';
import { getLightStaffController, yellowstaffVisual, type LightStaffWorld } from './yellowstaff';

// tuning.lua: wilson_attack = 34; GOLDENTOOLFACTOR = 4 lowers golden tools' attackwear.
const WILSON_ATTACK = 34;
const GOLDEN_ATTACKWEAR = 1 / 4;

export interface HandEquipmentContext {
  soundPosition?: THREE.Vector3;
  /** The holder; torchfire's light fx is parented to it while burning. */
  lightParent: THREE.Object3D;
  /** The holder's FollowSymbol, for fx that follow swap_object; absent when there is no animated holder. */
  followSymbol?(symbol: string, offsetX: number, offsetY: number, fx?: FollowerFx): { node: THREE.Object3D; remove(): void };
  /** Directory containing `fx/*.tex`, i.e. `${BASE_URL}dst/data`. */
  dataBaseUrl?: string;
  AnimState?: AnimState;
  lightStaffWorld?: LightStaffWorld;
  greenStaffWorld?: GreenStaffWorld;
  fireStaffWorld?: FireStaffWorld;
  tridentWorld?: TridentWorld;
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
  readonly visual: EquipmentVisualFactory;
  createLifecycle?(entity: ItemEntity, context: HandEquipmentContext): EquipmentLifecycle | undefined;
}

/** Source hand prefabs declare their presentation and equip lifecycle together. */
const definitions: Record<WilsonCarryItem, HandEquipmentDefinition> = {
  torch: { visual: torchVisual, weapon: { damage: WILSON_ATTACK * .5 }, configureEntity: configureTorchEntity, createLifecycle: createTorchHandLifecycle },
  lantern: { visual: lanternVisual, tags: ['light'], maxFuel: LANTERN_FUEL, configureEntity: configureLanternEntity, createLifecycle: createLanternHandLifecycle },
  yellowstaff: { visual: yellowstaffVisual, tags: ['nopunch'], createLifecycle: (entity, context) => context.lightStaffWorld ? getLightStaffController(entity, context.lightStaffWorld) : undefined },
  opalstaff: { visual: yellowstaffVisual, tags: ['nopunch'], createLifecycle: (entity, context) => context.lightStaffWorld ? getLightStaffController(entity, context.lightStaffWorld) : undefined },
  greenstaff: { visual: yellowstaffVisual, tags: ['nopunch'], maxUses: GREENSTAFF_USES, createLifecycle: (entity, context) => context.greenStaffWorld ? getGreenStaffController(entity, context.greenStaffWorld) : undefined },
  // staff.lua red(): weapon damage 0 (the projectile only lights), FIRESTAFF_USES uses, ranged lighter tags.
  firestaff: { visual: fireStaffVisual, maxUses: FIRESTAFF_USES, tags: FIRESTAFF_TAGS, weapon: { damage: 0 },
    createLifecycle: (entity, context) => context.fireStaffWorld ? getFireStaffController(entity, context.fireStaffWorld) : undefined },
  // trident.lua: TRIDENT.DAMAGE over ground (OCEAN_DAMAGE applies only while the wielder stands on a boat or the sea).
  trident: { visual: tridentVisual, maxUses: TRIDENT_USES, tags: ['pointy', 'sharp'], weapon: { damage: TRIDENT_DAMAGE },
    createLifecycle: (entity, context) => context.tridentWorld ? getTridentController(entity, context.tridentWorld) : undefined },
  bugnet: { visual: bugnetVisual, maxUses: 10, weapon: { damage: WILSON_ATTACK * .125, attackwear: 3 }, configureEntity: configureBugNetEntity },
  // fishingrod.lua: FISHINGROD_DAMAGE = wilson_attack * .125, attackwear 4.
  fishingrod: { visual: fishingRodVisual, maxUses: FISHINGROD_USES, weapon: { damage: WILSON_ATTACK * .125, attackwear: 4 }, configureEntity: configureFishingRodEntity },
  hammer: { visual: hammerVisual, maxUses: 75, weapon: { damage: WILSON_ATTACK * .5 }, configureEntity: configureHammerEntity },
  // nightsword.lua: NIGHTSWORD_DAMAGE = wilson_attack * 2, NIGHTSWORD_USES = 100.
  nightsword: { visual: nightswordVisual, maxUses: 100, tags: ['shadow', 'sharp'], weapon: { damage: WILSON_ATTACK * 2 }, configureEntity: configureNightswordEntity },
  reskin_tool: { visual: reskinToolVisual, tags: ['nopunch'], configureEntity: configureReskinToolEntity },
  pickaxe: { visual: pickaxeVisual, maxUses: PICKAXE_USES, weapon: { damage: WILSON_ATTACK * .8 }, configureEntity: configurePickaxeEntity, createLifecycle: getPickaxeLifecycle },
  goldenpickaxe: { visual: pickaxeVisual, maxUses: PICKAXE_USES, useStep: .25, weapon: { damage: WILSON_ATTACK * .8, attackwear: GOLDEN_ATTACKWEAR }, configureEntity: configurePickaxeEntity, createLifecycle: getPickaxeLifecycle },
  // axe.lua: TUNING.AXE_DAMAGE = wilson_attack * .8; golden attackwear = 1 / GOLDENTOOLFACTOR.
  axe: { visual: axeVisual, maxUses: AXE_USES, weapon: { damage: WILSON_ATTACK * .8 }, configureEntity: configureAxeEntity, createLifecycle: getAxeLifecycle },
  goldenaxe: { visual: axeVisual, maxUses: AXE_USES, useStep: .25, weapon: { damage: WILSON_ATTACK * .8, attackwear: GOLDEN_ATTACKWEAR }, configureEntity: configureAxeEntity, createLifecycle: getAxeLifecycle },
  // tuning.lua MOONGLASSAXE: DAMAGE = wilson_attack, ATTACKWEAR = 2.
  moonglassaxe: { visual: axeVisual, maxUses: AXE_USES, weapon: { damage: WILSON_ATTACK, attackwear: 2 }, configureEntity: configureAxeEntity, createLifecycle: getAxeLifecycle },
  pitchfork: { visual: pitchforkVisual, weapon: { damage: WILSON_ATTACK * .5 } },
  goldenpitchfork: { visual: pitchforkVisual, weapon: { damage: WILSON_ATTACK * .5, attackwear: GOLDEN_ATTACKWEAR } },
  farm_hoe: { visual: farmHoeVisual, weapon: { damage: WILSON_ATTACK * .5 } },
  golden_farm_hoe: { visual: farmHoeVisual, weapon: { damage: WILSON_ATTACK * .5, attackwear: GOLDEN_ATTACKWEAR } },
  shovel: { visual: shovelVisual, maxUses: SHOVEL_USES, weapon: { damage: WILSON_ATTACK * .5 }, configureEntity: configureShovelEntity },
  goldenshovel: { visual: shovelVisual, maxUses: SHOVEL_USES, useStep: .25, weapon: { damage: WILSON_ATTACK * .5, attackwear: GOLDEN_ATTACKWEAR },
    configureEntity: configureShovelEntity },
};

/** Prefab configuration for a hand inst: its own configureEntity, source tags and weapon component. */
export function configureEquipmentEntity(entity: ItemEntity): void {
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

/** Prefab domain and presentation share the same equip lifetime; the holder's display loads the named art. */
export function createHandEquipmentLifecycle(entity: ItemEntity, context: HandEquipmentContext): EquipmentLifecycle {
  const definition = getHandEquipmentDefinition(entity.prefab)?.definition;
  const domain = definition?.createLifecycle?.(entity, context);
  let visual: EquipmentVisual | undefined;
  return {
    onequip(owner?: EquipmentOwner) {
      if (definition && context.AnimState) {
        visual = definition.visual({ id: entity.id, prefab: entity.prefab, skinId: entity.skinId });
        visual.onequip({ AnimState: context.AnimState, PushEvent: (name, data) => owner?.PushEvent(name, data) });
      }
      domain?.onequip(owner);
    },
    onunequip() { domain?.onunequip(); visual?.onunequip(); visual = undefined; },
    flush() { domain?.flush?.(); },
  };
}
