import { PrefabDisplayGroup } from '@dontstarve-web/display';
import * as THREE from 'three';
import { SpriteResources } from '@dontstarve-web/display';
import { createArchiveEntity } from './prefabInstance';
import type { CombatActor } from '../../componets/src/combat';
import { Projectile, type ProjectileOwner, type ProjectileTarget } from '../../componets/src/projectile';
import { WORLD_SCALE } from './standardcomponents';
import type { WorldFxPrefab } from './world_fx';

export const FIRE_PROJECTILE_ID = 'fire_projectile' as const;
export type StaffProjectileId = typeof FIRE_PROJECTILE_ID;

// staff_projectile.lua: SetSpeed(50); projectile.lua hitdist = 1.
const SPEED = 50 * WORLD_SCALE;
const HIT_DISTANCE = 1 * WORLD_SCALE;
export interface StaffProjectileWorld {
  fx: { spawn(prefab: WorldFxPrefab, position: THREE.Vector3): void };
}

interface ActiveProjectile { component: Projectile; entity?: ReturnType<typeof createArchiveEntity>; removed: boolean }

/** staff_projectile.lua: transient (persists = false) projectiles flown by components/projectile. */
export class StaffProjectileManager {
  private readonly displays: PrefabDisplayGroup;
  private readonly world: StaffProjectileWorld;
  private readonly resources = new SpriteResources();
  private readonly active = new Set<ActiveProjectile>();
  private disposed = false;

  constructor(scene: THREE.Scene, world: StaffProjectileWorld) {
    this.displays = new PrefabDisplayGroup(scene); this.world = world;
  }

  /** Weapon:LaunchProjectile → SpawnPrefab("fire_projectile") at the attacker, then projectile:Throw. */
  launch(owner: ProjectileOwner, target: ProjectileTarget, attacker: CombatActor): Projectile {
    if (this.disposed) throw new Error('Staff projectiles have been disposed');
    const component = new Projectile();
    component.SetSpeed(SPEED); component.SetHitDist(HIT_DISTANCE);
    component.position.copy(attacker.getPosition()).setY(0);
    const entry: ActiveProjectile = { component, removed: false };
    // OnHitFire / inst.Remove for a miss.
    component.SetOnHitFn((_, __, hit) => { this.onHitFire(component, hit); this.remove(entry); });
    component.SetOnMissFn(() => this.remove(entry));
    component.Throw(owner, target, attacker);
    this.active.add(entry);
    this.attach(entry);
    return component;
  }

  private attach(entry: ActiveProjectile): void {
    const entity = entry.entity = createArchiveEntity(FIRE_PROJECTILE_ID, this.resources.archive({ animationArchive: 'staff_projectile.zip',
      buildArchives: ['staff_projectile.zip'], bank: 'projectile' }),
      { name: 'fire_spin_loop', billboard: true }, FIRE_PROJECTILE_ID);
    entity.instance.persists = false;
    entity.instance.addTag('projectile');
    entity.instance.position.copy(entry.component.position);
    entity.display.model.visible = entry.component.visible;
    this.displays.mount(entity.display);
  }

  /** staff_projectile.lua OnHitFire: an unlit target gets a fire_fail_fx where the projectile met its edge. */
  private onHitFire(projectile: Projectile, target: ProjectileTarget): void {
    if (target.isRemoved) return;
    const burnable = (target.components as { burnable?: { IsBurning(): boolean } }).burnable;
    if (burnable?.IsBurning()) return;
    const radius = target.getPhysicsRadius() + .2 * WORLD_SCALE;
    const centre = target.getPosition();
    const point = new THREE.Vector3(centre.x, 0, centre.z);
    const dx = projectile.position.x - centre.x, dz = projectile.position.z - centre.z;
    if (dx !== 0 || dz !== 0) {
      const k = radius / Math.hypot(dx, dz);
      point.x += dx * k; point.z += dz * k;
    }
    point.x += (Math.random() * 2 - 1) * .2 * WORLD_SCALE;
    point.z += (Math.random() * 2 - 1) * .2 * WORLD_SCALE;
    this.world.fx.spawn('fire_fail_fx', point);
  }

  update(dt: number, _quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    for (const entry of [...this.active]) {
      entry.component.Update(dt);
      if (entry.removed || !entry.entity) continue;
      const { instance, display: { model } } = entry.entity;
      instance.position.copy(entry.component.position);
      model.visible = entry.component.visible;
      instance.sprite.update(dt);
    }
  }

  get renderEntities() {
    return [...this.active].flatMap(({ component, entity }) => entity
      ? [{ object: entity.display.model, footPosition: component.position, cameraDepth: 0 }] : []);
  }

  private remove(entry: ActiveProjectile): void {
    if (entry.removed) return;
    entry.removed = true;
    this.active.delete(entry);
    entry.component.Stop();
    if (entry.entity) { entry.entity.instance.remove(); entry.entity.display.dispose(); }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of [...this.active]) this.remove(entry);
    this.displays.dispose();
    this.resources.dispose();
  }
}
