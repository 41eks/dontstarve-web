import * as THREE from 'three';
import { createArchiveSprite, ArchiveSpriteAssets, type ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { CombatActor } from '../../componets/src/combat';
import { Projectile, type ProjectileOwner, type ProjectileTarget } from '../../componets/src/projectile';
import { WORLD_SCALE } from './standardcomponents';
import type { WorldFxPrefab } from './world_fx';

export const FIRE_PROJECTILE_ID = 'fire_projectile' as const;
export type StaffProjectileId = typeof FIRE_PROJECTILE_ID;

// staff_projectile.lua: SetSpeed(50); projectile.lua hitdist = 1.
const SPEED = 50 * WORLD_SCALE;
const HIT_DISTANCE = 1 * WORLD_SCALE;
/** Sprites kept ready so a launch never waits on archive decoding. */
const READY_SPRITES = 2;

export interface StaffProjectileWorld {
  fx: { prepare(prefab: WorldFxPrefab): Promise<void>; spawn(prefab: WorldFxPrefab, position: THREE.Vector3): void };
}

interface ActiveProjectile { component: Projectile; sprite?: ArchiveSprite; removed: boolean }

/** staff_projectile.lua: transient (persists = false) projectiles flown by components/projectile. */
export class StaffProjectileManager {
  private readonly scene: THREE.Scene;
  private readonly world: StaffProjectileWorld;
  private readonly assets = new ArchiveSpriteAssets();
  private readonly ready: ArchiveSprite[] = [];
  private readonly active = new Set<ActiveProjectile>();
  private pending = 0;
  private fxReady = false;
  private disposed = false;

  constructor(scene: THREE.Scene, world: StaffProjectileWorld) {
    this.scene = scene; this.world = world;
  }

  /** Load the art and the fire_fail_fx an unlit hit leaves behind. */
  async prepare(): Promise<void> {
    if (this.disposed) throw new Error('Staff projectiles have been disposed');
    await Promise.all([this.world.fx.prepare('fire_fail_fx').then(() => { this.fxReady = true; }), this.fill()]);
  }

  private async fill(): Promise<void> {
    while (!this.disposed && this.ready.length + this.pending < READY_SPRITES) {
      this.pending++;
      try {
        const sprite = await createArchiveSprite(this.assets, { animationArchive: 'staff_projectile.zip',
          buildArchives: ['staff_projectile.zip'], bank: 'projectile', animation: 'fire_spin_loop', loop: true }, { name: FIRE_PROJECTILE_ID });
        if (this.disposed) sprite.dispose(); else this.ready.push(sprite);
      } finally { this.pending--; }
    }
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
    const sprite = this.ready.shift();
    if (sprite) this.attach(entry, sprite);
    void this.fill().catch((error: unknown) => console.error('Unable to prepare staff projectile', error));
    return component;
  }

  private attach(entry: ActiveProjectile, sprite: ArchiveSprite): void {
    entry.sprite = sprite;
    Object.assign(sprite.model.userData, { prefab: FIRE_PROJECTILE_ID, persists: false, tags: ['projectile'] });
    sprite.model.position.copy(entry.component.position);
    sprite.model.visible = entry.component.visible;
    this.scene.add(sprite.model);
  }

  /** staff_projectile.lua OnHitFire: an unlit target gets a fire_fail_fx where the projectile met its edge. */
  private onHitFire(projectile: Projectile, target: ProjectileTarget): void {
    if (target.isRemoved || !this.fxReady) return;
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

  update(dt: number, quaternion: THREE.Quaternion): void {
    if (this.disposed) return;
    for (const entry of [...this.active]) {
      entry.component.Update(dt);
      if (!entry.removed && !entry.sprite && this.ready.length > 0) this.attach(entry, this.ready.shift()!);
      if (entry.removed || !entry.sprite) continue;
      const { model } = entry.sprite;
      model.position.copy(entry.component.position);
      model.visible = entry.component.visible;
      model.quaternion.copy(quaternion);
      entry.sprite.update(dt);
    }
  }

  get renderEntities() {
    return [...this.active].flatMap(({ component, sprite }) => sprite
      ? [{ object: sprite.model, footPosition: component.position, cameraDepth: 0 }] : []);
  }

  private remove(entry: ActiveProjectile): void {
    if (entry.removed) return;
    entry.removed = true;
    this.active.delete(entry);
    entry.component.Stop();
    if (entry.sprite) { entry.sprite.model.removeFromParent(); entry.sprite.dispose(); }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of [...this.active]) this.remove(entry);
    for (const sprite of this.ready.splice(0)) sprite.dispose();
    this.assets.dispose();
  }
}
