import * as THREE from 'three';
import { readFile } from 'node:fs/promises';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SpriteState } from '@dontstarve-web/display';
import type { Brain } from '../../brains/src/brain';
import type { BehaviourContext } from '../../brains/src/behaviourtree';
import { addComponent } from '../src/components';
import { PrefabInstance } from '../src/prefabInstance';
import { evergreenPrefabs } from '../src/evergreens';
import { deciduousPrefabs } from '../src/deciduoustrees';
import { moonTreePrefabs } from '../src/moontree';
import { createSignal } from '@dontstarve-web/signals';
import { createTestArea, useTestTileMap } from '../../../tests/fixtures/tileMapFixture';
import { treeWorld } from '../../../tests/fixtures/treeManagerFixture';
import { bindTestWorld } from '../../../tests/fixtures/worldContentFixture';
import { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';

useTestTileMap();
let area: ReturnType<typeof createTestArea>;
beforeEach(async () => {
  area = createTestArea();
  await area.ready;
});
afterEach(() => area.dispose());

vi.mock('../src/sound', () => ({
  PreloadSounds: vi.fn(async () => {}),
  PlaySound: vi.fn(() => ({ stop() {} })),
}));
beforeEach(() => {
  vi.stubGlobal('window', new EventTarget());
  vi.stubGlobal(
    'fetch',
    async (url: string) => new Response(await readFile(new URL(`../../../public${url}`, import.meta.url))),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** A component that only reports the engine's calls to it. */
class Probe {
  private readonly log: string[];
  constructor(_inst: object, log: string[]) {
    this.log = log;
  }
  OnEntitySleep(): void {
    this.log.push('component sleep');
  }
  OnEntityWake(): void {
    this.log.push('component wake');
  }
}

function probeEntity(log: string[], ownerStatus?: PrefabInstance['status']) {
  const inst = new PrefabInstance<SpriteState, { probe?: Probe }>(
    'probe',
    new SpriteState({ name: 'idle' }),
    undefined,
    ownerStatus,
  );
  inst.ListenForEvent('entitysleep', () => log.push('entitysleep'));
  inst.ListenForEvent('entitywake', () => log.push('entitywake'));
  inst.OnEntitySleep = inst => log.push(`inst sleep, asleep ${inst.IsAsleep()}`);
  inst.OnEntityWake = inst => log.push(`inst wake, asleep ${inst.IsAsleep()}`);
  addComponent(inst, 'probe', Probe, log);
  return inst;
}

it('dispatches sleep and wake once per crossing in mainfunctions.lua order: event, inst, brain, components', () => {
  const log: string[] = [];
  const inst = probeEntity(log);
  const brain = (): Brain<BehaviourContext> => {
    log.push('brain made');
    const made: Pick<Brain<BehaviourContext>, 'Start' | 'Stop' | 'PushEvent'> = {
      Start: () => log.push('brain start'),
      Stop: () => log.push('brain stop'),
      PushEvent: () => {},
    };
    return made as Brain<BehaviourContext>;
  };
  inst.SetBrain(brain);
  expect(log.splice(0)).toEqual(['brain made', 'brain start']);

  // The engine's first look at a new entity wakes it; an awake brain is kept.
  inst.setActive(true);
  expect(log.splice(0)).toEqual(['entitywake', 'inst wake, asleep false', 'component wake']);
  inst.setActive(true);
  expect(log).toEqual([]);

  inst.setActive(false);
  expect(log.splice(0)).toEqual(['entitysleep', 'inst sleep, asleep true', 'brain stop', 'component sleep']);
  expect(inst.brain).toBeUndefined();
  inst.setActive(false);
  expect(log).toEqual([]);

  inst.setActive(true);
  expect(log.splice(0)).toEqual([
    'entitywake',
    'inst wake, asleep false',
    'brain made',
    'brain start',
    'component wake',
  ]);

  // Limbo sleeps the entity too; it wakes on ReturnToScene where its tile is awake.
  inst.RemoveFromScene();
  expect(log.splice(0)).toEqual(['entitysleep', 'inst sleep, asleep true', 'brain stop', 'component sleep']);
  inst.ReturnToScene();
  expect(log.splice(0)).toEqual([
    'entitywake',
    'inst wake, asleep false',
    'brain made',
    'brain start',
    'component wake',
  ]);

  // Removal is neither sleep nor wake.
  inst.remove();
  inst.setActive(false);
  expect(log).toEqual([]);
});

it('sleeps and wakes an entity with its owner, and stops at a component the sleep handler removed', () => {
  const ownerLog: string[] = [],
    childLog: string[] = [];
  const owner = probeEntity(ownerLog);
  owner.setActive(true);
  const child = probeEntity(childLog, owner.status);
  child.setActive(true);
  childLog.length = 0;
  owner.OnEntitySleep = inst => {
    ownerLog.push('inst sleep');
    inst.remove();
  };

  owner.setActive(false);
  expect(childLog).toEqual(['entitysleep', 'inst sleep, asleep true', 'component sleep']);
  // A handler that removes its entity ends the dispatch: its components are already torn down.
  expect(ownerLog.slice(-2)).toEqual(['entitysleep', 'inst sleep']);
});

type TreeTestWorld = Parameters<typeof evergreenPrefabs>[0] &
  Parameters<typeof deciduousPrefabs>[0] &
  Parameters<typeof moonTreePrefabs>[0];
it.each([
  ['evergreen', (world: TreeTestWorld) => evergreenPrefabs(world, () => 0.5), 'evergreen_short'],
  ['deciduoustree', (world: TreeTestWorld) => deciduousPrefabs(world, () => 0.5), 'deciduoustree_short'],
  ['moon_tree', (world: TreeTestWorld) => moonTreePrefabs(world, () => 0.5), 'moon_tree_short'],
] as const)(
  '%s registers its own OnEntitySleep / OnEntityWake, which run before growable sleeps and catches up',
  async (_name, define, spawnId) => {
    const scheduler = new GameTimeScheduler();
    const content = bindTestWorld(scheduler);
    const world = treeWorld(
      area.query,
      define,
      {
        getWatchWorldContent: content.getWatchWorldContent,
        season: createSignal({ season: 'summer' as const, progress: 0.5 }),
        secondsUntilNextDay: (now: number) => 480 - (now % 480),
      },
      { scheduler },
    );
    try {
      await area.visit(new THREE.Vector3());
      const tree = world.prefabs.spawn(spawnId, new THREE.Vector3(3, 0, 0));
      const growable = tree.components.growable!;
      const log: string[] = [];
      const onSleep = tree.OnEntitySleep!,
        onWake = tree.OnEntityWake!;
      tree.OnEntitySleep = inst => {
        log.push('inst sleep');
        onSleep(inst);
      };
      tree.OnEntityWake = inst => {
        log.push('inst wake');
        onWake(inst);
      };
      const sleep = growable.OnEntitySleep.bind(growable),
        wake = growable.OnEntityWake.bind(growable);
      vi.spyOn(growable, 'OnEntitySleep').mockImplementation(() => {
        log.push('growable sleep');
        sleep();
      });
      vi.spyOn(growable, 'OnEntityWake').mockImplementation(() => {
        log.push('growable wake');
        wake();
      });
      const stage = growable.GetStage();

      await area.visit(new THREE.Vector3(1000, 0, 1000));
      expect(tree.IsAsleep()).toBe(true);
      expect(log.splice(0)).toEqual(['inst sleep', 'growable sleep']);
      scheduler.advance(10000);
      expect(growable.GetStage()).toBe(stage);
      expect(tree.GetPersistData().growable).toMatchObject({ stage, sleeptime: 10000 });

      await area.visit(new THREE.Vector3());
      expect(log.splice(0)).toEqual(['inst wake', 'growable wake']);
      expect(growable.GetStage()).not.toBe(stage);
      expect(tree.GetPersistData().growable).not.toHaveProperty('sleeptime');
    } finally {
      content.unbind();
      world.dispose();
    }
  },
);
