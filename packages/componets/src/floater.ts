import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import { createSignal, readonlySignal, type ReadonlySignal } from '../../signals/src';

/** TUNING.OCEAN_WETNESS: the wetness an item that lands in the ocean has at least. */
export const OCEAN_WETNESS = 75;

export type FloaterSize = 'small' | 'med' | 'large';

/** Floater:SetBankSwapOnFloat's swap_data: the build and symbol swap_spear shows, and the bank and clip it restores. */
export interface FloaterSwapData {
  readonly sym_build?: string;
  readonly sym_name?: string;
  readonly bank?: string;
  readonly anim?: string;
}

/** The inst the floater reads and writes: its position and items, the events it follows, and its AnimState. */
export interface FloaterInst {
  readonly prefab: string;
  readonly position: ReadonlyVector3;
  readonly components: {
    /** inventoryitem:IsHeld / MakeMoistureAtLeast, on an inst whose inventoryitem has them. */
    readonly inventoryitem?: { IsHeld?(): boolean; MakeMoistureAtLeast?(min: number): void };
  };
  hasTag(tag: string): boolean;
  PushEvent(name: string, data?: unknown): void;
  ListenForEvent(event: string, fn: () => void): () => void;
  /** AnimState:SetBankAndPlayAnimation. */
  readonly AnimState: { SetBank(bank: string): void; PlayAnimation(name: string, loop?: boolean): void };
  /** AnimState:SetFrame, Pause / Resume and OverrideSymbol / ClearOverrideSymbol. */
  readonly sprite: {
    setFrame(frame: number): void;
    setPaused(paused: boolean): void;
    setSymbolOverride(symbol: string, archive?: string, sourceSymbol?: string): void;
  };
}

/** TheWorld as the floater reaches it. */
export interface FloaterWorld {
  /** Map:IsOceanAtPoint(x, 0, z), which already leaves out the land's overhang (Map:IsVisualGroundAtPoint). */
  isOceanAtPoint(point: ReadonlyVector3): boolean;
  /** SpawnPrefab("splash") at `position`. */
  SpawnSplash?(position: ReadonlyVector3): void;
}

/**
 * floater.lua: an item that lands in the ocean floats. Landing there wets it, splashes and pushes
 * `floater_startfloating`; a bank-swapping item (a tool) is drawn as floating_items' floating_item with its swap
 * symbol. Taking off or being removed ends it. `floating` is the replicated `_is_landed`, which the prefab's
 * presentation follows with the float_fx ripples (OnLandedClient). The temperature penalty and its hot_splash are not
 * ported: no item here has an inventoryitemtemperature.
 */
export class Floater {
  private readonly inst: FloaterInst;
  private world?: FloaterWorld;
  size: FloaterSize = 'small';
  vert_offset?: number;
  xscale = 1;
  yscale = 1;
  zscale = 1;
  do_bank_swap = false;
  float_index = 1;
  swap_data?: FloaterSwapData;
  splash = true;
  /** AnimState:SetFloatParams' bob amount; the bobbing itself is not drawn. */
  bob_percent = 1;
  is_obstable = false;
  /** floater._is_landed / showing_effect. */
  private readonly landed = createSignal(false);
  readonly floating: ReadonlySignal<boolean> = readonlySignal(this.landed);

  constructor(inst: FloaterInst) {
    this.inst = inst;
    inst.ListenForEvent('on_landed', () => this.OnLandedServer());
    inst.ListenForEvent('on_no_longer_landed', () => this.OnNoLongerLandedServer());
    inst.ListenForEvent('onremove', () => this.OnNoLongerLandedServer());
  }

  /** TheWorld.Map and SpawnPrefab, bound with the inst's world. */
  BindWorld(world: FloaterWorld): void {
    this.world = world;
  }

  SetIsObstacle(obstacle = true): void {
    this.is_obstable = obstacle;
  }
  SetSize(size: FloaterSize): void {
    this.size = size;
  }
  SetVerticalOffset(offset: number | undefined): void {
    this.vert_offset = offset;
  }
  SetScale(scale: number | readonly [number, number, number] | undefined): void {
    if (scale === undefined) {
      return;
    }
    [this.xscale, this.yscale, this.zscale] = typeof scale === 'number' ? [scale, scale, scale] : scale;
  }
  SetBankSwapOnFloat(should_bank_swap: boolean, float_index = 1, swap_data?: FloaterSwapData): void {
    this.do_bank_swap = should_bank_swap;
    this.float_index = float_index;
    this.swap_data = swap_data;
  }
  SetSwapData(swap_data: FloaterSwapData | undefined): void {
    this.swap_data = swap_data;
  }

  ShouldShowEffect(): boolean {
    return this.world?.isOceanAtPoint(this.inst.position) ?? false;
  }

  IsFloating(): boolean {
    return this.landed.peek();
  }

  SwitchToFloatAnim(): void {
    if (!this.do_bank_swap) {
      return;
    }
    // The swap symbol goes on first: each AnimState write is drawn at once, and floating_item's frame shows nothing
    // but swap_spear, so the swapped bank is never drawn without it (the engine draws only at the end of the frame).
    const swap = this.swap_data;
    if (swap?.sym_build !== undefined) {
      // OverrideSymbol from the swap build, one of the item's ANIM assets. OverrideItemSkinSymbol's skin build is not
      // drawn: a sprite resolves overrides only from its own declared builds, so a skinned tool floats unskinned.
      this.inst.sprite.setSymbolOverride('swap_spear', `${swap.sym_build}.zip`, swap.sym_name ?? swap.sym_build);
    }
    this.inst.AnimState.SetBank('floating_item');
    this.inst.AnimState.PlayAnimation(this.float_index < 0 ? 'left' : 'right');
    // AnimState:SetFrame takes the whole frame of a fractional index.
    this.inst.sprite.setFrame(Math.floor(Math.abs(this.float_index)));
    this.inst.sprite.setPaused(true);
  }

  SwitchToDefaultAnim(force_switch = false): void {
    if (!this.do_bank_swap && !force_switch) {
      return;
    }
    this.inst.AnimState.SetBank(this.swap_data?.bank ?? this.inst.prefab);
    this.inst.AnimState.PlayAnimation(this.swap_data?.anim ?? 'idle');
    this.inst.sprite.setPaused(false);
    if (this.swap_data !== undefined) {
      this.inst.sprite.setSymbolOverride('swap_spear');
    }
  }

  OnLandedServer(): void {
    if (this.landed.peek() || !this.ShouldShowEffect()) {
      return;
    }
    const inventoryitem = this.inst.components.inventoryitem;
    const held = inventoryitem?.IsHeld?.() ?? false;
    if (inventoryitem && !held && !this.inst.hasTag('likewateroffducksback')) {
      inventoryitem.MakeMoistureAtLeast?.(OCEAN_WETNESS);
    }
    if (this.splash && !held) {
      this.world?.SpawnSplash?.(this.inst.position);
    }
    this.inst.PushEvent('floater_startfloating');
    this.landed.set(true);
    this.SwitchToFloatAnim();
  }

  OnNoLongerLandedServer(): void {
    if (!this.landed.peek()) {
      return;
    }
    this.inst.PushEvent('floater_stopfloating');
    this.landed.set(false);
    this.SwitchToDefaultAnim();
  }
}
