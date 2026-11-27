import * as THREE from 'three';
import { expect, it } from 'vitest';
import type { Animation, ResolvedSprite } from '../src/animationAssets';
import { markPremultipliedSrgbAtlas } from '../src/atlasFormat';
import { InstancedPartMaterial } from '../src/instancedPartMaterial';
import {
  createInstancedPartTable,
  partTableFrame,
  PART_TEXELS,
  type InstancedPartTable,
} from '../src/instancedPartTable';
import { NO_OCEAN_SHADING } from '../src/oceanShading';
import { InstancedSpriteBatches, type BatchedSprite } from '../src/instancedSpriteBatches';
import { createSpriteCameraRotation, createSpritePlacement } from '../src/instancedSpritePlacement';

type Matrix2D = [number, number, number, number, number, number];

function material(name: string): THREE.MeshBasicMaterial {
  const texture = new THREE.Texture();
  texture.name = name;
  return new THREE.MeshBasicMaterial({ map: texture });
}

function part(source: THREE.MeshBasicMaterial, matrix: Matrix2D, lightOverride?: number): ResolvedSprite {
  return {
    element: { imageHash: 1, imageIndex: 0, layerHash: 1, matrix, z: 0 },
    image: {
      index: 0,
      duration: 1,
      x: 3,
      y: -2,
      width: 8,
      height: 4,
      vertexIndex: 0,
      vertexCount: 6,
      sampler: 0,
      bbx: 16,
      bby: 4,
      canvasWidth: 64,
      canvasHeight: 32,
    },
    materials: [source],
    lightOverride,
  };
}

function animationOf(frames: ResolvedSprite[][]): Animation {
  return {
    name: 'sway',
    facing: 0,
    bankHash: 0,
    frameRate: 30,
    frames: frames.map(parts => ({ elements: parts.map(({ element }) => element) })),
  };
}

/** A part's quad corner (s, t ∈ {0, 1}) and UV as the vertex shader derives them from its table row. */
function corner(table: InstancedPartTable, frame: number, slot: number, s: number, t: number) {
  const offset = frame * table.slots * PART_TEXELS * 4 + slot * PART_TEXELS * 4;
  const [ax, ay, cx, cy, ox, oy, , , u0, v0, u1, v1] = table.data.subarray(offset, offset + PART_TEXELS * 4);
  return { x: ax * s + cx * t + ox, y: ay * s + cy * t + oy, u: u0 + (u1 - u0) * s, v: v0 + (v1 - v0) * t };
}

it('places each part like the ordinary merged frame, one row per frame and slot, padding short frames', () => {
  const straight = material('straight'),
    premultiplied = material('premultiplied');
  markPremultipliedSrgbAtlas(premultiplied.map!.source);
  const rotated: Matrix2D = [0, 1, -1, 0, 10, 20];
  const frames = [
    [part(straight, [2, 0, 0, 1, 5, 0]), part(premultiplied, rotated, 0.5)],
    [part(straight, [1, 0, 0, 1, -4, 0])],
  ];
  const table = createInstancedPartTable(animationOf(frames), index => frames[index])!;

  expect(table.slots).toBe(2);
  expect(table.textures).toEqual([straight.map, premultiplied.map]);
  expect(table.premultiplied).toEqual([false, true]);
  expect(table.source).toBe(straight);
  expect([table.texture.image.width, table.texture.image.height]).toEqual([2 * PART_TEXELS, 2]);
  expect(table.bytes).toBe(2 * 2 * 48);

  // The ordinary geometry's corners: x0 = x - w/2 = -1, y0 = y - h/2 = -4, then the element matrix.
  const [a, b, c, d, tx, ty] = rotated;
  for (const [s, t] of [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]) {
    const x = -1 + 8 * s,
      y = -4 + 4 * t;
    const placed = corner(table, 0, 1, s, t);
    expect(placed.x).toBeCloseTo(a * x + c * y + tx);
    expect(placed.y).toBeCloseTo(b * x + d * y + ty);
    expect(placed.u).toBeCloseTo((16 + 8 * s) / 64);
    expect(placed.v).toBeCloseTo((4 + 4 * t) / 32);
  }
  const rowFloats = table.slots * PART_TEXELS * 4;
  // Texture index and symbol light override.
  expect([...table.data.subarray(PART_TEXELS * 4 + 6, PART_TEXELS * 4 + 8)]).toEqual([1, 0.5]);
  // Frame 1 has one part: its second slot is a zero, degenerate quad.
  expect([...table.data.subarray(rowFloats + PART_TEXELS * 4, 2 * rowFloats)].every(value => value === 0)).toBe(true);
  expect(corner(table, 1, 0, 1, 1)).toMatchObject({ x: 3, y: 0 });

  // One clip-wide bound for every frame, as a composed page's frames share one cell grid.
  const [first, second] = table.frames;
  expect(first).toMatchObject({ frameIndex: 0, minX: -5, maxX: 19, minY: -4, maxY: 27 });
  expect({ ...second, frameIndex: 0 }).toEqual(first);
  expect(partTableFrame(table, 9)).toBe(second);
});

it('leaves appearances whose parts sample more than four textures to composition', () => {
  const parts = ['a', 'b', 'c', 'd', 'e'].map(name => part(material(name), [1, 0, 0, 1, 0, 0]));
  expect(createInstancedPartTable(animationOf([parts]), () => parts)).toBeUndefined();
  expect(createInstancedPartTable(animationOf([parts.slice(0, 4)]), () => parts.slice(0, 4))).toBeDefined();
});

it('draws a part table entity as one instance per slot and uploads only the frame row when it advances', () => {
  const source = material('build');
  const frames = [0, 1, 2].map(frame => [
    part(source, [1, 0, 0, 1, frame, 0]),
    part(source, [1, 0, 0, 1, 0, frame]),
    part(source, [1, 0, 0, 1, 0, 0]),
  ]);
  const table = createInstancedPartTable(animationOf(frames), index => frames[index])!;
  const batches = new InstancedSpriteBatches({ render: () => {}, prewarm: async () => {} });
  const scene = new THREE.Scene();
  const entities = [0, 1].map(id => {
    const placement = createSpritePlacement();
    placement.matrix.makeTranslation(id * 10, 0, 5);
    return {
      entry: {
        id,
        placement,
        spatial: { version: 0 },
        styleVersion: 0,
        colour: new THREE.Color(1, 1, 1),
        opacity: 1,
        erosion: 0,
        ocean: NO_OCEAN_SHADING,
      },
      member: { lightOverride: 0 },
      frame: partTableFrame(table, 0),
    } as unknown as BatchedSprite & { frame: { frameIndex: number } };
  });
  const submit = () =>
    batches.submit(
      scene,
      new Map([
        [batches.segmentKey(table, 0), { source, entries: entities, start: 0, end: entities.length, order: 0 }],
      ]),
    );
  submit();
  const mesh = scene.getObjectByName('ArchiveSpriteInstances:colour') as THREE.InstancedMesh;
  expect(mesh.material).toBeInstanceOf(InstancedPartMaterial);
  expect(mesh.count).toBe(6);
  const matrix = new THREE.Matrix4();
  for (let instance = 0; instance < 6; instance++) {
    // Each slot carries its entity's own matrix: the table, not the instance, places the part.
    mesh.getMatrixAt(instance, matrix);
    expect(matrix.equals(entities[Math.floor(instance / 3)].entry.placement.matrix)).toBe(true);
  }
  const partFrame = mesh.geometry.getAttribute('partFrame') as THREE.InstancedBufferAttribute;
  expect(mesh.geometry.getAttribute('spriteUv')).toBeUndefined();
  expect([...partFrame.array.subarray(0, 6)]).toEqual([0, 0, 0, 0, 0, 0]);

  for (const attribute of [partFrame, mesh.instanceMatrix]) {
    attribute.clearUpdateRanges();
  }
  (entities[1] as { frame: unknown }).frame = partTableFrame(table, 2);
  submit();
  expect([...partFrame.array.subarray(0, 6)]).toEqual([0, 0, 0, 2, 2, 2]);
  expect(partFrame.updateRanges).toEqual([{ start: 3, count: 3 }]);
  expect(mesh.instanceMatrix.updateRanges).toEqual([]);

  // A parked part batch serves another table of another slot layout, writing its instances afresh.
  batches.submit(scene, new Map());
  const smaller = [part(source, [1, 0, 0, 1, 0, 0])];
  const single = createInstancedPartTable(animationOf([smaller]), () => smaller)!;
  for (const entity of entities) {
    (entity as { frame: unknown }).frame = partTableFrame(single, 0);
  }
  batches.submit(
    scene,
    new Map([[batches.segmentKey(single, 0), { source, entries: entities, start: 0, end: 2, order: 0 }]]),
  );
  const reused = scene.getObjectByName('ArchiveSpriteInstances:colour') as THREE.InstancedMesh;
  expect(reused).toBe(mesh);
  expect(reused.count).toBe(2);
  expect((reused.material as InstancedPartMaterial).partUniforms.partSlots.value).toBe(1);
  reused.getMatrixAt(1, matrix);
  expect(matrix.equals(entities[1].entry.placement.matrix)).toBe(true);
  batches.dispose();
});

it('patches the basic material shader at every anchor it replaces', () => {
  const source = material('build');
  const parts = [part(source, [1, 0, 0, 1, 0, 0])];
  const table = createInstancedPartTable(animationOf([parts]), () => parts)!;
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.basic.vertexShader,
    fragmentShader: THREE.ShaderLib.basic.fragmentShader,
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  const cameraRotation = createSpriteCameraRotation();
  const result = new InstancedPartMaterial(table, source, cameraRotation);
  result.onBeforeCompile(shader);
  expect(shader.vertexShader).toContain('spriteCameraRotation * transformed');
  expect(shader.uniforms.spriteCameraRotation).toBe(cameraRotation);
  expect(shader.vertexShader).toContain('texelFetch(partTable');
  expect(shader.vertexShader).not.toContain('#include <begin_vertex>');
  expect(shader.fragmentShader).not.toContain('#include <map_fragment>');
  expect(shader.fragmentShader).toContain('texture2D(partMap3, vMapUv)');
  expect(shader.fragmentShader).toContain('diffuseColor.a *= vSpriteOpacity');
  expect(shader.uniforms.partTable.value).toBe(table.texture);
});
