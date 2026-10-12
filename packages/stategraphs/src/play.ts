import { bindActionCancellation } from './actionEvents.ts';
import type { ActionAnimationController, ActionLocomotor, ActionWorldContext } from './actionContext.ts';
import type { BufferedActionObject } from './bufferedaction.ts';

/** An inventory instrument: the BufferedAction invobject plus ACTIONS.PLAY.fn's instrument:Play call. */
export interface PlaySource {
  readonly instrument: BufferedActionObject;
  /** The dynamic/*.zip archive of the instrument's skin, whose pan_flute01 symbol replaces the stock one. */
  readonly skinArchive?: string;
  isValid(): boolean;
  play(): boolean;
}

/** componentactions.lua instrument INVENTORY → ACTIONS.PLAY, buffered into SGwilson's play_flute state. */
export class PlayActionController {
  private readonly stopActionEvents: () => void;
  private version = 0;
  private disposed = false;
  private readonly world: ActionWorldContext;
  private readonly animation: ActionAnimationController;
  private readonly locomotor: Pick<ActionLocomotor, 'stop'>;
  private readonly isInterrupting: () => boolean;

  constructor(world: ActionWorldContext, animation: ActionAnimationController,
    locomotor: Pick<ActionLocomotor, 'stop'>, isInterrupting = () => false) {
    this.world = world; this.animation = animation; this.locomotor = locomotor; this.isInterrupting = isInterrupting;
    this.stopActionEvents = bindActionCancellation(world, this, 'play', () => this.cancel());
  }

  /** INVENTORY instrument action: any item with an instrument component. */
  static canPlay(item: { readonly components: { instrument?: unknown } }): boolean {
    return item.components.instrument !== undefined;
  }

  async play(source: PlaySource): Promise<boolean> {
    if (this.disposed || !source.isValid()) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'PLAY' });
    const version = this.version;
    await this.animation.prepareFlute(source.skinArchive);
    if (this.disposed || version !== this.version || !source.isValid()) return false;
    this.locomotor.stop();
    return this.animation.playFlute(source.instrument, () => version === this.version && source.isValid() && source.play());
  }

  cancel(): void {
    this.version++;
    this.animation.cancelPlay();
  }

  /** PlayerController input interrupts the playing state only after it drops "busy". */
  update(): void {
    if (this.animation.isPlayingInstrument && !this.animation.stategraph.hasStateTag('busy') && this.isInterrupting()) this.cancel();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopActionEvents();
    this.cancel();
  }
}
