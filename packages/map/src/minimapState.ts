import { LazySignal, type ReadonlySignal } from '@dontstarve-web/signals';

/** inst.MiniMapEntity's declaration; the transform stays on the entity's model. */
export interface MiniMapJson {
  readonly icon: string;
  readonly priority: number;
  readonly canUseCache: boolean;
  readonly drawOverFogOfWar: boolean;
  readonly enabled: boolean;
}

/**
 * The prefab declares its map icon; packages/map subscribes independently of world sprite residency. The declaration
 * holds no signal until its first change: an entity that never touches its MiniMapEntity has no map subscription.
 */
export class MiniMapState {
  private readonly state = new LazySignal<MiniMapJson>({
    icon: '',
    priority: 0,
    canUseCache: true,
    drawOverFogOfWar: false,
    enabled: true,
  });
  get json(): ReadonlySignal<MiniMapJson> {
    return this.state;
  }

  /** Runs `listener` once the declaration first changes; the returned stop cancels a pending one. */
  whenDeclared(listener: () => void): () => void {
    return this.state.whenDeclared(listener);
  }

  get icon(): string {
    return this.state.peek().icon;
  }
  get priority(): number {
    return this.state.peek().priority;
  }
  get canUseCache(): boolean {
    return this.state.peek().canUseCache;
  }
  get drawOverFogOfWar(): boolean {
    return this.state.peek().drawOverFogOfWar;
  }
  get enabled(): boolean {
    return this.state.peek().enabled;
  }

  SetIcon(icon: string): void {
    this.update('icon', icon);
  }
  SetPriority(priority: number): void {
    this.update('priority', priority);
  }
  SetCanUseCache(canUseCache: boolean): void {
    this.update('canUseCache', canUseCache);
  }
  SetDrawOverFogOfWar(draw: boolean): void {
    this.update('drawOverFogOfWar', draw);
  }
  SetEnabled(enabled: boolean): void {
    this.update('enabled', enabled);
  }

  peek(): MiniMapJson {
    return this.state.peek();
  }

  private update<K extends keyof MiniMapJson>(key: K, value: MiniMapJson[K]): void {
    const current = this.state.peek();
    if (current[key] !== value) {
      this.state.set({ ...current, [key]: value });
    }
  }
}
