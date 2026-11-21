import type * as THREE from 'three';

/** Track actual Float32 changes, preserving any ranges not yet consumed by WebGL. */
export class InstanceAttributes {
  private readonly changed = new Map<THREE.BufferAttribute, { start: number; end: number }>();

  begin(): void {
    for (const range of this.changed.values()) {
      range.start = Infinity;
      range.end = 0;
    }
  }

  write(attribute: THREE.BufferAttribute, index: number, values: ArrayLike<number>): void {
    const offset = index * attribute.itemSize;
    let start = Infinity,
      end = 0;
    for (let i = 0; i < attribute.itemSize; i++) {
      const value = Math.fround(values[i]);
      if (attribute.array[offset + i] === value) {
        continue;
      }
      attribute.array[offset + i] = value;
      start = Math.min(start, offset + i);
      end = offset + i + 1;
    }
    if (start === Infinity) {
      return;
    }
    let range = this.changed.get(attribute);
    if (!range) {
      this.changed.set(attribute, (range = { start, end }));
    } else {
      range.start = Math.min(range.start, start);
      range.end = Math.max(range.end, end);
    }
  }

  flush(): void {
    for (const [attribute, range] of this.changed) {
      if (range.start === Infinity) {
        continue;
      }
      let start = range.start,
        end = range.end;
      for (const pending of attribute.updateRanges) {
        start = Math.min(start, pending.start);
        end = Math.max(end, pending.start + pending.count);
      }
      attribute.clearUpdateRanges();
      attribute.addUpdateRange(start, end - start);
      attribute.needsUpdate = true;
    }
  }
}
