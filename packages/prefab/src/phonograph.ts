import type * as THREE from 'three';
import { createGroundItemSprite } from './groundItems';
import type { GroundItemFactory, GroundPrefabContext, GroundItemDefinition } from './groundPrefab';
import type { ArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import { listenInventoryEvents } from './inventoryEvents';
import { PlaySound, PreloadSounds, type SoundHandle, type SoundEventPath } from './sound';

export const PHONOGRAPH_ID = 'phonograph';
export const RECORD_ID = 'record';
export const PHONOGRAPH_PLAY_TIME = 64;
// records.lua's default song and skinprefabs.lua's record_init_fn track overrides.
export const RECORD_SONGS: Readonly<Record<string, SoundEventPath>> = {
  record: 'dontstarve/music/gramaphone_ragtime',
  record_creepyforest: 'dontstarve/music/gramaphone_creepyforest',
  record_drstyle: 'dontstarve/music/gramaphone_drstyle',
  record_efs: 'dontstarve/music/gramaphone_efs',
  record_hallowednights: 'dontstarve/music/gramaphone_hallowednights',
};
const END_SOUND = 'dontstarve/music/gramaphone_end';

/** Ground-only machine: its record survives stopping, inventory transfers and reskins. */
export class PhonographController {
  record?: string;
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
  return {
    itemIds: [PHONOGRAPH_ID],
    async create(item) {
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
        getDefinition: () => controller.snapshot(),
        update(dt: number) { controller.update(dt); sprite.update(dt); },
        dispose() { removeEvents(); controller.dispose(); sprite.dispose(); },
      };
    },
  };
}
