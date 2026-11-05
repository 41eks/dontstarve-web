import { SpriteState } from '@dontstarve-web/display';
import { createEffect, createRenderEffect, watchSignal, WorldContentKey, type GameTimeScheduler, type GetWatchWorldContent } from '@dontstarve-web/signals';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { LunarHailBuildup } from '../../componets/src/pandoraschestSignatures';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { MakeObstaclePhysics } from './standardcomponents';
import { WORLD_SCALE } from './tile';
import { Transform } from './transform';

export const MONKEYPILLAR_ID = 'monkeypillar' as const;
/** A world save holds a number; tostring(math.random(1, 4)) makes a string. */
export const MONKEY_PILLAR_IDS = [1, 2, 3, 4, '1', '2', '3', '4'] as const;
export type MonkeyPillarId = typeof MONKEY_PILLAR_IDS[number];

export interface MonkeyPillarWorld {
  scheduler: GameTimeScheduler;
  getWatchWorldContent?: GetWatchWorldContent;
}

/** monkeypillar.lua fn. AnimState starts with no animation: the bank and build wait for setpillartype. */
export class MonkeyPillarInstance extends PrefabInstance {
  pillar_id?: MonkeyPillarId;
  _moveanim_trigger = false;
  _moveanim_task?: () => void;
  readonly world: MonkeyPillarWorld;

  constructor(world: MonkeyPillarWorld, position: ReadonlyVector3) {
    super(MONKEYPILLAR_ID, new SpriteState({ name: 'idle1', none: true, billboard: true }), Transform.stationary());
    this.world = world;
    this.setPosition(position.x, 0, position.z);
    this.addTag('blocker'); // MakeObstaclePhysics
    this.addTag('SnowCovered'); // MakeSnowCoveredPristine
    this.AddSoundEmitter();
    this.light.set({ intensity: .6, radius: 2.5 * WORLD_SCALE, falloff: .8, colour: [125 / 255, 125 / 255, 125 / 255] });
    this.sprite.setLightOverride(.25);

    // MakeSnowCovered, with weather.lua's SNOW_COVERED_THRESHOLD.
    let stopWatchingSnow: (() => void) | undefined;
    const snowLevel = world.getWatchWorldContent?.(WorldContentKey.SnowLevel, stop => { stopWatchingSnow = stop; });
    this.sprite.setSymbolOverride('snow', 'snow.zip', 'snow');
    const stopSnow = createRenderEffect(() => this.sprite.setSymbolHidden('snow', (snowLevel?.get() ?? 0) < .015));

    // Constructor-only dependencies: inspectable's tag is its source constructor's.
    this.addTag('inspectable');
    Object.assign(this.components, { inspectable: new Inspectable(this), lunarhailbuildup: new LunarHailBuildup(this) });

    queue_moveanim_task(this);
    this.OnSave = (_inst, data) => { if (this.pillar_id !== undefined) data.pillar_id = this.pillar_id; };
    this.OnLoad = (_inst, data) => { setpillartype(this, data.pillar_id); };

    // OnEntitySleep / OnEntityWake, and the undrawn sprite's animover: settling a clip while nothing is drawn holds the
    // chain, which resumes once the display has drawn the sprite again.
    let stopStatus: (() => void) | undefined;
    const status = watchSignal(this.status, stop => { stopStatus = stop; });
    const stopTask = createEffect(() => {
      const value = status.get();
      if (value === 'asleep') { this._moveanim_task?.(); this._moveanim_task = undefined; }
      else if (value === 'active' && !this._moveanim_task) queue_moveanim_task(this);
    });
    const stopChain = createEffect(() => {
      this.sprite.art.get();
      if (this.sprite.loaded && this.sprite.sprite.peek().clip.finished) OnAnimOver(this);
    });
    this.onRemove(() => {
      stopSnow(); stopWatchingSnow?.(); stopStatus?.(); stopTask(); stopChain();
      this._moveanim_task?.(); this._moveanim_task = undefined;
    });
  }
}

function queue_moveanim_task(inst: MonkeyPillarInstance): void {
  inst._moveanim_task = inst.world.scheduler.schedule(15 + 10 * Math.random(), () => {
    inst._moveanim_trigger = true;
    queue_moveanim_task(inst);
  });
}

function OnAnimOver(inst: MonkeyPillarInstance): void {
  // Nothing drawn has no animover; see the chain's effect in the constructor.
  if (!inst.sprite.loaded) return;
  const idlename = `idle${inst.pillar_id}`;
  if (inst._moveanim_trigger) {
    inst.sprite.playOnce(`${idlename}_move`, () => OnAnimOver(inst));
    inst._moveanim_trigger = false;
  } else inst.sprite.playOnce(idlename, () => OnAnimOver(inst));
}

function setpillartype(inst: MonkeyPillarInstance, index?: MonkeyPillarId): void {
  if (inst.pillar_id === undefined || (index !== undefined && inst.pillar_id !== index)) {
    inst.pillar_id = index ?? String(1 + Math.floor(Math.random() * 4)) as MonkeyPillarId;
    inst.sprite.playOnce(`idle${inst.pillar_id}`, () => OnAnimOver(inst));
    inst.sprite.setFrameAt(Math.random()); // SetFrame(math.random(GetCurrentAnimationNumFrames()) - 1).
  }
}

export function monkeyPillarPrefabs(world: MonkeyPillarWorld): Readonly<Record<typeof MONKEYPILLAR_ID, PrefabEntityDefinition<MonkeyPillarInstance>>> {
  return {
    [MONKEYPILLAR_ID]: {
      fn: position => new MonkeyPillarInstance(world, position),
      assets: { animationArchive: 'pillar_monkey.zip', buildArchives: ['pillar_monkey.zip', 'snow.zip'], bank: 'pillar_monkey', hiddenSymbols: ['snow'] },
      physics: { make: MakeObstaclePhysics, radius: .6, height: 24 },
      // not POPULATING: setpillartype(inst). A saved entity's OnLoad picked it already.
      onSpawned: inst => setpillartype(inst),
    },
  };
}
