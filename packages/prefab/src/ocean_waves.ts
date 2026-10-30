import { PrefabDisplayGroup, SpriteResources } from '@dontstarve-web/display';
import type * as THREE from 'three';
import { createEffect, watchSignal, type TileStateQuery } from '@dontstarve-web/signals';
import type { ShimmerKind, WaveMap, WaveSpawner } from '../../componets/src/wavemanager';
import { TileTracker } from '../../componets/src/tileManager';
import { createArchiveEntity } from './prefabInstance';

// prefabs/wave_shimmer.lua and wave_shore.lua: non-persistent LAYER_BACKGROUND fx removed on animover.
const SHIMMERS = {
  wave_shimmer: { archive: 'wave_shimmer.zip', bank: 'shimmer' },
  wave_shimmer_med: { archive: 'wave_shimmer_med.zip', bank: 'shimmer' },
  wave_shimmer_deep: { archive: 'wave_shimmer_deep.zip', bank: 'shimmer_deep' },
} as const satisfies Record<ShimmerKind, { archive: string; bank: string }>;
const SHORE = { archive: 'wave_shore.zip', bank: 'wave_shore' } as const;
const SHORE_SMALL = ['idle_small', 'idle_small2', 'idle_small3', 'idle_small4'] as const;
const TAGS = ['CLASSIFIED', 'FX', 'NOCLICK', 'NOBLOCK', 'ignorewalkableplatforms'] as const;
/** tiledefs.lua WAVETINTS.shallow, the wavetint of OCEAN_COASTAL. */
const WAVE_TINT: [number, number, number, number] = [0.8, 0.9, 1, 1];
/** LAYER_BACKGROUND decor: above the ground and ocean layers (-1.75..-0.55), below entities. */
const BACKGROUND_RENDER_ORDER = -0.5;
const DEGREES = Math.PI / 180;

type WaveEntity = ReturnType<typeof createArchiveEntity>;

/** Spawns wave fx near the player; they are never saved, and their displays load the declared art. */
export class OceanWaves implements WaveSpawner {
  private readonly displays: PrefabDisplayGroup;
  private readonly resources: SpriteResources;
  private readonly map: WaveMap;
  private readonly scale: number;
  private readonly tickingarea?: TileStateQuery;
  private readonly active = new Map<WaveEntity, () => void>();
  private disposed = false;

  constructor(scene: THREE.Scene, map: WaveMap, scale: number, tickingarea?: TileStateQuery) {
    this.displays = new PrefabDisplayGroup(scene);
    this.resources = new SpriteResources(undefined, 'ocean-waves');
    this.map = map;
    this.scale = scale;
    this.tickingarea = tickingarea;
  }

  spawnShimmer(kind: ShimmerKind, x: number, z: number): void {
    const { archive, bank } = SHIMMERS[kind];
    this.spawn(archive, bank, 'idle', x, z);
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
    this.spawn(SHORE.archive, SHORE.bank, animation, x, z, rotation);
  }

  /** A shore wave has a Transform rotation and lies OnGround; a shimmer faces the camera. */
  private spawn(archive: string, bank: string, animation: string, x: number, z: number, rotation?: number): void {
    if (this.disposed) return;
    const flat = rotation !== undefined;
    const source = this.resources.archive({ animationArchive: archive, buildArchives: [archive], bank, multColour: WAVE_TINT });
    const prefab = archive.replace('.zip', '');
    // PlayAnimation(animation, false); animover removes the wave once its clip has been drawn.
    const wave: WaveEntity = createArchiveEntity(prefab, source, { name: animation, billboard: !flat }, prefab, instance => {
      for (const tag of TAGS) instance.addTag(tag);
      instance.persists = false;
      instance.sprite.setGround(0, flat);
      // Ground layers share group order 0 and sort by mesh order; a group order would draw the waves before the ocean.
      instance.sprite.setMeshOrder(BACKGROUND_RENDER_ORDER);
      instance.sprite.playOnce(animation, () => this.remove(wave));
    });
    wave.instance.position.set(x, 0, z);
    if (flat) wave.instance.setRotation(rotation);
    const cleanups: (() => void)[] = [];
    this.active.set(wave, () => cleanups.forEach(stop => stop()));
    const tile = this.tickingarea?.(new TileTracker(() => wave.instance.position).tile);
    if (tile) {
      const tileActivity = watchSignal(tile, stop => cleanups.push(stop));
      // wave_shimmer.lua / wave_shore.lua: OnEntitySleep = inst.Remove; sleeping FX never resume.
      const stopSleep = createEffect(() => { if (!tileActivity.get()) this.remove(wave); });
      if (this.active.has(wave)) cleanups.push(stopSleep); else stopSleep();
    }
    // A wave spawned asleep was removed at once and is never drawn.
    if (this.active.has(wave)) this.displays.mount(wave.display);
  }

  update(dt: number, _cameraQuaternion: THREE.Quaternion): void {
    if (!this.disposed) this.displays.update(Math.min(dt, 0.1));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const wave of [...this.active.keys()]) this.remove(wave);
    this.displays.dispose();
    this.resources.dispose();
  }

  private remove(wave: WaveEntity): void {
    const stop = this.active.get(wave);
    if (!stop) return;
    this.active.delete(wave);
    stop();
    wave.instance.remove();
  }
}
