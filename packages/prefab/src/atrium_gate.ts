import { SpriteState } from '@dontstarve-web/display';
import { Vector3 } from 'three';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import {
  CharlieCutscene, WorldSettingsTimer, EntityTracker, ColourTweener,
  type CharlieCutsceneSave, type WorldSettingsTimerSave, type EntityTrackerSave,
} from '../../componets/src/atriumGateSignatures';
import { Inspectable } from '../../componets/src/dragonflySignatures';
import { PointOfInterest } from '../../componets/src/statueglommerSignatures';
import { Pickable, type PickableSaveState } from './components/pickable';
import { Trader } from '../../componets/src/trader';
import { PlayerProx } from '../../componets/src/playerprox';
import { Hauntable } from '../../componets/src/hauntable';
import type { GameTimeScheduler } from '../../componets/src/gameTimeScheduler';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import type { Pathfinder } from './pathfinder';
import { MakeObstaclePhysics, WORLD_SCALE } from './standardcomponents';
import { Transform } from './transform';

export { ATRIUM_GATE_TIMER_NAMES, type AtriumGateTimerName, type AtriumGateTimerSave } from '../../componets/src/atriumGateSignatures';

export const ATRIUM_GATE_ID = 'atrium_gate' as const;
const ATRIUM_GATE_FLOOR_ID = 'atrium_gate_floor' as const;
const ATRIUM_GATE_TERRAFORM_BLOCKER_ID = 'atrium_gate_terraform_blocker' as const;
const ATRIUM_GATE_ACTIVATEDFX_ID = 'atrium_gate_activatedfx' as const;
type AtriumGateChildId = typeof ATRIUM_GATE_FLOOR_ID | typeof ATRIUM_GATE_TERRAFORM_BLOCKER_ID | typeof ATRIUM_GATE_ACTIVATEDFX_ID;
/** ATRIUM_ARENA_SIZE, in DST units. */
const ATRIUM_ARENA_SIZE = 14.55;
/** LAYER_BACKGROUND always draws over LAYER_GROUND (turf, mesh orders [-1, -0.6)); SetSortOrder(-3) only orders it among
 * background decals. A group order would sort it before every turf mesh, so the order goes on the mesh, as for ponds. */
const FLOOR_RENDER_ORDER = -.5 + (-3 - 3) * .01;

/** atrium_gate.lua OnSave. */
export interface AtriumGateSaveState { vault_key_socketed?: true; can_spawn_charlie_hand_keystone?: true; launch_key?: true }
export interface AtriumGateRecord {
  id: string;
  transform: { position: [number, number, number]; rotationY: number };
  components: {
    atriumGate?: AtriumGateSaveState;
    pickable?: Pick<PickableSaveState, 'picked' | 'paused' | 'caninteractwith'>;
    charliecutscene?: CharlieCutsceneSave;
    worldsettingstimer?: WorldSettingsTimerSave;
    entitytracker?: EntityTrackerSave;
  };
}

export interface AtriumGateWorld {
  scheduler: GameTimeScheduler;
  pathfinder?: Pathfinder;
  /** SpawnPrefab for the gate's non-networked children, whose displays load their art. */
  spawnPrefab(prefab: AtriumGateChildId, position: ReadonlyVector3): PrefabInstance;
}

interface AtriumGateComponents {
  charliecutscene: CharlieCutscene;
  pointofinterest: PointOfInterest;
  inspectable: Inspectable;
  pickable: Pickable;
  trader: Trader;
  worldsettingstimer: WorldSettingsTimer;
  entitytracker: EntityTracker;
  colourtweener: ColourTweener;
  playerprox: PlayerProx;
  hauntable: Hauntable;
}

/** atrium_gate.lua fn. Key trading, the stalker fight, running timers and sounds are not ported; their saved fields are kept. */
export class AtriumGateInstance extends PrefabInstance {
  declare readonly components: PrefabInstance['components'] & AtriumGateComponents;
  readonly world: AtriumGateWorld;
  vault_key_socketed?: true;
  can_spawn_charlie_hand_keystone?: true;
  /** OnLoad's data.launch_key: the atrium_key it launches is not ported, so the pending launch is saved again. */
  _launchkey?: true;
  _gatefx?: AtriumGateFxInstance;

  constructor(world: AtriumGateWorld, position: ReadonlyVector3) {
    super(ATRIUM_GATE_ID, new SpriteState({ name: 'idle', held: true, billboard: true }), Transform.stationary());
    this.world = world;
    this.setPosition(position.x, 0, position.z);
    this.sprite.playOnce('idle');
    this.sprite.hideLayer('KEY');
    // SetBuild("atrium_gate"): without it, symbols missing there (dreadstone, the repair pieces) would resolve from
    // the listed repaired build. CharlieCutscene:OnLoad switches to atrium_gate_build.
    this.sprite.setBuildArchive('atrium_gate.zip');
    this.minimap.SetIcon('atrium_gate.png');
    for (const tag of ['gemsocket', 'stargate', 'give_dolongaction']) this.addTag(tag);

    // CreateFloor and AddTerraformBlockers: non-networked children that are never saved.
    const children = [world.spawnPrefab(ATRIUM_GATE_FLOOR_ID, position)];
    const radius = Math.ceil(ATRIUM_ARENA_SIZE / 3), diameter = radius * 2;
    for (let row = -3 * radius; row <= 3 * radius; row += diameter) {
      for (let col = -diameter; col <= diameter; col += diameter) {
        for (const [x, z] of [[row, col], [col, row]]) {
          children.push(world.spawnPrefab(ATRIUM_GATE_TERRAFORM_BLOCKER_ID,
            new Vector3(position.x + x * WORLD_SCALE, 0, position.z + z * WORLD_SCALE)));
        }
      }
    }
    for (const child of children) child.entityParent = this as PrefabInstance<SpriteState, object>;
    InitializePathFinding(this, world.pathfinder);

    // A new pickable has no product until OnKeyGiven's SetUp: nothing to pick.
    const pickable = new Pickable(this, 'atrium_key', undefined, 1, undefined, undefined, { picked: true }, { scheduler: world.scheduler });
    pickable.canInteractWith = false;
    pickable.savesCanInteractWith = true;
    const trader = new Trader(this);
    const playerprox = new PlayerProx({ isValid: () => !this.isRemoved, getPosition: () => this.getPosition() });
    playerprox.SetDist(ATRIUM_ARENA_SIZE * WORLD_SCALE, Math.ceil(ATRIUM_ARENA_SIZE + 4) * WORLD_SCALE);
    const hauntable = new Hauntable(this, world.scheduler);
    hauntable.SetOnHauntFn(() => false);
    Object.assign(this.components, { charliecutscene: new CharlieCutscene(this), pointofinterest: new PointOfInterest(this),
      inspectable: new Inspectable(this), pickable, trader, worldsettingstimer: new WorldSettingsTimer(this),
      entitytracker: new EntityTracker(this), colourtweener: new ColourTweener(this), playerprox, hauntable });

    this.OnSave = (_inst, data) => {
      const own: AtriumGateSaveState = {
        ...this.vault_key_socketed ? { vault_key_socketed: true as const } : {},
        ...this.can_spawn_charlie_hand_keystone ? { can_spawn_charlie_hand_keystone: true as const } : {},
        ...this._launchkey ? { launch_key: true as const } : {},
      };
      if (Object.keys(own).length) data.atriumGate = own;
    };
    this.OnLoad = (_inst, data) => {
      const own = data.atriumGate;
      if (own?.vault_key_socketed) SocketVaultKey(this);
      if (own?.can_spawn_charlie_hand_keystone) this.can_spawn_charlie_hand_keystone = true;
      if (own?.launch_key) this._launchkey = true;
    };
    this.onRemove(() => {
      for (const child of children) child.remove();
      this._gatefx?.remove();
      playerprox.dispose(); hauntable.dispose(); pickable.dispose(); trader.dispose();
    });
  }

  IsDestabilizing(): boolean { return this.components.worldsettingstimer.ActiveTimerExists('destabilizing'); }
}

function SocketVaultKey(inst: AtriumGateInstance): void {
  inst.vault_key_socketed = true;
  inst.sprite.showLayer('KEY');
}

function SetMiniMapIcon(inst: AtriumGateInstance): void {
  const repaired = inst.components.charliecutscene.IsGateRepaired();
  const active = inst.components.pickable.canInteractWith || inst.components.worldsettingstimer.ActiveTimerExists('destabilizedelay');
  inst.minimap.SetIcon(active
    ? (repaired ? 'atrium_gate_fixed_active.png' : 'atrium_gate_active.png')
    : (repaired ? 'atrium_gate_fixed.png' : 'atrium_gate.png'));
}

function ShowFx(inst: AtriumGateInstance, state: 'idle' | 'overload'): void {
  if (!inst._gatefx) {
    const fx = inst._gatefx = inst.world.spawnPrefab(ATRIUM_GATE_ACTIVATEDFX_ID, inst.position) as AtriumGateFxInstance;
    fx.entityParent = inst as PrefabInstance<SpriteState, object>;
  }
  inst._gatefx.SetFX(state);
}

/** CharlieCutscene:OnLoad's appearance, then OnLoadPostPass; a new gate has none of their saved state. */
function OnLoadPostPass(inst: AtriumGateInstance): void {
  const { charliecutscene, pickable, trader, worldsettingstimer, entitytracker } = inst.components;
  if (charliecutscene.IsGateRepaired()) inst.sprite.setBuildArchive('atrium_gate_build.zip');
  SetMiniMapIcon(inst);
  if (inst.IsDestabilizing()) {
    // StartDestabilizing(inst, true)
    trader.Disable(); pickable.canInteractWith = false;
    inst.removeTag('intense');
    ShowFx(inst, 'overload');
    inst.light.set({ radius: 8 * WORLD_SCALE, falloff: .9, intensity: .65, colour: [200 / 255, 140 / 255, 140 / 255] });
    inst.sprite.playOnce('overload_pre'); inst.sprite.pushAnimation('overload_loop', true);
  } else if (worldsettingstimer.ActiveTimerExists('cooldown')) {
    // StartCooldown(inst, true)
    trader.Disable(); pickable.canInteractWith = false;
    inst.sprite.start('cooldown');
  } else if (pickable.canInteractWith || worldsettingstimer.ActiveTimerExists('destabilizedelay')) {
    // OnKeyGiven(inst)
    trader.Disable();
    pickable.canBePicked = true;
    pickable.canInteractWith = true;
    inst.sprite.playOnce('idle_active');
    SetMiniMapIcon(inst);
    const delayed = worldsettingstimer.ActiveTimerExists('destabilizedelay');
    // OnTrackStalker, whose stalker is not ported: its saved tracking stands for it; then OnQueueDestabilize(inst, true).
    if (entitytracker.saved?.entities.some(({ name }) => name === 'stalker') || delayed) {
      inst.addTag('intense');
      ShowFx(inst, 'idle');
      inst.sprite.start('idle_fight');
    }
    if (delayed) { trader.Disable(); pickable.canInteractWith = false; inst.removeTag('intense'); }
  }
}

/** atrium_gate.lua InitializePathFinding and OnRemove: the 2×2 path tiles around the gate's centre. */
function InitializePathFinding(inst: PrefabInstance, pathfinder: Pathfinder | undefined): void {
  if (!pathfinder) return;
  const { x, y, z } = inst.position;
  const offset = .5 * WORLD_SCALE;
  const walls = [[-offset, -offset], [-offset, offset], [offset, -offset], [offset, offset]].map(([dx, dz]) => ({ x: x + dx, y, z: z + dz }));
  for (const wall of walls) pathfinder.AddWall(wall);
  inst.onRemove(() => { for (const wall of walls) pathfinder.RemoveWall(wall); });
}

/** atrium_gate.lua CreateFloor. */
function CreateFloor(position: ReadonlyVector3): PrefabInstance {
  const inst = new PrefabInstance(ATRIUM_GATE_FLOOR_ID, new SpriteState({ name: 'idle_active', held: true, billboard: false }), Transform.stationary());
  inst.setPosition(position.x, 0, position.z);
  inst.addTag('DECOR'); inst.addTag('NOCLICK');
  inst.persists = false;
  inst.sprite.playOnce('idle_active');
  inst.sprite.setGround(0);
  inst.sprite.setMeshOrder(FLOOR_RENDER_ORDER);
  return inst;
}

/** atrium_gate.lua CreateTerraformBlocker: a transform only. */
function CreateTerraformBlocker(position: ReadonlyVector3): PrefabInstance {
  const inst = new PrefabInstance(ATRIUM_GATE_TERRAFORM_BLOCKER_ID, new SpriteState({ name: '', billboard: false }), Transform.stationary());
  inst.setPosition(position.x, 0, position.z);
  inst.addTag('FX');
  inst.persists = false;
  return inst;
}

/** atrium_gate_activatedfx.lua fn. Light:Enable(false) and KillFX are not reached by the ported gate states. */
export class AtriumGateFxInstance extends PrefabInstance {
  anim?: 'idle' | 'overload';

  constructor(position: ReadonlyVector3) {
    super(ATRIUM_GATE_ACTIVATEDFX_ID, new SpriteState({ name: 'idle_pre', billboard: true }), Transform.stationary());
    this.setPosition(position.x, 0, position.z);
    this.sprite.playOnce('idle_pre');
    this.addTag('FX');
    this.persists = false;
    this.sprite.pushAnimation('idle_loop', true);
  }

  SetFX(anim: 'idle' | 'overload'): void {
    if ((this.anim ?? 'idle') !== anim) {
      if (this.anim !== undefined) {
        this.sprite.pushAnimation(`${this.anim}_pst`, false);
        this.sprite.pushAnimation(`${anim}_pre`, false);
      } else this.sprite.playOnce(`${anim}_pre`);
      this.sprite.pushAnimation(`${anim}_loop`, true);
      if (anim === 'idle') { this.removeTag('NOCLICK'); this.removeTag('DECOR'); this.addTag('FX'); }
      else { this.removeTag('FX'); this.addTag('DECOR'); this.addTag('NOCLICK'); }
    }
    this.anim = anim;
  }
}

const INSTANCED = { instancedAnimations: 'all' as const };

/** The Prefabs atrium_gate.lua and atrium_gate_activatedfx.lua return, and the gate's non-networked children. */
export function atriumGatePrefabs(world: AtriumGateWorld): Readonly<Record<typeof ATRIUM_GATE_ID, PrefabEntityDefinition<AtriumGateInstance>>
  & Record<typeof ATRIUM_GATE_FLOOR_ID | typeof ATRIUM_GATE_TERRAFORM_BLOCKER_ID, PrefabEntityDefinition<PrefabInstance>>
  & Record<typeof ATRIUM_GATE_ACTIVATEDFX_ID, PrefabEntityDefinition<AtriumGateFxInstance>>> {
  return {
    [ATRIUM_GATE_ID]: {
      fn: position => new AtriumGateInstance(world, position),
      assets: { animationArchive: 'atrium_gate.zip', buildArchives: ['atrium_gate.zip', 'atrium_gate_build.zip'], bank: 'atrium_gate' },
      assetOptions: INSTANCED,
      physics: { make: MakeObstaclePhysics, radius: 1 },
      onSpawned: OnLoadPostPass,
    },
    // LAYER_BACKGROUND ground art: instance batches draw upright billboards with a depth prepass, so it stays out of them.
    [ATRIUM_GATE_FLOOR_ID]: {
      fn: CreateFloor,
      assets: { animationArchive: 'atrium_floor.zip', buildArchives: ['atrium_floor.zip'], bank: 'atrium_floor' },
      targetable: false,
    },
    [ATRIUM_GATE_TERRAFORM_BLOCKER_ID]: { fn: CreateTerraformBlocker, targetable: false },
    [ATRIUM_GATE_ACTIVATEDFX_ID]: {
      fn: position => new AtriumGateFxInstance(position),
      assets: { animationArchive: 'atrium_gate_overload_fx.zip', buildArchives: ['atrium_gate_overload_fx.zip'], bank: 'atrium_gate_overload_fx' },
      assetOptions: INSTANCED,
      targetable: false,
    },
  };
}
