import * as THREE from 'three';
import { SpriteState } from '@dontstarve-web/display';
import { addComponent } from './components';
import type { CombatActor } from '../../componets/src/combat';
import type { ComponentUpdates } from '../../componets/src/componentUpdates';
import { Projectile, type ProjectileOwner, type ProjectileTarget } from '../../componets/src/projectile';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { WORLD_SCALE } from './standardcomponents';
import type { WorldFxPrefab } from './world_fx';

export const FIRE_PROJECTILE_ID = 'fire_projectile' as const;
export type StaffProjectileId = typeof FIRE_PROJECTILE_ID;

// staff_projectile.lua: SetSpeed(50); projectile.lua hitdist = 1.
const SPEED = 50 * WORLD_SCALE;
const HIT_DISTANCE = 1 * WORLD_SCALE;

export interface StaffProjectileWorld {
  fx: { spawn(prefab: WorldFxPrefab, position: THREE.Vector3): void };
  /** StartUpdatingComponent for the projectile's flight. */
  componentUpdates: ComponentUpdates;
}

export class StaffProjectileInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { projectile: Projectile };
}

/** OnHitFire: an unlit target gets a fire_fail_fx where the projectile met its edge; then Remove. */
function OnHitFire(inst: StaffProjectileInstance, target: ProjectileTarget, world: StaffProjectileWorld): void {
  if (!target.isRemoved && !(target.components as { burnable?: { IsBurning(): boolean } }).burnable?.IsBurning()) {
    const radius = target.getPhysicsRadius() + .2 * WORLD_SCALE;
    const centre = target.getPosition(), position = inst.position;
    const point = new THREE.Vector3(centre.x, 0, centre.z);
    const dx = position.x - centre.x, dz = position.z - centre.z;
    if (dx !== 0 || dz !== 0) {
      const k = radius / Math.hypot(dx, dz);
      point.x += dx * k; point.z += dz * k;
    }
    point.x += (Math.random() * 2 - 1) * .2 * WORLD_SCALE;
    point.z += (Math.random() * 2 - 1) * .2 * WORLD_SCALE;
    world.fx.spawn('fire_fail_fx', point);
  }
  inst.remove();
}

/**
 * staff_projectile.lua common("fire_spin_loop", bloom, 1) and fire(). The projectile component flies its own point; the
 * inst's transform and visibility follow it each frame, as Physics moves the source entity. Bloom is not rendered.
 */
function fire(world: StaffProjectileWorld): StaffProjectileInstance {
  const inst = new StaffProjectileInstance(FIRE_PROJECTILE_ID, new SpriteState({ name: 'fire_spin_loop', billboard: true }));
  // SetBank("projectile"), SetBuild("staff_projectile"), PlayAnimation(anim, true), SetLightOverride(1).
  inst.sprite.start('fire_spin_loop');
  inst.sprite.setLightOverride(1);
  inst.addTag('projectile');
  inst.persists = false;
  const projectile = addComponent(inst, 'projectile', Projectile);
  projectile.SetSpeed(SPEED);
  projectile.SetHitDist(HIT_DISTANCE);
  projectile.SetOnHitFn((_inst, _attacker, target) => OnHitFire(inst, target, world));
  projectile.SetOnMissFn(() => inst.remove());
  inst.onRemove(world.componentUpdates.register({
    OnUpdate: dt => {
      if (inst.isRemoved || !projectile.IsThrown()) return;
      projectile.Update(dt);
      if (inst.isRemoved) return;
      inst.copyPosition(projectile.position);
      inst.sprite.setVisible(projectile.visible);
    },
  }));
  inst.onRemove(() => projectile.Stop());
  return inst;
}

/** The Prefab staff_projectile.lua returns for the fire staff; ice_projectile is not ported. */
export function staffProjectilePrefabs(world: StaffProjectileWorld):
  Readonly<Record<StaffProjectileId, PrefabEntityDefinition<StaffProjectileInstance>>> {
  return {
    [FIRE_PROJECTILE_ID]: {
      fn: () => fire(world),
      assets: { animationArchive: 'staff_projectile.zip', buildArchives: ['staff_projectile.zip'], bank: 'projectile' },
      // Transient: drawn wherever it flies and never a mouse target.
      targetable: false, alwaysActive: true,
    },
  };
}

/**
 * weapon.lua LaunchProjectile: SpawnPrefab(self.projectile) at the attacker, then projectile:Throw(weapon, target, attacker).
 * `spawn` is the world's SpawnPrefab.
 */
export function LaunchProjectile(spawn: (prefab: StaffProjectileId, position: THREE.Vector3) => PrefabInstance | undefined,
  prefab: StaffProjectileId, owner: ProjectileOwner, target: ProjectileTarget, attacker: CombatActor): Projectile {
  const { x, z } = attacker.getPosition();
  const inst = spawn(prefab, new THREE.Vector3(x, 0, z));
  if (!(inst instanceof StaffProjectileInstance)) throw new Error(`Unable to spawn ${prefab}`);
  const projectile = inst.components.projectile;
  projectile.position.set(x, 0, z);
  projectile.Throw(owner, target, attacker);
  return projectile;
}
