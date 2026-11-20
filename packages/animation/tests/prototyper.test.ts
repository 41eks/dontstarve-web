import { expect, it, vi } from 'vitest';
import { Group, Scene, Vector3 } from 'three';
import { Builder } from '../../componets/src/builder';
import { Prototyper } from '../../componets/src/prototyper';
import { CreateTechTree } from '../../componets/src/techtree';
import { registerActionEntity } from '../../prefab/src/actionEntity';
import { testEnts } from './entsFixture';
import { WORLD_SCALE } from '../../prefab/src/standardcomponents';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { entityOf } from './entityFixture';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bindTestWorld } from './worldContentFixture';

function setup() {
  const scene = new Scene(),
    ents = testEnts();
  const entity = (prefab: string, position = new Vector3()) => {
    const inst = ents.track(entityOf(new Group(), prefab)),
      model = inst.transform.model;
    inst.setPosition(position.x, position.y, position.z);
    scene.add(model);
    registerActionEntity(prefabInstance(model)!);
    return inst;
  };
  const player = entity('waxwell');
  const builder = new Builder(player, {
    findEntities: (...args) => ents.prefabs.FindEntities(...args) as never,
    researchMachineDistance: 4 * WORLD_SCALE,
    entitiesChanged: ents.prefabs.entitiesChanged,
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

it('reacts to position, station creation/removal, tags and technology without frame updates', async () => {
  const scheduler = new GameTimeScheduler(),
    world = bindTestWorld(scheduler);
  const { station, builder, player } = setup();
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  const publish = () => world.playerpositions.set([player.getPosition().clone()]);
  const near = station(new Vector3(3, 0, 0), { SCIENCE: 1 });
  let other: ReturnType<typeof station> | undefined;
  try {
    await settle();
    expect(builder.current_prototyper).toBe(near.inst);
    const evaluate = vi.spyOn(builder, 'EvaluateTechTrees');
    scheduler.advance(60);
    await settle();
    expect(evaluate).not.toHaveBeenCalled();
    near.prototyper.SetTechLevel('SCIENCE', 2);
    await settle();
    expect(builder.accessible_tech_trees.peek().SCIENCE).toBe(2);
    other = station(new Vector3(1, 0, 0), { MAGIC: 1 });
    await settle();
    expect(builder.current_prototyper).toBe(other.inst);
    other.inst.addTag('fire');
    await settle();
    expect(builder.current_prototyper).toBe(near.inst);
    near.inst.remove();
    await settle();
    expect(builder.current_prototyper).toBeUndefined();
    other.inst.removeTag('fire');
    await settle();
    player.setPosition(40, 0, 0);
    publish();
    await settle();
    expect(other.prototyper.on).toBe(false);
    builder.dispose();
    evaluate.mockClear();
    player.setPosition(0, 0, 0);
    publish();
    await settle();
    expect(evaluate).not.toHaveBeenCalled();
  } finally {
    builder.dispose();
    near.prototyper.OnRemoveFromEntity();
    other?.prototyper.OnRemoveFromEntity();
    world.unbind();
    scheduler.dispose();
  }
});

it('selects only the nearest eligible station at the scaled radius and clears its tech when leaving', () => {
  const { station, builder, player } = setup();
  const farther = station(new Vector3(8, 0, 0), { SCIENCE: 2, MAGIC: 1 });
  const nearer = station(new Vector3(4, 0, 0), { SCIENCE: 1, MAGIC: 1 });
  const events = vi.spyOn(player, 'PushEvent');
  try {
    builder.EvaluateTechTrees();
    expect(builder.current_prototyper).toBe(nearer.inst);
    expect(nearer.prototyper.on).toBe(true);
    expect(farther.prototyper.on).toBe(false);
    expect(builder.accessible_tech_trees.peek()).toMatchObject({ SCIENCE: 1, MAGIC: 1, ANCIENT: 0 });
    builder.EvaluateTechTrees();
    expect(events).toHaveBeenCalledTimes(1);
    player.setPosition(8, 0, 0);
    builder.EvaluateTechTrees();
    expect(builder.current_prototyper).toBe(farther.inst);
    expect(nearer.prototyper.on).toBe(false);
    expect(builder.accessible_tech_trees.peek().SCIENCE).toBe(2);
    // Lua's 4 units use TILE_SIZE / 4, with one boundary and no exit hysteresis.
    player.setPosition(8 + 4 * WORLD_SCALE, 0, 0);
    builder.EvaluateTechTrees();
    expect(farther.prototyper.on).toBe(true);
    player.setPosition(player.position.x + 0.001, 0, 0);
    builder.EvaluateTechTrees();
    expect(builder.current_prototyper).toBeUndefined();
    expect(farther.prototyper.on).toBe(false);
    expect(builder.accessible_tech_trees.peek()).toMatchObject({ SCIENCE: 0, MAGIC: 0 });
  } finally {
    builder.dispose();
    nearer.prototyper.OnRemoveFromEntity();
    farther.prototyper.OnRemoveFromEntity();
  }
});

it('honours restricted tags, fire/INLIMBO, explicit selection and crafting disablement', () => {
  const { station, builder, player } = setup();
  const first = station(new Vector3(1, 0, 0), { MAGIC: 2 });
  const second = station(new Vector3(2, 0, 0), { MAGIC: 3 });
  try {
    first.prototyper.restrictedtag = 'magician';
    builder.EvaluateTechTrees();
    expect(builder.current_prototyper).toBe(second.inst);
    expect(builder.UsePrototyper(first.inst)).toBe(false);
    player.addTag('magician');
    expect(builder.UsePrototyper(first.inst)).toBe(true);
    builder.EvaluateTechTrees();
    expect(builder.current_prototyper).toBe(first.inst);
    first.inst.addTag('fire');
    builder.EvaluateTechTrees();
    expect(builder.current_prototyper).toBe(second.inst);
    expect(first.prototyper.on).toBe(false);
    second.inst.addTag('INLIMBO');
    builder.EvaluateTechTrees();
    expect(builder.current_prototyper).toBeUndefined();
    first.inst.removeTag('fire');
    builder.EvaluateTechTrees();
    expect(first.prototyper.on).toBe(true);
    builder.SetCraftingEnabled(false);
    builder.EvaluateTechTrees();
    expect(first.prototyper.on).toBe(false);
    expect(builder.UsePrototyper(first.inst)).toBe(false);
  } finally {
    builder.dispose();
    first.prototyper.OnRemoveFromEntity();
    second.prototyper.OnRemoveFromEntity();
  }
});

it('keeps a station on for its other doers and releases removal listeners on component teardown', async () => {
  const { station, builder, player, entity } = setup();
  const { inst, prototyper } = station(new Vector3(), { SCIENCE: 1 });
  const other = entity('wilson');
  const on = vi.fn();
  const off = vi.fn();
  prototyper.onturnon = on;
  prototyper.onturnoff = off;
  builder.EvaluateTechTrees();
  prototyper.TurnOn(other);
  prototyper.TurnOn(other);
  expect(on).toHaveBeenCalledOnce();
  builder.dispose();
  expect(prototyper.on).toBe(true);
  other.remove();
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
  player.remove();
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(off).toHaveBeenCalledTimes(2);
});
