import * as THREE from 'three';
import { CursorLabelUi } from '../src/cursor-label';
import { DstLightingRenderer } from '../../../src/dstLighting';
import { spawnLightEntity } from '../../prefab/src/localLight';
import { createEmptyEntity } from '../../prefab/src/prefabInstance';
import { displayLightOverride } from '../../display/src/displaySprites';
import { TORCH_LIGHT } from '../../prefab/src/torch';
import { TreasureChestPlacement } from '../../prefab/src/treasurechest';
import { WallsPlacement } from '../../prefab/src/walls';
import type { WorldContext } from '../../prefab/src/worldContext';
import { clockstate, createSignal, seasonstate } from '@dontstarve-web/signals';

export async function checkCursorPreview() {
  clockstate.set({ phase: 'night', timeinphase: 0 });
  seasonstate.set({ season: 'spring', progress: 0.5 });
  const renderer = new THREE.WebGLRenderer({ preserveDrawingBuffer: true });
  renderer.setSize(400, 400);
  renderer.domElement.style.cssText = 'position:fixed;left:0;top:0;width:400px;height:400px';
  document.body.append(renderer.domElement);
  const lighting = await DstLightingRenderer.create(renderer, '/dst/data/images/colour_cubes');
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-20, 20, 20, -20, 0.1, 100);
  camera.position.set(0, 40, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff }));
  scene.add(ground);
  // A placer entity: its display reports the light override its sprite json declares.
  const placer = createEmptyEntity('preview'), preview = placer.display.model;
  preview.add(new THREE.Mesh(new THREE.PlaneGeometry(4, 4).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffffff })));
  preview.position.set(-6, 0.1, 0);
  scene.add(preview);
  placer.instance.sprite.setLightOverride(1);
  const ui = new CursorLabelUi(renderer.domElement, '/dst/data/fonts/controllers.zip');
  await ui.ready;
  const pointer = { hasPointer: true, isOverGround: true, pointerClientX: 200, pointerClientY: 220 };
  ui.setHandAction({ action: 'CASTSPELL' }, pointer);
  const visibleRow = () => ui.element.shadowRoot!.querySelector<HTMLDivElement>('.label:not([hidden])')!;
  const glyph = visibleRow().querySelector('canvas')!;
  const labelState = () => {
    const row = visibleRow(), text = row.querySelector('span')!, glyph = row.querySelector('canvas')!;
    return { hidden: ui.element.hidden, text: text.textContent,
      glyph: glyph.hidden ? undefined : glyph.dataset.glyph, colour: getComputedStyle(text).color };
  };
  const rightPixels = glyph.getContext('2d')!.getImageData(0, 0, glyph.width, glyph.height).data;
  const rightGlyph = {
    width: glyph.width, height: glyph.height,
    opaque: Array.from(rightPixels).filter((value, index) => index % 4 === 3 && value > 0).length,
  };
  const pixels = new Uint8Array(4);
  const sample = (x: number, z: number) => {
    const point = new THREE.Vector3(x, 0.1, z).project(camera);
    const gl = renderer.getContext();
    gl.readPixels(Math.floor((point.x + 1) * 200), Math.floor((point.y + 1) * 200), 1, 1,
      gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return Array.from(pixels.slice(0, 3));
  };
  const draw = () => { lighting.render(scene, camera); ui.update(); };
  draw();
  const night = { preview: sample(-6, 0), ground: sample(6, 0), label: labelState() };
  const owner = createEmptyEntity('wilson');
  scene.add(owner.display.model);
  const torchLight = spawnLightEntity('torchfire_light', owner.instance); torchLight.instance.light.set(TORCH_LIGHT);
  const removeTorchLight = torchLight.remove;
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  await settle(); // The owner's display lists the light parented to it.
  draw();
  const torch = { preview: sample(-6, 0), ground: sample(6, 0), label: labelState() };
  removeTorchLight();
  placer.instance.sprite.setLightOverride(null);
  await settle();
  draw();
  const committed = { preview: sample(-6, 0), ground: sample(6, 0) };
  clockstate.set({ phase: 'day', timeinphase: 0 });
  await Promise.resolve();
  lighting.update(4);
  draw();
  const dayLabel = labelState();
  placer.instance.remove();

  // Real animation/build assets: previews stay in the scene and foot sorting; a committed building draws without
  // the placer's light override, and cancellation clears it.
  const player = new THREE.Object3D();
  const world: WorldContext = { scene, camera, cameraFacing: createSignal(8), cameraHeading: createSignal(45), renderer, ground, player,
    createCursorLabel: (value) => ui.createLabel(value) };
  const chest = new TreasureChestPlacement(world, () => true);
  const wall = new WallsPlacement(world, () => true);
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 220 }));
  await chest.begin('treasurechest');
  chest.update(0);
  const chestPreview = chest.renderEntities[0].object;
  const building = { inScene: chestPreview.parent === scene, override: displayLightOverride(chestPreview),
    footY: chest.renderEntities[0].footPosition.y, label: labelState() };
  const leftGlyph = visibleRow().querySelector('canvas')!;
  const leftPixels = leftGlyph.getContext('2d')!.getImageData(0, 0, leftGlyph.width, leftGlyph.height).data;
  const differentButtons = rightPixels.some((value, index) => value !== leftPixels[index]);
  renderer.domElement.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 200, clientY: 220 }));
  // The build spawns the chest itself; the placer entity is released.
  const builtChest = chest.renderEntities[0]?.object;
  const placed = { previewRemoved: chestPreview.parent === null, inScene: builtChest !== chestPreview && builtChest?.parent === scene,
    override: (builtChest && displayLightOverride(builtChest)) || null, count: chest.exportRecords().length, label: labelState() };
  await wall.begin('wall_stone');
  wall.update();
  const wallPreview = wall.renderEntities[0].object;
  const wallBefore = { inScene: wallPreview.parent === scene, override: displayLightOverride(wallPreview) };
  wall.cancel();
  const cancelled = { removed: wallPreview.parent === null, override: displayLightOverride(wallPreview) || null,
    count: wall.exportRecords().length, label: labelState() };
  const blocker = document.createElement('div');
  blocker.style.cssText = 'position:fixed;left:180px;top:200px;width:40px;height:40px;z-index:150';
  document.body.append(blocker);
  ui.update();
  const overUiHidden = ui.element.hidden;
  blocker.remove();
  ui.setHandAction(null, pointer);
  const unequippedHidden = ui.element.hidden;
  lighting.dispose();
  renderer.dispose();
  ui.dispose();
  return { night, torch, committed, dayLabel, rightGlyph, differentButtons,
    building, placed, wallBefore, cancelled, overUiHidden, unequippedHidden };
}
