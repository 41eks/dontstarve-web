import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SpriteState } from '@dontstarve-web/display';
import { createWilsonPlayerPrefab, type WilsonAnimationController, type WilsonPlayerPrefab } from './playerVisual';
import { prefabInstance } from '../../prefab/src/prefabInstance';
import { smallHash } from '../src/animationAssets';
import { declaredAnimState } from './animStateFixture';

vi.mock('../../prefab/src/sound', () => ({ PreloadSounds: vi.fn(async () => {}), PlaySound: vi.fn(() => ({ stop() {}, isPlaying: () => true, setVolume() {} })) }));
const players: WilsonPlayerPrefab[] = [];
const settle = () => new Promise(resolve => setTimeout(resolve, 0));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))));
});
afterEach(async () => {
  for (const player of players.splice(0)) player.instance.remove();
  await settle();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const meshes = (model: THREE.Object3D) => {
  const result: THREE.Mesh[] = [];
  model.traverse(object => { if (object instanceof THREE.Mesh) result.push(object); });
  return result;
};
async function createPlayer() {
  const world = new CANNON.World();
  const prefab = await createWilsonPlayerPrefab('/dst/data/anim', world);
  players.push(prefab);
  return { ...prefab, world, animation: prefab.instance.animationController as WilsonAnimationController };
}

it('declares player art and retains its entity, equipment, body and shared assets through sleep and wake', async () => {
  const { instance, model, body, world, animation } = await createPlayer();
  const scene = new THREE.Scene(); scene.add(model);
  model.position.set(12, 0, -6);
  const position = instance.position;
  expect(instance.sprite).toBeInstanceOf(SpriteState);
  expect(instance.position).toBe(model.position);
  expect(instance.physicsBody).toBe(body);
  const source = instance.sprite.sprite.peek().source!;
  if (!('art' in source)) throw new Error('Expected named player art');
  const materials = source.art.peekBuild(source.buildArchive)!.materials;
  const disposals = materials.map(material => vi.spyOn(material, 'dispose'));
  await animation.setCarryItem('pickaxe');
  const hit = vi.fn();
  expect(animation.playMine(hit)).toBe(true);
  for (let frame = 0; frame < 5; frame++) animation.update(1 / 30);
  animation.setFacing('side', true);
  expect(instance.sprite.sprite.peek()).toMatchObject({ facing: 5, mirrored: true, paused: true });
  instance.setActive(false); await settle();
  expect(model.parent).toBeNull();
  expect(meshes(model)).toHaveLength(0);
  expect(instance.physicsBody).toBe(body);
  expect(instance.position).toBe(position);
  expect(position.toArray()).toEqual([12, 0, -6]);
  // The source action timeline remains logical while no visual exists.
  for (let frame = 0; frame < 30; frame++) animation.update(1 / 30);
  expect(hit).toHaveBeenCalledOnce();
  instance.setActive(true); await settle(); animation.update(0);
  expect(model.parent).toBe(scene);
  expect(meshes(model)).toHaveLength(1);
  const art = instance.sprite.sprite.peek();
  const restoredSource = art.source!;
  if (!('art' in restoredSource)) throw new Error('Expected named player art');
  expect(restoredSource.art.peekBuild(restoredSource.buildArchive)!.materials).toBe(materials);
  expect(art.appearance.get('anim-state')?.kind).toBe('anim-state');
  // The held item's art is in its own slot over the player's AnimState, and it survives sleep and wake.
  expect(declaredAnimState(instance.sprite).json.peek().overrides.has(smallHash('swap_object'))).toBe(true);
  for (const dispose of disposals) expect(dispose).not.toHaveBeenCalled();
  instance.remove();
  expect(world.bodies).not.toContain(body);
  await settle();
  expect(meshes(model)).toHaveLength(0);
  for (const dispose of disposals) expect(dispose).toHaveBeenCalledOnce();
  const removed = instance.sprite.sprite.peek();
  animation.AnimState.Hide('HEAD'); animation.update(1);
  expect(instance.sprite.sprite.peek()).toBe(removed);
});

it('declares tagged book FX as child instances and expires them on game timers while the player visual sleeps', async () => {
  const { instance, model, display, animation } = await createPlayer();
  const book = { prefab: 'book_silviculture', swap_build: 'swap_books', swap_prefix: 'book_silviculture', def: { fx_under_prefab: 'fx_roots_under_book' } };
  const read = vi.fn(() => true);
  expect(animation.playRead(book, read)).toBe(true);
  for (let frame = 0; frame < 60 && animation.stategraph.stateName !== 'book2'; frame++) animation.update(1 / 30);
  expect(animation.stategraph.stateName).toBe('book2');
  await display.artLoaded(); animation.update(0);
  const fx = [...instance.sprite.fx.peek().values()];
  expect(fx).toHaveLength(2);
  const children = fx.map(entry => prefabInstance(entry.display!.model)!);
  for (const child of children) { expect(child.listTags()).toContain('FX'); expect(child.persists).toBe(false); }
  const rootsFx = fx.find(entry => prefabInstance(entry.display!.model)!.prefab === 'fx_roots_under_book')!;
  let roots = rootsFx.display!.resolveFrame();
  for (let frame = 0; roots.length === 0 && frame < 45; frame++) {
    animation.update(1 / 30);
    roots = rootsFx.display!.resolveFrame();
  }
  expect(roots.length).toBeGreaterThan(0);
  const combined = display.resolveFrame();
  for (const root of roots) expect(combined.some(part => part.image === root.image)).toBe(true);
  expect(meshes(model)).toHaveLength(1); // FX parts join the one merged character billboard.
  instance.setActive(false); await settle();
  for (const entry of fx) { expect(entry.display!.resolveFrame()).toEqual([]); expect(entry.sprite.loaded).toBe(false); }
  for (let frame = 0; frame < 240; frame++) animation.update(1 / 30);
  expect(read).toHaveBeenCalledOnce();
  for (const child of children) expect(child.status.peek()).toBe('removed');
  expect(instance.sprite.fx.peek().size).toBe(0);
  instance.setActive(true); await settle(); animation.update(0);
  expect(meshes(model)).toHaveLength(1);
  // Removing the player during the next read cancels its child timers and buffered action.
  expect(animation.playRead(book, read)).toBe(true);
  await settle();
  const cancelled = [...instance.sprite.fx.peek().values()].map(entry => prefabInstance(entry.display!.model)!);
  expect(cancelled).toHaveLength(1);
  instance.remove(); await settle(); animation.update(1);
  expect(instance.sprite.fx.peek().size).toBe(0);
  for (const child of cancelled) expect(child.status.peek()).toBe('removed');
  expect(read).toHaveBeenCalledOnce();
});
