import { Group, MathUtils, type Vector3, type Vector3Like } from 'three';
import { markTransformDirty, TransformRoot, type ReadonlyVector3 } from '@dontstarve-web/animation/transformRoot';
import type { Memo, TileStateQuery } from '@dontstarve-web/signals';
import { TileTracker } from '../../componets/src/tileManager';

export type { ReadonlyVector3 };

export type TransformDirtyHandler = (model: Group) => void;

/** Entity-owned transform. Display borrows the root and owns the visuals attached beneath it. */
export class Transform {
  readonly #model: Group;
  readonly #onDirty: TransformDirtyHandler;
  #tracker?: TileTracker;
  readonly #areas = new Map<TileStateQuery, { area: Memo<boolean> | undefined; owners: number }>();
  readonly #syncTile = () => { this.#tracker?.sync(); };

  constructor(onDirty: TransformDirtyHandler = markTransformDirty, model = new Group()) {
    this.#model = model;
    this.#onDirty = onDirty;
    this.#model.addEventListener('added', this.#syncTile);
  }

  /** A stationary entity retains the existing marked matrix-update contract. */
  static stationary(): Transform { return new Transform(markTransformDirty, new TransformRoot()); }

  /** Root passed to display; logical code uses the transform methods. */
  get model(): Group { return this.#model; }
  get position(): ReadonlyVector3 { return this.#model.position; }
  get scale(): Vector3 { return this.#model.scale; }
  get tileTracker(): TileTracker { return this.#tracker ??= new TileTracker(() => this.position); }
  /** Lua Transform rotation is a heading in degrees. */
  get rotation(): number { return MathUtils.radToDeg(this.#model.rotation.y); }

  setPosition(x: number, y: number, z: number): void {
    this.#model.position.set(x, y, z);
    this.#tracker?.sync();
    this.markDirty();
  }

  /** Transform:SetPosition(pt:Get()). */
  copyPosition(point: Vector3Like): void { this.setPosition(point.x, point.y, point.z); }

  offsetPosition(dx: number, dy: number, dz: number): void {
    const position = this.position;
    this.setPosition(position.x + dx, position.y + dy, position.z + dz);
  }

  setRotation(degrees: number): void {
    this.#model.rotation.y = MathUtils.degToRad(degrees);
    this.markDirty();
  }

  setScale(x: number, y = x, z = x): void {
    this.#model.scale.set(x, y, z);
    this.markDirty();
  }

  /** Shared entry for logical writes and display-local transform changes. */
  markDirty(): void {
    this.#model.matrixWorldNeedsUpdate = true;
    this.#onDirty(this.#model);
  }

  /** One query per transform/world, shared by display residency, actions and world-input gates. */
  getTileActivity(query: TileStateQuery | undefined, registerCleanup: (stop: () => void) => void): Memo<boolean> | undefined {
    if (!query) return undefined;
    let entry = this.#areas.get(query);
    if (!entry) {
      entry = { area: query(this.tileTracker.tile), owners: 0 };
      this.#areas.set(query, entry);
    }
    entry.owners++;
    const owned = entry;
    let released = false;
    registerCleanup(() => {
      if (released) return;
      released = true;
      if (--owned.owners === 0 && this.#areas.get(query) === owned) {
        owned.area?.dispose();
        this.#areas.delete(query);
      }
    });
    return entry.area;
  }

  dispose(): void {
    this.#model.removeEventListener('added', this.#syncTile);
    for (const { area } of this.#areas.values()) area?.dispose();
    this.#areas.clear();
  }
}
