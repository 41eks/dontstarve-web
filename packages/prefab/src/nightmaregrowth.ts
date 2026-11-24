import { definePrefabIds } from './prefabRegistration';
import { SpriteState } from '@dontstarve-web/display';
import { Vector3 } from 'three';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { EntityPersistData } from './saveRecord';
import { MakeObstaclePhysics } from './standardcomponents';
import type { ReadonlyVector3 } from './transform';

export const NIGHTMAREGROWTH_ID = 'nightmaregrowth' as const;
export const NIGHTMAREGROWTH_CRACK_ID = 'nightmaregrowth_crack' as const;

/** nightmaregrowth.lua OnSave's `crack_rotation`, in degrees. */
export interface NightmareGrowthSaveState {
  crackRotation: number;
}

export interface NightmareGrowthWorld {
  scheduler: GameTimeScheduler;
  /** SpawnPrefab("nightmaregrowth_crack"). */
  spawnPrefab(prefab: typeof NIGHTMAREGROWTH_CRACK_ID, position: Vector3): NightmareGrowthCrackInstance;
  random?: () => number;
}

const ASSETS = {
  animationArchive: 'nightmaregrowth.zip',
  buildArchives: ['nightmaregrowth.zip'],
  bank: 'nightmaregrowth',
};

/** nightmaregrowth.lua OnRemove, its inst.OnRemoveEntity: the crack goes with the growth. */
function OnRemove(inst: NightmareGrowthInstance): void {
  if (inst._crack && !inst._crack.isRemoved) {
    inst._crack.remove();
  }
}

/**
 * nightmaregrowth.lua fn: the upright, non-looping idle and the DoTaskInTime(0, SpawnCrack) crack, removed with it.
 * SpawnCrack's destruction of nearby workables, the sanity aura, inspectable status and storyprogress are not ported.
 */
export class NightmareGrowthInstance extends PrefabInstance {
  /** inst._crack */
  _crack?: NightmareGrowthCrackInstance;
  private _crack_rotation?: number;
  private readonly world: NightmareGrowthWorld;

  constructor(world: NightmareGrowthWorld, position: ReadonlyVector3) {
    super(NIGHTMAREGROWTH_ID, new SpriteState({ name: 'idle', held: true, billboard: true }));
    this.world = world;
    this.BindScheduler(world.scheduler);
    this.setPosition(position.x, 0, position.z);
    this.sprite.playOnce('idle');
    this.addTag('ancient_text');
    this.DoTaskInTime(0, () => this.SpawnCrack());
    this.OnRemoveEntity = OnRemove;
  }

  private SpawnCrack(): void {
    if (this._crack && !this._crack.isRemoved) {
      return;
    }
    // Not parented: the crack is its own unsaved entity (persists = false), which OnRemove removes.
    const crack = (this._crack = this.world.spawnPrefab(
      NIGHTMAREGROWTH_CRACK_ID,
      new Vector3(this.position.x, 0, this.position.z),
    ));
    if (this._crack_rotation !== undefined) {
      crack.SetRotation(this._crack_rotation);
      this._crack_rotation = undefined;
    }
  }

  /** The crack's rotation, or the loaded one its pending SpawnCrack has not applied yet. */
  override OnSave(_inst: unknown, data: EntityPersistData): void {
    const crack = this._crack && !this._crack.isRemoved ? this._crack : undefined;
    const rotation = crack ? crack.GetRotation() : this._crack_rotation;
    if (rotation !== undefined) {
      data.nightmareGrowth = { crackRotation: rotation };
    }
  }

  override OnLoad(_inst: unknown, data: EntityPersistData): void {
    if (data.nightmareGrowth?.crackRotation !== undefined) {
      this._crack_rotation = data.nightmareGrowth.crackRotation;
    }
  }
}

/** nightmaregrowth.lua crackfn: OnGround, LAYER_BACKGROUND and sort order 3, FX/NOCLICK/DECOR, not persistent. */
export class NightmareGrowthCrackInstance extends PrefabInstance {
  constructor(position: ReadonlyVector3, random: () => number) {
    super(NIGHTMAREGROWTH_CRACK_ID, new SpriteState({ name: 'crack_idle', held: true }));
    this.setPosition(position.x, 0, position.z);
    this.sprite.playOnce('crack_idle');
    this.sprite.setGround(0);
    this.sprite.setMeshOrder(-0.5);
    for (const tag of ['FX', 'NOCLICK', 'DECOR']) {
      this.addTag(tag);
    }
    this.persists = false;
    this.SetRotation(random() * 360);
  }
  private degrees = 0;
  /** Transform:SetRotation / GetRotation, in degrees as the source keeps them. */
  SetRotation(degrees: number): void {
    this.degrees = degrees;
    this.transform.setRotation(degrees);
  }
  GetRotation(): number {
    return this.degrees;
  }
}

/** The nightmaregrowth and nightmaregrowth_crack Prefabs nightmaregrowth.lua returns; the spawners are not ported. */
export function nightmareGrowthPrefabs(
  world: NightmareGrowthWorld,
): Readonly<
  Record<typeof NIGHTMAREGROWTH_ID, PrefabEntityDefinition<NightmareGrowthInstance>> &
    Record<typeof NIGHTMAREGROWTH_CRACK_ID, PrefabEntityDefinition<NightmareGrowthCrackInstance>>
> {
  const random = world.random ?? Math.random;
  return {
    [NIGHTMAREGROWTH_ID]: {
      fn: position => new NightmareGrowthInstance(world, position),
      assets: ASSETS,
      physics: { make: MakeObstaclePhysics, radius: 1.1 },
      minimapIcon: 'nightmaregrowth.png',
    },
    [NIGHTMAREGROWTH_CRACK_ID]: {
      fn: position => new NightmareGrowthCrackInstance(position, random),
      assets: ASSETS,
      targetable: false,
    },
  };
}

export const nightmareGrowthRegistration = {
  create: nightmareGrowthPrefabs,
  families: { nightmareGrowths: definePrefabIds([NIGHTMAREGROWTH_ID], true) },
};
