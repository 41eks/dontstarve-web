import type { BookResult } from './book';

export interface ReaderInst {
  addTag(tag: string): void;
  removeTag(tag: string): void;
}

export interface ReadableBook<Reader, World> {
  readonly components: { book?: { OnRead(reader: Reader, world: World): BookResult } };
}

/** components/reader.lua for non-bookworm readers; peruse requires the unported aspiring_bookworm branch. */
export class Reader<Inst extends ReaderInst, World> {
  private readonly inst: Inst;
  private sanityMult?: number;
  private onread?: (inst: Inst, book: ReadableBook<Inst, World>) => void;

  constructor(inst: Inst) {
    this.inst = inst;
    inst.addTag('reader');
  }

  SetSanityPenaltyMultiplier(mult: number | undefined): void { this.sanityMult = mult; }
  getSanityPenaltyMultiplier(): number { return this.sanityMult ?? 1; }
  SetOnReadFn(fn: ((inst: Inst, book: ReadableBook<Inst, World>) => void) | undefined): void { this.onread = fn; }

  Read(book: ReadableBook<Inst, World>, world: World): BookResult | undefined {
    if (!book.components.book) return undefined;
    const result = book.components.book.OnRead(this.inst, world);
    if (result[0]) this.onread?.(this.inst, book);
    return result;
  }

  OnRemoveFromEntity(): void { this.inst.removeTag('reader'); }
}
