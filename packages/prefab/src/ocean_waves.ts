import * as THREE from 'three';
import { findImage, smallHash, SpriteFrameRenderer, type Animation, type ResolvedSprite } from '@dontstarve-web/animation/animationAssets';
import { createEffect, watchSignal, type TileStateQuery } from '@dontstarve-web/signals';
import type { ShimmerKind, WaveMap, WaveSpawner } from '../../componets/src/wavemanager';
import { TileTracker } from '../../componets/src/tileManager';
import { GroundItemAssets } from './groundItems';
import { createEmptyEntity } from './prefabInstance';

// prefabs/wave_shimmer.lua and wave_shore.lua: non-persistent LAYER_BACKGROUND fx removed on animover.
const SHIMMERS = {
  wave_shimmer: { archive: 'wave_shimmer.zip', bank: 'shimmer' },
  wave_shimmer_med: { archive: 'wave_shimmer_med.zip', bank: 'shimmer' },
  wave_shimmer_deep: { archive: 'wave_shimmer_deep.zip', bank: 'shimmer_deep' },
} as const satisfies Record<ShimmerKind, { archive: string; bank: string }>;
const SHORE = { archive: 'wave_shore.zip', bank: 'wave_shore' } as const;
const SHORE_SMALL = ['idle_small', 'idle_small2', 'idle_small3', 'idle_small4'] as const;
/** tiledefs.lua WAVETINTS.shallow, the wavetint of OCEAN_COASTAL. */
const WAVE_TINT: [number, number, number, number] = [0.8, 0.9, 1, 1];
/** LAYER_BACKGROUND decor: above the ground and ocean layers (-1.75..-0.55), below entities. */
const BACKGROUND_RENDER_ORDER = -0.5;
const DEGREES = Math.PI / 180;

type FxBuild = Awaited<ReturnType<GroundItemAssets['loadBuild']>>;
interface WaveAssets { animations: ReadonlyMap<string, Animation>; build: FxBuild }
interface Wave {
  /** The wave entity; it draws its frames itself under the display's model. */
  entity: ReturnType<typeof createEmptyEntity>;
  model: THREE.Group;
  renderer: SpriteFrameRenderer;
  assets: WaveAssets;
  animation: Animation;
  flat: boolean;
  elapsed: number;
  frame: number;
  stopTileActivity?: () => void;
}

/** Spawns and animates wave fx near the player; they are never saved. */
export class OceanWaves implements WaveSpawner {
  private readonly scene: THREE.Scene;
  private readonly map: WaveMap;
  private readonly scale: number;
  private readonly assets: GroundItemAssets;
  private readonly tickingarea?: TileStateQuery;
  private readonly ready = new Map<string, WaveAssets>();
  private readonly active = new Set<Wave>();
  private prepared?: Promise<void>;
  private disposed = false;

  constructor(scene: THREE.Scene, map: WaveMap, scale: number, tickingarea?: TileStateQuery) {
    this.scene = scene;
    this.map = map;
    this.scale = scale;
    this.tickingarea = tickingarea;
    this.assets = new GroundItemAssets();
  }

  /** Load every wave archive; spawn requests are ignored until it resolves. */
  prepare(): Promise<void> {
    this.prepared ??= Promise.all([...Object.values(SHIMMERS), SHORE].map(async ({ archive }) => {
      const [parsed, build] = await Promise.all([
        this.assets.loadAnimation(archive), this.assets.loadBuild(archive, { multColour: WAVE_TINT }),
      ]);
      if (this.disposed) return;
      this.ready.set(archive, {
        animations: new Map(parsed.animations.map((clip) => [`${clip.bankHash}:${clip.name}`, clip])), build,
      });
    })).then(() => undefined);
    return this.prepared;
  }

  spawnShimmer(kind: ShimmerKind, x: number, z: number): void {
    const { archive, bank } = SHIMMERS[kind];
    this.spawn(archive, bank, 'idle', x, z, false, 0);
  }

  /** wave_shore.lua SetAnim: edge waves shift sideways and play the medium clip; corners play the big one. */
  spawnShore(x: number, z: number, rotation: number): void {
    const bearing = -(rotation + 90) * DEGREES;
    const landAt = (angle: number) => this.map.isLandTile(this.map.tileAt(
      x + this.scale * Math.cos(bearing + angle), z + this.scale * Math.sin(bearing + angle)));
    const oceanAt = (angle: number) => this.map.isOceanTile(this.map.tileAt(
      x + this.scale * Math.cos(bearing + angle), z + this.scale * Math.sin(bearing + angle)));
    const left = landAt(0.25 * Math.PI) && oceanAt(0.5 * Math.PI);
    const right = landAt(-0.25 * Math.PI) && oceanAt(-0.5 * Math.PI);
    const half = 0.5 * this.map.tileSize;
    let animation: string = SHORE_SMALL[Math.floor(Math.random() * SHORE_SMALL.length)];
    if (left && right) animation = 'idle_big';
    else if (left || right) {
      const side = left ? -1 : 1;
      x += side * half * Math.cos(bearing - 0.5 * Math.PI);
      z += side * half * Math.sin(bearing - 0.5 * Math.PI);
      animation = 'idle_med';
    }
    this.spawn(SHORE.archive, SHORE.bank, animation, x, z, true, rotation);
  }

  private spawn(archive: string, bank: string, name: string, x: number, z: number, flat: boolean, rotation: number): void {
    const assets = this.ready.get(archive);
    if (!assets || this.disposed) return;
    const animation = assets.animations.get(`${smallHash(bank)}:${name}`);
    if (!animation?.frames.length) throw new Error(`Missing wave animation ${bank}:${name}`);
    const prefab = archive.replace('.zip', '');
    const entity = createEmptyEntity(prefab), model = entity.display.model;
    model.userData.billboard = !flat;
    entity.instance.persists = false;
    for (const tag of ['FX', 'NOCLICK']) entity.instance.addTag(tag);
    entity.instance.position.set(x, 0, z);
    const visual = new THREE.Group();
    visual.scale.set(0.02, -0.02, 0.02);
    if (flat) {
      // SetOrientation(OnGround) tilts only the art; Transform rotation is DST's counter-clockwise-from-+x heading.
      model.rotation.order = 'YXZ';
      model.rotation.set(-Math.PI / 2, rotation * DEGREES, 0);
      visual.position.z = 0.02;
    }
    model.add(visual);
    const renderer = new SpriteFrameRenderer(visual);
    // Ground layers share group order 0 and sort by mesh order; a group order would draw the waves before the ocean.
    visual.children[0].renderOrder = BACKGROUND_RENDER_ORDER;
    const wave: Wave = { entity, model, renderer, assets, animation, flat, elapsed: 0, frame: -1 };
    this.showFrame(wave, 0);
    this.active.add(wave);
    this.scene.add(model);
    const source = this.tickingarea?.(new TileTracker(() => model.position).tile);
    if (source) {
      const tileActivity = watchSignal(source, stop => { wave.stopTileActivity = stop; });
      // wave_shimmer.lua / wave_shore.lua: OnEntitySleep = inst.Remove; sleeping FX never resume.
      createEffect(() => { if (!tileActivity.get()) this.remove(wave); });
    }
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    for (const wave of this.active) {
      wave.elapsed += Math.min(dt, 0.1);
      const frame = Math.floor(wave.elapsed * wave.animation.frameRate + 1e-8);
      if (frame >= wave.animation.frames.length) { this.remove(wave); continue; }
      if (!wave.flat) wave.model.quaternion.copy(cameraQuaternion);
      this.showFrame(wave, frame);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const wave of [...this.active]) this.remove(wave);
    this.ready.clear();
    this.assets.dispose();
  }

  private remove(wave: Wave): void {
    if (!this.active.delete(wave)) return;
    wave.stopTileActivity?.();
    wave.model.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    wave.entity.instance.remove(); wave.entity.display.dispose();
  }

  private showFrame(wave: Wave, index: number): void {
    if (wave.frame === index) return;
    const sprites: ResolvedSprite[] = [];
    for (const element of [...wave.animation.frames[index].elements].sort((a, b) => b.z - a.z)) {
      const image = findImage(wave.assets.build.build, element.imageHash, element.imageIndex);
      if (image) sprites.push({ element, image, materials: wave.assets.build.materials });
    }
    wave.renderer.show(sprites);
    wave.frame = index;
  }
}
