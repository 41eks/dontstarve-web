import * as THREE from 'three';
import {
  createRgbaSpriteAtlas,
  createRgbaSpriteFrameGeometry,
  updateRgbaSpriteFrameGeometry,
} from '@three-roaming/animation/rgbaSpriteAtlas';

export interface MoonTreeForestOptions {
  animationName?: string;
  areaSize?: number;
  count?: number;
  exclusionRadiusSquared?: number;
  padding?: number;
  random?: () => number;
  resolutionScale?: number;
  scale?: number;
}

export interface MoonTreeForest {
  group: THREE.Group;
  positions: readonly THREE.Vector3[];
  setNormals(cameraWorldQuaternion: THREE.Quaternion): void;
  update(dt: number): void;
}

export async function createMoonTreeForest(
  assetBaseUrl: string,
  options: MoonTreeForestOptions = {},
): Promise<MoonTreeForest> {
  const count = options.count ?? 500;
  const areaSize = options.areaSize ?? 1000;
  const exclusionRadiusSquared = options.exclusionRadiusSquared ?? 600;
  const random = options.random ?? Math.random;
  const scale = options.scale ?? 0.02;
  const atlas = await createRgbaSpriteAtlas(assetBaseUrl, 'moon_tree.zip', {
    animationName: options.animationName ?? 'sway1_loop_tall',
    padding: options.padding ?? 2,
    resolutionScale: options.resolutionScale ?? 0.5,
  });
  const geometry = createRgbaSpriteFrameGeometry(atlas.frames[0], { anchor: 'bottom' });
  const positions = Array.from({ length: count }, () => {
    while (true) {
      const x = random() * areaSize - areaSize / 2;
      const z = random() * areaSize - areaSize / 2;
      if (x * x + z * z > exclusionRadiusSquared) return new THREE.Vector3(x, 0, z);
    }
  });

  const group = new THREE.Group();
  group.name = 'MoonTreeForest';
  const depthPass = new THREE.Group();
  depthPass.name = 'MoonTreeDepthPass';
  const colorPass = new THREE.Group();
  colorPass.name = 'MoonTreeColorPass';
  colorPass.renderOrder = -1;
  group.add(depthPass, colorPass);

  const colorMaterial = new THREE.MeshBasicMaterial({
    map: atlas.texture,
    transparent: true,
    alphaTest: 0.01,
    depthTest: true,
    depthWrite: false,
    side: THREE.BackSide,
    toneMapped: false,
  });
  const depthMaterial = colorMaterial.clone();
  depthMaterial.transparent = false;
  depthMaterial.depthWrite = true;
  depthMaterial.colorWrite = false;
  depthMaterial.alphaToCoverage = true;

  const colorMesh = new THREE.InstancedMesh(geometry, colorMaterial, count);
  const depthMesh = new THREE.InstancedMesh(geometry, depthMaterial, count);
  colorMesh.name = 'MoonTreeColor';
  depthMesh.name = 'MoonTreeDepth';
  colorMesh.frustumCulled = false;
  depthMesh.frustumCulled = false;
  colorPass.add(colorMesh);
  depthPass.add(depthMesh);

  let animationElapsed = 0;
  let animationFrameIndex = 0;
  const rootMatrix = new THREE.Matrix4();
  const localMatrix = new THREE.Matrix4().makeScale(scale, -scale, scale);
  const instanceMatrix = new THREE.Matrix4();
  const unitScale = new THREE.Vector3(1, 1, 1);
  const lastQuaternion = new THREE.Quaternion();
  let hasQuaternion = false;

  const forest: MoonTreeForest = {
    group,
    positions,
    setNormals(cameraWorldQuaternion) {
      if (hasQuaternion
        && Math.abs(lastQuaternion.dot(cameraWorldQuaternion)) > 1 - 1e-10) return;
      lastQuaternion.copy(cameraWorldQuaternion);
      hasQuaternion = true;

      positions.forEach((position, index) => {
        rootMatrix.compose(position, cameraWorldQuaternion, unitScale);
        instanceMatrix.multiplyMatrices(rootMatrix, localMatrix);
        colorMesh.setMatrixAt(index, instanceMatrix);
        depthMesh.setMatrixAt(index, instanceMatrix);
      });
      colorMesh.instanceMatrix.needsUpdate = true;
      depthMesh.instanceMatrix.needsUpdate = true;
    },
    update(dt) {
      animationElapsed += Math.min(dt, 0.1);
      const nextFrameIndex = Math.floor(animationElapsed * atlas.frameRate) % atlas.frames.length;
      if (nextFrameIndex === animationFrameIndex) return;
      animationFrameIndex = nextFrameIndex;
      updateRgbaSpriteFrameGeometry(
        geometry,
        atlas.frames[animationFrameIndex],
        { anchor: 'bottom' },
      );
    },
  };
  forest.setNormals(new THREE.Quaternion());
  return forest;
}
