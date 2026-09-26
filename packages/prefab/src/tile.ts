// 定义基本的数据结构
export interface Vector2 {
    x: number;
    z: number;
}

export interface TileCoord {
    col: number; // 网格的 X 轴
    row: number; // 网格的 Z 轴
}

/** 墙贴图的宽度（忽略 alpha 通道，取整张贴图）：`wall_segment-14` = 195px */
export const WALL_TEXTURE_WIDTH = 195;

/** 墙的缩放，墙渲染宽度 = WALL_TEXTURE_WIDTH * WALL_SCALE = 3.9 世界单位 */
export const WALL_SCALE = 0.02;

/** 一面墙在世界中的宽度 */
export const WALL_WIDTH = WALL_TEXTURE_WIDTH * WALL_SCALE;

/** 一块地皮的边长 */
export const TILE_SIZE = 12;

/** 一块地皮划成 4x4 小格，16 个落点把地皮占满 */
export const WALL_SLOT_SIZE = TILE_SIZE / 4;

export function snapToCellCenter(world: Vector2, cellSize: number): Vector2 {
    return {
        x: (Math.floor(world.x / cellSize) + 0.5) * cellSize,
        z: (Math.floor(world.z / cellSize) + 0.5) * cellSize,
    };
}

/**
 * 把世界坐标吸附到所在格子的正中心，对应 DST 的 `math.floor(x) + .5`
 * （`components/placer.lua` 的 `snap_to_meters` 与 `prefabs/walls.lua` 的部署逻辑）。
 */
export function snapToTileCenter(world: Vector2): Vector2 {
    return snapToCellCenter(world, TILE_SIZE);
}

/** 吸附到小格中心：一块地皮 4x4 个小格，16 个落点把地皮占满 */
export function snapToWallSlotCenter(world: Vector2): Vector2 {
    return snapToCellCenter(world, WALL_SLOT_SIZE);
}

export class TileMap {
    private width: number;          // 地图宽度（地皮数量）
    private height: number;         // 地图高度（地皮数量）
    private tiles: Uint8Array;      // 使用类型化数组存储地皮ID，类似底层C++的紧凑存储

    constructor(widthInTiles: number, heightInTiles: number) {
        this.width = widthInTiles;
        this.height = heightInTiles;
        // 初始化一维数组，默认全为 0 (例如 0 代表海洋或虚无)
        this.tiles = new Uint8Array(this.width * this.height);
    }

    // ==========================================
    // 1. 世界坐标 -> 网格坐标
    // ==========================================
    public worldToTile(world: Vector2): TileCoord {
        // 公式：向下取整(世界坐标 / 4) + 地图尺寸的一半
        const col = Math.floor(world.x / TILE_SIZE) + Math.floor(this.width / 2);
        const row = Math.floor(world.z / TILE_SIZE) + Math.floor(this.height / 2);
        return { col, row };
    }

    // ==========================================
    // 2. 网格坐标 -> 世界坐标 (返回地皮的正中心点)
    // ==========================================
    public tileToWorld(tile: TileCoord): Vector2 {
        // 先减去偏移量，再乘 4，最后加上 2（偏移到地皮中心，因为 4/2 = 2）
        const x = (tile.col - Math.floor(this.width / 2)) * TILE_SIZE + (TILE_SIZE / 2);
        const z = (tile.row - Math.floor(this.height / 2)) * TILE_SIZE + (TILE_SIZE / 2);
        return { x, z };
    }

    // ==========================================
    // 3. 网格坐标 -> 一维数组索引
    // ==========================================
    private getIndex(col: number, row: number): number {
        return row * this.width + col;
    }

    // ==========================================
    // 4. 边界安全检查
    // ==========================================
    public isValidTile(col: number, row: number): boolean {
        return col >= 0 && col < this.width && row >= 0 && row < this.height;
    }

    // ==========================================
    // 5. 核心交互 API
    // ==========================================

    // 设置某世界坐标处的地皮
    public setTileAtWorld(world: Vector2, tileId: number): void {
        const { col, row } = this.worldToTile(world);
        if (this.isValidTile(col, row)) {
            const index = this.getIndex(col, row);
            this.tiles[index] = tileId;
        } else {
            console.warn(`Coordinate out of bounds: x=${world.x}, z=${world.z}`);
        }
    }

    // 获取某世界坐标处的地皮
    public getTileAtWorld(world: Vector2): number {
        const { col, row } = this.worldToTile(world);
        if (this.isValidTile(col, row)) {
            return this.tiles[this.getIndex(col, row)];
        }
        return 0; // 返回默认值或虚无的 ID
    }
}
