import type * as THREE from 'three';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ComponentTimer } from '../../componets/src/timer';
import { createMemo } from '@dontstarve-web/signals';
import { createResidentGroundItem, GROUND_ITEM_DEFINITIONS } from './groundItems';
import type { GroundItemFactory, GroundPrefabContext, GroundItemDefinition } from './groundPrefab';
import { createStructureLootDropper } from './structureLoot';
import { ItemEntity } from '@dontstarve-web/inventory';
import { Inventory } from '../../componets/src/inventory';
import { Trader } from '../../componets/src/trader';
import { Workable } from '../../componets/src/workable';
import { Machine } from '../../componets/src/machine';
import { listenInventoryEvents } from './inventoryEvents';
import { PlaySound, type SoundHandle } from './sound';
import { RECORD_ID, RECORD_SONGS, configureRecordEntity, isPhonographRecord } from './records';

export const PHONOGRAPH_ID = 'phonograph';
export const PHONOGRAPH_PLAY_TIME = 64;
const END_SOUND = 'dontstarve/music/gramaphone_end';

/**
 * phonograph.lua: a ground-only `machine` whose turnon plays the loaded record (TryToPlayRecord) and whose turnoff
 * stops it (StopPlayingRecord). The record survives stopping, inventory transfers and reskins.
 */
export class PhonographController {
  private readonly entity: ItemEntity;
  get record(): string | undefined {
    const item = this.entity.components.inventory?.GetItems().find(isPhonographRecord);
    return item ? item.skinId ?? RECORD_ID : undefined;
  }
  private scheduler: GameTimeScheduler;
  private ownsScheduler: boolean;
  private readonly playback: ComponentTimer;
  readonly timer;
  private readonly playing;
  get remainingSeconds(): number { return this.playback.remainingSeconds ?? 0; }
  private sound?: SoundHandle;
  private disposed = false;
  private get sprite() { return this.entity.sprite; }
  private get position(): THREE.Vector3 { return this.entity.getPosition(); }
  private readonly stopEvents: () => void;

  constructor(entity: ItemEntity, scheduler?: GameTimeScheduler) {
    this.entity = entity;
    scheduler ??= entity.components.perishable.scheduler;
    this.ownsScheduler = scheduler === undefined;
    this.scheduler = scheduler ?? new GameTimeScheduler();
    // play_song's DoTaskInTime(PHONOGRAPH_PLAY_TIME, TurnOffMachine).
    this.playback = new ComponentTimer(this.scheduler, () => { if (this.machine) this.machine.TurnOff(); else this.stop(); });
    this.timer = this.playback.snapshot;
    this.playing = createMemo(() => this.timer.get().status === 'scheduled');
    const machine = entity.components.machine = new Machine(entity, () => entity.components.perishable.scheduler ?? this.scheduler);
    machine.SetGroundOnlyMachine(true);
    machine.enabled = false;
    machine.turnonfn = () => this.TryToPlayRecord();
    machine.turnofffn = () => this.stop();
    this.stopEvents = listenInventoryEvents(entity, {
      onputininventory: () => this.OnPutInInventory(), ondropped: () => this.OnDropped(),
    });
  }

  get isPlaying(): boolean { return this.playing.peek(); }

  BindScheduler(scheduler: GameTimeScheduler): void {
    if (scheduler === this.scheduler) return;
    this.playback.BindScheduler(scheduler);
    if (this.ownsScheduler) this.scheduler.dispose();
    this.scheduler = scheduler; this.ownsScheduler = false;
  }

  get machine(): Machine | undefined { return this.entity.components.machine; }

  /** OnGetItemFromPlayer turns on the machine after its inventory has received the record. */
  OnRecordInserted(): void {
    const machine = this.machine!;
    this.opening = true;
    if (!machine.IsOn()) machine.TurnOn();
    this.opening = false;
  }

  /** DropRecord: turn off, disable and drop the actual inventory contents. */
  DropRecord(): void {
    const machine = this.machine;
    if (!machine) return;
    if (machine.IsOn()) machine.TurnOff();
    machine.enabled = false;
    this.entity.components.inventory!.DropEverything();
  }

  /** OnPutInInventory: a pocketed phonograph stops. */
  OnPutInInventory(): void { if (this.machine?.IsOn()) this.machine.TurnOff(); }
  /** OnDroppedFromInventory / OnLoad: a loaded phonograph can be switched again. */
  OnDropped(): void { if (this.machine && this.record) this.machine.enabled = true; }

  /** Resume a saved song: the machine is on, with the rest of its play time. */
  resume(seconds: number): void {
    const machine = this.machine;
    if (!machine || !this.play(seconds)) return;
    machine.enabled = true;
    machine.isOn = true;
  }

  private opening = false;
  /** TryToPlayRecord: without a record, or while held, the machine is disabled instead. */
  private TryToPlayRecord(): void {
    const machine = this.machine!;
    if (!this.record || this.entity?.components.inventoryitem.owner) { machine.enabled = false; return; }
    machine.enabled = true;
    this.play(PHONOGRAPH_PLAY_TIME, this.opening);
  }

  play(seconds = PHONOGRAPH_PLAY_TIME, open = false): boolean {
    if (this.disposed || !this.record || !Object.hasOwn(RECORD_SONGS, this.record)
      || !Number.isFinite(seconds) || seconds <= 0 || seconds > PHONOGRAPH_PLAY_TIME) return false;
    this.sound?.stop();
    this.playback.start(seconds);
    this.sound = PlaySound(RECORD_SONGS[this.record], this.position, PHONOGRAPH_PLAY_TIME - seconds);
    if (open) this.sprite.playOnce('open', () => { if (this.isPlaying) this.sprite.start('play_loop'); });
    else this.sprite.start('play_loop');
    return true;
  }

  stop(playEnd = true): void {
    const wasPlaying = this.sound !== undefined;
    this.sound?.stop(); this.sound = undefined;
    if (this.timer.peek().status !== 'expired') this.playback.stop();
    this.sprite.playOnce('idle');
    if (wasPlaying && playEnd) PlaySound(END_SOUND, this.position);
  }

  update(dt: number): void {
    if (this.ownsScheduler && !this.disposed && Number.isFinite(dt) && dt > 0) this.scheduler.advance(dt);
  }

  snapshot(): Pick<GroundItemDefinition, 'phonographRecord' | 'playbackRemaining'> {
    return { phonographRecord: this.record, playbackRemaining: this.isPlaying ? this.remainingSeconds : undefined };
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop(false); this.disposed = true; this.playing.dispose();
    this.stopEvents(); this.machine?.dispose();
    if (this.ownsScheduler) this.scheduler.dispose();
  }
}

/** phonograph.lua OnGetItemFromPlayer: the trader has already transferred the incoming inst. */
function onGetItemFromPlayer(inst: ItemEntity, item: ItemEntity): void {
  const controller = inst.components.phonograph!;
  controller.DropRecord();
  inst.components.inventory!.GiveItem(item);
  controller.OnRecordInserted();
}

/** Register the source inventory, accept test and onaccept callback on the logical inst. */
export function configurePhonographEntity(entity: ItemEntity, scheduler?: GameTimeScheduler): void {
  for (const tag of ['structure', 'recordplayer', 'furnituredecor', 'groundonlymachine']) entity.addTag(tag);
  entity.components.inventory = entity.component('inventory', () => {
    const saved = entity.snapshot();
    const inventory = new Inventory(entity, 15, (item, position) => {
      const drop = entity.worldServices?.dropItem;
      if (drop) drop(item, position);
      else entity.components.inventoryitem.owner?.DropItem?.(item, position);
    });
    // Old saves only named the song. New saves retain each stored inst's identity and state.
    const items = saved.inventory ?? (saved.phonographRecord ? [{ itemId: RECORD_ID, count: 1,
      ...(saved.phonographRecord === RECORD_ID ? {} : { skinId: saved.phonographRecord }) }] : []);
    inventory.OnLoad(items, state => { const item = new ItemEntity(state); configureRecordEntity(item); return item; });
    return inventory;
  });
  entity.components.phonograph = entity.component('phonograph', () => new PhonographController(entity, scheduler));
  entity.components.trader = entity.component('trader', () => {
    const trader = new Trader(entity);
    trader.deleteitemonaccept = false;
    trader.SetAcceptTest(isPhonographRecord);
    trader.SetOnAccept((_giver, item) => onGetItemFromPlayer(entity, item as ItemEntity));
    return trader;
  });
}

/** phonograph.lua OnHammered, registered on the actual inventory/ground inst. */
function onhammered(inst: ItemEntity): void {
  const controller = inst.components.phonograph!;
  controller.DropRecord();
  inst.components.lootdropper!.DropLoot();
  inst.worldServices?.fx?.collapse?.('small', inst.getPosition(), 'wood');
  inst.remove();
}

export function createPhonographGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  const { fx, dropLoot, spawnGroundItem, scheduler } = context;
  const worldServices = { fx, dropLoot: (items: readonly { itemId: string; count: number; skinId?: string }[], position: THREE.Vector3) =>
    dropLoot?.(items.map(item => ({ ...GROUND_ITEM_DEFINITIONS[item.itemId], ...item })), position),
    dropItem: (entity: ItemEntity, position: THREE.Vector3) => {
      spawnGroundItem?.({ ...GROUND_ITEM_DEFINITIONS[entity.prefab], ...entity.snapshot(), entity }, position, { fling: true });
    },
  };
  return {
    itemIds: [PHONOGRAPH_ID],
    configureEntity: entity => configurePhonographEntity(entity, scheduler),
    create(item, inst) {
      configurePhonographEntity(inst, scheduler);
      inst.worldServices = worldServices;
      const { visual, instance, display } = createResidentGroundItem(context, { ...item, entity: inst });
      const model = display.model;
      const controller = inst.components.phonograph!;
      const removeEvents = listenInventoryEvents(instance, {
        // Dropping a loaded machine enables it, but does not turn it on.
        ondropped: () => controller.OnDropped(),
        onload: () => { controller.OnDropped(); if (item.playbackRemaining && !controller.isPlaying) controller.resume(item.playbackRemaining); },
      });
      inst.components.lootdropper ??= createStructureLootDropper(inst);
      const workable = inst.component('workable', () => {
        const work = new Workable(inst);
        work.SetWorkAction('HAMMER'); work.SetWorkLeft(1);
        return work;
      });
      inst.components.workable = workable;
      workable.SetOnFinishCallback(onhammered);
      return {
        ...visual,
        // The song deadline belongs to the machine, independently of sprite residency.
        active: undefined,
        model,
        getDefinition: () => controller.snapshot(),
        update(dt: number) { controller.update(dt); },
        dispose() { removeEvents(); visual.dispose(); },
      };
    },
  };
}
