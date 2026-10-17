import type { Vector3 } from 'three';
import type { WilsonStateGraph, WilsonStateName } from './SGwilson.ts';
import { State, TimeEvent, EventHandler, FRAMES } from './stategraph.ts';

/** SGwilson.lua's unmounted, non-map Wortox portal states. */
const state = State<WilsonStateGraph, WilsonStateName>;
const time = (frame: number, fn: Parameters<typeof TimeEvent<WilsonStateGraph, WilsonStateName>>[1]) =>
  TimeEvent<WilsonStateGraph, WilsonStateName>(frame * FRAMES, fn);
const tint = (frame: number, value: number) => time(frame, inst => inst.context.host.soulHop?.setTint(value));
const play = (name: string) => [{ key: 'wortox_portal' as const, name: `wortox_portal_${name}` }];

export const wortoxStates = [
  state({
    name: 'portal_jumpin_pre', tags: ['busy'],
    onenter: inst => {
      inst.context.host.stopMovement?.();
      inst.context.playClips(play('jumpin_pre'));
      const pos = inst.context.getBufferedAction()?.pos;
      if (pos) inst.context.host.soulHop?.facePoint(pos as Vector3);
    },
    events: [EventHandler('animover', inst => {
      if (inst.context.animationDone && !inst.context.performBufferedAction()) inst.context.finish();
    })],
  }),
  state({
    name: 'portal_jumpin', tags: ['busy', 'pausepredict', 'nodangle', 'nomorph'],
    onenter: (inst, data) => {
      inst.statemem.dest = data;
      inst.context.host.stopMovement?.();
      inst.context.playClips(play('jumpin'));
      inst.context.host.soulHop?.spawnFx('wortox_portal_jumpin_fx');
      inst.setTimeout(11 * FRAMES);
    },
    timeline: [
      time(1, inst => {
        inst.context.host.soulHop?.playSound('dontstarve/creatures/together/toad_stool/infection_post', .7);
        inst.context.host.soulHop?.playSound('dontstarve/characters/wortox/soul/spawn', .5);
      }),
      tint(2, .1), tint(3, .3),
      time(4, inst => {
        inst.context.host.soulHop?.setTint(.6);
        inst.addStateTag('noattack');
        inst.context.host.rez?.setInvincible(true);
      }),
      tint(5, 1),
    ],
    ontimeout: inst => inst.goToState('portal_jumpout', inst.statemem.dest),
    onexit: (inst, next) => {
      if (next !== 'portal_jumpout') {
        inst.context.host.rez?.setInvincible(false);
        inst.context.host.soulHop?.setTint(0);
      }
    },
  }),
  state({
    name: 'portal_jumpout', tags: ['busy', 'nopredict', 'nomorph', 'noattack', 'nointerrupt'],
    onenter: (inst, data) => {
      const host = inst.context.host;
      host.soulHop?.setPhysicsEnabled(false);
      host.stopMovement?.();
      host.soulHop?.teleport(data as Vector3);
      inst.context.playClips(play('jumpout'));
      host.soulHop?.spawnFx('wortox_portal_jumpout_fx');
      host.soulHop?.setTint(1);
      host.rez?.setInvincible(true);
      host.pushPlayerEvent?.('soulhop');
      inst.setTimeout(14 * FRAMES);
    },
    timeline: [
      time(1, inst => inst.context.host.soulHop?.playSound('dontstarve/characters/wortox/soul/hop_out')),
      tint(5, .9), tint(6, .7),
      time(7, inst => {
        inst.context.host.soulHop?.setTint(.4);
        inst.context.host.rez?.setInvincible(false);
        inst.removeStateTag('noattack');
        inst.context.host.playEvent?.('dontstarve/movement/bodyfall_dirt');
      }),
      time(8, inst => {
        inst.context.host.soulHop?.setTint(0);
        inst.context.host.soulHop?.setPhysicsEnabled(true);
      }),
    ],
    ontimeout: inst => inst.context.finish(true),
    onexit: inst => {
      inst.context.host.rez?.setInvincible(false);
      inst.context.host.soulHop?.setTint(0);
      inst.context.host.soulHop?.setPhysicsEnabled(true);
    },
  }),
];
