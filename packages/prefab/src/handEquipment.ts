import type { FollowerFx } from '@dontstarve-web/display';
import type { ItemEntity, ItemRuntimeComponent } from '@dontstarve-web/inventory';
import type { EquipmentOwner } from '@dontstarve-web/signals';
import type { ActionDescription } from '@dontstarve-web/stategraphs';
import type * as THREE from 'three';
import { Weapon } from '../../componets/src/weapon';
import { AXE_USES, configureAxeEntity, getAxeLifecycle, axeVisual } from './axe';
import { configureBugNetEntity, bugnetVisual } from './bugnet';
import { configureFishingRodEntity, createFishingRodLifecycle, FISHINGROD_USES, fishingRodVisual } from './fishingrod';
import { Equippable } from '../../componets/src/equippable';
import { wornOwner, type EquipmentAnimState, type EquipmentSprite, type EquipmentVisual, type EquipmentVisualFactory, type HeldEquipFunctions } from './equipmentVisual';
import { configureFarmHoeEntity, createFarmTillerLifecycle, farmHoeVisual } from './farm_hoe';
import { configureHammerEntity, hammerVisual } from './hammer';
import { configureLanternEntity, createLanternHandLifecycle, LANTERN_FUEL, lanternVisual } from './lantern';
import { configureNightswordEntity, nightswordVisual } from './nightsword';
import { configurePickaxeEntity, getPickaxeLifecycle, PICKAXE_USES, pickaxeVisual } from './pickaxe';
import { configurePitchforkEntity, createTerraformerLifecycle, pitchforkVisual } from './pitchfork';
import type { WilsonCarryItem } from './player';
import type { PrefabInstance } from './prefabInstance';
import { configureReskinToolEntity, createReskinToolLifecycle, reskinToolVisual } from './reskin_tool';
import { configureShovelEntity, shovelVisual, SHOVEL_USES } from './shovel';
import { configureTorchEntity, createTorchHandLifecycle, onattack as torchOnAttack, torchVisual } from './torch';
import { getTridentController, tridentVisual, TRIDENT_DAMAGE, TRIDENT_USES, type TridentWorld } from './trident';
import { FIRESTAFF_TAGS, FIRESTAFF_USES, fireStaffVisual, getFireStaffController, getGreenStaffController, getLightStaffController, GREENSTAFF_USES, yellowstaffVisual, type FireStaffWorld, type GreenStaffWorld, type LightStaffWorld } from './staff';

// tuning.lua: wilson_attack = 34; GOLDENTOOLFACTOR = 4 lowers golden tools' attackwear.
const WILSON_ATTACK = 34;
const GOLDEN_ATTACKWEAR = 1 / 4;

/** TheWorld's services hand items use, bound to their registry (ItemEntityRegistry.bindEquipmentWorld). */
export interface HandEquipmentWorld {
  lightStaffWorld?: LightStaffWorld;
  greenStaffWorld?: GreenStaffWorld;
  fireStaffWorld?: FireStaffWorld;
  tridentWorld?: TridentWorld;
  /** reskin_tool.lua SpawnPrefab(fx_prefab): the scene's reskin fx. */
  reskinEffects?: import('@dontstarve-web/stategraphs/reskin_tool').ReskinEffectPresenter;
  fishingWorld?: import('./fishingrod').FishingRodWorld;
  /** TheWorld.Map for the pitchfork's terraformer and the farm hoe's farmtiller. */
  terraformMap?: import('../../componets/src/terraformer').TerraformerMap;
  farmTillMap?: import('../../componets/src/farmtiller').FarmTillerMap;
}

/** What a hand prefab's equip functions reach: TheWorld's services and the owner's drawing of its equipment. */
export interface HandEquipmentContext extends HandEquipmentWorld {
  soundPosition?: import('../../animation/src/transformRoot').ReadonlyVector3;
  /** The holder; torchfire's light fx is parented to it while burning. */
  lightParent?: PrefabInstance;
  /** The holder's FollowSymbol, for fx that follow swap_object; absent when there is no animated holder. */
  followSymbol?(symbol: string, offsetX: number, offsetY: number, fx?: FollowerFx): { node: THREE.Object3D; remove(): void };
  /** The holder's sprite: the held item declares its art in a slot of its own there. */
  sprite?: EquipmentSprite;
}
export interface HandEquipmentDefinition {
  readonly maxUses?: number;
  readonly useStep?: number;
  readonly maxFuel?: number;
  /** The prefab's weapon component: SetDamage and attackwear. */
  readonly weapon?: { readonly damage: number; readonly attackwear?: number; readonly onattack?: Weapon['onattack'] };
  /** Source tags read by SGwilson's attack branches ("light", "nopunch"). */
  readonly tags?: readonly string[];
  configureEntity?(entity: ItemEntity): void;
  readonly handAction?: ActionDescription;
  readonly visual: EquipmentVisualFactory;
  /** `context.AnimState` is the item's own slot on the holder, the owner.AnimState its equip functions write. */
  createLifecycle?(entity: ItemEntity, context: HandEquipmentContext & { AnimState?: EquipmentAnimState['AnimState'] }): HeldEquipFunctions | undefined;
}

/** Source hand prefabs declare their presentation and equip lifecycle together. */
const definitions: Record<WilsonCarryItem, HandEquipmentDefinition> = {
  torch: { visual: torchVisual, weapon: { damage: WILSON_ATTACK * .5, onattack: torchOnAttack }, configureEntity: configureTorchEntity, createLifecycle: createTorchHandLifecycle },
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
  fishingrod: { visual: fishingRodVisual, maxUses: FISHINGROD_USES, weapon: { damage: WILSON_ATTACK * .125, attackwear: 4 }, configureEntity: configureFishingRodEntity,
    createLifecycle: (entity, context) => context.fishingWorld ? createFishingRodLifecycle(entity, context.fishingWorld) : undefined },
  hammer: { visual: hammerVisual, maxUses: 75, weapon: { damage: WILSON_ATTACK * .5 }, configureEntity: configureHammerEntity },
  // nightsword.lua: NIGHTSWORD_DAMAGE = wilson_attack * 2, NIGHTSWORD_USES = 100.
  nightsword: { visual: nightswordVisual, maxUses: 100, tags: ['shadow', 'sharp'], weapon: { damage: WILSON_ATTACK * 2 }, configureEntity: configureNightswordEntity },
  reskin_tool: { visual: reskinToolVisual, tags: ['nopunch'], configureEntity: configureReskinToolEntity,
    createLifecycle: (entity, context) => createReskinToolLifecycle(entity, context.reskinEffects) },
  pickaxe: { visual: pickaxeVisual, maxUses: PICKAXE_USES, weapon: { damage: WILSON_ATTACK * .8 }, configureEntity: configurePickaxeEntity, createLifecycle: getPickaxeLifecycle },
  goldenpickaxe: { visual: pickaxeVisual, maxUses: PICKAXE_USES, useStep: .25, weapon: { damage: WILSON_ATTACK * .8, attackwear: GOLDEN_ATTACKWEAR }, configureEntity: configurePickaxeEntity, createLifecycle: getPickaxeLifecycle },
  // axe.lua: TUNING.AXE_DAMAGE = wilson_attack * .8; golden attackwear = 1 / GOLDENTOOLFACTOR.
  axe: { visual: axeVisual, maxUses: AXE_USES, weapon: { damage: WILSON_ATTACK * .8 }, configureEntity: configureAxeEntity, createLifecycle: getAxeLifecycle },
  goldenaxe: { visual: axeVisual, maxUses: AXE_USES, useStep: .25, weapon: { damage: WILSON_ATTACK * .8, attackwear: GOLDEN_ATTACKWEAR }, configureEntity: configureAxeEntity, createLifecycle: getAxeLifecycle },
  // tuning.lua MOONGLASSAXE: DAMAGE = wilson_attack, ATTACKWEAR = 2.
  moonglassaxe: { visual: axeVisual, maxUses: AXE_USES, weapon: { damage: WILSON_ATTACK, attackwear: 2 }, configureEntity: configureAxeEntity, createLifecycle: getAxeLifecycle },
  pitchfork: { visual: pitchforkVisual, weapon: { damage: WILSON_ATTACK * .5 }, configureEntity: configurePitchforkEntity,
    createLifecycle: (entity, context) => context.terraformMap ? createTerraformerLifecycle(entity, context.terraformMap) : undefined },
  goldenpitchfork: { visual: pitchforkVisual, weapon: { damage: WILSON_ATTACK * .5, attackwear: GOLDEN_ATTACKWEAR }, configureEntity: configurePitchforkEntity,
    createLifecycle: (entity, context) => context.terraformMap ? createTerraformerLifecycle(entity, context.terraformMap) : undefined },
  farm_hoe: { visual: farmHoeVisual, weapon: { damage: WILSON_ATTACK * .5 }, configureEntity: configureFarmHoeEntity,
    createLifecycle: (entity, context) => context.farmTillMap ? createFarmTillerLifecycle(entity, context.farmTillMap) : undefined },
  golden_farm_hoe: { visual: farmHoeVisual, weapon: { damage: WILSON_ATTACK * .5, attackwear: GOLDEN_ATTACKWEAR }, configureEntity: configureFarmHoeEntity,
    createLifecycle: (entity, context) => context.farmTillMap ? createFarmTillerLifecycle(entity, context.farmTillMap) : undefined },
  shovel: { visual: shovelVisual, maxUses: SHOVEL_USES, weapon: { damage: WILSON_ATTACK * .5 }, configureEntity: configureShovelEntity },
  goldenshovel: { visual: shovelVisual, maxUses: SHOVEL_USES, useStep: .25, weapon: { damage: WILSON_ATTACK * .5, attackwear: GOLDEN_ATTACKWEAR },
    configureEntity: configureShovelEntity },
};

/** Prefab configuration for a hand inst: its own configureEntity, source tags, weapon and equippable onequip/onunequip. */
export function configureEquipmentEntity(entity: ItemEntity): void {
  const entry = getHandEquipmentDefinition(entity.prefab);
  if (!entry) return;
  const { definition } = entry;
  definition.configureEntity?.(entity);
  if (!entity.getComponent('handequipment')) {
    const held = entity.component('handequipment', () => new HeldEquipment(entity, definition));
    const equippable = entity.components.equippable ??= new Equippable<ItemEntity>(entity, 'hand');
    equippable.SetOnEquip((_inst, owner) => held.onequip(owner));
    equippable.SetOnUnequip(() => held.onunequip());
  }
  for (const tag of definition.tags ?? []) entity.addTag(tag);
  if (definition.weapon && !entity.components.weapon) {
    // weapon.lua adds the "weapon" tag; weapon:OnAttack wears finiteuses only when the inst has them.
    const weapon = new Weapon(entity, () => definition.maxUses === undefined ? undefined : entity.components.finiteuses);
    weapon.SetDamage(definition.weapon.damage);
    if (definition.weapon.attackwear !== undefined) weapon.attackwear = definition.weapon.attackwear;
    if (definition.weapon.onattack) weapon.SetOnAttack(definition.weapon.onattack);
    entity.components.weapon = weapon;
    entity.addTag('weapon');
  }
}

export function getHandEquipmentDefinition(itemId: string): { carryItem: WilsonCarryItem; definition: HandEquipmentDefinition } | undefined {
  if (!Object.hasOwn(definitions, itemId)) return undefined;
  const carryItem = itemId as WilsonCarryItem;
  return { carryItem, definition: definitions[carryItem] };
}

/**
 * A hand prefab's onequip/onunequip: the held art on the owner's AnimState (the inst's own slot), then the prefab's
 * equip functions with TheWorld's services and the owner's presentation. They last for one equip.
 */
class HeldEquipment implements ItemRuntimeComponent {
  private readonly inst: ItemEntity;
  private readonly definition: HandEquipmentDefinition;
  private visual?: EquipmentVisual;
  private domain?: HeldEquipFunctions;
  constructor(inst: ItemEntity, definition: HandEquipmentDefinition) { this.inst = inst; this.definition = definition; }

  onequip(owner: EquipmentOwner): void {
    this.onunequip();
    const worn = wornOwner(owner), presentation = worn?.presentation;
    if (worn) {
      this.visual = this.definition.visual({ id: this.inst.id, prefab: this.inst.prefab, skinId: this.inst.skinId });
      this.visual.onequip(worn);
    }
    const world = this.inst.equipmentWorld as HandEquipmentWorld | undefined;
    this.domain = this.definition.createLifecycle?.(this.inst, {
      ...world,
      ...(presentation ? { lightParent: presentation.lightParent, followSymbol: presentation.followSymbol,
        soundPosition: presentation.soundPosition, sprite: presentation.sprite } : {}),
      AnimState: worn?.AnimState,
    });
    this.domain?.onequip(owner);
  }

  onunequip(): void {
    this.domain?.onunequip(); this.domain = undefined;
    this.visual?.onunequip(); this.visual = undefined;
  }

  /** Settles the held item's consumption before a save or transfer reads it. */
  flush(): void { this.domain?.flush?.(); }
  dispose(): void { this.onunequip(); }
}
