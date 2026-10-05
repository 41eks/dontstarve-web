import * as THREE from 'three';
import {
  createAnimatedSpriteFactory,
  type SpriteAnimationController,
} from '@dontstarve-web/animation/sprite';
import { ProximityEntities, type ProximityEntity } from './proximityEntities';
import { TILE_SIZE } from './tile';
import definitions from './definitions.json' with { type: 'json' };

export interface MoonTreeForestOptions {
  animationName?: string;
  areaSize?: number;
  count?: number;
  exclusionRadiusSquared?: number;
  /** Ground distance in world units; defaults to ten tiles. */
  loadRadius?: number;
  /** Explicit ground positions; takes precedence over random generation options. */
  positions?: readonly THREE.Vector3[];
  entityIds?: readonly string[];
  random?: () => number;
  scale?: number;
}

export interface MoonTreeForest {
  group: THREE.Group;
  positions: readonly THREE.Vector3[];
  entities: readonly ProximityEntity[];
  readonly activeEntities: ReadonlySet<ProximityEntity>;
  setNormals(cameraWorldQuaternion: THREE.Quaternion): void;
  updateNearby(playerPosition: THREE.Vector3): void;
  update(dt: number): void;
  dispose(): void;
}

export async function createMoonTreeForest(
  assetBaseUrl: string,
  options: MoonTreeForestOptions = {},
): Promise<MoonTreeForest> {
  const count = options.count ?? 500;
  const areaSize = options.areaSize ?? 1000;
  const exclusionRadiusSquared = options.exclusionRadiusSquared ?? 600;
  const random = options.random ?? Math.random;
  const scale = options.scale ?? definitions.moonTree.scale;
  const factory = await createAnimatedSpriteFactory(assetBaseUrl, definitions.moonTree.archive);
  const positions = options.positions?.map((position) => position.clone())
    ?? Array.from({ length: count }, () => {
      while (true) {
        const x = random() * areaSize - areaSize / 2;
        const z = random() * areaSize - areaSize / 2;
        if (x * x + z * z > exclusionRadiusSquared) return new THREE.Vector3(x, 0, z);
      }
    });
  const nearby = new ProximityEntities(
    positions,
    options.loadRadius ?? definitions.moonTree.loadRadiusTiles * TILE_SIZE,
    (entity) => {
      const model = factory.create({
        initialAnimation: options.animationName ?? definitions.moonTree.animationName,
        name: `MoonTree-${entity.id}`,
        scale,
      });
      // Anchor the billboard at its foot, so both loading and depth sorting use
      // the persistent ground position rather than the centre of the tall art.
      model.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(model);
      model.children[0].position.y -= bounds.min.y;
      if (entity.saveId) model.userData.entityId = entity.saveId;
      return model;
    },
    factory.disposeSprite,
    options.entityIds,
  );
  nearby.group.name = 'MoonTreeForest';

  return {
    group: nearby.group,
    positions,
    entities: nearby.entities,
    get activeEntities() { return nearby.activeEntities; },
    updateNearby(playerPosition) {
      nearby.update(playerPosition);
    },
    setNormals(cameraWorldQuaternion) {
      for (const entity of nearby.activeEntities) {
        entity.model!.quaternion.copy(cameraWorldQuaternion);
      }
    },
    update(dt) {
      for (const entity of nearby.activeEntities) {
        const animation = entity.model!.userData.animationController as SpriteAnimationController;
        animation.update(dt);
      }
    },
    dispose() {
      nearby.dispose();
      factory.dispose();
    },
  };
}
