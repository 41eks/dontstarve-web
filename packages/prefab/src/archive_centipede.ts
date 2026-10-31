import { PrefabDisplayGroup } from '@dontstarve-web/display';
import type * as THREE from 'three';
import type { TileStateQuery } from '@dontstarve-web/signals';
import { ArchiveSpriteAssets, createSharedArchiveSprite } from '@dontstarve-web/animation/archiveSprite';
import type { ArchiveSpriteCommands, PrefabDisplay } from '@dontstarve-web/display';
import { Health, type HealthSaveData } from '../../componets/src/health';
import { Combat } from '../../componets/src/combat';
import { LootDropper } from '../../componets/src/lootdropper';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { createArchiveEntity, type PrefabInstance } from './prefabInstance';
import { actionEntity } from './actionEntity';
import { newEntityId } from './saveRecord';
import { watchTileActivity } from './tileActivity';
import { PlaySound } from './sound';
import type { DisplayDrivenPrefabManager, DisplayManagerWorld } from './manager';

export const ARCHIVE_CENTIPEDE_HUSK_ID = 'archive_centipede_husk' as const;
/** TUNING.ARCHIVE_CENTIPEDE.HUSK_HEALTH. */
export const ARCHIVE_CENTIPEDE_HUSK_HEALTH = 300;
const MED_THRESHOLD_DOWN = .66;
const LOW_THRESHOLD_DOWN = .33;
const MED_THRESHOLD_UP = .66;
const LOW_THRESHOLD_UP = .33;
const BOTTOM_THRESHOLD = .2;

/** The husk has no OnSave of its own; health:OnSave writes the current health. */
export interface ArchiveCentipedeHuskRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: { health?: { current: number; maximum: number } };
}
export interface ArchiveCentipedeHuskWorld extends DisplayManagerWorld { tickingarea?: TileStateQuery; scheduler: GameTimeScheduler }

interface Husk {
  instance: PrefabInstance<ArchiveSpriteCommands>;
  display: PrefabDisplay;
  health: Health;
  hauntable: Hauntable;
  /** inst.idle2task. */
  idle2task?: () => void;
  stopActivity: () => void;
  stopAttacked: () => void;
}

/**
 * archive_centipede.lua huskfn: the archive_centipede bank and build, a health bar whose percentage picks the idle
 * (full / med / low), regenerating one health per second, and an idle2 flourish every few seconds. The live
 * archive_centipede and the husk's `possess` revival are not ported: no power point exists to possess it.
 */
export class ArchiveCentipedeHuskManager implements DisplayDrivenPrefabManager<{ prefabId: typeof ARCHIVE_CENTIPEDE_HUSK_ID; record: ArchiveCentipedeHuskRecord }> {
  private readonly assets = new ArchiveSpriteAssets(ARCHIVE_CENTIPEDE_HUSK_ID);
  private readonly husks = new Map<THREE.Group, Husk>();
  private disposed = false;
  private readonly displays: PrefabDisplayGroup;
  private readonly world: ArchiveCentipedeHuskWorld;
  constructor(scene: THREE.Scene, world: ArchiveCentipedeHuskWorld) { this.displays = new PrefabDisplayGroup(scene); this.world = world; }

  spawn(position: THREE.Vector3, saved?: ArchiveCentipedeHuskRecord): THREE.Group {
    if (this.disposed) throw new Error('Archive centipede husks have been disposed');
    const { scheduler } = this.world;
    // huskfn: SetBank("archive_centipede"), SetBuild("archive_centipede_build"); every husk clip is in archive_centipede.zip.
    const entity = createArchiveEntity(ARCHIVE_CENTIPEDE_HUSK_ID, { create: clip => createSharedArchiveSprite(this.assets, {
      animationArchive: 'archive_centipede.zip', buildArchives: ['archive_centipede_build.zip'],
      bank: 'archive_centipede', animation: clip.name, loop: clip.loop,
    }, { instancedAnimations: 'all', name: ARCHIVE_CENTIPEDE_HUSK_ID }) }, { name: 'idle_full', billboard: true }, ARCHIVE_CENTIPEDE_HUSK_ID);
    const { instance, display } = entity, model = display.model, sprite = instance.sprite;
    instance.entityId = saved?.id ?? newEntityId();
    instance.position.copy(position); model.rotation.y = saved?.transform.rotationY ?? 0;
    // PlayAnimation("idle_full") without a loop argument.
    sprite.playOnce('idle_full');
    instance.addTag('security_powerpoint'); instance.addTag('mech'); instance.addTag('electricdamageimmune');

    const inst = actionEntity(model, ARCHIVE_CENTIPEDE_HUSK_ID);
    const lootdropper = new LootDropper(inst, () => undefined);
    const health = new Health(ARCHIVE_CENTIPEDE_HUSK_HEALTH, instance, scheduler);
    const combat = () => new Combat(instance, () => scheduler.now);
    const play = (first: string, ...queued: string[]) => {
      sprite.playOnce(first);
      for (const name of queued) sprite.pushAnimation(name);
    };
    health.ondelta = (_inst, oldpercent, newpercent) => {
      if (newpercent < oldpercent) {
        if (oldpercent >= MED_THRESHOLD_DOWN && newpercent < MED_THRESHOLD_DOWN && newpercent >= LOW_THRESHOLD_DOWN) {
          play('idle_med'); instance.removeTag('gestalt_possessable');
        } else if (oldpercent >= MED_THRESHOLD_DOWN && newpercent < LOW_THRESHOLD_DOWN) {
          play('idle_low'); instance.removeTag('gestalt_possessable');
        } else if (oldpercent < MED_THRESHOLD_DOWN && oldpercent >= LOW_THRESHOLD_DOWN && newpercent < LOW_THRESHOLD_DOWN) {
          play('idle_low'); instance.removeTag('gestalt_possessable');
        }
      } else if (oldpercent < LOW_THRESHOLD_UP && newpercent >= LOW_THRESHOLD_UP && newpercent < MED_THRESHOLD_UP) {
        play('low_to_med', 'idle_med');
        PlaySound('grotto/creatures/centipede/low_to_med', instance.position);
      } else if (oldpercent < LOW_THRESHOLD_UP && newpercent >= MED_THRESHOLD_UP) {
        play('low_to_med', 'med_to_full', 'idle_full');
        PlaySound('grotto/creatures/centipede/low_to_med', instance.position);
        instance.addTag('gestalt_possessable');
      } else if (oldpercent < MED_THRESHOLD_UP && oldpercent >= LOW_THRESHOLD_UP && newpercent >= MED_THRESHOLD_UP) {
        play('med_to_full', 'idle_full');
        PlaySound('grotto/creatures/centipede/med_to_full', instance.position);
        instance.addTag('gestalt_possessable');
      }
      if (newpercent < BOTTOM_THRESHOLD) {
        // inst:RemoveComponent("combat"), then the floor at 15%.
        delete instance.components.combat;
        if (newpercent < BOTTOM_THRESHOLD - .05) health.SetPercent(BOTTOM_THRESHOLD - .05);
      } else instance.components.combat ??= combat();
    };
    health.StartRegen(1, 1);
    health.nofadeout = true;
    const hauntable = new Hauntable({ addTag: tag => instance.addTag(tag), removeTag: tag => instance.removeTag(tag),
      PushEvent: (name, data) => instance.PushEvent(name, data) }, scheduler);
    // MakeHauntableWork: its work attempt is commented out (#HAUNTFIX), so a haunt does nothing.
    hauntable.SetOnHauntFn(() => false);
    Object.assign(instance.components, { lootdropper, health, inspectable: new Inspectable(inst), combat: combat(), hauntable });

    // OnAttacked: a hit clip for the current health band, unless a recovery clip is playing.
    const onAttacked = () => {
      const current = sprite.currentAnimation;
      if (current === 'low_to_med' || current === 'med_to_full') return;
      const percent = health.GetPercent();
      if (percent < LOW_THRESHOLD_DOWN) play('low_hit', 'idle_low');
      else if (percent < MED_THRESHOLD_DOWN) play('med_hit', 'idle_med');
      else play('full_hit', 'idle_full');
    };
    const events = model as unknown as THREE.EventDispatcher<{ attacked: object }>;
    events.addEventListener('attacked', onAttacked);

    const husk: Husk = { instance, display, health, hauntable,
      stopActivity: watchTileActivity(model, this.world.tickingarea, active => instance.setActive(active)),
      stopAttacked: () => events.removeEventListener('attacked', onAttacked) };
    const playidle2 = () => {
      husk.idle2task?.(); husk.idle2task = undefined;
      const current = sprite.currentAnimation;
      if (current === 'idle_full' || current === 'idle_med' || current === 'idle_low') {
        PlaySound('grotto/creatures/centipede/electricity/idle2', instance.position);
        const percent = health.GetPercent();
        if (percent < LOW_THRESHOLD_DOWN) play('idle2_low', 'idle_low');
        else if (percent < MED_THRESHOLD_DOWN) play('idle2_med', 'idle_med');
        else play('idle2_full', 'idle_full');
      }
      husk.idle2task = scheduler.schedule(Math.random() * 10 + 8, playidle2);
    };
    husk.idle2task = scheduler.schedule(Math.random() * 3 + 3, playidle2);

    // health:OnLoad: SetVal(data.health, "file_load") then ForceUpdateHUD(true), whose DoDelta(0) reaches ondelta with
    // equal percentages: no clip changes, but combat is removed below the bottom threshold.
    const savedHealth = saved?.components.health;
    if (savedHealth) {
      health.OnLoad({ health: savedHealth.current, maxhealth: savedHealth.maximum });
      health.ForceUpdateHUD(true);
    }
    instance.onRemove(() => this.release(model));
    this.husks.set(model, husk); this.displays.mount(display); this.world.trackDisplay(display);
    return model;
  }

  get renderEntities() { return [...this.husks].filter(([, husk]) => husk.instance.sprite.loaded)
    .map(([object]) => ({ object, footPosition: object.position, cameraDepth: 0 })); }

  exportRecords(): { prefabId: typeof ARCHIVE_CENTIPEDE_HUSK_ID; record: ArchiveCentipedeHuskRecord }[] {
    return [...this.husks].filter(([, husk]) => husk.instance.persists).map(([model, husk]) => {
      const saved: HealthSaveData = husk.health.OnSave();
      return { prefabId: ARCHIVE_CENTIPEDE_HUSK_ID, record: {
        id: String(husk.instance.entityId),
        transform: { position: [model.position.x, model.position.y, model.position.z], rotationY: model.rotation.y },
        components: { health: { current: saved.health, maximum: saved.maxhealth } },
      } };
    });
  }

  private release(model: THREE.Group): void {
    const husk = this.husks.get(model);
    if (!husk) return;
    this.husks.delete(model);
    husk.idle2task?.(); husk.stopActivity(); husk.stopAttacked();
    husk.health.dispose(); husk.hauntable.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const husk of [...this.husks.values()]) husk.instance.remove();
    this.husks.clear(); this.displays.dispose(); this.assets.dispose();
  }
}
