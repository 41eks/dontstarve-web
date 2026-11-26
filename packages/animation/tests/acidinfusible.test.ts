import { readFile } from 'node:fs/promises';
import { SpriteResources } from '@dontstarve-web/display';
import { createSignal, getWatchWorldContent, type GetWatchWorldContent } from '@dontstarve-web/signals';
import { afterEach, expect, it, vi } from 'vitest';
import { AcidInfusible } from '../../componets/src/acidinfusible';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ACIDSMOKE_FX_ID, spawnAcidSmokeFx } from '../../prefab/src/acidsmoke_fx';
import { addComponent } from '../../prefab/src/components';
import { createEmptyEntity, type PrefabInstance } from '../../prefab/src/prefabInstance';
import { createTestWorldSources } from './worldContentFixture';

afterEach(() => vi.unstubAllGlobals());

function setup(raining: boolean) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url)))),
  );
  const scheduler = new GameTimeScheduler();
  const isacidraining = createSignal(raining);
  const sources = { ...createTestWorldSources(scheduler), isacidraining };
  const watch: GetWatchWorldContent = (key, cleanup, options) => getWatchWorldContent(key, cleanup, sources, options);
  const sprites = new SpriteResources('/dst/data/anim');
  const host = createEmptyEntity('acid_host').instance;
  host.BindScheduler(scheduler);
  const infuse = vi.fn();
  const acid = addComponent(host, 'acidinfusible', AcidInfusible, scheduler, watch);
  acid.SetFXLevel(3);
  acid.SetOnInfuseFn(infuse);
  const spawned: PrefabInstance[] = [];
  acid.SetFXSpawner(() => {
    const fx = spawnAcidSmokeFx(host, sprites, scheduler);
    spawned.push(fx.instance);
    return fx;
  });
  const smoke = () => spawned.at(-1);
  return { scheduler, isacidraining, host, acid, infuse, smoke };
}

it('declares the acid smoke while the world acid rains and rain immunity does not cover the entity', () => {
  const { scheduler, isacidraining, host, acid, infuse, smoke } = setup(true);
  try {
    // Already raining: the initialize task, not construction, infuses, after the prefab configured the component.
    expect(acid.infused.value).toBe(false);
    scheduler.advance(0);
    expect(acid.infused.value).toBe(true);
    expect(infuse).toHaveBeenCalledTimes(1);
    const fx = smoke()!;
    expect(fx.prefab).toBe(ACIDSMOKE_FX_ID);
    expect(fx.hasTag('FX')).toBe(true);
    expect(fx.persists).toBe(false);
    expect(fx.entityParent).toBe(host);
    expect([...host.sprite.peekFx().values()].map(entry => entry.sprite)).toEqual([fx.sprite]);
    // No clip until the first puff, 5-8 seconds in; then idle_<fxlevel>.
    expect(fx.sprite.sprite.value.clip.none).toBe(true);
    scheduler.advance(8);
    expect(fx.sprite.sprite.value.clip).toMatchObject({ name: 'idle_3', loop: false });

    // Rain immunity uninfuses: the puff in progress finishes (54 frames at most, plus one) before the smoke goes.
    host.PushEvent('gainrainimmunity');
    expect(acid.infused.value).toBe(false);
    expect(fx.isRemoved).toBe(false);
    scheduler.advance(55 / 30);
    expect(fx.isRemoved).toBe(true);
    expect(host.sprite.peekFx().size).toBe(0);

    host.PushEvent('loserainimmunity');
    const next = smoke()!;
    expect(next).not.toBe(fx);
    // Between puffs only the frame remains.
    isacidraining.set(false);
    scheduler.advance(1 / 30);
    expect(next.isRemoved).toBe(true);
    expect(host.sprite.peekFx().size).toBe(0);

    isacidraining.set(true);
    const last = smoke()!;
    host.remove();
    expect(last.isRemoved).toBe(true);
  } finally {
    scheduler.dispose();
  }
});
