import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { frontTasks, backTasks } from './animate';
import { player } from './player';
import { renderer } from './universal';

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 5000);
camera.position.set(4, 30, -12);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 4, 0);
controls.enableDamping = true;
controls.update();
controls.addEventListener("change", () => {
    // console.log(camera.position);
});

const diff = new THREE.Vector3();

frontTasks.push(() => {
    controls.update();
    diff.copy(camera.position).sub(player.position);
});

backTasks.push(() => {
    controls.target.copy(player.position);
    camera.position.copy(player.position).add(diff);
});

export { camera };
