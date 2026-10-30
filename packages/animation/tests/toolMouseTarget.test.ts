import * as THREE from 'three';
import { withEntity } from './entityFixture';
import { expect, it, vi } from 'vitest';
import { SpriteState } from '../../display/src';
import { ItemEntity } from '../../inventory/src';
import { createEquipmentExistenceState } from '../../signals/src';
import { Workable } from '../../componets/src/workable';
import { Burnable } from '../../componets/src/burnable';
import { actionEntity, activePrefabs, disposeActionEntity } from '../../prefab/src/actionEntity';
import { PrefabInstance, bindInstance } from '../../prefab/src/prefabInstance';
import { configureEquipmentEntity } from '../../prefab/src/handEquipment';
import { mouseTargets } from '../../prefab/src/mouseTargets';
import { ToolMouseTarget, type ToolMouseTargetOptions } from '../../prefab/src/toolMouseTarget';
import { PointerRaycaster } from '../../stategraphs/src/pointerRaycaster';
import { PlayerActionPicker } from '../../stategraphs/src/playeractionpicker';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function setup(options?: ToolMouseTargetOptions) {
  const hand = createEquipmentExistenceState('HANDS'), tools: ItemEntity[] = [];
  const scene = new THREE.Scene(), tree = new THREE.Group(), back = new THREE.Group();
  const geometry = new THREE.PlaneGeometry(2, 2), material = new THREE.MeshBasicMaterial();
  tree.add(new THREE.Mesh(geometry, material)); back.add(new THREE.Mesh(geometry, material));
  tree.position.z = 2; scene.add(tree, back);
  const instance = new PrefabInstance('evergreen', new SpriteState({ name: 'idle' }));
  bindInstance(tree, instance); instance.addTag('tree');
  const target = actionEntity(tree, 'evergreen'); actionEntity(withEntity(back, 'log'), 'log');
  const workable = new Workable(target); target.components.workable = workable;
  const burnable = new Burnable(target); target.components.burnable = burnable;
  const binding = new ToolMouseTarget(target, instance, workable, hand, options);
  const camera = new THREE.PerspectiveCamera(60, 1, .1, 100);
  camera.position.z = 10; camera.updateMatrixWorld();
  const renderer = { domElement: { getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) } } as unknown as THREE.WebGLRenderer;
  const picker = new PlayerActionPicker(new PointerRaycaster({ camera, renderer }));
  picker.pointer.trackPointer({ clientX: 50, clientY: 50 } as PointerEvent);
  const pick = () => { picker.getMouseActions(); return picker.targetModel; };
  const equip = async (itemId?: string) => {
    if (itemId) {
      const entity = new ItemEntity({ itemId, count: 1 }); configureEquipmentEntity(entity); tools.push(entity);
      hand.set({ itemId, EQUIPSLOTS: 'HANDS', entity });
    } else hand.set(null);
    await flush();
  };
  return { hand, tree, back, target, instance, workable, burnable, binding, pick, equip,
    dispose() {
      binding.dispose(); target.components.workable?.dispose(); burnable.dispose();
      instance.remove(); disposeActionEntity(tree); disposeActionEntity(back); picker.dispose();
      for (const tool of tools) tool.destroy(); geometry.dispose(); material.dispose();
    } };
}

it('skips tree geometry with empty hands, follows CHOP to DIG replacement, and preserves world activity and wake state', async () => {
  const s = setup(), intersect = vi.spyOn(s.tree.children[0], 'raycast');
  try {
    expect(s.pick()).toBe(s.back);
    expect(intersect).not.toHaveBeenCalled();
    expect(activePrefabs).toContain(s.target);
    expect(s.target.hasTag('NOCLICK')).toBe(false);
    await s.equip('axe');
    expect(s.pick()).toBe(s.tree);
    expect(intersect).toHaveBeenCalled();
    // The source swaps workables when a standing tree becomes a stump.
    s.workable.SetWorkLeft(1);
    s.workable.SetOnFinishCallback(() => {
      s.workable.dispose(); s.instance.addTag('stump');
      const dig = new Workable(s.target); dig.SetWorkAction('DIG'); dig.SetWorkLeft(1);
      s.target.components.workable = dig; s.binding.setWorkable(dig);
    });
    s.workable.WorkedBy({}, 1); await flush();
    expect(s.pick()).toBe(s.back);
    await s.equip('shovel'); expect(s.pick()).toBe(s.tree);
    s.instance.setActive(false); await flush(); expect(s.pick()).toBe(s.back);
    s.instance.setActive(true); await flush(); expect(s.pick()).toBe(s.tree);
    await s.equip('pickaxe'); expect(s.pick()).toBe(s.back);
    await s.equip(); expect(mouseTargets.has(s.target)).toBe(false);
  } finally { intersect.mockRestore(); s.dispose(); }
});

it('matches ignition tools to burning and burnt states and releases equipment observers on removal', async () => {
  const s = setup(), readHand = vi.spyOn(s.hand, 'get');
  try {
    await s.equip('torch'); expect(s.pick()).toBe(s.tree);
    s.burnable.Ignite(true); await flush(); expect(s.pick()).toBe(s.back);
    await s.equip('firestaff'); expect(s.pick()).toBe(s.back);
    s.burnable.Extinguish(); await flush(); expect(s.pick()).toBe(s.tree);
    s.instance.addTag('burnt'); s.burnable.dispose(); delete s.target.components.burnable;
    await flush(); expect(s.pick()).toBe(s.back);
    await s.equip('axe'); expect(s.pick()).toBe(s.tree);
    s.instance.remove(); await flush();
    expect(s.pick()).toBe(s.back);
    expect(mouseTargets.has(s.target)).toBe(false);
    readHand.mockClear();
    await s.equip('torch'); expect(readHand).not.toHaveBeenCalled();
  } finally { readHand.mockRestore(); s.dispose(); }
});

it('matches mining and hammering to the current workable and stops intercepting after work is disabled', async () => {
  const s = setup();
  try {
    s.workable.SetWorkAction('MINE');
    await s.equip('hammer'); expect(s.pick()).toBe(s.back);
    await s.equip('pickaxe'); expect(s.pick()).toBe(s.tree);
    s.workable.SetWorkable(false); await flush(); expect(s.pick()).toBe(s.back);
    s.workable.SetWorkAction('HAMMER'); s.workable.SetWorkLeft(1);
    await flush(); expect(s.pick()).toBe(s.back);
    await s.equip('hammer'); expect(s.pick()).toBe(s.tree);
    s.workable.WorkedBy({}, 1); await flush(); expect(s.pick()).toBe(s.back);
  } finally { s.dispose(); }
});

it('preserves scene interactions and selects spell targets through entity tags', async () => {
  let sceneAction = true;
  const s = setup({ canInteractWithoutTool: () => sceneAction });
  try {
    expect(s.pick()).toBe(s.tree);
    sceneAction = false; s.instance.addTag('burnt'); await flush(); expect(s.pick()).toBe(s.back);
    await s.equip('reskin_tool'); expect(s.pick()).toBe(s.tree);
    s.instance.addTag('nomagic'); await flush(); expect(s.pick()).toBe(s.back);
    s.instance.removeTag('nomagic'); await flush(); expect(s.pick()).toBe(s.tree);
    await s.equip('pickaxe'); expect(s.pick()).toBe(s.back);
    await s.equip(); expect(s.pick()).toBe(s.back);
  } finally { s.dispose(); }
});
