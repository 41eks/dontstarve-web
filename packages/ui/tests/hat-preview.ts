import * as THREE from 'three';
import { HAT_IDS, HAT_DEFINITIONS } from '@three-roaming/prefab/hats';
import { createWilsonPlayer, type WilsonAnimationController } from '@three-roaming/prefab/player';

export async function renderHatCatalog(): Promise<void> {
  const player = await createWilsonPlayer('/dst/data/anim');
  player.position.set(0, 0, 0);
  const scene = new THREE.Scene();
  scene.add(player);
  const camera = new THREE.OrthographicCamera(-5.5, 5.5, 11, -1, 0.1, 100);
  camera.position.set(0, 0, 20);
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(144, 160);
  document.body.innerHTML = '';
  document.body.style.cssText = 'margin:0;background:#292d30;color:white;font:12px sans-serif';
  const gallery = document.createElement('div');
  gallery.id = 'hat-gallery';
  gallery.style.cssText = 'display:grid;grid-template-columns:repeat(9,144px);width:1296px';
  document.body.append(gallery);
  for (const id of [null, ...HAT_IDS]) {
    await (player.userData.animationController as WilsonAnimationController).setHat(id);
    renderer.render(scene, camera);
    const card = document.createElement('div');
    const canvas = document.createElement('canvas');
    canvas.width = 144;
    canvas.height = 160;
    canvas.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
    card.append(canvas);
    const label = document.createElement('div');
    label.style.cssText = 'text-align:center;height:30px';
    label.textContent = id ? HAT_DEFINITIONS[id].name : '未装备';
    card.append(label);
    gallery.append(card);
  }
  renderer.dispose();
}
