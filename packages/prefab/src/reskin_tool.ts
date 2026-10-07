import * as THREE from 'three';
import { findImage, smallHash, SpriteFrameRenderer, type AnimElement, type Animation, type ResolvedSprite } from '@dontstarve-web/animation/animationAssets';
import { registerSpriteRenderGroup } from '@dontstarve-web/animation/renderOrder';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from './groundItems';
import { setPrefabLightOverride } from './localLight';
import { PlaySound, PreloadSounds, type SoundEventPath } from './sound';
import { TILE_SIZE } from './tile';
import type { ReskinTarget } from '@dontstarve-web/stategraphs/reskin_tool';

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
  wormhole: { scale: 1.3 },
  wall_moonrock: { offset: 0.2, scale: 1.2 },
  wall_ruins: { offset: 0.2, scale: 1.3 }, wall_stone: { offset: 0.2, scale: 1.3 },
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
    PlaySound(reskinEffectSound(toolSkinId), effect.footPosition);
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
