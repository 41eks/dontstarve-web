import { batch, createMemo, createSignal, readonlySignal } from '@dontstarve-web/signals';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { ComponentTimer } from '../../componets/src/timer';
import type { InventoryStore } from '@dontstarve-web/inventory';

export interface WortoxSave { freehops: number; soulhopcost: number }
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
    if (this.disposed) return false;
    batch(() => {
      this.counter.set(this.counter.peek() + 1);
      this.cost.set(this.cost.peek() + 1);
      if (!consumeall && this.counter.peek() < WORTOX_FREEHOP_HOPSPERSOUL) {
        this.cost.set(this.cost.peek() - 1);
        this.finishTimer.start(WORTOX_FREEHOP_TIMELIMIT);
      } else this.FinishPortalHop();
    });
    return true;
  }

  FinishPortalHop(): void {
    if (this.finishTimer.snapshot.peek().status === 'scheduled') this.finishTimer.stop();
    if (this.counter.peek() > 0) {
      this.inventory.ConsumeByName('wortox_soul', Math.max(Math.ceil(this.cost.peek()), 1));
      batch(() => { this.counter.set(0); this.cost.set(0); });
    }
  }

  OnSave(): WortoxSave { return { freehops: this.counter.peek(), soulhopcost: this.cost.peek() }; }
  /** Lua saves the counters, not finishportalhoptask; loading does not re-arm that transient task. */
  OnLoad(data?: WortoxSave): void {
    if (!data || this.disposed) return;
    this.finishTimer.stop();
    batch(() => { this.counter.set(data.freehops); this.cost.set(data.soulhopcost); });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.finishTimer.stop();
    this.echo.dispose();
  }
}
