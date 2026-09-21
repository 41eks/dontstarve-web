import type { InventoryStore } from './inventory';

export interface DebugCommandResult {
  ok: boolean;
  message: string;
}

interface GiveCommand {
  itemId: string;
  count: number;
}

const GIVE_COMMAND = /^\s*c_give\s*\(\s*(["'])([^"']+)\1\s*(?:[,，]\s*(\d+)\s*)?\)\s*;?\s*$/;
const SPAWN_COMMAND = /^\s*c_spawn\s*\(\s*(["'])([^"']+)\1\s*\)\s*;?\s*$/;

export type DebugSpawnPrefab = (prefabId: string) => boolean | Promise<boolean>;

export async function executeDebugCommand(
  command: string,
  inventory: InventoryStore,
  spawnPrefab?: DebugSpawnPrefab,
): Promise<DebugCommandResult> {
  const give = parseGiveCommand(command);
  if (give) return executeGive(give, inventory);

  const prefabId = parseSpawnCommand(command);
  if (prefabId) {
    if (!spawnPrefab || !await spawnPrefab(prefabId)) {
      return { ok: false, message: `未知场景对象：${prefabId}` };
    }
    return { ok: true, message: `已生成 ${prefabId}` };
  }

  return {
    ok: false,
    message: '无效命令：请使用 c_give("item_id", count) 或 c_spawn("prefab_id")',
  };
}

function executeGive(give: GiveCommand, inventory: InventoryStore): DebugCommandResult {
  try {
    inventory.getItemSpec(give.itemId);
  } catch {
    return { ok: false, message: `未知物品：${give.itemId}` };
  }

  if (!inventory.add(give.itemId, give.count)) {
    return { ok: false, message: '物品栏空间不足' };
  }
  return { ok: true, message: `已添加 ${give.count} 个 ${give.itemId}` };
}

function parseGiveCommand(command: string): GiveCommand | undefined {
  const match = GIVE_COMMAND.exec(command);
  if (!match) return undefined;
  const count = match[3] === undefined ? 1 : Number(match[3]);
  if (!Number.isSafeInteger(count) || count <= 0) return undefined;
  return { itemId: match[2], count };
}

function parseSpawnCommand(command: string): string | undefined {
  return SPAWN_COMMAND.exec(command)?.[2];
}
