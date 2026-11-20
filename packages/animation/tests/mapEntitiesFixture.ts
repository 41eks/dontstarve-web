import * as THREE from 'three';
import { PrefabDisplayGroup } from '@dontstarve-web/display';
import { createEmptyEntity, PrefabEntityManager, type PrefabInstance } from '../../prefab/src/prefabInstance';

/** A world's Ents with no prefab definitions: the entities TheWorld.Map's placement checks find. */
export function mapEntities(scene = new THREE.Scene()): PrefabEntityManager<string, PrefabInstance> {
  return new PrefabEntityManager<string, PrefabInstance>(new PrefabDisplayGroup(scene), '/dst/data/anim', {});
}

/** An art-less entity at `position` in `ents`, as anything spawned there stands for the map's queries. */
export function placeEntity(
  ents: PrefabEntityManager<string, PrefabInstance>,
  position: THREE.Vector3,
  tags: readonly string[] = [],
  prefab = 'blocker',
): PrefabInstance {
  const { instance } = createEmptyEntity(prefab);
  instance.setPosition(position.x, position.y, position.z);
  for (const tag of tags) {
    instance.addTag(tag);
  }
  ents.track(instance);
  return instance;
}
