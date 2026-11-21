import * as THREE from 'three';
import { expect, it, vi } from 'vitest';
import { ScenePainter, type PainterPage, type PainterPass } from '../src/scenePainter';

function page(id: number, ...keys: number[]): PainterPage & { version: number } {
  return { id, version: 0, entries: keys.map(key => ({ key })) };
}

it("cuts each page where another pass's sprite or an ordinary billboard comes between, and keeps an unchanged cut", () => {
  const painter = new ScenePainter(new THREE.Scene());
  const plants: PainterPass = { drawSegments: vi.fn() },
    fires: PainterPass = { drawSegments: vi.fn() };
  const grass = page(0, 1, 2, 2, 5, 6),
    fire = page(1, 3);
  painter.collect(plants, [grass]);
  painter.collect(fires, [fire]);
  painter.setOrdinaryKeys([5.5, 2]);
  painter.order();
  // The fire (3) cuts the grass after its third sprite; the billboard at 5.5 cuts it again. The billboard at 2 shares
  // the key of two grass sprites, which draw in either order with it, so it cuts nothing.
  expect(vi.mocked(plants.drawSegments).mock.calls[0][1].get(grass)).toEqual([
    { start: 0, end: 3, key: 1 },
    { start: 3, end: 4, key: 5 },
    { start: 4, end: 5, key: 6 },
  ]);
  expect(vi.mocked(fires.drawSegments).mock.calls[0][1].get(fire)).toEqual([{ start: 0, end: 1, key: 3 }]);

  // Nothing moved: the same segments are handed back without ordering again.
  const sort = vi.spyOn(Array.prototype, 'sort');
  painter.collect(plants, [grass]);
  painter.collect(fires, [fire]);
  painter.setOrdinaryKeys([5.5, 2]);
  painter.order();
  expect(sort).not.toHaveBeenCalled();
  expect(vi.mocked(plants.drawSegments).mock.calls[1][1]).toBe(vi.mocked(plants.drawSegments).mock.calls[0][1]);
  sort.mockRestore();
});
