import { SpriteState } from '@dontstarve-web/display';
import { Vector3 } from 'three';
import { ComponentTimer } from '../../componets/src/timer';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { PlacementSaveRecord } from './saveRecord';
import { MakeObstaclePhysics } from './standardcomponents';
import { Transform, type ReadonlyVector3 } from './transform';

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

const ASSETS = { animationArchive: 'nightmaregrowth.zip', buildArchives: ['nightmaregrowth.zip'], bank: 'nightmaregrowth' };

/**
 * nightmaregrowth.lua fn: the upright, non-looping idle and the DoTaskInTime(0, SpawnCrack) crack, removed with it.
 * SpawnCrack's destruction of nearby workables, the sanity aura, inspectable status and storyprogress are not ported.
 */
export class NightmareGrowthInstance extends PrefabInstance {
  private _crack?: NightmareGrowthCrackInstance;
  private _crack_rotation?: number;
  private readonly task: ComponentTimer;
  private readonly world: NightmareGrowthWorld;

  constructor(world: NightmareGrowthWorld, position: ReadonlyVector3) {
    super(NIGHTMAREGROWTH_ID, new SpriteState({ name: 'idle', held: true, billboard: true }), Transform.stationary());
    this.world = world;
    this.setPosition(position.x, 0, position.z);
    this.sprite.playOnce('idle');
    this.addTag('ancient_text');
    this.task = new ComponentTimer(world.scheduler, () => this.SpawnCrack());
    this.task.start(0);
    this.onRemove(() => {
      this.task.stop();
      if (this._crack && !this._crack.isRemoved) this._crack.remove();
    });
  }

  private SpawnCrack(): void {
    if (this._crack && !this._crack.isRemoved) return;
    const crack = this._crack = this.world.spawnPrefab(NIGHTMAREGROWTH_CRACK_ID, new Vector3(this.position.x, 0, this.position.z));
    crack.entityParent = this;
    if (this._crack_rotation !== undefined) {
      crack.SetRotation(this._crack_rotation);
      this._crack_rotation = undefined;
    }
  }

  /** The crack's rotation, or the loaded one its pending SpawnCrack has not applied yet. */
  OnSave(_inst: unknown, data: PlacementSaveRecord['components']): void {
    const crack = this._crack && !this._crack.isRemoved ? this._crack : undefined;
    const rotation = crack ? crack.GetRotation() : this._crack_rotation;
    if (rotation !== undefined) data.nightmareGrowth = { crackRotation: rotation };
  }

  OnLoad(_inst: unknown, data: PlacementSaveRecord['components']): void {
    if (data.nightmareGrowth?.crackRotation !== undefined) this._crack_rotation = data.nightmareGrowth.crackRotation;
  }
}

/** nightmaregrowth.lua crackfn: OnGround, LAYER_BACKGROUND and sort order 3, FX/NOCLICK/DECOR, not persistent. */
export class NightmareGrowthCrackInstance extends PrefabInstance {
  constructor(position: ReadonlyVector3, random: () => number) {
    super(NIGHTMAREGROWTH_CRACK_ID, new SpriteState({ name: 'crack_idle', held: true }), Transform.stationary());
    this.setPosition(position.x, 0, position.z);
    this.sprite.playOnce('crack_idle');
    this.sprite.setGround(0); this.sprite.setMeshOrder(-.5);
    for (const tag of ['FX', 'NOCLICK', 'DECOR']) this.addTag(tag);
    this.persists = false;
    this.SetRotation(random() * 360);
  }
  private degrees = 0;
  /** Transform:SetRotation / GetRotation, in degrees as the source keeps them. */
  SetRotation(degrees: number): void { this.degrees = degrees; this.transform.setRotation(degrees); }
  GetRotation(): number { return this.degrees; }
}

/** The nightmaregrowth and nightmaregrowth_crack Prefabs nightmaregrowth.lua returns; the spawners are not ported. */
export function nightmareGrowthPrefabs(world: NightmareGrowthWorld): Readonly<Record<typeof NIGHTMAREGROWTH_ID, PrefabEntityDefinition<NightmareGrowthInstance>>
  & Record<typeof NIGHTMAREGROWTH_CRACK_ID, PrefabEntityDefinition<NightmareGrowthCrackInstance>>> {
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
