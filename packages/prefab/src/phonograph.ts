import type * as THREE from 'three';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ComponentTimer } from '../../componets/src/timer';
import { createMemo } from '@dontstarve-web/signals';
import { createResidentGroundItem, GROUND_ITEM_DEFINITIONS } from './groundItems';
import type { GroundItemFactory, GroundPrefabContext, GroundItemDefinition } from './groundPrefab';
import { createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { ArchiveSpriteCommands } from '@dontstarve-web/display';
import { createArchiveEntity } from './prefabInstance';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { Workable } from '../../componets/src/workable';
import { Machine } from '../../componets/src/machine';
import { listenInventoryEvents } from './inventoryEvents';
import { PlaySound, PreloadSounds, type SoundHandle } from './sound';
import { RECORD_ID, RECORD_SONGS } from './records';

export const PHONOGRAPH_ID = 'phonograph';
export const PHONOGRAPH_PLAY_TIME = 64;
const END_SOUND = 'dontstarve/music/gramaphone_end';

/**
 * phonograph.lua: a ground-only `machine` whose turnon plays the loaded record (TryToPlayRecord) and whose turnoff
 * stops it (StopPlayingRecord). The record survives stopping, inventory transfers and reskins.
 */
export class PhonographController {
  private unboundRecord?: string;
  private entity?: ItemEntity;
  get record(): string | undefined { return this.entity ? this.entity.phonographRecord : this.unboundRecord; }
  set record(record: string | undefined) {
    if (this.entity) this.entity.phonographRecord = record;
    else this.unboundRecord = record;
  }
  private readonly scheduler: GameTimeScheduler;
  private readonly ownsScheduler: boolean;
  private readonly playback: ComponentTimer;
  readonly timer;
  private readonly playing;
  get remainingSeconds(): number { return this.playback.remainingSeconds ?? 0; }
  private sound?: SoundHandle;
  private disposed = false;
  private readonly sprite: Pick<ArchiveSpriteCommands, 'start' | 'playOnce'>;
  private readonly position: THREE.Vector3;

  constructor(sprite: Pick<ArchiveSpriteCommands, 'start' | 'playOnce'>,
    position: THREE.Vector3, record?: string, scheduler?: GameTimeScheduler) {
    this.sprite = sprite; this.position = position; this.record = record;
    this.ownsScheduler = scheduler === undefined;
    this.scheduler = scheduler ?? new GameTimeScheduler();
    // play_song's DoTaskInTime(PHONOGRAPH_PLAY_TIME, TurnOffMachine).
    this.playback = new ComponentTimer(this.scheduler, () => { if (this.machine) this.machine.TurnOff(); else this.stop(); });
    this.timer = this.playback.snapshot;
    this.playing = createMemo(() => this.timer.get().status === 'scheduled');
  }

  get isPlaying(): boolean { return this.playing.peek(); }

  /** The inst's machine; a reskin's new art takes over its turnon/turnoff. */
  get machine(): Machine | undefined { return this.entity?.components.machine; }

  bindEntity(entity: ItemEntity): void {
    this.entity = entity;
    let machine = entity.components.machine;
    if (!machine) {
      const scheduler = this.scheduler;
      machine = entity.components.machine = new Machine(entity, () => entity.components.perishable.scheduler ?? scheduler);
      machine.SetGroundOnlyMachine(true);
      machine.enabled = false;
    }
    machine.turnonfn = () => this.TryToPlayRecord();
    machine.turnofffn = () => this.stop();
  }

  /** OnGetItemFromPlayer: DropRecord, keep the new record, play "open", then turn the machine on. */
  insert(record: string): void {
    const machine = this.machine;
    if (!machine) throw new Error('A phonograph needs its inst to take a record');
    this.DropRecord();
    this.record = record;
    this.opening = true;
    if (!machine.IsOn()) machine.TurnOn();
    this.opening = false;
  }

  /** DropRecord: turn off and disable; the caller ejects the record itself. */
  DropRecord(): void {
    const machine = this.machine;
    if (!machine) return;
    if (machine.IsOn()) machine.TurnOff();
    machine.enabled = false;
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
    if (this.ownsScheduler) this.scheduler.dispose();
  }
}

export function createPhonographGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  const effects = new Set<ReturnType<typeof createArchiveEntity>>();
  const release = (effect: ReturnType<typeof createArchiveEntity>) => { effect.instance.remove(); effect.display.dispose(); };
  let disposed = false;
  return {
    itemIds: [PHONOGRAPH_ID],
    update(dt, quaternion) { for (const effect of effects) { effect.display.model.quaternion.copy(quaternion); effect.instance.sprite.update(dt); } },
    renderEntities: () => [...effects].map(({ display: { model } }) => ({ object: model, footPosition: model.position, cameraDepth: 0 })),
    dispose() { disposed = true; for (const effect of effects) release(effect); effects.clear(); },
    create(item) {
      void PreloadSounds(...Object.values(RECORD_SONGS), END_SOUND, 'dontstarve/common/destroy_smoke', 'dontstarve/common/destroy_wood');
      const { visual, instance, display } = createResidentGroundItem(context, item);
      const model = display.model, sprite = instance.sprite;
      for (const tag of ['structure', 'trader', 'recordplayer', 'furnituredecor', 'groundonlymachine']) instance.addTag(tag);
      const controller = new PhonographController(sprite, model.position, item.phonographRecord, context.scheduler);
      model.userData.phonograph = controller;
      const removeEvents = listenInventoryEvents(model, {
        onputininventory: () => controller.OnPutInInventory(),
        // Dropping a loaded machine enables it, but does not turn it on.
        ondropped: () => controller.OnDropped(),
        onload: () => { controller.OnDropped(); if (item.playbackRemaining) controller.resume(item.playbackRemaining); },
      });
      return {
        ...visual,
        // The song deadline belongs to the machine, independently of sprite residency.
        active: undefined,
        model,
        bindEntity(entity: ItemEntity) {
          controller.bindEntity(entity);
          const workable = entity.component('workable', () => {
            const work = new Workable(entity);
            work.SetWorkAction('HAMMER');
            work.SetWorkLeft(1);
            return work;
          });
          entity.components.workable = workable;
          workable.SetOnFinishCallback(() => {
            const position = model.position.clone();
            const loaded = controller.record;
            controller.DropRecord();
            if (loaded) {
              const skinId = loaded === RECORD_ID ? undefined : loaded;
              context.dropLoot?.([{ ...GROUND_ITEM_DEFINITIONS.record, itemId: RECORD_ID, count: 1, skinId }], position);
            }
            PlaySound('dontstarve/common/destroy_smoke', position);
            PlaySound('dontstarve/common/destroy_wood', position);
            const create = (clip: { name: string; loop: boolean }) => createSharedArchiveSprite(context.assets, {
              animationArchive: 'structure_collapse_fx.zip', buildArchives: ['structure_collapse_fx.zip'],
              bank: 'collapse', animation: clip.name, loop: clip.loop,
            });
            if (!disposed) {
              const effect = createArchiveEntity('collapse_small', { create }, { name: 'collapse_small' }, 'collapse_small');
              for (const tag of ['FX', 'NOCLICK']) effect.instance.addTag(tag);
              effect.instance.persists = false;
              effect.instance.position.copy(position); context.scene.add(effect.display.model); effects.add(effect);
              effect.instance.sprite.playOnce('collapse_small', () => { release(effect); effects.delete(effect); });
            }
            entity.remove();
          });
        },
        getDefinition: () => controller.snapshot(),
        update(dt: number) { controller.update(dt); visual.update?.(dt); },
        dispose() { removeEvents(); controller.dispose(); visual.dispose(); },
      };
    },
  };
}
