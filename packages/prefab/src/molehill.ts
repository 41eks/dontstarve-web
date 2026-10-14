import * as THREE from 'three';
import { createEffect, WorldContentKey } from '@dontstarve-web/signals';
import type { InventoryStack } from '@dontstarve-web/inventory';
import { loadAnim, loadBuild } from '@dontstarve-web/animation/animationAssets';
import { createSpriteFactory, type AnimatedSpriteFactory, type SpriteController } from '@dontstarve-web/animation/sprite';
import { Inventory } from '../../componets/src/inventory';
import { Spawner } from '../../componets/src/spawner';
import { Workable } from '../../componets/src/workable';
import type { BrainEntity } from '../../brains/src/types';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { Mole, configureMoleEntity, type MoleWorld } from './mole';

export const MOLEHILL_ID = 'molehill' as const;
// tuning.lua: day_time = 10 * 30; MOLE_RESPAWN_TIME = day_time * 4.
export const MOLE_RESPAWN_TIME = 1200;
export interface MolehillSave { items: InventoryStack[]; child?: InventoryStack; childid?: string; startdelay?: number }
export interface MolehillRecord {
  id: string; transform: { position: [number, number, number]; rotationY: number }; components: { molehill: MolehillSave };
}
export interface MoleHabitat extends MoleWorld { prepare(): Promise<void>; showMole(entity: import('@dontstarve-web/inventory').ItemEntity, position: THREE.Vector3): void }

/** molehill.lua owns the dig callback, stored minerals and its one persistent child. */
export class Molehill implements BrainEntity {
  readonly prefab = MOLEHILL_ID;
  readonly components: { inventory: Inventory; spawner: Spawner<Mole>; workable: Workable };
  private removed = false;
  private readonly events = new Map<string, Set<() => void>>();
  private readonly cleanups: (() => void)[] = [];
  pendingChildId?: string;
  readonly id: string;
  readonly model: THREE.Group;
  private readonly world: MoleHabitat;
  constructor(id: string, model: THREE.Group, world: MoleHabitat, lengths: ReadonlyMap<string, number>, saved?: MolehillSave, adopt?: Mole) {
    this.id = id; this.model = model; this.world = world;
    this.cycle = world.getWatchWorldContent(WorldContentKey.Cycle, stop => this.cleanups.push(stop));
    const inventory = new Inventory(this, 50, world.dropItem, world.itemSpecs);
    const spawner = new Spawner(this, this.cycle.scheduler, () => {
      const entity = world.spawnItem({ itemId: 'mole', count: 1 }); configureMoleEntity(entity);
      const mole = entity.getComponent<Mole>('mole')!; mole.bindWorld(world, lengths);
      // Rendering is prepared; dropping a spawned child does not invoke mole.lua's inventory-drop stun.
      world.showMole(entity, this.getPosition()); return mole;
    }, MOLE_RESPAWN_TIME);
    const inst = actionEntity(model, MOLEHILL_ID);
    const workable = new Workable(inst);
    workable.SetWorkAction('DIG'); workable.SetWorkLeft(1); workable.SetOnFinishCallback(() => this.digUp());
    this.components = { inventory, spawner, workable };
    inventory.OnLoad(saved?.items ?? [], world.spawnItem);
    spawner.onoccupied = () => { if (this.cycle.peek() !== 'day') this.startSpawning(); };
    spawner.onvacate = () => this.stopSpawning();
    if (adopt) { spawner.TakeOwnership(adopt); this.stopSpawning(); }
    else if (saved?.child) {
      const entity = world.spawnItem(saved.child); configureMoleEntity(entity);
      const child = entity.getComponent<Mole>('mole')!; child.bindWorld(world, lengths);
      child.getPosition().copy(model.position); world.showMole(entity, model.position);
      spawner.TakeOwnership(child); spawner.GoHome(child);
    } else if (saved?.childid) this.pendingChildId = saved.childid;
    else spawner.SpawnWithDelay(saved?.startdelay ?? 0);
    createEffect(() => {
      if (this.cycle.get() !== 'day' && spawner.IsOccupied()) this.startSpawning(); else this.stopSpawning();
    });
    model.userData.components = this.components;
    Object.assign(model.userData, { prefab: MOLEHILL_ID, entityId: id, molehill: this, remove: () => this.remove() });
    // Workable's source inst owns tags, including DIG_workable.
    model.userData.components.workable = workable; inst.addTag('DIG_workable');
  }
  private readonly cycle;
  getPosition(): THREE.Vector3 { return this.model.position; }
  getPhysicsRadius(): number { return 0; }
  isValid(): boolean { return !this.removed; }
  hasTag(tag: string): boolean { return this.components?.workable.HasTag(tag) ?? false; }
  ListenForEvent(name: string, fn: () => void): () => void {
    let set = this.events.get(name); if (!set) this.events.set(name, set = new Set()); set.add(fn); return () => set!.delete(fn);
  }
  PushEvent(name: string): void { for (const fn of [...this.events.get(name) ?? []]) fn(); }
  private startSpawning(): void {
    const spawner = this.components.spawner; spawner.SetQueueSpawning(false);
    if (!spawner.IsSpawnPending()) spawner.SpawnWithDelay(5 + Math.floor(Math.random() * 16));
  }
  private stopSpawning(): void { this.components.spawner.SetQueueSpawning(true, 5 + Math.floor(Math.random() * 11)); }
  digUp(): void {
    if (this.removed) return;
    const spawner = this.components.spawner;
    if (spawner.child) {
      spawner.child.needs_home_time = this.cycle.scheduler.now;
      if (spawner.IsOccupied()) {
        spawner.SetQueueSpawning(false); spawner.onvacate = child => child.onHomeDugUp(); spawner.ReleaseChild();
      }
    }
    let roll = Math.random() * 7.5;
    for (const [prefab, weight] of [['rocks', 4], ['nitre', 1.5], ['goldnugget', .5], ['flint', 1.5]] as const) {
      roll -= weight; if (roll <= 0) { this.world.dropLoot(prefab, this.getPosition().clone()); break; }
    }
    this.components.inventory.DropEverything(); this.remove();
  }
  OnSave(): MolehillSave {
    const { spawner, inventory } = this.components;
    return { items: inventory.OnSave(),
      ...(spawner.IsOccupied() ? { child: spawner.child!.entity.snapshot() }
        : spawner.child && !spawner.child.isDead() ? { childid: spawner.child.id }
        : this.pendingChildId ? { childid: this.pendingChildId }
        : spawner.remainingSeconds === undefined ? {} : { startdelay: spawner.remainingSeconds }) };
  }
  remove(): void { if (this.removed) return; this.PushEvent('onremove'); this.dispose(); }
  dispose(): void {
    if (this.removed) return; this.removed = true; this.model.userData.removed = true;
    this.components.spawner.dispose(); this.components.inventory.dispose(); this.components.workable.dispose();
    this.cleanups.splice(0).forEach(stop => stop()); this.events.clear(); this.model.removeFromParent();
  }
}

export class MolehillManager {
  private readonly hills = new Map<string, Molehill>();
  private readonly moles = new Set<Mole>();
  private factory?: AnimatedSpriteFactory;
  private fxFactory?: AnimatedSpriteFactory;
  private request?: Promise<void>;
  private disposed = false;
  private lengths = new Map<string, number>();
  readonly habitat: MoleHabitat;
  private readonly scene: THREE.Scene;
  private readonly base: string;
  constructor(scene: THREE.Scene, base: string,
    services: Omit<MoleWorld, 'getMoles' | 'makeHome' | 'registerMole' | 'spawnMoveFx' | 'prepare'> & { showMole(entity: import('@dontstarve-web/inventory').ItemEntity, position: THREE.Vector3): void }) {
    this.scene = scene; this.base = base;
    this.habitat = { ...services, showMole: services.showMole,
      getMoles: () => [...this.moles], makeHome: mole => this.spawnPrepared(mole.getPosition().clone(), undefined, mole),
      registerMole: mole => { this.moles.add(mole); return () => this.moles.delete(mole); },
      spawnMoveFx: position => this.spawnMoveFx(position), prepare: () => this.prepare() };
  }
  async prepare(): Promise<void> {
    if (this.request) return this.request;
    this.request = (async () => {
      const [build, bank, fxBuild, fxBank] = await Promise.all([loadBuild('mole_build.zip', this.base), loadAnim('mole_basic.zip', this.base),
        loadBuild('mole_move_fx.zip', this.base), loadAnim('mole_move_fx.zip', this.base)]);
      if (this.disposed) return;
      this.lengths = new Map(bank.animations.map(clip => [clip.name, clip.frames.length / clip.frameRate]));
      this.factory = createSpriteFactory(build, bank); this.fxFactory = createSpriteFactory(fxBuild, fxBank);
    })();
    return this.request;
  }
  async spawn(position: THREE.Vector3, saved?: MolehillRecord): Promise<THREE.Group> { await this.prepare(); return this.spawnPrepared(position, saved).model; }
  private spawnPrepared(position: THREE.Vector3, saved?: MolehillRecord, adopt?: Mole): Molehill {
    if (this.disposed || !this.factory) throw new Error('Molehill assets unavailable');
    const model = this.factory.create({ initialAnimation: 'mound_idle', name: 'molehill' }); model.position.copy(position);
    const hill = new Molehill(saved?.id ?? newEntityId(), model, this.habitat, this.lengths, saved?.components.molehill, adopt);
    this.hills.set(hill.id, hill); this.scene.add(model); return hill;
  }
  private readonly fx = new Set<THREE.Group>();
  private spawnMoveFx(position: THREE.Vector3): void {
    if (!this.fxFactory) return;
    const model = this.fxFactory.create({ initialAnimation: 'move', name: 'mole_move_fx' });
    model.position.copy(position); this.scene.add(model); this.fx.add(model);
    (model.userData.animationController as SpriteController).playOnce('move', () => { this.fx.delete(model); this.fxFactory?.disposeSprite(model); });
  }
  update(dt: number, quaternion: THREE.Quaternion): void {
    for (const [id, hill] of this.hills) {
      if (!hill.isValid()) { this.hills.delete(id); this.factory?.disposeSprite(hill.model); continue; }
      if (hill.pendingChildId) {
        const child = [...this.moles].find(mole => mole.id === hill.pendingChildId);
        if (child) { hill.components.spawner.TakeOwnership(child); hill.pendingChildId = undefined; }
      }
      hill.model.quaternion.copy(quaternion); (hill.model.userData.animationController as SpriteController).update(dt);
    }
    for (const model of this.fx) { model.quaternion.copy(quaternion); (model.userData.animationController as SpriteController).update(dt); }
  }
  get digTargets() { return [...this.hills.values()].filter(h => h.isValid()).map(h => ({ id: h.id, model: h.model, entity: h.model.userData.actionEntity,
    position: h.getPosition(), dig: () => performToolWork('DIG', h.model.userData.actionEntity, {}), isValid: () => h.isValid() && h.components.workable.CanBeWorked() })); }
  get renderEntities() { return [...this.hills.values()].filter(h => h.isValid()).map(h => h.model).concat([...this.fx])
    .map(object => ({ object, footPosition: object.position, cameraDepth: 0 })); }
  exportRecords(): MolehillRecord[] { return [...this.hills.values()].filter(h => h.isValid()).map(h => ({ id: h.id,
    transform: { position: h.getPosition().toArray(), rotationY: 0 }, components: { molehill: h.OnSave() } })); }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const hill of this.hills.values()) { hill.dispose(); this.factory?.disposeSprite(hill.model); }
    for (const fx of this.fx) this.fxFactory?.disposeSprite(fx);
    this.fx.clear(); this.hills.clear(); this.factory?.dispose(); this.fxFactory?.dispose();
  }
}
