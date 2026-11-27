import { createSignal, readonlySignal } from '@dontstarve-web/signals';
import { SpriteState } from '@dontstarve-web/display';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { PrefabInstance } from './prefabInstance';
import { groundItemPrefab, type ItemPrefabDefinition } from './groundItems';
import { bindBurnableItem } from './burnableItems';
import { FliesController } from './flies';
import type { ItemPrefabWorld } from './groundPrefab';

export const POOP_ID = 'poop';

/**
 * poop.lua fn: dump, then idle; the flies child is spawned with the manure and again by OnDropped, and is removed by
 * OnPickup and OnBurn.
 */
export function poopPrefabs(world: ItemPrefabWorld): Record<string, ItemPrefabDefinition> {
  return { [POOP_ID]: groundItemPrefab(POOP_ID, world, { configure: inst => bindPoop(inst, world) }) };
}

/** The manure's flies: one child declared once, shown while the manure has its swarm. */
export class PoopFlies {
  private readonly inst: ItemEntity;
  private readonly world: ItemPrefabWorld;
  /** The flies entity, which persists for the manure's life; its controller runs while it swarms. */
  readonly fliesInstance: PrefabInstance<SpriteState>;
  private controller?: FliesController;
  private readonly swarming = createSignal(false);
  /** Whether the flies child exists. */
  readonly active = readonlySignal(this.swarming);

  constructor(inst: ItemEntity, world: ItemPrefabWorld) {
    this.inst = inst;
    this.world = world;
    // It only plays clips: the manure draws it from the swarm's shared frames, with no display or pickable art.
    const flies = new PrefabInstance(
      'flies',
      new SpriteState({
        name: 'swarm_pre',
        billboard: true,
        plainClips: world.sprites.archive({
          animationArchive: 'flies.zip',
          buildArchives: ['flies.zip'],
          bank: 'flies',
        }),
      }),
      undefined,
      inst.status,
    );
    this.fliesInstance = flies;
    flies.persists = false;
    inst.sprite.attachFx('flies', { sprite: flies.sprite, active: this.active, sortLayer: 2 });
    inst.onRemove(() => {
      this.Remove();
      inst.sprite.detachFx('flies');
      flies.remove();
    });
  }

  /** inst:SpawnChild("flies"). */
  Spawn(): void {
    if (this.controller || this.inst.isRemoved || this.inst.components.inventoryitem.owner) {
      return;
    }
    this.controller = new FliesController(
      this.fliesInstance,
      this.inst.transform.position,
      this.world.scheduler,
      this.world.firefliesWorld.getWatchWorldContent,
    );
    this.swarming.set(true);
  }

  /** inst.flies:Remove(). */
  Remove(): void {
    this.controller?.dispose();
    this.controller = undefined;
    this.swarming.set(false);
  }
}

function bindPoop(inst: ItemEntity, world: ItemPrefabWorld): void {
  bindBurnableItem(inst, world);
  const flies = inst.component('flies', () => {
    const flies = new PoopFlies(inst, world);
    return { flies, dispose: () => flies.Remove() };
  }).flies;
  inst.ListenForEvent('ondropped', () => flies.Spawn());
  inst.ListenForEvent('onputininventory', () => flies.Remove());
  // burnable:SetOnIgniteFn(OnBurn).
  inst.ListenForEvent('onignite', () => flies.Remove());
  inst.sprite.playOnce('dump', () => {
    if (!inst.isRemoved) {
      inst.sprite.playOnce('idle');
    }
  });
  flies.Spawn();
}
