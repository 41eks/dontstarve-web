import type { AnimStateArt } from '@dontstarve-web/animation/animState';
import { HatArtAssets, type HatArtDefinition, type HatEquipMode } from '@dontstarve-web/animation/hatAssets';
import {
  createAnimatedSpriteSource, type AnimatedSpriteFactory, type AnimatedSpriteSourceOptions,
} from '@dontstarve-web/animation/sprite';
import type { InventoryItemSpec, InventoryRecipeDefinition, InventorySkinSpec } from '@dontstarve-web/inventory';
import { createMemo, createSignal, readonlySignal, watchSignal, type Memo, type ReadonlySignal } from '@dontstarve-web/signals';
import * as THREE from 'three';
import type { GroundItemFactory, GroundPrefabContext } from './groundPrefab';
import catalog from './hats.json' with { type: 'json' };
import { bindResidentGroundItem } from './groundItemLifecycle';
import { createPrefabEntity, type PrefabInstance } from './prefabInstance';
import { AlterguardianHatEquipped } from './alterguardian_hat_equipped';
import { spawnLightEntity, type PrefabLocalLight } from './localLight';
import { TILE_SIZE } from './tile';
import { ARMOR_DREADSTONEHAT, DREADSTONEHAT_ID, configureDreadstoneHatEntity } from './dreadstonehat';

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

export const HAT_DEFINITIONS: Readonly<Record<string, HatDefinition>> = catalog.hats as unknown as
  Readonly<Record<string, HatDefinition>>;
export const HAT_IDS: readonly string[] = Object.keys(HAT_DEFINITIONS);
export function isHatId(itemId: string): boolean {
  return Object.hasOwn(HAT_DEFINITIONS, itemId);
}

export const HAT_ITEM_SPECS: Readonly<Record<string, InventoryItemSpec>> = Object.fromEntries(
  Object.entries(HAT_DEFINITIONS).map(([id, hat]) => [id, {
    name: hat.name, icon: hat.icon, atlas: hat.atlas, maxStack: 1, equippable: 'head',
    ...(id === DREADSTONEHAT_ID ? { maxArmor: ARMOR_DREADSTONEHAT, configureEntity: configureDreadstoneHatEntity } : {}),
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

/** One cache per player: the sprite sources of the entities worn hats spawn. */
export class HatEquipmentAssets extends HatArtAssets {}

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
  private active = false;
  private hidden = false;
  private front: AlterguardianHatEquipped | undefined;
  private back: AlterguardianHatEquipped | undefined;
  /** Seconds since deactivation, until the 8-frame task restores the swap_hat. */
  private restoring: number | undefined;

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
  }

  /** The swap_hat is redrawn each frame until it is restored. */
  get isAnimating(): boolean { return this.restoring !== undefined; }
  get hidesSwapHat(): boolean { return this.active || this.restoring !== undefined; }
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
  }

  update(dt: number): void {
    if (this.restoring === undefined) return;
    this.restoring += dt;
    if (this.restoring >= 8 / 30) this.restoring = undefined;
    this.syncHidden();
  }

  private syncHidden(): void {
    if (this.hidesSwapHat === this.hidden) return;
    this.hidden = this.hidesSwapHat;
    this.options.onSwapHatHidden?.(this.hidden);
  }

  private apply(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (active) this.activate(); else this.deactivate();
    this.syncHidden();
  }

  private activate(): void {
    const { definition, skinId } = this.hat.peek()!;
    const config = definition.equip.activated!;
    const owner = this.owner;
    this.restoring = undefined;
    const skin = skinId === undefined ? undefined : definition.skinArchives[skinId];
    const assets = this.options.assets;
    const art = { archive: config.archive, peekFactory: (archive: string) => assets.peekFactory(archive), loadFactory: (archive: string) => assets.loadFactory(archive),
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
    if (this.front) this.restoring = 0;
    this.front?.OnDeactivated(); this.front = undefined;
    this.back?.OnDeactivated(); this.back = undefined;
  }

  /** alterguardian_onunequip: the light and both layers go at once. */
  private removeAll(): void {
    this.active = false;
    this.restoring = undefined;
    this.removeLight?.(); this.removeLight = null;
    this.front?.Remove(); this.front = undefined;
    this.back?.Remove(); this.back = undefined;
    this.syncHidden();
  }
}

/** hats.lua's rabbit custom_init: the ground rabbit is rabbit_build, with the hat's own build as its override build. */
const RABBITHAT_GROUND = { build: 'rabbit_build.zip', overrideBuild: 'hat_rabbit' } as const;

/**
 * hats.lua's simple(): SetBank(name.."hat") / SetBuild("hat_"..name) / PlayAnimation("anim"), independently of
 * swap_hat. Each hat is an item entity drawn by its display; sources are shared per archive and skin.
 */
export function createHatGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  const sources = new Map<string, Promise<AnimatedSpriteFactory>>();
  const loaded = new Map<string, AnimatedSpriteFactory>();
  const source = (archive: string, options: AnimatedSpriteSourceOptions) => {
    const key = JSON.stringify([archive, options.buildArchive, options.skinArchive]);
    let request = sources.get(key);
    if (!request) {
      request = createAnimatedSpriteSource(context.animationBaseUrl, archive, options);
      void request.then(factory => loaded.set(key, factory), () => sources.delete(key));
      sources.set(key, request);
    }
    return { peek: () => loaded.get(key), load: () => request };
  };
  return {
    itemIds: Object.keys(HAT_DEFINITIONS),
    create({ itemId, skinId }) {
      const hat = HAT_DEFINITIONS[itemId];
      const skinArchive = skinId === undefined ? undefined : hat.skinArchives[skinId];
      if (skinId !== undefined && !skinArchive) throw new Error(`Unknown skin ${skinId} for ${hat.archive}`);
      const rabbit = itemId === 'rabbithat';
      const art = source(hat.archive, rabbit
        ? { buildArchive: RABBITHAT_GROUND.build, overrideBuilds: { [RABBITHAT_GROUND.overrideBuild]: `${RABBITHAT_GROUND.overrideBuild}.zip` } }
        : {});
      const name = `GroundHat:${itemId}`;
      const draw = (factory: AnimatedSpriteFactory) => ({
        create: (animation: string, frame?: 'first' | 'last') => factory.create({ initialAnimation: animation, initialFrame: frame, name }),
        release: (sprite: THREE.Group) => factory.disposeSprite(sprite),
      });
      // The rabbit's animqueueover restarts its ground idle; other hats rest on anim's last frame. The display loads the source.
      const { instance, display } = createPrefabEntity(itemId, {
        peek: () => { const factory = art.peek(); return factory && draw(factory); },
        load: () => art.load().then(draw),
      }, { name: 'anim', held: !rabbit }, name, entity => {
        entity.skinId = skinId;
        entity.sprite.setSkinSource({ archives: hat.skinArchives, art: context.assets });
      });
      return bindResidentGroundItem(context, instance, display);
    },
    // The manager releases every hat entity first; only then can the atlases they drew from go.
    dispose() {
      for (const request of sources.values()) void request.then(factory => factory.dispose(), () => undefined);
      sources.clear(); loaded.clear();
    },
  };
}


import { skinArchive, wornEquipmentLifecycle, type EquipmentVisual, type EquipmentVisualContext, type EquipmentVisualItem, type EquipmentVisualOwner } from './equipmentVisual';

/** hats.lua's simple/opentop/fullhelm equip branches and their owned follower FX; builds are named for the owner's display. */
export function hatVisual(item: EquipmentVisualItem, context: Pick<EquipmentVisualContext, 'assets' | 'hats' | 'lightParent' | 'sanityPercent'>): EquipmentVisual {
  const definition = Object.hasOwn(HAT_DEFINITIONS, item.prefab) ? HAT_DEFINITIONS[item.prefab] : undefined;
  if (!definition) throw new Error(`Unknown hat: ${item.prefab}`);
  const skin = skinArchive(item.prefab, definition.skinArchives, item.skinId);
  const mode = (item.skinId !== undefined ? definition.skinEquipModes[item.skinId] : undefined) ?? definition.equip.mode;
  const symbol = mode === 'fullhelm' ? 'headbase_hat' : 'swap_hat';
  const follow = definition.equip.follow;
  const builds = [...skin ? [skin] : [], definition.archive, ...follow?.extraBuilds ?? []];
  let owner: EquipmentVisualOwner | undefined;
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

export function createHatEquipmentLifecycle(item: EquipmentVisualItem, context: EquipmentVisualContext) {
  return wornEquipmentLifecycle(hatVisual(item, context), context);
}
