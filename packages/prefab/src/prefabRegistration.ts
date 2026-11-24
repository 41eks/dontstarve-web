import type { PrefabEntityDefinition, PrefabInstance } from './prefabInstance';

export interface PrefabIds<SavedId extends string = string, DebugId extends string = SavedId> {
  readonly prefabIds: readonly SavedId[];
  readonly debugSpawnIds: readonly DebugId[];
}

/** The IDs a prefab family exposes to save files and to c_spawn. */
export function definePrefabIds<const SavedId extends string, const DebugId extends string = never>(
  prefabIds: readonly SavedId[],
  debugSpawn: readonly DebugId[] | true = [],
): PrefabIds<SavedId, SavedId | DebugId> {
  return { prefabIds, debugSpawnIds: debugSpawn === true ? prefabIds : debugSpawn };
}

export interface PrefabRegistration<Args extends unknown[], Family extends string> {
  readonly create: (...args: Args) => Readonly<Record<string, PrefabEntityDefinition<PrefabInstance>>>;
  readonly families: Readonly<Record<Family, PrefabIds>>;
}
