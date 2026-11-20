import { createEffect, createSignal, readonlySignal } from '@dontstarve-web/signals';
import type { ItemEntity } from '@dontstarve-web/inventory';
import { createArchiveEntity } from './prefabInstance';
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
  private readonly fliesInstance;
  private controller?: FliesController;
  private readonly swarming = createSignal(false);
  /** Whether the flies child exists. */
  readonly active = readonlySignal(this.swarming);

  constructor(inst: ItemEntity, world: ItemPrefabWorld) {
    this.inst = inst;
    this.world = world;
    const source = world.sprites.archive(
      { animationArchive: 'flies.zip', buildArchives: ['flies.zip'], bank: 'flies' },
      { dynamicParent: true },
    );
    const flies = createArchiveEntity(
      'flies',
      source,
      { name: 'swarm_pre', billboard: true },
      'flies',
      undefined,
      inst.status,
    );
    this.fliesInstance = flies.instance;
    flies.instance.persists = false;
    flies.instance.sprite.setVisible(false);
    // The decorative child must not enlarge the manure's pickup target, whenever its sprite is drawn again.
    const stopRaycast = createEffect(() => {
      flies.instance.sprite.art.get();
      flies.display.model.traverse(object => {
        object.raycast = () => {};
      });
    });
    inst.sprite.attachFx('flies', {
      sprite: flies.instance.sprite,
      display: flies.display,
      active: this.active,
      sortLayer: 2,
    });
    inst.onRemove(() => {
      this.Remove();
      inst.sprite.detachFx('flies');
      stopRaycast();
      flies.instance.remove();
      flies.display.dispose();
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
