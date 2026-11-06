import type { InventoryActor } from '../../componets/src/inventoryitem';
import type { ItemEntity, ItemRuntimeComponent } from '@dontstarve-web/inventory';
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

/** The source's owner: the inventory's actor, once the store's slot says it holds the watch itself. */
type TrackerOwner = InventoryActor & {
  addTag(tag: string): void;
  removeTag(tag: string): void;
  components: { inventory: { Has(prefab: string, amount?: number): boolean; isHeldByActor(address: { containerId: string }): boolean } };
};

function trackerOwner(owner: InventoryActor | undefined, entity: ItemEntity): TrackerOwner | undefined {
  const tracker = owner as Partial<TrackerOwner> | undefined;
  const address = entity.components.inventoryitem.owner?.address;
  return address && tracker?.addTag && tracker.components?.inventory?.isHeldByActor(address) ? tracker as TrackerOwner : undefined;
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
      entity.ListenForEvent('onputininventory', owner => this.topocket(owner as InventoryActor)),
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
    if (!owner.components.inventory.Has(this.entity.prefab, 1)) owner.removeTag('nightmaretracker');
  }

  private topocket(doer: InventoryActor): void {
    const owner = trackerOwner(doer, this.entity);
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
  Object.assign(entity.components, { inspectable: { getstatus: () => timepiece.GetStatus() } });
}

export function declareNightmareTimepieceSprite(entity: ItemEntity, sprite: ArchiveSpriteCommands): void {
  entity.getComponent<NightmareTimepiece>('nightmare_timepiece')?.Declare(sprite);
}
