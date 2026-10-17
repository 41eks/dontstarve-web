import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { Burnable } from '../../componets/src/burnable';
import { Combat, type CombatActor } from '../../componets/src/combat';
import { getFireStaffController } from '../../prefab/src/firestaff';
import { StaffProjectileManager } from '../../prefab/src/staff_projectile';
import { createInventoryStore } from '../../../src/inventory';
import { inventorySlotAddress } from '../../inventory/src';
import { executeDebugCommand } from '../../../src/debugCommands';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop: vi.fn() })) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function setup() {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
  const inventory = createInventoryStore([{ slot_index: 0, id: 'firestaff', num: 1 }]), scene = new THREE.Scene();
  const fx = { prepare: vi.fn(async () => {}), spawn: vi.fn() };
  const projectiles = new StaffProjectileManager(scene, { fx });
  const staff = inventory.getEntity(inventorySlotAddress(0))!;
  const sanity = vi.fn();
  const attacker: CombatActor = {
    getPosition: () => new THREE.Vector3(0, 0, 0), getPhysicsRadius: () => .5, hasTag: tag => tag === 'player',
    components: { sanity: { doDelta: sanity } },
  };
  const combat = new Combat(attacker, () => 0, () => staff.components.weapon);
  combat.SetRange(2);
  attacker.components.combat = combat;
  getFireStaffController(staff, { prepare: () => projectiles.prepare(), launch: (owner, target, from) => projectiles.launch(owner, target, from) });
  const tags = new Set<string>();
  const target = {
    isRemoved: false, prefab: 'evergreen', components: {} as { burnable?: Burnable; combat?: Combat },
    getPosition: () => new THREE.Vector3(12, 0, 0), getPhysicsRadius: () => 1,
    hasTag: (tag: string) => tags.has(tag), addTag: (tag: string) => { tags.add(tag); }, removeTag: (tag: string) => { tags.delete(tag); },
    PushEvent: vi.fn(),
  };
  target.components.burnable = new Burnable(target as never);
  const fly = (seconds: number) => { for (let t = 0; t < seconds; t += 1 / 60) projectiles.update(1 / 60, new THREE.Quaternion()); };
  return { inventory, staff, combat, sanity, target, projectiles, fx, fly,
    dispose: () => { projectiles.dispose(); inventory.dispose(); } };
}

it('shoots a burnable from range, lights it on impact, and wears one use and one sanity point per shot', async () => {
  const s = setup();
  try {
    expect(['firestaff', 'rangedweapon', 'rangedlighter'].every(tag => s.staff.hasTag(tag))).toBe(true);
    expect(s.staff.components.weapon!.attackrange).toBeGreaterThan(0);
    await s.projectiles.prepare();
    expect(s.combat.CanLightTarget(s.target as never)).toBe(true);
    expect(s.combat.DoAttack(s.target as never)).toBe(true);
    // Nothing happens until the projectile arrives.
    expect(s.target.components.burnable!.IsBurning()).toBe(false);
    s.fly(2);
    expect(s.target.components.burnable!.IsBurning()).toBe(true);
    expect(s.sanity).toHaveBeenCalledWith(-1);
    expect(s.staff.components.finiteuses.remaining).toBe(19);
    expect(s.target.PushEvent).toHaveBeenCalledWith('attacked', expect.objectContaining({ damage: 0 }));
    // A burning target is no longer a light target, and an unlit hit would have left fire_fail_fx.
    expect(s.combat.CanLightTarget(s.target as never)).toBe(false);
  } finally { s.dispose(); }
});

it('misses without cost when the target is removed in flight', async () => {
  const s = setup();
  try {
    await s.projectiles.prepare();
    s.combat.DoAttack(s.target as never);
    s.target.isRemoved = true;
    s.fly(2);
    expect(s.target.components.burnable!.IsBurning()).toBe(false);
    expect(s.staff.components.finiteuses.remaining ?? 20).toBe(20);
    expect(s.sanity).not.toHaveBeenCalled();
    expect(s.projectiles.renderEntities).toEqual([]);
  } finally { s.dispose(); }
});

it('is available through c_give with its source tags and 20 uses', async () => {
  const inventory = createInventoryStore([]);
  try {
    expect((await executeDebugCommand('c_give("firestaff")', inventory, id => { throw new Error(`unexpected spawn ${id}`); })).ok).toBe(true);
    const staff = inventory.getEntity(inventorySlotAddress(0))!;
    expect([staff.prefab, staff.hasTag('rangedlighter'), staff.components.finiteuses.maximum]).toEqual(['firestaff', true, 20]);
  } finally { inventory.dispose(); }
});
