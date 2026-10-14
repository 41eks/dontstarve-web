import * as THREE from 'three';
import { createMemo, readonlySignal, type ReadonlySignal, type SeasonState } from '@dontstarve-web/signals';
import { createArchiveSprite, ArchiveSpriteAssets, type ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { smallHash } from '@dontstarve-web/animation/animationAssets';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { Timer, ComponentTimer, type NamedTimerSave } from '../../componets/src/timer';
import { Workable } from '../../componets/src/workable';
import { Burnable, type BurnableInst } from '../../componets/src/burnable';
import { Propagator } from '../../componets/src/propagator';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import type { PreparedGroundSpawn, GroundItemDefinition } from './groundPrefab';
import type { RockAvocadoBushManager } from './rock_avocado_bush';
import type { ShovelTarget } from '../../stategraphs/src/shovel';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { setPrefabLocalLight } from './localLight';
import { PlaySound, PreloadSounds, type SoundHandle } from './sound';
import catalog from './groundItems.json' with { type: 'json' };

export const ROCK_AVOCADO_SAPLING_ID = 'rock_avocado_fruit_sprout_sapling' as const;
export const ROCK_AVOCADO_SPROUT_GROW_TIME = 1500;
export interface RockAvocadoSaplingRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { saplingTimer?: NamedTimerSave };
}
interface Sapling {
  sprite: ArchiveSprite;
  timer: Timer;
  completion: ComponentTimer;
  transitionAt: number;
  phase: ReturnType<typeof createMemo<string>>;
  workable: Workable;
  burnable: Burnable;
  propagator: Propagator;
  fire: ArchiveSprite;
  sound?: SoundHandle;
  stopBurning(): void;
  outputs: PreparedGroundSpawn[];
  bush?: Awaited<ReturnType<RockAvocadoBushManager['prepareNaturalSpawn']>>;
}
export interface RockAvocadoSaplingWorld {
  scheduler?: GameTimeScheduler;
  season?: ReadonlySignal<SeasonState>;
  bushes: Pick<RockAvocadoBushManager, 'prepareNaturalSpawn'>;
  prepareSpawn(definition: GroundItemDefinition): Promise<PreparedGroundSpawn>;
}

/** rock_avocado_fruit.lua's buried sprout: named growth timer, DIG, ignition and seed_growth completion. */
export class RockAvocadoSaplingManager {
  private readonly scene: THREE.Scene;
  private readonly world: RockAvocadoSaplingWorld;
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly assets: ArchiveSpriteAssets;
  private readonly saplings = new Map<THREE.Group, Sapling>();
  private readonly sounds = new Set<SoundHandle>();
  private disposed = false;
  constructor(scene: THREE.Scene, assetBaseUrl: string, world: RockAvocadoSaplingWorld) {
    this.scene = scene; this.world = world; this.scheduler = world.scheduler ?? new GameTimeScheduler();
    this.ownsScheduler = !world.scheduler; this.assets = new ArchiveSpriteAssets(assetBaseUrl);
  }
  async spawn(position: THREE.Vector3, saved?: RockAvocadoSaplingRecord): Promise<THREE.Group> {
    return (await this.prepare()).spawn(position, saved);
  }
  async prepareTransplant() {
    const prepared = await this.prepare();
    return { dispose: prepared.dispose, spawn: (position: THREE.Vector3) => { prepared.spawn(position); return true; } };
  }
  private async prepare() {
    const resources = await Promise.allSettled([
      createArchiveSprite(this.assets, { animationArchive: 'rock_avocado_fruit.zip', buildArchives: ['rock_avocado_fruit_build.zip'],
        // seed_growth includes the engine's snow placeholder; this prefab has no MakeSnowCovered.
        bank: 'rock_avo_fruit_master', animation: 'idle_buried_seed', loop: false, hiddenSymbols: ['snow'] }, { name: ROCK_AVOCADO_SAPLING_ID }),
      createArchiveSprite(this.assets, { animationArchive: 'fire.zip', buildArchives: ['fire.zip'], bank: 'fire', animation: 'level2', loop: true }),
      this.world.prepareSpawn({ ...catalog.items.rock_avocado_fruit_sprout, itemId: 'rock_avocado_fruit_sprout', count: 1 }),
      this.world.prepareSpawn({ ...catalog.items.ash, itemId: 'ash', count: 1 }),
      this.world.bushes.prepareNaturalSpawn(),
      this.assets.loadAnimation('rock_avocado_fruit.zip'),
      PreloadSounds('dontstarve/wilson/plant_tree', 'dontstarve/forest/treeGrow', 'dontstarve/common/campfire', 'dontstarve/common/fireOut'),
    ] as const);
    const disposeResources = () => { for (const result of resources) if (result.status === 'fulfilled' && result.value && 'dispose' in result.value) result.value.dispose(); };
    const failed = resources.find(result => result.status === 'rejected');
    if (failed || this.disposed) { disposeResources(); throw failed?.status === 'rejected' ? failed.reason : new Error('Saplings disposed'); }
    const sprite = (resources[0] as PromiseFulfilledResult<ArchiveSprite>).value;
    const fire = (resources[1] as PromiseFulfilledResult<ArchiveSprite>).value;
    const root = (resources[2] as PromiseFulfilledResult<PreparedGroundSpawn>).value;
    const ash = (resources[3] as PromiseFulfilledResult<PreparedGroundSpawn>).value;
    const bush = (resources[4] as PromiseFulfilledResult<Awaited<ReturnType<RockAvocadoBushManager['prepareNaturalSpawn']>>>).value;
    const animations = (resources[5] as PromiseFulfilledResult<Awaited<ReturnType<ArchiveSpriteAssets['loadAnimation']>>>).value;
    const growth = animations.animations.find(clip => clip.bankHash === smallHash('rock_avo_fruit_master') && clip.name === 'seed_growth')!;
    if (!growth?.frames.length) { disposeResources(); throw new Error('Missing rock avocado seed_growth clip'); }
    let used = false;
    return {
      dispose: () => { if (!used) { used = true; disposeResources(); } },
      spawn: (position: THREE.Vector3, saved?: RockAvocadoSaplingRecord) => {
        if (used || this.disposed) throw new Error('Prepared sprout is unavailable');
        if (![position.x, position.y, position.z].every(Number.isFinite)) throw new RangeError('Invalid sprout position');
        used = true;
        const model = sprite.model;
        model.position.set(position.x, 0, position.z);
        Object.assign(model.userData, { entityId: saved?.id ?? newEntityId(), prefab: ROCK_AVOCADO_SAPLING_ID,
          deploySmartRadius: 3, tags: [] });
        const entity = actionEntity(model, ROCK_AVOCADO_SAPLING_ID);
        const completion = new ComponentTimer(this.scheduler, () => {
          if (this.saplings.get(model) !== sapling) return;
          const point = model.position.clone(), preparedBush = sapling.bush!;
          sapling.bush = undefined;
          this.sounds.add(PlaySound('dontstarve/forest/treeGrow', point));
          this.remove(model); preparedBush.spawn(point);
        });
        const timer = new Timer(this.scheduler, name => {
          if (name !== 'grow') return;
          sprite.playOnce('seed_growth'); sapling.transitionAt = this.scheduler.now;
          completion.start(growth.frames.length / growth.frameRate);
        }, ['grow']);
        const workable = new Workable(entity);
        workable.SetWorkAction('DIG'); workable.SetWorkLeft(1);
        workable.SetOnFinishCallback(() => { if (!root.spawn(model.position)) throw new Error('Missing sprout DIG loot'); this.remove(model); });
        const burnable = new Burnable(entity, this.scheduler); burnable.SetBurnTime(7.5);
        const propagator = new Propagator(entity, 'small', radius => {
          const nearby: BurnableInst[] = [];
          this.scene.traverse(object => {
            const inst = object.userData.actionEntity as BurnableInst | undefined;
            if (inst?.components.propagator && !inst.isRemoved && !inst.hasTag('INLIMBO')
              && inst.getPosition().distanceToSquared(model.position) <= radius ** 2) nearby.push(inst);
          });
          return nearby;
        }, 3, this.scheduler, this.world.season);
        Object.assign(entity.components, { workable, timer, burnable, propagator });
        const startGrowing = () => { if (!timer.TimerExists('grow')) timer.StartTimer('grow', ROCK_AVOCADO_SPROUT_GROW_TIME); };
        burnable.SetOnIgniteFn(() => timer.StopTimer('grow'));
        burnable.SetOnExtinguishFn(startGrowing);
        burnable.SetOnBurntFn(() => { if (!ash.spawn(model.position)) throw new Error('Missing sprout ash'); this.remove(model); });
        const phase = createMemo(() => burnable.burning.get() ? 'burning'
          : completion.snapshot.get().status === 'scheduled' ? 'emerging' : 'growing');
        const sapling: Sapling = { sprite, fire, timer, completion, workable, burnable, propagator,
          transitionAt: this.scheduler.now, phase, stopBurning: () => {}, outputs: [root, ash], bush };
        this.saplings.set(model, sapling);
        model.userData.saplingState = { phase: readonlySignal(phase), growTimer: timer.snapshot('grow'), completionTimer: completion.snapshot };
        sapling.stopBurning = burnable.burning.subscribe(burning => {
          sapling.sound?.stop(); sapling.sound = undefined;
          if (burning) {
            fire.model.position.copy(model.position); this.scene.add(fire.model);
            sapling.sound = PlaySound('dontstarve/common/campfire', model.position);
            setPrefabLocalLight(model, { colour: [1, 1, 192 / 255], radius: 9, intensity: .8, falloff: .33 });
          } else {
            fire.model.removeFromParent(); setPrefabLocalLight(model, null);
            if (this.saplings.has(model)) this.sounds.add(PlaySound('dontstarve/common/fireOut', model.position));
          }
        });
        startGrowing(); timer.OnLoad(saved?.components.saplingTimer);
        this.scene.add(model); return model;
      },
    };
  }
  update(dt: number, quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    if (this.ownsScheduler) this.scheduler.advance(dt);
    for (const { sprite, fire, transitionAt } of this.saplings.values()) {
      sprite.model.quaternion.copy(quaternion); sprite.update(Math.min(dt, this.scheduler.now - transitionAt));
      if (fire.model.parent) { fire.model.position.copy(sprite.model.position); fire.model.quaternion.copy(quaternion); fire.update(dt); }
    }
  }
  get renderEntities() {
    return [...this.saplings.values()].flatMap(({ sprite, fire }) => [sprite.model, ...fire.model.parent ? [fire.model] : []]
      .map(object => ({ object, footPosition: sprite.model.position, cameraDepth: 0 })));
  }
  get digTargets(): ShovelTarget[] {
    return [...this.saplings].map(([model, sapling]) => ({ id: String(model.userData.entityId), model, position: model.position,
      entity: actionEntity(model, ROCK_AVOCADO_SAPLING_ID), isValid: () => this.saplings.get(model) === sapling && sapling.workable.CanBeWorked(),
      dig: () => performToolWork('DIG', actionEntity(model, ROCK_AVOCADO_SAPLING_ID), {}),
    }));
  }
  exportRecords(): RockAvocadoSaplingRecord[] {
    this.scheduler.advanceTo(this.scheduler.now);
    return [...this.saplings].map(([model, { timer }]) => ({ id: String(model.userData.entityId),
      transform: { position: model.position.toArray() as [number, number, number], rotationY: 0 },
      components: { saplingTimer: timer.OnSave() ?? { timers: {} } },
    }));
  }
  remove(model: THREE.Group): void {
    const sapling = this.saplings.get(model); if (!sapling) return;
    this.saplings.delete(model); model.userData.removed = true;
    sapling.burnable.SetOnExtinguishFn(undefined); sapling.burnable.dispose(); sapling.propagator.dispose();
    sapling.timer.dispose(); sapling.completion.stop(); sapling.workable.dispose(); sapling.phase.dispose();
    sapling.stopBurning(); sapling.sound?.stop(); setPrefabLocalLight(model, null);
    sapling.sprite.dispose(); sapling.fire.dispose(); sapling.outputs.forEach(output => output.dispose()); sapling.bush?.dispose();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const model of this.saplings.keys()) this.remove(model);
    for (const sound of this.sounds) sound.stop(); this.sounds.clear(); this.assets.dispose();
    if (this.ownsScheduler) this.scheduler.dispose();
  }
}
