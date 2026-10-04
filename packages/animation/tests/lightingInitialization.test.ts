import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const { initialSave, createLighting } = vi.hoisted(() => ({
  initialSave: { world: { elapsedSeconds: 0, systems: {} as { season?: { name: string } } } },
  createLighting: vi.fn(async () => ({})),
}));

vi.mock('../../../src/save/initialSave', () => ({ initialSave }));
vi.mock('../../../src/dstLighting', () => ({ DstLightingRenderer: { create: createLighting } }));
vi.mock('@three-roaming/ui/cursor-label', () => ({ CursorLabelUi: class {} }));
vi.mock('three', async (importOriginal) => ({
  ...await importOriginal<typeof import('three')>(),
  WebGLRenderer: class {
    domElement = {};
    setPixelRatio() {}
    setSize() {}
  },
}));

beforeEach(() => {
  vi.resetModules();
  createLighting.mockClear();
  initialSave.world.systems = {};
  vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1 });
  vi.stubGlobal('document', { body: { appendChild: vi.fn() } });
});

afterEach(() => vi.unstubAllGlobals());

it.each([
  [0, 'day'],
  [300, 'dusk'],
  [7 * 480 + 419.5, 'dusk'],
  [420, 'night'],
  [480, 'day'],
])('initializes lighting at the saved %s seconds directly in %s', async (seconds, phase) => {
  initialSave.world.elapsedSeconds = Number(seconds);
  await import('../../../src/universal');
  expect(createLighting).toHaveBeenCalledOnce();
  expect(createLighting).toHaveBeenCalledWith(expect.anything(), expect.stringContaining('dst/data/images/colour_cubes'), {
    season: 'spring', phase,
  });
});

it('initializes the saved season together with its phase', async () => {
  initialSave.world.elapsedSeconds = 360;
  initialSave.world.systems.season = { name: 'winter' };
  await import('../../../src/universal');
  expect(createLighting).toHaveBeenCalledWith(expect.anything(), expect.any(String), { season: 'winter', phase: 'dusk' });
});
