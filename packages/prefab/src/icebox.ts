import { SpriteState } from '@dontstarve-web/display';
import { Workable } from '../../componets/src/workable';
import definitions from './definitions.json' with { type: 'json' };
import { buildingPlacer, buildingPrefab, MakeBuildingContainer, MakeBuildingPersist } from './building';
import { PrefabInstance } from './prefabInstance';
import { PlaySound } from './sound';
import { createStructureLootDropper } from './structureLoot';
import type { PrefabWorldContext } from './worldContext';

export const ICE_BOX_ID = 'icebox' as const;
export type IceBoxId = typeof ICE_BOX_ID;

const declaration = definitions.animatedBuildings.icebox;

/** icebox.lua MakePlacer("icebox_placer", "icebox", "ice_box", "closed"). */
export const ICE_BOX_PLACER = buildingPlacer(declaration);

function onopen(inst: PrefabInstance): void {
  inst.sprite.playOnce('open');
  PlaySound('dontstarve/common/icebox_open', inst.position);
}

function onclose(inst: PrefabInstance): void {
  inst.sprite.playOnce('close');
  PlaySound('dontstarve/common/icebox_close', inst.position);
}

function onworked(inst: PrefabInstance): void {
  if (inst.hasTag('burnt')) return;
  inst.sprite.playOnce('hit');
  inst.sprite.pushAnimation('closed', false);
  inst.components.container?.DropEverything(inst.position);
  inst.components.container?.Close();
}

function onhammered(inst: PrefabInstance): void {
  inst.components.lootdropper!.DropLoot();
  inst.components.container?.DropEverything(inst.position);
  inst.worldServices?.fx?.collapse?.('small', inst.position, 'metal');
  inst.remove();
}

function onbuilt(inst: PrefabInstance): void {
  inst.sprite.playOnce('place');
  inst.sprite.pushAnimation('closed', false);
}

/** icebox.lua fn(), as far as it is ported: the fridge container, the hammer workable and onbuilt. */
export class IceBoxInstance extends PrefabInstance {
  constructor(world: PrefabWorldContext) {
    super(ICE_BOX_ID, new SpriteState({ name: 'closed', held: true, billboard: true }));
    this.worldServices = world;
    MakeBuildingPersist(this);
    this.addTag('structure');
    // createBuildingContainer adds the fridge tag.
    const container = MakeBuildingContainer(this, ICE_BOX_ID, world);
    container.onopenfn = onopen;
    container.onclosefn = onclose;
    const workable = this.components.workable = new Workable(this);
    workable.SetWorkAction('HAMMER');
    workable.SetWorkLeft(2);
    workable.SetOnWorkCallback(onworked);
    workable.SetOnFinishCallback(onhammered);
    this.components.lootdropper = createStructureLootDropper(this);
    this.ListenForEvent('onbuilt', () => onbuilt(this));
  }
}

export function iceBoxPrefabs(world: PrefabWorldContext) {
  return { [ICE_BOX_ID]: { ...buildingPrefab(declaration, 'icebox', undefined, () => new IceBoxInstance(world), world),
    // fn: MiniMapEntity:SetIcon("icebox.png").
    minimapIcon: 'icebox.png' } };
}
