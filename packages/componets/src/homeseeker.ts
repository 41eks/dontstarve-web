import type { Vector3 } from 'three';

export interface Home { isValid(): boolean; getPosition(): Vector3; ListenForEvent(name: string, fn: () => void): () => void }
/** homeseeker.lua owns the removal listener independently of brains and visuals. */
export class HomeSeeker<T extends Home = Home> {
  home?: T;
  private stop?: () => void;
  SetHome(home?: T): void {
    this.stop?.(); this.stop = undefined; this.home = home;
    if (home) this.stop = home.ListenForEvent('onremove', () => this.SetHome());
  }
  HasHome(): boolean { return this.home?.isValid() ?? false; }
  GetHomePos(): Vector3 | undefined { return this.home?.getPosition(); }
  dispose(): void { this.SetHome(); }
}
