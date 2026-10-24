import { expect, it, vi } from 'vitest';
import { Group, Scene, Vector3 } from 'three';
import { Builder } from '../../componets/src/builder';
import { Prototyper } from '../../componets/src/prototyper';
import { CreateTechTree } from '../../componets/src/techtree';
import { actionEntity, FindEntities } from '../../prefab/src/actionEntity';
import { WORLD_SCALE } from '../../prefab/src/standardcomponents';

function setup() {
  const scene = new Scene();
  const entity = (prefab: string, position = new Vector3()) => {
    const model = new Group();
    model.position.copy(position);
    scene.add(model);
    return actionEntity(model, prefab);
  };
  const player = entity('waxwell');
  const builder = new Builder(player, {
    findEntities: (...args) => FindEntities(scene, ...args), researchMachineDistance: 4 * WORLD_SCALE,
  });
  const station = (position: Vector3, levels: Record<string, number>) => {
    const inst = entity('station', position);
    const prototyper = new Prototyper(inst, 4 * WORLD_SCALE);
    prototyper.trees = CreateTechTree(levels);
    inst.components.prototyper = prototyper;
    return { inst, prototyper };
  };
  return { scene, entity, player, builder, station };
}

it('selects only the nearest eligible station at the scaled radius and clears its tech when leaving', () => {
  const { station, builder, player } = setup();
  const farther = station(new Vector3(8, 0, 0), { SCIENCE: 2, MAGIC: 1 });
  const nearer = station(new Vector3(4, 0, 0), { SCIENCE: 1, MAGIC: 1 });
  const events = vi.spyOn(player, 'PushEvent');
  try {
    builder.OnUpdate();
    expect(builder.current_prototyper).toBe(nearer.inst);
    expect(nearer.prototyper.on).toBe(true);
    expect(farther.prototyper.on).toBe(false);
    expect(builder.accessible_tech_trees.peek()).toMatchObject({ SCIENCE: 1, MAGIC: 1, ANCIENT: 0 });
    builder.OnUpdate();
    expect(events).toHaveBeenCalledTimes(1);
    player.model.position.set(8, 0, 0);
    builder.OnUpdate();
    expect(builder.current_prototyper).toBe(farther.inst);
    expect(nearer.prototyper.on).toBe(false);
    expect(builder.accessible_tech_trees.peek().SCIENCE).toBe(2);
    // Lua's 4 units use TILE_SIZE / 4, with one boundary and no exit hysteresis.
    player.model.position.set(8 + 4 * WORLD_SCALE, 0, 0);
    builder.OnUpdate();
    expect(farther.prototyper.on).toBe(true);
    player.model.position.x += .001;
    builder.OnUpdate();
    expect(builder.current_prototyper).toBeUndefined();
    expect(farther.prototyper.on).toBe(false);
    expect(builder.accessible_tech_trees.peek()).toMatchObject({ SCIENCE: 0, MAGIC: 0 });
  } finally { builder.dispose(); nearer.prototyper.OnRemoveFromEntity(); farther.prototyper.OnRemoveFromEntity(); }
});

it('honours restricted tags, fire/INLIMBO, explicit selection and crafting disablement', () => {
  const { station, builder, player } = setup();
  const first = station(new Vector3(1, 0, 0), { MAGIC: 2 });
  const second = station(new Vector3(2, 0, 0), { MAGIC: 3 });
  try {
    first.prototyper.restrictedtag = 'magician';
    builder.OnUpdate();
    expect(builder.current_prototyper).toBe(second.inst);
    expect(builder.UsePrototyper(first.inst)).toBe(false);
    player.addTag('magician');
    expect(builder.UsePrototyper(first.inst)).toBe(true);
    builder.OnUpdate();
    expect(builder.current_prototyper).toBe(first.inst);
    first.inst.addTag('fire');
    builder.OnUpdate();
    expect(builder.current_prototyper).toBe(second.inst);
    expect(first.prototyper.on).toBe(false);
    second.inst.addTag('INLIMBO');
    builder.OnUpdate();
    expect(builder.current_prototyper).toBeUndefined();
    first.inst.removeTag('fire');
    builder.OnUpdate();
    expect(first.prototyper.on).toBe(true);
    builder.SetCraftingEnabled(false);
    builder.OnUpdate();
    expect(first.prototyper.on).toBe(false);
    expect(builder.UsePrototyper(first.inst)).toBe(false);
  } finally { builder.dispose(); first.prototyper.OnRemoveFromEntity(); second.prototyper.OnRemoveFromEntity(); }
});

it('keeps a station on for its other doers and releases removal listeners on component teardown', async () => {
  const { station, builder, player, entity } = setup();
  const { inst, prototyper } = station(new Vector3(), { SCIENCE: 1 });
  const other = entity('wilson');
  const on = vi.fn();
  const off = vi.fn();
  prototyper.onturnon = on;
  prototyper.onturnoff = off;
  builder.OnUpdate();
  prototyper.TurnOn(other);
  prototyper.TurnOn(other);
  expect(on).toHaveBeenCalledOnce();
  builder.dispose();
  expect(prototyper.on).toBe(true);
  other.model.userData.removed = true;
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(prototyper.on).toBe(false);
  expect(off).toHaveBeenCalledOnce();
  prototyper.TurnOn(player);
  const copy = prototyper.GetTechTrees();
  copy.SCIENCE = 99;
  expect(prototyper.trees.SCIENCE).toBe(1);
  prototyper.OnRemoveFromEntity();
  prototyper.OnRemoveFromEntity();
  expect(inst.hasTag('prototyper')).toBe(false);
  expect(off).toHaveBeenCalledTimes(2);
  player.model.userData.removed = true;
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(off).toHaveBeenCalledTimes(2);
});
