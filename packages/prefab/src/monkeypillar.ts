import { addComponent } from './components';
import { SpriteState } from '@dontstarve-web/display';
import {
  createEffect,
  createRenderEffect,
  watchSignal,
  WorldContentKey,
  type GameTimeScheduler,
  type GetWatchWorldContent,
} from '@dontstarve-web/signals';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { AnimState } from '../../componets/src/animstate';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { LunarHailBuildup } from '../../componets/src/pandoraschestSignatures';
import { animationLengths, animationTiming } from './animationTimings';
import { PrefabInstance, type EntityTask, type PrefabEntityDefinition } from './prefabInstance';
import { MakeObstaclePhysics } from './standardcomponents';
import { WORLD_SCALE } from './tile';

export const MONKEYPILLAR_ID = 'monkeypillar' as const;
/** A world save holds a number; tostring(math.random(1, 4)) makes a string. */
export const MONKEY_PILLAR_IDS = [1, 2, 3, 4, '1', '2', '3', '4'] as const;
/** The ids SetPillarType picks from: math.random(4) as the string the source saves. */
const PICKED_PILLAR_IDS = ['1', '2', '3', '4'] as const;
export type MonkeyPillarId = (typeof MONKEY_PILLAR_IDS)[number];

const ARCHIVE = 'pillar_monkey.zip';
/** pillar_monkey's idle clips, from the source anim.bin. */
const ANIMATION_LENGTHS = animationLengths(ARCHIVE);

export interface MonkeyPillarWorld {
  scheduler: GameTimeScheduler;
  getWatchWorldContent?: GetWatchWorldContent;
}

/** monkeypillar.lua fn. AnimState starts with no animation: the bank and build wait for setpillartype. */
export class MonkeyPillarInstance extends PrefabInstance {
  pillar_id?: MonkeyPillarId;
  _moveanim_trigger = false;
  _moveanim_task?: EntityTask;
  readonly world: MonkeyPillarWorld;
  /** inst.AnimState's playback: a clip ends after its source length in game time, whether or not its art is drawn. */
  readonly animstate: AnimState;

  constructor(world: MonkeyPillarWorld, position: ReadonlyVector3) {
    super(MONKEYPILLAR_ID, new SpriteState({ name: 'idle1', none: true, billboard: true }));
    this.world = world;
    this.BindScheduler(world.scheduler);
    this.animstate = new AnimState(world.scheduler, ANIMATION_LENGTHS, event => this.PushEvent(event));
    this.setPosition(position.x, 0, position.z);
    this.addTag('blocker'); // MakeObstaclePhysics
    this.addTag('SnowCovered'); // MakeSnowCoveredPristine
    this.AddSoundEmitter();
    this.light.set({
      intensity: 0.6,
      radius: 2.5 * WORLD_SCALE,
      falloff: 0.8,
      colour: [125 / 255, 125 / 255, 125 / 255],
    });
    this.sprite.setLightOverride(0.25);

    // MakeSnowCovered, with weather.lua's SNOW_COVERED_THRESHOLD.
    let stopWatchingSnow: (() => void) | undefined;
    const snowLevel = world.getWatchWorldContent?.(WorldContentKey.SnowLevel, stop => {
      stopWatchingSnow = stop;
    });
    this.sprite.setSymbolOverride('snow', 'snow.zip', 'snow');
    const stopSnow = createRenderEffect(() => this.sprite.setSymbolHidden('snow', (snowLevel?.get() ?? 0) < 0.015));

    // Constructor-only dependencies: inspectable's tag is its source constructor's.
    this.addTag('inspectable');
    addComponent(this, 'inspectable', Inspectable);
    addComponent(this, 'lunarhailbuildup', LunarHailBuildup);

    queue_moveanim_task(this);
    this.ListenForEvent('animover', OnAnimOver);
    this.OnSave = (_inst, data) => {
      if (this.pillar_id !== undefined) {
        data.pillar_id = this.pillar_id;
      }
    };
    this.OnLoad = (_inst, data) => {
      setpillartype(this, data.pillar_id);
    };

    // OnEntitySleep / OnEntityWake; the idle clip waits with the entity, as the move task does.
    let stopStatus: (() => void) | undefined;
    const status = watchSignal(this.status, stop => {
      stopStatus = stop;
    });
    const stopTask = createEffect(() => {
      const value = status.get();
      if (value === 'asleep') {
        this._moveanim_task?.Cancel();
        this._moveanim_task = undefined;
        this.animstate.pause();
      } else if (value === 'active') {
        this.animstate.resume();
        if (!this._moveanim_task) {
          queue_moveanim_task(this);
        }
      }
    });
    this.onRemove(() => {
      this.animstate.dispose();
      stopSnow();
      stopWatchingSnow?.();
      stopStatus?.();
      stopTask();
    });
  }
}

function queue_moveanim_task(inst: MonkeyPillarInstance): void {
  inst._moveanim_task = inst.DoTaskInTime(15 + 10 * Math.random(), set_moveanim_trigger);
}

function set_moveanim_trigger(inst: MonkeyPillarInstance): void {
  inst._moveanim_trigger = true;
  queue_moveanim_task(inst);
}

/** inst.AnimState:PlayAnimation(name): the logical clip, whose end is the animover, and the drawn one. */
function PlayAnimation(inst: MonkeyPillarInstance, name: string): void {
  inst.animstate.PlayAnimation(name);
  inst.sprite.playOnce(name);
}

function OnAnimOver(inst: MonkeyPillarInstance): void {
  const idlename = `idle${inst.pillar_id}`;
  if (inst._moveanim_trigger) {
    PlayAnimation(inst, `${idlename}_move`);
    inst._moveanim_trigger = false;
  } else {
    PlayAnimation(inst, idlename);
  }
}

function setpillartype(inst: MonkeyPillarInstance, index?: MonkeyPillarId): void {
  if (inst.pillar_id === undefined || (index !== undefined && inst.pillar_id !== index)) {
    inst.pillar_id = index ?? PICKED_PILLAR_IDS[Math.floor(Math.random() * PICKED_PILLAR_IDS.length)];
    const idlename = `idle${inst.pillar_id}`;
    PlayAnimation(inst, idlename);
    // SetFrame(math.random(GetCurrentAnimationNumFrames()) - 1), on the logical clip and the drawn one alike.
    const { frames, frameRate } = animationTiming(ARCHIVE, idlename),
      frame = Math.floor(Math.random() * frames);
    inst.animstate.SetTime(frame / frameRate);
    inst.sprite.setFrame(frame);
  }
}

export function monkeyPillarPrefabs(
  world: MonkeyPillarWorld,
): Readonly<Record<typeof MONKEYPILLAR_ID, PrefabEntityDefinition<MonkeyPillarInstance>>> {
  return {
    [MONKEYPILLAR_ID]: {
      fn: position => new MonkeyPillarInstance(world, position),
      assets: {
        animationArchive: 'pillar_monkey.zip',
        buildArchives: ['pillar_monkey.zip', 'snow.zip'],
        bank: 'pillar_monkey',
        hiddenSymbols: ['snow'],
      },
      physics: { make: MakeObstaclePhysics, radius: 0.6, height: 24 },
      // not POPULATING: setpillartype(inst). A saved entity's OnLoad picked it already.
      onSpawned: inst => setpillartype(inst),
    },
  };
}
