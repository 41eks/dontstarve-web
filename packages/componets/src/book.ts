/** Lua `success, reason` from a book callback or the READ action. */
export type BookResult = readonly [success: boolean, reason?: string];

export interface BookInst {
  readonly components: { finiteuses?: { use(amount?: number): boolean } };
}

export interface BookReaderInst {
  readonly components: {
    sanity?: { DoDelta(delta: number): void };
    reader?: { getSanityPenaltyMultiplier(): number };
  };
}

/** The reader-side services components/book.lua reaches through SpawnPrefab. */
export interface BookFxWorld<Reader> {
  spawnFx?(prefab: string, reader: Reader): void;
}

/** Book callbacks receive the world services the Lua callbacks reach through globals. */
export type BookFn<Inst extends BookInst, Reader extends BookReaderInst, World> =
  (inst: Inst, reader: Reader, world: World) => BookResult;

/** The inst.components.book surface used by readers and component actions. */
export interface BookComponent {
  OnRead(reader: BookReaderInst, world: unknown): BookResult;
  dispose(): void;
}

/** components/book.lua: callbacks, finiteuses consumption and the reader's sanity penalty. */
export class Book<Inst extends BookInst, Reader extends BookReaderInst, World extends BookFxWorld<Reader>> implements BookComponent {
  private readonly inst: Inst;
  private onread?: BookFn<Inst, Reader, World>;
  private readSanity?: number;
  private fx?: string;

  constructor(inst: Inst) { this.inst = inst; }

  SetOnRead(fn: BookFn<Inst, Reader, World> | undefined): void { this.onread = fn; }
  SetReadSanity(sanity: number | undefined): void { this.readSanity = sanity; }
  /** book.lua SetFx: `fxmount` is not used because riding is not ported. */
  SetFx(fx: string | undefined): void { this.fx = fx; }

  ConsumeUse(): void { this.inst.components.finiteuses?.use(1); }

  Interact(fn: BookFn<Inst, Reader, World> | undefined, reader: Reader, world: World): BookResult {
    if (!fn) return [true];
    const result = fn(this.inst, reader, world);
    if (result[0]) this.ConsumeUse();
    return result;
  }

  DoReadPenalties(reader: Reader): void {
    reader.components.sanity?.DoDelta((this.readSanity ?? 0)
      * (reader.components.reader?.getSanityPenaltyMultiplier() ?? 1));
  }

  // The reader's stategraph owns book_fx; `fx` is the book's own effect, spawned at the reader after success.
  OnRead(reader: Reader, world: World): BookResult {
    const result = this.Interact(this.onread, reader, world);
    if (result[0] && reader.components.sanity) {
      if (this.fx !== undefined) world.spawnFx?.(this.fx, reader);
      this.DoReadPenalties(reader);
    }
    return result;
  }

  dispose(): void { this.onread = undefined; }
}
