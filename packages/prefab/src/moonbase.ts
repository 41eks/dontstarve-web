import * as THREE from 'three';
import { createEffect, createRenderEffect, createMemo, createSignal, readonlySignal, WorldContentKey, type ReadonlySignal, type Signal, type WorldContentSignal, type WorldMoonState, type WorldPhase } from '@dontstarve-web/signals';
import { ItemEntity, type ItemEntityRegistry, type InventoryStack } from '@dontstarve-web/inventory';
import { createSpriteFactory, loadSymbolOverride, type LoadedSymbolOverride, type SpriteController } from '@dontstarve-web/animation/sprite';
import { loadAnimationArchive } from '@dontstarve-web/animation/animationAssets';
import definitions from './definitions.json' with { type: 'json' };
import { GROUND_ITEM_DEFINITIONS } from './groundItems';
import type { AnimatedBuildingDefinition, AnimatedBuildingPreparedResources } from './animatedBuildingPlacement';
import { actionEntity } from './actionEntity';
import { Workable } from '../../componets/src/workable';
import { Repairable } from '../../componets/src/repairable';
import { Trader, type TradeItem } from '../../componets/src/trader';
import { Pickable } from './components/pickable';
import { PlaySound, PreloadSounds, type SoundEventPath, type SoundHandle } from './sound';
import { ComponentTimer, Timer, type NamedTimerSave } from '../../componets/src/timer';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { MoonbaseEffects, type MoonbaseFxResources } from './moonbaseFx';
import type { WorldContext } from './worldContext';
import catalog from './groundItems.json' with { type: 'json' };

export const MOONBASE_ID = 'moonbase' as const;
export const MOONBASE_DAMAGED_WORK = 4;
export const MOONBASE_COMPLETE_WORK = 6;
export const MOONBASE_CHARGE_DELAY = 10;
export const MOONBASE_CHARGE_DURATION = 49.9;
export const MOONBASE_CHARGE_STAGE_DURATION = 18.7;
export const MOONBASE_TIMER_LIMITS = {
  fullmoonstartdelay: MOONBASE_CHARGE_DELAY, moonchargepre: MOONBASE_CHARGE_DELAY,
  mooncharge: MOONBASE_CHARGE_DURATION, mooncharge2: MOONBASE_CHARGE_STAGE_DURATION,
  mooncharge3: MOONBASE_CHARGE_STAGE_DURATION,
} as const;
export interface MoonbaseSaveState { staff?: InventoryStack; timer?: NamedTimerSave; }
export type MoonbaseChargePhase = 'idle' | 'preparing' | 'charging_1' | 'charging_2' | 'charging_3' | 'complete';
const STAFF = 'yellowstaff';
const ITEM_SOUND = 'dontstarve/common/together/moonbase/moonstaff_place';
const REPAIR_SOUND = 'dontstarve/common/together/moonbase/repair';
const animationState = (workleft: number) => workleft > MOONBASE_DAMAGED_WORK ? 'full'
  : workleft * 2 > MOONBASE_DAMAGED_WORK ? 'med' : workleft > 0 ? 'medlow' : 'low';

interface MoonbaseResources extends AnimatedBuildingPreparedResources, MoonbaseFxResources {
  readonly staffOverrides: Readonly<Record<string, LoadedSymbolOverride>>;
}

/** moonbase.lua: workable owns repairs; trader and pickable own insertion and retrieval. */
class Moonbase {
  private readonly staffState = createSignal<ItemEntity | undefined>(undefined);
  readonly staff = readonlySignal(this.staffState);
  readonly phase;
  readonly charge;
  private readonly phaseMemo;
  private readonly chargeMemo;
  readonly workable: Workable;
  readonly trader: Trader<TradeItem>;
  readonly pickable: Pickable;
  private readonly sounds = new Set<SoundHandle>();
  private readonly model: THREE.Group;
  private readonly resources: Signal<MoonbaseResources>;
  private readonly items?: ItemEntityRegistry;
  readonly timer: Timer;
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly world: WorldContext | undefined;
  private readonly fullMoon;
  private readonly moon?: WorldContentSignal<WorldMoonState>;
  private readonly cycle?: WorldContentSignal<WorldPhase>;
  private readonly cleanups: (() => void)[] = [];
  private readonly initializer: ComponentTimer;
  private readonly musicPulse: ComponentTimer;
  private effects: MoonbaseEffects;
  private disposed = false;
  constructor(model: THREE.Group, resources: MoonbaseResources, items?: ItemEntityRegistry, world?: WorldContext, art?: ReadonlySignal<number>) {
    this.model = model; this.resources = createSignal(resources); this.items = items;
    this.world = world; this.ownsScheduler = !world?.scheduler;
    this.scheduler = world?.scheduler ?? new GameTimeScheduler();
    this.moon = world?.getWatchWorldContent?.(WorldContentKey.Moon, stop => this.cleanups.push(stop));
    this.cycle = world?.getWatchWorldContent?.(WorldContentKey.Cycle, stop => this.cleanups.push(stop));
    this.fullMoon = createMemo(() => this.isFullMoon(true));
    this.timer = new Timer(this.scheduler, name => this.onTimerDone(name), Object.keys(MOONBASE_TIMER_LIMITS));
    this.effects = new MoonbaseEffects(model, world?.scene ?? new THREE.Scene(), this.scheduler, resources);
    this.musicPulse = new ComponentTimer(this.scheduler, () => this.pushMusic());
    this.initializer = new ComponentTimer(this.scheduler, () => {
      let previous = this.fullMoon.peek();
      createEffect(() => {
        const full = this.isFullMoon(true);
        if (full === previous) return;
        previous = full;
        if (full) this.timer.StartTimer('fullmoonstartdelay', MOONBASE_CHARGE_DELAY);
        else this.timer.StopTimer('fullmoonstartdelay');
        this.toggleCharge();
      });
      this.toggleCharge(true);
    });
    const inst = actionEntity(model, MOONBASE_ID);
    for (const tag of ['moonbase', 'event_trigger', 'antlion_sinkhole_blocker', 'NPC_workable']) inst.addTag(tag);
    this.workable = new Workable(inst);
    this.workable.SetWorkAction(undefined); // Lua avoids PICK / MINE priority conflict.
    this.workable.SetMaxWork(MOONBASE_COMPLETE_WORK);
    this.workable.SetWorkLeft(MOONBASE_DAMAGED_WORK);
    this.workable.savestate = true;
    this.workable.SetOnWorkCallback(() => this.updateWorkState());
    this.workable.SetOnLoadFn(() => this.updateWorkState());
    model.userData.components.workable = this.workable;
    this.phaseMemo = createMemo(() => animationState(this.workable.workleft.get()));
    this.phase = readonlySignal(this.phaseMemo);
    this.chargeMemo = createMemo(() => this.chargePhase(true));
    this.charge = readonlySignal(this.chargeMemo);
    this.pickable = new Pickable(model, '', 1000000, 1, () => this.onStaffTaken());
    this.pickable.canInteractWith = false;
    this.pickable.pause();
    this.pickable.getProductEntity = () => this.staffState.peek();
    this.trader = new Trader(inst);
    this.trader.deleteitemonaccept = false;
    this.trader.SetAbleToAcceptTest(item => !item.prefab.endsWith('staff') ? { ok: false, reason: 'NOTSTAFF' }
      : { ok: (item.prefab === STAFF || item.prefab === 'opalstaff') && item instanceof ItemEntity });
    this.trader.SetOnAccept((_giver, item) => this.onStaffGiven(item as ItemEntity));
    this.trader.Disable();
    model.userData.components.trader = this.trader;
    model.userData.components.timer = this.timer;
    model.userData.components.moonbase = this;
    this.makeRepairable();
    // OverrideSymbol("swap_staffs", ...) follows the held staff and the displayed art, including after the sprite is rebuilt.
    this.cleanups.push(createRenderEffect(() => {
      art?.get();
      const staff = this.staffState.get(), { staffOverrides } = this.resources.get();
      this.sprite.overrideSymbol('swap_staffs', staff ? staffOverrides[`${staff.prefab}:${staff.skinId ?? 'base'}`] : undefined);
    }));
    this.initializer.start(0);
  }
  private isFullMoon(track = false): boolean {
    const moon = track ? this.moon?.get() : this.moon?.peek();
    const cycle = track ? this.cycle?.get() : this.cycle?.peek();
    return moon?.phase === 'full' && cycle === 'night';
  }
  private chargePhase(track = false): MoonbaseChargePhase {
    const staff = track ? this.staffState.get() : this.staffState.peek();
    const full = track ? this.fullMoon.get() : this.fullMoon.peek();
    const work = track ? this.workable.workleft.get() : this.workable.workleft.peek();
    const active = (name: string) => {
      const state = track ? this.timer.snapshot(name).get() : this.timer.snapshot(name).peek();
      return state.status === 'scheduled' || state.status === 'paused';
    };
    if (staff?.prefab === 'opalstaff') return 'complete';
    if (!full || work <= 0 || staff?.prefab !== STAFF) return 'idle';
    if (active('mooncharge')) return active('mooncharge2') ? 'charging_1' : active('mooncharge3') ? 'charging_2' : 'charging_3';
    return active('moonchargepre') ? 'preparing' : 'idle';
  }
  HasTag(tag: string): boolean | undefined {
    if (tag !== 'intense') return undefined;
    const phase = this.chargePhase();
    return phase === 'charging_2' || phase === 'charging_3';
  }
  private get sprite(): SpriteController { return this.model.userData.animationController; }
  private fixed(): boolean { return this.workable.workleft.peek() > MOONBASE_DAMAGED_WORK; }
  private playSound(path: SoundEventPath): void {
    for (const sound of this.sounds) if (!sound.isPlaying()) this.sounds.delete(sound);
    this.sounds.add(PlaySound(path, this.model.position));
  }
  private makeRepairable(): void {
    if (this.model.userData.components.repairable) return;
    const repairable = new Repairable(actionEntity(this.model, MOONBASE_ID), this.workable, 'moonrock');
    repairable.noannounce = true;
    repairable.onrepaired = () => this.onRepaired();
    this.model.userData.components.repairable = repairable;
  }
  private removeRepairable(): void {
    this.model.userData.components.repairable?.dispose();
    delete this.model.userData.components.repairable;
  }
  private updateTrading(): void {
    if (this.fixed() && !this.pickable.canInteractWith) this.trader.Enable();
    else this.trader.Disable();
  }
  private onRepaired(): void {
    const state = animationState(this.workable.workleft.peek());
    if (state === 'full') {
      this.removeRepairable();
      this.workable.SetWorkLeft(this.workable.maxwork.peek());
    }
    if (![state, `recharging_${state}`, `hit_${state}`, `fix_${state}`].includes(this.sprite.currentAnimation)) {
      if (state !== 'low') {
        this.playSound(REPAIR_SOUND);
        this.sprite.playOnce(`fix_${state}`, () => this.sprite.start(this.restingAnimation()));
      } else this.sprite.start('low');
    }
    this.updateTrading();
    if (this.initializer.snapshot.peek().status === 'expired') this.toggleCharge();
  }
  private updateWorkState(): void {
    const state = animationState(this.workable.workleft.peek());
    if (state !== 'low') this.sprite.playOnce(`hit_${state}`, () => this.sprite.start(this.restingAnimation()));
    else this.sprite.start('low');
    if (state !== 'full') this.makeRepairable();
    else this.removeRepairable();
    this.updateTrading();
    if (this.initializer.snapshot.peek().status === 'expired') this.toggleCharge();
  }
  private onStaffGiven(staff: ItemEntity): void {
    this.staffState.set(staff);
    this.trader.Disable();
    this.pickable.SetUp(staff.prefab, 1000000);
    this.pickable.pause();
    this.pickable.canInteractWith = true;
    this.playSound(ITEM_SOUND);
    if (staff.prefab === 'opalstaff') this.effects.showCold(); else this.effects.hideCold();
    if (this.initializer.snapshot.peek().status === 'expired') this.toggleCharge();
  }
  private onStaffTaken(): void {
    this.staffState.set(undefined);
    this.pickable.canInteractWith = false;
    this.playSound(ITEM_SOUND);
    this.effects.hideCold();
    this.updateTrading();
    if (this.initializer.snapshot.peek().status === 'expired') this.toggleCharge();
  }
  /** A reskin brings new prepared art: the staff overlay follows through the effect on `resources`. */
  refreshArt(resources: MoonbaseResources): void {
    if (resources === this.resources.peek()) return;
    this.effects.dispose();
    this.effects = new MoonbaseEffects(this.model, this.world?.scene ?? new THREE.Scene(), this.scheduler, resources);
    this.resources.set(resources);
    if (this.staffState.peek()?.prefab === 'opalstaff') this.effects.showCold();
    const phase = this.chargePhase();
    if (phase.startsWith('charging_')) this.effects.start(phase === 'charging_1' ? 1 : phase === 'charging_2' ? 2 : 3, true);
  }
  private restingAnimation(): string {
    const state = animationState(this.workable.workleft.peek());
    return this.chargePhase().startsWith('charging_') || this.chargePhase() === 'preparing' ? `recharging_${state}` : state;
  }
  private toggleCharge(restored = false): void {
    if (this.disposed) return;
    const active = this.workable.workleft.peek() > 0 && this.fullMoon.peek() && this.staffState.peek()?.prefab === STAFF;
    if (active) {
      if (this.timer.TimerExists('mooncharge')) {
        const phase = this.chargePhase();
        this.effects.start(phase === 'charging_1' ? 1 : phase === 'charging_2' ? 2 : 3, restored);
        if (this.musicPulse.snapshot.peek().status !== 'scheduled') this.musicPulse.start(0);
      } else if (!this.timer.TimerExists('moonchargepre')) {
        this.timer.StartTimer('moonchargepre', Math.max(1, this.timer.GetTimeLeft('fullmoonstartdelay') ?? 1));
        this.timer.StopTimer('fullmoonstartdelay');
      }
    } else {
      for (const name of ['moonchargepre', 'mooncharge', 'mooncharge2', 'mooncharge3']) this.timer.StopTimer(name);
      this.musicPulse.stop(); this.effects.stop(); this.updateTrading();
    }
    const current = this.sprite.currentAnimation;
    if (!current.startsWith('fix_') && !current.startsWith('hit_')) this.sprite.start(this.restingAnimation());
  }
  private onTimerDone(name: string): void {
    if (this.disposed) return;
    if (name === 'moonchargepre') {
      if (this.timer.TimerExists('fullmoonstartdelay')) {
        this.timer.StartTimer('moonchargepre', this.timer.GetTimeLeft('fullmoonstartdelay')!);
        this.timer.StopTimer('fullmoonstartdelay'); return;
      }
      this.timer.StartTimer('mooncharge', MOONBASE_CHARGE_DURATION);
      this.timer.StartTimer('mooncharge2', MOONBASE_CHARGE_STAGE_DURATION);
      this.effects.start(1); this.musicPulse.start(0);
    } else if (name === 'mooncharge2') {
      this.timer.StartTimer('mooncharge3', Math.min(MOONBASE_CHARGE_STAGE_DURATION, MOONBASE_CHARGE_DURATION - MOONBASE_CHARGE_STAGE_DURATION));
      this.effects.setLevel(2);
    } else if (name === 'mooncharge3') {
      this.effects.setLevel(3);
      // Source switches music immediately at stage 3; subsequent pushes recur once per second.
      this.pushMusic();
    } else if (name === 'mooncharge' && this.pickable.canInteractWith && this.staffState.peek()?.prefab === STAFF) {
      const old = this.staffState.peek()!;
      const skinId = old.skinId === undefined ? undefined : catalog.staffMorphSkins[old.skinId as keyof typeof catalog.staffMorphSkins];
      const state: InventoryStack = { itemId: 'opalstaff', count: 1, remainingUses: 50, ...(skinId ? { skinId } : {}) };
      const staff = this.items?.create(state) ?? new ItemEntity(state);
      staff.components.finiteuses.setMaxUses(50);
      if (this.items) this.items.destroy(old); else old.destroy();
      this.staffState.set(staff); this.pickable.SetUp('opalstaff', 1000000); this.pickable.pause();
      this.effects.showCold(); this.effects.finish(); this.toggleCharge();
    }
  }
  private pushMusic(): void {
    if (!this.timer.TimerExists('mooncharge') || this.disposed) return;
    if (this.world?.player && this.world.player.position.distanceTo(this.model.position) < 90) {
      this.world.dynamicMusic?.TriggerMoonbase(this.chargePhase() === 'charging_3' ? 2 : 1);
    }
    this.musicPulse.start(1);
  }
  update(dt: number): void {
    if (this.ownsScheduler) this.scheduler.advance(dt);
    this.effects.update(dt);
  }
  get renderEffects() { return this.effects.renderEntities; }
  restore(components: { workable?: { workleft: number; maxwork: number }; moonbase?: MoonbaseSaveState }): void {
    this.timer.OnLoad(components.moonbase?.timer);
    if (components.workable) this.workable.OnLoad(components.workable);
    if (components.moonbase?.staff) {
      const staff = this.items?.create(components.moonbase.staff) ?? new ItemEntity(components.moonbase.staff);
      this.onStaffGiven(staff);
    } else this.onStaffTaken();
  }
  exportComponents() {
    const staff = this.staffState.peek(); staff?.flush();
    return { workable: { workleft: this.workable.workleft.peek(), maxwork: this.workable.maxwork.peek() },
      ...(staff || this.timer.OnSave() ? { moonbase: { ...(staff ? { staff: staff.snapshot() } : {}),
        ...(this.timer.OnSave() ? { timer: this.timer.OnSave() } : {}) } } : {}) };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cleanups.splice(0).forEach(stop => stop()); this.fullMoon.dispose();
    this.initializer.stop(); this.musicPulse.stop(); this.timer.dispose(); this.effects.dispose();
    for (const sound of this.sounds) sound.stop();
    this.sounds.clear();
    const staff = this.staffState.peek();
    if (staff) { if (this.items) this.items.destroy(staff); else staff.destroy(); }
    this.staffState.set(undefined);
    this.removeRepairable();
    this.trader.dispose(); this.pickable.dispose(); this.workable.dispose(); this.phaseMemo.dispose(); this.chargeMemo.dispose();
    if (this.ownsScheduler) this.scheduler.dispose();
  }
}

const stateOf = (model: THREE.Group): Moonbase => model.userData.moonbase;
export function getMoonbaseState(model: THREE.Group) {
  const state = stateOf(model);
  return { phase: state.phase, charge: state.charge, staff: state.staff, workleft: state.workable.workleft,
    timers: Object.fromEntries(Object.keys(MOONBASE_TIMER_LIMITS).map(name => [name, state.timer.snapshot(name)])) };
}

async function prepare(): Promise<MoonbaseResources> {
  const base = `${import.meta.env.BASE_URL}dst/data/anim`;
  const archives = ['yellowstaff', 'opalstaff'].flatMap(prefab => Object.entries({ base: 'staffs.zip', ...GROUND_ITEM_DEFINITIONS[prefab].skinArchives })
    .map(([skin, archive]) => ({ id: `${prefab}:${skin}`, archive, symbol: prefab })));
  const [overrides, beam, cold] = await Promise.all([
    Promise.all(archives.map(async ({ id, archive, symbol }) => [id, await loadSymbolOverride(base, archive, symbol)] as const)),
    loadAnimationArchive('moonbase_fx.zip', base), loadAnimationArchive('star_cold.zip', base),
    PreloadSounds(ITEM_SOUND, REPAIR_SOUND, 'dontstarve/common/together/moonbase/beam',
      'dontstarve/common/together/moonbase/beam_level_up', 'dontstarve/common/together/moonbase/beam_stop',
      'dontstarve/common/together/moonbase/beam_stop_fail', 'dontstarve/common/staff_coldlight_LP',
      'dontstarve/music/music_epicfight_moonbase', 'dontstarve/music/music_epicfight_moonbase_b'),
  ]);
  const beamFactory = createSpriteFactory(beam.buildPackage, beam.animations), coldFactory = createSpriteFactory(cold.buildPackage, cold.animations);
  return { staffOverrides: Object.fromEntries(overrides), materials: overrides.flatMap(([, override]) => override.materials),
    beamFactory, coldFactory, durations: Object.fromEntries(beam.animations.animations.map(animation => [animation.name, animation.frames.length / animation.frameRate])),
    dispose() { beamFactory.dispose(); coldFactory.dispose(); } };
}

export const MOONBASE_DEFINITION: AnimatedBuildingDefinition = {
  ...definitions.animatedBuildings.moonbase,
    obstacleRadius: 1,
  prepare,
  oninit: ({ model, prepared, itemEntities, world, art }) => { model.userData.moonbase = new Moonbase(model, prepared as MoonbaseResources, itemEntities, world, art); },
  onrestore: ({ model }, components) => stateOf(model).restore(components),
  exportComponents: ({ model }) => stateOf(model).exportComponents(),
  onreskin: ({ model, prepared }) => stateOf(model).refreshArt(prepared as MoonbaseResources),
  ondispose: ({ model }) => stateOf(model).dispose(),
  onupdate: ({ model }, dt) => stateOf(model).update(dt),
  renderEffects: ({ model }) => stateOf(model).renderEffects,
};
