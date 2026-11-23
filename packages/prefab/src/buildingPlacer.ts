import type { ReadonlyVector3 } from './transform';
import type { TheCamera } from './followcamera';
import { PrefabDisplayGroup, SpriteResources, type PrefabDisplay } from '@dontstarve-web/display';
import { PointerRaycaster } from '@dontstarve-web/stategraphs/pointerRaycaster';
import type { MouseControlPointer, PlayerPlacement } from '@dontstarve-web/stategraphs';
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
 * override, opacity and whether it is shown. Its display draws it and the builder handles the build request.
 */
export class BuildingPlacer<BuildId extends string> implements PlayerPlacement {
  private disposed = false;
  private readonly specs: (buildId: BuildId) => BuildingPlacerSpec;
  private readonly canBuildAtPoint: (recipe: BuildId, point: ReadonlyVector3, skin?: string) => boolean;
  private readonly actionEvents: WorldContext['actionEvents'];
  private readonly stopActionEvents: () => void;
  private readonly ownsPointer: boolean;
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
    tintedAsValid?: boolean;
  };

  constructor(
    world: WorldContext,
    specs: (buildId: BuildId) => BuildingPlacerSpec,
    canBuildAtPoint: (recipe: BuildId, point: ReadonlyVector3, skin?: string) => boolean,
    /** The world's Ents: a placer is an entity there, so its placerupdate can query TheSim. */
    ents?: Pick<PrefabEntityManager<string, PrefabInstance>, 'track'>,
  ) {
    this.ents = ents;
    this.specs = specs;
    this.canBuildAtPoint = canBuildAtPoint;
    this.actionEvents = world.actionEvents;
    this.stopActionEvents = bindActionCancellation(
      world,
      this,
      () => this.cancel(),
      reason => reason === 'emote',
    );
    this.theCamera = world.TheCamera;
    this.ground = world.ground;
    this.player = world.player;
    this.displays = new PrefabDisplayGroup(world.scene);
    this.ownsPointer = !world.mouseActions?.pointer;
    this.pointer = world.mouseActions?.pointer ?? new PointerRaycaster(world);
    this.cursor = new BuildCursor(world, this.pointer);
  }

  get active(): boolean {
    return this.placer !== undefined;
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
    // Drawn from the art's pivot, as the building it places is.
    const { instance, display } = createArchiveEntity(
      prefab,
      this.sprites.archive(art.archive, PLACER_ARCHIVE_OPTIONS),
      clip,
      `${spec.name}Placer`,
      entity => {
        art.initialize?.(entity);
        declare(entity);
      },
    );
    this.ents?.track(instance);
    this.displays.mount(display);
    this.actionEvents?.emit('action:begin', { owner: this, action: 'BUILD' });
    this.cursor.show(`: 建造 ${spec.buildLabel}`, 'left');
    this.placer = { buildId, skinId, instance, display };
    this.cursor.setPreview(entityPlacer(instance));
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

  private followPointer(): boolean {
    this.cursor.update();
    const placer = this.placer;
    if (!placer || !this.cursor.previewVisible) {
      return false;
    }
    const canBuild = this.canBuildAtPoint(placer.buildId, placer.instance.position, placer.skinId);
    if (canBuild !== placer.tintedAsValid) {
      placer.tintedAsValid = canBuild;
      placer.instance.sprite.setColour(canBuild ? [1, 1, 1] : [0.75, 0.25, 0.25]);
    }
    return canBuild;
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
    if (this.ownsPointer) {
      this.pointer.dispose();
    }
    this.cancel();
    this.displays.dispose();
    this.sprites.dispose();
  }

  getPlacement(pointer: MouseControlPointer): ReturnType<PlayerPlacement['getPlacement']> {
    const placer = this.placer;
    if (!placer) {
      return undefined;
    }
    this.pointer.trackPointer(pointer);
    const canBuild = this.followPointer();
    if (!this.cursor.previewVisible) {
      return undefined;
    }
    return {
      recipe: placer.buildId,
      point: placer.instance.position.clone(),
      rotation: placer.instance.rotation,
      skin: placer.skinId,
      canBuild,
    };
  }
}
