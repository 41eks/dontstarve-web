import type { WilsonStateGraph } from './SGwilson.ts';
import { bindActionCancellation } from './actionEvents.ts';
import type { ActionLocomotor, ActionWorldContext } from './actionContext.ts';
import { BufferedAction, type BufferedActionObject } from './bufferedaction.ts';

/** An inventory instrument: the BufferedAction invobject plus ACTIONS.PLAY.fn's instrument:Play call. */
export interface PlaySource {
  readonly instrument: BufferedActionObject;
  isValid(): boolean;
  play(): boolean;
}

/** componentactions.lua instrument INVENTORY → ACTIONS.PLAY, buffered into SGwilson's play_flute state. */
export class PlayActionController {
  private readonly stopActionEvents: () => void;
  private version = 0;
  private disposed = false;
  private readonly world: ActionWorldContext;
  private readonly stategraph: WilsonStateGraph;
  private readonly locomotor: Pick<ActionLocomotor, 'stop'>;
  private readonly isInterrupting: () => boolean;

  constructor(world: ActionWorldContext, stategraph: WilsonStateGraph,
    locomotor: Pick<ActionLocomotor, 'stop'>, isInterrupting = () => false) {
    this.world = world; this.stategraph = stategraph; this.locomotor = locomotor; this.isInterrupting = isInterrupting;
    this.stopActionEvents = bindActionCancellation(world, this, 'play', () => this.cancel());
  }

  /** INVENTORY instrument action: any item with an instrument component. */
  static canPlay(item: { readonly components: { instrument?: unknown } }): boolean {
    return item.components.instrument !== undefined;
  }

  play(source: PlaySource): boolean {
    if (this.disposed || !source.isValid()) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'PLAY' });
    const version = this.version;
    this.locomotor.stop();
    return this.stategraph.pushBufferedAction(new BufferedAction('PLAY',
      () => version === this.version && source.isValid() && source.play(), undefined, { invobject: source.instrument }));
  }

  cancel(): void {
    this.version++;
    this.stategraph.cancelAction('PLAY');
  }

  /** PlayerController input interrupts the playing state only after it drops "busy". */
  update(): void {
    if (this.stategraph.isPerformingAction('PLAY') && !this.stategraph.hasStateTag('busy') && this.isInterrupting()) this.cancel();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopActionEvents();
    this.cancel();
  }
}
