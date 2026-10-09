import type { ActionAnimationController } from '@dontstarve-web/stategraphs/actionContext';
import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import { BufferedAction, WilsonStateGraph, type BufferedActionObject, type WilsonAction, type WilsonAnimationClip, type WilsonAnimationKey, type WilsonMovementState, type WilsonOneShotState } from '@dontstarve-web/stategraphs';
import {
  createMaterials,
  findImage,
  loadAnim,
  loadAnimationArchive,
  loadBuild,
  smallHash,
  SpriteFrameRenderer,
  type Animation,
  type ParsedAnim,
  type ParsedBuild,
  type ResolvedSprite,
} from '@dontstarve-web/animation/animationAssets';
import { registerSpriteRenderGroup } from '@dontstarve-web/animation/renderOrder';
import {
  HatActivationController, HatEquipmentAssets, isHatPlayerElementVisible, resolveHatSprites, type HatEquipment,
} from './hats';
import { GroundItemAssets, GROUND_ITEM_DEFINITIONS } from './groundItems';
import { LanternLightController, loadLanternEquipment, resolveLanternPlayerSprite, type LanternEquipment } from './lantern';
import { isLightStaff, loadLightStaffEquipment, resolveYellowStaffPlayerSprite, StaffCastingLight, type YellowStaffEquipment } from './yellowstaff';
import { loadBugNetEquipment, resolveBugNetPlayerSprite, type BugNetEquipment } from './bugnet';
import { WILSON_EMOTES, type WilsonEmote, type WilsonEmoteDefinition } from './emotes';
import { loadHammerEquipment, resolveHammerPlayerSprite, type HammerEquipment } from './hammer';
import { isPickaxeTool, loadPickaxeEquipment, resolvePickaxePlayerSprite, type PickaxeEquipment, type PickaxeTool } from './pickaxe';
import { isPitchforkTool, loadPitchforkEquipment, resolvePitchforkPlayerSprite, type PitchforkEquipment, type PitchforkTool } from './pitchfork';
import { isFarmHoeTool, loadFarmHoeEquipment, resolveFarmHoePlayerSprite, type FarmHoeEquipment, type FarmHoeTool } from './farm_hoe';
import { isShovelTool, loadShovelEquipment, resolveShovelPlayerSprite, type ShovelEquipment, type ShovelTool } from './shovel';
import { PlaySound, PreloadSounds } from './sound';
import { loadReskinToolEquipment } from './reskin_tool';
import { resolveReskinToolPlayerSprite, type ReskinToolEquipment } from './reskin_tool';

export type WilsonFacing = 'up' | 'down' | 'side';
export type WilsonCarryItem = 'torch' | 'lantern' | 'yellowstaff' | 'opalstaff' | 'bugnet' | 'hammer' | 'reskin_tool' | PickaxeTool | PitchforkTool | FarmHoeTool | ShovelTool;
type WilsonAnimations = Record<Exclude<WilsonAnimationKey, 'emote'>, ParsedAnim>;

export interface WilsonAnimationController extends ActionAnimationController {
  readonly currentEmote: WilsonEmote | null;
  readonly isEmoting: boolean;
  playEmote(emote: WilsonEmote): Promise<boolean>;
  start(state: WilsonMovementState): void;
  playEat(): void;
  playItemTransition(state: 'item_in' | 'item_out', item?: WilsonCarryItem): void;
  playPickup(): void;
  setCrafting(crafting: boolean): void;
  setCarryItem(item: WilsonCarryItem | null, skinId?: string): Promise<void>;
  setLanternFuelPercent(percent: number): void;
  setHat(itemId: string | null, skinId?: string): Promise<void>;
  setBackpack(equipped: boolean, skinId?: string): Promise<void>;
  /** Normalized sanity; defaults to full until the application supplies state. */
  setSanityPercent(percent: number): void;
  update(dt: number, jumpProgress?: number): void;
}

export type PlayerBody = CANNON.Body & { canJump: boolean };

export interface WilsonPlayerPrefab {
  body: PlayerBody;
  model: THREE.Group;
  setNormal(cameraWorldQuaternion: THREE.Quaternion): void;
}

export interface WilsonPlayerPrefabOptions {
  mass?: number;
  shapeRadius?: number;
}

/** Source tags: bugnet tool component and reskin_tool.lua's veryquickcast. */
const ACTION_TOOL_METADATA: Partial<Record<WilsonCarryItem, { tags: readonly string[]; spelltype?: string }>> = {
  bugnet: { tags: ['NET_tool'] },
  reskin_tool: { tags: ['veryquickcast'], spelltype: 'RESKIN' },
};

const facingValues: Record<WilsonFacing, number> = { down: 8, side: 5, up: 2 };
const normalArmLayerHash = smallHash('ARM_normal');
const carryArmLayerHash = smallHash('ARM_carry');
const swapObjectHash = smallHash('swap_object');
const swapTorchHash = smallHash('swap_torch');
const lanternOverlayHash = smallHash('lantern_overlay');

interface CarryBuild {
  build: ParsedBuild;
  materials: THREE.MeshBasicMaterial[];
}

interface EmoteAssets {
  animations: ParsedAnim;
  props?: CarryBuild;
}

interface ActiveEmote extends EmoteAssets {
  id: WilsonEmote;
  clips: readonly string[];
  loop: boolean;
}

class WilsonController implements WilsonAnimationController {
  private readonly renderer: SpriteFrameRenderer;
  private readonly materials: THREE.MeshBasicMaterial[];
  readonly stategraph: WilsonStateGraph;
  private state: WilsonAnimationKey = 'idle';
  private clipName = 'idle_loop';
  private facing: WilsonFacing = 'down';
  private mirrored = false;
  private equippedCarryItem: WilsonCarryItem | null = null;
  private carryItem: WilsonCarryItem | null = null;
  private carryKey = '';
  private carryRequest = 0;
  private readonly lanternAssets: GroundItemAssets;
  private readonly lanternLight: LanternLightController;
  private lanternEquipment: LanternEquipment | null = null;
  private staffEquipment: YellowStaffEquipment | null = null;
  private netEquipment: BugNetEquipment | null = null;
  private hammerEquipment: HammerEquipment | null = null;
  private pickaxeEquipment: PickaxeEquipment | null = null;
  private pitchforkEquipment: PitchforkEquipment | null = null;
  private farmHoeEquipment: FarmHoeEquipment | null = null;
  private shovelEquipment: ShovelEquipment | null = null;
  private reskinToolEquipment: ReskinToolEquipment | null = null;
  private readonly castingLight: StaffCastingLight;
  private animation!: Animation;
  private frameIndex = -1;
  private readonly visual: THREE.Group;
  private readonly build: ParsedBuild;
  private readonly animations: WilsonAnimations;
  private readonly torch: CarryBuild;
  private readonly hatAssets: HatEquipmentAssets;
  private readonly hatActivation: HatActivationController;
  private hat: HatEquipment | null = null;
  private hatRequest = 0;
  private hatKey = '';
  private hatElapsed = 0;
  private backpack: readonly CarryBuild[] | null = null;
  private backpackKey = '';
  private backpackRequest = 0;
  private readonly emoteAssets = new Map<string, Promise<EmoteAssets>>();
  private emote: ActiveEmote | null = null;
  private emoteRequest = 0;
  private emotePending = false;
  private readonly assetBaseUrl: string;

  constructor(
    visual: THREE.Group,
    build: ParsedBuild,
    animations: WilsonAnimations,
    materials: THREE.MeshBasicMaterial[],
    torch: CarryBuild,
    assetBaseUrl: string,
  ) {
    this.visual = visual;
    this.build = build;
    this.animations = animations;
    this.materials = materials;
    this.torch = torch;
    this.assetBaseUrl = assetBaseUrl;
    this.lanternAssets = new GroundItemAssets(assetBaseUrl);
    this.lanternLight = new LanternLightController(visual.parent!);
    this.castingLight = new StaffCastingLight(visual.parent!);
    this.hatAssets = new HatEquipmentAssets(assetBaseUrl);
    this.hatActivation = new HatActivationController(visual.parent!);
    this.renderer = new SpriteFrameRenderer(visual);
    this.stategraph = new WilsonStateGraph({
      playAnimation: (clip) => this.selectAnimation(clip),
      playSound: (cue, castsound) => {
        const event = cue === 'dig' ? 'dontstarve/wilson/dig' : cue === 'tillEmerge' ? 'dontstarve_DLC001/creatures/mole/emerge'
          : cue === 'sip' ? 'dontstarve/wilson/sip' : cue === 'eat' ? 'dontstarve/wilson/eat' : cue === 'reskin' ? 'dontstarve/wilson/attack_weapon'
          : cue === 'cast' ? (castsound as import('./sound').SoundEventPath ?? 'dontstarve/wilson/use_gemstaff')
            : cue === 'hammer' ? 'dontstarve/wilson/hit' : 'dontstarve/wilson/use_pick_rock';
        PlaySound(event);
      },
      setCasting: (casting, colour) => {
        if (casting) this.castingLight.start(colour);
        else this.castingLight.stop();
      },
      setControllerEnabled: enabled => { visual.parent!.userData.controllerEnabled = enabled; },
      stopMovement: () => visual.parent!.userData.locomotor?.stop(),
      onStateChanged: (name) => {
        this.carryItem = this.equippedCarryItem;
        if (name !== 'emote') this.emote = null;
      },
    });
  }

  start(state: WilsonMovementState) {
    if (state !== 'idle' && this.isEmoting) this.cancelEmote();
    this.stategraph.requestMovement(state);
  }

  playEat() {
    this.startOneShot('eat');
  }

  playQuickEat(onEat: () => boolean, foodDrink = false): boolean {
    return this.startAction('EAT', onEat, true, foodDrink);
  }
  playPlant(onPlant: () => boolean): boolean { return this.startAction('PLANT', onPlant, true); }
  cancelFoodAction(): void {
    if (this.stategraph.isPerformingAction('EAT') || this.stategraph.isPerformingAction('PLANT')) this.stategraph.cancelAction();
  }

  get currentEmote(): WilsonEmote | null { return this.emote?.id ?? null; }
  get isEmoting(): boolean { return this.emotePending || this.emote !== null; }

  async playEmote(id: WilsonEmote): Promise<boolean> {
    const definition: WilsonEmoteDefinition | undefined = WILSON_EMOTES[id];
    if (!definition || !this.stategraph.canEmote()) return false;
    this.cancelEmote();
    const request = ++this.emoteRequest;
    this.emotePending = true;
    try {
      let assets = this.emoteAssets.get(definition.archive);
      if (!assets) {
        assets = definition.props
          ? loadAnimationArchive(definition.archive, this.assetBaseUrl).then(({ animations, buildPackage }) => ({
            animations, props: { build: buildPackage.build, materials: createMaterials(buildPackage) },
          }))
          : loadAnim(definition.archive, this.assetBaseUrl).then((animations) => ({ animations }));
        this.emoteAssets.set(definition.archive, assets);
        void assets.catch(() => this.emoteAssets.delete(definition.archive));
      }
      const loaded = await assets;
      if (request !== this.emoteRequest) return false;
      this.emotePending = false;
      this.emote = {
        ...loaded, id, clips: definition.variants[Math.floor(Math.random() * definition.variants.length)],
        loop: definition.loop === true,
      };
      if (!this.stategraph.requestEmote(this.emote.clips, this.emote.loop)) {
        this.emote = null;
        return false;
      }
      return true;
    } catch (error) {
      if (request !== this.emoteRequest) return false;
      this.cancelEmote();
      throw error;
    }
  }

  cancelEmote(): void {
    ++this.emoteRequest;
    this.emotePending = false;
    this.stategraph.cancelEmote();
    this.emote = null;
  }

  get isCasting(): boolean { return this.stategraph.isPerformingAction('CASTSPELL') && !this.isReskinning; }
  get isNetting(): boolean { return this.stategraph.isPerformingAction('NET'); }
  get isMining(): boolean { return this.stategraph.isPerformingAction('MINE'); }
  get isHammering(): boolean { return this.stategraph.isPerformingAction('HAMMER'); }
  get isDigging(): boolean { return this.stategraph.isPerformingAction('TERRAFORM'); }
  get isReskinning(): boolean { return this.stategraph.isPerformingAction('CASTSPELL', 'reskin_tool'); }

  private startAction(action: WilsonAction, execute: () => void | boolean, ready: boolean, foodDrink = false): boolean {
    if (!ready || this.stategraph.hasStateTag('busy')) return false;
    this.cancelEmote();
    const tool = this.carryItem;
    const metadata = tool ? ACTION_TOOL_METADATA[tool] : undefined;
    const invobject: BufferedActionObject | undefined = tool
      ? { prefab: tool, spelltype: metadata?.spelltype, hasTag: tag => metadata?.tags.includes(tag) ?? false } : undefined;
    return this.stategraph.pushBufferedAction(new BufferedAction(action, execute, undefined, { invobject }), foodDrink);
  }

  playReskin(onCast: () => void): boolean {
    return this.startAction('CASTSPELL', onCast, this.carryItem === 'reskin_tool' && !!this.reskinToolEquipment);
  }

  cancelReskin(): void { if (this.isReskinning) this.stategraph.cancelAction('CASTSPELL'); }

  playDig(onDig: () => void): boolean {
    return this.startAction('TERRAFORM', onDig, isPitchforkTool(this.carryItem ?? '') && !!this.pitchforkEquipment);
  }

  cancelDig(): void { this.stategraph.cancelAction('TERRAFORM'); }
  playShovelDig(onDig: () => boolean): boolean {
    return this.startAction('DIG', onDig, isShovelTool(this.carryItem ?? '') && !!this.shovelEquipment);
  }
  cancelShovelDig(): void { this.stategraph.cancelAction('DIG'); }
  get isShoveling(): boolean { return this.stategraph.isPerformingAction('DIG'); }
  get isTilling(): boolean { return this.stategraph.isPerformingAction('TILL'); }
  playTill(onTill: () => boolean): boolean {
    return this.startAction('TILL', onTill, isFarmHoeTool(this.carryItem ?? '') && !!this.farmHoeEquipment);
  }
  cancelTill(): void { this.stategraph.cancelAction('TILL'); }

  playMine(onHit: () => void): boolean {
    const hammer = this.carryItem === 'hammer';
    const ready = hammer ? !!this.hammerEquipment : isPickaxeTool(this.carryItem ?? '') && !!this.pickaxeEquipment;
    return this.startAction(hammer ? 'HAMMER' : 'MINE', onHit, ready);
  }

  playHammer(onHit: () => void): boolean { return this.playMine(onHit); }
  cancelMine(): void { this.stategraph.cancelAction('MINE'); }
  cancelHammer(): void { this.stategraph.cancelAction('HAMMER'); }

  playBugNet(onCatch: () => void): boolean {
    return this.startAction('NET', onCatch, this.carryItem === 'bugnet' && !!this.netEquipment);
  }

  playItemTransition(state: 'item_in' | 'item_out', item: WilsonCarryItem = 'torch') {
    this.startOneShot(state);
    if (state === 'item_in') {
      this.carryItem = item;
      this.frameIndex = -1;
      this.showFrame(0);
    }
  }

  playPickup() {
    this.startOneShot('pickup');
  }

  setCrafting(crafting: boolean) {
    if (crafting) this.cancelEmote();
    this.stategraph.requestCrafting(crafting);
  }

  setFacing(facing: WilsonFacing, mirrored = false) {
    if (facing === this.facing && mirrored === this.mirrored) return;
    this.facing = facing;
    this.mirrored = mirrored;
    this.visual.scale.x = Math.abs(this.visual.scale.x) * (mirrored ? -1 : 1);
    // Facing changes select different art without restarting the state timeline.
    this.selectAnimation(this.stategraph.animationClip);
    this.showCurrentFrame();
  }

  async setCarryItem(item: WilsonCarryItem | null, skinId?: string): Promise<void> {
    const key = item === null ? '' : `${item}:${skinId ?? ''}`;
    if (key === this.carryKey) return;
    this.carryKey = key;
    const request = ++this.carryRequest;
    this.stategraph.pushEvent('unequip');
    this.equippedCarryItem = item;
    this.lanternLight.setLit(false);
    if (item === 'lantern') {
      try {
        const equipment = await loadLanternEquipment(this.lanternAssets, skinId);
        if (request !== this.carryRequest) return;
        this.lanternEquipment = equipment;
        this.lanternLight.setLit(true);
      } catch (error) {
        if (request !== this.carryRequest) return;
        this.carryKey = '';
        throw error;
      }
    }
    if (isLightStaff(item)) {
      try {
        const [equipment] = await Promise.all([
          loadLightStaffEquipment(this.lanternAssets, item, skinId),
          PreloadSounds('dontstarve/common/staffteleport'),
        ]);
        if (request !== this.carryRequest) return;
        this.staffEquipment = equipment;
      } catch (error) {
        if (request !== this.carryRequest) return;
        this.carryKey = '';
        throw error;
      }
    }
    if (item === 'bugnet') {
      try {
        const [equipment] = await Promise.all([
          loadBugNetEquipment(this.lanternAssets, skinId), PreloadSounds('dontstarve/wilson/dig'),
        ]);
        if (request !== this.carryRequest) return;
        this.netEquipment = equipment;
      } catch (error) {
        if (request !== this.carryRequest) return;
        this.carryKey = '';
        throw error;
      }
    }
    if (item === 'hammer') {
      try {
        const [equipment] = await Promise.all([
          loadHammerEquipment(this.lanternAssets, skinId), PreloadSounds('dontstarve/wilson/hit'),
        ]);
        if (request !== this.carryRequest) return;
        this.hammerEquipment = equipment;
      } catch (error) {
        if (request !== this.carryRequest) return;
        this.carryKey = '';
        throw error;
      }
    }
    if (item && isPickaxeTool(item)) {
      try {
        const [equipment] = await Promise.all([
          loadPickaxeEquipment(this.lanternAssets, item, skinId), PreloadSounds('dontstarve/wilson/use_pick_rock'),
        ]);
        if (request !== this.carryRequest) return;
        this.pickaxeEquipment = equipment;
      } catch (error) {
        if (request !== this.carryRequest) return;
        this.carryKey = '';
        throw error;
      }
    }
    if (item && isPitchforkTool(item)) {
      try {
        const [equipment] = await Promise.all([
          loadPitchforkEquipment(this.lanternAssets, item, skinId), PreloadSounds('dontstarve/wilson/dig'),
        ]);
        if (request !== this.carryRequest) return;
        this.pitchforkEquipment = equipment;
      } catch (error) {
        if (request !== this.carryRequest) return;
        this.carryKey = '';
        throw error;
      }
    }
    if (item && isFarmHoeTool(item)) {
      try {
        const equipment = await loadFarmHoeEquipment(this.lanternAssets, item, skinId);
        if (request !== this.carryRequest) return;
        this.farmHoeEquipment = equipment;
      } catch (error) {
        if (request !== this.carryRequest) return;
        this.carryKey = '';
        throw error;
      }
    }
    if (item && isShovelTool(item)) {
      try {
        const equipment = await loadShovelEquipment(this.lanternAssets, item, skinId);
        if (request !== this.carryRequest) return;
        this.shovelEquipment = equipment;
        if (item === 'goldenshovel') PlaySound('dontstarve/wilson/equip_item_gold');
      } catch (error) {
        if (request !== this.carryRequest) return;
        this.carryKey = '';
        throw error;
      }
    }
    if (item === 'reskin_tool') {
      try {
        const [equipment] = await Promise.all([
          loadReskinToolEquipment(this.lanternAssets, skinId), PreloadSounds('dontstarve/wilson/attack_weapon'),
        ]);
        if (request !== this.carryRequest) return;
        this.reskinToolEquipment = equipment;
      } catch (error) {
        if (request !== this.carryRequest) return;
        this.carryKey = '';
        throw error;
      }
    }
    if (this.state === 'item_in' && this.stategraph.isOneShot) return;
    this.carryItem = item;
    const currentFrame = Math.max(0, this.frameIndex);
    this.frameIndex = -1;
    this.showFrame(currentFrame);
  }

  async setHat(itemId: string | null, skinId?: string): Promise<void> {
    const key = itemId === null ? '' : `${itemId}\n${skinId ?? ''}`;
    if (key === this.hatKey) return;
    this.hatKey = key;
    const request = ++this.hatRequest;
    this.hat = null;
    this.hatActivation.setHat(null);
    this.hatElapsed = 0;
    this.refreshFrame();
    if (itemId === null) return;
    try {
      const hat = await this.hatAssets.load(itemId, skinId);
      if (request !== this.hatRequest) return;
      this.hat = hat;
      this.hatActivation.setHat(hat);
      this.refreshFrame();
    } catch (error) {
      if (request !== this.hatRequest) return;
      this.hatKey = '';
      throw error;
    }
  }

  setLanternFuelPercent(percent: number): void {
    this.lanternLight.setFuelPercent(percent);
    this.refreshFrame();
  }

  async setBackpack(equipped: boolean, skinId?: string): Promise<void> {
    const key = equipped ? `backpack:${skinId ?? ''}` : '';
    if (key === this.backpackKey) return;
    this.backpackKey = key;
    const request = ++this.backpackRequest;
    this.backpack = null;
    this.refreshFrame();
    if (!equipped) return;
    try {
      const skinArchive = skinId ? GROUND_ITEM_DEFINITIONS.backpack.skinArchives[skinId] : undefined;
      if (skinId && !skinArchive) throw new Error(`Unknown backpack skin: ${skinId}`);
      const [base, skin] = await Promise.all([
        this.lanternAssets.loadBuild('swap_backpack.zip'),
        skinArchive ? this.lanternAssets.loadBuild(skinArchive) : undefined,
      ]);
      if (request !== this.backpackRequest) return;
      this.backpack = skin ? [skin, base] : [base];
      this.refreshFrame();
    } catch (error) {
      if (request !== this.backpackRequest) return;
      this.backpackKey = '';
      throw error;
    }
  }

  setSanityPercent(percent: number): void {
    this.hatActivation.setSanityPercent(percent);
    this.refreshFrame();
  }

  private refreshFrame() {
    const currentFrame = Math.max(0, this.frameIndex);
    this.frameIndex = -1;
    this.showFrame(currentFrame);
  }

  update(dt: number, jumpProgress?: number) {
    const step = Math.max(0, Math.min(dt, 0.1));
    this.stategraph.update(step);
    this.castingLight.update(step);
    this.hatElapsed += step;
    const hatWasAnimating = this.hatActivation.isAnimating;
    this.hatActivation.update(step);
    if (hatWasAnimating && !this.hatActivation.isAnimating) this.frameIndex = -1;
    this.showCurrentFrame(jumpProgress);
  }

  private showCurrentFrame(jumpProgress?: number) {
    if (this.state === 'jump' && jumpProgress !== undefined) {
      const progress = THREE.MathUtils.clamp(jumpProgress, 0, 1);
      this.showFrame(Math.min(this.animation.frames.length - 1, Math.floor(progress * this.animation.frames.length)));
      return;
    }
    const clip = this.stategraph.animationClip;
    const speed = (clip.frameRate ?? this.animation.frameRate) * (clip.playbackRate ?? 1);
    const frame = Math.floor(this.stategraph.animationTime * speed);
    this.showFrame(clip.loop ? frame % this.animation.frames.length : Math.min(frame, this.animation.frames.length - 1));
  }

  private selectAnimation(clip: WilsonAnimationClip): number {
    this.state = clip.key;
    this.clipName = clip.name;
    const parsed = this.state === 'emote' ? this.emote!.animations : this.animations[this.state];
    const bankHash = smallHash('wilson');
    const facing = facingValues[this.facing];
    const candidates = parsed.animations.filter((animation) =>
      animation.name === this.clipName && animation.bankHash === bankHash);
    this.animation = candidates.find((animation) => animation.facing === facing) ??
      candidates.find((animation) => (animation.facing & facing) !== 0) ?? candidates[0];
    if (!this.animation) throw new Error(`Wilson animation ${this.clipName} is unavailable`);
    this.frameIndex = -1;
    this.showFrame(0);
    return this.animation.frames.length / ((clip.frameRate ?? this.animation.frameRate) * (clip.playbackRate ?? 1));
  }

  private startOneShot(state: WilsonOneShotState) {
    this.cancelEmote();
    this.stategraph.requestOneShot(state);
  }

  private showFrame(index: number) {
    if (index === this.frameIndex && !this.hat?.definition.equip.follow && !this.hatActivation.isAnimating) return;
    this.frameIndex = index;
    const sprites = [...this.animation.frames[index].elements]
      .filter((element) => isHatPlayerElementVisible(element, this.hat?.definition.equip.mode ?? null))
      .filter((element) => !this.hatActivation.hidesSwapHat || element.imageHash !== smallHash('swap_hat'))
      .filter((element) => this.carryItem && this.state !== 'build'
        ? element.layerHash !== normalArmLayerHash
        : element.layerHash !== carryArmLayerHash)
      .filter((element) => element.layerHash !== lanternOverlayHash
        || (this.carryItem === 'lantern' && this.lanternLight.isLit && this.state !== 'build'))
      .sort((a, b) => b.z - a.z)
      .flatMap((element): ResolvedSprite[] => {
        if (this.backpack && element.imageHash === smallHash('swap_body')) {
          const source = this.backpack.find(({ build }) => build.symbols.has(element.imageHash));
          const image = source && findImage(source.build, element.imageHash, element.imageIndex);
          return image ? [{ element, image, materials: source.materials }] : [];
        }
        if (this.hat && element.imageHash === smallHash(
          this.hat.definition.equip.mode === 'fullhelm' ? 'headbase_hat' : 'swap_hat',
        )) return resolveHatSprites(this.hat, element, this.hatElapsed);
        if (this.carryItem === 'lantern' && this.lanternEquipment && this.state !== 'build'
          && (element.imageHash === swapObjectHash || element.imageHash === lanternOverlayHash)) {
          return resolveLanternPlayerSprite(this.lanternEquipment, element);
        }
        if (isLightStaff(this.carryItem) && this.staffEquipment && this.state !== 'build'
          && element.imageHash === swapObjectHash) {
          return resolveYellowStaffPlayerSprite(this.staffEquipment, element);
        }
        if (this.carryItem === 'bugnet' && this.netEquipment && this.state !== 'build'
          && element.imageHash === swapObjectHash) return resolveBugNetPlayerSprite(this.netEquipment, element);
        if (this.carryItem === 'hammer' && this.hammerEquipment && this.state !== 'build'
          && element.imageHash === swapObjectHash) return resolveHammerPlayerSprite(this.hammerEquipment, element);
        if (isPickaxeTool(this.carryItem ?? '') && this.pickaxeEquipment && this.state !== 'build'
          && element.imageHash === swapObjectHash) return resolvePickaxePlayerSprite(this.pickaxeEquipment, element);
        if (isPitchforkTool(this.carryItem ?? '') && this.pitchforkEquipment && this.state !== 'build'
          && element.imageHash === swapObjectHash) return resolvePitchforkPlayerSprite(this.pitchforkEquipment, element);
        if (isFarmHoeTool(this.carryItem ?? '') && this.farmHoeEquipment && this.state !== 'build'
          && element.imageHash === swapObjectHash) return resolveFarmHoePlayerSprite(this.farmHoeEquipment, element);
        if (isShovelTool(this.carryItem ?? '') && this.shovelEquipment && this.state !== 'build'
          && element.imageHash === swapObjectHash) return resolveShovelPlayerSprite(this.shovelEquipment, element);
        if (this.carryItem === 'reskin_tool' && this.reskinToolEquipment && this.state !== 'build'
          && element.imageHash === swapObjectHash) return resolveReskinToolPlayerSprite(this.reskinToolEquipment, element);
        const usesTorch = this.state !== 'build'
          && this.carryItem === 'torch'
          && element.imageHash === swapObjectHash;
        const source = usesTorch ? this.torch : { build: this.build, materials: this.materials };
        const image = findImage(
          source.build,
          usesTorch ? swapTorchHash : element.imageHash,
          element.imageIndex,
        );
        if (image) return [{ element, image, materials: source.materials }];
        const props = this.emote?.props;
        const propImage = props && findImage(props.build, element.imageHash, element.imageIndex);
        return propImage ? [{ element, image: propImage, materials: props!.materials }] : [];
      });
    const anchor = this.animation.frames[index].elements.find((element) =>
      element.imageHash === smallHash(this.hat?.definition.equip.activated?.symbol ?? 'hair'));
    const fx = anchor ? this.hatActivation.resolve(anchor, this.mirrored) : { back: [], front: [] };
    this.renderer.show([...fx.back, ...sprites, ...fx.front]);
  }
}

export async function createWilsonPlayer(assetBaseUrl: string): Promise<THREE.Group> {
  const [buildPackage, torchBuildPackage, torchAnimation, idle, movement, jump, itemActions, eat, staff, net, hammer, shovel, attacks, till] = await Promise.all([
    loadBuild('willow.zip', assetBaseUrl),
    loadBuild('swap_torch.zip', assetBaseUrl),
    loadAnim('torch.zip', assetBaseUrl),
    loadAnim('player_idles.zip', assetBaseUrl),
    loadAnim('player_basic.zip', assetBaseUrl),
    loadAnim('player_jump.zip', assetBaseUrl),
    loadAnim('player_actions_item.zip', assetBaseUrl),
    loadAnim('player_actions_eat.zip', assetBaseUrl),
    loadAnim('player_staff.zip', assetBaseUrl),
    loadAnim('player_actions_bugnet.zip', assetBaseUrl),
    loadAnim('player_actions_pickaxe.zip', assetBaseUrl),
    loadAnim('player_actions_shovel.zip', assetBaseUrl),
    loadAnim('player_attacks.zip', assetBaseUrl),
    loadAnim('player_actions_till.zip', assetBaseUrl),
  ]);
  if (buildPackage.build.name.toLowerCase() !== 'willow') {
    throw new Error(`Expected Willow build, received ${buildPackage.build.name}`);
  }
  if (torchBuildPackage.build.name.toLowerCase() !== 'swap_torch'
    || !torchAnimation.animations.some((animation) => animation.bankHash === smallHash('torch'))) {
    throw new Error('Expected the torch animation and swap_torch build');
  }

  const player = new THREE.Group();
  player.name = 'Willow';
  player.position.set(0, 30, 0);
  player.userData.billboard = true;

  const visual = new THREE.Group();
  const assetToWorldScale = 0.02;
  visual.scale.set(assetToWorldScale, -assetToWorldScale, assetToWorldScale);
  player.add(visual);
  registerSpriteRenderGroup(player, visual);

  const controller = new WilsonController(visual, buildPackage.build, {
    idle,
    walk: movement,
    run: movement,
    jump,
    build: itemActions,
    eat,
    quick_eat_pre: eat,
    quick_eat: eat,
    quick_drink_pre: eat,
    quick_drink: eat,
    item_in: itemActions,
    item_out: itemActions,
    pickup: itemActions,
    pickup_pst: itemActions,
    atk_pre: attacks,
    atk: attacks,
    staff_pre: staff,
    staff,
    bugnet_pre: net,
    bugnet: net,
    pickaxe_pre: hammer,
    pickaxe_loop: hammer,
    pickaxe_pst: hammer,
    shovel_pre: shovel,
    shovel_loop: shovel,
    shovel_pst: shovel,
    till_pre: till,
    till_loop: till,
    till_pst: till,
  }, createMaterials(buildPackage), {
    build: torchBuildPackage.build,
    materials: createMaterials(torchBuildPackage),
  }, assetBaseUrl);
  player.userData.animationController = controller;
  player.userData.stategraph = controller.stategraph;
  return player;
}

export async function createWilsonPlayerPrefab(
  assetBaseUrl: string,
  options: WilsonPlayerPrefabOptions = {},
): Promise<WilsonPlayerPrefab> {
  const model = await createWilsonPlayer(assetBaseUrl);
  const shapeRadius = options.shapeRadius ?? 4.5;
  const material = new CANNON.Material('player');
  const body = new CANNON.Body({
    mass: options.mass ?? 5,
    shape: new CANNON.Sphere(shapeRadius),
    position: new CANNON.Vec3(model.position.x, model.position.y, model.position.z)
      .vadd(new CANNON.Vec3(0, shapeRadius, 0)),
    material,
    fixedRotation: true,
  }) as PlayerBody;
  body.canJump = false;
  body.addEventListener('collide', () => {
    body.canJump = true;
  });

  return {
    body,
    model,
    setNormal(cameraWorldQuaternion) {
      model.quaternion.copy(cameraWorldQuaternion);
    },
  };
}
