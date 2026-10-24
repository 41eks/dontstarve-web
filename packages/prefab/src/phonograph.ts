import type * as THREE from 'three';
import { createGroundItemSprite, GROUND_ITEM_DEFINITIONS } from './groundItems';
import type { GroundItemFactory, GroundPrefabContext, GroundItemDefinition } from './groundPrefab';
import { createArchiveSprite, type ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { Workable } from '../../componets/src/workable';
import { listenInventoryEvents } from './inventoryEvents';
import { PlaySound, PreloadSounds, type SoundHandle } from './sound';
import { RECORD_ID, RECORD_SONGS } from './records';

export const PHONOGRAPH_ID = 'phonograph';
export const PHONOGRAPH_PLAY_TIME = 64;
const END_SOUND = 'dontstarve/music/gramaphone_end';

/** Ground-only machine: its record survives stopping, inventory transfers and reskins. */
export class PhonographController {
  private unboundRecord?: string;
  private entity?: ItemEntity;
  get record(): string | undefined { return this.entity ? this.entity.phonographRecord : this.unboundRecord; }
  set record(record: string | undefined) {
    if (this.entity) this.entity.phonographRecord = record;
    else this.unboundRecord = record;
  }
  remainingSeconds = 0;
  private sound?: SoundHandle;
  private disposed = false;
  private readonly sprite: Pick<ArchiveSprite, 'start' | 'playOnce' | 'setAnimation'>;
  private readonly position: THREE.Vector3;

  constructor(sprite: Pick<ArchiveSprite, 'start' | 'playOnce' | 'setAnimation'>,
    position: THREE.Vector3, record?: string) {
    this.sprite = sprite; this.position = position; this.record = record;
  }

  get isPlaying(): boolean { return this.remainingSeconds > 0; }

  bindEntity(entity: ItemEntity): void {
    this.entity = entity;
  }

  insert(record: string): void {
    this.stop();
    this.record = record;
    this.play(PHONOGRAPH_PLAY_TIME, true);
  }

  play(seconds = PHONOGRAPH_PLAY_TIME, open = false): boolean {
    if (this.disposed || !this.record || !Object.hasOwn(RECORD_SONGS, this.record)
      || !Number.isFinite(seconds) || seconds <= 0 || seconds > PHONOGRAPH_PLAY_TIME) return false;
    this.sound?.stop();
    this.remainingSeconds = seconds;
    this.sound = PlaySound(RECORD_SONGS[this.record], this.position, PHONOGRAPH_PLAY_TIME - seconds);
    if (open) this.sprite.playOnce('open', () => { if (this.isPlaying) this.sprite.start('play_loop'); });
    else this.sprite.start('play_loop');
    return true;
  }

  stop(playEnd = true): void {
    const wasPlaying = this.isPlaying;
    this.sound?.stop(); this.sound = undefined;
    this.remainingSeconds = 0;
    this.sprite.setAnimation('idle');
    if (wasPlaying && playEnd) PlaySound(END_SOUND, this.position);
  }

  update(dt: number): void {
    if (Number.isFinite(dt) && dt > 0 && this.isPlaying) {
      if (dt + 1e-8 >= this.remainingSeconds) this.stop();
      else this.remainingSeconds -= dt;
    }
  }

  snapshot(): Pick<GroundItemDefinition, 'phonographRecord' | 'playbackRemaining'> {
    return { phonographRecord: this.record, playbackRemaining: this.isPlaying ? this.remainingSeconds : undefined };
  }

  dispose(): void { this.stop(false); this.disposed = true; }
}

export function createPhonographGroundFactory(context: GroundPrefabContext): GroundItemFactory {
  const effects = new Set<ArchiveSprite>();
  let disposed = false;
  return {
    itemIds: [PHONOGRAPH_ID],
    update(dt, quaternion) { for (const effect of effects) { effect.model.quaternion.copy(quaternion); effect.update(dt); } },
    renderEntities: () => [...effects].map(effect => ({ object: effect.model, footPosition: effect.model.position, cameraDepth: 0 })),
    dispose() { disposed = true; for (const effect of effects) effect.dispose(); effects.clear(); },
    async create(item) {
      await Promise.all([context.assets.loadAnimation('structure_collapse_fx.zip'), context.assets.loadBuild('structure_collapse_fx.zip')]);
      await PreloadSounds(...Object.values(RECORD_SONGS), END_SOUND,
        'dontstarve/common/destroy_smoke', 'dontstarve/common/destroy_wood');
      const sprite = await createGroundItemSprite(context.assets, PHONOGRAPH_ID, item.skinId);
      const controller = new PhonographController(sprite, sprite.model.position, item.phonographRecord);
      sprite.model.userData.phonograph = controller;
      const removeEvents = listenInventoryEvents(sprite.model, {
        onputininventory: () => controller.stop(),
        // Dropping a loaded machine enables it, but does not turn it on.
        onload: () => { if (item.playbackRemaining) controller.play(item.playbackRemaining); },
      });
      return {
        model: sprite.model,
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
            const position = sprite.model.position.clone();
            const loaded = controller.record;
            controller.stop();
            if (loaded) {
              const skinId = loaded === RECORD_ID ? undefined : loaded;
              void context.dropLoot?.([{ ...GROUND_ITEM_DEFINITIONS.record, itemId: RECORD_ID, count: 1, skinId }], position)
                .catch((error: unknown) => console.error('Unable to drop record', error));
            }
            PlaySound('dontstarve/common/destroy_smoke', position);
            PlaySound('dontstarve/common/destroy_wood', position);
            void createArchiveSprite(context.assets, {
              animationArchive: 'structure_collapse_fx.zip', buildArchives: ['structure_collapse_fx.zip'],
              bank: 'collapse', animation: 'collapse_small', loop: false,
            }).then(effect => {
              if (disposed) { effect.dispose(); return; }
              effect.model.position.copy(position); context.scene.add(effect.model); effects.add(effect);
              effect.playOnce('collapse_small', () => { effect.dispose(); effects.delete(effect); });
            }).catch((error: unknown) => console.error('Unable to play collapse effect', error));
            entity.remove();
          });
        },
        getDefinition: () => controller.snapshot(),
        update(dt: number) { controller.update(dt); sprite.update(dt); },
        dispose() { removeEvents(); controller.dispose(); sprite.dispose(); },
      };
    },
  };
}
