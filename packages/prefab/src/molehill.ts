import type * as THREE from 'three';
import { SpriteState } from '@dontstarve-web/display';
import { createEffect, WorldContentKey } from '@dontstarve-web/signals';
import type { InventoryStack, ItemEntity } from '@dontstarve-web/inventory';
import { Inventory } from '../../componets/src/inventory';
import { Spawner } from '../../componets/src/spawner';
import { Workable } from '../../componets/src/workable';
import { actionEntity } from './actionEntity';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { PlacementSaveRecord } from './saveRecord';
import { ToolMouseTarget, type ToolMouseTargetWorld } from './toolMouseTarget';
import { Transform, type ReadonlyVector3 } from './transform';
import type { WorldFx } from './world_fx';
import { Mole, configureMoleEntity, type MoleWorld } from './mole';

export const MOLEHILL_ID = 'molehill' as const;
// tuning.lua: day_time = 10 * 30; MOLE_RESPAWN_TIME = day_time * 4.
export const MOLE_RESPAWN_TIME = 1200;
export interface MolehillSave { items: InventoryStack[]; child?: InventoryStack; childid?: string; startdelay?: number }

/** What the scene gives the moles and their hills; hills and move FX are spawned through the shared prefab manager. */
export interface MoleHabitatServices extends Omit<MoleWorld, 'getMoles' | 'makeHome' | 'registerMole' | 'spawnMoveFx'>, ToolMouseTargetWorld {
  showMole(entity: ItemEntity, position: THREE.Vector3): void;
  /** SpawnPrefab("molehill"). */
  spawnPrefab(prefab: typeof MOLEHILL_ID, position: THREE.Vector3): MolehillInstance;
  fx: Pick<WorldFx, 'spawn'>;
}

export interface MoleHabitat extends MoleWorld, ToolMouseTargetWorld {
  showMole(entity: ItemEntity, position: THREE.Vector3): void;
  /** OnLoadPostPass's newents lookup: `found` runs once the mole with this entity ID joins the world. */
  findMole(id: string, found: (mole: Mole) => void): () => void;
}

/** The world the moles share: TheSim's mole query, MAKEMOLEHILL's SpawnPrefab and SGmole's mole_move_fx. */
export function createMoleHabitat(services: MoleHabitatServices): MoleHabitat {
  const { spawnPrefab, fx, ...world } = services;
  const moles = new Set<Mole>();
  const waiting = new Map<string, Set<(mole: Mole) => void>>();
  return {
    ...world,
    getMoles: () => [...moles],
    // actions.lua MAKEMOLEHILL: SpawnPrefab("molehill") at the doer, then molehill:AdoptChild(doer).
    makeHome: mole => { const hill = spawnPrefab(MOLEHILL_ID, mole.getPosition().clone()); hill.AdoptChild(mole); return hill; },
    registerMole: mole => {
      moles.add(mole);
      const found = waiting.get(mole.id); waiting.delete(mole.id);
      for (const fn of found ?? []) fn(mole);
      return () => { moles.delete(mole); };
    },
    spawnMoveFx: position => fx.spawn('mole_move_fx', position),
    findMole: (id, found) => {
      const mole = [...moles].find(candidate => candidate.id === id);
      if (mole) { found(mole); return () => {}; }
      let set = waiting.get(id); if (!set) waiting.set(id, set = new Set());
      const pending = set; pending.add(found);
      return () => { pending.delete(found); if (!pending.size && waiting.get(id) === pending) waiting.delete(id); };
    },
  };
}

interface MolehillComponents {
  inventory: Inventory;
  spawner: Spawner<Mole>;
  workable: Workable;
}

/** molehill.lua fn: the dig callback, stored minerals and its one persistent child. Hauntable and inspectable are not ported. */
export class MolehillInstance extends PrefabInstance<SpriteState, MolehillComponents> {
  declare readonly prefab: typeof MOLEHILL_ID;
  private readonly world: MoleHabitat;
  private readonly cycle;
  /** A saved child outside the hill, until OnLoadPostPass finds it. */
  private pendingChildId?: string;
  private stopPending?: () => void;

  constructor(world: MoleHabitat, position: ReadonlyVector3) {
    super(MOLEHILL_ID, new SpriteState({ name: 'mound_idle', billboard: true }), Transform.stationary());
    this.world = world;
    this.setPosition(position.x, 0, position.z);
    // LAYER_BACKGROUND, sort order 3: the mound stays upright behind what stands on it.
    this.sprite.setGround(-.5, false);
    this.cycle = world.getWatchWorldContent(WorldContentKey.Cycle, stop => this.onRemove(stop));
    const inventory = new Inventory(this, 50, world.dropItem, world.itemSpecs);
    const spawner = new Spawner<Mole>(this, this.cycle.scheduler, () => {
      const entity = world.spawnItem({ itemId: 'mole', count: 1 }); configureMoleEntity(entity);
      const mole = entity.getComponent<Mole>('mole')!; mole.bindWorld(world);
      // Dropping a spawned child does not invoke mole.lua's inventory-drop stun.
      world.showMole(entity, this.getPosition()); return mole;
    }, MOLE_RESPAWN_TIME);
    spawner.onoccupied = () => { if (this.cycle.peek() !== 'day') this.startspawning(); };
    spawner.onvacate = () => this.stopspawning();
    // WorldSettings_Spawner_SpawnDelay: a new hill releases its first mole at once.
    spawner.SpawnWithDelay(0);
    const workable = new Workable(this);
    workable.SetWorkAction('DIG'); workable.SetWorkLeft(1); workable.SetOnFinishCallback(() => this.dig_up());
    Object.assign(this.components, { inventory, spawner, workable });
    this.onRemove(() => {
      this.PushEvent('onremove');
      this.stopPending?.();
      spawner.dispose(); inventory.dispose(); workable.dispose();
    });
  }

  get id(): string { return String(this.entityId); }
  isValid(): boolean { return !this.isRemoved; }

  /** OnInit, DoTaskInTime(0): WatchWorldState("iscaveday", OnIsDay). */
  OnInit(): void {
    const spawner = this.components.spawner;
    createEffect(() => {
      if (this.cycle.get() !== 'day' && spawner.IsOccupied()) this.startspawning(); else this.stopspawning();
    });
  }

  AdoptChild(child: Mole): void {
    const spawner = this.components.spawner;
    spawner.CancelSpawning(); spawner.TakeOwnership(child); this.stopspawning();
  }

  private startspawning(): void {
    const spawner = this.components.spawner; spawner.SetQueueSpawning(false);
    if (!spawner.IsSpawnPending()) spawner.SpawnWithDelay(5 + Math.floor(Math.random() * 16));
  }
  private stopspawning(): void { this.components.spawner.SetQueueSpawning(true, 5 + Math.floor(Math.random() * 11)); }

  private dig_up(): void {
    const spawner = this.components.spawner;
    if (spawner.child) {
      spawner.child.needs_home_time = this.cycle.scheduler.now;
      if (spawner.IsOccupied()) {
        spawner.SetQueueSpawning(false); spawner.onvacate = child => child.onHomeDugUp(); spawner.ReleaseChild();
      }
    }
    // lootdropper: one random loot by weight.
    let roll = Math.random() * 7.5;
    for (const [prefab, weight] of [['rocks', 4], ['nitre', 1.5], ['goldnugget', .5], ['flint', 1.5]] as const) {
      roll -= weight; if (roll <= 0) { this.world.dropLoot(prefab, this.getPosition().clone()); break; }
    }
    this.components.inventory.DropEverything(); this.remove();
  }

  /** The record keeps the inventory and spawner saves together under `molehill`. */
  OnSave(_inst: unknown, data: PlacementSaveRecord['components']): void {
    const { spawner, inventory } = this.components;
    delete (data as { inventory?: unknown }).inventory;
    data.molehill = { items: inventory.OnSave(),
      ...(spawner.IsOccupied() ? { child: spawner.child!.entity.snapshot() }
        : spawner.child && !spawner.child.isDead() ? { childid: spawner.child.id }
        : this.pendingChildId ? { childid: this.pendingChildId }
        : spawner.remainingSeconds === undefined ? {} : { startdelay: spawner.remainingSeconds }) };
  }

  OnLoad(_inst: unknown, data: PlacementSaveRecord['components']): void {
    const saved = data.molehill;
    if (!saved) return;
    const { spawner, inventory } = this.components, world = this.world;
    inventory.OnLoad(saved.items, world.spawnItem);
    if (saved.child) {
      spawner.CancelSpawning();
      const entity = world.spawnItem(saved.child); configureMoleEntity(entity);
      const child = entity.getComponent<Mole>('mole')!; child.bindWorld(world);
      const position = this.getPosition();
      entity.setPosition(position.x, position.y, position.z); world.showMole(entity, position);
      spawner.TakeOwnership(child); spawner.GoHome(child);
    } else if (saved.childid) {
      spawner.CancelSpawning();
      this.pendingChildId = saved.childid;
      this.stopPending = world.findMole(saved.childid, child => {
        this.pendingChildId = undefined; this.stopPending = undefined; spawner.TakeOwnership(child);
      });
    } else spawner.SpawnWithDelay(saved.startdelay ?? 0);
  }
}

/** The Prefab molehill.lua returns. */
export function molehillPrefabs(world: MoleHabitat): Readonly<Record<typeof MOLEHILL_ID, PrefabEntityDefinition<MolehillInstance>>> {
  return {
    [MOLEHILL_ID]: {
      fn: position => new MolehillInstance(world, position),
      assets: { animationArchive: 'mole_basic.zip', buildArchives: ['mole_build.zip'], bank: 'mole' },
      onSpawned: inst => {
        inst.OnInit();
        new ToolMouseTarget(actionEntity(inst.transform.model, MOLEHILL_ID), inst, inst.components.workable, world.handEquipment);
      },
    },
  };
}
