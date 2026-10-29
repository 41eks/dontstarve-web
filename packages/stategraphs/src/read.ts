import { bindActionCancellation } from './actionEvents.ts';
import type { ActionAnimationController, ActionLocomotor, ActionWorldContext } from './actionContext.ts';
import type { BufferedActionObject } from './bufferedaction.ts';

/** An inventory book: the BufferedAction invobject plus ACTIONS.READ.fn's reader:Read call. */
export interface ReadSource {
  readonly book: BufferedActionObject;
  isValid(): boolean;
  read(): boolean;
}

/** componentactions.lua book INVENTORY → ACTIONS.READ, buffered into SGwilson's book state. */
export class ReadActionController {
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
    this.stopActionEvents = bindActionCancellation(world, this, 'read', () => this.cancel());
  }

  /** INVENTORY book action: any item with a book component, for doers tagged by reader. */
  static canRead(doer: { hasTag(tag: string): boolean }, item: { readonly components: { book?: unknown } }): boolean {
    return item.components.book !== undefined && doer.hasTag('reader');
  }

  async read(source: ReadSource): Promise<boolean> {
    if (this.disposed || !source.isValid()) return false;
    this.cancel();
    this.world.actionEvents?.emit('action:begin', { owner: this, action: 'READ' });
    const version = this.version;
    if (this.disposed || version !== this.version || !source.isValid()) return false;
    this.locomotor.stop();
    return this.animation.playRead(source.book, () => version === this.version && source.isValid() && source.read());
  }

  cancel(): void {
    this.version++;
    this.animation.cancelRead();
  }

  /** PlayerController input interrupts the book state only after it drops "busy". */
  update(): void {
    if (this.animation.isReading && !this.animation.stategraph.hasStateTag('busy') && this.isInterrupting()) this.cancel();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stopActionEvents();
    this.cancel();
  }
}
