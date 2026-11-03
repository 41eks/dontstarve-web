import { SpriteState } from '@dontstarve-web/display';
import { Workable } from '../../componets/src/workable';
import definitions from './definitions.json' with { type: 'json' };
import { buildingPlacer, buildingPrefab, MakeBuildingContainer, MakeBuildingPersist } from './building';
import { PrefabInstance } from './prefabInstance';
import { createStructureLootDropper } from './structureLoot';
import type { PrefabWorldContext } from './worldContext';

export const SALT_BOX_ID = 'saltbox' as const;
export type SaltBoxId = typeof SALT_BOX_ID;

const declaration = definitions.animatedBuildings.saltbox;

/** saltbox.lua MakePlacer("saltbox_placer", "saltbox", "saltbox", "closed"). */
export const SALT_BOX_PLACER = buildingPlacer(declaration);

function onopen(inst: PrefabInstance): void { inst.sprite.playOnce('open'); }

function onclose(inst: PrefabInstance): void { inst.sprite.playOnce('close'); }

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

/** saltbox.lua fn(), as far as it is ported: the container, the hammer workable and onbuilt. */
export class SaltBoxInstance extends PrefabInstance {
  constructor(world: PrefabWorldContext) {
    super(SALT_BOX_ID, new SpriteState({ name: 'closed', held: true, billboard: true }));
    this.worldServices = world;
    MakeBuildingPersist(this);
    this.addTag('saltbox');
    this.addTag('structure');
    const container = MakeBuildingContainer(this, SALT_BOX_ID, world);
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

export function saltBoxPrefabs(world: PrefabWorldContext) {
  return { [SALT_BOX_ID]: buildingPrefab(declaration, 'saltbox', undefined, () => new SaltBoxInstance(world), world) };
}
