import { PrefabDisplayGroup } from '@dontstarve-web/display';
import * as THREE from 'three';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { ChildSpawner, type ChildSpawnerChild, type ChildSpawnerSave } from '../../componets/src/childspawner';
import { Timer, type NamedTimerSave } from '../../componets/src/timer';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { createEmptyEntity, prefabInstance, type PrefabInstance } from './prefabInstance';
import { watchTileActivity } from './tileActivity';
import { newEntityId } from './saveRecord';
import { WORLD_SCALE } from './tile';

export const DRAGONFLY_SPAWNER_ID = 'dragonfly_spawner' as const;
const SPAWN_PERIOD = 1;
const RESPAWN_TIME = 480 * 20;
const REGEN_TIMER = 'regen_dragonfly';

export interface DragonflySpawnerSaveState {
  childspawner: ChildSpawnerSave;
  worldsettingstimer?: NamedTimerSave;
}
export interface DragonflySpawnerRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { dragonflySpawner: DragonflySpawnerSaveState };
}
interface DragonflyChild extends ChildSpawnerChild<Spawner> { readonly model: THREE.Group }
interface Spawner {
  instance: PrefabInstance;
  display: ReturnType<typeof createEmptyEntity>['display'];
  childspawner: ChildSpawner<Spawner, DragonflyChild>;
  timer: Timer;
  stopActivity: () => void;
  stopPostPass: () => void;
}
export interface DragonflySpawnerWorld {
  scheduler: GameTimeScheduler;
  tickingarea?: TileStateQuery;
  spawnDragonfly(position: THREE.Vector3): THREE.Group;
  resolveDragonfly(id: string): THREE.Group | undefined;
  isPassable(position: THREE.Vector3): boolean;
}

/** dragonfly_spawner.lua: invisible CLASSIFIED home with one queued child and a world-settings respawn timer. */
export class DragonflySpawnerManager {
  private readonly spawners = new Map<THREE.Group, Spawner>();
  private readonly displays: PrefabDisplayGroup;
  private readonly world: DragonflySpawnerWorld;
  private disposed = false;
  constructor(scene: THREE.Scene, world: DragonflySpawnerWorld) { this.displays = new PrefabDisplayGroup(scene); this.world = world; }

  spawn(position: THREE.Vector3, saved?: DragonflySpawnerRecord): THREE.Group {
    if (this.disposed) throw new Error('Dragonfly spawners have been disposed');
    const { instance, display } = createEmptyEntity(DRAGONFLY_SPAWNER_ID);
    const model = display.model;
    instance.entityId = saved?.id ?? newEntityId();
    instance.addTag('CLASSIFIED');
    instance.position.copy(position);
    model.rotation.y = saved?.transform.rotationY ?? 0;
    const spawner = {} as Spawner;
    spawner.instance = instance; spawner.display = display;
    const timer = new Timer(this.world.scheduler, name => {
      if (name === REGEN_TIMER) { spawner.childspawner.AddChildrenInside(1); spawner.childspawner.StartSpawning(); }
    }, [REGEN_TIMER]);
    spawner.timer = timer;
    const childspawner = new ChildSpawner<Spawner, DragonflyChild>(spawner, this.world.scheduler, saved?.components.dragonflySpawner.childspawner);
    spawner.childspawner = childspawner;
    childspawner.ConfigureSpawning(() => this.spawnChild(spawner), SPAWN_PERIOD, 0);
    childspawner.onchildkilled = () => { timer.StartTimer(REGEN_TIMER, RESPAWN_TIME); };
    childspawner.StopRegen();
    if (!saved) childspawner.StartSpawning();
    timer.OnLoad(saved?.components.dragonflySpawner.worldsettingstimer);
    spawner.stopPostPass = this.world.scheduler.schedule(0, () => {
      childspawner.LoadPostPass(id => {
        const child = this.world.resolveDragonfly(id);
        return child ? this.childFor(child) : undefined;
      }, saved?.components.dragonflySpawner.childspawner.childrenoutside ?? []);
      if (childspawner.childreninside + childspawner.numchildrenoutside === 0 && !timer.TimerExists(REGEN_TIMER))
        timer.StartTimer(REGEN_TIMER, RESPAWN_TIME);
    });
    this.spawners.set(model, spawner);
    this.displays.mount(display);
    spawner.stopActivity = watchTileActivity(model, this.world.tickingarea, active => {
      instance.setActive(active);
      if (active) childspawner.OnEntityWake(); else childspawner.OnEntitySleep();
    });
    instance.onRemove(() => {
      this.spawners.delete(model);
      spawner.stopActivity(); spawner.stopPostPass(); childspawner.dispose(); timer.dispose();
    });
    return model;
  }

  private spawnChild(spawner: Spawner): DragonflyChild | undefined {
    const origin = spawner.instance.position;
    const start = Math.random() * Math.PI * 2;
    let point: THREE.Vector3 | undefined;
    for (let i = 0; i < 8; i++) {
      const angle = start + i * Math.PI / 4;
      const candidate = new THREE.Vector3(origin.x + Math.cos(angle) * .5 * WORLD_SCALE, 0,
        origin.z + Math.sin(angle) * .5 * WORLD_SCALE);
      if (this.world.isPassable(candidate)) { point = candidate; break; }
    }
    if (!point) return;
    const model = this.world.spawnDragonfly(point);
    const locations = prefabInstance(model)!.components?.knownlocations as import('../../componets/src/knownlocations').KnownLocations | undefined;
    locations?.RememberLocation('spawnpoint', point);
    return this.childFor(model);
  }

  private childFor(model: THREE.Group): DragonflyChild {
    const instance = prefabInstance(model) as PrefabInstance | undefined;
    if (!instance?.entityId) throw new Error('Spawned dragonfly has no instance identity');
    const locations = prefabInstance(model)!.components?.knownlocations as import('../../componets/src/knownlocations').KnownLocations | undefined;
    return { id: instance.entityId, model,
      setHome: home => { if (home) locations?.RememberLocation('home', home.instance.position); },
      ListenForEvent: (name, fn) => {
        if (name === 'onremove') return instance.onRemove(fn);
        const listener = () => fn();
        model.addEventListener(name as never, listener as never);
        return () => model.removeEventListener(name as never, listener as never);
      },
      remove: () => instance.remove() };
  }
  exportRecords(): { prefabId: typeof DRAGONFLY_SPAWNER_ID; record: DragonflySpawnerRecord }[] {
    return [...this.spawners].map(([model, spawner]) => ({ prefabId: DRAGONFLY_SPAWNER_ID, record: {
      id: String(spawner.instance.entityId),
      transform: { position: [model.position.x, model.position.y, model.position.z], rotationY: model.rotation.y },
      components: { dragonflySpawner: { childspawner: spawner.childspawner.OnSave(),
        ...(spawner.timer.OnSave() ? { worldsettingstimer: spawner.timer.OnSave() } : {}) } },
    } }));
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const spawner of this.spawners.values()) { spawner.instance.remove(); spawner.display.dispose(); }
    this.displays.dispose();
  }
}
