import { animStateVisible, mergeAnimStates, resolveAnimState, resolveAnimStateSymbol, type AnimState, type AnimStateArt, type AnimStateJson } from '../src/animState';
import { animStateDeclarations } from '../../display/src/spriteState';
import type { SpriteState } from '@dontstarve-web/display';
import { smallHash, type AnimElement, type ResolvedSprite } from '../src/animationAssets';

type DeclaredAnimState = Pick<AnimState, 'json' | 'IsVisible'>;

/** What a sprite's AnimState declarations add up to, merged in order as its display draws them. */
export function declaredAnimState(sprite: SpriteState): DeclaredAnimState {
  const json = { peek: (): AnimStateJson => mergeAnimStates(animStateDeclarations(sprite.sprite.peek().appearance).map(([, op]) => op.state.peek())) };
  return { json: json as AnimState['json'], IsVisible: element => animStateVisible(json.peek(), element) };
}

export const element = (symbol: string, layer = symbol) =>
  ({ imageHash: smallHash(symbol), layerHash: smallHash(layer), imageIndex: 0, matrix: [1, 0, 0, 1, 0, 0] } as AnimElement);

/** Loads what the AnimState names, as its display would, then lets the display's load callbacks run. */
export async function loadDeclaredArt(anim: DeclaredAnimState, art: AnimStateArt): Promise<void> {
  const { missing } = resolveAnimState(anim.json.peek(), art);
  await Promise.all([...[...missing.builds].map(archive => art.loadBuild(archive)), ...[...missing.animations].map(archive => art.loadAnimation(archive))]);
  await new Promise(resolve => setTimeout(resolve, 0));
}

/** The declared art of a symbol once it has loaded; undefined when the AnimState leaves the symbol alone. */
export async function declaredSymbol(anim: DeclaredAnimState, art: AnimStateArt, symbol: string): Promise<ResolvedSprite[] | undefined> {
  await loadDeclaredArt(anim, art);
  return resolveAnimStateSymbol(resolveAnimState(anim.json.peek(), art).state, element(symbol), 0);
}

/** The archives the AnimState names for a symbol override, in source order. */
export function overrideArchives(anim: DeclaredAnimState, symbol: string): string[] | undefined {
  return anim.json.peek().overrides.get(smallHash(symbol))?.sources.map(source => source.archive);
}
