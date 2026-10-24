import * as THREE from 'three';
import { expect, it } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { PlayerProx } from '../../componets/src/playerprox';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bindTestWorld } from './worldContentFixture';

it('stops polling outside the tickingarea and resyncs when it becomes active again', async () => {
  const scheduler = new GameTimeScheduler(), awake = createSignal(true), area = createMemo(() => awake.get());
  const { playerpositions, getWatchWorldContent, unbind } = bindTestWorld(scheduler, () => area);
  const origin = new THREE.Vector3(0, 0, 0), near = vi_fn(), far = vi_fn();
  const prox = new PlayerProx({ isValid: () => true, getPosition: () => origin }, scheduler, getWatchWorldContent);
  prox.SetDist(2, 3); prox.SetOnPlayerNear(near.fn); prox.SetOnPlayerFar(far.fn);
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    playerpositions.set([new THREE.Vector3(1, 0, 0)]); await settle();
    expect(prox.IsPlayerClose()).toBe(true);
    expect(prox.timerState.peek().status).toBe('scheduled');

    awake.set(false); await settle();
    expect(prox.timerState.peek().status).not.toBe('scheduled');
    playerpositions.set([new THREE.Vector3(40, 0, 0)]); await settle(); scheduler.advance(5);
    expect(prox.IsPlayerClose()).toBe(true); // the gated positions kept their last value, and nothing polled

    awake.set(true); await settle();
    expect(prox.timerState.peek().status).toBe('scheduled');
    expect(prox.IsPlayerClose()).toBe(false);
    expect(far.calls).toBe(1);
  } finally { prox.dispose(); unbind(); scheduler.dispose(); }
});

function vi_fn() { const state = { calls: 0, fn: () => { state.calls++; } }; return state; }
