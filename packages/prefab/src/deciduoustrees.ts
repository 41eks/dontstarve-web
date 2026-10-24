import * as THREE from 'three';
import type * as CANNON from 'cannon-es';
import { createSignal, readonlySignal, type Signal } from '@dontstarve-web/signals';
import { loadBuild, loadAnim, createMaterials } from '@dontstarve-web/animation/animationAssets';
import { createAnimatedSpriteFactory, createSpriteFactory, SpriteController, loadSymbolOverride, type LoadedSymbolOverride, type SpriteAnimationController } from '@dontstarve-web/animation/sprite';
import type { PickaxeTarget } from '@dontstarve-web/stategraphs/pickaxe';
import type { ShovelTarget } from '@dontstarve-web/stategraphs/shovel';
import { performToolWork, type ComponentActionEntity } from '../../stategraphs/src/componentactions';
import { Workable, type WorkableInst, type Worker } from '../../componets/src/workable';
import { Growable, type GrowableSave } from '../../componets/src/growable';
import { LootDropper, SetSharedLootTable } from '../../componets/src/lootdropper';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ProximityEntities, type ProximityEntity } from './proximityEntities';
import { actionEntity } from './actionEntity';
import { MakeObstaclePhysics, WORLD_SCALE } from './standardcomponents';
import { newEntityId } from './saveRecord';
import { DeciduousTreeLeaves, type DeciduousTreeSave, type LeafWorld, type LeafBuild } from './deciduousTreeLeaves';
import { PlaySound, PreloadSounds, type SoundEventPath, type SoundHandle } from './sound';
import { BurnableBinding, FireFxHost, TREE_BURN_TIME, type BurnEnvironment } from './treeFire';

export const DECIDUOUS_SPAWN_IDS = ['deciduoustree', 'deciduoustree_short', 'deciduoustree_normal', 'deciduoustree_tall'] as const;
export type DeciduousSpawnId = typeof DECIDUOUS_SPAWN_IDS[number];
export const DECIDUOUS_STAGES = ['short', 'normal', 'tall'] as const;
export const DECIDUOUS_CHOPS = [5, 10, 15] as const;
/** tuning.lua DECIDUOUS_GROW_TIME, using day_time = 300 seconds. */
export const DECIDUOUS_GROW_TIME = [{ base: 450, random: 150 }, { base: 1500, random: 600 },
  { base: 1500, random: 600 }] as const;
// deciduoustrees.lua onburntchanges: GetBuild(inst).drop_acorns adds a 10% acorn to the burnt tree's loot.
SetSharedLootTable('deciduoustree_burnt', [['acorn', .1]]);

export interface DeciduousRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { deciduoustree: DeciduousTreeSave; growable: GrowableSave };
}
export interface DeciduousWorld {
  camera: THREE.Camera;
  /** Searched for propagator neighbours; receives fire effects. */
  scene: THREE.Object3D;
  /** DefaultBurntFn: one ash at the burnt inst's position. */
  spawnAsh(position: THREE.Vector3): void;
  scheduler?: GameTimeScheduler;
  physics?: CANNON.World;
  season: LeafWorld['season'];
  secondsUntilNextDay: LeafWorld['secondsUntilNextDay'];
  seasonCalendar?: LeafWorld['seasonCalendar'];
  growthDuration?(seconds: number): number;
  dropLoot(items: readonly { itemId: string; count: number }[], position: THREE.Vector3): void;
}
interface Tree {
  logical: ProximityEntity;
  inst: ComponentActionEntity & WorkableInst & { getPosition(): THREE.Vector3 };
  removeInst(): void;
  stump: Signal<boolean>;
  growable: Growable;
  workable: Workable;
  lootdropper: LootDropper;
  body?: CANNON.Body;
  sounds: Set<SoundHandle>;
  leaves: DeciduousTreeLeaves;
  color: number;
  /** MakeLargeBurnable/MakeMediumPropagator (or the stump's small pair) while the tree is awake. */
  fire?: BurnableBinding;
  burntcone: boolean;
  changesTask?: () => void;
  acornTask?: () => void;
  removeTask?: () => void;
}
export interface DeciduousForest {
  group: THREE.Group;
  readonly entities: readonly ProximityEntity[];
  readonly chopTargets: readonly PickaxeTarget[];
  readonly digTargets: readonly ShovelTarget[];
  readonly renderEntities: readonly { object: THREE.Group; footPosition: THREE.Vector3; cameraDepth: number }[];
  spawn(prefab: DeciduousSpawnId, position: THREE.Vector3, saved?: DeciduousRecord): ProximityEntity;
  updateNearby(playerPosition: THREE.Vector3): void;
  update(dt: number, quaternion: THREE.Quaternion): void;
  exportRecords(): DeciduousRecord[];
  dispose(): void;
}

/** deciduoustrees.lua's normal build. Growth/work belong to logical trees, independently of loaded art. */
export async function createDeciduousForest(assetBaseUrl: string, world: DeciduousWorld,
  random = Math.random, loadRadius = 120): Promise<DeciduousForest> {
  const colors = ['green', 'red', 'orange', 'yellow'] as const;
  const [build, banks, leafOverrides, leafFx, fireFx] = await Promise.all([
    loadBuild('tree_leaf_trunk_build.zip', assetBaseUrl),
    Promise.all(['short', 'normal', 'tall'].map(stage => loadAnim(`tree_leaf_${stage}.zip`, assetBaseUrl))),
    Promise.all(colors.map(color => loadSymbolOverride(assetBaseUrl, `tree_leaf_${color}_build.zip`, 'swap_leaves'))),
    Promise.all(colors.map(color => createAnimatedSpriteFactory(assetBaseUrl, `tree_leaf_fx_${color}.zip`))),
    FireFxHost.load(assetBaseUrl),
    PreloadSounds('dontstarve/wilson/use_axe_tree', 'dontstarve/forest/treeFall', 'dontstarve/forest/treeCrumble',
      'dontstarve/forest/treeGrow', 'dontstarve/forest/treeWilt', 'dontstarve_DLC001/fall/leaf_rustle'),
  ]);
  const animations = { animations: banks.flatMap(bank => bank.animations) };
  const factory = createSpriteFactory(build, animations);
  const trunkMaterials = createMaterials(build);
  const overrides = new Map<LeafBuild, LoadedSymbolOverride>(colors.map((color, i) => [color === 'green' ? 'normal' : color, leafOverrides[i]]));
  const fxFactories = new Map<LeafBuild, typeof leafFx[number]>(colors.map((color, i) => [color === 'green' ? 'normal' : color, leafFx[i]]));
  const scheduler = world.scheduler ?? new GameTimeScheduler();
  const trees = new Map<ProximityEntity, Tree>();
  const effects = new Map<THREE.Group, { position: THREE.Vector3; factory: typeof leafFx[number] }>();
  const lastPlayerPosition = new THREE.Vector3();
  let disposed = false;
  const stageOf = (tree: Tree) => tree.growable.GetStage() - 1;
  const rest = (tree: Tree) => tree.stump.peek() ? `stump_${DECIDUOUS_STAGES[stageOf(tree)]}`
    : tree.inst.hasTag('burnt') ? `burnt_${DECIDUOUS_STAGES[stageOf(tree)]}`
    : `sway1_loop_${DECIDUOUS_STAGES[stageOf(tree)]}`;
  const env: BurnEnvironment = { scheduler, root: world.scene, fire: fireFx };
  const animationOf = (tree: Tree) => tree.logical.model?.userData.animationController as SpriteAnimationController | undefined;
  const playSound = (tree: Tree, path: SoundEventPath) => {
    for (const sound of tree.sounds) if (sound.isPlaying?.() === false) tree.sounds.delete(sound);
    tree.sounds.add(PlaySound(path, tree.logical.position));
  };
  const animationDuration = (clip: string) => {
    const anim = animations.animations.find(animation => animation.name === clip)!;
    return anim.frames.length / anim.frameRate;
  };
  const playOnce = (tree: Tree, clip: string) => {
    tree.leaves?.OnAnimation(animationDuration(clip));
    animationOf(tree)?.playOnce(clip, () => animationOf(tree)?.start(rest(tree)));
    return animationDuration(clip);
  };
  const updateLoot = (tree: Tree) => {
    tree.lootdropper.SetLoot([...Array.from({ length: stageOf(tree) + 1 }, () => 'log'),
      ...(stageOf(tree) === 2 && tree.leaves.state.build.peek() !== 'barren' ? ['acorn'] : [])]);
  };
  const applyBuild = (tree: Tree, model = tree.logical.model) => {
    if (!model) return;
    const controller = model.userData.animationController as SpriteController;
    let materials = model.userData.treeMaterials as Map<THREE.MeshBasicMaterial, THREE.MeshBasicMaterial> | undefined;
    if (!materials) model.userData.treeMaterials = materials = new Map();
    const tint = tree.leaves.state.build.peek() === 'normal' ? tree.color : 1;
    const clone = (source: THREE.MeshBasicMaterial) => {
      let material = materials!.get(source);
      if (!material) { material = source.clone(); materials!.set(source, material); }
      material.color.copy(source.color).multiplyScalar(tint); return material;
    };
    controller.setBuild(build.build, trunkMaterials.map(clone));
    const override = overrides.get(tree.leaves.state.build.peek());
    controller.setSymbolOverrides(new Map(override ? [[override.symbolHash,
      { ...override, materials: override.materials.map(clone) }]] : []), ['mouseover']);
  };
  const setStage = (tree: Tree) => {
    tree.workable.SetWorkLeft(DECIDUOUS_CHOPS[stageOf(tree)]);
    if (tree.leaves) updateLoot(tree);
    animationOf(tree)?.start(rest(tree));
  };
  const grow = (tree: Tree) => {
    if (!tree.logical.model) return;
    playSound(tree, 'dontstarve/forest/treeGrow');
    playOnce(tree, ['grow_tall_to_short', 'grow_short_to_normal', 'grow_normal_to_tall'][stageOf(tree)]);
    if (tree.leaves.state.leaf.peek() === 'colorful') tree.leaves.SpawnLeafFxAfter(stageOf(tree) === 0 ? 17 / 30 : 10 / 30);
  };
  const unbindFire = (tree: Tree) => { tree.fire?.dispose(); tree.fire = undefined; };
  /** OnEntityWake: MakeLargeBurnable + MakeMediumPropagator, or the stump's small pair, unless burnt. */
  const bindFire = (tree: Tree) => {
    if (disposed || tree.fire || tree.inst.hasTag('burnt') || tree.inst.isRemoved) return;
    tree.fire = new BurnableBinding(tree.inst, tree.stump.peek()
      ? { propagator: 'small', burnTime: 10, fxLevel: 2, onBurnt: () => burnStump(tree) }
      : { propagator: 'medium', burnTime: TREE_BURN_TIME, fxLevel: 5, onBurnt: () => treeBurnt(tree) }, env);
  };
  /** DefaultBurntFn on a stump: one ash, then the inst is removed. */
  const burnStump = (tree: Tree) => {
    world.spawnAsh(tree.logical.position.clone());
    remove(tree);
  };
  const burntChanges = (tree: Tree) => {
    unbindFire(tree);
    tree.growable.StopGrowing(); tree.leaves.Stop();
    tree.inst.removeTag('shelter'); tree.inst.removeTag('cattoyairborne');
    tree.lootdropper.SetLoot([]); tree.lootdropper.SetChanceLootTable('deciduoustree_burnt');
    if (tree.inst.components.workable === tree.workable) {
      tree.workable.SetWorkLeft(1);
      tree.workable.SetOnWorkCallback(() => {});
      tree.workable.SetOnFinishCallback(() => chopDownBurnt(tree));
    }
  };
  /** OnBurnt: the burnt tag and pose at once; the component changes follow after .5 seconds. */
  const burn = (tree: Tree, immediate: boolean) => {
    if (tree.inst.hasTag('burnt')) return;
    tree.inst.addTag('burnt');
    animationOf(tree)?.start(rest(tree));
    if (immediate) burntChanges(tree);
    else tree.changesTask = scheduler.schedule(.5, () => { tree.changesTask = undefined; burntChanges(tree); });
  };
  /** OnAcornTask: the 10% acorn lands one camera-right unit to either side of the burnt tree, once. */
  const startAcornTask = (tree: Tree) => {
    if (tree.burntcone || tree.acornTask) return;
    tree.acornTask = scheduler.schedule(10, () => {
      tree.acornTask = undefined;
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(world.camera.getWorldQuaternion(new THREE.Quaternion()));
      const position = tree.logical.position.clone().addScaledVector(right, random() < .5 ? WORLD_SCALE : -WORLD_SCALE);
      const loot = new Map<string, number>();
      for (const itemId of tree.lootdropper.GenerateLoot(random)) loot.set(itemId, (loot.get(itemId) ?? 0) + 1);
      if (loot.size) world.dropLoot([...loot].map(([itemId, count]) => ({ itemId, count })), position);
      tree.burntcone = true;
    });
  };
  const treeBurnt = (tree: Tree) => {
    burn(tree, false);
    startAcornTask(tree);
  };
  /** chop_down_burnt_tree: charcoal and the chance loot, then removal when the clip ends. */
  const chopDownBurnt = (tree: Tree) => {
    tree.workable.dispose(); delete tree.inst.components.workable;
    playSound(tree, 'dontstarve/forest/treeCrumble');
    playSound(tree, 'dontstarve/wilson/use_axe_tree');
    if (tree.body) { world.physics?.removeBody(tree.body); tree.body = undefined; }
    tree.lootdropper.SpawnLootPrefab('charcoal');
    tree.lootdropper.DropLoot();
    tree.acornTask?.(); tree.acornTask = undefined;
    const animation = animationOf(tree);
    if (animation) animation.playOnce(`chop_burnt_${DECIDUOUS_STAGES[stageOf(tree)]}`, () => remove(tree));
    else remove(tree);
  };
  const remove = (tree: Tree) => {
    tree.changesTask?.(); tree.acornTask?.(); tree.removeTask?.();
    unbindFire(tree);
    tree.removeInst(); tree.workable.dispose(); tree.growable.dispose(); tree.leaves.dispose();
    if (tree.body) world.physics?.removeBody(tree.body);
    for (const sound of tree.sounds) sound.stop(); tree.sounds.clear();
    nearby.remove(tree.logical); trees.delete(tree.logical);
  };
  const makeStump = (tree: Tree) => {
    unbindFire(tree);
    tree.stump.set(true); tree.growable.StopGrowing(); tree.leaves.Stop();
    tree.inst.removeTag('cattoyairborne');
    tree.inst.removeTag('shelter'); tree.inst.addTag('stump');
    if (tree.body) { world.physics?.removeBody(tree.body); tree.body = undefined; }
    tree.workable.dispose();
    tree.workable = new Workable(tree.inst);
    tree.inst.components.workable = tree.workable;
    tree.workable.SetWorkAction('DIG'); tree.workable.SetWorkLeft(1);
    tree.workable.SetOnFinishCallback(() => {
      tree.lootdropper.SpawnLootPrefab('log');
      remove(tree);
    });
    if (tree.logical.model) bindFire(tree);
  };
  const spawnLeaves = (tree: Tree, chopped = false) => {
    if (!tree.logical.model || tree.stump.peek()) return;
    const fxFactory = fxFactories.get(tree.leaves.state.build.peek());
    if (!fxFactory) return;
    const clip = chopped ? 'chop' : 'fall';
    const fx = fxFactory.create({ initialAnimation: clip, name: `deciduous_leaves_${clip}` });
    fx.position.copy(tree.logical.position);
    fx.position.y += (stageOf(tree) === 1 ? -.3 : 0) * WORLD_SCALE + (chopped ? random() * 2 * WORLD_SCALE : 0);
    fx.quaternion.copy(world.camera.getWorldQuaternion(new THREE.Quaternion()));
    fx.userData.tags = ['FX', 'NOCLICK']; effects.set(fx, { position: tree.logical.position, factory: fxFactory }); nearby.group.add(fx);
    playSound(tree, 'dontstarve_DLC001/fall/leaf_rustle');
    (fx.userData.animationController as SpriteAnimationController).playOnce(clip, () => {
      effects.delete(fx); fxFactory.disposeSprite(fx);
    });
  };
  const chopDown = (tree: Tree, worker: Worker) => {
    playSound(tree, 'dontstarve/forest/treeFall');
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(world.camera.getWorldQuaternion(new THREE.Quaternion()));
    const workerPosition = worker.getPosition?.();
    const onRight = workerPosition ? workerPosition.clone().sub(tree.logical.position).dot(right) > 0 : random() <= .5;
    const loot = new Map<string, number>();
    for (const itemId of tree.lootdropper.GenerateLoot()) loot.set(itemId, (loot.get(itemId) ?? 0) + 1);
    if (stageOf(tree) === 2 && tree.leaves.state.leaf.peek() === 'colorful') loot.set('acorn', (loot.get('acorn') ?? 0) + 1);
    world.dropLoot([...loot].map(([itemId, count]) => ({ itemId, count })),
      tree.logical.position.clone().addScaledVector(right, onRight ? -WORLD_SCALE : WORLD_SCALE));
    const clip = `${onRight ? 'fallleft' : 'fallright'}_${DECIDUOUS_STAGES[stageOf(tree)]}`;
    makeStump(tree);
    playOnce(tree, clip);
  };
  const nearby = new ProximityEntities([], loadRadius, logical => {
    const tree = trees.get(logical)!;
    const model = factory.create({ initialAnimation: rest(tree), name: `Deciduous-${logical.saveId}`, scale: .02 });
    applyBuild(tree, model);
    bindFire(tree);
    if (tree.inst.hasTag('burnt')) startAcornTask(tree);
    Object.assign(model.userData, { entityId: logical.saveId, prefab: 'deciduoustree', deploySmartRadius: 1,
      physicsRadius: .25 * WORLD_SCALE, components: tree.inst.components,
      deciduoustreeState: { stump: readonlySignal(tree.stump), growth: tree.growable.state, leaves: tree.leaves.state } });
    Object.defineProperty(model.userData, 'tags', { get: () => ['plant', 'tree', 'birchnut', 'deciduoustree', 'cattoyairborne',
      'shelter', 'stump', 'burnt', 'fire', 'CHOP_workable', 'DIG_workable'].filter(tag => tree.inst.hasTag(tag)) });
    actionEntity(model, 'deciduoustree', tree.inst);
    return model;
  }, model => {
    const tree = [...trees.values()].find(tree => tree.logical.model === model);
    tree?.growable.OnEntitySleep(); tree?.leaves.SetAwake(false); model.userData.removed = true;
    if (tree?.fire?.burnable.IsBurning()) {
      // OnEntitySleep: a burning stump finishes as DefaultBurntFn, a burning tree as burnt.
      if (tree.stump.peek()) tree.removeTask = scheduler.schedule(0, () => { tree.removeTask = undefined; burnStump(tree); });
      else burn(tree, true);
    }
    if (tree) unbindFire(tree);
    for (const material of (model.userData.treeMaterials as Map<THREE.Material, THREE.Material>).values()) material.dispose();
    factory.disposeSprite(model);
  });
  nearby.group.name = 'DeciduousForest';
  const targets = (action: 'CHOP' | 'DIG'): PickaxeTarget[] => [...nearby.activeEntities].flatMap(logical => {
    const tree = trees.get(logical)!, model = logical.model!;
    const isValid = () => !disposed && !tree.inst.isRemoved && logical.model === model
      && tree.workable.CanBeWorked() && tree.workable.GetWorkAction() === action;
    return isValid() ? [{ id: logical.saveId!, model, position: logical.position,
      entity: actionEntity(model, 'deciduoustree', tree.inst), isValid }] : [];
  });
  return {
    group: nearby.group,
    get entities() { return nearby.entities; },
    spawn(prefab, position, saved) {
      if (disposed) throw new Error('Deciduous forest has been disposed');
      const logical = nearby.add(position, saved?.id ?? newEntityId());
      const removed = createSignal(false), tags = new Set(['plant', 'tree', 'birchnut', 'deciduoustree', 'cattoyairborne']);
      const components: ComponentActionEntity['components'] & { growable?: Growable; lootdropper?: LootDropper } = {};
      const inst: Tree['inst'] = {
        prefab: 'deciduoustree', removal: readonlySignal(removed), get isRemoved() { return removed.peek(); }, components,
        hasTag: tag => components.workable?.HasTag(tag) ?? tags.has(tag),
        addTag: tag => { tags.add(tag); }, removeTag: tag => { tags.delete(tag); },
        PushEvent: (name, data) => logical.model?.dispatchEvent({ type: name, data } as never),
        getPosition: () => logical.position,
      };
      const workable = new Workable(inst, () => scheduler.now); components.workable = workable;
      const lootdropper = new LootDropper({ getPosition: () => logical.position, PushEvent: inst.PushEvent }, prefab => {
        world.dropLoot([{ itemId: prefab, count: 1 }], logical.position); return undefined;
      });
      components.lootdropper = lootdropper;
      workable.SetWorkAction('CHOP');
      const growable = new Growable(scheduler, DECIDUOUS_GROW_TIME.map(time => ({
        time: () => time.base + (random() * 2 - 1) * time.random,
        fn: () => setStage(trees.get(logical)!), growfn: () => grow(trees.get(logical)!),
      })), seconds => world.growthDuration?.(seconds) ?? seconds);
      components.growable = growable;
      const tree: Tree = { logical, inst, removeInst: () => removed.set(true), stump: createSignal(false),
        growable, workable, lootdropper, sounds: new Set(), color: .5 + random() * .5, leaves: undefined!, burntcone: false };
      trees.set(logical, tree);
      tree.leaves = new DeciduousTreeLeaves(scheduler, world, {
        lastWorkTime: () => tree.workable.lastworktime.peek(), applyBuild: () => applyBuild(tree), updateLoot: () => updateLoot(tree),
        setShelter: value => value ? inst.addTag('shelter') : inst.removeTag('shelter'),
        playTransition: kind => { playSound(tree, kind === 'grow_leaves' ? 'dontstarve/forest/treeGrow' : 'dontstarve/forest/treeWilt');
          return playOnce(tree, `${kind}_${DECIDUOUS_STAGES[stageOf(tree)]}`); },
        sway: () => animationOf(tree)?.start(rest(tree)), spawnLeafFx: () => spawnLeaves(tree),
      }, random);
      growable.loopstages = true; growable.springgrowth = true;
      const stage = prefab === 'deciduoustree' ? Math.min(3, Math.floor(random() * 3) + 1) : DECIDUOUS_SPAWN_IDS.indexOf(prefab);
      growable.SetStage(stage); growable.StartGrowing();
      tree.leaves.Initialize(saved?.components.deciduoustree);
      if (saved) growable.OnLoad(saved.components.growable);
      if (world.physics) { tree.body = MakeObstaclePhysics(logical.position, .25); world.physics.addBody(tree.body); }
      workable.SetOnWorkCallback(() => {
        if (!logical.model) return;
        playSound(tree, 'dontstarve/wilson/use_axe_tree');
        spawnLeaves(tree, true);
        playOnce(tree, `chop_${DECIDUOUS_STAGES[stageOf(tree)]}`);
      });
      workable.SetOnFinishCallback(worker => chopDown(tree, worker));
      if (saved?.components.deciduoustree?.stump) makeStump(tree);
      else if (saved?.components.deciduoustree?.burnt) {
        tree.burntcone = saved.components.deciduoustree.burntcone === true;
        burn(tree, true);
      }
      nearby.update(lastPlayerPosition);
      if (logical.model) growable.OnEntityWake(); else growable.OnEntitySleep();
      tree.leaves.SetAwake(logical.model !== undefined);
      return logical;
    },
    get chopTargets() { return targets('CHOP'); },
    get digTargets() { return targets('DIG').map(target => ({ ...target,
      dig: () => target.isValid() && performToolWork('DIG', target.entity, {}),
    })); },
    updateNearby(position) {
      lastPlayerPosition.copy(position); nearby.update(position);
      for (const logical of nearby.activeEntities) { const tree = trees.get(logical)!; tree.growable.OnEntityWake(); tree.leaves.SetAwake(true); }
    },
    update(dt, quaternion) {
      if (!world.scheduler) scheduler.advance(dt);
      fireFx.update(dt, quaternion);
      for (const logical of nearby.activeEntities) {
        logical.model!.quaternion.copy(quaternion);
        (logical.model!.userData.animationController as SpriteAnimationController).update(dt);
      }
      for (const model of [...effects.keys()]) {
        model.quaternion.copy(quaternion); (model.userData.animationController as SpriteAnimationController).update(dt);
      }
    },
    get renderEntities() {
      return [...Array.from(nearby.activeEntities, logical => ({ object: logical.model!, footPosition: logical.position, cameraDepth: 0 })),
        ...Array.from(effects, ([object, fx]) => ({ object, footPosition: fx.position, cameraDepth: 0 })), ...fireFx.renderEntities];
    },
    exportRecords: () => [...trees.values()].map(tree => {
      // onsave: a burning tree is saved as burnt; a burning stump is still a stump.
      const burnt = !tree.stump.peek() && (tree.inst.hasTag('burnt') || tree.fire?.burnable.IsBurning() === true);
      const { stump: _stump, leaveschangetime: _change, ...leaves } = tree.leaves.OnSave();
      return { id: tree.logical.saveId!,
        transform: { position: tree.logical.position.toArray(), rotationY: 0 }, components: burnt ? {
          deciduoustree: { ...leaves, burnt: true as const, ...(tree.burntcone ? { burntcone: true as const } : {}) },
          growable: { stage: tree.growable.GetStage() },
        } : { deciduoustree: tree.leaves.OnSave(), growable: tree.growable.OnSave() } };
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const tree of [...trees.values()]) remove(tree);
      for (const [model, fx] of effects) fx.factory.disposeSprite(model);
      effects.clear(); nearby.dispose(); factory.dispose(); fireFx.dispose();
      for (const fx of leafFx) fx.dispose(); for (const override of leafOverrides) override.dispose();
      for (const material of trunkMaterials) { material.map?.dispose(); material.dispose(); }
      if (!world.scheduler) scheduler.dispose();
    },
  };
}
