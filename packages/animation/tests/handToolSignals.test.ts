import * as THREE from 'three';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createEquipmentExistenceState } from '../../signals/src';
import { ReskinActionController } from '../../stategraphs/src/reskin_tool';
import type { ActionWorldContext } from '../../stategraphs/src/actionContext';
import { actionTool, reskinEntityFields } from './actionFixtures';
import { SpriteState } from '../../display/src/spriteState';
import { bufferingPerformer } from './bufferingPerformer';

vi.mock('../../../src/universal', () => ({}));

beforeEach(() => vi.stubGlobal('window', new EventTarget()));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function context() {
  return { player: new THREE.Group(), camera: new THREE.PerspectiveCamera(), ground: new THREE.Group(),
    renderer: { domElement: new EventTarget() } } as unknown as ActionWorldContext;
}





it('discards a pending reskin after the equipped entity changes during loading and releases subscriptions', async () => {
  const equipment = createEquipmentExistenceState('HANDS');
  const first = actionTool('reskin_tool');
  equipment.set(first);
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const sprite = new SpriteState({ name: '' }), model = new THREE.Group();
  // The display is still loading the skin the cast would choose when the equipment changes.
  const target = { ...reskinEntityFields, id: 'target', prefabId: 'icebox', model, position: new THREE.Vector3(1, 0, 0), sprite,
    get skinId() { return sprite.skinId.peek(); }, isValid: () => true,
    display: { model, preloadSkin: async () => { await ready; } } as never };
  const animation = bufferingPerformer();
  const fx = { play: vi.fn(), dispose: vi.fn() };
  const effects = { prepare: vi.fn(() => fx) };
  const controller = new ReskinActionController(context(), animation.performer,
    { goToPoint: () => true, stop: vi.fn(), destination: undefined }, equipment, effects);
  const request = controller.request(target);
  equipment.set(actionTool('reskin_tool'));
  release();
  expect(await request).toBe(false);
  expect(sprite.skinId.peek()).toBeUndefined();
  expect(fx.play).not.toHaveBeenCalled();
  controller.dispose();
  animation.stategraph.cancelAction.mockClear();
  equipment.set(null);
  expect(animation.stategraph.cancelAction).not.toHaveBeenCalled();
});
