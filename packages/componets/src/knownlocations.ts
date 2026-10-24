export interface KnownLocation { x: number; y: number; z: number }

/** components/knownlocations.lua: named positions an entity remembers. */
export class KnownLocations {
  private readonly locations = new Map<string, KnownLocation>();

  RememberLocation(name: string, position: KnownLocation | undefined, dontOverwrite = false): void {
    if (dontOverwrite && this.locations.has(name)) return;
    if (position === undefined) {
      this.locations.delete(name);
      return;
    }
    if (![position.x, position.y, position.z].every(Number.isFinite)) {
      throw new Error('KnownLocations:RememberLocation() received a bad position value.');
    }
    this.locations.set(name, { x: position.x, y: position.y, z: position.z });
  }

  GetLocation(name: string): KnownLocation | undefined { return this.locations.get(name); }
  ForgetLocation(name: string): void { this.locations.delete(name); }

  OnSave(): { locations: { name: string; x: number; y: number; z: number }[] } | undefined {
    if (this.locations.size === 0) return undefined;
    return { locations: [...this.locations].map(([name, { x, y, z }]) => ({ name, x, y, z })) };
  }

  OnLoad(data: { locations?: readonly { name: string; x: number; y: number; z: number }[] } | undefined): void {
    for (const { name, x, y, z } of data?.locations ?? []) this.RememberLocation(name, { x, y, z });
  }
}
