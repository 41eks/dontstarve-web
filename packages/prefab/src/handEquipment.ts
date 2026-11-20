import { addComponent } from './components';
import type { FollowerFx } from '@dontstarve-web/display';
import type { ItemEntity, ItemRuntimeComponent } from '@dontstarve-web/inventory';
import type { EquipmentOwner } from '@dontstarve-web/signals';
import type { ActionDescription } from '@dontstarve-web/stategraphs';
import type * as THREE from 'three';
import { Weapon } from '../../componets/src/weapon';
import { AXE_USES, configureAxeEntity, axeVisual } from './axe';
import { BUGNET_USES, configureBugNetEntity, bugnetVisual } from './bugnet';
import { configureFishingRodEntity, createFishingRodLifecycle, FISHINGROD_USES, fishingRodVisual } from './fishingrod';
import { Equippable } from '../../componets/src/equippable';
import {
  wornOwner,
  type EquipmentAnimState,
  type EquipmentSprite,
  type EquipmentVisual,
  type EquipmentVisualFactory,
  type HeldEquipFunctions,
} from './equipmentVisual';
import { configureFarmHoeEntity, createFarmTillerLifecycle, farmHoeVisual } from './farm_hoe';
import { configureHammerEntity, HAMMER_USES, hammerVisual } from './hammer';
import { configureLanternEntity, createLanternHandLifecycle, LANTERN_FUEL, lanternVisual } from './lantern';
import { configureNightswordEntity, nightswordVisual } from './nightsword';
import { configurePickaxeEntity, PICKAXE_USES, pickaxeVisual } from './pickaxe';
import { GOLDENTOOLFACTOR, WILSON_ATTACK } from './handTool';
import { configurePitchforkEntity, createTerraformerLifecycle, pitchforkVisual } from './pitchfork';
import type { PlayerCarryItem } from './player_common';
import type { PrefabInstance } from './prefabInstance';
import { configureReskinToolEntity, createReskinToolLifecycle, reskinToolVisual } from './reskin_tool';
import { configureShovelEntity, shovelVisual, SHOVEL_USES } from './shovel';
import { configureTorchEntity, createTorchHandLifecycle, onattack as torchOnAttack, torchVisual } from './torch';
import { getTridentController, tridentVisual, TRIDENT_DAMAGE, TRIDENT_USES, type TridentWorld } from './trident';
import {
  configureIceStaffEntity,
  iceStaffLifecycle,
  iceStaffVisual,
  ICESTAFF_TAGS,
  ICESTAFF_USES,
  type IceStaffWorld,
  configureOrangeStaffEntity,
  orangeStaffLifecycle,
  orangeStaffVisual,
  ORANGESTAFF_USES,
  CANE_SPEED_MULT,
  configureTeleStaffEntity,
  FIRESTAFF_TAGS,
  FIRESTAFF_USES,
  fireStaffVisual,
  configureFireStaffEntity,
  configureGreenStaffEntity,
  configureLightStaffEntity,
  GREENSTAFF_USES,
  TELESTAFF_USES,
  teleStaffVisual,
  yellowstaffVisual,
  type FireStaffWorld,
  type GreenStaffWorld,
  type LightStaffWorld,
  type TeleStaffWorld,
} from './staff';

/** Golden tools' saved uses move in 1 / GOLDENTOOLFACTOR steps. */
const GOLDEN_USE_STEP = 1 / GOLDENTOOLFACTOR;

/** TheWorld's services hand items use, bound to their registry (ItemEntityRegistry.bindEquipmentWorld). */
export interface HandEquipmentWorld {
  lightStaffWorld?: LightStaffWorld;
  greenStaffWorld?: GreenStaffWorld;
  fireStaffWorld?: FireStaffWorld;
  /** SpawnPrefab("ice_projectile") for the ice staff's weapon. */
  iceStaffWorld?: IceStaffWorld;
  /** TheWorld's map and fx for blinkstaff.lua. */
  blinkStaffWorld?: import('../../componets/src/blinkstaff').BlinkStaffWorld;
  /** TheWorld as staff.lua's teleport reads it, at the cast. */
  teleStaffWorld?: TeleStaffWorld;
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
  followSymbol?(
    symbol: string,
    offsetX: number,
    offsetY: number,
    fx?: FollowerFx,
  ): { node: THREE.Object3D; remove(): void };
  /** The holder's sprite: the held item declares its art in a slot of its own there. */
  sprite?: EquipmentSprite;
}
export interface HandEquipmentDefinition {
  /** Item spec metadata the inventory and save validation read before an inst exists; the prefab's fn sets the component. */
  readonly maxUses?: number;
  readonly useStep?: number;
  readonly maxFuel?: number;
  /** The prefab's weapon component: SetDamage and attackwear, for a prefab whose configureEntity does not add it. */
  readonly weapon?: { readonly damage: number; readonly attackwear?: number; readonly onattack?: Weapon['onattack'] };
  /** equippable.walkspeedmult. */
  readonly walkspeedmult?: number;
  /** Source tags read by SGwilson's attack branches ("light", "nopunch"). */
  readonly tags?: readonly string[];
  configureEntity?(entity: ItemEntity): void;
  readonly handAction?: ActionDescription;
  readonly visual: EquipmentVisualFactory;
  /** `context.AnimState` is the item's own slot on the holder, the owner.AnimState its equip functions write. */
  createLifecycle?(
    entity: ItemEntity,
    context: HandEquipmentContext & { AnimState?: EquipmentAnimState['AnimState'] },
  ): HeldEquipFunctions | undefined;
}

/** Source hand prefabs declare their presentation and equip lifecycle together. */
const definitions: Record<PlayerCarryItem, HandEquipmentDefinition> = {
  torch: {
    visual: torchVisual,
    weapon: { damage: WILSON_ATTACK * 0.5, onattack: torchOnAttack },
    configureEntity: configureTorchEntity,
    createLifecycle: createTorchHandLifecycle,
  },
  lantern: {
    visual: lanternVisual,
    tags: ['light'],
    maxFuel: LANTERN_FUEL,
    configureEntity: configureLanternEntity,
    createLifecycle: createLanternHandLifecycle,
  },
  yellowstaff: { visual: yellowstaffVisual, tags: ['nopunch'], configureEntity: configureLightStaffEntity },
  opalstaff: { visual: yellowstaffVisual, tags: ['nopunch'], configureEntity: configureLightStaffEntity },
  // staff.lua green(): its spellcaster is configured at spawn and reads TheWorld's loot spawn at the cast.
  greenstaff: {
    visual: yellowstaffVisual,
    tags: ['nopunch'],
    maxUses: GREENSTAFF_USES,
    configureEntity: configureGreenStaffEntity,
  },
  // staff.lua red(): its weapon (damage 0, the projectile only lights) is configured at spawn; ranged lighter tags.
  firestaff: {
    visual: fireStaffVisual,
    maxUses: FIRESTAFF_USES,
    tags: FIRESTAFF_TAGS,
    configureEntity: configureFireStaffEntity,
  },
  // staff.lua purple(): its spellcaster is configured at spawn, as casting from the inventory needs it unequipped too.
  telestaff: {
    visual: teleStaffVisual,
    tags: ['nopunch'],
    maxUses: TELESTAFF_USES,
    configureEntity: configureTeleStaffEntity,
  },
  // staff.lua blue_common("blue", 1): weapon damage 0, ICESTAFF_USES, a projectile that adds coldness.
  icestaff: {
    visual: iceStaffVisual,
    maxUses: ICESTAFF_USES,
    tags: ICESTAFF_TAGS,
    weapon: { damage: 0 },
    configureEntity: configureIceStaffEntity,
    createLifecycle: (entity, context) =>
      context.iceStaffWorld ? iceStaffLifecycle(entity, context.iceStaffWorld) : undefined,
  },
  // staff.lua orange(): a cane (CANE_DAMAGE, CANE_SPEED_MULT) that blinks to the point it is cast at.
  orangestaff: {
    visual: orangeStaffVisual,
    maxUses: ORANGESTAFF_USES,
    walkspeedmult: CANE_SPEED_MULT,
    configureEntity: configureOrangeStaffEntity,
    createLifecycle: (entity, context) =>
      context.blinkStaffWorld ? orangeStaffLifecycle(entity, context.blinkStaffWorld) : undefined,
  },
  // trident.lua: TRIDENT.DAMAGE over ground (OCEAN_DAMAGE applies only while the wielder stands on a boat or the sea).
  trident: {
    visual: tridentVisual,
    maxUses: TRIDENT_USES,
    tags: ['pointy', 'sharp'],
    weapon: { damage: TRIDENT_DAMAGE },
    createLifecycle: (entity, context) =>
      context.tridentWorld ? getTridentController(entity, context.tridentWorld) : undefined,
  },
  // Hand tools: configureEntity is the source prefab's fn (tags, weapon, tool, finiteuses).
  bugnet: { visual: bugnetVisual, maxUses: BUGNET_USES, configureEntity: configureBugNetEntity },
  fishingrod: {
    visual: fishingRodVisual,
    maxUses: FISHINGROD_USES,
    configureEntity: configureFishingRodEntity,
    createLifecycle: (entity, context) =>
      context.fishingWorld ? createFishingRodLifecycle(entity, context.fishingWorld) : undefined,
  },
  hammer: { visual: hammerVisual, maxUses: HAMMER_USES, configureEntity: configureHammerEntity },
  // nightsword.lua: NIGHTSWORD_DAMAGE = wilson_attack * 2, NIGHTSWORD_USES = 100.
  nightsword: {
    visual: nightswordVisual,
    maxUses: 100,
    tags: ['shadow', 'sharp'],
    weapon: { damage: WILSON_ATTACK * 2 },
    configureEntity: configureNightswordEntity,
  },
  reskin_tool: {
    visual: reskinToolVisual,
    tags: ['nopunch'],
    configureEntity: configureReskinToolEntity,
    createLifecycle: (entity, context) => createReskinToolLifecycle(entity, context.reskinEffects),
  },
  pickaxe: { visual: pickaxeVisual, maxUses: PICKAXE_USES, configureEntity: configurePickaxeEntity },
  goldenpickaxe: {
    visual: pickaxeVisual,
    maxUses: PICKAXE_USES,
    useStep: GOLDEN_USE_STEP,
    configureEntity: configurePickaxeEntity,
  },
  axe: { visual: axeVisual, maxUses: AXE_USES, configureEntity: configureAxeEntity },
  goldenaxe: { visual: axeVisual, maxUses: AXE_USES, useStep: GOLDEN_USE_STEP, configureEntity: configureAxeEntity },
  moonglassaxe: { visual: axeVisual, maxUses: AXE_USES, configureEntity: configureAxeEntity },
  pitchfork: {
    visual: pitchforkVisual,
    configureEntity: configurePitchforkEntity,
    createLifecycle: (entity, context) =>
      context.terraformMap ? createTerraformerLifecycle(entity, context.terraformMap) : undefined,
  },
  goldenpitchfork: {
    visual: pitchforkVisual,
    configureEntity: configurePitchforkEntity,
    createLifecycle: (entity, context) =>
      context.terraformMap ? createTerraformerLifecycle(entity, context.terraformMap) : undefined,
  },
  farm_hoe: {
    visual: farmHoeVisual,
    configureEntity: configureFarmHoeEntity,
    createLifecycle: (entity, context) =>
      context.farmTillMap ? createFarmTillerLifecycle(entity, context.farmTillMap) : undefined,
  },
  golden_farm_hoe: {
    visual: farmHoeVisual,
    configureEntity: configureFarmHoeEntity,
    createLifecycle: (entity, context) =>
      context.farmTillMap ? createFarmTillerLifecycle(entity, context.farmTillMap) : undefined,
  },
  shovel: { visual: shovelVisual, maxUses: SHOVEL_USES, configureEntity: configureShovelEntity },
  goldenshovel: {
    visual: shovelVisual,
    maxUses: SHOVEL_USES,
    useStep: GOLDEN_USE_STEP,
    configureEntity: configureShovelEntity,
  },
};
const isCarryItem = (itemId: string): itemId is PlayerCarryItem => Object.hasOwn(definitions, itemId);

/** Prefab configuration for a hand inst: its own configureEntity, source tags, weapon and equippable onequip/onunequip. */
export function configureEquipmentEntity(entity: ItemEntity): void {
  const entry = getHandEquipmentDefinition(entity.prefab);
  if (!entry) {
    return;
  }
  const { definition } = entry;
  definition.configureEntity?.(entity);
  if (!entity.getComponent('handequipment')) {
    const held = entity.component('handequipment', () => new HeldEquipment(entity, definition));
    const equippable = addComponent(entity, 'equippable', Equippable<ItemEntity>, 'hand');
    if (definition.walkspeedmult !== undefined) {
      equippable.walkspeedmult = definition.walkspeedmult;
    }
    equippable.SetOnEquip((_inst, owner) => held.onequip(owner));
    equippable.SetOnUnequip(() => held.onunequip());
  }
  for (const tag of definition.tags ?? []) {
    entity.addTag(tag);
  }
  if (definition.weapon && !entity.components.weapon) {
    // weapon.lua adds the "weapon" tag; weapon:OnAttack wears finiteuses only when the inst has them.
    const weapon = addComponent(entity, 'weapon', Weapon, () =>
      definition.maxUses === undefined ? undefined : entity.components.finiteuses,
    );
    weapon.SetDamage(definition.weapon.damage);
    if (definition.weapon.attackwear !== undefined) {
      weapon.attackwear = definition.weapon.attackwear;
    }
    if (definition.weapon.onattack) {
      weapon.SetOnAttack(definition.weapon.onattack);
    }
    entity.addTag('weapon');
  }
}

export function getHandEquipmentDefinition(
  itemId: string,
): { carryItem: PlayerCarryItem; definition: HandEquipmentDefinition } | undefined {
  if (!isCarryItem(itemId)) {
    return undefined;
  }
  return { carryItem: itemId, definition: definitions[itemId] };
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
  constructor(inst: ItemEntity, definition: HandEquipmentDefinition) {
    this.inst = inst;
    this.definition = definition;
  }

  onequip(owner: EquipmentOwner): void {
    this.onunequip();
    const worn = wornOwner(owner),
      presentation = worn?.presentation;
    if (worn) {
      this.visual = this.definition.visual({ id: this.inst.id, prefab: this.inst.prefab, skinId: this.inst.skinId });
      this.visual.onequip(worn);
    }
    const world = this.inst.equipmentWorld as HandEquipmentWorld | undefined;
    this.domain = this.definition.createLifecycle?.(this.inst, {
      ...world,
      ...(presentation
        ? {
            lightParent: presentation.lightParent,
            followSymbol: presentation.followSymbol,
            soundPosition: presentation.soundPosition,
            sprite: presentation.sprite,
          }
        : {}),
      AnimState: worn?.AnimState,
    });
    this.domain?.onequip(owner);
  }

  onunequip(): void {
    this.domain?.onunequip();
    this.domain = undefined;
    this.visual?.onunequip();
    this.visual = undefined;
  }

  /** Settles the held item's consumption before a save or transfer reads it. */
  flush(): void {
    this.domain?.flush?.();
  }
  dispose(): void {
    this.onunequip();
  }
}
