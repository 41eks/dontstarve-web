import * as THREE from 'three';
import {
  createAnimatedSpriteFactory,
  type SpriteAnimationController,
} from '@dontstarve-web/animation/sprite';
import type { PickaxeTarget } from '@dontstarve-web/stategraphs/pickaxe';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { Workable, type Worker } from '../../componets/src/workable';
import { actionEntity } from './actionEntity';
import catalog from './groundItems.json' with { type: 'json' };
import { ProximityEntities, type ProximityEntity } from './proximityEntities';
import { PlaySound } from './sound';
import { TILE_SIZE } from './tile';
import definitions from './definitions.json' with { type: 'json' };

/** tuning.lua MOON_TREE_CHOPS_TALL: the forest's trees are the tall stage. */
export const MOON_TREE_CHOPS_TALL = 16;

// moontree.lua moontree_tall; entries whose prefab is not in the ground-item catalog are not dropped.
SetSharedLootTable('moontree_tall', [
  ['log', 1], ['log', 1], ['log', 1], ['log', 1],
  ['moon_tree_blossom', 1], ['moon_tree_blossom', 1],
  ['moonbutterfly', 1], ['moonbutterfly', .5],
]);

/** What the forest needs from the running game once a scene exists. */
export interface MoonTreeWorld {
  readonly camera: THREE.Camera;
  dropLoot(items: readonly { itemId: string; count: number }[], position: THREE.Vector3): void;
}

/** moontree.lua OnSave keeps the stump flag; workable progress is not saved. */
export interface MoonTreeSaveState { stump: true }

interface TreeState { stump: boolean; workLeft: number }

interface TreeController {
  readonly entity: ProximityEntity;
  readonly model: THREE.Group;
  readonly inst: ReturnType<typeof actionEntity>;
  workable?: Workable;
}

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
  /** Binds the loot sink and camera used by chopping; returns the matching release. */
  bindWorld(world: MoonTreeWorld): () => void;
  /** CHOP_workable trees among the loaded models, with their ground-contact points. */
  readonly chopTargets: readonly PickaxeTarget[];
  /** Loaded trees plus their transient chop effects, for whole-entity depth ordering. */
  readonly renderEntities: readonly { object: THREE.Group; footPosition: THREE.Vector3; cameraDepth: number }[];
  restoreState(saveId: string, state: MoonTreeSaveState | undefined): void;
  exportState(entity: ProximityEntity): { moonTree?: MoonTreeSaveState };
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
  const [factory, fxFactory] = await Promise.all([
    createAnimatedSpriteFactory(assetBaseUrl, definitions.moonTree.archive),
    createAnimatedSpriteFactory(assetBaseUrl, 'tree_petal_fx.zip'),
  ]);
  const positions = options.positions?.map((position) => position.clone())
    ?? Array.from({ length: count }, () => {
      while (true) {
        const x = random() * areaSize - areaSize / 2;
        const z = random() * areaSize - areaSize / 2;
        if (x * x + z * z > exclusionRadiusSquared) return new THREE.Vector3(x, 0, z);
      }
    });
  const unit = TILE_SIZE / 4;
  const states = new Map<ProximityEntity, TreeState>();
  const controllers = new Map<THREE.Group, TreeController>();
  const effects = new Set<THREE.Group>();
  let world: MoonTreeWorld | undefined;
  const standingAnimation = options.animationName ?? definitions.moonTree.animationName;
  const stateOf = (entity: ProximityEntity): TreeState => {
    let state = states.get(entity);
    if (!state) states.set(entity, state = { stump: false, workLeft: MOON_TREE_CHOPS_TALL });
    return state;
  };
  const cameraRight = () => {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(world!.camera.getWorldQuaternion(new THREE.Quaternion()));
    return right.setY(0).normalize();
  };

  /** make_stump: no more chopping or shelter; the stump pose is the resting animation. */
  const makeStump = (controller: TreeController) => {
    const { model, inst } = controller;
    controller.workable?.dispose();
    controller.workable = undefined;
    delete model.userData.components.workable;
    inst.removeTag('shelter');
    inst.addTag('stump');
  };

  const spawnChopFx = (position: THREE.Vector3) => {
    const fx = fxFactory.create({ initialAnimation: 'chop', name: 'tree_petal_fx_chop' });
    // on_chop_tree: TALL spawns 2.0..2.25 units up at scale 1.25.
    fx.position.set(position.x, (2 + Math.random() * .25) * unit, position.z);
    fx.scale.setScalar(1.25);
    fx.userData.tags = ['FX', 'NOCLICK'];
    fx.userData.footPosition = position;
    fx.quaternion.copy(world!.camera.getWorldQuaternion(new THREE.Quaternion()));
    nearby.group.add(fx);
    effects.add(fx);
    (fx.userData.animationController as SpriteAnimationController).playOnce('chop', () => {
      effects.delete(fx);
      fxFactory.disposeSprite(fx);
    });
  };

  const attach = (entity: ProximityEntity, model: THREE.Group) => {
    const state = stateOf(entity);
    const inst = actionEntity(model, 'moon_tree');
    const controller: TreeController = { entity, model, inst };
    controllers.set(model, controller);
    model.userData.prefab = 'moon_tree';
    for (const tag of ['plant', 'tree', 'moon_tree']) inst.addTag(tag);
    if (state.stump) {
      inst.addTag('stump');
      return;
    }
    inst.addTag('shelter');
    const animation = model.userData.animationController as SpriteAnimationController;
    const workable = new Workable(inst);
    controller.workable = workable;
    model.userData.components.workable = workable;
    workable.SetWorkAction('CHOP');
    workable.SetWorkLeft(state.workLeft);
    // on_chop_tree: sound, chop pose, then back to swaying, with petals at the crown.
    workable.SetOnWorkCallback((_worker, workLeft) => {
      state.workLeft = workLeft;
      PlaySound('dontstarve/wilson/use_axe_tree', entity.position);
      animation.playOnce('chop_tall', () => animation.start('sway1_loop_tall'));
      if (world) spawnChopFx(entity.position);
    });
    // on_chop_tree_down: fall away from the chopper, scatter loot on the fall side and leave a stump.
    workable.SetOnFinishCallback((worker: Worker) => {
      PlaySound('dontstarve/forest/treeFall', entity.position);
      const right = cameraRight();
      const chopper = worker.getPosition?.();
      const chopperOnRight = chopper
        ? (chopper.x - entity.position.x) * right.x + (chopper.z - entity.position.z) * right.z > 0
        : Math.random() > .5;
      const loot: string[] = [];
      const dropper = new LootDropper({ getPosition: () => entity.position }, prefab => { loot.push(prefab); return undefined; });
      dropper.SetChanceLootTable('moontree_tall');
      dropper.DropLoot();
      const items = new Map<string, number>();
      for (const itemId of loot) if (Object.hasOwn(catalog.items, itemId)) items.set(itemId, (items.get(itemId) ?? 0) + 1);
      world?.dropLoot([...items].map(([itemId, count]) => ({ itemId, count })),
        entity.position.clone().addScaledVector(right, chopperOnRight ? -unit : unit));
      state.stump = true;
      makeStump(controller);
      animation.playOnce(chopperOnRight ? 'fallleft_tall' : 'fallright_tall', () => animation.start('stump_tall'));
    });
  };

  const nearby: ProximityEntities = new ProximityEntities(
    positions,
    options.loadRadius ?? definitions.moonTree.loadRadiusTiles * TILE_SIZE,
    (entity) => {
      const model = factory.create({
        initialAnimation: stateOf(entity).stump ? 'stump_tall' : standingAnimation,
        name: `MoonTree-${entity.id}`,
        scale,
      });
      // Anchor the billboard at its foot, so both loading and depth sorting use
      // the persistent ground position rather than the centre of the tall art.
      model.updateWorldMatrix(true, true);
      const bounds = new THREE.Box3().setFromObject(model);
      model.children[0].position.y -= bounds.min.y;
      if (entity.saveId) model.userData.entityId = entity.saveId;
      attach(entity, model);
      return model;
    },
    (model) => {
      const controller = controllers.get(model);
      controllers.delete(model);
      model.userData.removed = true;
      controller?.workable?.dispose();
      factory.disposeSprite(model);
    },
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
      for (const fx of effects) fx.quaternion.copy(cameraWorldQuaternion);
    },
    update(dt) {
      for (const entity of nearby.activeEntities) {
        const animation = entity.model!.userData.animationController as SpriteAnimationController;
        animation.update(dt);
      }
      for (const fx of [...effects]) (fx.userData.animationController as SpriteAnimationController).update(dt);
    },
    bindWorld(next) {
      world = next;
      return () => { if (world === next) world = undefined; };
    },
    get chopTargets() {
      if (!world) return [];
      return [...nearby.activeEntities].flatMap(entity => {
        const controller = controllers.get(entity.model!);
        if (!controller?.workable) return [];
        const isValid = () => controllers.get(entity.model!) === controller && controller.workable?.CanBeWorked() === true;
        return [{ id: entity.saveId ?? String(entity.id), entity: controller.inst, model: entity.model!,
          position: entity.position, isValid }];
      });
    },
    get renderEntities() {
      return [
        ...Array.from(nearby.activeEntities, (entity) => ({ object: entity.model!, footPosition: entity.position, cameraDepth: 0 })),
        ...Array.from(effects, (fx) => ({ object: fx, footPosition: fx.userData.footPosition as THREE.Vector3, cameraDepth: 0 })),
      ];
    },
    restoreState(saveId, state) {
      const entity = nearby.entities.find(candidate => candidate.saveId === saveId);
      if (!entity || !state?.stump) return;
      stateOf(entity).stump = true;
      const controller = entity.model && controllers.get(entity.model);
      if (controller?.workable) {
        makeStump(controller);
        (controller.model.userData.animationController as SpriteAnimationController).start('stump_tall');
      }
    },
    exportState(entity) {
      return states.get(entity)?.stump ? { moonTree: { stump: true } } : {};
    },
    dispose() {
      nearby.dispose();
      for (const fx of effects) fxFactory.disposeSprite(fx);
      effects.clear();
      factory.dispose();
      fxFactory.dispose();
    },
  };
}
