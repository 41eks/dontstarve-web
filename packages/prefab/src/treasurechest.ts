import { SpriteState } from '@dontstarve-web/display';
import { Workable } from '../../componets/src/workable';
import definitions from './definitions.json' with { type: 'json' };
import { buildingPlacer, buildingPrefab, MakeBuildingContainer, MakeBuildingPersist } from './building';
import { PrefabInstance } from './prefabInstance';
import { PlaySound } from './sound';
import { DefaultBurntStructureFn, onloadBurnt, onsaveBurnt } from './standardcomponents';
import { createStructureLootDropper } from './structureLoot';
import { BurnableBinding } from './treeFire';
import type { PrefabWorldContext } from './worldContext';

export const TREASURE_CHEST_ID = 'treasurechest' as const;
export type TreasureChestId = typeof TREASURE_CHEST_ID;

const declaration = definitions.animatedBuildings.treasurechest;

/** treasurechest.lua MakePlacer("treasurechest_placer", "chest", "treasure_chest", "closed"). */
export const TREASURE_CHEST_PLACER = buildingPlacer(declaration);

/** treasurechest.lua MakeChest: shared by the chests it builds, each with its own burnt and sound branches here. */
export function onopen(inst: PrefabInstance): void {
  if (inst.hasTag('burnt')) return;
  inst.sprite.playOnce('open');
  PlaySound('dontstarve/wilson/chest_open', inst.position);
}

export function onclose(inst: PrefabInstance): void {
  if (inst.hasTag('burnt')) return;
  inst.sprite.playOnce('close');
  inst.sprite.pushAnimation('closed', false);
  PlaySound('dontstarve/wilson/chest_close', inst.position);
}

function onworked(inst: PrefabInstance): void {
  if (inst.hasTag('burnt')) return;
  inst.components.container?.DropEverything(inst.position);
  inst.components.container?.Close();
  inst.sprite.playOnce('hit');
  inst.sprite.pushAnimation('closed', false);
}

function onhammered(inst: PrefabInstance): void {
  if (inst.components.burnable?.IsBurning()) inst.components.burnable.Extinguish();
  inst.components.lootdropper!.DropLoot();
  inst.components.container?.DropEverything(inst.position);
  inst.worldServices?.fx?.collapse?.('small', inst.position, 'wood');
  inst.remove();
}

function onbuilt(inst: PrefabInstance): void {
  inst.sprite.playOnce('place');
  inst.sprite.pushAnimation('closed', false);
}

/** treasurechest.lua MakeChest("treasurechest", "chest", "treasure_chest"), as far as it is ported. */
export class TreasureChestInstance extends PrefabInstance {
  constructor(world: PrefabWorldContext) {
    super(TREASURE_CHEST_ID, new SpriteState({ name: 'closed', held: true, billboard: true }));
    const { fire, scheduler } = world;
    if (!fire || !scheduler) throw new Error('A treasurechest needs the world\'s fire effects and scheduler');
    this.worldServices = world;
    MakeBuildingPersist(this);
    const { OnSave: saveBuilding, OnLoad: loadBuilding } = this;
    this.OnSave = (inst, data) => { saveBuilding!(inst, data); onsaveBurnt(inst, data); };
    this.OnLoad = (inst, data) => { loadBuilding!(inst, data); onloadBurnt(inst, data); };
    this.addTag('structure');
    this.addTag('chest');
    const container = MakeBuildingContainer(this, TREASURE_CHEST_ID, world);
    container.onopenfn = onopen;
    container.onclosefn = onclose;
    const workable = this.components.workable = new Workable(this);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(2);
    workable.SetOnWorkCallback(onworked);
    workable.SetOnFinishCallback(onhammered);
    this.components.lootdropper = createStructureLootDropper(this);
    this.ListenForEvent('onbuilt', () => onbuilt(this));
    const burn = new BurnableBinding(this, {
      burnTime: 10, fxLevel: 2, propagator: 'medium',
      onExtinguish: () => { PlaySound('dontstarve/common/fireOut', this.position); },
      onBurnt: () => { DefaultBurntStructureFn(this); burn.dispose(); },
    }, { fire, scheduler });
    this.onRemove(() => burn.dispose());
  }
}

export function treasureChestPrefabs(world: PrefabWorldContext) {
  return { [TREASURE_CHEST_ID]: { ...buildingPrefab(declaration, 'chest', undefined, () => new TreasureChestInstance(world), world),
    // MakeChest: MiniMapEntity:SetIcon(name..".png").
    minimapIcon: 'treasurechest.png' } };
}
