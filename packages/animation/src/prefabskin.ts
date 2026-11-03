/** Sprite configuration produced by the visual part of DST's skin initializers. */
export interface PrefabSkinInitialization {
  archive: string;
  /** Separate build zip when the bank zip carries no build.bin (moondial.zip + moondial_build.zip). */
  buildArchive?: string;
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

export function bookstation_init_fn(skinId: string): PrefabSkinInitialization {
  return basic_init_fn(skinId, 'bookstation');
}

export function sculptingtable_init_fn(skinId: string): PrefabSkinInitialization {
  return basic_init_fn(skinId, 'sculpting_station');
}

/** moondial_init_fn: OverrideItemSkinSymbol("basin", build_name, "basin", ..., "moondial_build"). */
export function moondial_init_fn(skinId: string): PrefabSkinInitialization {
  return { archive: 'moondial.zip', buildArchive: 'moondial_build.zip', skinArchive: `dynamic/${skinId}.zip` };
}

export function winterometer_init_fn(skinId: string): PrefabSkinInitialization {
  return basic_init_fn(skinId, 'winter_meter');
}

export function lightning_rod_init_fn(skinId: string): PrefabSkinInitialization {
  return basic_init_fn(skinId, 'lightning_rod');
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
