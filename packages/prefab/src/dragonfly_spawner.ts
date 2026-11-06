import { SpriteState } from '@dontstarve-web/display';
import * as THREE from 'three';
import { createEffect, watchSignal } from '@dontstarve-web/signals';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { ChildSpawner, type ChildSpawnerChild, type ChildSpawnerSave } from '../../componets/src/childspawner';
import { Timer, type NamedTimerSave } from '../../componets/src/timer';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { KnownLocations } from '../../componets/src/knownlocations';
import { PrefabInstance, prefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { WORLD_SCALE } from './tile';
import { Transform } from './transform';

export const DRAGONFLY_SPAWNER_ID = 'dragonfly_spawner' as const;
/** TUNING.DRAGONFLY_SPAWN_TIME. */
const SPAWN_PERIOD = 1;
/** TUNING.DRAGONFLY_RESPAWN_TIME. */
const RESPAWN_TIME = 480 * 20;
const DRAGONFLY_SPAWNTIMER = 'regen_dragonfly';

/** The record keeps childspawner.lua's and worldsettingstimer.lua's OnSave under one field. */
export interface DragonflySpawnerSaveState {
  childspawner: ChildSpawnerSave;
  worldsettingstimer?: NamedTimerSave;
}
interface DragonflyChild extends ChildSpawnerChild<DragonflySpawnerInstance> { readonly model: THREE.Group }
export interface DragonflySpawnerWorld {
  scheduler: GameTimeScheduler;
  spawnDragonfly(position: THREE.Vector3): THREE.Group;
  resolveDragonfly(id: string): THREE.Group | undefined;
  isPassable(position: THREE.Vector3): boolean;
}

/** dragonfly_spawner.lua fn: an invisible CLASSIFIED home with one queued child and a world-settings respawn timer.
 * The lava pond engagement events are not ported. */
export class DragonflySpawnerInstance extends PrefabInstance {
  /** inst.components.childspawner and worldsettingstimer: saved together under data.dragonflySpawner. */
  readonly childspawner: ChildSpawner<DragonflySpawnerInstance, DragonflyChild>;
  readonly worldsettingstimer: Timer;
  private childrenToLink: readonly string[] = [];

  constructor(world: DragonflySpawnerWorld, position: ReadonlyVector3) {
    super(DRAGONFLY_SPAWNER_ID, new SpriteState({ name: '', billboard: false }), Transform.stationary());
    this.setPosition(position.x, 0, position.z);
    this.addTag('CLASSIFIED');

    const childspawner = this.childspawner = new ChildSpawner<DragonflySpawnerInstance, DragonflyChild>(this, world.scheduler);
    childspawner.ConfigureSpawning(() => spawnChild(this, world), SPAWN_PERIOD, 0);
    childspawner.onchildkilled = () => StartSpawning(this);
    childspawner.StartSpawning();
    childspawner.StopRegen();
    this.worldsettingstimer = new Timer(world.scheduler, name => { if (name === DRAGONFLY_SPAWNTIMER) GenerateNewDragon(this); }, [DRAGONFLY_SPAWNTIMER]);

    this.OnSave = (_inst, data) => {
      const timer = this.worldsettingstimer.OnSave();
      data.dragonflySpawner = { childspawner: childspawner.OnSave(), ...timer ? { worldsettingstimer: timer } : {} };
    };
    this.OnLoad = (_inst, data) => {
      const saved = data.dragonflySpawner;
      if (!saved) return;
      childspawner.OnLoad(saved.childspawner);
      this.worldsettingstimer.OnLoad(saved.worldsettingstimer);
      this.childrenToLink = saved.childspawner.childrenoutside;
    };
    // The save loop's LoadPostPass, once the saved dragonflies exist.
    const stopPostPass = world.scheduler.schedule(0, () => {
      childspawner.LoadPostPass(id => {
        const child = world.resolveDragonfly(id);
        return child ? childFor(child) : undefined;
      }, this.childrenToLink);
      OnLoadPostPass(this);
    });
    // OnEntitySleep / OnEntityWake.
    let stopStatus: (() => void) | undefined;
    const status = watchSignal(this.status, stop => { stopStatus = stop; });
    const stopWake = createEffect(() => {
      const value = status.get();
      if (value === 'active') childspawner.OnEntityWake(); else if (value === 'asleep') childspawner.OnEntitySleep();
    });
    this.onRemove(() => { stopPostPass(); stopWake(); stopStatus?.(); childspawner.dispose(); this.worldsettingstimer.dispose(); });
  }
}

function StartSpawning(inst: DragonflySpawnerInstance): void { inst.worldsettingstimer.StartTimer(DRAGONFLY_SPAWNTIMER, RESPAWN_TIME); }

function GenerateNewDragon(inst: DragonflySpawnerInstance): void {
  inst.childspawner.AddChildrenInside(1);
  inst.childspawner.StartSpawning();
}

function OnLoadPostPass(inst: DragonflySpawnerInstance): void {
  if (inst.childspawner.childreninside + inst.childspawner.numchildrenoutside === 0 && !inst.worldsettingstimer.TimerExists(DRAGONFLY_SPAWNTIMER))
    StartSpawning(inst);
}

/** childspawner SpawnChild at a free point .5 units out, then onspawned's spawnpoint. */
function spawnChild(inst: DragonflySpawnerInstance, world: DragonflySpawnerWorld): DragonflyChild | undefined {
  const origin = inst.position;
  const start = Math.random() * Math.PI * 2;
  let point: THREE.Vector3 | undefined;
  for (let i = 0; i < 8; i++) {
    const angle = start + i * Math.PI / 4;
    const candidate = new THREE.Vector3(origin.x + Math.cos(angle) * .5 * WORLD_SCALE, 0, origin.z + Math.sin(angle) * .5 * WORLD_SCALE);
    if (world.isPassable(candidate)) { point = candidate; break; }
  }
  if (!point) return;
  const model = world.spawnDragonfly(point);
  knownLocations(model)?.RememberLocation('spawnpoint', point);
  return childFor(model);
}

const knownLocations = (model: THREE.Group) => prefabInstance(model)?.components?.knownlocations as KnownLocations | undefined;

function childFor(model: THREE.Group): DragonflyChild {
  const instance = prefabInstance(model) as PrefabInstance | undefined;
  if (!instance?.entityId) throw new Error('Spawned dragonfly has no instance identity');
  return { id: instance.entityId, model,
    // DoTakeOwnership: knownlocations remembers home.
    setHome: home => { if (home) knownLocations(model)?.RememberLocation('home', home.position); },
    ListenForEvent: (name, fn) => name === 'onremove' ? instance.onRemove(fn) : instance.ListenForEvent(name, () => fn()),
    remove: () => instance.remove() };
}

/** The Prefab dragonfly_spawner.lua returns: no assets, a transform only. */
export function dragonflySpawnerPrefabs(world: DragonflySpawnerWorld): Readonly<Record<typeof DRAGONFLY_SPAWNER_ID, PrefabEntityDefinition<DragonflySpawnerInstance>>> {
  return { [DRAGONFLY_SPAWNER_ID]: { fn: position => new DragonflySpawnerInstance(world, position), targetable: false } };
}
