import * as THREE from 'three';
import { createEffect, createSignal, readonlySignal, watchSignal } from '@dontstarve-web/signals';
import { ArchiveSpriteAssets, preloadSharedArchiveSprite, type ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { AnimState } from '../../componets/src/animstate';
import { ComponentTimer } from '../../componets/src/timer';
import { ChildSpawner, type ChildSpawnerSave } from '../../componets/src/childspawner';
import { Burnable } from '../../componets/src/burnable';
import { Propagator } from '../../componets/src/propagator';
import { Hauntable } from '../../componets/src/hauntable';
import { MiniMapEntity } from '../../componets/src/minimapentity';
import { Pickable, type PickableSaveState } from './components/pickable';
import { bulbPlantLight, BULB_PLANT_LIGHT_SAMPLE_INTERVAL, type BulbPlantLightState } from './bulb_plant';
import { LightFlierHabitat, type LightFlier, type LightFlierServices } from './lightflier';
import { actionEntity, disposeActionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { setPrefabLocalLight } from './localLight';
import { PlaySound, PreloadSounds, type SoundHandle } from './sound';
import { WORLD_SCALE } from './standardcomponents';
import type { BrainEntity } from '../../brains/src/types';

export const LIGHTFLIER_FLOWER_ID = 'lightflier_flower';
export const LIGHTFLIER_FLOWER_REGROW_TIME = 12 * 480;
export interface LightFlierFlowerSave extends PickableSaveState {
  variant: 'single' | 'springy';
  lightState: BulbPlantLightState;
  rechargeSeconds?: number;
  turnoffSeconds?: number;
  childspawner: ChildSpawnerSave;
}
export interface LightFlierFlowerRecord {
  id: string; transform: { position: [number, number, number]; rotationY: number };
  components: { lightflierFlower: LightFlierFlowerSave };
}

/** lightflier_flower.lua: release, pause regrowth, recall and restore through childspawner. */
export class LightFlierFlower implements BrainEntity {
  readonly prefab = LIGHTFLIER_FLOWER_ID;
  readonly id: string;
  readonly model: THREE.Group;
  readonly components: { pickable: Pickable; childspawner: ChildSpawner<LightFlierFlower, LightFlier>; burnable: Burnable; propagator: Propagator; hauntable: Hauntable };
  readonly MiniMapEntity: MiniMapEntity;
  readonly animstate: AnimState;
  private readonly mode = createSignal<BulbPlantLightState>('CHARGED');
  readonly lightState = readonlySignal(this.mode);
  private readonly recharge: ComponentTimer;
  private readonly turnoff: ComponentTimer;
  private readonly wake: ComponentTimer;
  private readonly recall: ComponentTimer;
  private readonly sampleTimer: ComponentTimer;
  readonly timers;
  returningHome?: LightFlier;
  private pendingChildren: string[];
  private removed = false;
  private readonly events = new Map<string, Set<() => void>>();
  private readonly habitat: LightFlierHabitat;
  private readonly getLightLevel: (model: THREE.Group) => number;
  private readonly random: () => number;
  private inLight = false;
  private lightOn = false;
  private tweenStart: number;
  private tweenTime = 4;
  private readonly cleanups: (() => void)[] = [];
  private sound?: SoundHandle;
  private awake = false;
  readonly variant: LightFlierFlowerSave['variant'];
  constructor(id: string, model: THREE.Group, habitat: LightFlierHabitat, lengths: ReadonlyMap<string, number>,
    getLightLevel: (model: THREE.Group) => number, variant: LightFlierFlowerSave['variant'], saved?: LightFlierFlowerSave, random = Math.random) {
    this.id = id; this.model = model; this.habitat = habitat; this.variant = variant; this.getLightLevel = getLightLevel; this.random = random;
    const scheduler = habitat.services.scheduler;
    this.MiniMapEntity = new MiniMapEntity(model.position); this.MiniMapEntity.SetIcon('bulb_plant.png');
    this.tweenStart = scheduler.now - this.tweenTime;
    this.mode.set(saved?.lightState ?? 'CHARGED'); this.lightOn = saved?.lightState === 'ON' && !saved?.picked;
    this.animstate = new AnimState(scheduler, lengths, () => {});
    this.recharge = new ComponentTimer(scheduler, () => { this.setState('CHARGED'); this.sampleLight(); if (this.inLight) this.turnOn(); });
    this.turnoff = new ComponentTimer(scheduler, () => { this.turnOff(); if (this.components.pickable.canBePicked) this.components.pickable.Pick(); });
    this.wake = new ComponentTimer(scheduler, () => { this.awake = true; this.sampleLight(); if (this.inLight) this.turnOn(); });
    this.recall = new ComponentTimer(scheduler, () => this.callForLightFlier());
    this.sampleTimer = new ComponentTimer(scheduler, () => {
      const wasInLight = this.inLight; this.sampleLight(); if (this.awake && !wasInLight && this.inLight) this.turnOn();
      this.sampleTimer.start(BULB_PLANT_LIGHT_SAMPLE_INTERVAL);
    });
    this.timers = Object.freeze({ recharge: this.recharge.snapshot, turnoff: this.turnoff.snapshot, wake: this.wake.snapshot, recall: this.recall.snapshot });
    Object.assign(model.userData, { prefab: this.prefab, entityId: id, tags: ['plant', 'lightflier_home'], lightflierFlower: this, remove: () => this.remove() });
    const pickable = new Pickable(model, undefined, LIGHTFLIER_FLOWER_REGROW_TIME, 1, doer => {
      const fly = habitat.spawn(this.getPosition()); this.components.childspawner.TakeOwnership(fly);
      fly.PushEvent('startled'); this.components.childspawner.childreninside = Math.max(0, this.components.childspawner.childreninside - 1);
      this.forceOff(); this.turnoff.stop(); this.recharge.stop();
      if (doer) { this.sound?.stop(); this.sound = PlaySound('dontstarve/wilson/pickup_lightbulb', model.position); }
      this.sequence('picking', 'picked'); pickable.pause(); this.startRecall();
    }, () => { this.turnOff(); this.sequence('grow', 'idle', true); }, saved, { scheduler,
      onEmpty: () => { this.forceOff(); this.turnoff.stop(); this.recharge.stop(); this.animstate.PlayAnimation('picked'); } });
    pickable.picksound = 'dontstarve/wilson/pickup_reeds';
    const childspawner = new ChildSpawner<LightFlierFlower, LightFlier>(this, scheduler, saved?.childspawner, random);
    childspawner.onchildkilled = () => pickable.resume();
    childspawner.ongohome = () => { if (!pickable.canBePicked) pickable.regen(); this.forceOn(); };
    const inst = actionEntity(model, this.prefab);
    const burnable = new Burnable(inst, scheduler);
    burnable.SetBurnTime(20); // MakeMediumBurnable default burn time.
    burnable.SetOnIgniteFn(() => { this.turnOff(); if (pickable.canBePicked) pickable.Pick(); else this.animstate.PlayAnimation('picked'); });
    burnable.SetOnBurntFn(() => { habitat.services.dropLoot('ash', 1, this.getPosition().clone()); this.remove(); });
    const propagator = new Propagator(inst, 'small', () => [], WORLD_SCALE, scheduler, habitat.services.getWatchWorldContent);
    const hauntable = new Hauntable({ addTag: tag => inst.addTag(tag), removeTag: tag => inst.removeTag(tag),
      PushEvent: (name, data) => inst.PushEvent?.(name, data) }, scheduler);
    hauntable.SetOnHauntFn(() => false); // MakeHauntableIgnite is disabled in source.
    this.components = { pickable, childspawner, burnable, propagator, hauntable }; model.userData.components = this.components;
    this.pendingChildren = [...(saved?.childspawner.childrenoutside ?? [])];
    habitat.homes.set(id, this);
    this.animstate.PlayAnimation(saved?.picked ? 'picked' : this.lightOn ? 'idle' : this.mode.peek() === 'RECHARGING' ? 'withered' : 'off', this.lightOn);
    if (saved?.rechargeSeconds !== undefined) this.recharge.start(saved.rechargeSeconds);
    if (saved?.turnoffSeconds !== undefined) this.turnoff.start(saved.turnoffSeconds);
    if (saved?.picked && this.pendingChildren.length) this.startRecall();
    this.wake.start(1); this.sampleTimer.start(BULB_PLANT_LIGHT_SAMPLE_INTERVAL * (.5 + random() * .5)); this.refreshLight();
  }
  getPosition(): THREE.Vector3 { return this.model.position; }
  getPhysicsRadius(): number { return 0; }
  get childrenOutside(): number { return this.components.childspawner.numchildrenoutside; }
  hasTag(tag: string): boolean { return this.model.userData.tags.includes(tag); }
  isValid(): boolean { return !this.removed; }
  canGoHome(): boolean { return !this.removed && !this.components.pickable.canBePicked && !this.components.burnable.IsBurning() && !this.hasTag('burnt'); }
  ListenForEvent(name: string, fn: () => void): () => void { let set = this.events.get(name); if (!set) this.events.set(name, set = new Set()); set.add(fn); return () => set!.delete(fn); }
  private setState(state: BulbPlantLightState): void {
    this.mode.set(state); const clips = state === 'ON' ? ['recharge', 'idle'] : state === 'CHARGED' ? ['revive', 'off'] : ['drain', 'withered'];
    this.sequence(clips[0], clips[1], state === 'ON');
  }
  private sequence(first: string, next: string, loop = false): void { this.animstate.PlayAnimation(first); this.animstate.PushAnimation(next, loop); }
  turnOn(): void {
    if (!this.components.pickable.canBePicked || this.mode.peek() !== 'CHARGED') return;
    this.setState('ON'); this.lightOn = true; this.tweenStart = this.habitat.services.scheduler.now; this.tweenTime = this.randomTween();
    if (this.turnoff.snapshot.peek().status !== 'scheduled') this.turnoff.start(140 + this.tweenTime + this.random() * 50);
  }
  turnOff(): void {
    this.setState('RECHARGING'); this.lightOn = false; this.tweenStart = this.habitat.services.scheduler.now; this.tweenTime = this.randomTween();
    this.recharge.start(110 + this.tweenTime);
  }
  private forceOff(): void {
    if (this.mode.peek() === 'ON') this.setState('RECHARGING');
    this.lightOn = false; this.tweenStart = this.habitat.services.scheduler.now - this.tweenTime; this.refreshLight();
  }
  private forceOn(): void {
    if (!this.components.pickable.canBePicked) return;
    this.setState('ON'); this.lightOn = true; this.tweenStart = this.habitat.services.scheduler.now - this.tweenTime; this.refreshLight();
  }
  /** pickable.lua MakeFull invokes the prefab's makefullfn, unlike ordinary regrowth. */
  makeFull(): void {
    this.recall.stop(); this.components.pickable.regen(); this.sequence('grow', 'idle', true); this.forceOn();
    this.recharge.stop(); this.turnoff.stop(); this.turnoff.start(110 + this.randomTween());
  }
  private randomTween(): number { return 4 + Math.min(4, Math.floor(this.random() * 5)); }
  private startRecall(): void { this.recall.stop(); this.recall.start(60 + this.random() * 60); }
  private callForLightFlier(): void {
    if (this.components.pickable.canBePicked || this.childrenOutside < 1) return;
    if (!this.returningHome?.isValid() || this.returningHome.components.formationfollower.active)
      this.returningHome = [...this.components.childspawner.childrenoutside].find(fly => !fly.components.formationfollower.active);
    this.recall.start(8);
  }
  private sampleLight(): void { const level = this.getLightLevel(this.model); this.inLight = this.inLight ? level > .05 : level >= .075; }
  private refreshLight(): void { setPrefabLocalLight(this.model, bulbPlantLight(this.lightOn, (this.habitat.services.scheduler.now - this.tweenStart) / this.tweenTime)); }
  update(): void {
    if (this.removed) return;
    if (this.pendingChildren.length) {
      this.pendingChildren = this.components.childspawner.LoadPostPass(id => [...this.habitat.flies].find(fly => fly.id === id), this.pendingChildren);
    }
    this.refreshLight();
  }
  OnSave(): LightFlierFlowerSave {
    const children = this.components.childspawner.OnSave(); children.childrenoutside.push(...this.pendingChildren);
    return { variant: this.variant, lightState: this.mode.peek(), ...this.components.pickable.exportState(), childspawner: children,
      ...(this.recharge.remainingSeconds === undefined ? {} : { rechargeSeconds: this.recharge.remainingSeconds }),
      ...(this.turnoff.remainingSeconds === undefined ? {} : { turnoffSeconds: this.turnoff.remainingSeconds }) };
  }
  remove(): void { if (this.removed) return; for (const fn of this.events.get('onremove') ?? []) fn(); this.dispose(); }
  dispose(): void {
    if (this.removed) return; this.removed = true; this.habitat.homes.delete(this.id); this.model.userData.removed = true;
    this.wake.stop(); this.sampleTimer.stop(); this.recharge.stop(); this.turnoff.stop(); this.recall.stop(); this.animstate.dispose(); this.sound?.stop();
    this.components.childspawner.dispose(); this.components.pickable.dispose(); this.components.burnable.dispose(); this.components.propagator.dispose();
    this.components.hauntable.dispose(); this.MiniMapEntity.dispose();
    this.cleanups.splice(0).forEach(stop => stop()); this.events.clear(); setPrefabLocalLight(this.model, null); this.model.removeFromParent();
  }
}

export class LightFlierFlowerManager {
  readonly habitat: LightFlierHabitat;
  private readonly plants = new Map<LightFlierFlower, ArchiveSprite>();
  private readonly assets: ArchiveSpriteAssets;
  private readonly factories = new Map<string, Promise<{ create: Awaited<ReturnType<typeof preloadSharedArchiveSprite>>; lengths: Map<string, number> }>>();
  private readonly cleanups = new Map<LightFlierFlower, () => void>();
  private readonly scene: THREE.Scene;
  private readonly getLightLevel: (model: THREE.Group) => number;
  private disposed = false;
  constructor(scene: THREE.Scene, base: string, services: LightFlierServices, getLightLevel: (model: THREE.Group) => number) {
    this.scene = scene; this.getLightLevel = getLightLevel;
    this.habitat = new LightFlierHabitat(base, services); this.assets = new ArchiveSpriteAssets(LIGHTFLIER_FLOWER_ID, base);
  }
  async spawn(position: THREE.Vector3, saved?: LightFlierFlowerRecord): Promise<THREE.Group> {
    const state = saved?.components.lightflierFlower, variant = state?.variant ?? (Math.random() < .5 ? 'single' : 'springy');
    const archive = `bulb_plant_${variant}.zip`;
    let prepared = this.factories.get(variant);
    if (!prepared) {
      prepared = Promise.all([
        preloadSharedArchiveSprite(this.assets, { animationArchive: archive, buildArchives: [archive], bank: `bulb_plant_${variant}` }, { instancedAnimations: ['idle'] }),
        this.assets.loadAnimation(archive), this.habitat.prepare(), PreloadSounds('dontstarve/wilson/pickup_lightbulb', 'dontstarve/wilson/pickup_reeds'),
      ]).then(([create, bank]) => ({ create, lengths: new Map(bank.animations.map(clip => [clip.name, clip.frames.length / clip.frameRate])) }));
      this.factories.set(variant, prepared);
    }
    const { create, lengths } = await prepared;
    if (this.disposed) throw new Error('Lightflier flower manager disposed');
    const tint = .75 + Math.random() * .25;
    const sprite = create('off', false, LIGHTFLIER_FLOWER_ID, { colour: [tint, tint, tint] }); sprite.model.position.copy(position); sprite.model.position.y = 0;
    const plant = new LightFlierFlower(saved?.id ?? newEntityId(), sprite.model, this.habitat, lengths, this.getLightLevel, variant, state);
    const animation = watchSignal(plant.animstate.animation, stop => this.cleanups.set(plant, stop));
    createEffect(() => { const { name, loop } = animation.get(); if (loop) sprite.start(name); else sprite.playOnce(name); });
    this.plants.set(plant, sprite); this.scene.add(sprite.model); return sprite.model;
  }
  update(dt: number, quaternion: THREE.Quaternion): void {
    this.habitat.update(dt);
    for (const [plant, sprite] of this.plants) {
      if (!plant.isValid()) { this.release(plant, sprite); continue; }
      plant.update(); sprite.model.quaternion.copy(quaternion); sprite.update(dt);
    }
  }
  private release(plant: LightFlierFlower, sprite: ArchiveSprite): void {
    this.cleanups.get(plant)?.(); this.cleanups.delete(plant); disposeActionEntity(sprite.model); sprite.dispose(); this.plants.delete(plant);
  }
  get renderEntities() { return [...this.plants.values()].map(sprite => ({ object: sprite.model, footPosition: sprite.model.position, cameraDepth: 0 })); }
  get miniMapEntities() { return [...this.plants.keys()].filter(plant => plant.isValid()).map(plant => plant.MiniMapEntity); }
  exportRecords(): LightFlierFlowerRecord[] { return [...this.plants.keys()].filter(plant => plant.isValid() && !plant.components.burnable.IsBurning()).map(plant => ({ id: plant.id,
    transform: { position: plant.getPosition().toArray(), rotationY: 0 }, components: { lightflierFlower: plant.OnSave() } })); }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const [plant, sprite] of this.plants) { plant.dispose(); this.release(plant, sprite); }
    this.habitat.dispose(); this.assets.dispose();
  }
}
