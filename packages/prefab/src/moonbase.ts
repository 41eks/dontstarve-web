import type { EntityEventData } from '../../componets/src/entityEvents';
import { SpriteState, type SpriteResources } from '@dontstarve-web/display';
import { PrefabInstance, type EntityTask } from './prefabInstance';
import { createEffect, WorldContentKey, type WorldContentSignal, type WorldMoonState, type WorldPhase } from '@dontstarve-web/signals';
import { ItemEntity, type InventoryStack } from '@dontstarve-web/inventory';
import { AnimState } from '@dontstarve-web/animation/animState';
import definitions from './definitions.json' with { type: 'json' };
import { GROUND_ITEM_DEFINITIONS } from './groundItems';
import { buildingPlacer, buildingPrefab, LoadBuildingSkin, SaveBuildingSkin, type BuildingDeclaration } from './building';
import type { PlacementSaveRecord } from './saveRecord';
import { Workable } from '../../componets/src/workable';
import { Repairable } from '../../componets/src/repairable';
import { Trader, type TradeAcceptance, type TradeItem } from '../../componets/src/trader';
import { Pickable } from './components/pickable';
import { addComponent, removeComponent } from './components';
import { PlaySound, type SoundEventPath, type SoundHandle } from './sound';
import { Timer, type NamedTimerSave } from '../../componets/src/timer';
import { MoonbaseEffects } from './moonbaseFx';
import type { PrefabWorldContext } from './worldContext';
import catalog from './groundItems.json' with { type: 'json' };

export const MOONBASE_ID = 'moonbase' as const;
const declaration: BuildingDeclaration = definitions.animatedBuildings.moonbase;

/** The build flow's placer for moonbase, drawn from its own bank and build. */
export const MOONBASE_PLACER = buildingPlacer(declaration);
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
const KEY_STAFF = 'yellowstaff';
const MORPHED_STAFF = 'opalstaff';
const ITEM_SOUND = 'dontstarve/common/together/moonbase/moonstaff_place';
const REPAIR_SOUND = 'dontstarve/common/together/moonbase/repair';

interface MoonbaseComponents {
  workable: Workable<MoonbaseInstance>;
  pickable: Pickable;
  trader: Trader<TradeItem, unknown, MoonbaseInstance>;
  timer: Timer;
  repairable?: Repairable;
}

/** moonbase.lua's fields on the inst; fn is the constructor, as far as it is ported: repairs, the staff it holds and its full-moon charge. */
export class MoonbaseInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & MoonbaseComponents;
  /** inst._staffinst: every held staff keeps its inst here, so its uses and skin need no inst._staffuse. */
  _staffinst?: ItemEntity;
  /** inst._loading: until init has run, nothing calls ToggleMoonCharge. */
  _loading?: EntityTask;
  /** inst._musictask */
  _musictask?: EntityTask;
  /** inst._fxpulse, _fxfront, _fxback, _staffstar and the light tasks. */
  readonly effects: MoonbaseEffects;
  /** The AnimState that carries the swap_staffs override. */
  readonly staffAnimState = new AnimState();
  /** inst.SoundEmitter's one-shot sounds, stopped with the entity. */
  readonly sounds = new Set<SoundHandle>();
  /** WatchWorldState("isfullmoon")'s sources. */
  readonly moon?: WorldContentSignal<WorldMoonState>;
  readonly cycle?: WorldContentSignal<WorldPhase>;

  constructor(world: PrefabWorldContext, sprites: SpriteResources) {
    super(MOONBASE_ID, new SpriteState({ name: declaration.idleAnimation ?? 'idle', billboard: true }));
    const { scheduler } = world;
    if (!scheduler) throw new Error('A moonbase needs the world scheduler');
    this.worldServices = world;
    this.sprite.setAnimState(this.staffAnimState.json, sprites.archives);
    this.moon = world.getWatchWorldContent?.(WorldContentKey.Moon, stop => this.onRemove(stop));
    this.cycle = world.getWatchWorldContent?.(WorldContentKey.Cycle, stop => this.onRemove(stop));
    this.effects = new MoonbaseEffects(this, scheduler, sprites);

    this.minimap.SetPriority(4);
    for (const tag of ['moonbase', 'event_trigger', 'antlion_sinkhole_blocker', 'NPC_workable']) this.addTag(tag);

    const workable = addComponent(this, 'workable', Workable<MoonbaseInstance>);
    workable.SetWorkAction(undefined); // Lua avoids PICK / MINE priority conflict.
    workable.SetMaxWork(MOONBASE_COMPLETE_WORK);
    workable.SetWorkLeft(MOONBASE_DAMAGED_WORK);
    workable.SetOnWorkCallback(UpdateWorkState);
    workable.SetOnLoadFn(() => UpdateWorkState(this));
    workable.savestate = true;

    MakeRepairable(this);

    const pickable = addComponent(this, 'pickable', Pickable, '', 1000000, 1, () => OnStaffTaken(this));
    pickable.canInteractWith = false;
    pickable.pause();
    pickable.getProductEntity = () => this._staffinst;

    const trader = addComponent(this, 'trader', Trader<TradeItem, unknown, MoonbaseInstance>);
    trader.SetAbleToAcceptTest(ItemTradeTest);
    trader.deleteitemonaccept = false;
    trader.SetOnAccept(OnStaffGiven);
    trader.Disable();

    addComponent(this, 'timer', Timer, scheduler, Object.keys(MOONBASE_TIMER_LIMITS));
    this.ListenForEvent('timerdone', OnTimerDone);

    this.OnSave = onsave;
    this.OnLoad = onload;
    this.onRemove(() => OnRemoveEntity(this));
    this._loading = this.DoTaskInTime(0, init);
  }
}

function IsFixed(inst: MoonbaseInstance): boolean {
  return inst.components.workable.workleft.peek() > MOONBASE_DAMAGED_WORK;
}

/** GetAnimState */
export function GetAnimState(inst: MoonbaseInstance): 'full' | 'med' | 'medlow' | 'low' {
  const workleft = inst.components.workable.workleft.peek();
  return IsFixed(inst) ? 'full' : workleft * 2 > MOONBASE_DAMAGED_WORK ? 'med' : workleft > 0 ? 'medlow' : 'low';
}

function IsFullMoon(inst: MoonbaseInstance): boolean {
  return inst.moon?.peek().phase === 'full' && inst.cycle?.peek() === 'night';
}

/** The stage the timers put the charge in. */
export function GetChargePhase(inst: MoonbaseInstance): MoonbaseChargePhase {
  const { timer, workable } = inst.components;
  const staff = inst._staffinst?.prefab;
  const active = (name: string) => {
    const { status } = timer.snapshot(name).peek();
    return status === 'scheduled' || status === 'paused';
  };
  if (staff === MORPHED_STAFF) return 'complete';
  if (!IsFullMoon(inst) || workable.workleft.peek() <= 0 || staff !== KEY_STAFF) return 'idle';
  if (active('mooncharge')) return active('mooncharge2') ? 'charging_1' : active('mooncharge3') ? 'charging_2' : 'charging_3';
  return active('moonchargepre') ? 'preparing' : 'idle';
}

function RestingAnimation(inst: MoonbaseInstance): string {
  const phase = GetChargePhase(inst), state = GetAnimState(inst);
  return phase.startsWith('charging_') || phase === 'preparing' ? `recharging_${state}` : state;
}

/** The queued PushAnimation after a hit_ or fix_ clip, which a removed entity no longer plays. */
function ResumeRestingAnimation(inst: MoonbaseInstance): void {
  if (inst.isValid()) inst.sprite.start(RestingAnimation(inst));
}

function DoPlaySound(inst: MoonbaseInstance, path: SoundEventPath): void {
  for (const sound of inst.sounds) if (!sound.isPlaying()) inst.sounds.delete(sound);
  inst.sounds.add(PlaySound(path, inst.position));
}

function PushMusic(inst: MoonbaseInstance): void {
  StopMusic(inst);
  if (!inst.components.timer.TimerExists('mooncharge')) return;
  const { player, dynamicMusic } = inst.worldServices ?? {};
  if (player && player.position.distanceTo(inst.position) < 90) dynamicMusic?.TriggerMoonbase(GetChargePhase(inst) === 'charging_3' ? 2 : 1);
  inst._musictask = inst.DoTaskInTime(1, PushMusic);
}

function StartMusic(inst: MoonbaseInstance): void {
  StopMusic(inst);
  inst._musictask = inst.DoTaskInTime(0, PushMusic);
}

function StopMusic(inst: MoonbaseInstance): void {
  inst._musictask?.Cancel();
  inst._musictask = undefined;
}

function UpdateTrading(inst: MoonbaseInstance): void {
  const { pickable, trader } = inst.components;
  if (IsFixed(inst) && !pickable.canInteractWith) trader.Enable();
  else trader.Disable();
}

function ToggleMoonCharge(inst: MoonbaseInstance, restored = false): void {
  const { timer, workable } = inst.components;
  if (workable.workleft.peek() > 0 && IsFullMoon(inst) && inst._staffinst?.prefab === KEY_STAFF) {
    if (timer.TimerExists('mooncharge')) {
      const phase = GetChargePhase(inst);
      inst.effects.start(phase === 'charging_1' ? 1 : phase === 'charging_2' ? 2 : 3, restored);
      if (!inst._musictask) StartMusic(inst);
      // A loaded charge is past mooncharge2's AddTag("intense").
      if (phase === 'charging_2' || phase === 'charging_3') inst.addTag('intense');
    } else if (!timer.TimerExists('moonchargepre')) {
      timer.StartTimer('moonchargepre', Math.max(1, timer.GetTimeLeft('fullmoonstartdelay') ?? 1));
      timer.StopTimer('fullmoonstartdelay');
    }
  } else {
    for (const name of ['moonchargepre', 'mooncharge', 'mooncharge2', 'mooncharge3']) timer.StopTimer(name);
    inst.removeTag('intense');
    StopMusic(inst);
    inst.effects.stop();
    UpdateTrading(inst);
  }
  const current = inst.sprite.currentAnimation;
  if (!current.startsWith('fix_') && !current.startsWith('hit_')) inst.sprite.start(RestingAnimation(inst));
}

function ItemTradeTest(_inst: MoonbaseInstance, item: TradeItem): TradeAcceptance {
  if (!item.prefab.endsWith('staff')) return { ok: false, reason: 'NOTSTAFF' };
  return { ok: (item.prefab === KEY_STAFF || item.prefab === MORPHED_STAFF) && item instanceof ItemEntity };
}

/** OverrideItemSkinSymbol / OverrideSymbol("swap_staffs", ...) follow the held staff; the display dresses every drawn sprite in the AnimState. */
function OverrideStaffSymbol(inst: MoonbaseInstance): void {
  const staff = inst._staffinst;
  if (!staff) { inst.staffAnimState.ClearOverrideSymbol('swap_staffs'); return; }
  const skin = staff.skinId === undefined ? undefined : GROUND_ITEM_DEFINITIONS[staff.prefab]?.skinArchives?.[staff.skinId];
  if (skin !== undefined) inst.staffAnimState.OverrideItemSkinSymbol('swap_staffs', skin, staff.prefab, String(staff.id), 'staffs');
  else inst.staffAnimState.OverrideSymbol('swap_staffs', 'staffs', staff.prefab);
}

function OnStaffGiven(inst: MoonbaseInstance, _giver: unknown, item: TradeItem): void {
  const staff = item as ItemEntity;
  const { pickable, trader } = inst.components;
  inst._staffinst = staff;
  OverrideStaffSymbol(inst);
  trader.Disable();
  pickable.SetUp(staff.prefab, 1000000);
  pickable.pause();
  pickable.canInteractWith = true;
  DoPlaySound(inst, ITEM_SOUND);
  if (staff.prefab === MORPHED_STAFF) inst.effects.showCold(); else inst.effects.hideCold();
  if (!inst._loading) ToggleMoonCharge(inst);
}

function OnStaffTaken(inst: MoonbaseInstance): void {
  inst._staffinst = undefined;
  OverrideStaffSymbol(inst);
  inst.components.pickable.canInteractWith = false;
  DoPlaySound(inst, ITEM_SOUND);
  inst.effects.hideCold();
  UpdateTrading(inst);
  if (!inst._loading) ToggleMoonCharge(inst);
}

function CreateStaff(inst: MoonbaseInstance, state: InventoryStack): ItemEntity {
  return inst.worldServices?.itemEntities?.create(state) ?? new ItemEntity(state);
}

function DestroyStaff(inst: MoonbaseInstance, staff: ItemEntity): void {
  const items = inst.worldServices?.itemEntities;
  if (items) items.destroy(staff); else staff.destroy();
}

function OnTimerDone(inst: MoonbaseInstance, { name }: EntityEventData['timerdone']): void {
  const { pickable, timer } = inst.components;
  if (name === 'moonchargepre') {
    if (timer.TimerExists('fullmoonstartdelay')) {
      timer.StartTimer('moonchargepre', timer.GetTimeLeft('fullmoonstartdelay')!);
      timer.StopTimer('fullmoonstartdelay');
    } else {
      timer.StartTimer('mooncharge', MOONBASE_CHARGE_DURATION);
      timer.StartTimer('mooncharge2', MOONBASE_CHARGE_STAGE_DURATION);
      inst.effects.start(1);
      StartMusic(inst);
    }
  } else if (name === 'mooncharge2') {
    inst.effects.setLevel(2);
    inst.addTag('intense');
    timer.StartTimer('mooncharge3', Math.min(MOONBASE_CHARGE_STAGE_DURATION, MOONBASE_CHARGE_DURATION - MOONBASE_CHARGE_STAGE_DURATION));
  } else if (name === 'mooncharge3') {
    inst.effects.setLevel(3);
    // Source switches music immediately at stage 3; subsequent pushes recur once per second.
    PushMusic(inst);
  } else if (name === 'mooncharge' && pickable.canInteractWith && inst._staffinst?.prefab === KEY_STAFF) {
    // morph staff
    const old = inst._staffinst;
    const skinId = old.skinId === undefined ? undefined : catalog.staffMorphSkins[old.skinId as keyof typeof catalog.staffMorphSkins];
    const staff = CreateStaff(inst, { itemId: MORPHED_STAFF, count: 1, remainingUses: 50, ...(skinId ? { skinId } : {}) });
    staff.components.finiteuses.setMaxUses(50);
    DestroyStaff(inst, old);
    inst._staffinst = staff;
    OverrideStaffSymbol(inst);
    pickable.SetUp(MORPHED_STAFF, 1000000);
    pickable.pause();
    inst.effects.showCold();
    inst.effects.finish();
    ToggleMoonCharge(inst);
  }
}

function OnRepaired(inst: MoonbaseInstance): void {
  const state = GetAnimState(inst);
  if (state === 'full') {
    // avoid repair & give action priority conflict
    removeComponent(inst, 'repairable');
    inst.components.workable.SetWorkLeft(inst.components.workable.maxwork.peek());
  }
  if (![state, `recharging_${state}`, `hit_${state}`, `fix_${state}`].includes(inst.sprite.currentAnimation)) {
    if (state !== 'low') {
      DoPlaySound(inst, REPAIR_SOUND);
      inst.sprite.playOnce(`fix_${state}`, () => ResumeRestingAnimation(inst));
    } else inst.sprite.start('low');
  }
  UpdateTrading(inst);
  if (!inst._loading) ToggleMoonCharge(inst);
}

function MakeRepairable(inst: MoonbaseInstance): void {
  if (inst.components.repairable) return;
  const repairable = addComponent(inst, 'repairable', Repairable, inst.components.workable, 'moonrock');
  repairable.onrepaired = () => OnRepaired(inst);
  repairable.noannounce = true;
}

function UpdateWorkState(inst: MoonbaseInstance): void {
  const state = GetAnimState(inst);
  if (state !== 'low') inst.sprite.playOnce(`hit_${state}`, () => ResumeRestingAnimation(inst));
  else inst.sprite.start('low');
  if (state !== 'full') MakeRepairable(inst);
  else removeComponent(inst, 'repairable');
  UpdateTrading(inst);
  if (!inst._loading) ToggleMoonCharge(inst);
}

/** onsave: the workable's record and the prefab's staff and timers, which stay nested under `moonbase`. */
function onsave(inst: MoonbaseInstance, data: PlacementSaveRecord['components']): void {
  SaveBuildingSkin(inst, data);
  delete data.timer;
  delete data.pickable;
  const { timer, workable } = inst.components;
  data.workable = { workleft: workable.workleft.peek(), maxwork: workable.maxwork.peek() };
  const staff = inst._staffinst;
  staff?.flush();
  const timers = timer.OnSave();
  if (staff || timers) data.moonbase = { ...(staff ? { staff: staff.snapshot() } : {}), ...(timers ? { timer: timers } : {}) };
}

/** onload: the workable has loaded its own record by now (SetPersistData); the timers and the staff are the prefab's. */
function onload(inst: MoonbaseInstance, data: PlacementSaveRecord['components']): void {
  LoadBuildingSkin(inst, data);
  inst.components.timer.OnLoad(data.moonbase?.timer);
  if (data.moonbase?.staff) OnStaffGiven(inst, undefined, CreateStaff(inst, data.moonbase.staff));
  else OnStaffTaken(inst);
}

function OnFullmoon(inst: MoonbaseInstance, isfullmoon: boolean): void {
  const { timer } = inst.components;
  if (isfullmoon) timer.StartTimer('fullmoonstartdelay', MOONBASE_CHARGE_DELAY);
  else timer.StopTimer('fullmoonstartdelay');
  ToggleMoonCharge(inst);
}

function init(inst: MoonbaseInstance): void {
  inst._loading = undefined;
  let previous = IsFullMoon(inst);
  // inst:WatchWorldState("isfullmoon", OnFullmoon)
  inst.onRemove(createEffect(() => {
    const moon = inst.moon?.get(), cycle = inst.cycle?.get();
    const isfullmoon = moon?.phase === 'full' && cycle === 'night';
    if (isfullmoon === previous) return;
    previous = isfullmoon;
    OnFullmoon(inst, isfullmoon);
  }));
  ToggleMoonCharge(inst, true);
}

function OnRemoveEntity(inst: MoonbaseInstance): void {
  inst.effects.dispose();
  for (const sound of inst.sounds) sound.stop();
  inst.sounds.clear();
  if (inst._staffinst) DestroyStaff(inst, inst._staffinst);
  inst._staffinst = undefined;
}

export function moonbasePrefabs(world: PrefabWorldContext) {
  return { [MOONBASE_ID]: { ...buildingPrefab(declaration, 'moonbase', 1, (_position, sprites) => new MoonbaseInstance(world, sprites), world), minimapIcon: 'moonbase.png' } };
}
