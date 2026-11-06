import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { SpriteState } from '@dontstarve-web/display';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PlaySound, type SoundEventPath } from './sound';
import { PrefabEntityManager, PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';

interface FxDefinition {
  readonly archive: string;
  readonly bank: string;
  readonly anim: string;
  readonly sound?: SoundEventPath;
  readonly opacity?: number;
  readonly scale?: number;
  readonly tint?: readonly [number, number, number];
  /** AnimState:SetFinalOffset above the entity's layer: drawn a few depth steps towards the camera. */
  readonly finalOffset?: number;
  /** Frames between animover and Remove, as wortox_portal_fx.lua's DoTaskInTime(2 * FRAMES). */
  readonly lingerFrames?: number;
  readonly tags?: readonly string[];
}

/**
 * prefabs/fx.lua entries that play one animation at a world position, optionally play a sound and remove
 * themselves on animover. `opacity` is fx.lua's `tintalpha`.
 */
const FX_PREFABS = {
  // wortox_portal_fx.lua: wilson bank, wortox_portal build, animover + 2 FRAMES.
  wortox_portal_jumpin_fx: { archive: 'wortox_portal.zip', bank: 'wilson', anim: 'wortox_portal_jumpin', finalOffset: 3, lingerFrames: 2 },
  wortox_portal_jumpout_fx: { archive: 'wortox_portal.zip', bank: 'wilson', anim: 'wortox_portal_jumpout', finalOffset: 3, lingerFrames: 2 },
  fx_book_rain: { archive: 'fx_book_rain.zip', bank: 'fx_book_rain', anim: 'play_fx',
    sound: 'wickerbottom_rework/book_spells/rain' },
  fx_book_moon: { archive: 'fx_book_moon.zip', bank: 'fx_book_moon', anim: 'play_fx',
    sound: 'wickerbottom_rework/book_spells/moon' },
  // explode_small.lua MakeExplosion(): bank/build `explode`, clip `small`, blackpowder_explo sound.
  explode_small: { archive: 'explode.zip', bank: 'explode', anim: 'small', sound: 'dontstarve/common/blackpowder_explo' },
  // fx.lua crab_king_waterspout: bank Bubble_fx, build crab_king_bubble_fx, FinalOffset1.
  crab_king_waterspout: { archive: 'crab_king_bubble_fx.zip', bank: 'Bubble_fx', anim: 'waterspout',
    sound: 'hookline_2/creatures/boss/crabking/waterspout' },
  // fx.lua die_fx: bank die_fx, build die, clip small, deathpoof sound, brown mult colour.
  die_fx: { archive: 'die.zip', bank: 'die_fx', anim: 'small', sound: 'dontstarve/common/deathpoof',
    tint: [90 / 255, 66 / 255, 41 / 255] },
  // staff_projectile.lua OnHitFire → fx.lua fire_fail_fx: bank/build fire_fail_fx, clip fx, fireOut sound.
  fire_fail_fx: { archive: 'fire_fail_fx.zip', bank: 'fire_fail_fx', anim: 'fx', sound: 'dontstarve/common/fireOut' },
  // fx.lua lightning_rod_fx: bank/build lightning_rod_fx, clip idle.
  lightning_rod_fx: { archive: 'lightning_rod_fx.zip', bank: 'lightning_rod_fx', anim: 'idle' },
  // lightning.lua: bank/build lightning, clip anim, Transform:SetScale(2, 2, 2), thunder_close.
  lightning: { archive: 'lightning.zip', bank: 'lightning', anim: 'anim', sound: 'dontstarve/rain/thunder_close', scale: 2 },
  // fx.lua halloween_moonpuff: bank fx_moon_tea, build moon_tea_fx, clip puff, FinalOffset3, fireAddFuel (bloom is not rendered).
  halloween_moonpuff: { archive: 'moon_tea_fx.zip', bank: 'fx_moon_tea', anim: 'puff', sound: 'dontstarve/common/fireAddFuel', finalOffset: 3 },
  // fx.lua: what chopping a tree throws off.
  pine_needles_chop: { archive: 'pine_needles.zip', bank: 'pine_needles', anim: 'chop' },
  tree_petal_fx_chop: { archive: 'tree_petal_fx.zip', bank: 'tree_petal_fx', anim: 'chop' },
  green_leaves: { archive: 'tree_leaf_fx_green.zip', bank: 'tree_leaf_fx', anim: 'fall', sound: 'dontstarve_DLC001/fall/leaf_rustle' },
  green_leaves_chop: { archive: 'tree_leaf_fx_green.zip', bank: 'tree_leaf_fx', anim: 'chop', sound: 'dontstarve_DLC001/fall/leaf_rustle' },
  red_leaves: { archive: 'tree_leaf_fx_red.zip', bank: 'tree_leaf_fx', anim: 'fall', sound: 'dontstarve_DLC001/fall/leaf_rustle' },
  red_leaves_chop: { archive: 'tree_leaf_fx_red.zip', bank: 'tree_leaf_fx', anim: 'chop', sound: 'dontstarve_DLC001/fall/leaf_rustle' },
  orange_leaves: { archive: 'tree_leaf_fx_orange.zip', bank: 'tree_leaf_fx', anim: 'fall', sound: 'dontstarve_DLC001/fall/leaf_rustle' },
  orange_leaves_chop: { archive: 'tree_leaf_fx_orange.zip', bank: 'tree_leaf_fx', anim: 'chop', sound: 'dontstarve_DLC001/fall/leaf_rustle' },
  yellow_leaves: { archive: 'tree_leaf_fx_yellow.zip', bank: 'tree_leaf_fx', anim: 'fall', sound: 'dontstarve_DLC001/fall/leaf_rustle' },
  yellow_leaves_chop: { archive: 'tree_leaf_fx_yellow.zip', bank: 'tree_leaf_fx', anim: 'chop', sound: 'dontstarve_DLC001/fall/leaf_rustle' },
  sanity_raise: { archive: 'blocker_sanity_fx.zip', bank: 'blocker_sanity_fx', anim: 'raise', opacity: .5 },
  sanity_lower: { archive: 'blocker_sanity_fx.zip', bank: 'blocker_sanity_fx', anim: 'lower', opacity: .5 },
  // fx.lua crater_steam_fx1..4 / slow_steam_fx1..5 (hotspring.lua push_special_idle): bank = build, anim steam<N>, FinalOffset1.
  crater_steam_fx1: { archive: 'crater_steam.zip', bank: 'crater_steam', anim: 'steam1', finalOffset: 1 },
  crater_steam_fx2: { archive: 'crater_steam.zip', bank: 'crater_steam', anim: 'steam2', finalOffset: 1 },
  crater_steam_fx3: { archive: 'crater_steam.zip', bank: 'crater_steam', anim: 'steam3', finalOffset: 1 },
  crater_steam_fx4: { archive: 'crater_steam.zip', bank: 'crater_steam', anim: 'steam4', finalOffset: 1 },
  slow_steam_fx1: { archive: 'slow_steam.zip', bank: 'slow_steam', anim: 'steam1', finalOffset: 1 },
  slow_steam_fx2: { archive: 'slow_steam.zip', bank: 'slow_steam', anim: 'steam2', finalOffset: 1 },
  slow_steam_fx3: { archive: 'slow_steam.zip', bank: 'slow_steam', anim: 'steam3', finalOffset: 1 },
  slow_steam_fx4: { archive: 'slow_steam.zip', bank: 'slow_steam', anim: 'steam4', finalOffset: 1 },
  slow_steam_fx5: { archive: 'slow_steam.zip', bank: 'slow_steam', anim: 'steam5', finalOffset: 1 },
} as const satisfies Record<string, FxDefinition>;
export type WorldFxPrefab = keyof typeof FX_PREFABS;

/** structure_collapse_fx.lua: its sounds come from the material the spawner then sets. */
const COLLAPSE = { archive: 'structure_collapse_fx.zip', bank: 'collapse', finalOffset: 3, tags: ['NOCLICK'] };
const COLLAPSE_PREFABS = {
  collapse_small: { ...COLLAPSE, anim: 'collapse_small' },
  collapse_big: { ...COLLAPSE, anim: 'collapse_large' },
} as const satisfies Record<string, FxDefinition>;
type CollapsePrefab = keyof typeof COLLAPSE_PREFABS;
export type CollapseMaterial = 'wood' | 'metal' | 'stone' | 'rock' | 'straw' | 'pot';


const FRAMES = 1 / 30;

export function isWorldFx(prefab: string): prefab is WorldFxPrefab { return Object.hasOwn(FX_PREFABS, prefab); }

/** What these prefabs share with the rest of the scene. */
export interface WorldFxWorld { readonly scheduler: GameTimeScheduler }

function define(prefab: string, definition: FxDefinition, world: WorldFxWorld): PrefabEntityDefinition<PrefabInstance> {
  const { archive, bank, anim, sound, opacity = 1, scale, tint = [1, 1, 1], finalOffset, lingerFrames, tags } = definition;
  return {
    fn: () => {
      const inst = new PrefabInstance(prefab, new SpriteState({ name: anim, billboard: true }));
      inst.persists = false;
      inst.addTag('FX');
      for (const tag of tags ?? []) inst.addTag(tag);
      if (scale !== undefined) inst.setScale(scale);
      if (finalOffset) inst.sprite.setDepthOffset(true);
      inst.sprite.playOnce(anim, () => {
        if (!lingerFrames) { inst.remove(); return; }
        inst.onRemove(world.scheduler.schedule(lingerFrames * FRAMES, () => inst.remove()));
      });
      return inst;
    },
    assets: { animationArchive: archive, buildArchives: [archive], bank, multColour: [tint[0], tint[1], tint[2], opacity] },
    targetable: false, alwaysActive: true,
    onSpawned: sound ? inst => { PlaySound(sound, inst.position); } : undefined,
  };
}

/** The transient effects fx.lua and its siblings return, always awake for the moment they play: they draw wherever they are spawned. */
export function worldFxPrefabs(world: WorldFxWorld): Readonly<Record<WorldFxPrefab | CollapsePrefab, PrefabEntityDefinition<PrefabInstance>>> {
  const prefabs = Object.fromEntries(Object.entries<FxDefinition>({ ...FX_PREFABS, ...COLLAPSE_PREFABS })
    .map(([prefab, definition]) => [prefab, define(prefab, definition, world)])) as Record<WorldFxPrefab | CollapsePrefab, PrefabEntityDefinition<PrefabInstance>>;
  return prefabs;
}

/** structure_collapse_fx.lua SetMaterial, which the source's playfx sounds from; rock has its own event. */
function SetMaterial(inst: PrefabInstance, material?: CollapseMaterial): void {
  PlaySound('dontstarve/common/destroy_smoke', inst.position);
  if (material) PlaySound(material === 'rock' ? 'dontstarve/wilson/rock_break' : `dontstarve/common/destroy_${material}`, inst.position);
}

/** SpawnPrefab for the prefabs that spawn these effects; a collapse is spawned and given its material, as the sources do. */
export interface WorldFx {
  spawn(prefab: WorldFxPrefab, position: ReadonlyVector3): void;
  collapse(size: 'small' | 'big', position: ReadonlyVector3, material?: CollapseMaterial): void;
}

export function worldFxSpawner(manager: Pick<PrefabEntityManager<string, PrefabInstance>, 'spawn'>): WorldFx {
  return {
    spawn: (prefab, position) => { manager.spawn(prefab, position); },
    collapse: (size, position, material) => SetMaterial(manager.spawn(`collapse_${size}`, position), material),
  };
}
