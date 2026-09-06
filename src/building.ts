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

const treeTexture = new THREE.TextureLoader().load(
    `${import.meta.env.BASE_URL}192px-Birchnut_Tree_Tall.png`
);
treeTexture.colorSpace = THREE.SRGBColorSpace;

const treeHeight = 20;
const treeWidth = treeHeight * (192 / 323);
const treeGeometry = new THREE.PlaneGeometry(treeWidth, treeHeight);
const treeMaterial = new THREE.MeshBasicMaterial({
    map: treeTexture,
    transparent: true,
    alphaTest: 0.01,
    side: THREE.DoubleSide,
    toneMapped: false,
});

const boxes = Array.from({ length: 500 }, () => {
    const tree = new THREE.Mesh(treeGeometry, treeMaterial);
    tree.position.y = treeHeight / 2;

    while (true) {
        const x = Math.random() * 1000 - 500;
        const z = Math.random() * 1000 - 500;
        if (x * x + z * z > 600) {
            tree.position.x = x;
            tree.position.z = z;
            break;
        }
    }

    return tree;
});

const horizontalCameraDirection = new THREE.Vector3();

function setTreeNormals(normal: THREE.Vector3) {
    horizontalCameraDirection.copy(normal);
    horizontalCameraDirection.y = 0;

    if (horizontalCameraDirection.lengthSq() === 0) {
        return;
    }

    horizontalCameraDirection.normalize();
    const rotationY = Math.atan2(
        horizontalCameraDirection.x,
        horizontalCameraDirection.z,
    );

    boxes.forEach((tree) => {
        tree.rotation.y = rotationY;
    });
}

export { ground, boxes, setTreeNormals };
