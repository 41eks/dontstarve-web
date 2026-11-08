import { addComponent } from './components';
import { PrefabDisplayGroup, prefabDisplay } from '@dontstarve-web/display';
import * as THREE from 'three';
import { createEffect, createSignal, readonlySignal, watchSignal } from '@dontstarve-web/signals';
import { SpriteResources, type ArchiveSpriteCommands, type PrefabDisplay } from '@dontstarve-web/display';
import { animationLengths } from './animationTimings';
import { createArchiveEntity, type EntityTask, type PrefabInstance, prefabInstance } from './prefabInstance';
import { AnimState } from '../../componets/src/animstate';
import { ComponentTimer } from '../../componets/src/timer';
import { ChildSpawner, type ChildSpawnerSave } from '../../componets/src/childspawner';
import { Burnable } from '../../componets/src/burnable';
import { Propagator } from '../../componets/src/propagator';
import { Hauntable } from '../../componets/src/hauntable';
import type { MiniMapState } from '../../map/src/minimapState';
import { Pickable, type PickableSaveState } from './components/pickable';
import { bulbPlantLight, BULB_PLANT_LIGHT_SAMPLE_INTERVAL, type BulbPlantLightState } from './bulb_plant';
import { LightFlierHabitat, type LightFlier, type LightFlierServices } from './lightflier';
import { watchTileActivity } from './tileActivity';
import { actionEntity, disposeActionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { PlaySound, type SoundHandle } from './sound';
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

type LightFlierFlowerComponents = { pickable: Pickable; childspawner: ChildSpawner<LightFlierFlower, LightFlier>;
  burnable: Burnable; propagator: Propagator; hauntable: Hauntable };

/** lightflier_flower.lua: release, pause regrowth, recall and restore through childspawner. */
export class LightFlierFlower implements BrainEntity {
  readonly prefab = LIGHTFLIER_FLOWER_ID;
  readonly id: string;
  readonly model: THREE.Group;
  /** The flower is the inst its childspawner sees; every component is stored on, and torn down with, the prefab instance. */
  get components(): LightFlierFlowerComponents { return this.instance.components as LightFlierFlowerComponents; }
  get isRemoved(): boolean { return this.removed || this.instance.isRemoved; }
  onRemove(remove: () => void): () => void { return this.instance.onRemove(remove); }
  readonly MiniMapEntity: MiniMapState;
  readonly animstate: AnimState;
  private readonly mode = createSignal<BulbPlantLightState>('CHARGED');
  readonly lightState = readonlySignal(this.mode);
  private readonly recharge: ComponentTimer;
  private readonly turnoff: ComponentTimer;
  /** recall_task */
  recalltask?: EntityTask;
  /** The LightWatcher's sampling while the entity is awake. */
  private sampletask?: EntityTask;
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
  private active = false;
  private readonly instance: PrefabInstance<ArchiveSpriteCommands>;
  readonly variant: LightFlierFlowerSave['variant'];
  constructor(id: string, model: THREE.Group, instance: PrefabInstance<ArchiveSpriteCommands>, habitat: LightFlierHabitat, lengths: ReadonlyMap<string, number>,
    getLightLevel: (model: THREE.Group) => number, variant: LightFlierFlowerSave['variant'], saved?: LightFlierFlowerSave, random = Math.random) {
    this.instance = instance; this.id = id; this.model = model; this.habitat = habitat; this.variant = variant; this.getLightLevel = getLightLevel; this.random = random;
    const scheduler = habitat.services.scheduler;
    if (!instance.worldServices?.scheduler) instance.BindScheduler(scheduler);
    this.MiniMapEntity = this.instance.minimap; this.MiniMapEntity.SetIcon('bulb_plant.png');
    this.tweenStart = scheduler.now - this.tweenTime;
    this.mode.set(saved?.lightState ?? 'CHARGED'); this.lightOn = saved?.lightState === 'ON' && !saved?.picked;
    this.animstate = new AnimState(scheduler, lengths, () => {});
    this.recharge = new ComponentTimer(scheduler, () => { this.setState('CHARGED'); this.sampleLight(); if (this.inLight) this.turnOn(); });
    this.turnoff = new ComponentTimer(scheduler, () => { this.turnOff(); if (this.components.pickable.canBePicked) this.components.pickable.Pick(); });
    this.timers = Object.freeze({ recharge: this.recharge.snapshot, turnoff: this.turnoff.snapshot });
    instance.entityId = id;
    Object.assign(model.userData, { lightflierFlower: this, remove: () => this.remove() });
    for (const tag of ['plant', 'lightflier_home']) instance.addTag(tag);
    const pickable = addComponent(instance, 'pickable', Pickable, undefined, LIGHTFLIER_FLOWER_REGROW_TIME, 1, doer => {
      const fly = habitat.spawn(this.getPosition()); this.components.childspawner.TakeOwnership(fly);
      fly.PushEvent('startled'); this.components.childspawner.childreninside = Math.max(0, this.components.childspawner.childreninside - 1);
      this.forceOff(); this.turnoff.stop(); this.recharge.stop();
      if (doer) { this.sound?.stop(); this.sound = PlaySound('dontstarve/wilson/pickup_lightbulb', model.position); }
      this.sequence('picking', 'picked'); pickable.pause(); this.startRecall();
    }, () => { this.turnOff(); this.sequence('grow', 'idle', true); }, saved, { scheduler,
      onEmpty: () => { this.forceOff(); this.turnoff.stop(); this.recharge.stop(); this.animstate.PlayAnimation('picked'); } });
    pickable.picksound = 'dontstarve/wilson/pickup_reeds';
    const childspawner = addComponent(this, 'childspawner', ChildSpawner<LightFlierFlower, LightFlier>, scheduler, saved?.childspawner, random);
    childspawner.onchildkilled = () => pickable.resume();
    childspawner.ongohome = () => { if (!pickable.canBePicked) pickable.regen(); this.forceOn(); };
    actionEntity(model, this.prefab);
    const burnable = addComponent(instance, 'burnable', Burnable, scheduler);
    burnable.SetBurnTime(20); // MakeMediumBurnable default burn time.
    burnable.SetOnIgniteFn(() => { this.turnOff(); if (pickable.canBePicked) pickable.Pick(); else this.animstate.PlayAnimation('picked'); });
    burnable.SetOnBurntFn(() => { habitat.services.dropLoot('ash', 1, this.getPosition().clone()); this.remove(); });
    addComponent(instance, 'propagator', Propagator, 'small', () => [], WORLD_SCALE, scheduler, habitat.services.getWatchWorldContent);
    addComponent(instance, 'hauntable', Hauntable, scheduler).SetOnHauntFn(() => false); // MakeHauntableIgnite is disabled in source.
    this.pendingChildren = [...(saved?.childspawner.childrenoutside ?? [])];
    habitat.homes.set(id, this);
    this.animstate.PlayAnimation(saved?.picked ? 'picked' : this.lightOn ? 'idle' : this.mode.peek() === 'RECHARGING' ? 'withered' : 'off', this.lightOn);
    if (saved?.rechargeSeconds !== undefined) this.recharge.start(saved.rechargeSeconds);
    if (saved?.turnoffSeconds !== undefined) this.turnoff.start(saved.turnoffSeconds);
    if (saved?.picked && this.pendingChildren.length) this.startRecall();
    // OnWake: DoTaskInTime(1, TurnOnInLight).
    instance.DoTaskInTime(1, () => { this.awake = true; this.sampleLight(); if (this.inLight) this.turnOn(); });
    this.refreshLight();
    this.cleanups.push(watchTileActivity(model, habitat.services.tickingarea, active => this.setActive(active)));
  }
  getPosition(): THREE.Vector3 { return this.model.position; }
  getPhysicsRadius(): number { return 0; }
  get childrenOutside(): number { return this.components.childspawner.numchildrenoutside; }
  hasTag(tag: string): boolean { return this.instance.hasTag(tag); }
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
    this.stopRecall(); this.components.pickable.regen(); this.sequence('grow', 'idle', true); this.forceOn();
    this.recharge.stop(); this.turnoff.stop(); this.turnoff.start(110 + this.randomTween());
  }
  private randomTween(): number { return 4 + Math.min(4, Math.floor(this.random() * 5)); }
  private startRecall(): void { this.stopRecall(); this.recalltask = this.instance.DoTaskInTime(60 + this.random() * 60, () => this.callForLightFlier()); }
  private stopRecall(): void { this.recalltask?.Cancel(); this.recalltask = undefined; }
  private callForLightFlier(): void {
    this.recalltask = undefined;
    if (this.components.pickable.canBePicked || this.childrenOutside < 1) return;
    if (!this.returningHome?.isValid() || this.returningHome.components.formationfollower.active)
      this.returningHome = [...this.components.childspawner.childrenoutside].find(fly => !fly.components.formationfollower.active);
    this.recalltask = this.instance.DoTaskInTime(8, () => this.callForLightFlier());
  }
  get isActive(): boolean { return this.active; }
  /** OnEntitySleep/OnEntityWake: only the LightWatcher sampling and presentation pause; game-time timers keep running. */
  private setActive(active: boolean): void {
    if (this.removed || this.active === active) return;
    this.active = active;
    // OnEntitySleep/OnEntityWake: frames and instance entries exist only while the tile is active.
    this.instance.setActive(active);
    this.sampletask?.Cancel(); this.sampletask = undefined;
    if (!active) return;
    this.checkLight();
    this.sampletask = this.instance.DoPeriodicTask(BULB_PLANT_LIGHT_SAMPLE_INTERVAL, () => this.checkLight(), BULB_PLANT_LIGHT_SAMPLE_INTERVAL * (.5 + this.random() * .5));
    this.refreshLight();
  }
  private checkLight(): void { const wasInLight = this.inLight; this.sampleLight(); if (this.awake && !wasInLight && this.inLight) this.turnOn(); }
  private sampleLight(): void { const level = this.getLightLevel(this.model); this.inLight = this.inLight ? level > .05 : level >= .075; }
  private refreshLight(): void { this.instance.light.set(bulbPlantLight(this.lightOn, (this.habitat.services.scheduler.now - this.tweenStart) / this.tweenTime)); }
  update(): void {
    if (this.removed) return;
    if (this.pendingChildren.length) {
      this.pendingChildren = this.components.childspawner.LoadPostPass(id => [...this.habitat.flies].find(fly => fly.id === id), this.pendingChildren);
    }
    if (this.active) this.refreshLight();
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
    this.recharge.stop(); this.turnoff.stop(); this.animstate.dispose(); this.sound?.stop();
    // The components are torn down with the prefab instance below.
    this.cleanups.splice(0).forEach(stop => stop()); this.events.clear(); this.instance.light.set(null);
    this.instance.remove(); this.model.removeFromParent();
  }
}

export class LightFlierFlowerManager {
  readonly habitat: LightFlierHabitat;
  private readonly plants = new Map<LightFlierFlower, PrefabDisplay>();
  private readonly resources: SpriteResources;
  private readonly cleanups = new Map<LightFlierFlower, () => void>();
  private readonly displays: PrefabDisplayGroup;
  private readonly getLightLevel: (model: THREE.Group) => number;
  private disposed = false;
  constructor(scene: THREE.Scene, base: string, services: LightFlierServices, getLightLevel: (model: THREE.Group) => number) {
    this.displays = new PrefabDisplayGroup(scene); this.getLightLevel = getLightLevel;
    this.habitat = new LightFlierHabitat(services); this.resources = new SpriteResources(base, LIGHTFLIER_FLOWER_ID);
  }
  spawn(position: THREE.Vector3, saved?: LightFlierFlowerRecord): THREE.Group {
    const state = saved?.components.lightflierFlower, variant = state?.variant ?? (Math.random() < .5 ? 'single' : 'springy');
    const archive = `bulb_plant_${variant}.zip` as const;
    const lengths = animationLengths(archive);
    if (this.disposed) throw new Error('Lightflier flower manager disposed');
    const tint = .75 + Math.random() * .25;
    const { instance, display } = createArchiveEntity(LIGHTFLIER_FLOWER_ID,
      this.resources.archive({ animationArchive: archive, buildArchives: [archive], bank: `bulb_plant_${variant}` },
        // Each flower owns its tint (SetMultColour), so its sprites are created with a colour.
        { instancedAnimations: ['idle'], staticBillboard: true, colour: [1, 1, 1] }),
      { name: 'off', billboard: true }, LIGHTFLIER_FLOWER_ID, instance => instance.sprite.setColour([tint, tint, tint]), undefined,
      { staticTransform: true });
    const sprite = instance.sprite, model = display.model;
    sprite.playOnce('off');
    instance.setPosition(position.x, 0, position.z);
    const plant = new LightFlierFlower(saved?.id ?? newEntityId(), model, instance, this.habitat, lengths, this.getLightLevel, variant, state);
    const animation = watchSignal(plant.animstate.animation, stop => this.cleanups.set(plant, stop));
    createEffect(() => { const { name, loop } = animation.get(); instance.AnimState.PlayAnimation(name, loop); });
    this.plants.set(plant, display); this.displays.mount(prefabDisplay(model)!); return model;
  }
  update(dt: number, _quaternion: THREE.Quaternion): void {
    this.habitat.update(dt);
    for (const [plant, display] of this.plants) {
      if (!plant.isValid()) { this.release(plant, display); continue; }
      plant.update(); if (!plant.isActive) continue;
      (prefabInstance(display.model)!.sprite as ArchiveSpriteCommands).update(dt);
    }
  }
  private release(plant: LightFlierFlower, display: PrefabDisplay): void {
    this.cleanups.get(plant)?.(); this.cleanups.delete(plant); disposeActionEntity(display.model); display.dispose(); this.plants.delete(plant);
  }
  get renderEntities() { return [...this.plants.values()].map(({ model }) => ({ object: model, footPosition: model.position, cameraDepth: 0 })); }
  exportRecords(): LightFlierFlowerRecord[] { return [...this.plants.keys()].filter(plant => plant.isValid() && !plant.components.burnable.IsBurning()).map(plant => ({ id: plant.id,
    transform: { position: plant.getPosition().toArray(), rotationY: 0 }, components: { lightflierFlower: plant.OnSave() } })); }
  dispose(): void {
    if (this.disposed) return; this.disposed = true;
    for (const [plant, display] of this.plants) { plant.dispose(); this.release(plant, display); }
    this.habitat.dispose(); this.displays.dispose(); this.resources.dispose();

  }
}
