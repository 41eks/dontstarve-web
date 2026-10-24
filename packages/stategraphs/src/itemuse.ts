import type { SoundHandle } from '../../prefab/src/sound.ts';
import * as THREE from 'three';
import { BufferedAction } from './bufferedaction.ts';
import { bindActionCancellation } from './actionEvents.ts';
import type { ActionAnimationController, ActionLocomotor, ActionWorldContext } from './actionContext.ts';
import type { ComponentActionEntity } from './componentactions.ts';
import type { MouseActionCandidate } from './playeractionpicker.ts';
import { PlayerActionPicker } from './playeractionpicker.ts';
import { PointerRaycaster } from './pointerRaycaster.ts';
import type { TradeItem } from '../../componets/src/trader';
import type { FuelItem } from '../../componets/src/fuel';

export interface ItemUseSource {
  readonly entity: TradeItem;
  isValid(): boolean;
  /** Delete a consumed item, or detach the same inst for a trader with deleteitemonaccept=false. */
  take(deleteItem: boolean): boolean;
  /** actions.lua ADDFUEL removes one live inst before passing it to fueled. */
  extractFuel?(): FuelItem | null;
  returnFuel?(item: FuelItem): void;
}
export interface ItemUseTarget extends ComponentActionEntity {
  readonly model: THREE.Object3D;
  getPosition(): THREE.Vector3;
  /** Obstacle radius: the doer stops outside it, so reach is measured from its edge. */
  getPhysicsRadius?(): number;
}
type ItemUseAction = 'FEED' | 'GIVE' | 'REPAIR' | 'SHAVE' | 'STORE' | 'ADDFUEL' | 'ADDWETFUEL' | 'FERTILIZE' | 'BATHBOMB';
export const ITEM_USE_REACH = 4;

function available(action: ItemUseAction, target: ItemUseTarget, source: ItemUseSource): boolean {
  if (target.isRemoved || target.hasTag('burnt') || target.hasTag('INLIMBO') || !source.isValid()) return false;
  // componentactions.lua USEITEM.bathbomb: the bathbomb tag on the item, bathbombable on the target.
  if (action === 'FEED') return target.hasTag('small_livestock') && !!target.components.eater?.CanEat(source.entity);
  if (action === 'BATHBOMB') return source.entity.hasTag('bathbomb') && target.hasTag('bathbombable');
  if (action === 'FERTILIZE') return !!source.entity.components?.fertilizer && !!target.components.pickable?.CanBeFertilized();
  if (action === 'REPAIR') return !!target.components.repairable?.CanRepair(source.entity);
  if (action === 'ADDFUEL' || action === 'ADDWETFUEL') return !!source.extractFuel && !!source.returnFuel
    && !!target.components.fueled?.CanAcceptFuelItem({ components: source.entity.components ?? {} });
  // componentactions.lua shaver: the bearded tag alone offers SHAVE; the state reports why it fails.
  if (action === 'SHAVE') return target.hasTag('bearded') && !!target.components.beard && !!source.entity.components?.shaver;
  // componentactions.lua USEITEM.occupier: the occupiable only offers STORE to a matching occupier.
  if (action === 'STORE') return !!target.components.occupiable?.CanOccupy(source.entity);
  return !!target.components.trader?.AbleToAccept(source.entity).ok;
}

/** USEITEM.fuel / repairer / tradable: discover actions from components, never from prefab IDs. */
export function getItemUseActions(scene: THREE.Scene, source: ItemUseSource | undefined): MouseActionCandidate[] {
  if (!source) return [];
  const actions: MouseActionCandidate[] = [];
  scene.traverse(model => {
    const target = model.userData.actionEntity as ItemUseTarget | undefined;
    if (!target) return;
    if (source.entity.components?.fertilizer && target.hasTag('barren')) actions.push({
      action: { action: 'FERTILIZE', target, invobject: source.entity }, button: 'left',
      model, source: 'inventory', available: available('FERTILIZE', target, source) });
    if (source.entity.hasTag('bathbomb') && target.hasTag('bathbombable')) actions.push({
      action: { action: 'BATHBOMB', target, invobject: source.entity }, button: 'left',
      model, source: 'inventory', available: available('BATHBOMB', target, source) });
    const fueltype = source.entity.components?.fuel?.fueltype;
    if (fueltype && source.entity.hasTag(`${fueltype}_fuel`) && target.hasTag(`${fueltype}_fueled`)) {
      const action = source.entity.GetIsWet?.() ? 'ADDWETFUEL' : 'ADDFUEL';
      actions.push({ action: { action, target, invobject: source.entity }, button: 'left',
        model, source: 'inventory', available: available(action, target, source) });
    }
    if (target.components.repairable && source.entity.components?.repairer) {
      actions.push({ action: { action: 'REPAIR', target, invobject: source.entity }, button: 'right',
        model, source: 'inventory', available: available('REPAIR', target, source) });
    }
    if (source.entity.components?.shaver && target.hasTag('bearded') && !target.hasTag('spiderden')) {
      actions.push({ action: { action: 'SHAVE', target, invobject: source.entity }, button: 'left',
        model, source: 'inventory', available: available('SHAVE', target, source) });
    }
    // componentactions.lua USEITEM.occupier: the occupant's type tag must match the cage's occupiable type.
    const occupantType = target.components.occupiable?.occupanttype;
    if (occupantType !== undefined && source.entity.hasTag(occupantType)) actions.push({
      action: { action: 'STORE', modifier: target.prefab === 'birdcage' ? 'IMPRISON' : undefined, target, invobject: source.entity },
      button: 'left', model, source: 'inventory', available: available('STORE', target, source) });
    if (target.components.trader) actions.push({ action: { action: 'GIVE', target, invobject: source.entity },
      button: 'left', model, source: 'inventory', available: available('GIVE', target, source) });
  });
  return actions;
}

/** Common locomotor + buffered item action. SGwilson owns the commit frame and cancellation. */
export class ItemUseActionController {
  private readonly picker: PlayerActionPicker;
  private readonly unregister: () => void;
  private readonly stopEvents: () => void;
  private readonly stopActiveItem: () => void;
  private pending?: { action: ItemUseAction; target: ItemUseTarget; source: ItemUseSource };
  private buffered?: BufferedAction<ItemUseAction>;
  private disposed = false;
  private version = 0;
  private ready = true;
  private sound?: SoundHandle;
  private fertilizerSounds?: Pick<typeof import('../../prefab/src/sound.ts'), 'PlaySound'>;
  private readonly world: ActionWorldContext;
  private readonly animation: ActionAnimationController;
  private readonly locomotor: ActionLocomotor;
  private readonly source: () => ItemUseSource | undefined;
  private readonly interrupted: () => boolean;
  constructor(world: ActionWorldContext, animation: ActionAnimationController, locomotor: ActionLocomotor,
    source: () => ItemUseSource | undefined, interrupted = () => false) {
    this.world = world; this.animation = animation; this.locomotor = locomotor;
    this.source = source; this.interrupted = interrupted;
    this.picker = world.mouseActions ?? new PlayerActionPicker(new PointerRaycaster(world));
    this.unregister = this.picker.register(() => getItemUseActions(world.scene, source()));
    this.stopActiveItem = this.picker.registerActiveItemSource(() => source() !== undefined);
    this.stopEvents = bindActionCancellation(world, this, 'itemuse', () => this.cancel());
    world.renderer.domElement.addEventListener('pointerdown', this.pointerDown, true);
    window.addEventListener('keydown', this.keyDown);
  }
  request(action: ItemUseAction, target: ItemUseTarget, source = this.source()): boolean {
    if (this.disposed || !source || !available(action, target, source)
      || this.animation.stategraph.hasStateTag('busy')) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action });
    this.animation.cancelEmote();
    this.pending = { action, target, source };
    this.ready = action !== 'FERTILIZE';
    if (!this.ready) {
      const version = this.version;
      void import('../../prefab/src/sound.ts').then(async sounds => {
        await sounds.PreloadSounds('dontstarve/common/fertilize');
        if (!this.disposed && version === this.version) { this.fertilizerSounds = sounds; this.ready = true; }
      }).catch(error => { if (version === this.version) this.cancel(); console.error('Unable to prepare fertilizer sound', error); });
    }
    return true;
  }
  update(): void {
    if (this.disposed) return;
    if (this.interrupted()) { this.cancel(); return; }
    if (this.buffered && !this.animation.stategraph.isActionActive(this.buffered)) { this.cancel(); return; }
    const pending = this.pending;
    if (!pending) return;
    const { action, target, source } = pending;
    if (!available(action, target, source)) { this.cancel(); return; }
    const position = target.getPosition();
    if (!this.inReach(target)) {
      const direction = this.world.player.position.clone().sub(position).normalize();
      const destination = position.clone().addScaledVector(direction, (ITEM_USE_REACH + (target.getPhysicsRadius?.() ?? 0)) * .8);
      if (!this.locomotor.destination || this.locomotor.destination.distanceToSquared(destination) > .01) {
        if (!this.locomotor.goToPoint(destination)) this.cancel();
      }
      return;
    }
    this.locomotor.stop();
    if (!this.ready) return;
    const direction = position.clone().sub(this.world.player.position);
    const forward = new THREE.Vector3(); this.world.camera.getWorldDirection(forward); forward.setY(0).normalize();
    const side = direction.dot(new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)));
    const depth = direction.dot(forward);
    this.animation.setFacing(Math.abs(depth) >= Math.abs(side) ? (depth > 0 ? 'up' : 'down') : 'side',
      Math.abs(side) > Math.abs(depth) && side < 0);
    const version = this.version;
    const buffered = new BufferedAction(action, () => action === 'ADDFUEL' || action === 'ADDWETFUEL'
      ? this.addFuel(target, source)
      : action === 'FERTILIZE' ? this.fertilize(target, source)
      : action === 'FEED' ? target.components.eater!.Eat(source.entity, () => source.take(true), this.world.player)
      : action === 'BATHBOMB' ? this.bathbomb(target, source)
      : action === 'STORE'
      // actions.lua STORE: Occupy(inventoryitem:RemoveFromOwner()) — the same inst leaves the cursor.
      ? source.take(false) && target.components.occupiable!.Occupy(source.entity)
      : action === 'REPAIR'
      ? target.components.repairable!.Repair(source.entity, () => source.take(true))
      : action === 'SHAVE' ? target.components.beard!.Shave(undefined).ok
        : target.components.trader!.AcceptGift(source.entity, deleteItem => source.take(deleteItem), this.world.player),
    () => version === this.version && available(action, target, source) && this.inReach(target),
    { target, invobject: source.entity });
    if (this.animation.stategraph.pushBufferedAction(buffered)) {
      this.buffered = buffered;
      this.pending = undefined;
    }
  }
  private inReach(target: ItemUseTarget): boolean {
    const position = target.getPosition(), player = this.world.player.position;
    return position.distanceToSquared(player) <= (ITEM_USE_REACH + (target.getPhysicsRadius?.() ?? 0)) ** 2;
  }
  private fertilize(target: ItemUseTarget, source: ItemUseSource): boolean {
    if (!target.components.pickable?.Fertilize(source.entity)) return false;
    const fertilizer = source.entity.components!.fertilizer!;
    if (!fertilizer.OnApplied(() => source.take(true))) return false;
    this.sound?.stop(); this.sound = this.fertilizerSounds!.PlaySound(fertilizer.fertilize_sound, this.world.player.position);
    return true;
  }
  /** actions.lua BATHBOMB: the target reacts first, then the doer's inventory loses the item. */
  private bathbomb(target: ItemUseTarget, source: ItemUseSource): boolean {
    const bathbombable = target.components.bathbombable;
    if (!bathbombable?.can_be_bathbombed || !source.entity.components?.bathbomb) return false;
    bathbombable.OnBathBombed(source.entity, this.world.player);
    source.take(true);
    return true;
  }
  private addFuel(target: ItemUseTarget, source: ItemUseSource): boolean {
    const item = source.extractFuel?.();
    if (!item) return false;
    if (target.components.fueled?.TakeFuelItem(item)) return true;
    source.returnFuel?.(item);
    return false;
  }
  cancel(): void {
    this.version++;
    if (this.pending || (this.buffered && this.animation.stategraph.isActionActive(this.buffered))) this.locomotor.stop();
    this.pending = undefined;
    if (this.buffered && this.animation.stategraph.isActionActive(this.buffered)) this.animation.stategraph.cancelAction(this.buffered.action);
    this.buffered = undefined;
  }
  private readonly pointerDown = (event: PointerEvent): void => {
    if (this.disposed || event.defaultPrevented || event.button > 2 || event.button === 1) return;
    this.picker.pointer.trackPointer(event);
    const actions = this.picker.getMouseActions(), action = event.button === 0 ? actions.left : actions.right;
    if ((action?.action !== 'GIVE' && action?.action !== 'REPAIR' && action?.action !== 'SHAVE' && action?.action !== 'STORE'
      && action?.action !== 'FERTILIZE' && action?.action !== 'BATHBOMB' && action?.action !== 'ADDFUEL' && action?.action !== 'ADDWETFUEL') || !action.target) { this.cancel(); return; }
    event.preventDefault(); event.stopImmediatePropagation();
    this.request(action.action, action.target as ItemUseTarget);
  };
  private readonly keyDown = (event: KeyboardEvent): void => { if (event.code === 'Escape') this.cancel(); };
  dispose(): void {
    if (this.disposed) return;
    this.cancel(); this.disposed = true;
    this.sound?.stop();
    this.unregister(); this.stopEvents(); this.stopActiveItem();
    this.world.renderer.domElement.removeEventListener('pointerdown', this.pointerDown, true);
    window.removeEventListener('keydown', this.keyDown);
    if (this.picker !== this.world.mouseActions) this.picker.dispose();
  }
}
