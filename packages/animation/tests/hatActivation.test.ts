import { readFile } from 'node:fs/promises';
import type * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HAT_DEFINITIONS, HatActivationController, HatEquipmentAssets } from '../../prefab/src/hats';
import { LanternLightController } from '../../prefab/src/lantern';
import { smallHash } from '../src/animationAssets';
import { createSanityState } from '@dontstarve-web/signals';
import { createEmptyEntity, prefabInstance } from '../../prefab/src/prefabInstance';

/** The inst.Light an entity's model declares. */
const declaredLight = (model: THREE.Object3D) => prefabInstance(model)?.light.peek();

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function sourceAssets() {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const relative = url.replace('/crown-test/', '');
    return new Response(await readFile(new URL(`../../../public/dst/data/anim/${relative}`, import.meta.url)));
  }));
  return new HatEquipmentAssets('/crown-test');
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const ticks = (owner: { update(dt: number): void }, seconds: number) => {
  for (let i = 0; i < Math.round(seconds * 30); i++) owner.update(1 / 30);
};

describe('Enlightened Crown source activation', () => {
  it('spawns two alterguardian_hat_equipped layers that play out on their own at the sanity threshold', async () => {
    const assets = sourceAssets();
    const hat = { definition: HAT_DEFINITIONS.alterguardianhat };
    // The FX archive is already cached, as after an earlier activation: its layers are drawn at once.
    await assets.loadFactory(hat.definition.equip.activated!.archive);
    const { instance: owner, display } = createEmptyEntity('wilson');
    const lantern = new LanternLightController(display.model);
    lantern.setLit(true);
    const lanternNode = display.model.getObjectByName('lanternlight')!;
    const lanternLight = declaredLight(lanternNode);
    const crownLight = () => { const node = display.model.getObjectByName('alterguardianhatlight'); return node && declaredLight(node); };
    const declared = () => [...owner.sprite.fx.peek().values()];
    // Each layer dresses its own material copies (SetMultColour), so frames compare by their parts and material names.
    const frame = (index: number) => declared()[index].display!.resolveFrame().map(({ element, image, materials }) => ({ element, image, materials: materials.map(({ name }) => name) }));
    const sanity = createSanityState(169, 200);
    const sanityRead = vi.spyOn(sanity.percent, 'get');
    const swapHatHidden = vi.fn();
    const crown = new HatActivationController(display.model, { assets, sanityPercent: sanity.percent, onSwapHatHidden: swapHatHidden });
    expect(sanityRead).toHaveBeenCalledOnce();
    crown.setHat(hat);
    expect(crown.activated.peek()).toBe(false);
    expect(crownLight()).toBeUndefined();
    expect(declared()).toEqual([]);
    sanity.set(171);
    expect(crown.activated.peek()).toBe(true);
    expect(crownLight()).toMatchObject({ radius: 12, intensity: 0.8, falloff: 0.5 });
    // Each layer is its own FX entity following the owner's hair, one behind and one in front of it.
    expect(declared().map(({ composite }) => composite)).toEqual([
      { symbol: 'hair', finalOffset: 1, noFaced: true }, { symbol: 'hair', finalOffset: -1, noFaced: true }]);
    const { front, back } = crown.layers;
    for (const layer of [front!, back!]) {
      expect(['FX', 'DECOR'].every(tag => layer.instance.hasTag(tag))).toBe(true);
      expect(layer.instance.persists).toBe(false);
      expect(layer.instance.sprite.currentAnimation).toBe('activate_pre');
      expect(layer.instance.sprite.sprite.peek().colour).toEqual([0.7, 0.7, 0.7]);
      const state = layer.instance.sprite.sprite.peek().appearance.get('anim-state');
      expect(state?.kind === 'anim-state' && state.state.symbolLightOverrides.get(smallHash('flame_swap'))).toBe(0.5);
    }
    expect(swapHatHidden).toHaveBeenLastCalledWith(true);
    const initial = [frame(0), frame(1)];
    // Base art has five pieces; the bloom approximation supplies their five halos.
    expect(initial.flat()).toHaveLength(10);
    expect(initial[0].every(({ element }) => element.layerHash === smallHash('front'))).toBe(true);
    expect(initial[1].every(({ element }) => element.layerHash === smallHash('back'))).toBe(true);
    expect(initial.flat().filter(({ materials }) => materials[0].endsWith(':bloom'))).toHaveLength(5);
    // The owner's display takes up its declared followers in a later task, then advances them with its own frames.
    await tick();
    ticks(owner.sprite, 15 / 30);
    expect(front!.instance.sprite.currentAnimation).toBe('activate_loop');
    expect(frame(0)[0].element.matrix).not.toEqual(initial[0][0].element.matrix);

    sanity.set(170);
    expect(crown.activated.peek()).toBe(false);
    expect(crownLight()).toBeUndefined();
    expect(crown.layers).toEqual({ front: undefined, back: undefined });
    expect(front!.instance.sprite.currentAnimation).toBe('activate_pst');
    expect(crown.hidesSwapHat).toBe(true);
    crown.update(8 / 30);
    expect(crown.hidesSwapHat).toBe(false);
    expect(swapHatHidden).toHaveBeenLastCalledWith(false);
    await tick();
    // animover removes each layer and its follower declaration.
    ticks(owner.sprite, 15 / 30);
    expect(declared()).toEqual([]);
    expect([front, back].map(layer => layer!.instance.status.peek())).toEqual(['removed', 'removed']);

    sanity.set(172);
    expect([frame(0), frame(1)]).toEqual(initial);
    // Unequipping removes the layers at once.
    crown.setHat(null);
    expect(declared()).toEqual([]);
    expect(crownLight()).toBeUndefined();
    expect(declaredLight(lanternNode)).toEqual(lanternLight);
    sanityRead.mockClear();
    sanity.set(200);
    expect(sanityRead).toHaveBeenCalledOnce();
    crown.setHat(hat);
    expect(crown.activated.peek()).toBe(true);
    crown.dispose();
    expect(declared()).toEqual([]);
    sanityRead.mockClear();
    sanity.set(0);
    expect(sanityRead).not.toHaveBeenCalled();
    expect(crownLight()).toBeUndefined();
    lantern.dispose();
    display.dispose();
  });

});
