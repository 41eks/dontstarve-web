// src/building.ts

import * as THREE from 'three';
import {
    createRgbaSpriteAtlas,
    createRgbaSpriteFrameGeometry,
    updateRgbaSpriteFrameGeometry,
} from '@three-roaming/wilson';

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

const TREE_COUNT = 500;
const TREE_SCALE = 0.02;
const treeAtlas = await createRgbaSpriteAtlas(
    `${import.meta.env.BASE_URL}dst/data/anim`,
    'moon_tree.zip',
    {
        animationName: 'sway1_loop_tall',
        padding: 2,
        resolutionScale: 0.5,
    },
);
const treeFrame = treeAtlas.frames[0];
const treeGeometry = createRgbaSpriteFrameGeometry(treeFrame, { anchor: 'bottom' });
const treePositions = Array.from({ length: TREE_COUNT }, () => {
    while (true) {
        const x = Math.random() * 1000 - 500;
        const z = Math.random() * 1000 - 500;
        if (x * x + z * z > 600) {
            return new THREE.Vector3(x, 0, z);
        }
    }
});

const treeForest = new THREE.Group();
treeForest.name = 'MoonTreeForest';
const treeDepthPass = new THREE.Group();
treeDepthPass.name = 'MoonTreeDepthPass';
const treeColorPass = new THREE.Group();
treeColorPass.name = 'MoonTreeColorPass';
// Tree colors must be submitted before dynamic transparent characters. The
// depth prepass still makes nearer trees win regardless of instance order.
treeColorPass.renderOrder = -1;
treeForest.add(treeDepthPass, treeColorPass);
const treeColorMaterial = new THREE.MeshBasicMaterial({
    map: treeAtlas.texture,
    transparent: true,
    alphaTest: 0.01,
    depthTest: true,
    depthWrite: false,
    side: THREE.BackSide,
    toneMapped: false,
});
const treeDepthMaterial = treeColorMaterial.clone();
treeDepthMaterial.transparent = false;
treeDepthMaterial.depthWrite = true;
treeDepthMaterial.colorWrite = false;
treeDepthMaterial.alphaToCoverage = true;

const treeColorMesh = new THREE.InstancedMesh(
    treeGeometry,
    treeColorMaterial,
    TREE_COUNT,
);
const treeDepthMesh = new THREE.InstancedMesh(
    treeGeometry,
    treeDepthMaterial,
    TREE_COUNT,
);
treeColorMesh.name = 'MoonTreeColor';
treeDepthMesh.name = 'MoonTreeDepth';
treeColorMesh.frustumCulled = false;
treeDepthMesh.frustumCulled = false;
treeColorPass.add(treeColorMesh);
treeDepthPass.add(treeDepthMesh);

let treeAnimationElapsed = 0;
let treeAnimationFrameIndex = 0;

function updateTreeAnimation(dt: number) {
    treeAnimationElapsed += Math.min(dt, 0.1);
    const nextFrameIndex = Math.floor(treeAnimationElapsed * treeAtlas.frameRate)
        % treeAtlas.frames.length;
    if (nextFrameIndex === treeAnimationFrameIndex) return;
    treeAnimationFrameIndex = nextFrameIndex;
    updateRgbaSpriteFrameGeometry(
        treeGeometry,
        treeAtlas.frames[treeAnimationFrameIndex],
        { anchor: 'bottom' },
    );
}

const treeRootMatrix = new THREE.Matrix4();
const treeLocalMatrix = new THREE.Matrix4().makeScale(
    TREE_SCALE,
    -TREE_SCALE,
    TREE_SCALE,
);
const treeInstanceMatrix = new THREE.Matrix4();
const treeUnitScale = new THREE.Vector3(1, 1, 1);
const lastTreeQuaternion = new THREE.Quaternion();
let hasTreeQuaternion = false;

function setTreeNormals(cameraWorldQuaternion: THREE.Quaternion) {
    if (hasTreeQuaternion
        && Math.abs(lastTreeQuaternion.dot(cameraWorldQuaternion)) > 1 - 1e-10) return;
    lastTreeQuaternion.copy(cameraWorldQuaternion);
    hasTreeQuaternion = true;

    treePositions.forEach((position, index) => {
        treeRootMatrix.compose(position, cameraWorldQuaternion, treeUnitScale);
        treeInstanceMatrix.multiplyMatrices(treeRootMatrix, treeLocalMatrix);
        treeColorMesh.setMatrixAt(index, treeInstanceMatrix);
        treeDepthMesh.setMatrixAt(index, treeInstanceMatrix);
    });
    treeColorMesh.instanceMatrix.needsUpdate = true;
    treeDepthMesh.instanceMatrix.needsUpdate = true;
}

setTreeNormals(new THREE.Quaternion());

const boxes = [treeForest];

export { ground, boxes, setTreeNormals, updateTreeAnimation };
