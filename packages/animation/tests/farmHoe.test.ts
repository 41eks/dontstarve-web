import { createPlayerEquipper } from './playerEquipFixture';
import { advancePlayer, facePlayer } from './playerVisual';
import { AnimState } from '../src/animState';
import { smallHash } from '../src/animationAssets';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { farmHoeVisual } from '../../prefab/src/farm_hoe';
import { declaredSymbol, overrideArchives } from './animStateFixture';
import { PlayerController } from '../../stategraphs/src/playercontroller';
import { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { Locomotor } from '../../prefab/src/locomotor';
import { WORLD_SCALE } from '../../prefab/src/tile';
import { getHandEquipmentDefinition } from '../../prefab/src/handEquipment';
import { actionTool } from './actionFixtures';
import { playerDoer } from './playerDoer';
import { createEquipmentExistenceState } from '../../signals/src';
import { farmFixture } from './farmFixture';
import { placeEntity } from './mapEntitiesFixture';
import { PLANTED_SEED_ID } from '../../prefab/src/farm_plow';
import { TurfMap } from '../../prefab/src/turfMap';
import { playerInst, createPlayer, type PlayerInstance } from './playerVisual';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from '../../prefab/src/groundItems';
import { createGroundItemVisual } from './groundItemVisual';
import type { WorldContext } from '../../prefab/src/worldContext';
import { inventoryItemEquipmentKind, inventoryItemMaxStack } from '../../inventory/src/slots';
import { PlaySound } from '../../prefab/src/sound';

vi.mock('../../prefab/src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop() {}, isPlaying: () => true })),
}));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

function setup(player = new THREE.Group()) {
  const world = {
    scene: new THREE.Scene(),
    player,
    camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() },
  } as unknown as WorldContext;
  const turf = new TurfMap(96);
  const farm = farmFixture(world.scene, turf);
  return { farm, turf, world };
}
function advance(animation: PlayerInstance, frames: number) {
  for (let i = 0; i < frames; i++) {
    advancePlayer(animation, 1 / 30);
  }
}

it('resolves both source ground builds, the separate golden held build and invisible equipment', async () => {
  const assets = new GroundItemAssets();
  try {
    const ordinary = await createGroundItemVisual('farm_hoe');
    const gold = await createGroundItemVisual('golden_farm_hoe', 'golden_farmhoe_garden');
    for (const sprite of [ordinary, gold]) {
      expect((sprite.model.children[0].children[0].children[0] as THREE.Mesh).geometry.drawRange.count).toBeGreaterThan(
        0,
      );
      sprite.dispose();
    }
    expect(GROUND_ITEM_DEFINITIONS.farm_hoe).toMatchObject({
      bank: 'quagmire_hoe',
      animation: 'idle',
      atlas: 'images/inventoryimages2.xml',
    });
    expect(GROUND_ITEM_DEFINITIONS.golden_farm_hoe).toMatchObject({
      bank: 'goldenhoe',
      animation: 'idle',
      atlas: 'images/inventoryimages2.xml',
    });
    expect(inventoryItemEquipmentKind('farm_hoe')).toBe('hand');
    expect(inventoryItemMaxStack('golden_farm_hoe')).toBe(1);
    const anim = new AnimState();
    const owner = { AnimState: anim, PushEvent() {} };
    const equip = (prefab: string, skinId?: string) => farmHoeVisual({ id: prefab, prefab, skinId }).onequip(owner);
    equip('farm_hoe');
    expect(anim.json.peek().overrides.get(smallHash('swap_object'))?.sources[0].symbol).toBe(
      smallHash('swap_quagmire_hoe'),
    );
    equip('golden_farm_hoe');
    expect(overrideArchives(anim, 'swap_object')).toEqual(['swap_goldenhoe.zip']);
    equip('golden_farm_hoe', 'golden_farmhoe_garden');
    const heldSkin = (await declaredSymbol(anim, assets, 'swap_object'))!;
    expect(heldSkin).toHaveLength(1);
    expect(heldSkin[0].materials[0].name).toBe('ground:golden_farmhoe_garden');
    equip('golden_farm_hoe', 'golden_farmhoe_invisible');
    expect(await declaredSymbol(anim, assets, 'swap_object')).toHaveLength(0);
  } finally {
    assets.dispose();
  }
});

it('retills broken soil at the exact point, preserves blockers and crops, and restores saved holes', async () => {
  const { farm, turf, world } = setup();
  const point = new THREE.Vector3(3, 0, 3);
  try {
    expect(farm.map.canTill(point)).toBe(false);
    turf.plow(point);
    farm.spawn('farm_soil', point, { farmSoil: { broken: true } }, 'broken');
    farm.spawn('farm_soil', new THREE.Vector3(6, 0, 3), { farmSoil: { broken: false } }, 'neighbour');
    const blocker = placeEntity(farm.prefabs, point);
    expect(farm.map.canTill(point)).toBe(false);
    blocker.addTag('FX');
    expect(farm.map.canTill(point)).toBe(true);
    expect(farm.decor().map(({ record }) => record.id)).toEqual(['broken', 'neighbour']);
    expect(farm.map.till(point)).toBe(true);
    const records = farm.decor();
    expect(records.some(({ record }) => record.id === 'broken')).toBe(false);
    expect(records.find(({ record }) => record.id === 'neighbour')?.record.components.farmSoil?.broken).toBe(true);
    const hole = records.find(({ record }) => record.id !== 'neighbour')!;
    expect(hole.record.transform.position).toEqual([3, 0, 3]);
    expect(hole.record.components.farmSoil).toEqual({ broken: false });
    const restored = setup();
    try {
      restored.turf.plow(point);
      restored.farm.spawn('farm_soil', point, { farmSoil: hole.record.components.farmSoil }, hole.record.id);
      expect(restored.farm.decor()).toEqual([hole]);
      expect(restored.farm.decor()[0].record.id).toBe(hole.record.id);
    } finally {
      restored.farm.dispose();
    }
    farm.spawn(PLANTED_SEED_ID, point, {}, 'crop');
    const crops = farm.seeds();
    expect(farm.map.canTill(point)).toBe(false);
    expect(farm.map.till(point)).toBe(false);
    expect(farm.seeds()).toEqual(crops);
    farm.spawn('farm_soil_debris', new THREE.Vector3(9, 0, 9), { farmDebris: { animation: 'f1' } });
    expect(farm.map.canTill(new THREE.Vector3(9, 0, 9))).toBe(false);
  } finally {
    farm.dispose();
  }
  expect(world.scene.children).toHaveLength(0);
});

it('takes TILL at the point, creates one hole at till_loop frame 11, and drops a cancelled or unequipped hit', async () => {
  const player = await createPlayer('/dst/data/anim');
  player.position.set(0, 0, 15);
  const animation = playerInst(player);
  const animationEquipper = createPlayerEquipper(animation);
  await animationEquipper.equip('golden_farm_hoe');
  const { world, farm, turf } = setup(player);
  world.mouseActions = new PlayerActionPicker(new PointerRaycaster(world));
  const body = { position: player.position, velocity: new THREE.Vector3() };
  const locomotor = new Locomotor(body, { physicsRadius: 0.5 * WORLD_SCALE });
  const hand = createEquipmentExistenceState('HANDS');
  const tool = actionTool('golden_farm_hoe');
  const lifecycle = getHandEquipmentDefinition('golden_farm_hoe')!.definition.createLifecycle!(tool.entity, {
    farmTillMap: farm.map,
  } as never)!;
  lifecycle.onequip();
  const controller = new PlayerController(world, animation.sg, locomotor, hand, playerDoer(player));
  const point = new THREE.Vector3(3, 0, 3);
  vi.spyOn(PointerRaycaster.prototype, 'trackPointer').mockImplementation(() => {});
  vi.spyOn(PointerRaycaster.prototype, 'pickMouseTarget').mockReturnValue(undefined as never);
  vi.spyOn(PointerRaycaster.prototype, 'groundPoint').mockReturnValue(point);
  const rightClick = () =>
    (world.renderer.domElement as EventTarget).dispatchEvent(
      Object.assign(new Event('pointerdown', { cancelable: true }), { button: 2 }),
    );
  const walkIn = () => {
    player.position.set(3, 0, 3.5);
    locomotor.update(16, 1 / 30);
  };
  turf.plow(point);
  try {
    hand.set({ itemId: 'torch', EQUIPSLOTS: 'HANDS' });
    expect(world.mouseActions.getMouseActions().right).toBeUndefined();
    hand.set(tool);
    const right = world.mouseActions.getMouseActions().right;
    expect(right?.action).toBe('TILL');
    expect(right?.invobject).toBe(tool.entity);
    rightClick();
    expect(locomotor.bufferedAction).toBeDefined();
    expect(farm.decor()).toEqual([]);
    walkIn();
    await vi.waitFor(() => {
      advancePlayer(animation, 1 / 30);
      expect(animation.sg.stateName).toBe('till_start');
    });
    while (animation.sg.stateName === 'till_start') {
      advancePlayer(animation, 1 / 30);
    }
    advance(animation, 10);
    expect(farm.decor()).toEqual([]);
    facePlayer(animation, 'side', true);
    advancePlayer(animation, 1 / 30);
    expect(farm.decor()).toHaveLength(1);
    advancePlayer(animation, 1 / 30);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve/wilson/dig', undefined);
    expect(PlaySound).toHaveBeenCalledWith('dontstarve_DLC001/creatures/mole/emerge', undefined);
    advance(animation, 60);
    expect(farm.decor()).toHaveLength(1);
    const preserved = farm.decor();
    rightClick();
    walkIn();
    await vi.waitFor(() => {
      advancePlayer(animation, 1 / 30);
      expect(animation.sg.isPerformingAction('TILL')).toBe(true);
    });
    window.dispatchEvent(Object.assign(new Event('keydown'), { code: 'Escape' }));
    advance(animation, 60);
    expect(farm.decor()).toEqual(preserved);
    rightClick();
    walkIn();
    await vi.waitFor(() => {
      advancePlayer(animation, 1 / 30);
      expect(animation.sg.isPerformingAction('TILL')).toBe(true);
    });
    hand.set(null);
    await animationEquipper.equip(null);
    advance(animation, 60);
    expect(farm.decor()).toEqual(preserved);
  } finally {
    controller.dispose();
    world.mouseActions.dispose();
    lifecycle.onunequip();
    farm.dispose();
  }
});
