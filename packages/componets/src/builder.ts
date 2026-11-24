import {
  createEffect,
  createSignal,
  readonlySignal,
  watchSignal,
  getBoundWatchWorldContent,
  WorldContentKey,
  type GetWatchWorldContent,
  type ReadonlySignal,
} from '@dontstarve-web/signals';
import type { Vector3 } from 'three';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type { PrototyperDoer, PrototyperInst } from './prototyper';
import { CreateTechTree } from './techtree';
import type { InventoryRecipeDefinition } from '../../inventory/src/types';
import { InventoryStore } from '../../inventory/src/store';
import { createBufferedAction, type PlayerActionDoer } from '../../stategraphs/src/actionfns';

type BuildRecipe = Pick<InventoryRecipeDefinition, 'productId' | 'buffered' | 'minSpacing' | 'buildDistance'>;

interface BuildProduct {
  setRotation(rotation: number): void;
  PushEvent(name: 'onbuilt', data: undefined): void;
}

interface BuilderInst extends PrototyperDoer {
  readonly components?: object;
}

function getInventory(inst: BuilderInst): InventoryStore | undefined {
  const components = inst.components;
  return components && 'inventory' in components && components.inventory instanceof InventoryStore
    ? components.inventory
    : undefined;
}

function canBufferBuild(inst: BuilderInst): inst is BuilderInst & PlayerActionDoer {
  return !!getInventory(inst) && 'position' in inst && inst.PushEvent !== undefined;
}

export interface BuilderWorld {
  findEntities(
    position: Vector3,
    radius: number,
    mustTags: readonly string[],
    cantTags: readonly string[],
  ): PrototyperInst[];
  placement?: {
    recipe(id: string): BuildRecipe | undefined;
    CanDeployRecipeAtPoint(point: ReadonlyVector3, recipe: BuildRecipe): boolean;
    SpawnPrefab(prefab: string, point: Vector3, skin?: string): BuildProduct | undefined;
  };
  researchMachineDistance?: number;
  getWatchWorldContent?: GetWatchWorldContent;
  /** World query-index changes: creation, removal, activity and tags. */
  entitiesChanged?: ReadonlySignal<number>;
}

/** builder.lua's tech selection, evaluated on position/query/configuration changes. */
export class Builder {
  private readonly techTrees = createSignal(CreateTechTree());
  readonly accessible_tech_trees = readonlySignal(this.techTrees);
  private current?: PrototyperInst;
  private override?: PrototyperInst;
  private enabled = true;
  private disposed = false;
  private stopRemoval?: () => void;
  private readonly cleanups: (() => void)[] = [];
  private readonly stationWatches = new Map<PrototyperInst, () => void>();
  private readonly inst: BuilderInst;
  private readonly world: BuilderWorld;
  readonly exclude_tags = ['INLIMBO', 'fire'];

  constructor(inst: BuilderInst, world: BuilderWorld) {
    this.inst = inst;
    this.world = world;
    const removal = watchSignal(inst.removal, stop => {
      this.stopRemoval = stop;
    });
    createEffect(() => {
      if (removal.get()) {
        this.dispose();
      }
    });
    if (this.disposed) {
      return;
    }
    const positions = (world.getWatchWorldContent ?? getBoundWatchWorldContent())?.(
      WorldContentKey.PlayerPositions,
      stop => this.cleanups.push(stop),
    );
    const entities = world.entitiesChanged && watchSignal(world.entitiesChanged, stop => this.cleanups.push(stop));
    if (positions || entities) {
      createEffect(() => {
        positions?.get();
        entities?.get();
        this.EvaluateTechTrees();
      });
    }
  }
  get current_prototyper(): PrototyperInst | undefined {
    return this.current;
  }

  CanBuildAtPoint(recipeId: string, point: ReadonlyVector3, skin?: string): boolean {
    const placement = this.world.placement;
    const recipe = placement?.recipe(recipeId);
    const inventory = getInventory(this.inst);
    return (
      this.enabled &&
      !this.disposed &&
      !this.inst.isRemoved &&
      !!placement &&
      !!recipe?.buffered &&
      inventory?.isBuffered(recipeId) === true &&
      inventory.bufferedSkin(recipeId) === skin &&
      placement.CanDeployRecipeAtPoint(point, recipe)
    );
  }

  /** builder.lua MakeRecipeAtPoint: only a paid recipe with a placer can start a point build. */
  MakeRecipeAtPoint(recipeId: string, point: Vector3, rotation: number, skin?: string): boolean {
    const inst = this.inst;
    if (!canBufferBuild(inst) || !this.CanBuildAtPoint(recipeId, point, skin)) {
      return false;
    }
    const recipe = this.world.placement?.recipe(recipeId);
    const pos = point.clone();
    return (
      inst.components.playercontroller?.DoAction(
        createBufferedAction(
          'BUILD',
          {
            doer: inst,
            pos,
            recipe: recipeId,
            rotation,
            skin,
            distance: recipe?.buildDistance,
          },
          () =>
            inst.components.inventory.isBuffered(recipeId) && inst.components.inventory.bufferedSkin(recipeId) === skin,
        ),
      ) ?? false
    );
  }

  /** ACTIONS.BUILD commits at the stategraph's hit frame. An invalid point or failed spawn leaves the build paid. */
  DoBuild(recipeId: string, point: Vector3, rotation = 0, skin?: string): boolean {
    const placement = this.world.placement;
    const inventory = getInventory(this.inst);
    const recipe = placement?.recipe(recipeId);
    if (!placement || !inventory || !recipe || !this.CanBuildAtPoint(recipeId, point, skin)) {
      return false;
    }
    let product: BuildProduct | undefined;
    if (
      !inventory.CommitBufferedBuild(recipeId, skin, () => {
        product = placement.SpawnPrefab(recipe.productId, point, skin);
        return product !== undefined;
      }) ||
      !product
    ) {
      return false;
    }
    product.setRotation(rotation);
    product.PushEvent('onbuilt', undefined);
    return true;
  }

  private eligible(station: PrototyperInst): boolean {
    return (
      !station.isRemoved &&
      station.hasTag('prototyper') &&
      !this.exclude_tags.some(tag => station.hasTag(tag)) &&
      !!station.components.prototyper &&
      (!station.components.prototyper.restrictedtag || this.inst.hasTag(station.components.prototyper.restrictedtag))
    );
  }
  UsePrototyper(station?: PrototyperInst): boolean {
    if (!this.enabled || this.disposed || (station && !this.eligible(station))) {
      return false;
    }
    this.override = station;
    this.EvaluateTechTrees();
    return true;
  }
  SetCraftingEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.EvaluateTechTrees();
  }

  private watchStations(stations: PrototyperInst[]): void {
    for (const [station, stop] of this.stationWatches) {
      if (!stations.includes(station)) {
        stop();
        this.stationWatches.delete(station);
      }
    }
    for (const station of stations) {
      if (!station.components.prototyper || this.stationWatches.has(station)) {
        continue;
      }
      const stops: (() => void)[] = [];
      const config = watchSignal(station.components.prototyper.configurationChanged, stop => stops.push(stop));
      const removal = watchSignal(station.removal, stop => stops.push(stop));
      this.stationWatches.set(station, () => stops.forEach(stop => stop()));
      let initialized = false;
      createEffect(() => {
        config.get();
        removal.get();
        if (initialized) {
          this.EvaluateTechTrees();
        }
        initialized = true;
      });
    }
  }

  EvaluateTechTrees(): void {
    if (this.disposed) {
      return;
    }
    const old = this.current;
    const position = this.inst.getPosition();
    let stations: PrototyperInst[] = [];
    if (
      this.override &&
      (!this.enabled ||
        !this.eligible(this.override) ||
        !this.override.components.prototyper!.CanUsePrototyper(this.inst))
    ) {
      this.override = undefined;
    }
    if (this.enabled) {
      stations = this.override
        ? [this.override]
        : this.world
            .findEntities(position, this.world.researchMachineDistance ?? 4, ['prototyper'], this.exclude_tags)
            .sort((a, b) => a.getPosition().distanceToSquared(position) - b.getPosition().distanceToSquared(position));
    }
    this.current = undefined;
    this.watchStations(stations);
    for (const station of stations) {
      if (!this.eligible(station)) {
        continue;
      }
      if (!this.current) {
        station.components.prototyper!.TurnOn(this.inst);
        this.current = station;
      } else {
        station.components.prototyper!.TurnOff(this.inst);
      }
    }
    if (old !== this.current && old && !old.isRemoved) {
      old.components.prototyper?.TurnOff(this.inst);
    }
    const trees = this.current?.components.prototyper?.GetTechTrees() ?? CreateTechTree();
    const previous = this.techTrees.peek();
    if (Object.keys(trees).some(key => trees[key] !== previous[key])) {
      this.techTrees.set(trees);
      this.inst.PushEvent?.('techtreechange', { level: trees });
    }
  }
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.enabled = false;
    this.EvaluateTechTrees();
    this.disposed = true;
    this.cleanups.splice(0).forEach(stop => stop());
    this.stopRemoval?.();
    this.stopRemoval = undefined;
  }
}
