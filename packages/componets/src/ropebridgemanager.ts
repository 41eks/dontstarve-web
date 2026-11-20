/** tuning.lua ROPEBRIDGE_HEALTH. */
export const ROPEBRIDGE_HEALTH = 200;

/**
 * ropebridgemanager.lua's duration grid entry of a ROPE_BRIDGE tile, `{ health, direction, icon_offset }`, saved with the
 * tile. `direction` is in this world's coordinates, mirrored along z as the imported positions are.
 */
export interface RopeBridgeTileSave {
  health: number;
  direction: { x: number; z: number };
  iconOffset?: number;
}

/** The map surface the manager reads: the ROPE_BRIDGE tiles that carry bridge data, and Map:GetTileCenterPoint. */
export interface RopeBridgeMap {
  ropeBridges(): Iterable<readonly [col: number, row: number, bridge: RopeBridgeTileSave]>;
  tileCenter(col: number, row: number): { x: number; z: number };
}

/** The rope_bridge_fx inst the manager keeps in its bridge_anims_grid. */
export interface RopeBridgeFx {
  SetRotation(degrees: number): void;
  SetIconOffset(inst: this, offset: number | undefined): void;
  SkipPre(inst: this): void;
  remove(): void;
}

/**
 * components/ropebridgemanager.lua (cave.lua's world component), as a saved world loads: OnLoad's SpawnBridgeAnim for
 * every tile in the duration grid. Not ported: creating and destroying bridges, damage and its dock_damage prefab
 * (SpawnDamagePrefab), quakes and the marked_for_delete grid.
 */
export class RopeBridgeManager {
  private readonly bridgeAnims = new Map<string, RopeBridgeFx>();
  private readonly spawnFx: (x: number, z: number) => RopeBridgeFx;

  constructor(map: RopeBridgeMap, spawnFx: (x: number, z: number) => RopeBridgeFx) {
    this.spawnFx = spawnFx;
    this.OnLoad(map);
  }

  /** OnLoad's duration grid: each bridge tile's anim at the tile centre. */
  private OnLoad(map: RopeBridgeMap): void {
    for (const [col, row, bridge] of map.ropeBridges()) {
      const { x, z } = map.tileCenter(col, row);
      // OnLoad runs while POPULATING, so SpawnBridgeAnim skips the place animation.
      this.SpawnBridgeAnim(`${col},${row}`, x, z, bridge.direction, bridge.iconOffset, true);
    }
  }

  /** SpawnBridgeAnim: rotation 0 / 180 along x, -90 / 90 along z. */
  private SpawnBridgeAnim(key: string, x: number, z: number, direction: RopeBridgeTileSave['direction'],
    iconOffset: number | undefined, populating: boolean): void {
    if (this.bridgeAnims.has(key)) { return; }
    const fx = this.spawnFx(x, z);
    fx.SetRotation(direction.x > 0 ? 0 : direction.x < 0 ? 180 : direction.z > 0 ? -90 : 90);
    fx.SetIconOffset(fx, iconOffset);
    this.bridgeAnims.set(key, fx);
    if (populating) { fx.SkipPre(fx); }
  }

  /** The anims follow the world's lifetime: they do not persist and are removed with it. */
  dispose(): void {
    for (const fx of this.bridgeAnims.values()) { fx.remove(); }
    this.bridgeAnims.clear();
  }
}
