import * as THREE from 'three';
import { expect, it } from 'vitest';
import { InstanceAttributes } from '../src/instanceAttributes';

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
