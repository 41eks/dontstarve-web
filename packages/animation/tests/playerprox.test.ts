import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { createMemo, createSignal } from '@dontstarve-web/signals';
import { PlayerProx } from '../../componets/src/playerprox';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { bindTestWorld } from './worldContentFixture';
import * as tileManager from '../../componets/src/tileManager';

it('shares tile-pair distances across prefabs, reversed pairs and snapshots while keeping exact entity distances', async () => {
  const scheduler = new GameTimeScheduler();
  const { playerpositions, getWatchWorldContent, unbind } = bindTestWorld(scheduler);
  // Unique out-of-map tiles keep this cache assertion independent of other tests.
  const origin = new THREE.Vector3(1200.1, 0, 2400.1), otherOrigin = new THREE.Vector3(1211.9, 0, 2400.1);
  const first = new PlayerProx({ isValid: () => true, getPosition: () => origin }, getWatchWorldContent);
  const second = new PlayerProx({ isValid: () => true, getPosition: () => otherOrigin }, getWatchWorldContent);
  first.SetDist(3, 15); second.SetDist(3, 15);
  const max = vi.spyOn(Math, 'max');
  const computations = (x: number, z: number) => max.mock.calls.filter(args => args.length === 2 && args[0] === x && args[1] === z).length;
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    playerpositions.set([new THREE.Vector3(1213, 0, 2400.1)]); await settle();
    expect(computations(1, 0)).toBe(1);
    expect(first.IsPlayerClose()).toBe(false);
    expect(second.IsPlayerClose()).toBe(true); // Same tile and radius, different precise distance.
    first.ForceUpdate(); second.ForceUpdate();
    expect(computations(1, 0)).toBe(1); // The far radius reuses the same tile distance too.

    origin.set(1213, 0, 2400.1);
    playerpositions.set([new THREE.Vector3(1200.1, 0, 2400.1)]); await settle();
    expect(computations(1, 0)).toBe(1); // New snapshot, same unordered pair in reverse.
    expect(first.IsPlayerClose()).toBe(false);
    expect(second.IsPlayerClose()).toBe(true);

    playerpositions.set([new THREE.Vector3(1224.1, 0, 2400.1)]); await settle();
    expect(computations(1, 0)).toBe(2); // New tile pair, despite the same grid distance.
    expect(computations(2, 0)).toBe(1);
    second.SetDist(3, 4); second.ForceUpdate();
    expect(second.IsPlayerClose()).toBe(false);
    expect(computations(2, 0)).toBe(1);
  } finally {
    max.mockRestore(); first.dispose(); second.dispose(); unbind(); scheduler.dispose();
  }
});

it('caches player tiles between position snapshots and skips far players without missing adjacent players or the far transition', async () => {
  const scheduler = new GameTimeScheduler();
  const { playerpositions, getWatchWorldContent, unbind } = bindTestWorld(scheduler);
  const origin = new THREE.Vector3(11.9, 0, -.1), onnear = vi.fn(), onfar = vi.fn();
  const farX = new THREE.Vector3(48, 0, -.1), farZ = new THREE.Vector3(11.9, 0, 48);
  const distanceX = vi.spyOn(farX, 'distanceToSquared'), distanceZ = vi.spyOn(farZ, 'distanceToSquared');
  const tiles = vi.spyOn(tileManager, 'GetTileCoordsAtPoint');
  const prox = new PlayerProx({ isValid: () => true, getPosition: () => origin }, getWatchWorldContent);
  prox.SetDist(3, 15); prox.SetOnPlayerNear(onnear); prox.SetOnPlayerFar(onfar);
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    playerpositions.set([farX, farZ]); await settle();
    const playerTileReads = () => tiles.mock.calls.filter(([point]) => point === farX || point === farZ).length;
    expect(playerTileReads()).toBe(2);
    for (let poll = 0; poll < 5; poll++) prox.ForceUpdate();
    scheduler.advance(1);
    expect(playerTileReads()).toBe(2);
    expect(distanceX).not.toHaveBeenCalled(); expect(distanceZ).not.toHaveBeenCalled();

    const adjacent = new THREE.Vector3(12.1, 0, -.1);
    playerpositions.set([farX, adjacent]); await settle();
    expect(prox.IsPlayerClose()).toBe(true);
    expect(onnear).toHaveBeenCalledOnce();
    playerpositions.set([farX, farZ]); await settle();
    expect(prox.IsPlayerClose()).toBe(false);
    expect(onfar).toHaveBeenCalledOnce();
    expect(distanceX).not.toHaveBeenCalled(); expect(distanceZ).not.toHaveBeenCalled();
  } finally {
    prox.dispose(); unbind(); scheduler.dispose();
    tiles.mockRestore(); distanceX.mockRestore(); distanceZ.mockRestore();
  }
});

it('keeps large radii, negative and out-of-map coordinates, and strict 3D distance boundaries', async () => {
  const scheduler = new GameTimeScheduler();
  const { playerpositions, getWatchWorldContent, unbind } = bindTestWorld(scheduler);
  const origin = new THREE.Vector3(-.1, 0, -.1);
  const prox = new PlayerProx({ isValid: () => true, getPosition: () => origin }, getWatchWorldContent);
  prox.SetDist(24, 30);
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    playerpositions.set([new THREE.Vector3(12.1, 0, -.1)]); await settle();
    expect(prox.IsPlayerClose()).toBe(true); // Two cells apart but inside the configured near radius.
    playerpositions.set([new THREE.Vector3(-.1, 30, -.1)]); await settle();
    expect(prox.IsPlayerClose()).toBe(false); // Same tile, exactly at the full 3D far boundary.
    origin.set(600, 0, -.1);
    playerpositions.set([new THREE.Vector3(600.1, 0, -.1)]); await settle();
    expect(prox.IsPlayerClose()).toBe(true); // Packed keys are invalid outside the bounded tickingarea grid.
    prox.dispose();
    const reads = vi.spyOn(playerpositions, 'get');
    playerpositions.set([new THREE.Vector3()]); await settle();
    expect(reads).not.toHaveBeenCalled(); reads.mockRestore();
  } finally { prox.dispose(); unbind(); scheduler.dispose(); }
});

it('suspends detection outside the tickingarea and resyncs when it becomes active again', async () => {
  const scheduler = new GameTimeScheduler(), awake = createSignal(true), area = createMemo(() => awake.get());
  const { playerpositions, getWatchWorldContent, unbind } = bindTestWorld(scheduler, () => area);
  const origin = new THREE.Vector3(0, 0, 0), near = vi_fn(), far = vi_fn();
  const prox = new PlayerProx({ isValid: () => true, getPosition: () => origin }, getWatchWorldContent);
  prox.SetDist(2, 3); prox.SetOnPlayerNear(near.fn); prox.SetOnPlayerFar(far.fn);
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));
  try {
    playerpositions.set([new THREE.Vector3(1, 0, 0)]); await settle();
    expect(prox.IsPlayerClose()).toBe(true);
    const update = vi.spyOn(prox, 'ForceUpdate');
    scheduler.advance(30); await settle();
    expect(update).not.toHaveBeenCalled();


    awake.set(false); await settle();

    playerpositions.set([new THREE.Vector3(40, 0, 0)]); await settle(); scheduler.advance(5);
    expect(prox.IsPlayerClose()).toBe(true); // the gated positions kept their last value, and nothing polled

    awake.set(true); await settle();

    expect(prox.IsPlayerClose()).toBe(false);
    expect(far.calls).toBe(1);
  } finally { prox.dispose(); unbind(); scheduler.dispose(); }
});

function vi_fn() { const state = { calls: 0, fn: () => { state.calls++; } }; return state; }
