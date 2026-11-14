import type { PlacementSaveRecord } from './saveRecord';
import { removeComponent } from './components';
import { getBoundWatchWorldContent } from '@dontstarve-web/signals';
import type { BuildingPlacerSpec } from './buildingPlacer';
import { buildingContainerId, createBuildingContainer, isStorageBuildingId, releaseBuildingContainer, type BuildingContainer, type StorageBuildingId } from './containers';
import type { AnimatedSpriteInstance, PrefabEntityDefinition, PrefabEntityFn, PrefabInstance } from './prefabInstance';
import { MakeObstaclePhysics } from './standardcomponents';
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
  readonly idleAnimation?: string;
  readonly previewAnimation?: string;
  readonly skinArchives?: Readonly<Record<string, string>>;
  /** The symbols a skin replaces, when its init_fn overrides only those (OverrideItemSkinSymbol) rather than calling SetSkin. */
  readonly skinSymbols?: readonly string[];
  /** Symbols kept from the base build under every skin. */
  readonly baseSymbols?: readonly string[];
  /** Per skin, the animation banks of its archive drawn over the clip's frame. */
  readonly skinAnimationBanks?: Readonly<Record<string, readonly string[]>>;
}

/** MakePlacer(name, bank, build, anim): the same build, in the selected skin. */
export function buildingPlacer({ archive, buildArchive, buildLabel, name, idleAnimation = 'idle', previewAnimation = idleAnimation, skinArchives, skinSymbols,
  baseSymbols, skinAnimationBanks }: BuildingDeclaration): BuildingPlacerSpec {
  return { buildLabel, name, animation: previewAnimation, art: (resources, skinId) => {
    if (skinId !== undefined && !skinArchives?.[skinId]) throw new Error(`Unsupported ${name} skin: ${skinId}`);
    return { source: resources.animated(archive, buildArchive ? { buildArchive } : {}, { name, skinSymbols }), initialize: entity => {
      entity.skinId = skinId;
      if (skinArchives) entity.sprite.setSkinSource({ art: resources.archives, archives: skinArchives, ...skinSymbols ? { symbols: skinSymbols } : {},
        ...baseSymbols ? { baseSymbols } : {}, ...skinAnimationBanks ? { animationBanks: skinAnimationBanks } : {} });
    } };
  } };
}

/** The building save shape: `components.building`, holding the skin it was built or reskinned with. */
export function MakeBuildingPersist(inst: PrefabInstance): void {
  inst.OnSave = SaveBuildingSkin;
  inst.OnLoad = LoadBuildingSkin;
}

/** The skin half of a building's OnSave; a prefab with its own onsave calls it first. */
export function SaveBuildingSkin(inst: PrefabInstance, data: PlacementSaveRecord['components']): void {
  data.building = inst.skinId === undefined ? {} : { skinId: inst.skinId };
}

/** The skin half of a building's OnLoad; a prefab with its own onload calls it first. */
export function LoadBuildingSkin(inst: PrefabInstance, data: PlacementSaveRecord['components']): void {
  if (data.building?.skinId !== undefined) inst.skinId = data.building.skinId;
}

const addressedContainers = new WeakSet<PrefabInstance>();

/** Gives the UI and item moves an address for the slots the entity's container already owns; it needs the entity's ID. */
function registerBuildingContainer(inst: PrefabInstance): void {
  const container: BuildingContainer | undefined = inst.components.container;
  if (!container || addressedContainers.has(inst)) return;
  addressedContainers.add(inst);
  if (!isStorageBuildingId(inst.prefab)) throw new Error(`${inst.prefab} is not a storage building`);
  inst.worldServices?.registerContainer?.(buildingContainerId(inst.prefab, String(inst.entityId)), container);
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
function MakeBuildingTargets(inst: PrefabInstance, world: Pick<PrefabWorldContext, 'handEquipment'>): void {
  if (!inst.components.workable) return;
  // A building that does something without a tool keeps its own actions under the mouse while no tool is held.
  new ToolMouseTarget(inst, inst.components.workable, world.handEquipment, {
    canInteractWithoutTool: () => !inst.hasTag('burnt') && !!(inst.components.container || inst.components.trader || inst.components.fueled
      || inst.components.prototyper || inst.components.occupiable),
  });
  inst.onRemove(() => removeComponent(inst, 'workable'));
}

/**
 * Prefab(name, fn, assets) for a building drawn from its definitions.json entry; `radius` is its source MakeObstaclePhysics,
 * if it has one.
 */
export function buildingPrefab<Instance extends PrefabInstance>(declaration: BuildingDeclaration, bank: string, radius: number | undefined,
  fn: PrefabEntityFn<Instance & AnimatedSpriteInstance>, world: Pick<PrefabWorldContext, 'handEquipment'>): PrefabEntityDefinition<Instance> {
  const { archive, buildArchive = archive, skinArchives, skinSymbols, baseSymbols, skinAnimationBanks } = declaration;
  return {
    fn,
    assets: { animationArchive: archive, buildArchives: [buildArchive], bank },
    skins: skinArchives,
    ...skinSymbols ? { skinSymbols } : {},
    ...baseSymbols ? { baseSymbols } : {},
    ...skinAnimationBanks ? { skinAnimationBanks } : {},
    alignBottom: true,
    ...radius === undefined ? {} : { physics: { make: MakeObstaclePhysics, radius } },
    onSpawned: inst => { MakeBuildingTargets(inst, world); registerBuildingContainer(inst); },
  };
}
