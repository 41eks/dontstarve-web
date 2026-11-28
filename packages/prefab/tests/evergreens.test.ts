import { createPlayerEquipper } from '../../../tests/fixtures/playerEquipFixture';
import { testPlayer } from '../../../tests/fixtures/testPlayer';
import type { Growable } from '../../componets/src/growable';
import { advancePlayer } from '../../../tests/fixtures/playerVisual';
import { playerDoer } from '../../../tests/fixtures/playerDoer';
import { collectEquippedItemActions } from '../../stategraphs/src/componentactions';
import { prefabInstance } from '../src/prefabInstance';
import { prefabInstance as lookupPrefabInstance } from '../src/prefabInstance';
import * as THREE from 'three';
import { createTestArea, useTestTileMap } from '../../../tests/fixtures/tileMapFixture';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { evergreenPrefabs } from '../src/evergreens';
import { treeWorld } from '../../../tests/fixtures/treeManagerFixture';
import { performToolWork } from '../../stategraphs/src/componentactions';
import { PlaySound } from '../src/sound';
import { createPickupInventory } from '../../../tests/fixtures/pickupFixture';
import { equipmentSlotAddress, inventorySlotAddress } from '../../inventory/src';
import { playerInst, createPlayer } from '../../../tests/fixtures/playerVisual';
import type { ActionWorldContext } from '../../stategraphs/src/actionContext';
import { workTargets } from '../../../tests/fixtures/workTargets';
import { bindTestWorld, drawn } from '../../../tests/fixtures/worldContentFixture';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PlayerController } from '../../stategraphs/src/playercontroller';
import { Locomotor } from '../src/locomotor';
import { WORLD_SCALE } from '../src/tile';
import { prefabDisplay } from '@dontstarve-web/display';
import type { LunarHailBuildup } from '../../componets/src/lunarhailbuildup';
import { deserializeSave } from '../../../src/save/deserialize';
import { SAVE_CATALOG } from '../../../src/save/catalog';

useTestTileMap();
let area: ReturnType<typeof createTestArea>;
beforeEach(async () => {
  area = createTestArea();
  await area.ready;
});
afterEach(() => area.dispose());

vi.mock('../src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop() {} })),
}));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function setup() {
  let spring = false;
  const scheduler = new GameTimeScheduler();
  const content = bindTestWorld(scheduler);
  const world = treeWorld(
    area.query,
    world => evergreenPrefabs(world, () => 0.5),
    {
      growthDuration: (seconds: number) => seconds * (spring ? 0.75 : 1),
      getWatchWorldContent: content.getWatchWorldContent,
    },
    { scheduler },
  );
  await area.visit(new THREE.Vector3());
  return {
    ...world,
    content,
    dispose: () => {
      content.unbind();
      world.dispose();
    },
    spring: () => {
      spring = true;
    },
  };
}

it('replaces the build snow symbol and hides it until the world snow level covers it', async () => {
  const s = await setup();
  try {
    const tree = s.prefabs.spawn('evergreen_tall', new THREE.Vector3(3, 0, 0)),
      sprite = prefabInstance(tree.transform.model)!.sprite,
      appearance = () => sprite.sprite.value.appearance;
    // MakeSnowCoveredPristine: the build's own `snow` symbol is replaced from snow.zip and starts hidden.
    expect(appearance().get('archive-symbol:snow')).toMatchObject({
      kind: 'archive-symbol',
      symbol: 'snow',
      archive: 'snow.zip',
      sourceSymbol: 'snow',
    });
    expect(appearance().get('layer:snow')).toMatchObject({ kind: 'layer', layer: 'snow', hidden: true });
    // The SnowCovered tag, as the display reads it; the world's cover is the display's to follow.
    expect(prefabInstance(tree.transform.model)!.hasTag('SnowCovered')).toBe(true);
    expect(sprite.sprite.value.snowCovered).toBe(true);
  } finally {
    s.dispose();
  }
});

it('cycles all four source stages and split archives, resets chop work, removes old-tree shelter, and accelerates new spring timers', async () => {
  const s = await setup();
  try {
    const tree = s.prefabs.spawn('evergreen_tall', new THREE.Vector3(3, 0, 0));
    const model = tree.transform.model,
      work = workTargets('CHOP')[0].entity.components.workable!;
    const growable = (prefabInstance(model)!.components as { growable: Growable }).growable;
    await drawn(model);
    expect((model.children[0].children[0].children[0] as THREE.Mesh).geometry.drawRange.count).toBeGreaterThan(0);
    expect(work.GetWorkLeft()).toBe(15);
    expect(work.WorkedBy(testPlayer())).toBe(true);
    const timer = growable.state.timer.value;
    s.scheduler.advance(100);
    expect(growable.state.timer.value).toBe(timer);
    s.spring();
    s.scheduler.advance(1400);
    expect(s.records()[0].components.growable).toEqual({ stage: 4, time: 225 });
    expect(work.GetWorkLeft()).toBe(1);
    expect(workTargets('CHOP')[0].entity.hasTag('shelter')).toBe(false);
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('grow_tall_to_old');
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/forest/treeWilt', tree.position);
    s.scheduler.advance(225);
    expect(work.GetWorkLeft()).toBe(5);
    expect(workTargets('CHOP')[0].entity.hasTag('shelter')).toBe(true);
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('grow_old_to_short');
    s.scheduler.advance(337.5);
    expect(work.GetWorkLeft()).toBe(10);
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('grow_short_to_normal');
    s.scheduler.advance(1125);
    expect(work.GetWorkLeft()).toBe(15);
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('grow_normal_to_tall');
    // An old tree drops one pinecone when chopped, then one log when its stump is dug.
    s.scheduler.advance(1125);
    expect(performToolWork('CHOP', workTargets('CHOP')[0].entity, {})).toBe(true);
    expect(s.dropLoot.mock.calls.at(-1)![0]).toEqual([{ itemId: 'pinecone', count: 1 }]);
    expect(prefabInstance(model)!.sprite.currentAnimation).toBe('chop_old');
    expect(s.records()[0].components).toEqual({ evergreen: { stump: true }, growable: { stage: 4 } });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.physics.bodies).toEqual([]);
    expect(workTargets('DIG')[0].work()).toBe(true);
    expect(s.dropLoot).toHaveBeenLastCalledWith([{ itemId: 'log', count: 1 }], tree.position);
  } finally {
    s.dispose();
  }
});

it('shows growth settled while unloaded as its final stage without the transition animation', async () => {
  const s = await setup();
  try {
    const tree = s.prefabs.spawn('evergreen_short', new THREE.Vector3(3, 0, 0));
    const root = tree.transform.model,
      controller = prefabInstance(root)!.sprite,
      components = prefabInstance(root)!.components;
    await area.visit(new THREE.Vector3(1000, 0, 1000));
    // A sleeping tree keeps its root and state but leaves the scene graph until its tile wakes.
    expect(tree.transform.model).toBe(root);
    expect(root.parent).toBeNull();
    expect(lookupPrefabInstance(root)!.status.value).toBe('asleep');
    expect(prefabInstance(root)!.components).toBe(components);
    expect(controller.loaded).toBe(false);
    s.scheduler.advance(5000);
    await area.visit(new THREE.Vector3(3, 0, 0));
    await drawn(root);
    expect(root.parent).toBe(s.scene);
    expect(lookupPrefabInstance(root)!.status.value).toBe('active');
    expect(lookupPrefabInstance(root)!.position).toBe(root.position);
    expect(tree.transform.model).toBe(root);
    expect(prefabInstance(root)!.sprite).toBe(controller);
    expect(prefabInstance(root)!.components).toBe(components);
    expect(controller.loaded).toBe(true);
    expect(
      (prefabInstance(tree.transform.model)!.components as { growable: Growable }).growable.GetStage(),
    ).toBeGreaterThan(1);
    expect(prefabInstance(tree.transform.model)!.sprite.currentAnimation).not.toMatch(/^grow_/);
  } finally {
    s.dispose();
  }
});
it('commits source axe work, cancels before impact, preserves logical components while unloaded, and fells and digs a tall tree permanently', async () => {
  const s = await setup(),
    inventory = createPickupInventory();
  const player = await createPlayer('/dst/data/anim');
  const animation = playerInst(player);
  const animationEquipper = createPlayerEquipper(animation);
  await animationEquipper.equip('axe');
  inventory.add('axe', 1);
  inventory.transfer(inventorySlotAddress(0), equipmentSlotAddress('hand'), 1);
  const axe = inventory.getEntity(equipmentSlotAddress('hand'))!;
  const world = {
    player,
    camera: s.camera,
    scene: new THREE.Scene(),
    ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() },
  } as unknown as ActionWorldContext;
  const controller = new PlayerController(
    world,
    animation.sg,
    new Locomotor({ position: player.position, velocity: new THREE.Vector3() }, { physicsRadius: 0.5 * WORLD_SCALE }),
    inventory.handEquipment,
    playerDoer(player),
  );
  const chop = (target: { entity: object }) =>
    controller.DoAction(controller.createAction({ action: 'CHOP', target: target.entity as never, invobject: axe })!);
  const advance = (frames: number) => {
    for (let i = 0; i < frames; i++) {
      advancePlayer(animation, 1 / 30);
    }
  };
  try {
    player.position.set(1, 0, 3);
    const tree = s.prefabs.spawn('evergreen_tall', new THREE.Vector3(1, 0, 0));
    const target = workTargets('CHOP')[0],
      work = target.entity.components.workable!;
    expect(collectEquippedItemActions(axe, undefined, target.entity, true)).toEqual(['CHOP']);
    expect(chop(target)).toBe(true);
    controller.cancel();
    advance(60);
    expect(work.GetWorkLeft()).toBe(15);
    expect(axe.components.finiteuses.remaining).toBeUndefined();
    expect(chop(target)).toBe(true);
    while (animation.sg.stateName === 'chop_start') {
      advancePlayer(animation, 1 / 30);
    }
    advance(2);
    expect(work.GetWorkLeft()).toBe(14);
    expect(axe.components.finiteuses.remaining).toBe(99);
    expect(s.displays.renderEntities.some(entry => entry.object.name === 'pine_needles_chop')).toBe(true);
    await drawn(tree.transform.model);
    const geometry = (tree.transform.model.children[0].children[0].children[0] as THREE.Mesh).geometry;
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    await area.visit(new THREE.Vector3(500, 0, 0));
    expect(prefabInstance(target.model)!.status.value).toBe('asleep');
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(s.physics.bodies).toHaveLength(1);
    s.scheduler.advance(10);
    await area.visit(player.position);
    expect(workTargets('CHOP')[0].entity.components.workable).toBe(work);
    expect(work.GetWorkLeft()).toBe(14);
    const current = workTargets('CHOP')[0];
    expect(work.WorkedBy(testPlayer({ position: player.position }), 14)).toBe(true);
    expect(current.isValid()).toBe(false);
    expect(current.entity.hasTag('CHOP_workable')).toBe(false);
    expect(current.entity.hasTag('DIG_workable')).toBe(true);
    expect(s.dropLoot.mock.calls[0][0]).toEqual([
      { itemId: 'log', count: 3 },
      { itemId: 'pinecone', count: 2 },
    ]);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(s.physics.bodies).toEqual([]);
    const record = s.records()[0];
    const restored = await setup();
    try {
      const reloaded = restored.prefabs.restore('evergreen', record);
      expect(restored.records()[0]).toEqual(record);
      expect(prefabInstance(reloaded.transform.model)!.sprite.currentAnimation).toBe('stump_tall');
      const stump = workTargets('DIG', reloaded.transform.model)[0];
      expect(stump.work()).toBe(true);
      expect(stump.work()).toBe(false);
      restored.scheduler.advance(5000);
      await area.visit(player.position);
      expect(stump.entity!.isRemoved).toBe(true);
      expect(restored.records()).toEqual([]);
    } finally {
      restored.dispose();
    }
  } finally {
    controller.dispose();
    s.dispose();
    inventory.dispose();
  }
});

it('preserves an imported decay timer across visual unloading and save/load, then removes the tree at its deadline', async () => {
  const s = await setup();
  try {
    s.prefabs.spawn('evergreen', new THREE.Vector3(), {
      id: 'imported-burnt',
      components: {
        evergreen: { burnt: true },
        evergreenTimer: { timers: { decay: { timeleft: 100, initial_time: 200, paused: false } } },
      },
    });
    s.scheduler.advance(25);
    await area.visit(new THREE.Vector3(1000, 0, 1000));
    const [saved] = s.records();
    expect(saved.components.evergreenTimer?.timers.decay.timeleft).toBe(75);
    expect(saved.components.growable).toEqual({ stage: 2 });
    const restored = await setup();
    try {
      restored.prefabs.spawn('evergreen', new THREE.Vector3(), saved);
      restored.scheduler.advance(74);
      expect(restored.records()).toHaveLength(1);
      restored.scheduler.advance(1);
      expect(restored.records()).toEqual([]);
    } finally {
      restored.dispose();
      restored.scheduler.dispose();
    }
    s.dispose();
    s.scheduler.advance(100);
    expect(s.records()).toHaveLength(0);
  } finally {
    s.dispose();
    s.scheduler.dispose();
  }
});

it("keeps an imported tall tree's lunar hail buildup to its stage's amount, draws it, and drops it with the stump", async () => {
  const template = JSON.parse(
    await readFile(new URL('../../../public/saves/initial-world.json', import.meta.url), 'utf8'),
  );
  const record = (id: string, components: object) => ({
    id,
    components,
    transform: { position: [0, 0, 0], rotationY: 0 },
  });
  const parsed = deserializeSave(
    JSON.stringify({
      ...template,
      world: {
        ...template.world,
        entities: {
          evergreen: [
            record('hail-tall', { growable: { stage: 3 }, lunarhailbuildup: { workleft: 4, buildupcurrent: 1 } }),
            record('hail-burnt', {
              evergreen: { burnt: true },
              lunarhailbuildup: { workleft: 2, buildupcurrent: 0.5 },
            }),
          ],
        },
      },
    }),
    SAVE_CATALOG,
  ).world.entities.evergreen!;
  const s = await setup();
  try {
    const [tall, burnt] = parsed.map(saved => s.prefabs.spawn('evergreen', new THREE.Vector3(), saved));
    const buildup = tall.components.lunarhailbuildup as LunarHailBuildup;
    // SetTall's SetLunarHailBuildupAmountLarge bounds the loaded workleft at 4, not the component's medium 3.
    expect(buildup.OnSave()).toEqual({ workleft: 4, buildupcurrent: 1 });
    expect(tall.hasTag('LunarBuildup')).toBe(true);
    await drawn(tall.transform.model);
    expect(prefabDisplay(tall.transform.model)!.snowLook).toEqual({
      shown: true,
      override: { archive: 'snow.zip', symbol: 'snow', source: 'lunarhail_buildup' },
    });
    // evergreens.lua onload: the burnt tree removes the buildup its component just loaded.
    expect(burnt.components.lunarhailbuildup).toBeUndefined();

    expect(tall.components.workable!.WorkedBy(testPlayer(), 15)).toBe(true);
    expect(tall.components.lunarhailbuildup).toBeUndefined();
    expect(tall.hasTag('LunarBuildup')).toBe(false);
    expect(prefabDisplay(tall.transform.model)!.snowLook).toEqual({
      shown: false,
      override: { archive: 'snow.zip', symbol: 'snow', source: 'snow' },
    });
    expect(s.records().find(saved => saved.id === 'hail-tall')!.components.lunarhailbuildup).toBeUndefined();
  } finally {
    s.dispose();
    s.scheduler.dispose();
  }
});
