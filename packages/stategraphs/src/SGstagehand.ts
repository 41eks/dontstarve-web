import type { WorldPhase } from '@dontstarve-web/signals';
import type { AnimState } from '../../componets/src/animstate';
import type { Burnable } from '../../componets/src/burnable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import type { LocoMotor } from '../../componets/src/locomotor';
import type { LootDropper } from '../../componets/src/lootdropper';
import { COLLISION, type PhysicsState } from '../../componets/src/physicsState';
import type { Workable } from '../../componets/src/workable';
import { STAGEHAND_CONFIG as CONFIG } from '../../prefab/src/generated/stagehand.schema';
import type { ArchiveSpriteCommands } from '../../display/src/spriteState';
import type { SoundEmitter } from '../../prefab/src/soundEmitter';
import type { ReadonlyVector3 } from '../../prefab/src/transform';
import { EventHandler, FRAMES, State, StateGraphInstance, TimeEvent } from './stategraph';

type Name =
  | 'initialstate'
  | 'death'
  | 'idle'
  | 'idle_hiding'
  | 'hide'
  | 'standup'
  | 'hit'
  | 'extinguish'
  | 'giveup'
  | 'walk_start'
  | 'walk'
  | 'walk_stop';

export interface StagehandStateInst {
  readonly position: ReadonlyVector3;
  readonly sprite: ArchiveSpriteCommands;
  readonly physics: PhysicsState;
  readonly animstate: AnimState;
  readonly SoundEmitter: SoundEmitter;
  readonly sounds: typeof CONFIG.sounds;
  readonly phase: WorldPhase;
  readonly components: {
    locomotor: LocoMotor;
    burnable: Burnable;
    workable: Pick<Workable, 'SetWorkable'>;
    lootdropper: LootDropper;
  };
  CanStandUp(inst: this): boolean;
  ChangePhysics(inst: this, standing: boolean): void;
  setMotorSpeed(speed: number): void;
  collapseAt(position: ReadonlyVector3): void;
  remove(): void;
}

const { clips } = CONFIG;
type Graph = StateGraphInstance<StagehandStateInst, Name>;
type Sound = keyof typeof CONFIG.sounds;

function play(inst: StagehandStateInst, clip: keyof typeof clips, loop = false): void {
  const { name } = clips[clip];
  inst.animstate.PlayAnimation(name, loop);
  if (loop) {
    inst.sprite.start(name);
  } else {
    inst.sprite.playOnce(name);
  }
}

function sound(sg: Graph, event: Sound): void {
  sg.context.SoundEmitter.PlaySound(sg.context.sounds[event]);
}

function sounds(event: Sound, ...frames: number[]) {
  return frames.map(frame => TimeEvent<StagehandStateInst, Name>(frame * FRAMES, sg => sound(sg, event)));
}

const onIdle = EventHandler<StagehandStateInst, Name>('animover', sg => sg.goToState('idle'));
const onQueueIdle = EventHandler<StagehandStateInst, Name>('animqueueover', sg => sg.goToState('idle'));
const state = State<StagehandStateInst, Name>;

/** SGstagehand.lua, with the default branch of CommonStates.AddWalkStates. */
export function StagehandStateGraph(inst: StagehandStateInst, scheduler: GameTimeScheduler): Graph {
  const mem = {
    is_hiding: true,
    prevtimeworked: undefined as number | undefined,
    hits_left: CONFIG.workable.workLeft as number,
  };

  function OnHide(): void {
    inst.components.locomotor.StopMoving();
    inst.setMotorSpeed(0);
    mem.is_hiding = true;
    inst.ChangePhysics(inst, false);
  }

  function giveupEvent(frame: number, afterHide: boolean, fn: (sg: Graph) => void) {
    return TimeEvent<StagehandStateInst, Name>(frame * FRAMES, sg => {
      if ((sg.statemem.hide_delay === true) === afterHide) {
        fn(sg);
      }
    });
  }

  const states = [
    state({
      name: 'initialstate',
      onenter: sg => {
        mem.is_hiding = true;
        inst.ChangePhysics(inst, false);
        sg.goToState('idle_hiding');
      },
    }),
    state({
      name: 'death',
      tags: ['busy'],
      onenter: () => {
        inst.setMotorSpeed(0);
        // standardcomponents.lua RemovePhysicsColliders preserves the ground mask of a moving body.
        if (inst.physics.GetMass() > 0) {
          inst.physics.SetCollisionMask(COLLISION.GROUND);
        } else {
          inst.physics.ClearCollisionMask();
        }
        const position = inst.position;
        inst.components.lootdropper.DropLoot(position);
        inst.remove();
        inst.collapseAt(position);
      },
    }),
    state({
      name: 'idle',
      tags: ['idle', 'canrotate'],
      onenter: sg => {
        if (inst.components.burnable.IsBurning()) {
          sg.goToState('extinguish');
        } else if (!(inst.CanStandUp(inst) || inst.components.locomotor.WantsToMoveForward())) {
          sg.goToState('idle_hiding');
        } else if (mem.is_hiding) {
          sg.goToState('standup');
        } else {
          inst.setMotorSpeed(0);
          play(inst, clips.awake_idle.name);
        }
      },
      events: [onIdle],
    }),
    state({
      name: 'idle_hiding',
      tags: ['idle', 'hiding'],
      onenter: sg => {
        if (!mem.is_hiding) {
          sg.goToState('hide');
          return;
        }
        inst.setMotorSpeed(0);
        const threshold = inst.phase === 'dusk' ? 0.02 : inst.phase === 'night' ? 0.2 : 0;
        const chance = threshold > 0 ? Math.random() : 1;
        play(
          inst,
          chance < threshold
            ? clips.peeking_idle_loop_01.name
            : chance < threshold * 2
              ? clips.peeking_idle_loop_02.name
              : clips.idle_loop_01.name,
        );
      },
      events: [onIdle],
    }),
    state({
      name: 'hide',
      tags: ['busy'],
      onenter: () => {
        OnHide();
        play(inst, clips.sleep.name);
      },
      timeline: [...sounds('awake_pre', 10), ...sounds('hit', 15)],
      events: [onIdle],
    }),
    state({
      name: 'standup',
      tags: ['busy'],
      onenter: () => {
        inst.setMotorSpeed(0);
        play(inst, clips.awake_pre.name);
      },
      timeline: [...sounds('hit', 2), ...sounds('awake_pre', 11), ...sounds('footstep', 12, 22)],
      events: [
        EventHandler('animover', sg => {
          mem.is_hiding = false;
          inst.ChangePhysics(inst, true);
          sg.goToState(inst.components.locomotor.WantsToMoveForward() ? 'walk_start' : 'idle');
        }),
      ],
    }),
    state({
      name: 'hit',
      tags: ['busy'],
      onenter: sg => {
        inst.setMotorSpeed(0);
        play(inst, mem.is_hiding ? clips.hit.name : clips.awake_hit.name);
        sound(sg, 'hit');
      },
      timeline: [0, 3].map(frame =>
        TimeEvent<StagehandStateInst, Name>(frame * FRAMES, sg => {
          if (mem.is_hiding === (frame === 3)) {
            sound(sg, 'hit');
          }
        }),
      ),
      events: [onIdle],
    }),
    state({
      name: 'extinguish',
      tags: ['busy'],
      onenter: sg => {
        if (!mem.is_hiding) {
          sg.goToState('hide');
          return;
        }
        inst.setMotorSpeed(0);
        play(inst, clips.extinguish.name);
      },
      timeline: [TimeEvent(20 * FRAMES, () => inst.components.burnable.Extinguish()), ...sounds('hit', 28)],
      events: [onIdle],
    }),
    state({
      name: 'giveup',
      tags: ['busy', 'givingup'],
      onenter: sg => {
        inst.components.workable.SetWorkable(false);
        if (mem.is_hiding) {
          inst.setMotorSpeed(0);
          play(inst, clips.extinguish.name);
        } else {
          OnHide();
          play(inst, clips.sleep.name);
          inst.animstate.PushAnimation(clips.extinguish.name, false);
          inst.sprite.pushAnimation(clips.extinguish.name, false);
          sg.statemem.hide_delay = true;
        }
      },
      timeline: [
        giveupEvent(10, true, sg => sound(sg, 'awake_pre')),
        giveupEvent(15, true, sg => sound(sg, 'hit')),
        giveupEvent(31, true, sg => sound(sg, 'awake_pre')),
        giveupEvent(45, true, () => inst.components.lootdropper.SpawnLootPrefab(CONFIG.loot.prefab)),
        giveupEvent(59, true, sg => sound(sg, 'hit')),
        giveupEvent(6, false, sg => sound(sg, 'awake_pre')),
        giveupEvent(14, false, () => inst.components.lootdropper.SpawnLootPrefab(CONFIG.loot.prefab)),
        giveupEvent(28, false, sg => sound(sg, 'hit')),
      ],
      events: [onQueueIdle],
      onexit: () => {
        mem.hits_left = CONFIG.workable.workLeft;
        inst.components.workable.SetWorkable(true);
      },
    }),
    state({
      name: 'walk_start',
      tags: ['moving', 'canrotate'],
      onenter: () => {
        inst.components.locomotor.WalkForward();
        play(inst, clips.walk_pre.name);
      },
      timeline: sounds('footstep', 6),
      events: [EventHandler('animover', sg => sg.goToState('walk'))],
    }),
    state({
      name: 'walk',
      tags: ['moving', 'canrotate'],
      onenter: sg => {
        inst.components.locomotor.WalkForward();
        play(inst, clips.walk_loop.name, true);
        sg.setTimeout(inst.animstate.length);
      },
      timeline: sounds('footstep', 0, 6, 12, 17),
      ontimeout: sg => sg.goToState('walk'),
    }),
    state({
      name: 'walk_stop',
      tags: ['canrotate'],
      onenter: () => {
        inst.components.locomotor.StopMoving();
        play(inst, clips.walk_pst.name);
      },
      timeline: sounds('footstep', 0, 5),
      events: [onQueueIdle],
    }),
  ];

  const sg = new StateGraphInstance(inst, states, [], scheduler);
  sg.listenForEvent('death', () => sg.goToState('death'));
  sg.listenForEvent('onignite', () => sg.goToState('extinguish'));
  // Lua buffers the event until after Workable's onworked callback resets and re-enables the component.
  sg.listenForEvent('worked', () =>
    sg.schedule(FRAMES, () => {
      const now = scheduler.now;
      if (mem.prevtimeworked === undefined || now - mem.prevtimeworked > CONFIG.workable.resetAfterSeconds) {
        mem.hits_left = CONFIG.workable.workLeft;
      }
      mem.hits_left--;
      if (!sg.hasStateTag('givingup')) {
        sg.goToState(mem.hits_left > 0 ? 'hit' : 'giveup');
      }
      mem.prevtimeworked = now;
    }),
  );
  sg.listenForEvent('locomote', () => {
    const moving = sg.hasStateTag('moving');
    const wantsToMove = inst.components.locomotor.WantsToMoveForward();
    if (moving && !wantsToMove) {
      sg.goToState('walk_stop');
    } else if (wantsToMove && !moving && sg.hasStateTag('idle')) {
      if (mem.is_hiding) {
        sg.goToState('standup');
      } else if (!sg.hasStateTag('busy')) {
        sg.goToState('walk_start');
      }
    }
  });
  sg.goToState('initialstate');
  return sg;
}
