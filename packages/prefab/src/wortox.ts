import { batch, createMemo, createSignal, readonlySignal } from '@dontstarve-web/signals';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ComponentTimer } from '../../componets/src/timer';
import type { InventoryStore } from '@dontstarve-web/inventory';
import { MakePlayerCharacter, type PlayerInstance } from './player_common';

export interface WortoxSave {
  freehops: number;
  soulhopcost: number;
}
export const WORTOX_FREEHOP_TIMELIMIT = 5;
export const WORTOX_FREEHOP_HOPSPERSOUL = 2;

/** wortox.lua's unupgraded portal-hop accounting. Soul-count admission is intentionally bypassed. */
export class Wortox {
  private readonly counter = createSignal(0);
  private readonly cost = createSignal(0);
  readonly freeHops = readonlySignal(this.counter);
  readonly soulHopCost = readonlySignal(this.cost);
  private readonly echo = createMemo(() => this.counter.get() > 0);
  readonly hasSoulEcho = readonlySignal(this.echo);
  private readonly finishTimer: ComponentTimer;
  readonly echoTimer;
  private disposed = false;

  private readonly inventory: Pick<InventoryStore, 'ConsumeByName'>;
  constructor(scheduler: GameTimeScheduler, inventory: Pick<InventoryStore, 'ConsumeByName'>) {
    this.inventory = inventory;
    this.finishTimer = new ComponentTimer(scheduler, () => this.FinishPortalHop());
    this.echoTimer = this.finishTimer.snapshot;
  }

  TryToPortalHop(consumeall = false): boolean {
    if (this.disposed) {
      return false;
    }
    batch(() => {
      this.counter.set(this.counter.value + 1);
      this.cost.set(this.cost.value + 1);
      if (!consumeall && this.counter.value < WORTOX_FREEHOP_HOPSPERSOUL) {
        this.cost.set(this.cost.value - 1);
        this.finishTimer.start(WORTOX_FREEHOP_TIMELIMIT);
      } else {
        this.FinishPortalHop();
      }
    });
    return true;
  }

  FinishPortalHop(): void {
    if (this.finishTimer.snapshot.value.status === 'scheduled') {
      this.finishTimer.stop();
    }
    if (this.counter.value > 0) {
      this.inventory.ConsumeByName('wortox_soul', Math.max(Math.ceil(this.cost.value), 1));
      batch(() => {
        this.counter.set(0);
        this.cost.set(0);
      });
    }
  }

  OnSave(): WortoxSave {
    return { freehops: this.counter.value, soulhopcost: this.cost.value };
  }
  /** Lua saves the counters, not finishportalhoptask; loading does not re-arm that transient task. */
  OnLoad(data?: WortoxSave): void {
    if (!data || this.disposed) {
      return;
    }
    this.finishTimer.stop();
    batch(() => {
      this.counter.set(data.freehops);
      this.cost.set(data.soulhopcost);
    });
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.finishTimer.stop();
    this.echo.dispose();
  }
}

/** wortox.lua common_postinit: the soul eater's tags. */
function common_postinit(inst: PlayerInstance): void {
  inst.addTag('playermonster');
  inst.addTag('monster');
  inst.addTag('soulstealer');
  // souleater (from the souleater component) added to pristine state for optimization.
  inst.addTag('souleater');
}

/** wortox.lua master_postinit: ClearSoulhopCounter and inst.TryToPortalHop / FinishPortalHop, consuming from the inventory. */
function master_postinit(inst: PlayerInstance): void {
  if (!inst.scheduler) {
    return;
  }
  const wortox = new Wortox(inst.scheduler, {
    ConsumeByName: (prefab, amount) => inst.components.inventory?.ConsumeByName(prefab, amount),
  });
  inst.wortox = wortox;
  inst.onRemove(() => wortox.dispose());
}

/** wortox.lua: MakePlayerCharacter("wortox", prefabs, assets, common_postinit, master_postinit), with its ported ANIM assets. */
export const wortox = MakePlayerCharacter('wortox', ['wortox_portal.zip'], common_postinit, master_postinit);
