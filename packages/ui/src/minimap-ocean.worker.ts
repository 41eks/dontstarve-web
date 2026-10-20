import { renderMinimapOcean, type MinimapOceanConfig } from './minimap-ocean';

self.onmessage = (event: MessageEvent<{ side: number; cellSize: number; cells: Uint8Array; config: MinimapOceanConfig; pixelsPerCell: number }>) => {
  const { side, cellSize, cells, config, pixelsPerCell } = event.data;
  try {
    const pixels = renderMinimapOcean(side, cellSize, (col, row) => cells[row * side + col] === 1, config, pixelsPerCell);
    self.postMessage({ pixels }, { transfer: [pixels.data.buffer] });
  } catch (error) {
    self.postMessage({ error: String(error) });
  }
};
