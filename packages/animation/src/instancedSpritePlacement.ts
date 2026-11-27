import * as THREE from 'three';

/**
 * Where a batched entity is drawn, uploaded as its instance matrix and `spriteScale`. A billboard's (`facesCamera`)
 * leaves out the camera's rotation, which the vertex shader puts between them from one uniform for the whole pass:
 * the CPU writes it again only when the entity moves, not when the camera turns.
 */
export interface SpritePlacement {
  /**
   * A billboard's foot origin and its root's linear part without the root's world rotation, which the camera facing
   * cancels; any other sprite's visual world matrix.
   */
  readonly matrix: THREE.Matrix4;
  /** A billboard's visual scale, with its facing flip in x; 1 for any other sprite, whose matrix includes it. */
  readonly scale: THREE.Vector3;
  readonly facesCamera: boolean;
  /** Bumped whenever the placement changes: a billboard's stays when only the camera rotation its display gave it did. */
  readonly version: number;
}

interface MutablePlacement extends SpritePlacement {
  facesCamera: boolean;
  version: number;
}

export function createSpritePlacement(): MutablePlacement {
  return { matrix: new THREE.Matrix4(), scale: new THREE.Vector3(1, 1, 1), facesCamera: false, version: 0 };
}

const ONE = new THREE.Vector3(1, 1, 1);
const rootRotation = new THREE.Quaternion();
const placed = new THREE.Matrix4();
const placedScale = new THREE.Vector3();

/**
 * The placement of `visual`, drawn by `model` under its root. A billboard turned to the camera by its display holds
 * the camera rotation against its root's (PrefabDisplay.alignVisual), so its visual's world matrix is
 * `root · T(model.position) · rootRotation⁻¹ · camera · scale(visual)`: the placement keeps everything but `camera`,
 * whatever rotation the model was last given. A billboard whose visual has its own offset or rotation is placed by
 * its world matrix, like any other sprite.
 */
export function placeSprite(
  placement: MutablePlacement,
  model: THREE.Object3D,
  visual: THREE.Object3D,
  facesCamera: boolean,
): void {
  const billboard =
    facesCamera &&
    visual.position.x === 0 &&
    visual.position.y === 0 &&
    visual.position.z === 0 &&
    visual.quaternion.x === 0 &&
    visual.quaternion.y === 0 &&
    visual.quaternion.z === 0;
  if (!billboard) {
    placed.copy(visual.matrixWorld);
    placedScale.copy(ONE);
  } else {
    const root = model.parent;
    rootRotation.identity();
    for (let parent = root; parent; parent = parent.parent) {
      rootRotation.premultiply(parent.quaternion);
    }
    placed.compose(model.position, rootRotation.invert(), ONE);
    if (root) {
      placed.premultiply(root.matrixWorld);
    }
    placedScale.copy(visual.scale);
  }
  if (placement.facesCamera !== billboard || !placement.matrix.equals(placed) || !placement.scale.equals(placedScale)) {
    placement.facesCamera = billboard;
    placement.matrix.copy(placed);
    placement.scale.copy(placedScale);
    placement.version++;
  }
}

/** The camera's world rotation, the uniform every batched billboard of a pass turns to. */
export type SpriteCameraRotation = THREE.IUniform<THREE.Matrix3>;

export function createSpriteCameraRotation(): SpriteCameraRotation {
  return { value: new THREE.Matrix3() };
}

/** Vertex declarations: the placement's scale and billboard flag, and the pass's camera rotation. */
export const SPRITE_PLACEMENT_DECLARATIONS = `
      attribute vec4 spriteScale;
      uniform mat3 spriteCameraRotation;
`;

/**
 * Turns the sprite-local `transformed` into what the instance matrix places: scaled and turned to the camera for a
 * billboard (`spriteScale.w`), unchanged otherwise.
 */
export const SPRITE_PLACEMENT_VERTEX = `
      transformed *= spriteScale.xyz;
      if (spriteScale.w > 0.5) {
        transformed = spriteCameraRotation * transformed;
      }
`;
