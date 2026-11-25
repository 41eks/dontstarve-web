import { LootDropper } from '../../componets/src/lootdropper';
import { addComponent } from './components';
import { SpriteState } from '@dontstarve-web/display';
import { Workable } from '../../componets/src/workable';
import definitions from './definitions.json' with { type: 'json' };
import { buildingPlacer, buildingPrefab, MakeBuildingContainer, MakeBuildingPersist } from './building';
import { PrefabInstance } from './prefabInstance';
import { PlaySound } from './sound';
import { spawnStructureLoot, STRUCTURE_LOOT_RECIPES } from './structureLoot';
import type { PrefabWorldContext } from './worldContext';

export const DRAGONFLY_CHEST_ID = 'dragonflychest' as const;
export type DragonflyChestId = typeof DRAGONFLY_CHEST_ID;

const declaration = definitions.animatedBuildings.dragonflychest;

/** dragonfly_chest.lua MakePlacer("dragonflychest_placer", "dragonfly_chest", "dragonfly_chest", "closed"). */
export const DRAGONFLY_CHEST_PLACER = buildingPlacer(declaration, 'dragonfly_chest');

function onopen(inst: PrefabInstance): void {
  inst.sprite.playOnce('open');
  PlaySound('dontstarve/wilson/chest_open', inst.position);
}

function onclose(inst: PrefabInstance): void {
  inst.sprite.playOnce('close');
  PlaySound('dontstarve/wilson/chest_close', inst.position);
}

function onworked(inst: PrefabInstance): void {
  if (inst.hasTag('burnt')) {
    return;
  }
  inst.components.container?.DropEverything(inst.position);
  inst.components.container?.Close();
  inst.sprite.playOnce('hit');
  inst.sprite.pushAnimation('closed', false);
}

function onhammered(inst: PrefabInstance): void {
  inst.components.lootdropper!.DropLoot();
  inst.components.container?.DropEverything(inst.position);
  inst.worldServices?.fx?.collapse?.('small', inst.position, 'wood');
  inst.remove();
}

function onbuilt(inst: PrefabInstance): void {
  inst.sprite.playOnce('place');
  inst.sprite.pushAnimation('closed', false);
}

/** dragonfly_chest.lua fn(), as far as it is ported: the container, the hammer workable and onbuilt. */
export class DragonflyChestInstance extends PrefabInstance {
  constructor(world: PrefabWorldContext) {
    super(DRAGONFLY_CHEST_ID, new SpriteState({ name: 'closed', held: true, billboard: true }));
    this.BindWorld(world);
    MakeBuildingPersist(this);
    this.addTag('structure');
    this.addTag('chest');
    const container = MakeBuildingContainer(this, DRAGONFLY_CHEST_ID, world);
    container.onopenfn = onopen;
    container.onclosefn = onclose;
    const workable = addComponent(this, 'workable', Workable);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(2);
    workable.SetOnWorkCallback(onworked);
    workable.SetOnFinishCallback(onhammered);
    addComponent(this, 'lootdropper', LootDropper, spawnStructureLoot(this), STRUCTURE_LOOT_RECIPES);
    this.ListenForEvent('onbuilt', () => onbuilt(this));
  }
}

export function dragonflyChestPrefabs(world: PrefabWorldContext) {
  return {
    [DRAGONFLY_CHEST_ID]: {
      ...buildingPrefab(declaration, 'dragonfly_chest', undefined, () => new DragonflyChestInstance(world), world),
      minimapIcon: 'dragonflychest.png',
    },
  };
}
