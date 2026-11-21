import * as THREE from 'three';
import { expect, it } from 'vitest';
import { InstanceAttributes } from '../src/instanceAttributes';
import { DEPTH_RANK_STEP, rankSprites, type RankedPage, type RankedSprite } from '../src/instancedSpriteOrder';

interface Draw extends RankedSprite<Draw> {
  name: string;
}

type Page = RankedPage<Draw> & { members: Draw[]; count: number };

function page(): Page {
  return { members: [], count: 0, entries: [] };
}

function draw(target: Page, name: string, key: number, lateral: number, id: number, offset = false) {
  const result: Draw = {
    name,
    key,
    lateral,
    bias: NaN,
    page: target,
    entry: { depthOffset: offset, foot: { id }, spatial: { sphere: { radius: 1 } } },
  };
  target.members[target.count] = result;
  target.count++;
  return result;
}

it('ranks sprites across pages by foot key and nudges only overlapping coplanar runs towards the camera', () => {
  const trees = page(),
    fires = page();
  draw(trees, 'far', 3.5, 0, 9);
  draw(trees, 'tree', 5.1, 0, 2);
  // Same depth group, overlapping on screen: drawn after the tree, one step nearer.
  draw(fires, 'fire', 5.1, 0.5, 1, true);
  // Same depth group but clear of the run: the run restarts.
  draw(trees, 'clear', 5.3, 10, 3);
  // Stale member past `count` is ignored.
  trees.members.push({ ...trees.members[0], name: 'stale' });

  const scratch: Draw[] = [];
  rankSprites([trees, fires], scratch);

  expect(trees.entries.map(d => d.name)).toEqual(['far', 'tree', 'clear']);
  expect(fires.entries.map(d => d.name)).toEqual(['fire']);
  expect(trees.entries.map(d => d.bias)).toEqual([0, 0, 0]);
  expect(fires.entries[0].bias).toBe(DEPTH_RANK_STEP);
  expect(scratch).toHaveLength(0);
});

it('uploads only changed instance values and keeps update ranges WebGL has not consumed', () => {
  const attribute = new THREE.BufferAttribute(new Float32Array(8), 2);
  const writer = new InstanceAttributes();

  writer.begin();
  writer.write(attribute, 1, [1, 2]);
  writer.flush();
  expect(attribute.updateRanges).toEqual([{ start: 2, count: 2 }]);

  // An unchanged write produces no range; the pending one survives untouched.
  writer.begin();
  writer.write(attribute, 1, [1, 2]);
  writer.flush();
  expect(attribute.version).toBe(1);
  expect(attribute.updateRanges).toEqual([{ start: 2, count: 2 }]);

  // A new write merges with the range still waiting for upload.
  writer.begin();
  writer.write(attribute, 3, [0, 5]);
  writer.flush();
  expect(attribute.updateRanges).toEqual([{ start: 2, count: 6 }]);
  expect(Array.from(attribute.array)).toEqual([0, 0, 1, 2, 0, 0, 0, 5]);
});
