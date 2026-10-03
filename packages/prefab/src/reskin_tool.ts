import * as THREE from 'three';
import { findImage, smallHash, SpriteFrameRenderer, type AnimElement, type Animation, type ResolvedSprite } from '@three-roaming/animation/animationAssets';
import { registerSpriteRenderGroup } from '@three-roaming/animation/renderOrder';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from './groundItems';
import { setPrefabLightOverride } from './localLight';
import { PlaySound, PreloadSounds, type SoundEventPath } from './sound';
import { PointerRaycaster } from './pointerRaycaster';
import { TILE_SIZE } from './tile';
import type { WorldContext } from './worldContext';
import type { WilsonAnimationController } from './player';
import type { Locomotor } from './locomotor';
import type { CursorLabel } from './buildCursor';

// SGwilson veryquickcastspell commits nine frames after atk_pre begins.
export const RESKIN_CAST_TIME = 9 / 30;
export const RESKIN_REACH = 20 * (TILE_SIZE / 4);

export interface PreparedReskin {
  /** Commit the prepared appearance only if its source entity is still valid. */
  apply(): boolean;
  dispose(): void;
}

export interface ReskinTarget {
  readonly id: string;
  readonly prefabId: string;
  readonly model: THREE.Group;
  readonly position: THREE.Vector3;
  isValid(): boolean;
  prepareNextSkin(): Promise<PreparedReskin>;
}

export function nextReskin(skins: readonly string[], current?: string): string | undefined {
  return skins[(current === undefined ? -1 : skins.indexOf(current)) + 1];
}

// reskin_tool.lua's GetReskinFXInfo. Offsets use DST units, converted below.
const fxInfo: Readonly<Record<string, { offset?: number; scale: number }>> = {
  cookpot: { offset: 0.5, scale: 1.4 }, firepit: { scale: 1.2 }, campfire: { scale: 1.2 },
  icebox: { offset: 0.3, scale: 1.3 }, treasurechest: { offset: 0.1, scale: 1.1 },
  tent: { offset: 0.4, scale: 2 }, dragonflychest: { offset: 0.1, scale: 1.4 },
  saltbox: { offset: 0.3, scale: 1.3 }, pighouse: { offset: 1.5, scale: 2.2 },
  mushroom_light: { offset: 1.2, scale: 1.8 }, mushroom_light2: { offset: 1.2, scale: 1.8 },
  researchlab: { offset: 0.5, scale: 1.4 }, researchlab2: { offset: 0.5, scale: 1.4 },
  researchlab3: { offset: 0.5, scale: 1.4 }, researchlab4: { offset: 0.5, scale: 1.3 },
  yellowstaff: { offset: 0.4, scale: 1 }, opalstaff: { offset: 0.4, scale: 1 },
  shovel: { offset: 0.2, scale: 1 }, featherhat: { offset: 0.1, scale: 1.1 },
};

export function reskinEffectSound(toolSkinId?: string): SoundEventPath {
  return toolSkinId === 'reskin_tool_brush' ? 'terraria1/skins/spectrepaintbrush'
    : 'dontstarve/common/together/reskin_tool';
}

interface EffectAssets { animation: Animation; builds: readonly ReskinToolBuild[] }
interface EffectInstance {
  model: THREE.Group;
  footPosition: THREE.Vector3;
  renderer: SpriteFrameRenderer;
  assets: EffectAssets;
  elapsed: number;
  frame: number;
}

/** explode_small.lua: fx_shadow_dust/puff with base or skin shadow_dust art. */
export class ReskinEffects {
  private readonly scene: THREE.Scene;
  private readonly assets: GroundItemAssets;
  private readonly prepared = new Map<string, Promise<EffectAssets>>();
  private readonly ready = new Map<string, EffectAssets>();
  private readonly active = new Set<EffectInstance>();
  private disposed = false;

  constructor(scene: THREE.Scene, animationBaseUrl: string) {
    this.scene = scene;
    this.assets = new GroundItemAssets(animationBaseUrl);
  }

  async prepare(toolSkinId?: string): Promise<void> {
    if (this.disposed) throw new Error('Reskin effects have been disposed');
    const key = toolSkinId ?? '';
    let request = this.prepared.get(key);
    if (!request) {
      request = (async () => {
        const skinArchive = toolSkinId ? GROUND_ITEM_DEFINITIONS.reskin_tool.skinArchives[toolSkinId] : undefined;
        if (toolSkinId && !skinArchive) throw new Error(`Unknown reskin tool skin: ${toolSkinId}`);
        const [parsed, base, skin] = await Promise.all([
          this.assets.loadAnimation('reskin_tool_fx.zip'), this.assets.loadBuild('reskin_tool_fx.zip'),
          skinArchive ? this.assets.loadBuild(skinArchive) : undefined,
          PreloadSounds('dontstarve/wilson/attack_weapon', reskinEffectSound(toolSkinId)),
        ]);
        const animation = parsed.animations.find((clip) => clip.name === 'puff' && clip.bankHash === smallHash('fx_shadow_dust'));
        if (!animation?.frames.length) throw new Error('Missing reskin puff animation');
        return { animation, builds: skin ? [skin, base] : [base] };
      })();
      this.prepared.set(key, request);
      void request.catch(() => this.prepared.delete(key));
    }
    const resources = await request;
    if (!this.disposed) this.ready.set(key, resources);
  }

  spawn(target: Pick<ReskinTarget, 'position' | 'prefabId'>, toolSkinId?: string): void {
    const assets = this.ready.get(toolSkinId ?? '');
    if (!assets || this.disposed) return;
    const model = new THREE.Group();
    model.name = toolSkinId ? `${toolSkinId}_explode_fx` : 'explode_reskin';
    model.userData.billboard = true;
    const info = fxInfo[target.prefabId];
    model.position.copy(target.position).add(new THREE.Vector3(0, (info?.offset ?? 0) * (TILE_SIZE / 4), 0));
    const visual = new THREE.Group();
    const scale = 0.02 * (info?.scale ?? 1);
    visual.scale.set(scale, -scale, scale);
    model.add(visual);
    registerSpriteRenderGroup(model, visual);
    setPrefabLightOverride(model, toolSkinId ? 0 : 1);
    const effect: EffectInstance = {
      model, footPosition: target.position.clone(), renderer: new SpriteFrameRenderer(visual), assets, elapsed: 0, frame: -1,
    };
    this.showFrame(effect, 0);
    this.active.add(effect);
    this.scene.add(model);
    PlaySound(reskinEffectSound(toolSkinId));
  }

  get renderEntities() {
    return [...this.active].map(({ model, footPosition }) => ({ object: model, footPosition, cameraDepth: 0 }));
  }

  update(dt: number, cameraQuaternion: THREE.Quaternion): void {
    for (const effect of this.active) {
      effect.elapsed += Math.min(dt, 0.1);
      const frame = Math.floor(effect.elapsed * effect.assets.animation.frameRate + 1e-8);
      if (frame >= effect.assets.animation.frames.length) {
        this.remove(effect);
        continue;
      }
      effect.model.quaternion.copy(cameraQuaternion);
      this.showFrame(effect, frame);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const effect of this.active) this.remove(effect);
    // Cached builds are owned by this manager, independent of equipment/ground assets.
    const released = new Set<THREE.Material>();
    for (const request of this.prepared.values()) void request.then(({ builds }) => {
      for (const { materials } of builds) for (const material of materials) {
        if (released.has(material)) continue;
        released.add(material);
        material.map?.dispose(); material.dispose();
      }
    }, () => {});
    this.prepared.clear(); this.ready.clear();
  }

  private remove(effect: EffectInstance): void {
    effect.model.removeFromParent();
    effect.model.traverse((object) => { if (object instanceof THREE.Mesh) object.geometry.dispose(); });
    this.active.delete(effect);
  }

  private showFrame(effect: EffectInstance, index: number): void {
    if (effect.frame === index) return;
    const sprites: ResolvedSprite[] = [];
    for (const element of [...effect.assets.animation.frames[index].elements].sort((a, b) => b.z - a.z)) {
      for (const source of effect.assets.builds) {
        const image = findImage(source.build, element.imageHash, element.imageIndex);
        if (image) { sprites.push({ element, image, materials: source.materials }); break; }
      }
    }
    effect.renderer.show(sprites);
    effect.frame = index;
  }
}

/** Right-click CASTSPELL: prepare first, approach, face, then commit at frame nine. */
export class ReskinActionController {
  private readonly world: WorldContext;
  private readonly animation: WilsonAnimationController;
  private readonly locomotor: Pick<Locomotor, 'stop' | 'goToPoint' | 'destination'>;
  private readonly getTool: () => { skinId?: string } | undefined;
  private readonly getTargets: () => readonly ReskinTarget[];
  private readonly effects: ReskinEffects;
  private readonly isManualMovement: () => boolean;
  private readonly onRequest: () => void;
  private readonly onError: (error: unknown) => void;
  private readonly pointer: PointerRaycaster;
  private readonly label: CursorLabel;
  private version = 0;
  private pending?: { target: ReskinTarget; prepared: PreparedReskin; skinId?: string; started: boolean };
  private loading = false;
  private hovering = false;

  constructor(
    world: WorldContext,
    animation: WilsonAnimationController,
    locomotor: Pick<Locomotor, 'stop' | 'goToPoint' | 'destination'>,
    getTool: () => { skinId?: string } | undefined,
    getTargets: () => readonly ReskinTarget[],
    effects: ReskinEffects,
    isManualMovement = () => false,
    onRequest = () => {},
    onError: (error: unknown) => void = console.error,
  ) {
    this.world = world; this.animation = animation; this.locomotor = locomotor;
    this.getTool = getTool; this.getTargets = getTargets; this.effects = effects;
    this.isManualMovement = isManualMovement; this.onRequest = onRequest; this.onError = onError;
    this.pointer = new PointerRaycaster(world);
    this.label = world.createCursorLabel?.(this.pointer) ?? { show() {}, hide() {}, update() {} };
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  async request(target: ReskinTarget): Promise<boolean> {
    const tool = this.getTool();
    if (!tool || !target.isValid() || this.loading || this.animation.isReskinning) return false;
    this.cancel();
    const version = this.version;
    this.onRequest();
    this.animation.cancelEmote();
    this.loading = true;
    let prepared: PreparedReskin | undefined;
    try {
      // allSettled also releases a prepared target when effect preparation fails.
      const results = await Promise.allSettled([target.prepareNextSkin(), this.effects.prepare(tool.skinId)]);
      if (results[0].status === 'fulfilled') prepared = results[0].value;
      for (const result of results) if (result.status === 'rejected') throw result.reason;
      if (version !== this.version || !this.getTool() || this.getTool()!.skinId !== tool.skinId || !target.isValid()) return false;
      this.pending = { target, prepared: prepared!, skinId: tool.skinId, started: false };
      prepared = undefined;
      return true;
    } catch (error) { if (version === this.version) this.onError(error); return false; }
    finally { prepared?.dispose(); if (version === this.version) this.loading = false; }
  }

  cancel(): void {
    this.version++;
    if (this.pending) this.locomotor.stop();
    this.pending?.prepared.dispose();
    this.pending = undefined;
    this.loading = false;
    this.animation.cancelReskin();
  }

  update(_dt: number): void {
    const hovering = !!this.hitTarget();
    if (hovering !== this.hovering) {
      this.hovering = hovering;
      if (hovering) this.label.show(': 换肤', 'right'); else this.label.hide();
    }
    this.label.update();
    if (!this.getTool() || this.isManualMovement()) { this.cancel(); return; }
    const pending = this.pending;
    if (!pending) return;
    if (!pending.target.isValid() || this.getTool()!.skinId !== pending.skinId) { this.cancel(); return; }
    if (pending.started) {
      if (!this.animation.isReskinning) this.cancel();
      return;
    }
    const { target } = pending;
    if (this.distanceSquared(target.position) > RESKIN_REACH ** 2) {
      const direction = this.world.player.position.clone().sub(target.position).setY(0).normalize();
      const destination = target.position.clone().addScaledVector(direction, RESKIN_REACH * 0.8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > 0.01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    this.faceTarget(target.position);
    const version = this.version;
    pending.started = this.animation.playReskin(() => {
      if (version !== this.version || !target.isValid() || !this.getTool()
        || this.getTool()!.skinId !== pending.skinId || this.distanceSquared(target.position) > RESKIN_REACH ** 2) {
        this.cancel(); return;
      }
      if (pending.prepared.apply()) this.effects.spawn(target, pending.skinId);
      pending.prepared.dispose();
      this.pending = undefined;
    });
    if (!pending.started) this.cancel();
  }

  dispose(): void {
    this.cancel(); this.label.hide(); this.pointer.dispose();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
  }

  private distanceSquared(point: THREE.Vector3): number {
    return (this.world.player.position.x - point.x) ** 2 + (this.world.player.position.z - point.z) ** 2;
  }

  private faceTarget(point: THREE.Vector3): void {
    const direction = point.clone().sub(this.world.player.position).setY(0);
    const forward = this.world.camera.getWorldDirection(new THREE.Vector3()).setY(0).normalize();
    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0));
    const f = direction.dot(forward), r = direction.dot(right);
    this.animation.setFacing(Math.abs(f) >= Math.abs(r) ? (f > 0 ? 'up' : 'down') : 'side',
      Math.abs(r) > Math.abs(f) && r < 0);
  }

  private hitTarget(): ReskinTarget | undefined {
    if (!this.getTool()) return undefined;
    const targets = this.getTargets().filter((target) => target.isValid());
    const hit = this.pointer.raycastPointer(targets.map((target) => target.model));
    return hit && targets.find((target) => {
      let root: THREE.Object3D | null = hit.object;
      while (root) { if (root === target.model) return true; root = root.parent; }
      return false;
    });
  }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (event.defaultPrevented) return;
    if (event.button === 0) { this.cancel(); return; }
    if (event.button !== 2 || !this.getTool()) return;
    this.pointer.trackPointer(event);
    const target = this.hitTarget();
    if (!target) { this.cancel(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    void this.request(target);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') this.cancel();
  };
}

type ReskinToolBuild = Awaited<ReturnType<GroundItemAssets['loadBuild']>>;
export interface ReskinToolEquipment { readonly builds: readonly ReskinToolBuild[] }

export async function loadReskinToolEquipment(assets: GroundItemAssets, skinId?: string): Promise<ReskinToolEquipment> {
  const skinArchive = skinId ? GROUND_ITEM_DEFINITIONS.reskin_tool.skinArchives[skinId] : undefined;
  if (skinId && !skinArchive) throw new Error(`Unknown reskin_tool skin: ${skinId}`);
  const [base, skin] = await Promise.all([
    assets.loadBuild('swap_reskin_tool.zip'),
    skinArchive ? assets.loadBuild(skinArchive) : undefined,
  ]);
  return { builds: skin ? [skin, base] : [base] };
}

/** reskin_tool.lua overrides the player's swap_object with swap_reskin_tool. */
export function resolveReskinToolPlayerSprite(equipment: ReskinToolEquipment, element: AnimElement): ResolvedSprite[] {
  const symbol = smallHash('swap_reskin_tool');
  for (const source of equipment.builds) {
    const image = findImage(source.build, symbol, element.imageIndex);
    if (image) return [{ element, image, materials: source.materials }];
    if (source.build.symbols.has(symbol)) return [];
  }
  return [];
}
