import { prefabDisplay } from '@dontstarve-web/display';
import { removeComponent } from './components';
import { actionEntity } from './actionEntity';
import type { BuildingPlacerSpec } from './buildingPlacer';
import type { PrefabEntityDefinition, PrefabInstance } from './prefabInstance';
import { reskinTarget } from './reskin_tool';
import { MakeDeconstructable, MakeObstaclePhysics } from './standardcomponents';
import { ToolMouseTarget } from './toolMouseTarget';
import type { PrefabWorldContext } from './worldContext';

/** A building's entry in definitions.json: its art, its name and label, and its skins' builds. */
export interface BuildingDeclaration {
  readonly archive: string;
  readonly buildLabel: string;
  readonly name: string;
  readonly scale: number;
  readonly idleAnimation?: string;
  readonly previewAnimation?: string;
  readonly skinArchives?: Readonly<Record<string, string>>;
}

/** MakePlacer(name, bank, build, anim): the same build, in the selected skin. */
export function buildingPlacer({ archive, buildLabel, name, scale, idleAnimation = 'idle', previewAnimation = idleAnimation, skinArchives }: BuildingDeclaration): BuildingPlacerSpec {
  return { buildLabel, name, animation: previewAnimation, art: (resources, skinId) => {
    if (skinId !== undefined && !skinArchives?.[skinId]) throw new Error(`Unsupported ${name} skin: ${skinId}`);
    return { source: resources.animated(archive, {}, { name, scale }), initialize: entity => {
      entity.skinId = skinId;
      if (skinArchives) entity.sprite.setSkinSource({ art: resources.archives, archives: skinArchives });
    } };
  } };
}

/** The building save shape: `components.building`, holding the skin it was built or reskinned with. */
export function MakeBuildingPersist(inst: PrefabInstance): void {
  inst.OnSave = (saved, data) => { data.building = saved.skinId === undefined ? {} : { skinId: saved.skinId }; };
  inst.OnLoad = (loaded, data) => { if (data.building?.skinId !== undefined) loaded.skinId = data.building.skinId; };
}

/** What the mouse and the tools find on a building once it has its display: the greenstaff, the reskin tool and its workable. */
function MakeBuildingTargets(inst: PrefabInstance, skins: readonly string[], world: Pick<PrefabWorldContext, 'handEquipment'>): void {
  const model = inst.transform.model, entity = actionEntity(model, inst.prefab);
  MakeDeconstructable(inst);
  if (skins.length) entity.reskinTarget = reskinTarget({
    get id() { return String(inst.entityId); }, prefabId: inst.prefab,
    instance: inst, display: prefabDisplay(model)!, sprite: inst.sprite, skins,
    get isRemoved() { return inst.isRemoved; },
    hasTag: tag => entity.hasTag(tag),
    get position() { return inst.position; }, isValid: () => !inst.isRemoved && model.visible,
  });
  if (!inst.components.workable) return;
  new ToolMouseTarget(entity, inst, entity.components.workable, world.handEquipment);
  inst.onRemove(() => removeComponent(inst, 'workable'));
}

/** Prefab(name, fn, assets) for a building drawn from its definitions.json entry, standing on an obstacle of `radius`. */
export function buildingPrefab<Instance extends PrefabInstance>(declaration: BuildingDeclaration, bank: string, radius: number,
  fn: () => Instance, world: Pick<PrefabWorldContext, 'handEquipment'>): PrefabEntityDefinition<Instance> {
  const { archive, skinArchives } = declaration, skins = Object.keys(skinArchives ?? {});
  return {
    fn,
    assets: { animationArchive: archive, buildArchives: [archive], bank },
    skins: skinArchives,
    alignBottom: true,
    physics: { make: MakeObstaclePhysics, radius },
    onSpawned: inst => MakeBuildingTargets(inst, skins, world),
  };
}
