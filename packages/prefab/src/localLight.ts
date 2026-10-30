import { SpriteState, type ArchiveSpriteCommands, type LightJson } from '@dontstarve-web/display';
import { PrefabInstance } from './prefabInstance';

/** inst.Light's settings; radius is in this scene's world units. Entities declare them on `instance.light`. */
export type PrefabLocalLight = LightJson;

/** Any entity a light can be parented to, whatever its display draws. */
export type LightParent = PrefabInstance<ArchiveSpriteCommands>;

/** A light-only entity and where it is parented. */
export interface LightEntity {
  readonly instance: PrefabInstance;
  readonly parent: LightParent | undefined;
  /** entity:SetParent(parent.entity); undefined leaves it parented nowhere, so it lights nothing. */
  setParent(parent: LightParent | undefined): void;
  /** inst:Remove(). */
  remove(): void;
}

let nextId = 0;

/**
 * SpawnPrefab(light) + entity:SetParent(owner.entity), as torchfire's CreateLight, lanternlight and alterguardianhatlight:
 * a non-persistent FX entity that declares only its light. It draws nothing of its own, so it has no display; its parent
 * declares the light in a slot (`LightState.declare`) and the parent's display lists it at the parent's position while
 * the parent is active.
 */
export function spawnLightEntity(prefab: string, parent?: LightParent): LightEntity {
  const instance = new PrefabInstance(prefab, new SpriteState({ name: '' }));
  instance.addTag('FX');
  instance.persists = false;
  const key = `${prefab}:${nextId++}`;
  let current: LightParent | undefined;
  const setParent = (next: LightParent | undefined) => {
    if (next === current || instance.isRemoved) return;
    current?.light.declare(key, undefined);
    current = next;
    current?.light.declare(key, instance.light.json);
  };
  setParent(parent);
  return {
    instance,
    get parent() { return current; },
    setParent,
    remove: () => {
      if (instance.isRemoved) return;
      setParent(undefined);
      instance.light.set(null);
      instance.remove();
    },
  };
}
