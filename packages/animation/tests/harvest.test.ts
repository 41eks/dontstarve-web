import { wilsonPlayer } from './wilsonPlayer';
import { withEntity } from './entityFixture';
import { testPlayer } from './testPlayer';
import { createEmptyEntity, prefabInstance } from '../../prefab/src/prefabInstance';
import { registerActionEntity, disposeActionEntity, findActionEntity } from '../../prefab/src/actionEntity';
import * as THREE from 'three';
import { afterEach, expect, it, vi } from 'vitest';
import { PlayerController } from '../../stategraphs/src/playercontroller';
import { GameTimeScheduler } from '../../signals/src';
import { Stewer } from '../../componets/src/stewer';
import { Locomotor } from '../../prefab/src/locomotor';
import { WORLD_SCALE } from '../../prefab/src/tile';
import type { ActionWorldContext } from '../../stategraphs/src/actionContext';
import { EventEmitter } from '../../signals/src/EventEmitter';
import { createEquipmentExistenceState } from '../../signals/src';
import type { PlayerActionEvents } from '../../stategraphs/src/actionEvents';
import { sceneActions } from './sceneActions';
import { createInventoryStore } from './testInventory';

afterEach(() => vi.unstubAllGlobals());

it('walks to a finished pot, gives its product to the doer at the hit frame, and keeps it when cancelled or burnt', () => {
  vi.stubGlobal('window', new EventTarget());
  const scene = new THREE.Scene(),
    player = new THREE.Group();
  const { instance, display } = createEmptyEntity('cookpot');
  const model = display.model;
  instance.setPosition(20, 0, 0);
  scene.add(model);
  const container = {
    canbeopened: true,
    IsFull: () => false,
    IsOpen: () => false,
    GetAllItems: () => [],
    Close() {},
    DestroyContents() {},
    TrackContents() {},
    openCount: { get: () => 0, peek: () => 0 },
  };
  const stewer = new Stewer(
    {
      prefab: 'cookpot',
      components: { container },
      get position() {
        return instance.position;
      },
      addTag: tag => instance.addTag(tag),
      removeTag: tag => instance.removeTag(tag),
    },
    new GameTimeScheduler(),
  );
  instance.components.stewer = stewer;
  registerActionEntity(prefabInstance(model)!);
  stewer.OnLoad({ product: 'kabobs', done: true });
  const inst = wilsonPlayer(() => 0.2);
  const stategraph = inst.sg;
  const animation = { stategraph };
  const locomotor = new Locomotor(
    { position: player.position, velocity: new THREE.Vector3() },
    { physicsRadius: 0.5 * WORLD_SCALE },
  );
  // The player inst: HARVEST gives the product to its own inventory.
  const inventory = createInventoryStore([]);
  const create = vi.spyOn(inventory.entities, 'create'),
    give = vi.spyOn(inventory, 'GiveItem');
  const doer = testPlayer({ model: withEntity(player, 'wilson'), inventory });
  const world = {
    scene,
    player,
    camera: new THREE.PerspectiveCamera(),
    ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() },
    actionEvents: new EventEmitter<PlayerActionEvents>(),
  } as unknown as ActionWorldContext;
  let manual = false;
  const controller = new PlayerController(
    world,
    animation.stategraph,
    locomotor,
    createEquipmentExistenceState('HANDS'),
    doer,
    () => manual,
  );
  const harvest = () =>
    controller.DoAction(
      controller.createAction({ action: 'HARVEST', target: registerActionEntity(prefabInstance(model)!) })!,
    );
  try {
    // componentactions SCENE.stewer: a pot done cooking offers HARVEST on both buttons.
    expect(sceneActions(model, doer)).toEqual(['HARVEST']);
    expect(sceneActions(model, doer, true)).toEqual(['HARVEST']);
    expect(harvest()).toBe(true);
    expect(locomotor.destination).toBeDefined();
    player.position.x = 18.1;
    locomotor.update(16, 1 / 30);
    expect(stategraph.stateName).toBe('dolongaction');
    // SGwilson.lua dolongaction: make_trap on the "make" handle as the state is entered, killed as it ends.
    expect(inst.SoundEmitter.PlaySound).toHaveBeenCalledWith('dontstarve/wilson/make_trap', 'make');
    expect(inst.SoundEmitter.KillSound).not.toHaveBeenCalledWith('make');
    stategraph.update(0.5);
    manual = true;
    controller.update();
    stategraph.update(2);
    expect(give).not.toHaveBeenCalled();
    expect(stewer.IsDone()).toBe(true);
    manual = false;
    expect(harvest()).toBe(true);
    stategraph.update(2);
    expect(create).toHaveBeenCalledExactlyOnceWith({ itemId: 'kabobs', count: 1 });
    expect(give).toHaveBeenCalledExactlyOnceWith(create.mock.results[0].value, new THREE.Vector3(20, 0, 0));
    expect(inventory.count('kabobs')).toBe(1);
    expect(inst.SoundEmitter.KillSound).toHaveBeenCalledWith('make');
    expect(stewer.IsDone()).toBe(false);
    stewer.OnLoad({ product: 'kabobs', done: true });
    instance.addTag('burnt');
    expect(sceneActions(model, doer)).toEqual([]);
  } finally {
    controller.dispose();
    stewer.OnRemoveFromEntity();
    disposeActionEntity(findActionEntity(model));
    instance.remove();
    display.dispose();
    inventory.dispose();
  }
});
