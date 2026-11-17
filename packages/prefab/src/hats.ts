import { addComponent } from './components';
import type { AnimStateArt } from '@dontstarve-web/animation/animState';
import type { HatArtDefinition, HatEquipMode } from '@dontstarve-web/animation/hatAssets';
import { SpriteResources } from '@dontstarve-web/display';
import type { ItemEntity, ItemRuntimeComponent, InventoryItemSpec, InventoryRecipeDefinition, InventorySkinSpec } from '@dontstarve-web/inventory';
import type { EquipmentOwner } from '@dontstarve-web/signals';
import { Equippable } from '../../componets/src/equippable';
import { createMemo, createSignal, readonlySignal, watchSignal, type Memo, type ReadonlySignal } from '@dontstarve-web/signals';
import type { ItemPrefabWorld } from './groundPrefab';
import { bindItemWorld, type ItemPrefabDefinition } from './groundItems';
import catalog from './hats.json' with { type: 'json' };
import type { PrefabInstance } from './prefabInstance';
import { AlterguardianHatEquipped } from './alterguardian_hat_equipped';
import { spawnLightEntity, type PrefabLocalLight } from './localLight';
import { TILE_SIZE } from './tile';
import { ARMOR_DREADSTONEHAT, DREADSTONEHAT_ID, configureDreadstoneHatEntity, dreadstone_onequip, dreadstone_onunequip } from './dreadstonehat';

export type { HatEquipMode };

export interface HatDefinition extends HatArtDefinition {
  readonly name: string;
  readonly icon: string;
  readonly atlas: string;
  readonly archive: string;
  readonly equip: {
    readonly mode: HatEquipMode;
    readonly symbol: string;
    readonly activated?: {
      readonly archive: string;
      readonly symbol: string;
      readonly sanityThreshold: number;
      readonly light: PrefabLocalLight;
    };
    readonly follow?: {
      readonly animation: string;
      readonly symbols?: readonly string[];
      readonly extraBuilds?: readonly string[];
    };
  };
  readonly skinArchives: Readonly<Record<string, string>>;
  readonly skinEquipModes: Readonly<Record<string, HatEquipMode>>;
}

/** A catalog entry as JSON types it: equip modes are plain strings until they are checked. */
type HatActivation = NonNullable<HatDefinition['equip']['activated']>;
type HatCatalogEntry = Omit<HatDefinition, 'equip' | 'skinEquipModes'> & {
  readonly equip: Omit<HatDefinition['equip'], 'mode' | 'activated'> & {
    readonly mode: string;
    readonly activated?: Omit<HatActivation, 'light'> & { readonly light: Omit<PrefabLocalLight, 'colour'> & { readonly colour: readonly number[] } };
  };
  readonly skinEquipModes: Readonly<Record<string, string>>;
};
function rgb(hat: string, colour: readonly number[]): PrefabLocalLight['colour'] {
  if (colour.length !== 3) throw new Error(`${hat}: light colour needs three channels`);
  const [r, g, b] = colour;
  return [r, g, b];
}
const HAT_EQUIP_MODES: readonly HatEquipMode[] = ['normal', 'opentop', 'fullhelm'];
const isHatEquipMode = (mode: string): mode is HatEquipMode => HAT_EQUIP_MODES.some(known => known === mode);
function hatEquipMode(hat: string, mode: string): HatEquipMode {
  if (!isHatEquipMode(mode)) throw new Error(`${hat}: unknown equip mode ${mode}`);
  return mode;
}
const CATALOG_HATS: Readonly<Record<string, HatCatalogEntry>> = catalog.hats;
export const HAT_DEFINITIONS: Readonly<Record<string, HatDefinition>> = Object.fromEntries(
  Object.entries(CATALOG_HATS).map(([id, { equip: { mode, activated, ...equip }, skinEquipModes, ...hat }]) => [id, {
    ...hat,
    equip: {
      ...equip,
      mode: hatEquipMode(id, mode),
      ...activated ? { activated: { ...activated, light: { ...activated.light, colour: rgb(id, activated.light.colour) } } } : {},
    },
    skinEquipModes: Object.fromEntries(Object.entries(skinEquipModes).map(([skin, skinMode]) => [skin, hatEquipMode(`${id} ${skin}`, skinMode)])),
  }]));
export const HAT_IDS: readonly string[] = Object.keys(HAT_DEFINITIONS);
export function isHatId(itemId: string): boolean {
  return Object.hasOwn(HAT_DEFINITIONS, itemId);
}

export const HAT_ITEM_SPECS: Readonly<Record<string, InventoryItemSpec>> = Object.fromEntries(
  Object.entries(HAT_DEFINITIONS).map(([id, hat]) => [id, {
    name: hat.name, icon: hat.icon, atlas: hat.atlas, maxStack: 1, equippable: 'head',
    configureEntity: configureHatEntity,
    ...(id === DREADSTONEHAT_ID ? { maxArmor: ARMOR_DREADSTONEHAT } : {}),
  }]),
);

export const HAT_SKIN_SPECS: Readonly<Record<string, InventorySkinSpec>> = catalog.skinSpecs;

/** Original requirements, including technology and character/skill restrictions. */
export const HAT_CRAFTING_DEFINITIONS = catalog.recipes;

export const HAT_RECIPES: Readonly<Record<string, InventoryRecipeDefinition>> = Object.fromEntries(
  HAT_CRAFTING_DEFINITIONS.flatMap((source) => {
    const ingredients: Record<string, number> = {};
    const requiredItems: string[] = [];
    for (const ingredient of source.ingredients) {
      // Character resources (balloonhat's sanity) have no inventory-slot equivalent.
      if (typeof ingredient.type !== 'string' || typeof ingredient.amount !== 'number'
        || !Number.isSafeInteger(ingredient.amount) || ingredient.amount < 0) return [];
      if (ingredient.amount === 0) requiredItems.push(ingredient.type);
      else ingredients[ingredient.type] = (ingredients[ingredient.type] ?? 0) + ingredient.amount;
    }
    const config = source.config as { product?: string; numtogive?: number };
    return [[source.name, {
      recipeId: source.name, productId: config.product ?? source.name,
      productCount: config.numtogive ?? 1, ingredients, buffered: false,
      ...(requiredItems.length ? { requiredItems } : {}),
    }]];
  }),
);

/**
 * One owner per player of the shared archive art of the entities worn hats spawn (alterguardian_hat_equipped); their
 * displays load it when such an entity is drawn, and the owner removes those entities before releasing it.
 */
export class HatEquipmentAssets {
  readonly sprites: SpriteResources;
  constructor(assetBaseUrl: string) { this.sprites = new SpriteResources(assetBaseUrl); }
  dispose(): void { this.sprites.dispose(); }
}

export interface HatActivationOptions {
  readonly assets: HatEquipmentAssets;
  readonly sanityPercent?: ReadonlySignal<number>;
  /** The owner's art source, where the layers' display loads the skin build they name. */
  readonly art?: AnimStateArt;
  /** The worn swap_hat is hidden while the layers show and until the 8-frame restore. */
  onSwapHatHidden?(hidden: boolean): void;
}

/** hats.lua alterguardian_activate / alterguardian_deactivate: the two alterguardian_hat_equipped layers and the light. */
export class HatActivationController {
  private readonly owner: PrefabInstance;
  private readonly options: HatActivationOptions;
  private removeLight: (() => void) | null = null;
  private readonly hat = createSignal<{ readonly definition: HatDefinition; readonly skinId?: string } | null>(null);
  /** Derived from the equipped hat's threshold and the owner's sanity ratio (hats.lua's 85% boundary). */
  readonly activated: ReadonlySignal<boolean>;
  private readonly activatedMemo: Memo<boolean>;
  private readonly stopActivated: () => void;
  private stopSanity?: () => void;
  private readonly active = createSignal(false);
  private front: AlterguardianHatEquipped | undefined;
  private back: AlterguardianHatEquipped | undefined;
  /** Seconds since deactivation, until the 8-frame task restores the swap_hat. */
  private readonly restoring = createSignal<number | undefined>(undefined);
  private readonly hiddenMemo = createMemo(() => this.active.get() || this.restoring.get() !== undefined);
  private readonly stopHidden: () => void;

  constructor(owner: PrefabInstance, options: HatActivationOptions) {
    this.owner = owner;
    this.options = options;
    const sanity = options.sanityPercent && watchSignal(options.sanityPercent, stop => { this.stopSanity = stop; });
    this.activatedMemo = createMemo(() => {
      const percent = sanity?.get() ?? 1;
      const config = this.hat.get()?.definition.equip.activated;
      return !!config && percent > config.sanityThreshold;
    });
    this.activated = readonlySignal(this.activatedMemo);
    this.stopActivated = this.activatedMemo.subscribe(active => this.apply(active));
    this.stopHidden = this.hiddenMemo.subscribe(hidden => this.options.onSwapHatHidden?.(hidden));
  }

  /** The swap_hat is redrawn each frame until it is restored. */
  get isAnimating(): boolean { return this.restoring.peek() !== undefined; }
  get hidesSwapHat(): boolean { return this.hiddenMemo.peek(); }
  /** The layers currently following the owner; a deactivated pair plays out on its own. */
  get layers(): { readonly front?: AlterguardianHatEquipped; readonly back?: AlterguardianHatEquipped } {
    return { front: this.front, back: this.back };
  }

  setHat(hat: { readonly definition: HatDefinition; readonly skinId?: string } | null): void {
    this.removeAll();
    this.hat.set(hat);
    this.apply(this.activatedMemo.peek());
  }

  dispose(): void {
    this.stopActivated();
    if (this.stopSanity) this.stopSanity();
    else this.activatedMemo.dispose();
    this.removeAll();
    this.stopHidden();
    this.hiddenMemo.dispose();
  }

  update(dt: number): void {
    const restoring = this.restoring.peek();
    if (restoring === undefined) return;
    this.restoring.set(restoring + dt >= 8 / 30 ? undefined : restoring + dt);
  }

  /** The swap_hat stays hidden across the switch: active turns on before a pending restore ends, and off after one starts. */
  private apply(active: boolean): void {
    if (active === this.active.peek()) return;
    if (active) { this.active.set(true); this.activate(); } else { this.deactivate(); this.active.set(false); }
  }

  private activate(): void {
    const { definition, skinId } = this.hat.peek()!;
    const config = definition.equip.activated!;
    const owner = this.owner;
    this.restoring.set(undefined);
    const skin = skinId === undefined ? undefined : definition.skinArchives[skinId];
    const art = { archive: config.archive, sprites: this.options.assets.sprites,
      ...skin && this.options.art ? { skin: { archive: skin, art: this.options.art } } : {} };
    for (const isFront of [true, false]) {
      const fx = new AlterguardianHatEquipped(art, owner);
      fx.OnActivated(isFront);
      fx.SetSkin();
      if (isFront) this.front = fx; else this.back = fx;
    }
    // alterguardianhatlight is parented to the owner.
    const light = spawnLightEntity('alterguardianhatlight', this.owner);
    light.instance.light.set({ ...config.light, radius: config.light.radius * (TILE_SIZE / 4) });
    this.removeLight = light.remove;
  }

  private deactivate(): void {
    this.removeLight?.(); this.removeLight = null;
    if (this.front) this.restoring.set(0);
    this.front?.OnDeactivated(); this.front = undefined;
    this.back?.OnDeactivated(); this.back = undefined;
  }

  /** alterguardian_onunequip: the light and both layers go at once. */
  private removeAll(): void {
    this.restoring.set(undefined);
    this.active.set(false);
    this.removeLight?.(); this.removeLight = null;
    this.front?.Remove(); this.front = undefined;
    this.back?.Remove(); this.back = undefined;
  }
}

/** hats.lua's rabbit custom_init: the ground rabbit is rabbit_build, with the hat's own build as its override build. */
const RABBITHAT_GROUND = { build: 'rabbit_build.zip', overrideBuild: 'hat_rabbit' } as const;

/**
 * hats.lua's simple(): SetBank(name.."hat") / SetBuild("hat_"..name) / PlayAnimation("anim"), independently of
 * swap_hat. Each hat is an item entity drawn by its display from the hat's shared archive, in the shared batches.
 */
export function hatPrefabs(world: ItemPrefabWorld): Record<string, ItemPrefabDefinition> {
  return Object.fromEntries(Object.entries(HAT_DEFINITIONS).map(([id, hat]) => {
    const rabbit = id === 'rabbithat';
    // The rabbit's AddOverrideBuild("hat_rabbit") is drawn before its SetBuild("rabbit_build").
    const buildArchives = rabbit ? [`${RABBITHAT_GROUND.overrideBuild}.zip`, RABBITHAT_GROUND.build] : [hat.archive];
    const definition: ItemPrefabDefinition = {
      // The rabbit's animqueueover restarts its ground idle; other hats rest on anim's last frame.
      fn: () => {
        const inst = world.newItem(id);
        inst.sprite.resetPresentation({ name: 'anim', held: !rabbit, billboard: true });
        bindItemWorld(inst, world);
        return inst;
      },
      assets: { animationArchive: hat.archive, buildArchives, bank: id },
      assetOptions: { instancedAnimations: 'all' },
      ...Object.keys(hat.skinArchives).length ? { skins: hat.skinArchives } : {},
      onSpawned: inst => world.configureItem(inst),
    };
    return [id, definition];
  }));
}


import { skinArchive, wornOwner, type EquipmentPresentation, type EquipmentVisual, type EquipmentVisualItem, type EquipmentArtOwner } from './equipmentVisual';

/** hats.lua simple(): the head equippable and its onequip/onunequip; dreadstone's wrap them as fns.dreadstone does. */
export function configureHatEntity(entity: ItemEntity): void {
  if (entity.prefab === DREADSTONEHAT_ID) configureDreadstoneHatEntity(entity);
  if (entity.getComponent('hat')) return;
  const hat = entity.component('hat', () => new WornHat(entity));
  const equippable = addComponent(entity, 'equippable', Equippable<ItemEntity>, 'head');
  equippable.SetOnEquip((_inst, owner) => hat.onequip(owner));
  equippable.SetOnUnequip(() => hat.onunequip());
}

/** The hat's equip functions for one equip: its art on the owner's AnimState, then dreadstone's regeneration. */
class WornHat implements ItemRuntimeComponent {
  private readonly inst: ItemEntity;
  private visual?: EquipmentVisual;
  constructor(inst: ItemEntity) { this.inst = inst; }
  onequip(owner: EquipmentOwner): void {
    this.onunequip();
    const worn = wornOwner(owner);
    if (worn) {
      this.visual = hatVisual({ id: this.inst.id, prefab: this.inst.prefab, skinId: this.inst.skinId }, worn.presentation);
      this.visual.onequip(worn);
    }
    if (this.inst.prefab === DREADSTONEHAT_ID) dreadstone_onequip(this.inst, owner);
  }
  onunequip(): void {
    if (this.inst.prefab === DREADSTONEHAT_ID) dreadstone_onunequip(this.inst);
    this.visual?.onunequip(); this.visual = undefined;
  }
  dispose(): void { this.onunequip(); }
}

/** hats.lua's simple/opentop/fullhelm equip branches and their owned follower FX; builds are named for the owner's display. */
export function hatVisual(item: EquipmentVisualItem, context: Pick<EquipmentPresentation, 'assets' | 'hats' | 'lightParent' | 'sanityPercent'>): EquipmentVisual {
  const definition = Object.hasOwn(HAT_DEFINITIONS, item.prefab) ? HAT_DEFINITIONS[item.prefab] : undefined;
  if (!definition) throw new Error(`Unknown hat: ${item.prefab}`);
  const skin = skinArchive(item.prefab, definition.skinArchives, item.skinId);
  const mode = (item.skinId !== undefined ? definition.skinEquipModes[item.skinId] : undefined) ?? definition.equip.mode;
  const symbol = mode === 'fullhelm' ? 'headbase_hat' : 'swap_hat';
  const follow = definition.equip.follow;
  const builds = [...skin ? [skin] : [], definition.archive, ...follow?.extraBuilds ?? []];
  let owner: EquipmentArtOwner | undefined;
  const stops: (() => void)[] = [];
  let activation: HatActivationController | undefined;
  return {
    onequip(equipper) {
      owner = equipper;
      const anim = owner.AnimState;
      if (item.skinId) {
        owner.PushEvent('equipskinneditem', item.skinId);
        anim.OverrideItemSkinSymbol(symbol, builds, definition.equip.symbol, item.id);
      } else anim.OverrideSymbol(symbol, builds, definition.equip.symbol);
      if (mode !== 'fullhelm') anim.ClearOverrideSymbol('headbase_hat');
      for (const layer of ['HAT', 'HAIR_HAT', 'HAIR_NOHAT', 'HAIR', 'HEAD', 'HEAD_HAT', 'HEAD_HAT_NOHELM', 'HEAD_HAT_HELM']) {
        const visible = layer === 'HAT' ? mode !== 'fullhelm'
          : layer === 'HAIR_HAT' ? mode === 'normal'
          : layer === 'HAIR_NOHAT' || layer === 'HAIR' || layer === 'HEAD' ? mode === 'opentop'
          : layer === 'HEAD_HAT' ? mode !== 'opentop'
          : layer === 'HEAD_HAT_NOHELM' ? mode === 'normal' : mode === 'fullhelm';
        if (visible) anim.Show(layer); else anim.Hide(layer);
      }
      if (mode === 'fullhelm') for (const name of ['face', 'swap_face', 'beard', 'cheeks']) anim.HideSymbol(name);
      // The hat's own animation follows the symbol, drawn from its bank by the owner's display.
      if (follow) stops.push(anim.FollowSymbolAnimation(symbol, { bank: definition.archive, animation: follow.animation, builds, symbols: follow.symbols }));
      if (definition.equip.activated) {
        const current = activation = new HatActivationController(context.lightParent, {
          assets: context.hats, sanityPercent: context.sanityPercent, art: context.assets,
          onSwapHatHidden: hidden => { if (hidden) anim.HideSymbol(symbol); else anim.ShowSymbol(symbol); },
        });
        current.setHat({ definition, skinId: item.skinId });
        stops.push(anim.AddAttachment({ get isAnimating() { return current.isAnimating; }, update(dt) { current.update(dt); } }));
      }
    },
    onunequip() {
      if (!owner) return;
      for (const stop of stops) stop();
      stops.length = 0;
      activation?.dispose(); activation = undefined;
      const anim = owner.AnimState;
      if (item.skinId) owner.PushEvent('unequipskinneditem', item.skinId);
      anim.ClearOverrideSymbol('headbase_hat');
      anim.ClearOverrideSymbol('swap_hat');
      for (const layer of ['HAT', 'HAIR_HAT', 'HEAD_HAT', 'HEAD_HAT_NOHELM', 'HEAD_HAT_HELM']) anim.Hide(layer);
      for (const layer of ['HAIR_NOHAT', 'HAIR', 'HEAD']) anim.Show(layer);
      if (mode === 'fullhelm') for (const name of ['face', 'swap_face', 'beard', 'cheeks']) anim.ShowSymbol(name);
      owner = undefined;
    },
  };
}
