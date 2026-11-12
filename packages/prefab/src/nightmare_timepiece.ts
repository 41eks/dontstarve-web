import { Inspectable } from '../../componets/src/inspectable';
import { addComponent } from './components';
import type { ItemHolder } from '../../componets/src/inventoryitem';
import { InventoryStore, type ItemEntity, type ItemRuntimeComponent } from '@dontstarve-web/inventory';
import type { ArchiveSpriteCommands } from '@dontstarve-web/display';
import { createEffect, getBoundWatchWorldContent, WorldContentKey, type WorldContentSignal, type WorldNightmarePhase } from '@dontstarve-web/signals';
import catalog from './groundItems.json' with { type: 'json' };

export const NIGHTMARE_TIMEPIECE_ID = 'nightmare_timepiece';
const IMAGES = catalog.items.nightmare_timepiece.inventoryImageVariants;

const DEFAULT_STATE = { anim: 'idle_1', inventory: IMAGES['nightmare_timepiece.tex'] };
const STATES: Partial<Record<WorldNightmarePhase, typeof DEFAULT_STATE>> = {
  calm: DEFAULT_STATE,
  warn: { anim: 'idle_2', inventory: IMAGES['nightmare_timepiece_warn.tex'] },
  wild: { anim: 'idle_3', inventory: IMAGES['nightmare_timepiece_nightmare.tex'] },
  dawn: DEFAULT_STATE,
};

export type NightmareTimepieceStatus = 'WARN' | 'CALM' | 'DAWN' | 'NOMAGIC' | 'WAXING' | 'STEADY' | 'WANING';

/** nightmare_timepiece.lua inst._owner: the watch's grand owner, which carries the nightmaretracker tag. */
type TrackerOwner = ItemHolder & { addTag(tag: string): void; removeTag(tag: string): void };

function isTracker(owner: ItemHolder | null): owner is TrackerOwner {
  return !!owner && 'addTag' in owner && typeof owner.addTag === 'function'
    && 'removeTag' in owner && typeof owner.removeTag === 'function';
}

/** owner.components.inventory:Has(prefab, 1); an owner without an inventory (a chest) has none. */
function holds(owner: TrackerOwner, prefab: string): boolean {
  const inventory = owner.components && 'inventory' in owner.components ? owner.components.inventory : undefined;
  return inventory instanceof InventoryStore && inventory.Has(prefab, 1);
}

class NightmareTimepiece implements ItemRuntimeComponent {
  private readonly entity: ItemEntity;
  private phase?: WorldContentSignal<WorldNightmarePhase>;
  private stopWorld: (() => void)[] = [];
  private owner?: TrackerOwner;
  private readonly stopEvents: (() => void)[];

  constructor(entity: ItemEntity) {
    this.entity = entity;
    this.bindWorld();
    this.stopEvents = [
      entity.ListenForEvent('onputininventory', () => this.topocket()),
      entity.ListenForEvent('ondropped', () => this.toground()),
      entity.ListenForEvent('onremove', () => this.toground()),
    ];
  }

  /** A saved item is built before its world exists; binding the item to a world is when the watch can follow one. */
  BindScheduler(): void { this.bindWorld(); }

  private bindWorld(): void {
    this.stopWorld.splice(0).forEach(stop => stop());
    this.phase = getBoundWatchWorldContent()?.(WorldContentKey.NightmarePhase, stop => this.stopWorld.push(stop));
    const phase = this.phase;
    if (phase) this.stopWorld.push(createEffect(() => this.OnNightmarePhaseChanged(phase.get())));
    else this.OnNightmarePhaseChanged('none');
  }

  private stateOf(phase: WorldNightmarePhase) { return STATES[phase] ?? DEFAULT_STATE; }

  private OnNightmarePhaseChanged(phase: WorldNightmarePhase): void {
    const { anim, inventory } = this.stateOf(phase);
    this.entity.sprite.playOnce(anim);
    this.entity.components.inventoryitem.ChangeImageName(inventory.icon, inventory.atlas);
  }

  /** A new ground visual starts from the catalog's clip; the watch keeps showing its phase. */
  Declare(sprite: ArchiveSpriteCommands): void { sprite.playOnce(this.stateOf(this.phase?.peek() ?? 'none').anim); }

  GetStatus(): NightmareTimepieceStatus {
    const phase = this.phase?.peek() ?? 'none';
    if (phase === 'warn') return 'WARN';
    if (phase === 'calm') return 'CALM';
    if (phase === 'dawn') return 'DAWN';
    if (phase !== 'wild') return 'NOMAGIC';
    const timeinphase = this.phase?.nightmareclock?.GetTimeInPhase() ?? 0;
    return timeinphase < .33 ? 'WAXING' : timeinphase < .66 ? 'STEADY' : 'WANING';
  }

  private toground(): void {
    const owner = this.owner;
    if (!owner) return;
    this.owner = undefined;
    if (!holds(owner, this.entity.prefab)) owner.removeTag('nightmaretracker');
  }

  /** topocket: owner.components.inventoryitem:GetGrandOwner(), through a held backpack to whoever holds it. */
  private topocket(): void {
    // A backpack lying on the ground has no grand owner of its own; it is then the owner.
    const item = this.entity.components.inventoryitem, grand = item.GetGrandOwner() ?? item.owner;
    const owner = isTracker(grand) ? grand : undefined;
    if (owner === this.owner) return;
    this.toground();
    owner?.addTag('nightmaretracker');
    this.owner = owner;
  }

  dispose(): void {
    this.stopEvents.forEach(stop => stop());
    this.stopWorld.splice(0).forEach(stop => stop());
  }
}

export function configureNightmareTimepieceEntity(entity: ItemEntity): void {
  const timepiece = entity.component('nightmare_timepiece', () => new NightmareTimepiece(entity));
  addComponent(entity, 'inspectable', Inspectable).getstatus = () => timepiece.GetStatus();
}

export function declareNightmareTimepieceSprite(entity: ItemEntity, sprite: ArchiveSpriteCommands): void {
  entity.getComponent<NightmareTimepiece>('nightmare_timepiece')?.Declare(sprite);
}
