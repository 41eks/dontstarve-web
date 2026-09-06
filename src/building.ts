// src/building.ts

import * as THREE from 'three';

const groundTexture = new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}384px-GROUND_DECIDUOUS.png`
);
groundTexture.colorSpace = THREE.SRGBColorSpace;
groundTexture.wrapS = THREE.RepeatWrapping;
groundTexture.wrapT = THREE.RepeatWrapping;
groundTexture.repeat.set(10, 10);

const groundGeometry = new THREE.PlaneGeometry(1000, 1000);
const groundMaterial = new THREE.MeshLambertMaterial({
    map: groundTexture,
    side: THREE.DoubleSide
});
const ground = new THREE.Mesh(groundGeometry, groundMaterial);
ground.rotation.x = -Math.PI / 2;

ground.receiveShadow = true;

const boxes = Array.from({ length: 500 }, () => {
    const boxGeometry = new THREE.BoxGeometry(5, 20, 5);
    const boxMaterial = new THREE.MeshLambertMaterial({
        color: 0xff0000,
        side: THREE.DoubleSide
    });
    const box = new THREE.Mesh(boxGeometry, boxMaterial);
    while (true) {
        const x = Math.random() * 1000 - 500;
        const z = Math.random() * 1000 - 500;
        if (x * x + z * z > 600) {
            box.position.x = x;
            box.position.z = z;
            break;
        }
    }
    // box.position.x = Math.random() * 1000 - 500;
    // box.position.z = Math.random() * 1000 - 500
    return box;
})

export { ground, boxes };
