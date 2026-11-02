import type { WilsonStateGraph } from './SGwilson.ts';
import { bindActionCancellation } from './actionEvents.ts';
import type { ActionWorldContext, ActionLocomotor } from './actionContext.ts';
import { BufferedAction } from './bufferedaction.ts';
import type { InventoryStore, ItemEntity } from '@dontstarve-web/inventory';
import type { Eater } from '../../componets/src/eater';

interface FoodActor {
  readonly components: { inventory?: Pick<InventoryStore, 'getEntity'>; eater?: Eater };
}

/** Inventory EAT requests; SGwilson owns the commit frame. Seed selection uses the inventory's active item. */
export class FoodActionController {
  private readonly stopActionEvents: () => void;
  private version = 0;
  private disposed = false;
  private readonly world: ActionWorldContext;
  private readonly stategraph: WilsonStateGraph;
  private readonly locomotor: ActionLocomotor;
  private readonly actor: FoodActor;
  private readonly isManualMovement: () => boolean;

  constructor(
    world: ActionWorldContext,
    stategraph: WilsonStateGraph,
    locomotor: ActionLocomotor,
    actor: FoodActor,
    isManualMovement = () => false,
  ) {
    this.world = world; this.stategraph = stategraph; this.locomotor = locomotor;
    this.actor = actor; this.isManualMovement = isManualMovement;
    this.stopActionEvents = bindActionCancellation(world, this, () => this.cancel());
    world.renderer.domElement.addEventListener('pointerdown', this.handlePointerDown, true);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  eat(food: ItemEntity): boolean {
    const eater = this.actor.components.eater;
    if (this.disposed || !this.isValid(food) || !eater?.CanEat(food)) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'EAT' });
    const version = this.version;
    this.locomotor.stop(); this.stategraph.cancelEmote();
    return this.stategraph.pushBufferedAction(new BufferedAction('EAT',
      () => version === this.version && this.isValid(food) && eater.Eat(food), undefined, { invobject: food }),
    food.hasTag('fooddrink'));
  }

  /** BufferedAction keeps the invobject entity; moving slots or changing skin preserves its identity. */
  private isValid(item: ItemEntity): boolean {
    const owner = item.components.inventoryitem.owner;
    return !item.isRemoved && !!owner && this.actor.components.inventory?.getEntity(owner.address) === item;
  }

  cancel(): void {
    this.version++;
    this.stategraph.cancelAction('EAT');
  }

  update(): void { if (this.isManualMovement()) this.cancel(); }

  private readonly handlePointerDown = (event: PointerEvent): void => {
    if (!event.defaultPrevented && (event.button === 0 || event.button === 2)) this.cancel();
  };
  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape') this.cancel();
  };

  dispose(): void {
    if (this.disposed) return;
    this.stopActionEvents();
    this.disposed = true;
    this.cancel();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.handlePointerDown, true);
    window.removeEventListener('keydown', this.handleKeyDown);
  }
}
