import { definePrefabIds } from './prefabRegistration';
import * as THREE from 'three';
import { SpriteState } from '@dontstarve-web/display';
import { addComponent } from './components';
import type { CombatActor } from '../../componets/src/combat';
import type { ComponentUpdates } from '../../componets/src/componentUpdates';
import { Projectile, type ProjectileOwner, type ProjectileTarget } from '../../componets/src/projectile';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { WORLD_SCALE } from './standardcomponents';
import type { WorldFx, WorldFxPrefab } from './world_fx';

export const FIRE_PROJECTILE_ID = 'fire_projectile' as const;
export const ICE_PROJECTILE_ID = 'ice_projectile' as const;
export type StaffProjectileId = typeof FIRE_PROJECTILE_ID | typeof ICE_PROJECTILE_ID;

// staff_projectile.lua: SetSpeed(50); projectile.lua hitdist = 1.
const SPEED = 50 * WORLD_SCALE;
const HIT_DISTANCE = 1 * WORLD_SCALE;

export interface StaffProjectileWorld {
  fx: { spawn(prefab: WorldFxPrefab, position: THREE.Vector3): void } & Pick<WorldFx, 'shatter'>;
  /** StartUpdatingComponent for the projectile's flight. */
  componentUpdates: ComponentUpdates;
}

export class StaffProjectileInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & { projectile: Projectile };
}

/** OnHitFire: an unlit target gets a fire_fail_fx where the projectile met its edge; then Remove. */
function OnHitFire(inst: StaffProjectileInstance, target: ProjectileTarget, world: StaffProjectileWorld): void {
  if (!target.isRemoved && !(target.components as { burnable?: { IsBurning(): boolean } }).burnable?.IsBurning()) {
    const radius = target.getPhysicsRadius() + 0.2 * WORLD_SCALE;
    const centre = target.getPosition(),
      position = inst.position;
    const point = new THREE.Vector3(centre.x, 0, centre.z);
    const dx = position.x - centre.x,
      dz = position.z - centre.z;
    if (dx !== 0 || dz !== 0) {
      const k = radius / Math.hypot(dx, dz);
      point.x += dx * k;
      point.z += dz * k;
    }
    point.x += (Math.random() * 2 - 1) * 0.2 * WORLD_SCALE;
    point.z += (Math.random() * 2 - 1) * 0.2 * WORLD_SCALE;
    world.fx.spawn('fire_fail_fx', point);
  }
  inst.remove();
}

/** OnHitIce: a target that cannot freeze shatters a level 2 shatter fx where it stands; then Remove. */
function OnHitIce(inst: StaffProjectileInstance, target: ProjectileTarget, world: StaffProjectileWorld): void {
  if (!target.isRemoved && !target.hasTag('freezable')) {
    const { x, y, z } = target.getPosition();
    world.fx.shatter(new THREE.Vector3(x, y, z), 2);
  }
  inst.remove();
}

/**
 * staff_projectile.lua common("fire_spin_loop", bloom, 1) and fire(). The projectile component flies its own point; the
 * inst's transform and visibility follow it each frame, as Physics moves the source entity. Bloom is not rendered.
 */
function fire(world: StaffProjectileWorld): StaffProjectileInstance {
  const inst = common(FIRE_PROJECTILE_ID, 'fire_spin_loop', 1, world);
  inst.components.projectile.SetOnHitFn((_inst, _attacker, target) => OnHitFire(inst, target, world));
  return inst;
}

/** staff_projectile.lua ice(): common("ice_spin_loop") with OnHitIce. */
function ice(world: StaffProjectileWorld): StaffProjectileInstance {
  const inst = common(ICE_PROJECTILE_ID, 'ice_spin_loop', undefined, world);
  inst.components.projectile.SetOnHitFn((_inst, _attacker, target) => OnHitIce(inst, target, world));
  return inst;
}

/**
 * staff_projectile.lua common(anim, bloom, lightoverride). The projectile component flies its own point; the inst's
 * transform and visibility follow it each frame, as Physics moves the source entity. Bloom is not rendered.
 */
function common(
  prefab: StaffProjectileId,
  anim: string,
  lightoverride: number | undefined,
  world: StaffProjectileWorld,
): StaffProjectileInstance {
  const inst = new StaffProjectileInstance(prefab, new SpriteState({ name: anim, billboard: true }));
  // SetBank("projectile"), SetBuild("staff_projectile"), PlayAnimation(anim, true), SetLightOverride(lightoverride).
  inst.sprite.start(anim);
  if (lightoverride !== undefined) {
    inst.sprite.setLightOverride(lightoverride);
  }
  inst.addTag('projectile');
  inst.persists = false;
  const projectile = addComponent(inst, 'projectile', Projectile);
  projectile.SetSpeed(SPEED);
  projectile.SetHitDist(HIT_DISTANCE);
  projectile.SetOnHitFn(() => inst.remove());
  projectile.SetOnMissFn(() => inst.remove());
  inst.onRemove(
    world.componentUpdates.register({
      OnUpdate: dt => {
        if (inst.isRemoved || !projectile.IsThrown()) {
          return;
        }
        projectile.Update(dt);
        if (inst.isRemoved) {
          return;
        }
        inst.copyPosition(projectile.position);
        inst.sprite.setVisible(projectile.visible);
      },
    }),
  );
  inst.onRemove(() => projectile.Stop());
  return inst;
}

/** The Prefabs staff_projectile.lua returns: the fire and ice staffs' projectiles. */
export function staffProjectilePrefabs(
  world: StaffProjectileWorld,
): Readonly<Record<StaffProjectileId, PrefabEntityDefinition<StaffProjectileInstance>>> {
  return {
    [FIRE_PROJECTILE_ID]: {
      fn: () => fire(world),
      assets: { animationArchive: 'staff_projectile.zip', buildArchives: ['staff_projectile.zip'], bank: 'projectile' },
      // Transient: drawn wherever it flies and never a mouse target.
      targetable: false,
      alwaysActive: true,
    },
    [ICE_PROJECTILE_ID]: {
      fn: () => ice(world),
      assets: { animationArchive: 'staff_projectile.zip', buildArchives: ['staff_projectile.zip'], bank: 'projectile' },
      // Transient: drawn wherever it flies and never a mouse target.
      targetable: false,
      alwaysActive: true,
    },
  };
}

export const staffProjectileRegistration = {
  create: staffProjectilePrefabs,
  families: { staffProjectiles: definePrefabIds([]) },
};

/**
 * weapon.lua LaunchProjectile: SpawnPrefab(self.projectile) at the attacker, then projectile:Throw(weapon, target, attacker).
 * `spawn` is the world's SpawnPrefab.
 */
export function LaunchProjectile(
  spawn: (prefab: StaffProjectileId, position: THREE.Vector3) => PrefabInstance | undefined,
  prefab: StaffProjectileId,
  owner: ProjectileOwner,
  target: ProjectileTarget,
  attacker: CombatActor,
): Projectile {
  const { x, z } = attacker.getPosition();
  const inst = spawn(prefab, new THREE.Vector3(x, 0, z));
  if (!(inst instanceof StaffProjectileInstance)) {
    throw new Error(`Unable to spawn ${prefab}`);
  }
  const projectile = inst.components.projectile;
  projectile.position.set(x, 0, z);
  projectile.Throw(owner, target, attacker);
  return projectile;
}
