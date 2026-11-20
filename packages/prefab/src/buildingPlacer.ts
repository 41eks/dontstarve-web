import type { TheCamera } from './followcamera';
import { PrefabDisplayGroup, SpriteResources, type PrefabDisplay } from '@dontstarve-web/display';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import { bindActionCancellation } from '@dontstarve-web/stategraphs/actionEvents';
import * as THREE from 'three';
import { BuildCursor, declarePlacer, entityPlacer } from './buildCursor';
import { createArchiveEntity, type PrefabInstance, type PrefabEntityManager } from './prefabInstance';
import type { WorldContext } from './worldContext';

/** The shared archive a placer draws: its bank, build and animation archives. */
export type PlacerArchive = Parameters<SpriteResources['archive']>[0];
/** prefabutil.lua MakePlacer(name, bank, build, anim): what a build's placer draws. */
export interface PlacerArt {
  readonly archive: PlacerArchive;
  initialize?(entity: PrefabInstance): void;
}

export interface BuildingPlacerSpec {
  readonly buildLabel: string;
  /** The display's name for the placer's sprites. */
  readonly name: string;
  readonly animation: string;
  /**
   * The art it draws and the appearance its entity declares before the first draw: a shared `archive`, drawn by the
   * instanced batches.
   */
  art(resources: SpriteResources, skinId?: string): PlacerArt;
  /** Stands the placer's lowest point on the ground, as this project draws its buildings (the default). */
  readonly alignBottom?: boolean;
  /** The deploy mode's snap of the pointer point, such as DEPLOYMODE.WALL's wall grid. */
  snap?(point: THREE.Vector3): THREE.Vector3;
  /** placer.lua onupdatetransform: runs each frame once the placer has followed the pointer. */
  onupdatetransform?(placer: PrefabInstance): void;
}

/** This project draws placers translucent; MakePlacer itself only sets SetLightOverride(1). */
const PLACER_OPACITY = 0.65;
/**
 * A placer's archive art: private translucent materials, with every clip drawn by its resources' shared batches, since
 * MakePlacer loops its one clip and a placer changes only its bank (SetBank), skin and tint.
 */
export const PLACER_ARCHIVE_OPTIONS = {
  opacity: PLACER_OPACITY,
  colour: [1, 1, 1],
  instancedAnimations: 'all',
} as const;

/**
 * The build flow, apart from the buildings it makes: a separate `<name>_placer` entity that only declares its clip, light
 * override, opacity and whether it is shown; its display draws it. Committing a build consumes the buffered build and
 * hands the position to `place`, which spawns the building itself, never this entity.
 */
export class BuildingPlacer<BuildId extends string> {
  private disposed = false;
  private readonly specs: (buildId: BuildId) => BuildingPlacerSpec;
  private readonly consumeBufferedBuild: (buildId: BuildId, skinId?: string) => boolean;
  private readonly place: (
    buildId: BuildId,
    position: THREE.Vector3,
    skinId: string | undefined,
    placer: PrefabInstance,
  ) => void;
  private readonly actionEvents: WorldContext['actionEvents'];
  private readonly stopActionEvents: () => void;
  private readonly stopPlacerGate?: () => void;
  private readonly ownsPointer: boolean;
  private readonly canvas: HTMLCanvasElement;
  private readonly theCamera: TheCamera;
  private readonly ground: THREE.Object3D;
  private readonly player: THREE.Object3D;
  private readonly pointer: PointerRaycaster;
  private readonly cursor: BuildCursor;
  private readonly displays: PrefabDisplayGroup;
  /** Placers are made translucent through their materials, so they draw from resources apart from the buildings'. */
  private readonly sprites = new SpriteResources();
  private readonly ents?: Pick<PrefabEntityManager<string, PrefabInstance>, 'track'>;
  private placer?: {
    buildId: BuildId;
    skinId?: string;
    instance: PrefabInstance;
    display: PrefabDisplay;
    spec: BuildingPlacerSpec;
  };

  constructor(
    world: WorldContext,
    specs: (buildId: BuildId) => BuildingPlacerSpec,
    consumeBufferedBuild: (buildId: BuildId, skinId?: string) => boolean,
    place: (buildId: BuildId, position: THREE.Vector3, skinId: string | undefined, placer: PrefabInstance) => void,
    /** The world's Ents: a placer is an entity there, so its placerupdate can query TheSim. */
    ents?: Pick<PrefabEntityManager<string, PrefabInstance>, 'track'>,
  ) {
    this.ents = ents;
    this.specs = specs;
    this.consumeBufferedBuild = consumeBufferedBuild;
    this.place = place;
    this.actionEvents = world.actionEvents;
    this.stopActionEvents = bindActionCancellation(
      world,
      this,
      () => this.cancel(),
      reason => reason === 'emote',
    );
    this.canvas = world.renderer.domElement;
    this.theCamera = world.TheCamera;
    this.ground = world.ground;
    this.player = world.player;
    this.displays = new PrefabDisplayGroup(world.scene);
    this.ownsPointer = !world.mouseActions?.pointer;
    this.pointer = world.mouseActions?.pointer ?? new PointerRaycaster(world);
    this.cursor = new BuildCursor(world, this.pointer);
    // Action controllers see no mouse action while the placer is shown, so the click reaches the placer.
    this.stopPlacerGate = world.mouseActions?.registerPlacer(() => this.placer !== undefined);
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
  }

  /** Shows the placer at once; its display draws the preview when its art has loaded. */
  begin(buildId: BuildId, skinId?: string): void {
    if (this.disposed) {
      throw new Error('Placement has been disposed');
    }
    if (this.placer) {
      return;
    }
    const spec = this.specs(buildId),
      art = spec.art(this.sprites, skinId);
    // MakePlacer: PlayAnimation(anim, true) with the shared placer declarations.
    const prefab = `${buildId}_placer`,
      clip = { name: spec.animation, billboard: true };
    const declare = (entity: PrefabInstance) => {
      declarePlacer(entity);
      entity.sprite.setOpacity(PLACER_OPACITY);
    };
    const options = { alignBottom: spec.alignBottom ?? true };
    const { instance, display } = createArchiveEntity(
      prefab,
      this.sprites.archive(art.archive, PLACER_ARCHIVE_OPTIONS),
      clip,
      `${spec.name}Placer`,
      entity => {
        art.initialize?.(entity);
        declare(entity);
      },
      undefined,
      options,
    );
    this.ents?.track(instance);
    this.displays.mount(display);
    this.actionEvents?.emit('action:begin', { owner: this, action: 'BUILD' });
    this.cursor.show(`: 建造 ${spec.buildLabel}`, 'left');
    this.placer = { buildId, skinId, instance, display, spec };
    this.cursor.setPreview(
      entityPlacer(instance),
      0,
      spec.snap &&
        (point => {
          const snapped = spec.snap!(point);
          return point.set(snapped.x, point.y, snapped.z);
        }),
    );
    this.followPointer();
  }

  /** Cancel only the placer; its display stops any load it started. The buffered build stays in inventory. */
  cancel(): void {
    if (this.placer) {
      this.placer.instance.remove();
      this.placer.display.dispose();
    }
    this.placer = undefined;
    this.cursor.hide();
  }

  /** The display advances the placer's clip, and the placer follows the pointer. */
  update(dt: number): void {
    this.displays.update(dt);
    this.followPointer();
  }

  private followPointer(): void {
    this.cursor.update();
    if (this.placer) {
      this.placer.spec.onupdatetransform?.(this.placer.instance);
    }
  }

  /** The placer's sprite and its ground-contact point for depth sorting. */
  get renderEntities() {
    const model = this.placer?.display.model;
    return model?.visible ? [{ object: model, footPosition: model.position, cameraDepth: 0, sortLayer: 1 }] : [];
  }

  /** Where a debug spawn puts a building: on the ground ahead of the player, up the screen (-GetDownVec). */
  groundInFrontOfPlayer(): THREE.Vector3 {
    const direction = this.theCamera.GetDownVec().negate();
    const target = this.player.position.clone().addScaledVector(direction, 10);
    const rayOrigin = new THREE.Vector3(target.x, target.y + 1000, target.z);
    const hit = this.pointer.raycast(rayOrigin, new THREE.Vector3(0, -1, 0), this.ground);
    if (hit) {
      return hit.point.clone();
    }
    target.y = 0;
    return target;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.stopActionEvents();
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
    this.stopPlacerGate?.();
    if (this.ownsPointer) {
      this.pointer.dispose();
    }
    this.cancel();
    this.displays.dispose();
    this.sprites.dispose();
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.button === 2) {
      this.cancel();
      return;
    }
    if (event.button !== 0 || event.defaultPrevented || !this.placer) {
      return;
    }
    event.preventDefault();
    this.commit(event);
  };

  /** Commits the build at the placer's position: the building is spawned afresh and the placer released. */
  private commit(event: PointerEvent): void {
    const placer = this.placer;
    if (!placer) {
      return;
    }
    this.pointer.trackPointer(event);
    this.followPointer();
    if (!this.pointer.isOverGround || !this.consumeBufferedBuild(placer.buildId, placer.skinId)) {
      return;
    }
    const position = placer.instance.position.clone();
    this.cancel();
    this.place(placer.buildId, position, placer.skinId, placer.instance);
  }
}
