import { SpriteState } from '@dontstarve-web/display';
import { Health } from '../../componets/src/health';
import { Combat } from '../../componets/src/combat';
import { LootDropper } from '../../componets/src/lootdropper';
import { Hauntable } from '../../componets/src/hauntable';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { PlacementSaveRecord } from './saveRecord';
import { PlaySound } from './sound';

export const ARCHIVE_CENTIPEDE_HUSK_ID = 'archive_centipede_husk' as const;
/** TUNING.ARCHIVE_CENTIPEDE.HUSK_HEALTH. */
export const ARCHIVE_CENTIPEDE_HUSK_HEALTH = 300;
const MED_THRESHOLD_DOWN = .66;
const LOW_THRESHOLD_DOWN = .33;
const MED_THRESHOLD_UP = .66;
const LOW_THRESHOLD_UP = .33;
const BOTTOM_THRESHOLD = .2;

export interface ArchiveCentipedeHuskWorld { scheduler: GameTimeScheduler }

/**
 * archive_centipede.lua huskfn: the archive_centipede bank and build, a health bar whose percentage picks the idle
 * (full / med / low), regenerating one health per second, and an idle2 flourish every few seconds. The live
 * archive_centipede and the husk's `possess` revival are not ported: no power point exists to possess it.
 */
export class ArchiveCentipedeHuskInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & {
    lootdropper: LootDropper; health: Health; inspectable: Inspectable; hauntable: Hauntable; combat?: Combat;
  };
  /** inst.idle2task. */
  private idle2task?: () => void;
  private readonly world: ArchiveCentipedeHuskWorld;

  constructor(world: ArchiveCentipedeHuskWorld) {
    super(ARCHIVE_CENTIPEDE_HUSK_ID, new SpriteState({ name: 'idle_full', billboard: true }));
    this.world = world;
    // PlayAnimation("idle_full") without a loop argument.
    this.sprite.playOnce('idle_full');
    const { scheduler } = world;
    for (const tag of ['security_powerpoint', 'mech', 'electricdamageimmune']) this.addTag(tag);

    const health = new Health(ARCHIVE_CENTIPEDE_HUSK_HEALTH, this, scheduler);
    health.ondelta = (_inst, oldpercent, newpercent) => this.OnHealthDelta(oldpercent, newpercent);
    health.StartRegen(1, 1);
    health.nofadeout = true;
    const hauntable = new Hauntable({ addTag: tag => this.addTag(tag), removeTag: tag => this.removeTag(tag),
      PushEvent: (name, data) => this.PushEvent(name, data) }, scheduler);
    // MakeHauntableWork: its work attempt is commented out (#HAUNTFIX), so a haunt does nothing.
    hauntable.SetOnHauntFn(() => false);
    Object.assign(this.components, { lootdropper: new LootDropper(this, () => undefined), health,
      inspectable: new Inspectable(this), combat: this.createCombat(), hauntable });

    const stopAttacked = this.ListenForEvent('attacked', () => this.OnAttacked());
    this.idle2task = scheduler.schedule(Math.random() * 3 + 3, () => this.playidle2());
    this.onRemove(() => {
      this.idle2task?.(); this.idle2task = undefined;
      stopAttacked();
      health.dispose(); hauntable.dispose();
    });
  }

  private createCombat(): Combat { return new Combat(this, () => this.world.scheduler.now); }

  /** AnimState:PlayAnimation(first) and PushAnimation of the rest. */
  private play(first: string, ...queued: string[]): void {
    this.sprite.playOnce(first);
    for (const name of queued) this.sprite.pushAnimation(name);
  }

  /** OnHealthDelta: the idle of the band health crosses into, and combat only above the bottom threshold. */
  private OnHealthDelta(oldpercent: number, newpercent: number): void {
    if (newpercent < oldpercent) {
      if (oldpercent >= MED_THRESHOLD_DOWN && newpercent < MED_THRESHOLD_DOWN && newpercent >= LOW_THRESHOLD_DOWN) {
        this.play('idle_med'); this.removeTag('gestalt_possessable');
      } else if (oldpercent >= MED_THRESHOLD_DOWN && newpercent < LOW_THRESHOLD_DOWN) {
        this.play('idle_low'); this.removeTag('gestalt_possessable');
      } else if (oldpercent < MED_THRESHOLD_DOWN && oldpercent >= LOW_THRESHOLD_DOWN && newpercent < LOW_THRESHOLD_DOWN) {
        this.play('idle_low'); this.removeTag('gestalt_possessable');
      }
    } else if (oldpercent < LOW_THRESHOLD_UP && newpercent >= LOW_THRESHOLD_UP && newpercent < MED_THRESHOLD_UP) {
      this.play('low_to_med', 'idle_med');
      PlaySound('grotto/creatures/centipede/low_to_med', this.position);
    } else if (oldpercent < LOW_THRESHOLD_UP && newpercent >= MED_THRESHOLD_UP) {
      this.play('low_to_med', 'med_to_full', 'idle_full');
      PlaySound('grotto/creatures/centipede/low_to_med', this.position);
      this.addTag('gestalt_possessable');
    } else if (oldpercent < MED_THRESHOLD_UP && oldpercent >= LOW_THRESHOLD_UP && newpercent >= MED_THRESHOLD_UP) {
      this.play('med_to_full', 'idle_full');
      PlaySound('grotto/creatures/centipede/med_to_full', this.position);
      this.addTag('gestalt_possessable');
    }
    if (newpercent < BOTTOM_THRESHOLD) {
      // inst:RemoveComponent("combat"), then the floor at 15%.
      delete this.components.combat;
      if (newpercent < BOTTOM_THRESHOLD - .05) this.components.health.SetPercent(BOTTOM_THRESHOLD - .05);
    } else this.components.combat ??= this.createCombat();
  }

  /** OnAttacked: a hit clip for the current health band, unless a recovery clip is playing. */
  private OnAttacked(): void {
    const current = this.sprite.currentAnimation;
    if (current === 'low_to_med' || current === 'med_to_full') return;
    const percent = this.components.health.GetPercent();
    if (percent < LOW_THRESHOLD_DOWN) this.play('low_hit', 'idle_low');
    else if (percent < MED_THRESHOLD_DOWN) this.play('med_hit', 'idle_med');
    else this.play('full_hit', 'idle_full');
  }

  /** playidle2: an idle2 flourish for the band while idling, then again 8–18 seconds later. */
  private playidle2(): void {
    this.idle2task = undefined;
    const current = this.sprite.currentAnimation;
    if (current === 'idle_full' || current === 'idle_med' || current === 'idle_low') {
      PlaySound('grotto/creatures/centipede/electricity/idle2', this.position);
      const percent = this.components.health.GetPercent();
      if (percent < LOW_THRESHOLD_DOWN) this.play('idle2_low', 'idle_low');
      else if (percent < MED_THRESHOLD_DOWN) this.play('idle2_med', 'idle_med');
      else this.play('idle2_full', 'idle_full');
    }
    this.idle2task = this.world.scheduler.schedule(Math.random() * 10 + 8, () => this.playidle2());
  }

  /** huskfn has no OnSave; health:OnSave writes the current health, kept as the record's `{ current, maximum }`. */
  OnSave(_inst: unknown, data: PlacementSaveRecord['components']): void {
    const { health } = this.components;
    data.health = { current: health.currenthealth, maximum: health.maxhealth };
  }

  /**
   * health:OnLoad: SetVal(data.health, "file_load") then ForceUpdateHUD(true), whose DoDelta(0) reaches OnHealthDelta
   * with equal percentages: no clip changes, but combat is removed below the bottom threshold.
   */
  OnLoad(_inst: unknown, data: PlacementSaveRecord['components']): void {
    const saved = data.health;
    if (!saved) return;
    this.components.health.OnLoad({ health: saved.current, maxhealth: saved.maximum });
    this.components.health.ForceUpdateHUD(true);
  }
}

/** The Prefab archive_centipede.lua returns for the husk. */
export function archiveCentipedeHuskPrefabs(world: ArchiveCentipedeHuskWorld):
  Readonly<Record<typeof ARCHIVE_CENTIPEDE_HUSK_ID, PrefabEntityDefinition<ArchiveCentipedeHuskInstance>>> {
  return {
    [ARCHIVE_CENTIPEDE_HUSK_ID]: {
      fn: () => new ArchiveCentipedeHuskInstance(world),
      // huskfn: SetBank("archive_centipede"), SetBuild("archive_centipede_build"); every husk clip is in archive_centipede.zip.
      assets: { animationArchive: 'archive_centipede.zip', buildArchives: ['archive_centipede_build.zip'], bank: 'archive_centipede' },
      assetOptions: { instancedAnimations: 'all' },
    },
  };
}
