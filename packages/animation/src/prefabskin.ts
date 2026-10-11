/** Sprite configuration produced by the visual part of DST's skin initializers. */
export interface PrefabSkinInitialization {
  archive: string;
  skinArchive: string;
}

export type PrefabSkinInitializer = (skinId: string) => PrefabSkinInitialization;

/** SetSkin(build_name, def_build): keep the base bank and apply the skin build. */
export function basic_init_fn(buildName: string, defaultBuild: string): PrefabSkinInitialization {
  return {
    archive: `${defaultBuild}.zip`,
    skinArchive: `dynamic/${buildName}.zip`,
  };
}

export function firepit_init_fn(skinId: string): PrefabSkinInitialization {
  // The woven and alternate editions use the same build as their original skin.
  const buildName = {
    firepit_fangedp: 'firepit_fanged',
    firepit_hole_alt: 'firepit_hole',
    firepit_kiln_alt: 'firepit_kiln',
  }[skinId] ?? skinId;
  return basic_init_fn(buildName, 'firepit');
}

export function icebox_init_fn(skinId: string): PrefabSkinInitialization {
  return basic_init_fn(skinId, 'ice_box');
}

export function dragonflychest_init_fn(skinId: string): PrefabSkinInitialization {
  // DST builds a normal chest even when an upgraded edition is selected in the placer.
  return basic_init_fn(skinId.replace('dragonflychest_upgraded_', 'dragonflychest_'), 'dragonfly_chest');
}

export function campfire_init_fn(skinId: string): PrefabSkinInitialization {
  return basic_init_fn(skinId, 'campfire');
}

export function saltbox_init_fn(skinId: string): PrefabSkinInitialization {
  return basic_init_fn(skinId, 'saltbox');
}

export function nightlight_init_fn(skinId: string): PrefabSkinInitialization {
  // The prefab ID is nightlight; its base and skin builds use nightmare_torch.
  return basic_init_fn(skinId, 'nightmare_torch');
}

export function pighouse_init_fn(skinId: string): PrefabSkinInitialization {
  return basic_init_fn(skinId, 'pig_house');
}

export function sculptingtable_init_fn(skinId: string): PrefabSkinInitialization {
  return basic_init_fn(skinId, 'sculpting_station');
}

export function winterometer_init_fn(skinId: string): PrefabSkinInitialization {
  return basic_init_fn(skinId, 'winter_meter');
}

export function mushroom_light_init_fn(skinId: string): PrefabSkinInitialization {
  return basic_init_fn(skinId, 'mushroom_light');
}

export function mushroom_light2_init_fn(skinId: string): PrefabSkinInitialization {
  return basic_init_fn(skinId, 'mushroom_light2');
}

/** prefabskin.lua wall_*_init_fn: retain the wall's bank and change its skin build. */
export function wall_stone_init_fn(skinId: string): PrefabSkinInitialization {
  return basic_init_fn(skinId === 'wall_stone_ancient_alt' ? 'wall_stone_ancient' : skinId, 'wall_stone');
}

export function wall_ruins_init_fn(skinId: string): PrefabSkinInitialization {
  // skinprefabs.lua maps the alternate editions to the original thulecite builds.
  return basic_init_fn(skinId.replace(/_alt$/, ''), 'wall_ruins');
}

export function wall_moonrock_init_fn(skinId: string): PrefabSkinInitialization {
  return basic_init_fn(skinId, 'wall_moonrock');
}

export function wall_dreadstone_init_fn(skinId: string): PrefabSkinInitialization {
  return basic_init_fn(skinId, 'wall_dreadstone');
}

export function wall_hay_init_fn(skinId: string): PrefabSkinInitialization {
  return basic_init_fn(skinId, 'wall_hay');
}

export function wall_wood_init_fn(skinId: string): PrefabSkinInitialization {
  return basic_init_fn(skinId, 'wall_wood');
}

/** prefabskin.lua birdcage_init_fn; birdcage_gothicp has build_name_override = "birdcage_gothic". */
export function birdcage_init_fn(skinId: string): PrefabSkinInitialization {
  return basic_init_fn(skinId === 'birdcage_gothicp' ? 'birdcage_gothic' : skinId, 'bird_cage');
}
