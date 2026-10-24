import * as THREE from 'three';
import { ArchiveSpriteAssets, createArchiveSprite, createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { prewarmScenePasses, renderSceneWithPasses } from '@dontstarve-web/animation/sceneRenderPass';
import { composeResolvedRgbaSpriteAtlases, createRgbaSpriteFrameGeometry } from '@dontstarve-web/animation/rgbaSpriteAtlas';
import type { Animation, ResolvedSprite } from '@dontstarve-web/animation/animationAssets';
import { DstLocalLighting } from '../../../src/dstLocalLighting';

function checkAtlasFrameStability(renderer: THREE.WebGLRenderer, target: THREE.WebGLRenderTarget) {
  const data = new Uint8Array(8 * 4 * 4);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const i = (y * 8 + x) * 4;
    data[i] = (x + y) % 2 ? 255 : 40; data[i + 1] = 150; data[i + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, 8, 4);
  const source = new THREE.MeshBasicMaterial({ map: texture });
  const still: ResolvedSprite = {
    element: { imageHash: 1, imageIndex: 0, layerHash: 1, matrix: [1, 0, 0, 1, 0, 0], z: 0 },
    image: { index: 0, duration: 1, x: 0, y: 0, width: 8, height: 8, vertexIndex: 0, vertexCount: 6,
      bbx: 0, bby: 0, canvasWidth: 16, canvasHeight: 8 }, materials: [source],
  };
  // A moving transparent part changes the frame bounds while the painted part stays still.
  const frames = [3, 4, 5, -3].map(tx => [still, { ...still, image: { ...still.image, bbx: 8 },
    element: { ...still.element, matrix: [1, 0, 0, 1, tx, tx] as [number, number, number, number, number, number] } }]);
  const animation: Animation = { name: 'idle', frameRate: 30, facing: 0, bankHash: 0,
    frames: frames.map(parts => ({ elements: parts.map(part => part.element) })) };
  const pages = composeResolvedRgbaSpriteAtlases(animation, frames, 256);
  const scene = new THREE.Scene(), camera = new THREE.OrthographicCamera(-12, 12, 12, -12, .1, 10);
  camera.position.z = 5;
  let reference: Uint8Array | undefined;
  const differences: number[] = [];
  try {
    for (const page of pages) for (const frame of page.frames) {
      const geometry = createRgbaSpriteFrameGeometry(frame);
      const material = new THREE.MeshBasicMaterial({ map: page.texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material); scene.add(mesh);
      renderer.setRenderTarget(target); renderer.render(scene, camera);
      const pixels = new Uint8Array(192 * 192 * 4);
      renderer.readRenderTargetPixels(target, 0, 0, 192, 192, pixels);
      reference ??= pixels;
      // Different atlas UV offsets can change the final 8-bit rounding by one level.
      differences.push(pixels.reduce((sum, value, index) => sum + Number(Math.abs(value - reference![index]) > 1), 0));
      mesh.removeFromParent(); geometry.dispose(); material.dispose();
    }
    return differences;
  } finally { pages.forEach(page => page.texture.dispose()); texture.dispose(); source.dispose(); }
}

export async function checkTreeSpriteRendering(instanced = false) {
  const assets = new ArchiveSpriteAssets();
  const definition = {
    animationArchive: 'mushroom_tree_tall.zip',
    buildArchives: ['mushroom_tree_tall.zip', 'mushroom_tree_tall_bloom.zip'],
    bank: 'mushroom_tree',
    hiddenSymbols: [1, 2, 3].flatMap(index => [`swap_acidglob${index}`, `swap_acidglob_bloom${index}`]),
  };
  const shared = await Promise.all([.6, .9].map(colour => createSharedArchiveSprite(assets, {
    ...definition, animation: 'idle_loop', loop: true,
  }, { colour: [colour, colour, colour], instancedAnimations: instanced ? ['idle_loop'] : undefined })));
  const independent = await Promise.all([.6, .9].map(colour => createArchiveSprite(assets, {
    ...definition, animation: 'idle_loop', loop: true,
  }, { colour: [colour, colour, colour] })));
  const renderer = new THREE.WebGLRenderer();
  renderer.setSize(192, 192);
  renderer.setClearColor(0x26333f);
  const lighting = instanced ? new DstLocalLighting() : undefined;
  lighting?.setAmbientColour(new THREE.Vector3(1, 1, 1));
  lighting?.renderLightmap(renderer);
  const target = new THREE.WebGLRenderTarget(192, 192);
  const camera = new THREE.OrthographicCamera(-12, 12, 15, -3, .1, 100);
  camera.position.set(0, 6, 25);
  camera.lookAt(0, 6, 0);
  const scenes = [shared, independent].map(sprites => {
    const scene = new THREE.Scene();
    sprites.forEach((sprite, i) => {
      sprite.model.position.x = (i * 2 - 1) * 4;
      sprite.model.quaternion.copy(camera.quaternion);
      sprite.setFrame(7);
      scene.add(sprite.model);
    });
    return scene;
  });
  const pixels = (scene: THREE.Scene) => {
    // Newly shown appearances are composed over several frames; finish them so each comparison draws complete art.
    assets.instancedSprites.flush(renderer);
    renderer.setRenderTarget(target);
    renderSceneWithPasses(renderer, scene, camera);
    const result = new Uint8Array(192 * 192 * 4);
    renderer.readRenderTargetPixels(target, 0, 0, 192, 192, result);
    return result;
  };
  const differences: number[] = [];
  const meanErrors: number[] = [];
  let paintedPixels = 0;
  const compare = () => {
    const cached = pixels(scenes[0]), reference = pixels(scenes[1]);
    differences.push(cached.reduce((count, value, i) => count + Number(value !== reference[i]), 0));
    meanErrors.push(cached.reduce((sum, value, i) => sum + Math.abs(value - reference[i]), 0) / cached.length);
    for (let i = 0; i < cached.length; i += 4) {
      if (cached[i] !== cached[0] || cached[i + 1] !== cached[1] || cached[i + 2] !== cached[2]) paintedPixels++;
    }
  };
  try {
    await prewarmScenePasses(renderer, scenes[0], camera);
    compare();
    if (instanced) for (const frame of [0, 1, 2, 14, 15, 29]) {
      for (const sprite of [...shared, ...independent]) sprite.setFrame(frame);
      compare();
    }
    if (instanced) {
      camera.position.set(8, 12, 24); camera.lookAt(0, 6, 0);
      for (const sprite of [...shared, ...independent]) sprite.model.quaternion.copy(camera.quaternion);
      compare();
      camera.position.set(0, 6, 25); camera.lookAt(0, 6, 0);
      for (const sprite of [...shared, ...independent]) sprite.model.quaternion.copy(camera.quaternion);
    }
    shared[0].playOnce('chop'); independent[0].playOnce('chop');
    shared[0].update(.1); independent[0].update(.1);
    compare();
    for (const sprite of [shared[0], independent[0]]) {
      sprite.setBuildArchive('mushroom_tree_tall_bloom.zip');
      sprite.start('idle_loop'); sprite.setFrame(7);
    }
    compare();
    const drawCalls: number[] = [];
    const occlusion: number[][] = [];
    let reusedInstanceBuffers = false;
    // More trees with distinct phases must grow instance counts, not draw calls per entity.
    const extra = [];
    if (instanced) {
      const treePixels = pixels(scenes[0]);
      const buffers = (assets.instancedSprites as unknown as { scenes: Map<THREE.Scene, { pages: Map<unknown, {
        colour: THREE.InstancedMesh; geometry: THREE.BufferGeometry;
      }> }> }).scenes.get(scenes[0])!;
      const versions = () => [...buffers.pages.values()].flatMap(batch => [batch.colour.instanceMatrix.version,
        batch.colour.instanceColor!.version, ...(Object.values(batch.geometry.attributes) as THREE.BufferAttribute[]).map(attribute => attribute.version)]);
      const before = versions();
      pixels(scenes[0]);
      const after = versions();
      reusedInstanceBuffers = before.every((version, index) => version === after[index]);
      let sampleIndex = -1;
      for (let y = 20; y < 172 && sampleIndex < 0; y++) for (let x = 20; x < 172; x++) {
        let interior = true;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const i = ((y + dy) * 192 + x + dx) * 4;
          if (treePixels[i + 2] < 45) interior = false;
        }
        if (interior) { sampleIndex = (y * 192 + x) * 4; break; }
      }
      if (sampleIndex < 0) throw new Error('No opaque tree sample');
      const px = sampleIndex / 4 % 192, py = Math.floor(sampleIndex / 4 / 192);
      const world = new THREE.Vector3((px + .5) / 96 - 1, (py + .5) / 96 - 1, 0).unproject(camera);
      // Turf draws transparently without writing depth, just like the real ground layers.
      const turf = new THREE.Mesh(new THREE.PlaneGeometry(100, 100),
        new THREE.MeshBasicMaterial({ color: 0x246622, transparent: true, depthWrite: false, depthTest: false }));
      turf.position.z = -2; turf.renderOrder = -1;
      const ground = new THREE.Group(); ground.add(turf); scenes[0].add(ground);
      const withTurf = pixels(scenes[0]);
      occlusion.push([...treePixels.slice(sampleIndex, sampleIndex + 3)], [...withTurf.slice(sampleIndex, sampleIndex + 3)]);
      const marker = new THREE.Mesh(new THREE.PlaneGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color: 0xff0000, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      marker.position.set(world.x, world.y, -5); marker.renderOrder = 100;
      scenes[0].add(marker);
      occlusion.push([...pixels(scenes[0]).slice(sampleIndex, sampleIndex + 3)]);
      marker.position.z = 5;
      occlusion.push([...pixels(scenes[0]).slice(sampleIndex, sampleIndex + 3)]);
      ground.removeFromParent(); turf.geometry.dispose(); turf.material.dispose();
      marker.removeFromParent(); marker.geometry.dispose(); marker.material.dispose();
      for (let i = 0; i < 48; i++) {
        const sprite = await createSharedArchiveSprite(assets, {
          ...definition, animation: 'idle_loop', loop: true,
        }, { instancedAnimations: ['idle_loop'] });
        sprite.model.position.set((i % 8 - 4) * .5, 0, Math.floor(i / 8) * .1);
        sprite.setFrame(i % sprite.frameCount); scenes[0].add(sprite.model); extra.push(sprite);
      }
      renderer.info.autoReset = false; renderer.info.reset();
      pixels(scenes[0]); drawCalls.push(renderer.info.render.calls);
      shared[0].playOnce('chop');
      renderer.info.reset(); pixels(scenes[0]); drawCalls.push(renderer.info.render.calls);
      shared[0].start('idle_loop');
      renderer.info.reset(); pixels(scenes[0]); drawCalls.push(renderer.info.render.calls);
      for (const sprite of [...shared, ...extra]) sprite.dispose();
      renderer.info.reset(); pixels(scenes[0]); drawCalls.push(renderer.info.render.calls);
    }
    const stabilityDifferences = instanced ? checkAtlasFrameStability(renderer, target) : [];
    return { differences, meanErrors, paintedPixels, drawCalls, occlusion, stabilityDifferences, reusedInstanceBuffers };
  } finally {
    for (const sprite of [...shared, ...independent]) sprite.dispose();
    assets.dispose(); target.dispose(); lighting?.dispose(); renderer.dispose();
  }
}

/** Compare the actual birch draw with source image intervals, including intentionally absent override slots. */
export async function checkBirchLeafRendering(instanced = false) {
  const { loadBuild, loadAnim, smallHash } = await import('@dontstarve-web/animation/animationAssets');
  const { createSpriteFactory, loadSymbolOverride } = await import('@dontstarve-web/animation/sprite');
  const base = '/dst/data/anim';
  const [trunk, leaf, bank, override] = await Promise.all([
    loadBuild('tree_leaf_trunk_build.zip', base), loadBuild('tree_leaf_green_build.zip', base),
    loadAnim('tree_leaf_tall.zip', base), loadSymbolOverride(base, 'tree_leaf_green_build.zip', 'swap_leaves'),
  ]);
  const factory = createSpriteFactory(trunk, bank);
  const assets = new ArchiveSpriteAssets();
  const definition = { animationArchive: 'tree_leaf_tall.zip',
    buildArchives: ['tree_leaf_trunk_build.zip', 'tree_leaf_green_build.zip'], bank: 'tree_leaf',
    animation: 'sway1_loop_tall', loop: true,
    symbolOverrides: { swap_leaves: { archive: 'tree_leaf_green_build.zip', symbol: 'swap_leaves' } },
    hiddenSymbols: ['mouseover', 'snow'],
  };
  const shared = instanced ? await createSharedArchiveSprite(assets, definition,
    { colour: [1, 1, 1], instancedAnimations: ['sway1_loop_tall'] }) : undefined;
  const extra: Awaited<ReturnType<typeof createSharedArchiveSprite>>[] = [];
  const model = shared?.model ?? factory.create({ initialAnimation: 'sway1_loop_tall', scale: .02 });
  const controller = model.userData.animationController ?? shared;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, preserveDrawingBuffer: true });
  renderer.setSize(600, 600); renderer.setClearColor(0, 0);
  const reference = document.createElement('canvas'); reference.width = reference.height = 600;
  const actual = document.createElement('canvas'); actual.width = actual.height = 600;
  const sources: HTMLCanvasElement[] = [];
  try {
    if (!shared) controller.setSymbolOverrides(new Map([[smallHash('swap_leaves'), override]]), ['mouseover']);
    controller.setFrame(0);
    const scene = new THREE.Scene(); scene.add(model);
    const camera = new THREE.OrthographicCamera(-40 / 3, 40 / 3, 24, -8 / 3, .1, 100);
    camera.position.z = 10;
    assets.instancedSprites.flush(renderer);
    renderSceneWithPasses(renderer, scene, camera);
    actual.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
    const ctx = reference.getContext('2d')!;
    ctx.setTransform(.45, 0, 0, .45, 300, 540);
    const atlases = [trunk, leaf].map(pkg => pkg.atlases.map(atlas => {
      const canvas = document.createElement('canvas'); canvas.width = atlas.width; canvas.height = atlas.height;
      canvas.getContext('2d')!.putImageData(new ImageData(Uint8ClampedArray.from(atlas.pixels), atlas.width, atlas.height), 0, 0);
      sources.push(canvas); return canvas;
    }));
    const frame = bank.animations.find(clip => clip.name === 'sway1_loop_tall')!.frames[0];
    let expectedParts = 0;
    for (const element of [...frame.elements].sort((a, b) => b.z - a.z)) {
      if (element.layerHash === smallHash('mouseover')) continue;
      const source = element.imageHash === smallHash('swap_leaves') ? 1 : 0;
      // Independent reference: an index outside the source duration draws nothing.
      const image = [trunk, leaf][source].build.symbols.get(element.imageHash)?.find(image =>
        image.vertexCount > 0 && image.index <= element.imageIndex && element.imageIndex < image.index + image.duration);
      if (!image) continue;
      const atlas = atlases[source][image.sampler ?? 0];
      const sx = atlas.width / image.canvasWidth!, sy = atlas.height / image.canvasHeight!;
      ctx.save(); ctx.transform(...element.matrix);
      ctx.drawImage(atlas, image.bbx! * sx, image.bby! * sy, image.width * sx, image.height * sy,
        image.x - image.width / 2, image.y - image.height / 2, image.width, image.height);
      ctx.restore(); expectedParts++;
    }
    const gpu = actual.getContext('2d')!.getImageData(0, 0, 600, 600).data;
    const expected = ctx.getImageData(0, 0, 600, 600).data;
    const meanError = gpu.reduce((sum, value, i) => sum + Math.abs(value - expected[i]), 0) / gpu.length;
    const mesh = model.children[0].children[0] as THREE.Mesh;
    const drawCalls: number[] = [];
    let privateTint = false, workDrawn = false, independentFrames = false;
    if (shared) {
      renderer.info.autoReset = false;
      const draw = () => { renderer.info.reset(); renderSceneWithPasses(renderer, scene, camera); drawCalls.push(renderer.info.render.calls); };
      draw();
      for (let i = 0; i < 20; i++) {
        const tree = await createSharedArchiveSprite(assets, definition,
          { colour: [1, 1, 1], instancedAnimations: ['sway1_loop_tall'] });
        tree.setFrame(i % 8); scene.add(tree.model); extra.push(tree);
      }
      draw();
      shared.setColour([.5, .5, .5]); draw();
      const colours: number[] = [], phases = new Set<string>();
      scene.traverse(object => {
        if (object instanceof THREE.InstancedMesh && object.name === 'ArchiveSpriteInstances:colour') {
          const uv = object.geometry.getAttribute('spriteUv');
          for (let i = 0; i < object.count; i++) {
            colours.push(object.instanceColor!.getX(i));
            phases.add(`${uv.getX(i)},${uv.getY(i)},${uv.getZ(i)},${uv.getW(i)}`);
          }
        }
      });
      independentFrames = phases.size > 1;
      privateTint = colours.filter(colour => colour === .5).length === 1 && colours.filter(colour => colour === 1).length === 20;
      shared.playOnce('chop_tall', () => shared.start('sway1_loop_tall')); draw();
      workDrawn = mesh.visible;
      for (let i = 0; i < 100 && shared.currentAnimation !== 'sway1_loop_tall'; i++) shared.update(.1);
      draw();
      shared.dispose(); extra.forEach(tree => tree.dispose()); draw();
    }
    return { expectedParts, drawnParts: mesh.geometry.drawRange.count / 6, meanError, drawCalls, privateTint, workDrawn, independentFrames };
  } finally {
    shared?.dispose(); extra.forEach(tree => tree.dispose()); assets.dispose();
    factory.dispose(); override.dispose(); renderer.dispose();
    for (const canvas of [...sources, actual, reference]) canvas.width = canvas.height = 0;
  }
}
