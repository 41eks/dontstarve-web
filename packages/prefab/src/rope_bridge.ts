import { SpriteState } from '@dontstarve-web/display';
import { createSignal, readonlySignal, type ReadonlySignal } from '@dontstarve-web/signals';
import * as THREE from 'three';
import type { ReadonlyVector3 } from '../../animation/src/transformRoot';
import type { RopeBridgeFx } from '../../componets/src/ropebridgemanager';
import { SetEightFaced } from './eightFaced';
import { PrefabInstance, type PrefabEntityDefinition } from './prefabInstance';
import { TILE_SIZE } from './tile';

export const ROPE_BRIDGE_FX_ID = 'rope_bridge_fx' as const;
/** CreateRope's and CreateMinimapIcon's non-networked entities, which are not prefabs of their own. */
export const ROPE_BRIDGE_ROPE_ID = 'rope_bridge_fx_rope' as const;
export const ROPE_BRIDGE_ICON_ID = 'rope_bridge_fx_icon' as const;
export type RopeBridgePrefabId = typeof ROPE_BRIDGE_FX_ID | typeof ROPE_BRIDGE_ROPE_ID | typeof ROPE_BRIDGE_ICON_ID;
/** Asset("ANIM", "anim/rope_bridge.zip"): the rope_bridge bank and build. */
export const ROPE_BRIDGE_ARCHIVE = 'rope_bridge.zip';

const UNIT = TILE_SIZE / 4;
/** ROPE1_OFFSET / ROPE2_OFFSET, in DST units. */
const ROPE1_OFFSET = new THREE.Vector3(-0.1, 0, 2.6);
const ROPE2_OFFSET = new THREE.Vector3(0.1, 0, -2.6);
/** OnIconOffset's Transform:SetPosition(2, 0, 0). */
const ICON_OFFSET = new THREE.Vector3(2, 0, 0);
const HIGH_BITS = 60;
const LOW_BITS = 3;
const ANIM_ID = { place: 0, idle: 1, shake: 2, break: 3 } as const;
/** LAYER_BACKGROUND: background decals share one mesh order band, broken by SetSortOrder. */
const BACKGROUND_MESH_ORDER = -.5;
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export interface RopeBridgeWorld {
  /** FACING_* bit that the camera heading gives an eight-faced inst with rotation 0. */
  cameraFacing?: ReadonlySignal<number>;
  /** The rope and icon children, whose displays load their art. */
  spawnPrefab(prefab: typeof ROPE_BRIDGE_ROPE_ID | typeof ROPE_BRIDGE_ICON_ID, position: ReadonlyVector3): PrefabInstance;
}

/** CreateRope: the rope_support / rope_place art standing at one side of the bridge. */
export class RopeBridgeRopeInstance extends PrefabInstance {
  variation = 1;
}

/** rope_bridge.lua fn: rope_bridge_fx, the art ropebridgemanager spawns on each bridge tile. */
export class RopeBridgeFxInstance extends PrefabInstance implements RopeBridgeFx {
  private readonly rotationState = createSignal(0);
  /**
   * Transform:SetRotation of the eight-faced inst. bridge_idle draws the same bridge under all eight facings, its
   * planks across local z between the ropes, so the OnGround quad turns with the root as the engine's entity transform
   * turns it; the facing alone would leave every bridge's planks across world z.
   */
  readonly eightFacedRotation = readonlySignal(this.rotationState);
  /** inst.animdata (net_smallbyte): both ropes' variations and the anim state. */
  animdata = 0;
  /** inst.iconoffset (net_tinybyte): 0 no icon, 1 at the centre, 2 offset. */
  iconoffset = 0;
  rope1?: RopeBridgeRopeInstance;
  rope2?: RopeBridgeRopeInstance;
  icon?: PrefabInstance;
  killed?: true;
  /** inst.SetIconOffset / inst.SkipPre, which ropebridgemanager calls as fx:SetIconOffset(...) / fx:SkipPre(). */
  declare SetIconOffset: (inst: RopeBridgeFxInstance, offset: number | undefined) => void;
  declare SkipPre: (inst: RopeBridgeFxInstance) => void;
  declare world: RopeBridgeWorld;
  // conventions-allow instance-method: the engine's Transform:SetRotation; parented children follow the turned inst.
  SetRotation(degrees: number): void {
    this.rotationState.set(degrees);
    this.transform.setRotation(degrees);
    placeChildren(this);
  }
}

/** entity:SetParent with a local Transform:SetPosition: a child's place under the fx's position and rotation. */
function childPosition(inst: RopeBridgeFxInstance, offset: THREE.Vector3): THREE.Vector3 {
  // The world is mirrored along z, so the source's local offset is too before it turns with the inst.
  const local = new THREE.Vector3(offset.x, offset.y, -offset.z).multiplyScalar(UNIT);
  return local.applyAxisAngle(Y_AXIS, THREE.MathUtils.degToRad(inst.eightFacedRotation.peek())).add(inst.position);
}

function placeChildren(inst: RopeBridgeFxInstance): void {
  if (inst.rope1) { inst.rope1.copyPosition(childPosition(inst, ROPE1_OFFSET)); }
  if (inst.rope2) { inst.rope2.copyPosition(childPosition(inst, ROPE2_OFFSET)); }
  if (inst.icon && inst.iconoffset > 1) { inst.icon.copyPosition(childPosition(inst, ICON_OFFSET)); }
}

function CreateRope(inst: RopeBridgeFxInstance, offset: THREE.Vector3): RopeBridgeRopeInstance {
  const rope = inst.world.spawnPrefab(ROPE_BRIDGE_ROPE_ID, childPosition(inst, offset));
  if (!(rope instanceof RopeBridgeRopeInstance)) { throw new TypeError('rope_bridge_fx rope did not spawn a rope'); }
  rope.entityParent = inst;
  return rope;
}

/** OnAnimData: the ropes' clips for the anim state in animdata. The break branch (Rope_KillFX) is not ported. */
function OnAnimData(inst: RopeBridgeFxInstance): void {
  if (!inst.rope1 || !inst.rope2) {
    inst.rope1 = CreateRope(inst, ROPE1_OFFSET);
    inst.rope2 = CreateRope(inst, ROPE2_OFFSET);
  }
  const { rope1, rope2 } = inst;
  rope1.variation = (inst.animdata >> 4) + 1;
  rope2.variation = ((inst.animdata >> 2) & LOW_BITS) + 1;
  const animid = inst.animdata & LOW_BITS;
  for (const rope of [rope1, rope2]) {
    if (animid === ANIM_ID.place) {
      rope.sprite.playOnce(`rope_place_${rope.variation}`);
      rope.sprite.pushAnimation(`rope_support_${rope.variation}`, false);
    } else if (animid === ANIM_ID.idle) { rope.sprite.playOnce(`rope_support_${rope.variation}`); }
    else if (animid === ANIM_ID.shake) { rope.sprite.start(`rope_shake_${rope.variation}`); }
  }
}

function GetAnimDataForState(inst: RopeBridgeFxInstance, state: keyof typeof ANIM_ID): number {
  return (inst.animdata & HIGH_BITS) | ANIM_ID[state];
}

/** SkipPre: straight to bridge_idle; CancelSounds has no place sound to cancel, as the SoundEmitter is not ported. */
function SkipPre(inst: RopeBridgeFxInstance): void {
  if (inst.killed) { return; }
  inst.sprite.playOnce('bridge_idle');
  inst.animdata = GetAnimDataForState(inst, 'idle');
  OnAnimData(inst);
}

/** OnIconOffset: the CLASSIFIED minimap icon child, at the centre or turned two units out. */
function OnIconOffset(inst: RopeBridgeFxInstance): void {
  if (inst.iconoffset <= 0) {
    inst.icon?.remove();
    inst.icon = undefined;
    return;
  }
  if (!inst.icon) {
    inst.icon = inst.world.spawnPrefab(ROPE_BRIDGE_ICON_ID, inst.position);
    inst.icon.entityParent = inst;
  }
  if (inst.iconoffset > 1) { inst.icon.copyPosition(childPosition(inst, ICON_OFFSET)); }
}

/** SetIconOffset: nil no icon, 0 at the centre, anything else offset. */
function SetIconOffset(inst: RopeBridgeFxInstance, offset: number | undefined): void {
  const value = offset === undefined ? 0 : offset === 0 ? 1 : 2;
  if (value !== inst.iconoffset) {
    inst.iconoffset = value;
    OnIconOffset(inst);
  }
}

/**
 * rope_bridge.lua fn. Not ported: the SoundEmitter and its place / shake / break sounds, OnAnimOver's bridge_place ->
 * bridge_idle, ShakeIt, KillFX and OnEntitySleep / OnEntityWake, which only creation, quakes and destruction reach.
 */
function fn(world: RopeBridgeWorld, position: ReadonlyVector3): RopeBridgeFxInstance {
  const inst = new RopeBridgeFxInstance(ROPE_BRIDGE_FX_ID, new SpriteState({ name: 'bridge_place' }));
  inst.world = world;
  inst.copyPosition(position);
  // Transform:SetEightFaced, turned by SetRotation.
  SetEightFaced(inst, world.cameraFacing, undefined, inst.eightFacedRotation);
  inst.addTag('FX');
  // PlayAnimation("bridge_place"), SetOrientation(OnGround), SetLayer(LAYER_BACKGROUND), SetSortOrder(1).
  inst.sprite.playOnce('bridge_place');
  inst.sprite.setGround(0);
  inst.sprite.setMeshOrder(BACKGROUND_MESH_ORDER + (1 - 3) * .01);
  const rope1 = Math.floor(Math.random() * 4);
  let rope2 = Math.floor(Math.random() * 3);
  if (rope2 >= rope1) { rope2 += 1; }
  inst.animdata = (rope1 << 4) | (rope2 << 2);
  OnAnimData(inst);
  inst.persists = false;
  inst.SetIconOffset = SetIconOffset;
  inst.SkipPre = SkipPre;
  return inst;
}

/** CreateRope: NOCLICK, decor, not persisted; the bank and build only, until OnAnimData plays a clip. */
function CreateRopeEntity(): RopeBridgeRopeInstance {
  const inst = new RopeBridgeRopeInstance(ROPE_BRIDGE_ROPE_ID, new SpriteState({ name: 'rope_support_1', none: true, billboard: true }));
  inst.addTag('NOCLICK');
  inst.addTag('decor');
  inst.persists = false;
  return inst;
}

/** CreateMinimapIcon: a CLASSIFIED transform with the rope_bridge.png minimap icon. */
function CreateMinimapIcon(): PrefabInstance {
  const inst = new PrefabInstance(ROPE_BRIDGE_ICON_ID, new SpriteState({ name: 'none', none: true }));
  inst.persists = false;
  inst.addTag('CLASSIFIED');
  return inst;
}

const ASSETS = { animationArchive: ROPE_BRIDGE_ARCHIVE, buildArchives: [ROPE_BRIDGE_ARCHIVE], bank: 'rope_bridge' };

/** The rope_bridge_fx Prefab rope_bridge.lua returns, with its rope and icon entities; the kit and its placer are not ported. */
export function ropeBridgePrefabs(world: RopeBridgeWorld):
  Readonly<Record<RopeBridgePrefabId, PrefabEntityDefinition<PrefabInstance>>> {
  return {
    [ROPE_BRIDGE_FX_ID]: { fn: position => fn(world, position), assets: ASSETS, targetable: false },
    [ROPE_BRIDGE_ROPE_ID]: { fn: CreateRopeEntity, assets: ASSETS, targetable: false },
    [ROPE_BRIDGE_ICON_ID]: { fn: CreateMinimapIcon, targetable: false, minimapIcon: 'rope_bridge.png' },
  };
}
