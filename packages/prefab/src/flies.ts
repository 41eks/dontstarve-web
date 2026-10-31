import type { Vector3 } from 'three';
import type { ArchiveSpriteCommands } from '@dontstarve-web/display';
import type { PrefabInstance } from './prefabInstance';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ComponentTimer } from '../../componets/src/timer';
import { PlayerProx } from '../../componets/src/playerprox';
import { PlaySound, type SoundHandle } from './sound';
import { WORLD_SCALE } from './standardcomponents';
import type { GetWatchWorldContent } from '@dontstarve-web/signals';

export const FLIES_SOUND = 'dontstarve/common/flies';

/**
 * flies.lua: a NOCLICK/DECOR child with independent proximity, animation and looping audio. The owner draws the entity
 * and keeps its pickup target clear of the swarm's art.
 */
export class FliesController {
  readonly playerprox: PlayerProx;
  private readonly init: ComponentTimer;
  private readonly sprite: ArchiveSpriteCommands;
  private readonly position: Vector3;
  private sound?: SoundHandle;
  private asleep = false;
  private disposed = false;
  private animationRevision = 0;

  constructor(instance: PrefabInstance<ArchiveSpriteCommands>, position: Vector3, scheduler: GameTimeScheduler,
    getWatchWorldContent?: GetWatchWorldContent) {
    const sprite = this.sprite = instance.sprite; this.position = position;
    sprite.setVisible(true);
    for (const tag of ['NOCLICK', 'DECOR']) instance.addTag(tag);
    this.playerprox = new PlayerProx({ isValid: () => !this.disposed, getPosition: () => position }, getWatchWorldContent);
    this.playerprox.SetDist(2 * WORLD_SCALE, 3 * WORLD_SCALE);
    this.playerprox.SetOnPlayerNear(() => {
      this.stopSound();
      this.animationRevision++;
      sprite.playOnce('swarm_pst');
    });
    this.playerprox.SetOnPlayerFar(() => {
      if (!this.asleep) this.startSound();
      this.swarm();
    });
    this.swarm();
    this.init = new ComponentTimer(scheduler, () => {
      this.playerprox.ForceUpdate();
      if (!this.asleep && !this.playerprox.IsPlayerClose()) this.startSound();
    });
    this.init.start(0);
  }

  get initTimerState() { return this.init.snapshot; }

  private swarm(): void {
    const revision = ++this.animationRevision;
    this.sprite.playOnce('swarm_pre', () => {
      if (!this.disposed && revision === this.animationRevision) this.sprite.start('swarm_loop');
    });
  }
  private startSound(): void {
    // onfar during ForceUpdate and OnWake can coincide; named "flies" owns one source.
    this.stopSound();
    this.sound = PlaySound(FLIES_SOUND, this.position);
  }
  private stopSound(): void { this.sound?.stop(); this.sound = undefined; }
  OnEntityWake(): void {
    if (this.disposed) return;
    this.asleep = false;
    this.playerprox.OnEntityWake();
    if (!this.playerprox.IsPlayerClose() && !this.sound) this.startSound();
  }
  OnEntitySleep(): void {
    if (this.disposed) return;
    this.asleep = true;
    this.playerprox.OnEntitySleep();
    this.stopSound();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.animationRevision++;
    this.init.stop(); this.playerprox.dispose(); this.stopSound();
    // The owning prefab retains the entity until its visual is disposed.
    this.sprite.setVisible(false);
  }
}
