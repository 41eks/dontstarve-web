import { resolveAnimState, resolveAnimStateSymbol, type AnimState, type AnimStateArt } from '../src/animState';
import { smallHash, type AnimElement, type ResolvedSprite } from '../src/animationAssets';

export const element = (symbol: string, layer = symbol) =>
  ({ imageHash: smallHash(symbol), layerHash: smallHash(layer), imageIndex: 0, matrix: [1, 0, 0, 1, 0, 0] } as AnimElement);

/** Loads what the AnimState names, as its display would, then lets the display's load callbacks run. */
export async function loadDeclaredArt(anim: AnimState, art: AnimStateArt): Promise<void> {
  const { missing } = resolveAnimState(anim.json.peek(), art);
  await Promise.all([...[...missing.builds].map(archive => art.loadBuild(archive)), ...[...missing.animations].map(archive => art.loadAnimation(archive))]);
  await new Promise(resolve => setTimeout(resolve, 0));
}

/** The declared art of a symbol once it has loaded; undefined when the AnimState leaves the symbol alone. */
export async function declaredSymbol(anim: AnimState, art: AnimStateArt, symbol: string): Promise<ResolvedSprite[] | undefined> {
  await loadDeclaredArt(anim, art);
  return resolveAnimStateSymbol(resolveAnimState(anim.json.peek(), art).state, element(symbol), 0);
}

/** The archives the AnimState names for a symbol override, in source order. */
export function overrideArchives(anim: AnimState, symbol: string): string[] | undefined {
  return anim.json.peek().overrides.get(smallHash(symbol))?.sources.map(source => source.archive);
}
