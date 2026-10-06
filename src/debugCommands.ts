import type { InventoryStore } from './inventory';

export interface DebugCommandResult {
  ok: boolean;
  message: string;
}

interface GiveCommand {
  itemId: string;
  count: number;
}

const GIVE_COMMAND = /^\s*c_give\s*[(（]\s*(["'])([^"']+)\1\s*(?:[,，]\s*(\d+)\s*)?[)）]\s*;?\s*$/;
const SPAWN_COMMAND = /^\s*c_spawn\s*[(（]\s*(["'])([^"']+)\1\s*[)）]\s*;?\s*$/;
const SAVE_COMMAND = /^\s*c_save\s*[(（]\s*[)）]\s*;?\s*$/;
const SANITY_COMMAND = /^\s*c_setsanity\s*[(（]\s*(\d+(?:\.\d*)?|\.\d+)\s*[)）]\s*;?\s*$/;

export type DebugSpawnPrefab = (prefabId: string) => boolean | Promise<boolean>;
export type DebugSaveGame = () => void | Promise<void>;

export async function executeDebugCommand(
  command: string,
  inventory: InventoryStore,
  spawnPrefab?: DebugSpawnPrefab,
  saveGame?: DebugSaveGame,
  setSanity?: (percent: number) => void,
): Promise<DebugCommandResult> {
  const sanity = SANITY_COMMAND.exec(command);
  if (sanity) {
    const percent = Number(sanity[1]);
    if (!Number.isFinite(percent) || percent < 0 || percent > 1) {
      return { ok: false, message: '理智比例必须是 0 到 1 的数字' };
    }
    if (!setSanity) return { ok: false, message: '当前无法设置理智' };
    setSanity(percent);
    return { ok: true, message: `已设置理智为 ${percent * 100}%` };
  }
  if (SAVE_COMMAND.test(command)) {
    if (!saveGame) return { ok: false, message: '当前无法保存游戏' };
    try {
      await saveGame();
      return { ok: true, message: '已下载存档 initial-world.json' };
    } catch (error: unknown) {
      return { ok: false, message: `保存失败：${error instanceof Error ? error.message : String(error)}` };
    }
  }
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
    message: '无效命令：请使用 c_give("item_id", count)、c_spawn("prefab_id")、c_setsanity(percent) 或 c_save()',
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
