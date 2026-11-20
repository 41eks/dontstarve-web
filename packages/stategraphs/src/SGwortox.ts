import type { Vector3 } from 'three';
import type { WilsonState, WilsonStateGraph, WilsonStateName, WilsonStateSpec } from './SGwilson.ts';
import { State, TimeEvent, EventHandler, FRAMES } from './stategraph.ts';

/** SGwilson.lua's unmounted Wortox portal states, shared by ground and map jumps. */
const state = <N extends WilsonStateName>(definition: WilsonState<N>) => State(definition);
const time = (frame: number, fn: Parameters<typeof TimeEvent<WilsonStateGraph, WilsonStateName, WilsonStateSpec>>[1]) =>
  TimeEvent<WilsonStateGraph, WilsonStateName, WilsonStateSpec>(frame * FRAMES, fn);
const tint = (frame: number, value: number) => time(frame, inst => inst.context.entity.soulHopHost?.setTint(value));
const play = (name: string) => [{ key: 'wortox_portal' as const, name: `wortox_portal_${name}` }];

export const wortoxStates: WilsonState[] = [
  state({
    name: 'portal_jumpin_pre', tags: ['busy'],
    onenter: inst => {
      inst.context.entity.locomotor?.stop();
      inst.context.playClips(play('jumpin_pre'));
      const pos = inst.context.getBufferedAction()?.pos;
      if (pos) { inst.context.entity.soulHopHost?.facePoint(pos as Vector3); }
    },
    events: [EventHandler('animover', inst => {
      if (inst.context.animationDone && !inst.context.performBufferedAction()) { inst.context.finish(); }
    })],
  }),
  state({
    name: 'portal_jumpin', tags: ['busy', 'pausepredict', 'nodangle', 'nomorph'],
    onenter: (inst, data) => {
      inst.statemem.dest = data;
      inst.context.entity.locomotor?.stop();
      inst.context.playClips(play('jumpin'));
      inst.context.entity.soulHopHost?.spawnFx('wortox_portal_jumpin_fx');
      inst.setTimeout(11 * FRAMES);
    },
    timeline: [
      time(1, inst => {
        inst.context.entity.SoundEmitter.PlaySound('dontstarve/creatures/together/toad_stool/infection_post', undefined, .7);
        inst.context.entity.SoundEmitter.PlaySound('dontstarve/characters/wortox/soul/spawn', undefined, .5);
      }),
      tint(2, .1), tint(3, .3),
      time(4, inst => {
        inst.context.entity.soulHopHost?.setTint(.6);
        inst.addStateTag('noattack');
        inst.context.entity.components.health?.SetInvincible(true);
      }),
      tint(5, 1),
    ],
    ontimeout: inst => inst.goToState('portal_jumpout', inst.statemem.dest),
    onexit: (inst, next) => {
      if (next !== 'portal_jumpout') {
        inst.context.entity.components.health?.SetInvincible(false);
        inst.context.entity.soulHopHost?.setTint(0);
      }
    },
  }),
  state({
    name: 'portal_jumpout', tags: ['busy', 'nopredict', 'nomorph', 'noattack', 'nointerrupt'],
    onenter: (inst, data) => {
      inst.context.entity.soulHopHost?.setPhysicsEnabled(false);
      inst.context.entity.locomotor?.stop();
      // Without data the player comes out where it stands.
      if (data) { inst.context.entity.soulHopHost?.teleport(data.dest); }
      inst.context.entity.soulHopHost?.resetMinimapOffset?.();
      if (data?.from_map) { inst.context.entity.soulHopHost?.snapCamera?.(); }
      inst.context.playClips(play('jumpout'));
      inst.context.entity.soulHopHost?.spawnFx('wortox_portal_jumpout_fx');
      inst.context.entity.soulHopHost?.setTint(1);
      inst.context.entity.components.health?.SetInvincible(true);
      inst.context.entity.PushEvent('soulhop');
      inst.setTimeout(14 * FRAMES);
    },
    timeline: [
      time(1, inst => inst.context.entity.SoundEmitter.PlaySound('dontstarve/characters/wortox/soul/hop_out')),
      tint(5, .9), tint(6, .7),
      time(7, inst => {
        inst.context.entity.soulHopHost?.setTint(.4);
        inst.context.entity.components.health?.SetInvincible(false);
        inst.removeStateTag('noattack');
        inst.context.entity.SoundEmitter.PlaySound('dontstarve/movement/bodyfall_dirt');
      }),
      time(8, inst => {
        inst.context.entity.soulHopHost?.setTint(0);
        inst.context.entity.soulHopHost?.setPhysicsEnabled(true);
      }),
    ],
    ontimeout: inst => inst.context.finish(true),
    onexit: inst => {
      inst.context.entity.components.health?.SetInvincible(false);
      inst.context.entity.soulHopHost?.setTint(0);
      inst.context.entity.soulHopHost?.setPhysicsEnabled(true);
    },
  }),
];
