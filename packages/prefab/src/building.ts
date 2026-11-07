import { prefabDisplay } from '@dontstarve-web/display';
import { removeComponent } from './components';
import { getBoundWatchWorldContent } from '@dontstarve-web/signals';
import { actionEntity } from './actionEntity';
import type { BuildingPlacerSpec } from './buildingPlacer';
import { buildingContainerId, createBuildingContainer, releaseBuildingContainer, type BuildingContainer, type StorageBuildingId } from './containers';
import type { PrefabEntityDefinition, PrefabInstance } from './prefabInstance';
import { reskinTarget } from './reskin_tool';
import { MakeDeconstructable, MakeObstaclePhysics } from './standardcomponents';
import { TILE_SIZE } from './tile';
import { ToolMouseTarget } from './toolMouseTarget';
import type { PrefabWorldContext } from './worldContext';

/** A building's entry in definitions.json: its art, its name and label, and its skins' builds. */
export interface BuildingDeclaration {
  readonly archive: string;
  /** SetBuild's zip when `archive` holds only the bank. */
  readonly buildArchive?: string;
  readonly buildLabel: string;
  readonly name: string;
  readonly scale: number;
  readonly idleAnimation?: string;
  readonly previewAnimation?: string;
  readonly skinArchives?: Readonly<Record<string, string>>;
  /** The symbols a skin replaces, when its init_fn overrides only those (OverrideItemSkinSymbol) rather than calling SetSkin. */
  readonly skinSymbols?: readonly string[];
}

/** MakePlacer(name, bank, build, anim): the same build, in the selected skin. */
export function buildingPlacer({ archive, buildArchive, buildLabel, name, scale, idleAnimation = 'idle', previewAnimation = idleAnimation, skinArchives, skinSymbols }: BuildingDeclaration): BuildingPlacerSpec {
  return { buildLabel, name, animation: previewAnimation, art: (resources, skinId) => {
    if (skinId !== undefined && !skinArchives?.[skinId]) throw new Error(`Unsupported ${name} skin: ${skinId}`);
    return { source: resources.animated(archive, buildArchive ? { buildArchive } : {}, { name, scale, skinSymbols }), initialize: entity => {
      entity.skinId = skinId;
      if (skinArchives) entity.sprite.setSkinSource({ art: resources.archives, archives: skinArchives, ...skinSymbols ? { symbols: skinSymbols } : {} });
    } };
  } };
}

/** The building save shape: `components.building`, holding the skin it was built or reskinned with. */
export function MakeBuildingPersist(inst: PrefabInstance): void {
  inst.OnSave = (saved, data) => { data.building = saved.skinId === undefined ? {} : { skinId: saved.skinId }; };
  inst.OnLoad = (loaded, data) => { if (data.building?.skinId !== undefined) loaded.skinId = data.building.skinId; };
}

const addressedContainers = new WeakSet<PrefabInstance>();

/** Gives the UI and item moves an address for the slots the entity's container already owns; it needs the entity's ID. */
function registerBuildingContainer(inst: PrefabInstance): void {
  const container: BuildingContainer | undefined = inst.components.container;
  if (!container || addressedContainers.has(inst)) return;
  addressedContainers.add(inst);
  inst.worldServices?.registerContainer?.(buildingContainerId(inst.prefab as StorageBuildingId, String(inst.entityId)), container);
}

/**
 * AddComponent("container") with the building's slots, autoclose and storage-panel events. A saved container has read its
 * items by the time inst.OnLoad runs, so the address comes first: an onload that burns the building must be able to drop
 * them. Call this after setting the prefab's own OnLoad.
 */
export function MakeBuildingContainer(inst: PrefabInstance, prefab: StorageBuildingId, world: PrefabWorldContext): BuildingContainer {
  const notify = (isOpen: boolean) => world.onContainerInteraction?.({ buildId: prefab, isOpen, model: inst.transform.model });
  const stopOpen = inst.ListenForEvent('onopen', () => notify(true));
  const stopClose = inst.ListenForEvent('onclose', () => notify(false));
  // Registered before the component's own removal: the store destroys the contents through its address.
  inst.onRemove(() => {
    stopOpen(); stopClose();
    const container: BuildingContainer | undefined = inst.components.container;
    if (container) { container.onopenfn = undefined; container.onclosefn = undefined; }
    releaseBuildingContainer(inst);
  });
  const container = createBuildingContainer(prefab, inst);
  container.SetAutoClose(world.getWatchWorldContent ?? getBoundWatchWorldContent(), 3 * (TILE_SIZE / 4));
  const onload = inst.OnLoad;
  inst.OnLoad = (loaded, data) => { registerBuildingContainer(loaded); onload?.(loaded, data); };
  return container;
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
  // A building that does something without a tool keeps its own actions under the mouse while no tool is held.
  new ToolMouseTarget(entity, inst, entity.components.workable, world.handEquipment, {
    canInteractWithoutTool: () => !entity.hasTag('burnt') && !!(inst.components.container || inst.components.trader || inst.components.fueled
      || inst.components.prototyper || inst.components.occupiable),
  });
  inst.onRemove(() => removeComponent(inst, 'workable'));
}

/**
 * Prefab(name, fn, assets) for a building drawn from its definitions.json entry; `radius` is its source MakeObstaclePhysics,
 * if it has one. `controller` draws it through a factory animation controller instead of a shared archive sprite.
 */
export function buildingPrefab<Instance extends PrefabInstance>(declaration: BuildingDeclaration, bank: string, radius: number | undefined,
  fn: PrefabEntityDefinition<Instance>['fn'], world: Pick<PrefabWorldContext, 'handEquipment'>,
  { controller = false }: { controller?: boolean } = {}): PrefabEntityDefinition<Instance> {
  const { archive, buildArchive = archive, name, scale, skinArchives, skinSymbols } = declaration, skins = Object.keys(skinArchives ?? {});
  return {
    fn,
    ...controller
      ? { animatedAssets: [archive, buildArchive === archive ? {} : { buildArchive }, { name, scale, skinSymbols }] }
      : { assets: { animationArchive: archive, buildArchives: [buildArchive], bank } },
    skins: skinArchives,
    ...skinSymbols ? { skinSymbols } : {},
    alignBottom: true,
    ...radius === undefined ? {} : { physics: { make: MakeObstaclePhysics, radius } },
    onSpawned: inst => { MakeBuildingTargets(inst, skins, world); registerBuildingContainer(inst); },
  };
}
