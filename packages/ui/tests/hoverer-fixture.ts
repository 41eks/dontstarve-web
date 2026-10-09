import * as THREE from 'three';
import { PlayerActionPicker, PointerRaycaster, type MouseActionCandidate } from '../../stategraphs/src';
import { CursorLabelUi } from '../src/cursor-label';

export async function setupHoverer() {
  const renderer = new THREE.WebGLRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.domElement.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh';
  document.body.append(renderer.domElement);
  const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, .1, 100);
  camera.position.z = 10;
  camera.updateMatrixWorld();
  const scene = new THREE.Scene();
  const target = new THREE.Group();
  target.add(new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial()));
  scene.add(target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.MeshBasicMaterial());
  ground.position.z = -1;
  scene.add(ground);
  scene.updateMatrixWorld(true);
  const pointer = new PointerRaycaster({ camera, renderer, ground });
  const picker = new PlayerActionPicker(pointer);
  const ui = new CursorLabelUi(renderer.domElement, '/dst/data/fonts/controllers.zip');
  ui.setMouseActions(picker);
  await ui.ready;
  let valid = true, equipped = true;
  const sources: MouseActionCandidate[] = [
    { action: { action: 'NET' }, button: 'left', model: target },
    { action: { action: 'CASTSPELL', modifier: 'RESKIN' }, button: 'right', model: target },
  ];
  const unregister = picker.register(() => valid ? sources.map(candidate => ({ ...candidate, available: equipped })) : []);
  const tooltip = ui.createLabel(pointer);
  const step = () => { renderer.render(scene, camera); ui.update(); };
  Object.assign(window, { hoverer: {
    step,
    equip: (value: boolean) => { equipped = value; step(); },
    valid: (value: boolean) => { valid = value; step(); },
    tooltip: (value: boolean) => { if (value) tooltip.show('建造预览'); else tooltip.hide(); },
    dispose: () => { unregister(); picker.dispose(); ui.dispose(); renderer.dispose(); renderer.domElement.remove(); },
  } });
}
