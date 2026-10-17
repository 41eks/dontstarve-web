import type { AnimState } from '@dontstarve-web/animation/animState';
import type { ItemEntity } from '@dontstarve-web/inventory';
import type { EquipmentLifecycle, EquipmentOwner } from '@dontstarve-web/signals';
import type { ActionDescription } from '@dontstarve-web/stategraphs';
import type * as THREE from 'three';
import { Weapon } from '../../componets/src/weapon';
import { AXE_USES, configureAxeEntity, getAxeLifecycle, prepareAxeVisual } from './axe';
import { configureBugNetEntity, prepareBugnetVisual } from './bugnet';
import { configureFishingRodEntity, FISHINGROD_USES, prepareFishingRodVisual } from './fishingrod';
import { equipmentVisualLifecycle, type EquipmentVisualOwner, type PrepareEquipmentVisual } from './equipmentVisual';
import { prepareFarmHoeVisual } from './farm_hoe';
import { FIRESTAFF_TAGS, FIRESTAFF_USES, getFireStaffController, prepareFireStaffVisual, type FireStaffWorld } from './firestaff';
import { getGreenStaffController, GREENSTAFF_USES, type GreenStaffWorld } from './greenstaff';
import type { GroundItemAssets } from './groundItems';
import { configureHammerEntity, prepareHammerVisual } from './hammer';
import { configureLanternEntity, createLanternHandLifecycle, LANTERN_FUEL, prepareLanternVisual } from './lantern';
import { configureNightswordEntity, prepareNightswordVisual } from './nightsword';
import { configurePickaxeEntity, getPickaxeLifecycle, PICKAXE_USES, preparePickaxeVisual } from './pickaxe';
import { preparePitchforkVisual } from './pitchfork';
import type { WilsonCarryItem } from './player';
import { configureReskinToolEntity, prepareReskinToolVisual } from './reskin_tool';
import { configureShovelEntity, prepareShovelVisual, SHOVEL_USES } from './shovel';
import { PreloadSounds } from './sound';
import { configureTorchEntity, createTorchHandLifecycle, prepareTorchVisual, TORCH_SOUNDS } from './torch';
import { getTridentController, prepareTridentVisual, TRIDENT_DAMAGE, TRIDENT_USES, type TridentWorld } from './trident';
import { getLightStaffController, prepareYellowstaffVisual, type LightStaffWorld } from './yellowstaff';

// tuning.lua: wilson_attack = 34; GOLDENTOOLFACTOR = 4 lowers golden tools' attackwear.
const WILSON_ATTACK = 34;
const GOLDEN_ATTACKWEAR = 1 / 4;

export interface HandEquipmentContext {
  soundPosition?: THREE.Vector3;
  /** The holder; torchfire's light fx is parented to it while burning. */
  lightParent: THREE.Object3D;
  /** The holder's FollowSymbol, for fx that follow swap_object; absent when there is no animated holder. */
  followSymbol?(symbol: string, offsetX: number, offsetY: number): { node: THREE.Object3D; remove(): void };
  /** Directory containing `fx/*.tex`, i.e. `${BASE_URL}dst/data`. */
  dataBaseUrl?: string;
  AnimState?: AnimState;
  assets?: GroundItemAssets;
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
  preload?(): Promise<void>;
  readonly prepareVisual: PrepareEquipmentVisual;
  createLifecycle?(entity: ItemEntity, context: HandEquipmentContext): EquipmentLifecycle | undefined;
}

/** Source hand prefabs declare their presentation and equip lifecycle together. */
const definitions: Record<WilsonCarryItem, HandEquipmentDefinition> = {
  torch: { prepareVisual: prepareTorchVisual, weapon: { damage: WILSON_ATTACK * .5 }, configureEntity: configureTorchEntity, preload: () => PreloadSounds(...TORCH_SOUNDS), createLifecycle: createTorchHandLifecycle },
  lantern: { prepareVisual: prepareLanternVisual, tags: ['light'], maxFuel: LANTERN_FUEL, configureEntity: configureLanternEntity, createLifecycle: createLanternHandLifecycle },
  yellowstaff: { prepareVisual: prepareYellowstaffVisual, tags: ['nopunch'], createLifecycle: (entity, context) => context.lightStaffWorld ? getLightStaffController(entity, context.lightStaffWorld) : undefined },
  opalstaff: { prepareVisual: prepareYellowstaffVisual, tags: ['nopunch'], createLifecycle: (entity, context) => context.lightStaffWorld ? getLightStaffController(entity, context.lightStaffWorld) : undefined },
  greenstaff: { prepareVisual: prepareYellowstaffVisual, tags: ['nopunch'], maxUses: GREENSTAFF_USES, createLifecycle: (entity, context) => context.greenStaffWorld ? getGreenStaffController(entity, context.greenStaffWorld) : undefined },
  // staff.lua red(): weapon damage 0 (the projectile only lights), FIRESTAFF_USES uses, ranged lighter tags.
  firestaff: { prepareVisual: prepareFireStaffVisual, maxUses: FIRESTAFF_USES, tags: FIRESTAFF_TAGS, weapon: { damage: 0 },
    createLifecycle: (entity, context) => context.fireStaffWorld ? getFireStaffController(entity, context.fireStaffWorld) : undefined },
  // trident.lua: TRIDENT.DAMAGE over ground (OCEAN_DAMAGE applies only while the wielder stands on a boat or the sea).
  trident: { prepareVisual: prepareTridentVisual, maxUses: TRIDENT_USES, tags: ['pointy', 'sharp'], weapon: { damage: TRIDENT_DAMAGE },
    createLifecycle: (entity, context) => context.tridentWorld ? getTridentController(entity, context.tridentWorld) : undefined },
  bugnet: { prepareVisual: prepareBugnetVisual, maxUses: 10, weapon: { damage: WILSON_ATTACK * .125, attackwear: 3 }, configureEntity: configureBugNetEntity },
  // fishingrod.lua: FISHINGROD_DAMAGE = wilson_attack * .125, attackwear 4.
  fishingrod: { prepareVisual: prepareFishingRodVisual, maxUses: FISHINGROD_USES, weapon: { damage: WILSON_ATTACK * .125, attackwear: 4 }, configureEntity: configureFishingRodEntity },
  hammer: { prepareVisual: prepareHammerVisual, maxUses: 75, weapon: { damage: WILSON_ATTACK * .5 }, configureEntity: configureHammerEntity },
  // nightsword.lua: NIGHTSWORD_DAMAGE = wilson_attack * 2, NIGHTSWORD_USES = 100.
  nightsword: { prepareVisual: prepareNightswordVisual, maxUses: 100, tags: ['shadow', 'sharp'], weapon: { damage: WILSON_ATTACK * 2 }, configureEntity: configureNightswordEntity },
  reskin_tool: { prepareVisual: prepareReskinToolVisual, tags: ['nopunch'], configureEntity: configureReskinToolEntity },
  pickaxe: { prepareVisual: preparePickaxeVisual, maxUses: PICKAXE_USES, weapon: { damage: WILSON_ATTACK * .8 }, configureEntity: configurePickaxeEntity, createLifecycle: getPickaxeLifecycle },
  goldenpickaxe: { prepareVisual: preparePickaxeVisual, maxUses: PICKAXE_USES, useStep: .25, weapon: { damage: WILSON_ATTACK * .8, attackwear: GOLDEN_ATTACKWEAR }, configureEntity: configurePickaxeEntity, createLifecycle: getPickaxeLifecycle },
  // axe.lua: TUNING.AXE_DAMAGE = wilson_attack * .8; golden attackwear = 1 / GOLDENTOOLFACTOR.
  axe: { prepareVisual: prepareAxeVisual, maxUses: AXE_USES, weapon: { damage: WILSON_ATTACK * .8 }, configureEntity: configureAxeEntity, createLifecycle: getAxeLifecycle },
  goldenaxe: { prepareVisual: prepareAxeVisual, maxUses: AXE_USES, useStep: .25, weapon: { damage: WILSON_ATTACK * .8, attackwear: GOLDEN_ATTACKWEAR }, configureEntity: configureAxeEntity, createLifecycle: getAxeLifecycle },
  // tuning.lua MOONGLASSAXE: DAMAGE = wilson_attack, ATTACKWEAR = 2.
  moonglassaxe: { prepareVisual: prepareAxeVisual, maxUses: AXE_USES, weapon: { damage: WILSON_ATTACK, attackwear: 2 }, configureEntity: configureAxeEntity, createLifecycle: getAxeLifecycle },
  pitchfork: { prepareVisual: preparePitchforkVisual, weapon: { damage: WILSON_ATTACK * .5 } },
  goldenpitchfork: { prepareVisual: preparePitchforkVisual, weapon: { damage: WILSON_ATTACK * .5, attackwear: GOLDEN_ATTACKWEAR } },
  farm_hoe: { prepareVisual: prepareFarmHoeVisual, weapon: { damage: WILSON_ATTACK * .5 } },
  golden_farm_hoe: { prepareVisual: prepareFarmHoeVisual, weapon: { damage: WILSON_ATTACK * .5, attackwear: GOLDEN_ATTACKWEAR } },
  shovel: { prepareVisual: prepareShovelVisual, maxUses: SHOVEL_USES, weapon: { damage: WILSON_ATTACK * .5 }, configureEntity: configureShovelEntity },
  goldenshovel: { prepareVisual: prepareShovelVisual, maxUses: SHOVEL_USES, useStep: .25, weapon: { damage: WILSON_ATTACK * .5, attackwear: GOLDEN_ATTACKWEAR },
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

export async function preloadHandEquipment(): Promise<void> {
  await Promise.all(Object.values(definitions).map(definition => definition.preload?.()));
}

/** Prefab domain and presentation share the same equip lifetime, including pending resource loads. */
export function createHandEquipmentLifecycle(entity: ItemEntity, context: HandEquipmentContext) {
  const definition = getHandEquipmentDefinition(entity.prefab)?.definition;
  const domain = definition?.createLifecycle?.(entity, context);
  let visual: ReturnType<typeof equipmentVisualLifecycle> | undefined;
  return {
    get ready() { return visual?.ready ?? Promise.resolve(); },
    onequip(owner?: EquipmentOwner) {
      if (definition && context.AnimState && context.assets) {
        const visualOwner: EquipmentVisualOwner = {
          AnimState: context.AnimState,
          PushEvent: (name, data) => owner?.PushEvent(name, data),
        };
        const item = { id: entity.id, prefab: entity.prefab, skinId: entity.skinId };
        visual = equipmentVisualLifecycle(() => definition.prepareVisual(context.assets!, item), visualOwner);
      }
      domain?.onequip(owner);
    },
    onunequip() { domain?.onunequip(); visual?.onunequip(); visual = undefined; },
    onFrame(dt: number) { domain?.onFrame?.(dt); },
    flush() { domain?.flush?.(); },
  };
}
