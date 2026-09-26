// 定义基本的数据结构
interface Vector2 {
    x: number;
    z: number;
}

interface TileCoord {
    col: number; // 网格的 X 轴
    row: number; // 网格的 Z 轴
}

export class TileMap {
    private readonly TILE_SIZE = 4; // 1块地皮 = 4x4 单位
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
        const col = Math.floor(world.x / this.TILE_SIZE) + Math.floor(this.width / 2);
        const row = Math.floor(world.z / this.TILE_SIZE) + Math.floor(this.height / 2);
        return { col, row };
    }

    // ==========================================
    // 2. 网格坐标 -> 世界坐标 (返回地皮的正中心点)
    // ==========================================
    public tileToWorld(tile: TileCoord): Vector2 {
        // 先减去偏移量，再乘 4，最后加上 2（偏移到地皮中心，因为 4/2 = 2）
        const x = (tile.col - Math.floor(this.width / 2)) * this.TILE_SIZE + (this.TILE_SIZE / 2);
        const z = (tile.row - Math.floor(this.height / 2)) * this.TILE_SIZE + (this.TILE_SIZE / 2);
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